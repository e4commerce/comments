# Imagem do worker e do scheduler — os dois rodam o mesmo código, com comandos diferentes.
#
# Existe um Dockerfile em vez de deixar o builder automático do Railway inferir porque em
# monorepo pnpm a inferência erra: ela tende a instalar só a raiz ou a ignorar as
# dependências `workspace:*`, e o erro aparece como módulo não encontrado em runtime, longe
# da causa.
#
# Não compilamos TypeScript para JS: a execução é via tsx. Por isso a imagem final mantém as
# devDependencies. Em troca, `pnpm build` roda `tsc --noEmit`, então erro de tipo derruba o
# build em vez de chegar em produção.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
ENV CI=true

# ---------------------------------------------------------------------------
# Dependências. Copiamos apenas os manifests primeiro, para que a camada de install seja
# reaproveitada quando só o código-fonte muda.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY apps/worker/package.json ./apps/worker/
RUN pnpm install --frozen-lockfile --filter @pulse/worker...

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/worker ./apps/worker

# Falha o build em erro de tipo. Barato e evita subir código quebrado.
RUN pnpm --filter @pulse/worker build

# O usuário `node` já existe na imagem oficial. Rodar como root em container que fala com
# banco de produção não tem justificativa.
USER node

# Sobrescrito no serviço `scheduler` para `pnpm --filter @pulse/worker scheduler`.
CMD ["pnpm", "--filter", "@pulse/worker", "start"]
