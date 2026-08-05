# Pulse

Plataforma de gestão e inteligência de comentários de Facebook e Instagram: ingestão em tempo
real de comentários orgânicos e de anúncios, central de moderação com SLA e atribuição, e
análise de volumetria, sentimento e motivos sobre o corpus completo.

Plano de execução por fases: [`docs/PLANO_EXECUCAO.md`](docs/PLANO_EXECUCAO.md).

> O PRD v1.0, que é a especificação normativa referenciada por todo o código (as citações do
> tipo "§5.6" apontam para ele), **ainda não está no repositório**. Copie
> `PRD_Pulse_Gestao_Comentarios_Meta.md` para `docs/PRD.md` — sem ele as referências nos
> comentários de código ficam sem destino.

## Estado atual

**Fase 1 (Fundação) concluída.** Cadastro, login por e-mail/senha e Google, criação de
organização, convites por e-mail com papéis, schema completo do §6 com Row Level Security,
taxonomia inicial de motivos, filas BullMQ e scheduler. 69 testes.

**Fase 2 (Conexão com o Meta) bloqueada por processo externo**, não por código: exige app no
Meta App Dashboard em modo Live, Business Verification concluída e Advanced Access para as
permissões de páginas e Instagram. Sem isso não há como ingerir um comentário real, e a
verificação de negócio no Meta leva semanas. Ver `docs/PLANO_EXECUCAO.md`, Seção 7.

## Arquitetura

Três processos, e a separação não é organizacional:

| Processo | Papel |
| --- | --- |
| `apps/web` | Interface, API e endpoint de webhook. Responde ao Meta em menos de 5 s fazendo só três coisas: valida a assinatura HMAC, grava o payload bruto e enfileira |
| `apps/worker` | Consome as filas. **Concentra toda** interação com a Graph API e o OpenRouter |
| `apps/worker` (scheduler) | Jobs recorrentes: reconciliação, tokens, agregação, tópicos, SLA |

O worker é o único a falar com a Graph API porque os limites são por página e por conta de
anúncios: se o `web` também chamasse, cada instância teria seu próprio token bucket e o limite
seria estourado.

| Pacote | Conteúdo |
| --- | --- |
| `packages/db` | Schema Drizzle, migrations, RLS, seeds |
| `packages/shared` | Ambiente, logger, e-mail, matriz de permissões |
| `apps/web` | Next.js: autenticação, organizações, equipe |
| `packages/meta-client` | Cliente Graph API com rate limit (Fase 3) |
| `packages/ai` | OpenRouter, prompts versionados, schemas (Fase 5) |
| `packages/core` | Urgência, SLA, regras de domínio (Fase 4) |

## Desenvolvimento

Requer Node 22+ e pnpm 9 (via corepack). O banco pode ser local via Docker ou um Postgres
gerenciado — ver [`docs/deploy-railway.md`](docs/deploy-railway.md).

```bash
pnpm install
cp .env.example .env          # preencha; o boot falha se faltar variável obrigatória
pnpm infra:up                 # postgres + redis locais (opcional)

# uma vez por banco, em Postgres gerenciado:
PULSE_APP_PASSWORD="$(openssl rand -base64 24)" pnpm --filter @pulse/db setup:roles

pnpm db:migrate               # extensões, schema, RLS
pnpm --filter @pulse/worker queues:check    # valida Postgres e Redis
pnpm test
```

### Os dois roles de banco

`DATABASE_URL` aponta para `pulse_app` (runtime, sem `BYPASSRLS`); `DATABASE_URL_MIGRATOR`
para o dono das tabelas. Não é burocracia: no Postgres o dono de uma tabela **ignora Row Level
Security por padrão**, então rodar a aplicação com ele tornaria a segunda camada de isolamento
decorativa. `DATABASE_URL_MIGRATOR` não deve existir nos containers de aplicação.

Todo acesso a dado operacional passa por `withOrg(organizationId, fn)`. Consultar `comments`
fora dele retorna zero linhas em vez de vazar entre clientes — o sistema falha fechado.

## Limitações reais das APIs do Meta

Estas não têm solução via API oficial e **não devem ser contornadas com automação de
navegador**. A lista completa está no §15 do PRD; as que mudam o produto:

- **O Instagram não oferece endpoint para curtir comentários.** O botão de curtir não existe
  em comentários do Instagram — ausente, não desabilitado.
- **O campo `username` de quem comentou em mídia do Instagram só é retornado com a permissão
  `instagram_manage_comments` concedida** (desde 27/08/2024). Sem ela a interface exibiria
  comentários anônimos.
- **IDs de comentário em posts de página só são retornados a aplicações com a tarefa
  `MODERATE`** na página (desde a v11.0). Sem ela não há moderação, e o sistema avisa no
  fluxo de conexão em vez de falhar depois.
- **Não é possível consultar histórico de notificações de webhook.** O que não for capturado
  está perdido, e é por isso que persistir o payload bruto é obrigatório e a reconciliação é
  essencial, não otimização.
- **No Instagram, só o dono do objeto pode excluir comentários**, mesmo que o solicitante seja
  o autor. Falha de exclusão é esperada em alguns casos.
- **Comentários ocultos do próprio dono da mídia permanecem visíveis** no Instagram.
- **Comentários em vídeo ao vivo só são legíveis durante a transmissão.**
- **PSID e IGSID são escopados por página**, então o mesmo indivíduo comentando em duas
  páginas gera dois registros de autor. O histórico do autor é por conta conectada, não por
  organização.
- **Alguns dark posts não retornam comentários** mesmo com os metadados do criativo visíveis.
  O ativo é marcado `comments_available = false` e o usuário é informado.

## Desvios em relação ao PRD

Estão registrados em [`docs/desvios-prd.md`](docs/desvios-prd.md), com justificativa. Os de
maior impacto: nove colunas de resultado de IA desnormalizadas em `comments` (necessárias para
o alvo de p95 do §11.1), PostgreSQL 18 em vez de 16 (paridade com o Railway) e Graph API v26.0
em vez de v23.0.

## Testes

```bash
pnpm test                     # tudo
SKIP_DB_TESTS=1 pnpm test     # pula o que exige Postgres
```

Os testes de banco são pulados com aviso quando `DATABASE_URL` está inacessível, em vez de
falhar — teste de infraestrutura não deve quebrar quem está mexendo em outra parte do código.
