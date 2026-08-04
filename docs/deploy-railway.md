# Railway — provisionamento e deploy

O Pulse roda como **três serviços** mais **dois bancos** no mesmo projeto Railway:

| Serviço | O que é | Start |
| --- | --- | --- |
| `web` | Next.js: interface, API e endpoint de webhook | `pnpm --filter @pulse/web start` |
| `worker` | Consumidores BullMQ. Todo acesso à Graph API e ao OpenRouter passa aqui | `pnpm --filter @pulse/worker start` |
| `scheduler` | Jobs recorrentes (reconciliação, tokens, agregação, tópicos) | `pnpm --filter @pulse/worker scheduler` |
| `postgres` | PostgreSQL 16 **com pgvector** | serviço gerenciado |
| `redis` | Redis 7 com `maxmemory-policy noeviction` | serviço gerenciado |

A separação vem do §3.2 do PRD e não é opcional: os limites da Graph API são por página e por
conta de anúncios, e o controle de concorrência precisa ser global, não por instância de
request.

---

## 1. Postgres: use uma imagem com pgvector

**Este é o único passo do provisionamento que pode dar errado em silêncio.** O §3.1 exige a
extensão `vector`, e o template Postgres padrão do Railway não garante que ela esteja
disponível. Duas formas de acertar:

- **Preferida:** criar o serviço a partir da imagem Docker `pgvector/pgvector:pg16`. É a
  mesma imagem do `docker-compose.yml`, o que dá paridade exata entre desenvolvimento e
  produção.
- Alternativa: usar um template do Railway que declare pgvector.

Não é preciso adivinhar se deu certo: `sql/00-bootstrap.sql` roda `CREATE EXTENSION vector`
e, se falhar, aborta a migration com mensagem explícita apontando para este arquivo. Melhor
descobrir aqui do que na Fase 6, com dados em produção.

### Redis

Ao criar o serviço, defina a política de memória:

```
maxmemory-policy noeviction
```

Com LRU o Redis descartaria jobs da fila silenciosamente sob pressão de memória. O BullMQ
exige `noeviction`.

---

## 2. Criar o role de runtime (uma vez por banco)

O Railway entrega o banco com o superuser `postgres`. Rodar a aplicação com ele significaria
**RLS ignorada**, porque no Postgres o dono das tabelas não é sujeito a políticas — e a
segunda camada de isolamento do §4.1 deixaria de existir.

```bash
export PULSE_APP_PASSWORD="$(openssl rand -base64 24)"
echo "guarde esta senha: $PULSE_APP_PASSWORD"

DATABASE_URL_MIGRATOR="postgresql://postgres:SENHA@HOST:PORTA/railway" \
  pnpm --filter @pulse/db setup:roles
```

O script é idempotente. Ele cria `pulse_app` com `NOBYPASSRLS`, `NOSUPERUSER`, `NOCREATEDB` e
`NOCREATEROLE`, concede `CONNECT` e `USAGE`, e revoga `CREATE` no schema `public`.

---

## 3. Aplicar migrations

```bash
DATABASE_URL_MIGRATOR="postgresql://postgres:SENHA@HOST:PORTA/railway" \
  pnpm db:migrate
```

Três etapas, nesta ordem: extensões e `app_current_org()`, migrations do drizzle-kit, depois
foreign keys adiadas, privilégios de `pulse_app` e políticas de RLS. Rodar duas vezes é
seguro.

---

## 4. Variáveis por serviço

Todos os três serviços recebem o `.env` completo (ver `.env.example`), com estas diferenças:

| Variável | Valor |
| --- | --- |
| `DATABASE_URL` | `postgresql://pulse_app:$PULSE_APP_PASSWORD@<host-interno>:5432/railway` — **role de runtime, não o superuser** |
| `DATABASE_URL_MIGRATOR` | **Não definir nos serviços.** Só no ambiente de quem roda migrations. Deixá-la nos containers colocaria credencial de DDL na aplicação |
| `REDIS_URL` | referência interna ao serviço Redis |
| `APP_URL` | domínio público do serviço `web`, com **https** — `env.ts` rejeita http em produção, porque o callback do OAuth do Meta e os cookies de sessão exigem origem segura |
| `NODE_ENV` | `production` |

Use a **rede privada** do Railway para Postgres e Redis. Expor o banco publicamente só faz
sentido durante o desenvolvimento, para rodar migrations e testes da máquina local.

---

## 5. Build de monorepo

Cada serviço precisa de build e start próprios. Configure em cada um:

```
Install:  pnpm install --frozen-lockfile
Build:    pnpm --filter @pulse/web build      # ou @pulse/worker
Start:    pnpm --filter @pulse/web start
```

Defina **watch paths** por serviço para que uma mudança só na interface não redeploye o
worker, e vice-versa. Sem isso, cada commit reinicia as filas.

---

## 6. Observações operacionais

**Scheduler.** Os jobs recorrentes são `repeatable jobs` do BullMQ em um processo dedicado,
não cron do Railway. Um cron dispararia um container novo sem acesso ao estado das filas.

**SSE.** O `/api/stream` do §7.6 funciona sem ressalva aqui, por serem processos de longa
duração — em deploy serverless o timeout de função quebraria o canal. O fanout entre
instâncias do `web` é via Redis pub/sub; sem isso, um evento só alcançaria os clientes
conectados à instância que o publicou.

**Backup e retenção.** O Postgres gerenciado do Railway tem backup próprio, mas a política de
retenção de 24 meses, a anonimização por solicitação do titular e a exclusão de organização
em até 30 dias (§11.4) são responsabilidade da aplicação, não do provedor.

**Webhook.** O `deauthorize_callback_url` e o `data_deletion_request_url` exigidos pelo App
Review (§11.4) precisam estar acessíveis no domínio público antes da submissão.
