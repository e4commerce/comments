# Plano de execução — Pulse

Derivado do PRD v1.0 (04/08/2026), Seção 16. Este documento é o contrato de execução:
as fases seguem os títulos e a ordem normativos do PRD, com escopo detalhado, gate de
verificação e riscos explicitados.

**Regra de avanço:** nenhuma fase avança com testes vermelhos (§16). Cada gate abaixo é
derivado do Apêndice B do PRD e deve ser automatizado onde a coluna "Gate" indicar teste.

---

## 1. Premissas assumidas

Onde o PRD é silencioso, assumo o seguinte e sigo. Qualquer uma pode ser revertida sem
retrabalho estrutural, exceto onde marcado.

| Tema | Premissa | Base |
| --- | --- | --- |
| Hospedagem | **Railway** — três serviços (`web`, `worker`, `scheduler`) mais Postgres e Redis. `docker-compose.yml` permanece para desenvolvimento local | Decidido pelo solicitante. Ver Seção 9 |
| `META_GRAPH_VERSION` | Default `v26.0`, não `v23.0` | Referência [5] do próprio PRD cita v26.0; v23.0 está próximo do sunset de 2 anos |
| Modelo de embeddings | `openai/text-embedding-3-small` (1536 dim nativas) | O endpoint do OpenRouter não expõe parâmetro `dimensions`, e `vector(1536)` é fixo em §6.6. Trocar para Qwen3-Embedding-8B (4096) ou Cohere Embed v1 (1024) exigiria migração da coluna e dos índices HNSW |
| `AI_MONTHLY_BUDGET_USD` vs `organizations.ai_budget_usd` | O valor da organização prevalece; a env é o default de novas orgs **e** teto absoluto da plataforma | §3.4 e §6.2 definem ambos sem precedência |
| System User token | Por organização, cifrado em `meta_connections` (tela avançada), nunca em env | §5.2 |
| `comment_authors` sem `created_at`/`updated_at` | Sigo o DDL literal (é o normativo por coluna); `first_seen_at`/`last_seen_at` cobrem a necessidade | Preâmbulo de §6 contradiz o DDL de §6.4 |
| Idioma | pt-BR default, en como segundo, `next-intl`, strings externalizadas desde a Fase 1 | §11.5 |

---

## 2. Seção 3.4 — variáveis de ambiente: confirmação e complementos

A tabela do §3.4 é confirmada integralmente. Ela é, porém, **incompleta** para entregar as
fases que o próprio PRD define. Complementos necessários:

| Variável | Obrigatória | Por que falta |
| --- | --- | --- |
| `DATABASE_URL_MIGRATOR` | Sim | RLS (§4.1) é ignorada por superuser e pelo owner das tabelas. Migrations rodam com o owner; runtime roda com role sem `BYPASSRLS`. Sem essa separação o critério de aceite de isolamento multi-tenant (Apêndice B) é literalmente inverificável |
| `EMAIL_FROM` + `RESEND_API_KEY` ou `SMTP_URL` | Sim | Convites (§6.2, Fase 1), alerta de `needs_reauth` (§5.2), notificação de SLA (§7.7), alerta de anomalia por e-mail (§8.3), link de exportação (§8.7) |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Não | §3.1 exige Auth.js "com e-mail/senha **e Google**" |
| `OPENROUTER_APP_TITLE` | Não | §9.1 exige header `X-Title`. `HTTP-Referer` é derivado de `APP_URL`, não precisa de variável |
| `AI_EMBEDDING_DIMENSIONS` | Não | Default 1536, validado no boot contra a dimensão real da coluna. Falha explícita em vez de vetor truncado silenciosamente |
| `BACKFILL_DAYS` | Não | §5.8 diz "noventa dias (configurável)" |
| `RECONCILE_MAX_PAGES_PER_RUN` | Não | §5.8 exige interromper "após um número configurável de páginas" |
| `RETENTION_MONTHS_DEFAULT` | Não | §11.4, default 24; valor efetivo vive em `organizations.settings` |

`ENCRYPTION_KEY`: o ciphertext será gravado com prefixo de versão (`v1:<iv>:<tag>:<data>`).
Sem isso, rotacionar a chave exige recifrar tudo com downtime. Custo agora: zero.

