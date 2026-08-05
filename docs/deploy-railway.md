# Railway — provisionamento e deploy

O Pulse roda como **três serviços** mais **dois bancos** no mesmo projeto Railway:

| Serviço | O que é | Config |
| --- | --- | --- |
| `web` | Next.js: interface, API e endpoint de webhook | **ainda não existe** (resto da Fase 1) |
| `worker` | Consumidores BullMQ. Todo acesso à Graph API e ao OpenRouter passa aqui | `railway.worker.json` |
| `scheduler` | Jobs recorrentes (reconciliação, tokens, agregação, tópicos, SLA) | `railway.scheduler.json` |
| `postgres` | PostgreSQL com pgvector | serviço gerenciado |
| `redis` | Redis com `maxmemory-policy noeviction` | serviço gerenciado |

A separação vem do §3.2 do PRD e não é opcional: os limites da Graph API são por página e por
conta de anúncios, e o controle de concorrência precisa ser global, não por instância de
request.

---

## 1. Por que o build falha sem configuração

O builder automático do Railway (Railpack) detecta o workspace pnpm, mas **não tem como
adivinhar qual app de um monorepo iniciar**, e falha com:

```
✖ No start command detected. Specify a start command
```

O Railway também **só detecta Dockerfile na raiz do repositório**. O Dockerfile do worker está
em `apps/worker/Dockerfile`, então não é encontrado sozinho.

Não adicionamos um script `start` na raiz de propósito: ele teria que escolher entre web e
worker arbitrariamente, e mascararia o problema real em vez de resolvê-lo. Cada serviço declara
o que executa.

### Sobre watchPatterns: removido de propósito

Os `railway.*.json` **não declaram `watchPatterns`**, e isso é decisão, não esquecimento.

Com eles configurados, o Railway marcava commits como **`skipped`** — nenhum arquivo alterado
casava com os padrões, e o deploy simplesmente não acontecia. Duas causas se somaram: o próprio
arquivo de config não constava nos seus padrões (então mudar a configuração de deploy não
disparava deploy), e a sintaxe de glob do Railway parece exigir barra inicial (`/packages/**`),
o que não é verificável de fora da plataforma.

O ganho de watchPatterns é modesto: evitar que uma mudança só na interface redeploye o worker.
O custo, quando erra, é deploy que nunca acontece e ninguém entende por quê. Para um projeto
neste estágio, redeployar os três serviços a cada commit é a troca certa.

Se quiser reintroduzir mais adiante, faça pela UI do Railway em Settings → Build → Watch Paths,
onde o efeito é visível imediatamente, em vez de por arquivo que só falha no próximo push.

### Como apontar cada serviço para sua config

Em **cada** serviço, defina a variável:

| Serviço | Variável | Valor |
| --- | --- | --- |
| `worker` | `RAILWAY_CONFIG_FILE` | `railway.worker.json` |
| `scheduler` | `RAILWAY_CONFIG_FILE` | `railway.scheduler.json` |

Alternativa pela UI, se preferir não usar arquivo de config: em Settings → Build, defina
**Dockerfile Path** como `apps/worker/Dockerfile`, e em Settings → Deploy defina o
**Custom Start Command** (`pnpm --filter @pulse/worker start` ou `... scheduler`). O efeito é o
mesmo; o arquivo tem a vantagem de ficar versionado.

---

## 2. Postgres: verifique pgvector

O §3.1 exige a extensão `vector`. **Verificado em 04/08/2026: o Postgres padrão do Railway
oferece pgvector 0.8.6, `pg_trgm` 1.6 e `pgcrypto` 1.4** — não é preciso imagem customizada.

Não é preciso confiar nessa nota: `sql/00-bootstrap.sql` roda `CREATE EXTENSION vector` e, se
falhar, aborta a migration com mensagem explícita. Melhor descobrir aqui do que na Fase 6, com
dados em produção.

O Railway provisiona PostgreSQL 18, não 16 como o §3.1 especifica. Aceito e registrado em
`docs/desvios-prd.md`.

### Redis

Verificado: o Railway já entrega `maxmemory-policy=noeviction`, que é o que o BullMQ exige. Com
qualquer política de eviction o Redis descarta chaves sob pressão de memória — e as chaves
descartadas são os jobs. A fila perderia trabalho sem erro, o pior modo de falha possível para
ingestão, porque webhook perdido não pode ser reconsultado (§5.7).

`assertRedisReady()` confere isso no boot do worker, e não apenas com `PING`: PING passa nesse
cenário.

---

## 3. Criar o role de runtime (uma vez por banco)

O Railway entrega o banco com o superuser `postgres`. Rodar a aplicação com ele significaria
**RLS ignorada**, porque no Postgres o dono das tabelas não é sujeito a políticas — e a segunda
camada de isolamento do §4.1 deixaria de existir.

