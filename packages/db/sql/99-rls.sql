-- Executado DEPOIS das migrations geradas pelo drizzle-kit, e é idempotente: roda a cada
-- `pnpm db:migrate` sem efeito colateral.
--
-- Três responsabilidades:
--   1. Foreign keys adiadas (as duas que criariam ciclo de import no schema TypeScript)
--   2. Privilégios do role de runtime
--   3. Row Level Security por organização
--
-- §4.1 do PRD: "A dupla proteção é intencional: um erro de filtro na aplicação não deve
-- resultar em vazamento entre clientes."

-- ---------------------------------------------------------------------------
-- 1. Foreign keys das colunas desnormalizadas de IA
--
-- Declaradas aqui e não em content.ts porque content.ts → ai.ts → content.ts seria um
-- ciclo de import de módulo. A constraint existe no banco; só não é declarada no Drizzle.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comments_ai_analysis_id_fkey'
  ) THEN
    ALTER TABLE comments
      ADD CONSTRAINT comments_ai_analysis_id_fkey
      FOREIGN KEY (ai_analysis_id) REFERENCES ai_analyses(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comments_primary_topic_id_fkey'
  ) THEN
    ALTER TABLE comments
      ADD CONSTRAINT comments_primary_topic_id_fkey
      FOREIGN KEY (primary_topic_id) REFERENCES ai_topics(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Privilégios do role de runtime
--
-- pulse_app recebe DML e nada mais: sem DDL, sem TRUNCATE, sem ownership. Se o role não
-- existir (banco provisionado sem o init script, como no Railway), avisamos em vez de
-- falhar a migration inteira — mas a RLS fica sem efeito prático até que ele exista.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_app') THEN
    RAISE WARNING
      'Role pulse_app não existe. A aplicação vai rodar como dono das tabelas e a RLS '
      'será ignorada (o dono não é sujeito a políticas). Crie o role conforme '
      'docs/deploy-railway.md antes de ir a produção.';
    RETURN;
  END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA public TO pulse_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pulse_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pulse_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION app_current_org() TO pulse_app';
  -- Tabelas criadas por migrations futuras herdam os mesmos privilégios.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
       || 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pulse_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
       || 'GRANT USAGE, SELECT ON SEQUENCES TO pulse_app';
END $$;

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
--
-- Todas as tabelas com organization_id ganham a mesma política. O §4.1 exige RLS em
-- "comentários, posts e análises"; aplicamos a todo dado operacional, porque a diferença
-- de custo é nula e a superfície de erro é menor.
--
-- Ficam DE FORA, deliberadamente:
--   organizations, users, memberships, invitations  — como saber a que organização um
--       usuário pertence é justamente a query que resolve a organização ativa, ela não
--       pode depender da organização já estar definida.
--   accounts, sessions, verification_tokens         — contrato do Auth.js, pré-tenancy.
--   webhook_events                                  — a organização é desconhecida no
--       momento da recepção; é resolvida a partir de entry.id já dentro do job (§5.7).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  org_scoped text[] := ARRAY[
    'meta_connections', 'social_accounts', 'ad_accounts', 'ads',
    'posts', 'comment_authors', 'comments',
    'comment_actions', 'comment_events', 'reply_templates', 'tags',
    'ai_analyses', 'ai_topics', 'comment_topics', 'comment_embeddings', 'ai_usage_log',
    'sync_jobs', 'automation_rules', 'saved_views',
    'metrics_daily', 'topic_metrics_daily', 'audit_logs'
  ];
BEGIN
  FOREACH t IN ARRAY org_scoped LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      RAISE EXCEPTION 'Tabela esperada ausente: %. Rode as migrations do drizzle-kit primeiro.', t;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    -- USING filtra leitura; WITH CHECK impede gravar linha de outra organização — sem ele,
    -- um INSERT com organization_id alheio passaria.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = app_current_org()) '
      'WITH CHECK (organization_id = app_current_org())', t);
  END LOOP;
END $$;

-- comment_tags não tem organization_id (a chave primária é (comment_id, tag_id), §6.5).
-- O isolamento vem por associação ao comentário.
ALTER TABLE comment_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON comment_tags;
CREATE POLICY tenant_isolation ON comment_tags
  USING (EXISTS (
    SELECT 1 FROM comments c
    WHERE c.id = comment_tags.comment_id AND c.organization_id = app_current_org()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM comments c
    WHERE c.id = comment_tags.comment_id AND c.organization_id = app_current_org()
  ));