---

## 3. Desvio proposto ao schema normativo (requer aprovação)

**Desnormalizar o resultado da IA em `comments`.** Colunas adicionais:

```
ai_analysis_id    uuid REFERENCES ai_analyses(id) ON DELETE SET NULL
ai_sentiment      sentiment_label
ai_intent         intent_label
ai_urgency        urgency_label
ai_confidence     numeric(4,3)
ai_is_toxic       boolean NOT NULL DEFAULT false
ai_is_spam        boolean NOT NULL DEFAULT false
ai_is_question    boolean NOT NULL DEFAULT false
primary_topic_id  uuid REFERENCES ai_topics(id) ON DELETE SET NULL
```

Mantidas transacionalmente pelo worker de IA na mesma transação que grava `ai_analyses`.

**Motivo:** §11.1 exige p95 abaixo de 300 ms com filtros sobre 1 milhão de registros por
organização, e §7.2 permite combinar sentimento, intenção, urgência, tópico, toxicidade e
spam com paginação keyset sobre `(published_at, id)`. Na forma normalizada isso exige juntar
`ai_analyses` — cuja unicidade é `(comment_id, prompt_version)`, logo é preciso um
`DISTINCT ON` para obter a análise vigente — e `comment_topics`, dentro da mesma query
paginada. Nenhum índice salva essa combinação; o planner perde o keyset e cai em sort.

É uma adição, não uma alteração: nenhum nome, tipo ou índice do §6 muda, e `ai_analyses`
continua a fonte da verdade e do histórico por `prompt_version`. **Não implemento sem
confirmação**, por ser mudança em seção NORMATIVO.

---

## 4. Achados de consistência no PRD

Tratamento definido para cada um. Nenhum bloqueia o início.

1. **`webhook_events UNIQUE (payload_hash, received_at)` não deduplica nada** — `received_at`
   tem `DEFAULT now()`, então reentregas do mesmo payload geram timestamps distintos e passam
   pela constraint. A idempotência real fica no job de ingestão, pela chave de §5.7
   (`platform` + `external_comment_id` + `verb` + hash). A constraint permanece como está
   (é normativa) mas não será tratada como proteção.
2. **`metrics_daily UNIQUE` com colunas nuláveis** — em Postgres NULLs são distintos em
   unique constraints, então linhas de rollup com `social_account_id`/`platform`/`source_type`
   nulos duplicam a cada execução do job de agregação. Uso `UNIQUE NULLS NOT DISTINCT`
   (disponível no PG16, que é a versão especificada). Mesmo tratamento em `topic_metrics_daily`
   se surgir agregado nulo.
3. **`urgency_score` decai com o tempo mas §6.8 só manda recalcular na conclusão da IA** — o
   termo `peso_tempo_espera` cresce até saturar em 5 horas. Recálculo periódico entra no job
   de 5 minutos do SLA (§7.7), em lote sobre comentários com status `new`/`in_progress`.
4. **Fase 4 entrega inbox "utilizável em produção" antes da IA existir (Fase 5)** — o score de
   urgência roda degradado na Fase 4, com os termos que não dependem de IA: visibilidade,
   mídia paga, tempo de espera, desconto de respondido. Os pesos de sentimento, intenção e
   toxicidade entram em zero e passam a contar na Fase 5, sem mudança de fórmula.
5. **PSID e IGSID são escopados por página/app** — o mesmo indivíduo comentando em duas páginas
   da mesma organização produz dois registros em `comment_authors`. O "histórico do autor na
   organização" de §7.1 é, na prática, histórico por conta conectada. Não há solução via API
   oficial; a interface rotula como tal em vez de somar números errados.
6. **Ausência na API ≠ exclusão** — §15 já reconhece que comentários de usuários restringidos e
   de mídia com restrição de idade não são retornados. Logo, marcar `deleted_on_platform` na
   primeira ausência produz falso positivo. Exijo duas reconciliações consecutivas com ausência.
7. **Anomalia de sentimento precisa de 4 semanas de base (§8.3)** — alertas suprimidos nos
   primeiros 14 dias de cada organização, com aviso na interface em vez de silêncio.
8. **SSE com múltiplas instâncias web (§7.6)** — o canal por organização precisa de fanout via
   Redis pub/sub; um `EventEmitter` em processo só funciona com uma instância.
