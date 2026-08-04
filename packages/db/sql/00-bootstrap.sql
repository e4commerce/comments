-- Executado ANTES das migrations geradas pelo drizzle-kit.
--
-- As extensões precisam existir primeiro porque o schema usa os tipos e operadores delas:
-- `vector(1536)` em comment_embeddings e ai_topics, `gin_trgm_ops` no índice de busca de
-- comments, e gen_random_uuid() do pgcrypto como default de toda chave primária.
--
-- Falhar aqui é o comportamento correto e desejado: se `vector` não estiver disponível na
-- instância (o caso a verificar no Postgres gerenciado do Railway, cuja imagem padrão não
-- garante pgvector), é melhor descobrir na primeira migration do que na Fase 6, com dados
-- em produção.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

-- Diagnóstico explícito em vez de erro obscuro mais adiante.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE EXCEPTION
      'A extensão pgvector não está instalada e é exigida pelo §3.1 do PRD. '
      'Em desenvolvimento use a imagem pgvector/pgvector:pg16 (ver docker-compose.yml). '
      'No Railway, provisione um Postgres com pgvector — a imagem padrão não o inclui.';
  END IF;
END $$;

-- Resolve a organização ativa da transação corrente.
--
-- STABLE (não IMMUTABLE): o valor muda entre transações, e marcá-la IMMUTABLE permitiria
-- ao planner cachear o resultado entre tenants — o que seria uma falha de isolamento.
--
-- `current_setting(..., true)` devolve NULL quando a variável não foi definida, em vez de
-- lançar. Combinado com as políticas abaixo, isso faz o sistema falhar FECHADO: sem
-- withOrg(), nenhuma linha é visível.
CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid $$;
