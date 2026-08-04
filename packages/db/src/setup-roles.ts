/**
 * Cria o role de runtime `pulse_app` em um Postgres já provisionado.
 *
 * Existe para bancos gerenciados (Railway, RDS, Neon), onde não há como rodar o
 * `docker-entrypoint-initdb.d/01-roles.sql` do compose. Conecte com o superuser e rode
 * uma única vez por banco:
 *
 *   PULSE_APP_PASSWORD="$(openssl rand -base64 24)" \
 *   DATABASE_URL_MIGRATOR="postgresql://postgres:...@host:port/railway" \
 *   pnpm --filter @pulse/db setup:roles
 *
 * Idempotente: rodar de novo ajusta a senha e os atributos sem recriar nada.
 *
 * Por que isso importa e não é burocracia: sem `pulse_app`, `DATABASE_URL` aponta para o
 * dono das tabelas, e no Postgres o dono ignora Row Level Security por padrão. A segunda
 * camada de isolamento do §4.1 do PRD deixaria de existir, e o critério de aceite
 * "a política de RLS impede a leitura mesmo com filtro de aplicação removido"
 * (Apêndice B) passaria a ser impossível de satisfazer.
 */

import { createLogger } from '@pulse/shared/logger';
import postgres from 'postgres';

const log = createLogger('db:setup-roles');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_MIGRATOR;
  const password = process.env.PULSE_APP_PASSWORD;

  if (!url) {
    throw new Error(
      'DATABASE_URL_MIGRATOR ausente. Use a string de conexão do superuser do banco ' +
        '(no Railway, o usuário `postgres`).',
    );
  }
  if (!password || password.length < 16) {
    throw new Error(
      'PULSE_APP_PASSWORD ausente ou curta (mínimo 16 caracteres). ' +
        'Gere com: openssl rand -base64 24',
    );
  }

  const client = postgres(url, { max: 1 });

  try {
    const [db] = await client<{ current_database: string }[]>`SELECT current_database()`;
    const database = db?.current_database;
    if (!database) throw new Error('não foi possível determinar o banco corrente');

    const existing = await client`SELECT 1 FROM pg_roles WHERE rolname = 'pulse_app'`;

    if (existing.length === 0) {
      log.info('criando role pulse_app');
      // NOBYPASSRLS é o atributo que importa: é o que sujeita o role às políticas.
      //
      // CREATE ROLE não aceita parâmetro ligado para a senha, então ela entra como literal
      // SQL escapado por `literal()`. Não envolva em `client.unsafe()`: isso devolve um
      // PendingQuery, que interpolado em template string vira "[object Object]" e define a
      // senha errada silenciosamente.
      await client.unsafe(
        `CREATE ROLE pulse_app WITH LOGIN PASSWORD ${literal(password)}
         NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER NOINHERIT`,
      );
    } else {
      log.info('role pulse_app já existe; ajustando senha e atributos');
      await client.unsafe(
        `ALTER ROLE pulse_app WITH LOGIN PASSWORD ${literal(password)}
         NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER`,
      );
    }

    await client.unsafe(`GRANT CONNECT ON DATABASE ${quoteIdent(database)} TO pulse_app`);
    await client.unsafe('GRANT USAGE ON SCHEMA public TO pulse_app');
    // Impede que pulse_app crie objetos no schema public.
    await client.unsafe('REVOKE CREATE ON SCHEMA public FROM PUBLIC');

    // Os privilégios por tabela são concedidos por sql/99-rls.sql, que roda depois das
    // migrations — as tabelas ainda podem não existir neste momento.
    log.info(
      'role pulse_app pronto. Aponte DATABASE_URL para ele e rode `pnpm db:migrate` ' +
        'para aplicar schema, privilégios e políticas de RLS.',
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

/** Literal de string SQL com escape de aspas simples. */
function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Identificador SQL com escape de aspas duplas. */
function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

main().catch((error: unknown) => {
  log.error({ err: error }, 'setup de roles falhou');
  process.exit(1);
});