```bash
export PULSE_APP_PASSWORD="$(openssl rand -base64 24)"
echo "guarde esta senha: $PULSE_APP_PASSWORD"

DATABASE_URL_MIGRATOR="postgresql://postgres:SENHA@HOST_PUBLICO:PORTA/railway" \
  pnpm --filter @pulse/db setup:roles
```

Idempotente. Cria `pulse_app` com `NOBYPASSRLS`, `NOSUPERUSER`, `NOCREATEDB` e `NOCREATEROLE`,
concede `CONNECT` e `USAGE`, e revoga `CREATE` no schema `public`.

---

## 4. Aplicar migrations

```bash
DATABASE_URL_MIGRATOR="postgresql://postgres:SENHA@HOST_PUBLICO:PORTA/railway" \
  pnpm db:migrate
```

Três etapas, nesta ordem: extensões e `app_current_org()`, migrations do drizzle-kit, depois
foreign keys adiadas, privilégios de `pulse_app` e políticas de RLS. Rodar duas vezes é seguro.

Migrations rodam **da sua máquina**, com o proxy público, e não de dentro de um serviço. É o que
mantém a credencial de DDL fora dos containers.

---

## 5. Variáveis por serviço

Troque `Postgres` e `Redis` pelos nomes reais dos seus serviços nas referências.

| Variável | Valor |
| --- | --- |
| `RAILWAY_CONFIG_FILE` | `railway.worker.json` ou `railway.scheduler.json` |
| `DATABASE_URL` | `postgresql://pulse_app:SENHA@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/railway` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `APP_URL` | `https://SEU-DOMINIO` |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `META_GRAPH_VERSION` | `v26.0` |
| `NODE_ENV` | `production` |
| `LOG_LEVEL` | `info` |
| `META_APP_ID` | `placeholder-nao-configurado` até a Fase 2 |
| `META_APP_SECRET` | idem |
| `META_WEBHOOK_VERIFY_TOKEN` | idem |
| `OPENROUTER_API_KEY` | idem |
| `OPENROUTER_MODEL_PRIMARY` | `google/gemini-2.5-flash` |
| `RESEND_API_KEY` | idem |
| `EMAIL_FROM` | `Pulse <nao-responda@seudominio.com.br>` |

### O que NÃO definir nos serviços

**`DATABASE_URL_MIGRATOR`** — é a credencial do superuser, com privilégio de DDL. Só deve
existir no ambiente de quem roda migrations. Colocá-la no container daria à aplicação poder de
alterar schema, que é exatamente o que a separação de roles evita.

**`PULSE_APP_PASSWORD`** — a aplicação não usa; serve para reexecutar `setup:roles`.

### IPv6

A rede privada do Railway é IPv6-only. O ioredis tem `family: 4` como default, então conectar
pelo domínio interno falharia com `ENOTFOUND` enquanto o proxy público funciona — sintoma que
sugere credencial errada quando é resolução de nome. `apps/worker/src/redis.ts` usa `family: 0`
por isso. O `postgres.js` não precisa de ajuste: o Node 20+ faz Happy Eyeballs por padrão.

### `ENCRYPTION_KEY` está atrelada aos dados

Ela cifra os tokens do Meta em `access_token_encrypted`. Se dois ambientes apontarem para o
mesmo banco com chaves diferentes, os tokens gravados de um lado não descriptografam do outro.
A partir da Fase 2, chave e banco andam juntos — o que é mais um argumento para banco separado
entre desenvolvimento e produção.

---

## 6. Observações operacionais

**Scheduler.** Os jobs recorrentes são `repeatable jobs` do BullMQ em um processo dedicado, não
cron do Railway. Um cron dispararia um container novo, sem acesso ao estado das filas.

**Jobs sem processador.** Até a Fase 2 nenhum processador está registrado. O scheduler
registraria agendamentos que disparam a cada 5 e 30 minutos e falham com mensagem explícita,
acumulando trabalho morto. Use `pnpm --filter @pulse/worker queues:unschedule` para limpar, ou
não suba o serviço `scheduler` ainda.

**SSE.** O `/api/stream` do §7.6 funciona sem ressalva aqui, por serem processos de longa
duração — em deploy serverless o timeout de função quebraria o canal. O fanout entre instâncias
do `web` é via Redis pub/sub; sem isso, um evento só alcançaria os clientes conectados à
instância que o publicou.

**Backup e retenção.** O Postgres gerenciado tem backup próprio, mas a retenção de 24 meses, a
anonimização por solicitação do titular e a exclusão de organização em até 30 dias (§11.4) são
responsabilidade da aplicação, não do provedor.

**Webhook.** O `deauthorize_callback_url` e o `data_deletion_request_url` exigidos pelo App
Review (§11.4) precisam estar acessíveis no domínio público antes da submissão.