9. **`source_type = 'story'` praticamente não terá comentários** — respostas a story são
   mensagens diretas, fora do escopo da v1 (§1.4). O valor fica no enum para a v1.1 e o
   agente não deve procurar endpoint de comentários de story.
10. **Resposta privada por Messenger tem janela limitada** — a política do Messenger restringe
    private replies a uma vez por comentário e a uma janela curta após o comentário. A verificar
    na documentação do Messenger na Fase 4; a interface desabilita a ação fora da janela em vez
    de deixar o usuário receber erro da API.

---

## 5. Seção 15 — limitações confirmadas, mais as que faltam

Confirmo as quatorze limitações do §15 e as trato como fatos, não como problemas a resolver.
Em particular: **não haverá botão de curtir em comentários do Instagram** e **não haverá
automação de navegador** para contornar nenhuma delas.

Limitações adicionais que entram na tabela do §15 e no README:

| Limitação | Consequência de produto |
| --- | --- |
| PSID/IGSID escopados por página ⇒ autor duplicado entre contas | Histórico do autor é por conta conectada, não por organização |
| Ausência de comentário na API tem múltiplas causas além de exclusão | `deleted_on_platform` só após duas ausências consecutivas |
| Webhook `feed` é pouco confiável para posts não publicados (dark posts) | A reconciliação sobre criativos de anúncios ativos é obrigatória, não otimização |
| Private reply do Messenger: uma vez por comentário, janela limitada | Ação desabilitada fora da janela, com explicação |
| Story não tem comentários (respostas são DM) | `source_type='story'` fica inativo na v1 |
| Sem `dimensions` no endpoint de embeddings do OpenRouter | O modelo de embeddings não é livremente trocável: precisa ter 1536 dimensões nativas |

---

## 6. Fases

### Fase 1 — Fundação

**Escopo.** Monorepo pnpm (`apps/web`, `apps/worker`, `packages/{db,meta-client,ai,core,shared}`),
TypeScript estrito, ESLint, Prettier. `docker-compose.yml` com PostgreSQL 16 (extensões
`pgcrypto`, `pg_trgm`, `vector`) e Redis 7. Pacote `db` com o schema completo do §6 traduzido
para Drizzle, migrations versionadas, RLS nas tabelas de comentários, posts e análises, e os
dois roles de banco. Validação de ambiente com Zod falhando no boot. Logger Pino com redação
automática por nome de campo (§11.3). Auth.js com e-mail/senha e Google, criação de organização,
convites por e-mail, papéis do §4.3. Seed da taxonomia do Apêndice A por organização criada.
i18n com strings externalizadas.

**Gate.** Usuário se cadastra, cria organização, convida colega, colega aceita e entra com o
papel correto. Teste automatizado de RLS: com o filtro de aplicação removido, uma sessão com
`app.current_org_id` da org A não lê nenhuma linha da org B. Teste de que nenhuma variável sem
`NEXT_PUBLIC_` é alcançável de componente de cliente.

**Risco.** Baixo. É o único ponto em que o schema pode ser revisado sem custo — a decisão da
Seção 3 deste plano precisa estar resolvida aqui.

---

### Fase 2 — Conexão com o Meta

**Escopo.** OAuth com Facebook Login for Business, `state` assinado com organização e nonce.
Troca de short-lived por long-lived user token. `GET /me/accounts` com o field expansion do
§5.2. Tela de seleção de páginas e contas Instagram vinculadas. Persistência com tokens cifrados
(AES-256-GCM com prefixo de versão). `POST /{page-id}/subscribed_apps` com
`subscribed_fields=feed,mention`. **Verificação da tarefa `MODERATE`** com bloqueio explícito da
moderação e aviso claro quando ausente (§5.3). Endpoint de webhook com HMAC-SHA256 em comparação
de tempo constante sobre o corpo bruto, 401 e registro de incidente em assinatura inválida,
persistência em `webhook_events` e enfileiramento — nada mais. Handshake `GET` com `hub.challenge`.
Job diário de `debug_token` marcando `needs_reauth` a menos de 10 dias da expiração. Tela de
gestão de conexões com estado de saúde.

