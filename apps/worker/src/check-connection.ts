/**
 * Verificação de infraestrutura: Postgres e Redis.
 *
 * `pnpm --filter @pulse/worker queues:check`
 *
 * Existe para separar "a infraestrutura está errada" de "o código está errado" no momento
 * em que algo falha. Roda um round-trip real de job pela fila, não apenas um PING: PING
 * passa com `maxmemory-policy` de eviction, e o problema desse caso é justamente que a fila
 * aceita o job e o perde depois.
 */

import { pingDb, closeDb } from '@pulse/db';
import { createLogger } from '@pulse/shared/logger';
import { getQueue, getQueueDepths, closeQueues } from './queues';
import { assertRedisReady, closeRedis } from './redis';

const log = createLogger('check');

async function main(): Promise<void> {
  let ok = true;

  const dbOk = await pingDb();
  log.info({ postgres: dbOk ? 'ok' : 'FALHOU' }, 'postgres');
  if (!dbOk) ok = false;

  const redis = await assertRedisReady();
  log.info(
    { version: redis.version, maxmemoryPolicy: redis.maxmemoryPolicy },
    redis.ok ? 'redis ok' : 'redis acessível, com ressalvas',
  );

  // Round-trip: enfileira, lê de volta, remove.
  const queue = getQueue('ingest');
  const job = await queue.add('connectivity-probe', { probe: true }, { attempts: 1 });
  const readBack = await queue.getJob(job.id ?? '');
  if (!readBack) {
    log.error('job enfileirado não foi encontrado de volta: a fila não está retendo trabalho');
    ok = false;
  } else {
    await readBack.remove();
    log.info({ jobId: job.id }, 'round-trip de job na fila ok');
  }

  log.info({ depths: await getQueueDepths() }, 'profundidade das filas');

  await closeQueues();
  await closeRedis();
  await closeDb();

  if (!ok || !redis.ok) {
    log.warn('verificação concluída COM problemas; veja os avisos acima');
    process.exit(1);
  }
  log.info('infraestrutura ok');
}

main().catch((error: unknown) => {
  log.error({ err: error }, 'verificação falhou');
  process.exit(1);
});
