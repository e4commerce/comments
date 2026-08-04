/**
 * Orquestrador de migrations.
 *
 * Roda em três etapas, nesta ordem, e a ordem importa:
 *
 *   1. sql/00-bootstrap.sql   extensões e app_current_org(). Precisa vir primeiro porque
 *                             o DDL gerado usa `vector` e `gin_trgm_ops`.
 *   2. drizzle/*.sql          migrations geradas por `pnpm db:generate`.
 *   3. sql/99-rls.sql         FKs adiadas, privilégios e políticas de RLS. Precisa vir por
 *                             último porque opera sobre tabelas que a etapa 2 cria.
 *
 * As etapas 1 e 3 são idempotentes por construção; a 2 é controlada pelo journal do
 * drizzle-kit. Rodar duas vezes é seguro.
 *
 * Usa DATABASE_URL_MIGRATOR (role dono das tabelas). `pulse_app` não tem privilégio de
 * DDL, e isso é intencional: ver §4.1 do PRD.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@pulse/shared/logger';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const log = createLogger('db:migrate');
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

async function runSqlFile(client: postgres.Sql, relativePath: string): Promise<void> {
  const path = join(packageRoot, relativePath);
  const contents = await readFile(path, 'utf8');
  log.info({ file: relativePath }, 'aplicando SQL');
  // `simple()` permite múltiplos statements e blocos DO$$ no mesmo arquivo, que o
  // protocolo estendido rejeitaria.
  await client.unsafe(contents).simple();
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_MIGRATOR ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'Defina DATABASE_URL_MIGRATOR com o role dono das tabelas (pulse_owner). ' +
        'DATABASE_URL aponta para pulse_app, que deliberadamente não tem privilégio de DDL.',
    );
  }

  if (process.env.DATABASE_URL_MIGRATOR === undefined) {
    log.warn(
      'DATABASE_URL_MIGRATOR ausente; usando DATABASE_URL. Isso funciona em ' +
        'desenvolvimento, mas em produção significa que a aplicação tem privilégio de DDL.',
    );
  }

  const client = postgres(url, {
    max: 1,
    // Os NOTICE de "policy does not exist, skipping" vêm dos DROP POLICY IF EXISTS que
    // tornam 99-rls.sql idempotente, e são dezenas na primeira execução. WARNING e acima
    // continuam visíveis — inclusive o aviso de role pulse_app ausente, que importa.
    onnotice: (notice) => log.debug({ notice }, 'postgres'),
  });

  try {
    await client.unsafe(`SET client_min_messages = warning`);
    await runSqlFile(client, 'sql/00-bootstrap.sql');

    log.info('aplicando migrations do drizzle');
    await migrate(drizzle(client), { migrationsFolder: join(packageRoot, 'drizzle') });

    await runSqlFile(client, 'sql/99-rls.sql');

    log.info('migrations concluídas');
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  log.error({ err: error }, 'migration falhou');
  process.exit(1);
});