**Gate.** Apêndice B, linhas "Conexão de conta" e "Validação de webhook". Verificável por
`GET /{page-id}/subscribed_apps`. Assinatura inválida ⇒ 401 e `signature_valid = false`;
assinatura válida ⇒ 200 em menos de 1 s.

**Risco alto — caminho crítico.** Depende de app no Meta App Dashboard em modo Live, Business
Verification concluída e Advanced Access para `pages_*`, `instagram_*` e os campos de webhook
`comments`/`live_comments`. Nada disso está sob controle do código. Ver Seção 7.

---

### Fase 3 — Ingestão

**Escopo.** `packages/meta-client` como único caminho para a Graph API: token bucket por
`page_id`, leitura de `X-App-Usage` e `X-Business-Use-Case-Usage` persistida em
`social_accounts.rate_limit_snapshot`, política de 75% / 90% / bloqueio do §5.6, backoff
exponencial com jitter em no máximo 5 tentativas, tratamento dos 11 códigos de erro da tabela
do §5.6, e batch via `POST /` acima de 10 operações homogêneas. Job de backfill com progresso em
`sync_jobs`. Job de webhook idempotente iterando `entry` e `changes` sem assumir cardinalidade
unitária, distinguindo `comments` de `live_comments`. Job de reconciliação a cada 30 min com
cursor persistido em `posts.next_cursor` e retomada entre execuções. Sincronização de anúncios
com resolução de `effective_object_story_id` e `effective_instagram_media_id`, marcando
`ads.comments_available = false` em degradação graciosa. Construção de threads
(`parent_comment_id`, `thread_root_id`, `depth`) com religação tardia de órfãos — na ingestão por
webhook a resposta chega antes do pai com frequência, e isso não pode falhar a inserção.
Vínculo de autores e `message_normalized`.

**Gate.** Apêndice B, linhas "Idempotência", "Backfill" e "Reconciliação". O teste de
idempotência é obrigatório (§13): o mesmo payload três vezes ⇒ exatamente um `comments` e um
`comment_events`. Mock MSW cobrindo paginação por cursor, cada código de erro do §5.6 e headers
de rate limit em vários níveis de saturação.

**Risco.** Médio-alto. É onde a cobertura de 99,5% é ganha ou perdida. Fixtures reais de payload
(FB `feed` com todos os verbos, IG `comments` com e sem `media.ad_id`, `live_comments`) são
pré-requisito, não complemento.

---

### Fase 4 — Inbox e moderação

**Escopo.** Layout de três colunas. Lista virtualizada (TanStack Virtual) com paginação keyset
sobre `(published_at, id)` — nunca `OFFSET`. As nove visões do sistema e visões salvas. Todos os
filtros do §7.2 refletidos na URL. Painel de detalhe com thread cronológica, contexto da
publicação ou do anúncio, e histórico do autor. Compositor com templates por atalho digitado,
variáveis dinâmicas, contagem de caracteres, e os três alertas pré-envio do §7.4 incluindo
indicador de presença de outro operador. Todas as ações do §7.3 no padrão
`comment_actions` + `idempotency_key` + otimista + reconciliação, com os `can_*` da API
governando disponibilidade. Ações em massa até 200 por chamada. Os onze atalhos de teclado do
§7.5. SSE em `/api/stream` com fanout por Redis pub/sub e faixa de notificação em vez de
reordenação sob o cursor. Cálculo de `sla_due_at` dentro da janela de atendimento e job de
5 minutos marcando `sla_breached` e recalculando `urgency_score`.

**Gate.** Apêndice B, linhas "Resposta pública", "Falha de ação", "Curtida" e "Desempenho da
inbox". O gate de desempenho exige base semeada com 1 milhão de comentários — o seed de carga é
entregável desta fase, não da Fase 8. Erro 190 apresentado como "A conexão com o Facebook
expirou. Reconecte a conta para continuar", nunca como `OAuthException`.

**Risco.** Médio. O alvo de p95 é o que decide a questão da Seção 3 deste plano.

---

### Fase 5 — Inteligência artificial

