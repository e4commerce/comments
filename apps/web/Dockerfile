# Imagem do serviço web.
#
# Mesmo motivo do Dockerfile do worker: o builder automático erra em monorepo pnpm, e a falha
# aparece como módulo não encontrado em runtime, longe da causa.
#
# Diferente do worker, aqui o Next COMPILA (`next build`), então a imagem final não precisa de
# devDependencies nem do código-fonte — só do `.next` e das dependências de produção.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
ENV CI=true

# ---------------------------------------------------------------------------
# Dependências (inclui dev, necessárias para compilar)
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --filter @pulse/web...

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM deps AS builder
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/web ./apps/web

# O `next build` avalia módulos de servidor, e alguns chamam getEnv() no topo. Estes valores
# são de BUILD, descartados na imagem final: os reais vêm do ambiente do serviço em runtime.
# Sem eles a validação do §3.4 derrubaria o build — que é o comportamento correto, só não
# aqui.
ENV NODE_ENV=production \
    APP_URL=https://build.invalid \
    AUTH_SECRET=build-time-placeholder-com-32-caracteres-ok \
    ENCRYPTION_KEY=YnVpbGQtdGltZS1wbGFjZWhvbGRlci0zMmJ5dGVzIQ== \
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    REDIS_URL=redis://127.0.0.1:6379

RUN pnpm --filter @pulse/web build

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/web ./apps/web
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/.npmrc ./

USER node
EXPOSE 3000

CMD ["pnpm", "--filter", "@pulse/web", "start"]
