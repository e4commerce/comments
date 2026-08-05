# Desvios conscientes ao PRD

Registro de tudo que difere do PRD v1.0, com justificativa. Seções marcadas [NORMATIVO]
só aparecem aqui com aprovação explícita.

## 1. `comments` recebe nove colunas de resultado de IA — §6.4 [NORMATIVO]

**Status:** aprovado (decisão delegada ao agente em 04/08/2026).

**O quê.** Adição de `ai_analysis_id`, `ai_sentiment`, `ai_intent`, `ai_urgency`,
`ai_confidence`, `ai_is_toxic`, `ai_is_spam`, `ai_is_question` e `primary_topic_id`.

**Por quê.** O §11.1 exige p95 abaixo de 300 ms com filtros sobre 1 milhão de registros por
organização, e o §7.2 permite combinar sentimento, intenção, urgência, tópico, toxicidade e
spam com paginação keyset sobre `(published_at, id)`. Na forma normalizada a query da inbox
precisaria juntar `ai_analyses` — cuja unicidade é `(comment_id, prompt_version)`, exigindo
`DISTINCT ON` para localizar a análise vigente — mais `comment_topics`, dentro da mesma
query paginada. O planner perde o keyset e cai em sort.

**O que NÃO muda.** Nenhum nome, tipo ou índice do §6.4. `ai_analyses` continua a fonte da
verdade e o histórico por `prompt_version`; a correção humana do §9.6 continua morando lá,
sem sobrescrever a saída do modelo.

**Invariante.** As colunas são gravadas na MESMA transação que insere em `ai_analyses`.
Divergência entre as duas é bug, não estado válido.

## 2. `META_GRAPH_VERSION` default `v26.0` em vez de `v23.0` — §3.4 [NORMATIVO]

A referência [5] do próprio PRD cita "Graph API Reference v26.0", e v23.0 se aproxima do
sunset de dois anos. Verificado em 04/08/2026: v26.0 é a versão vigente.

## 2b. PostgreSQL 18.4 em vez de 16 — §3.1 [NORMATIVO]

**Status:** decidido pelo agente em 04/08/2026, com o Railway já provisionado.

O §3.1 especifica PostgreSQL 16. O Postgres gerenciado do Railway provisiona 18.4, e forçar
16 exigiria abandonar o serviço gerenciado por uma imagem Docker configurada à mão — mais
trabalho operacional e menos backup automático, para ganhar aderência a um número de versão.

Nada do schema depende de 16. As features usadas são RLS, `pgcrypto`, `pg_trgm`, `pgvector`
0.8.6 e `UNIQUE NULLS NOT DISTINCT` (PG15+). O `docker-compose.yml` foi alinhado para
`pgvector/pgvector:pg18`, porque paridade entre desenvolvimento e produção vale mais do que
o número: divergir aqui é como um índice se comportar diferente em teste e em produção.

Verificado no banco provisionado: `vector 0.8.6`, `pg_trgm 1.6`, `pgcrypto 1.4`.

## 3. Oito variáveis de ambiente adicionais — §3.4 [NORMATIVO]

`DATABASE_URL_MIGRATOR`, `RESEND_API_KEY`, `EMAIL_FROM`, `AUTH_GOOGLE_ID`,
`AUTH_GOOGLE_SECRET`, `OPENROUTER_APP_TITLE`, `AI_EMBEDDING_DIMENSIONS`, `BACKFILL_DAYS`,
`RECONCILE_MAX_PAGES_PER_RUN`, `RETENTION_MONTHS_DEFAULT`. Cada uma existe porque uma
entrega que o PRD define depende dela. Detalhamento na Seção 2 de `PLANO_EXECUCAO.md`.

## 4. `metrics_daily`: `UNIQUE NULLS NOT DISTINCT` — §6.7 [NORMATIVO]

A unique especificada inclui três colunas nuláveis. Em Postgres NULLs são distintos em
unique constraints por padrão, então linhas de rollup com `social_account_id`, `platform` ou
`source_type` nulos duplicariam a cada execução do job de agregação — e o §8 exige que a
contagem do gráfico coincida com a da inbox. `NULLS NOT DISTINCT` existe desde o PG15 e o
§3.1 especifica PG16.

## 5. Índices adicionais

Além dos índices literais do §6, foram adicionados índices para caminhos de acesso que o PRD
descreve no texto mas não indexa: lookup de conta por `(platform, external_id)` no handler de
webhook, varredura de reconciliação por `(organization_id, last_synced_at)`, taxonomia ativa,
fila de toxicidade, comentários de anúncio, e os quatro índices keyset dos filtros
desnormalizados. Todos são adições; nenhum índice do §6 foi removido ou alterado.