**Escopo.** `packages/ai` sobre `POST /api/v1/chat/completions` com `Authorization`,
`HTTP-Referer` e `X-Title`. Validação na configuração inicial via
`GET /models?supported_parameters=structured_outputs` e `provider: { require_parameters: true }`.
Os três mecanismos de confiabilidade do §9.1: `response_format` com `json_schema` e
`strict: true`, lista `models` de fallback, e validação Zod com um reprocessamento no modelo de
fallback antes de marcar `status = 'failed'` sem bloquear a fila. Inspeção de `finish_reason`,
reduzindo o lote em `length`. Prompt versionado em `packages/ai/prompts/classify.v1.ts` com
`prompt_version` persistido. Triagem determinística antes de qualquer token. Classificação em
lote de até 20 com o schema do §9.3 literal. Embeddings em `/api/v1/embeddings` para textos
acima de 40 caracteres, com batching por array. Registro em `ai_usage_log`, custo exato por
`GET /api/v1/generation`, pausa da fila no teto orçamentário sem interromper a ingestão. Exibição
e correção humana da análise. `pnpm eval:ai` com pelo menos 200 comentários rotulados.

**Gate.** Apêndice B, linhas "Classificação de IA" e "Orçamento de IA". `eval:ai` reportando
acurácia, matriz de confusão de sentimento e concordância de intenção, com as metas do §1.3:
acima de 85% em sentimento e 75% em motivo. Custo abaixo de US$ 0,50 por mil comentários,
medido, não estimado.

**Risco.** Médio. As metas de qualidade em português informal com ironia são as mais incertas do
PRD. `eval:ai` roda antes de qualquer alteração em `prompts/` (§13) e é o que decide troca de
modelo — não impressão subjetiva.

---

### Fase 6 — Tópicos e analytics

**Escopo.** Descoberta diária por vizinho mais próximo em cosseno sobre os embeddings, clusters
com mínimo de 10 elementos, nomeação pelo modelo de raciocínio, centroides em
`ai_topics.centroid`, sugestão de mesclagem acima do limiar de sobreposição. Gestão da taxonomia:
renomear, mesclar, dividir, marcar como gerenciado, criar manualmente. Jobs de agregação diária
em `metrics_daily` e `topic_metrics_daily`. As sete telas do §8, todas com navegação cruzada para
a inbox com filtros aplicados. Exportação CSV e XLSX, e exportação de até 50 mil comentários em
background com link temporário.

**Gate.** Apêndice B, linhas "Descoberta de tópicos" e "Dashboard de motivos". A contagem exibida
no gráfico tem de coincidir com a contagem da inbox filtrada — divergência entre agregado e
detalhe é o defeito mais comum e mais corrosivo de credibilidade nesta categoria de produto.
Nomes de cluster descrevem motivo, não sentimento ("atraso na entrega", não "cliente irritado").

**Risco.** Médio. Fragmentação de tópicos nas primeiras semanas é o modo de falha esperado; o
seed do Apêndice A existe justamente para isso.

---

### Fase 7 — Automação e refinamento

**Escopo.** Avaliador de `conditions` com `all`/`any` no contrato do §9.7, construtor de regras na
interface, execução registrando `source = 'automation'` com distinção visual. Sugestão de resposta
com as quatro proibições explícitas do §9.5 e sem sugestão automática em urgência crítica.
Detecção de anomalia do §8.3 com supressão nos primeiros 14 dias. Busca semântica por cosseno como
alternância na interface. Painel administrativo de filas, rate limit por página, taxa de sucesso de
IA, custo do mês, webhooks por hora e conexões em `needs_reauth`. Trilha de auditoria. Dead-letter
queue com reprocessamento manual (§11.2). Os seis alertas obrigatórios do §14.

**Gate.** Regra de exemplo do §9.7 executando ponta a ponta: comentário tóxico com confiança acima
de 0,8 em anúncio ⇒ ocultado, status `resolved`, etiquetado e managers notificados, com a ação
distinguível de ação humana na interface.

**Risco.** Baixo-médio. A restrição de não haver resposta automática sem revisão humana na v1
(§9.7) é decisão de produto e não será relaxada.

---

### Fase 8 — Preparação para produção

