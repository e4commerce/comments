/**
 * Cliente de banco e fronteira de tenancy.
 *
 * O §4.1 exige duas camadas de isolamento. Este arquivo implementa a segunda: toda
 * leitura e escrita de dado operacional passa por `withOrg`, que abre uma transação e
 * define `app.current_org_id`, variável que as políticas de RLS consultam.
 *
 * `set_config(..., true)` é o equivalente a `SET LOCAL`: o valor vive até o fim da
 * transação e não vaza para a próxima query que reutilizar a conexão do pool. Usar
 * `SET LOCAL` com interpolação de string seria injeção de SQL; `set_config` aceita
 * parâmetro ligado.
 */

import { getEnv } from '@pulse/shared/env';
import { createLogger } from '@pulse/shared/logger';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const log = createLogger('db');

let sqlClient: postgres.Sql | undefined;
let db: Database | undefined;

function buildClient(connectionString: string, max: number): postgres.Sql {
  const env = getEnv();
  return postgres(connectionString, {
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    // `prepare: false` é necessário se houver PgBouncer em transaction mode à frente.
    // No Railway o Postgres é acessado direto, mas manter desligado evita uma classe de
    // falha difícil de diagnosticar se um pooler for introduzido depois.
    prepare: false,
    // Sempre uma função: em desenvolvimento os NOTICE do Postgres são úteis (as migrations
    // usam RAISE WARNING); em produção iriam para stdout fora do formato estruturado.
    onnotice:
      env.NODE_ENV === 'development'
        ? (notice) => log.debug({ notice }, 'postgres notice')
        : () => undefined,
  });
}

/**
 * Conexão de runtime. Usa `DATABASE_URL`, que aponta para `pulse_app`: role sem
 * BYPASSRLS e que não é dono das tabelas. Rodar a aplicação como dono tornaria a RLS
 * decorativa, porque o dono ignora políticas por padrão no Postgres.
 */
export function getDb(): Database {
  if (db) return db;
  const env = getEnv();
  sqlClient = buildClient(env.DATABASE_URL, env.NODE_ENV === 'production' ? 20 : 5);
  db = drizzle(sqlClient, { schema, casing: 'snake_case', logger: env.DEBUG_SQL === true });
  return db;
}

export function getSqlClient(): postgres.Sql {
  getDb();
  if (!sqlClient) throw new Error('cliente SQL não inicializado');
  return sqlClient;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Executa `fn` dentro de uma transação com a organização ativa definida.
 *
 * Este é o único caminho legítimo para tocar dado operacional. Consultar `getDb()`
 * diretamente para ler `comments`, `posts` ou `ai_analyses` retorna zero linhas, porque
 * a política de RLS compara com `app.current_org_id`, que estaria vazio — o que é o
 * comportamento desejado: falhar fechado, não aberto.
 */
export async function withOrg<T>(
  organizationId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(organizationId)) {
    throw new Error(`organizationId inválido: ${organizationId}`);
  }

  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_org_id', ${organizationId}, true)`);
    return fn(tx);
  });
}

/**
 * Define a organização ativa DENTRO de uma transação já aberta.
 *
 * Existe para o caso em que a organização é criada na mesma transação em que seus dados
 * iniciais são gravados — a taxonomia do Apêndice A, por exemplo. `withOrg` não serve ali,
 * porque exigiria o id antes de a linha existir, e fazer em duas transações deixaria uma
 * organização sem taxonomia visível se a segunda falhasse.
 */
export async function setOrgContext(tx: Transaction, organizationId: string): Promise<void> {
  if (!UUID_RE.test(organizationId)) {
    throw new Error(`organizationId inválido: ${organizationId}`);
  }
  await tx.execute(sql`select set_config('app.current_org_id', ${organizationId}, true)`);
}

/**
 * Transação sem organização, para dados que não pertencem a nenhuma: tabelas do Auth.js,
 * `webhook_events` (a organização só é resolvida depois, a partir de `entry.id`) e o
 * próprio cadastro de organizações.
 *
 * Nomeado explicitamente para que o uso apareça em code review. Não use para comentários.
 */
export async function withoutOrg<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return getDb().transaction(fn);
}

/** Encerra o pool. Necessário em testes e no shutdown gracioso do worker. */
export async function closeDb(): Promise<void> {
  if (sqlClient) {
    await sqlClient.end({ timeout: 5 });
    sqlClient = undefined;
    db = undefined;
    log.debug('pool de conexões encerrado');
  }
}

/**
 * Healthcheck usado por `GET /api/health` (§10) e pelo boot do worker.
 *
 * A causa vai no texto da mensagem, e não apenas no campo `err`: agregadores de log —
 * o do Railway entre eles — exibem só `msg` quando a linha é JSON, e um "healthcheck de
 * banco falhou" sem causa não diz se o problema é rede, credencial ou configuração.
 */
export async function pingDb(): Promise<boolean> {
  try {
    await getDb().execute(sql`select 1`);
    return true;
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    log.error({ err: error }, `healthcheck de banco falhou: ${cause}`);
    return false;
  }
}
