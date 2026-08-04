/**
 * Conexão Redis compartilhada pelas filas.
 *
 * Duas configurações não são negociáveis para o BullMQ:
 *
 *   `maxRetriesPerRequest: null`  — o BullMQ usa comandos bloqueantes (BRPOPLPUSH) que
 *       ficam pendentes por design. Com o default do ioredis (20), o cliente derruba a
 *       conexão de um worker ocioso e os jobs param de ser consumidos sem erro visível.
 *
 *   `maxmemory-policy noeviction` no SERVIDOR — verificado em `assertRedisReady()`. Com
 *       qualquer política LRU, o Redis descarta chaves sob pressão de memória, e as chaves
 *       descartadas são os jobs. A fila perde trabalho silenciosamente, que é o pior modo
 *       de falha possível para ingestão de comentários (§5.7: o que não for capturado por
 *       webhook está perdido, não há como reconsultar).
 */

import { getEnv } from '@pulse/shared/env';
import { createLogger } from '@pulse/shared/logger';
import { Redis } from 'ioredis';

const log = createLogger('redis');

let connection: Redis | undefined;

export function getRedis(): Redis {
  if (connection) return connection;

  connection = new Redis(getEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });

  connection.on('error', (error) => log.error({ err: error }, 'erro de conexão com o Redis'));
  connection.on('reconnecting', () => log.warn('reconectando ao Redis'));

  return connection;
}

export interface RedisHealth {
  ok: boolean;
  version: string | null;
  maxmemoryPolicy: string | null;
  warnings: string[];
}

/**
 * Verifica que o Redis está apto a hospedar as filas. Chamado no boot do worker e pelo
 * `GET /api/health` (§10).
 */
export async function assertRedisReady(): Promise<RedisHealth> {
  const redis = getRedis();
  const warnings: string[] = [];

  await redis.ping();

  const info = await redis.info('server');
  const version = /redis_version:([^\r\n]+)/.exec(info)?.[1] ?? null;

  const policyRaw = await redis.config('GET', 'maxmemory-policy');
  const maxmemoryPolicy = Array.isArray(policyRaw) ? String(policyRaw[1] ?? '') : null;

  if (maxmemoryPolicy && maxmemoryPolicy !== 'noeviction') {
    warnings.push(
      `maxmemory-policy é "${maxmemoryPolicy}"; o BullMQ exige "noeviction". ` +
        'Com política de eviction o Redis descarta jobs sob pressão de memória e a fila ' +
        'perde trabalho sem erro. Ajuste no serviço Redis (ver docs/deploy-railway.md).',
    );
  }

  if (version && Number.parseInt(version.split('.')[0] ?? '0', 10) < 6) {
    warnings.push(`Redis ${version} é anterior ao 6; o BullMQ requer 6 ou superior.`);
  }

  for (const warning of warnings) log.warn(warning);

  return { ok: warnings.length === 0, version, maxmemoryPolicy, warnings };
}

export async function closeRedis(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = undefined;
  }
}