**Escopo.** E2E Playwright dos dois fluxos do §13. Hardening: CSP, HSTS, X-Frame-Options,
Referrer-Policy, rate limiting por usuário e organização. Retenção e anonimização com default de
24 meses, exclusão por solicitação do titular e remoção de organização em até 30 dias (§11.4).
`deauthorize_callback_url` e `data_deletion_request_url` funcionais. Auditoria de acessibilidade
WCAG 2.1 AA. Documentação de deploy. `docs/app-review.md` finalizado.

**Gate.** Apêndice B, linha "Isolamento multi-tenant": manipular IDs de outra organização retorna
404 e a RLS impede a leitura mesmo com o filtro de aplicação removido. Checklist do Apêndice C
completo.

---

## 7. Workstream paralelo — App Review

O Apêndice C afirma que o App Review é o caminho crítico, e é. Consequências para o cronograma:

- **Business Verification abre no dia 1**, não na Fase 8. Sem ela não há webhook entregue.
- Sem Advanced Access, as permissões `pages_*` e `instagram_*` só funcionam em ativos onde o
  desenvolvedor tem papel. Todo o desenvolvimento das Fases 2 a 7 roda contra **página do
  Facebook e conta profissional do Instagram próprias**, com a conta IG pública (§5.1).
- `docs/app-review.md` nasce na Fase 2 como documento vivo, com a justificativa de cada
  permissão escrita no momento em que ela passa a ser usada — reconstruir isso no fim é o que
  faz submissões falharem.
- Item de reprovação comum a tratar explicitamente: demonstrar que `ads_management` serve
  **apenas** à moderação de comentários em anúncios, nunca à gestão de campanhas.

---

## 8. Decisões resolvidas

1. **Desnormalização da Seção 3 — APROVADA.** Delegada a mim; implemento as nove colunas
   aditivas em `comments`, mantidas na mesma transação que grava `ai_analyses`, que continua a
   fonte da verdade e o histórico por `prompt_version`. Registro em `docs/desvios-prd.md` como
   único desvio consciente ao §6.
2. **E-mail: Resend.** `RESEND_API_KEY` + `EMAIL_FROM` obrigatórios. Adapter atrás de uma
   interface `EmailSender` em `packages/shared` — trocar por SMTP depois não toca em call site.
3. **Um único app do Meta cobre Facebook, Instagram e Ads.** Mas serão **dois apps**: dev e
   produção, porque modo Live, Business Verification, App Review e callback URL de webhook são
   todos por app. `META_APP_ID` e `META_APP_SECRET` diferem por ambiente.

### Ainda pendente (bloqueia a Fase 2, não a Fase 1)

Existe app criado no App Dashboard? Business Verification aberta? Existe página do Facebook e
conta profissional do Instagram **pública** (§5.1) onde você é administrador, para
desenvolvimento? Sem esses ativos a Fase 2 só é validável com mocks, e a Business Verification
precisa abrir agora — é o item de maior lead time do projeto.

---

## 9. Consequências de hospedar no Railway

Favorável ao desenho: os três processos do §3.2 são de longa duração, o que o Railway atende
nativamente. Pontos que mudam:

| Tema | Consequência |
| --- | --- |
| Topologia | Três serviços no mesmo projeto (`web`, `worker`, `scheduler`) mais Postgres e Redis, comunicando por rede privada. O `docker-compose.yml` do §3.3 fica só para desenvolvimento local |
| `vector` | A imagem Postgres padrão do Railway **não** garante pgvector. Provisionar explicitamente uma imagem com a extensão e validar `CREATE EXTENSION vector` na primeira migration, falhando alto se ausente |
| Roles de RLS | O Postgres do Railway entrega um superuser. O role de aplicação sem `BYPASSRLS` é criado por migration, e `DATABASE_URL` do runtime aponta para ele — não para o superuser |
| Monorepo | Cada serviço precisa de build e start próprios via `pnpm --filter`, com watch paths para não redeployar o worker quando só a UI muda |
| SSE | Funciona sem ressalva. Sem timeout de função, ao contrário de deploy serverless |
| Scheduler | Repeatable jobs do BullMQ em processo dedicado. Não usar cron do Railway, que dispararia contêiner novo sem acesso ao estado das filas |
| Backup | Postgres gerenciado do Railway tem backup próprio, mas a retenção do §11.4 e a exclusão de organização em 30 dias são responsabilidade da aplicação, não do provedor |