## 6. `comments.ai_analysis_id` e `comments.primary_topic_id` sem FK no Drizzle

As foreign keys existem no banco, criadas por `sql/99-rls.sql`. Não são declaradas em
`content.ts` porque `content.ts → ai.ts → content.ts` seria um ciclo de import de módulo com
inicialização no topo — fonte de falhas difíceis de diagnosticar. Diferença de forma, não de
comportamento.

## 7. `comment_authors` sem `created_at`/`updated_at`

O preâmbulo do §6 diz que todas as tabelas têm as duas colunas; o DDL de `comment_authors` no
§6.4 não as tem. Seguimos o DDL, que é a especificação por coluna. `first_seen_at` e
`last_seen_at` cobrem a necessidade. Mesmo critério para as demais tabelas onde o DDL omite
`updated_at` (`memberships`, `invitations`, `ad_accounts`, `ads`, `comment_actions`,
`comment_events`, `reply_templates`, `tags`, `ai_analyses`, `ai_usage_log`, `saved_views`,
`sync_jobs`, `metrics_daily`, `topic_metrics_daily`, `audit_logs`).

## 8. `docker-compose.yml`: web e worker sob profile

O §3.3 lista os quatro serviços. `postgres` e `redis` sobem por padrão; `web` e `worker`
ficam sob o profile `apps`, porque o modo normal de desenvolvimento é rodá-los nativamente
com hot reload. `docker compose --profile apps up` sobe os quatro. §3.3 é [ORIENTATIVO].

## 9. Credenciais de integração exigidas no ponto de uso, não no boot — §3.4 [NORMATIVO]

**Status:** decidido pelo agente em 05/08/2026, após o quarto ciclo de deploy travado por isso.

O §3.4 marca `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`,
`OPENROUTER_API_KEY` e `RESEND_API_KEY` como obrigatórias, e elas são — para o sistema
completo. No schema de validação, porém, passaram a ser opcionais, e são exigidas por
`requireMetaConfig()`, `requireOpenRouterConfig()` e `requireEmailConfig()` no módulo que
efetivamente fala com cada serviço.

**Por quê.** Exigi-las no boot durante uma implementação faseada obriga a preencher com valores
falsos as credenciais de integrações que nenhum código consome ainda. E um placeholder em
produção é **pior** que um valor ausente: passa pela validação, o operador acredita que está
configurado, e a falha aparece depois como erro opaco da Graph API — longe da causa. Exigir no
ponto de uso dá a mensagem certa no momento certo, nomeando a variável e a fase que a precisa.

O comportamento observável que o §3.4 quer preservar — "falhando de forma explícita se alguma
obrigatória estiver ausente" — é mantido: continua valendo para tudo que o processo realmente
precisa para subir (`DATABASE_URL`, `REDIS_URL`, `APP_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`), e
para as demais a falha é explícita no primeiro uso.

Efeito colateral positivo: `optionalString` trata `''` como ausente, porque painéis de
configuração gravam variável não preenchida como string vazia. Sem isso o operador veria
"Required" numa variável que acabou de criar.

## 10. Sessões em JWT, não em banco — §3.1 [NORMATIVO]

**Status:** imposto pela biblioteca; sem alternativa que preserve o outro requisito do mesmo §3.1.

O §3.1 especifica "Auth.js (NextAuth v5) com e-mail/senha e Google" e "Sessões em banco". Os
dois não coexistem: o provider Credentials do Auth.js é incompatível com
`session.strategy: 'database'` por desenho da biblioteca — não existe callback onde criar a
sessão persistida no fluxo de senha, e a lib força JWT quando Credentials está presente.

Como login por e-mail e senha é requisito funcional explícito, a escolha foi JWT.

**Consequências assumidas.** Revogar a sessão de um usuário específico não é possível: exige
trocar `AUTH_SECRET`, o que derruba todas as sessões, ou esperar a expiração de 30 dias. Isso
importa quando alguém sai da empresa — na v1 o caminho é remover o membership, o que bloqueia o
acesso aos dados da organização na primeira requisição, mesmo com o JWT ainda válido.

A tabela `sessions` permanece no schema. Se o login por senha for substituído por SSO em algum
momento, migrar para sessão em banco passa a ser possível sem alterar o schema.

## 11. shadcn/ui não instalado na Fase 1 — §3.1 [ORIENTATIVO]

O §3.1 lista shadcn/ui. Ele é um gerador de componentes, e gerar dezenas de arquivos para telas
com dois formulários criaria superfície sem uso. As primitivas em `apps/web/src/components/ui.tsx`
seguem a mesma API de props, então a instalação na Fase 4 — quando a inbox precisa de dialog,
dropdown, command, tooltip e virtualização — substitui sem reescrever call sites.
