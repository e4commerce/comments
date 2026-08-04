/**
 * Processo worker — §3.2 do PRD.
 *
 * Concentra TODA a interação com a Graph API e com o OpenRouter. Isso não é organização de
 * código: os limites da Graph API são por página e por conta de anúncios (§5.6), e o
 * controle de concorrência precisa ser global. Se o `web` também chamasse a Graph API, cada
 * instância teria seu próprio token bucket e o limite seria estourado.
 *
 * Estado atual: esqueleto da Fase 1. Nenhum processador está implementado ainda — os jobs
 * chegam nas Fases 2 (ingest-webhook, refresh-tokens), 3 (backfill, reconcile,
 * execute-action), 5 (ai-analyze) e 6 (discover-topics, aggregate-metrics).
 *
 * Jobs sem processador registrado FALHAM com mensagem explícita em vez de serem consumidos
 * e descartados. Um job que desaparece em silêncio durante o desenvolvimento é a origem de
 * horas de diagnóstico inútil.
 */

import { closeDb, pingDb } from '@pulse/db';
import { createLogger } from '@pulse/shared/logger';
import { Worker, type Job, type Processor } from 'bullmq';
import { QUEUE_NAMES, closeQueues, type QueueName } from './queues';
import { assertRedisReady, closeRedis, getRedis } from './redis';

const log = createLogger('worker');

/**
 * Concorrência por fila.
 *
 * `ingest` alto porque o §11.1 exige absorver picos de dez mil comentários em cinco minutos
 * sem acumular atraso — cenário de live ou publicação viral. `sync` e `actions` baixos
 * porque falam com a Graph API, onde o gargalo é o rate limit por página e não a CPU;
 * aumentar aqui só aceleraria o caminho até o bloqueio.
 */
const CONCURRENCY: Record<QueueName, number> = {
  [QUEUE_NAMES.ingest]: 20,
  [QUEUE_NAMES.sync]: 3,
  [QUEUE_NAMES.actions]: 5,
  [QUEUE_NAMES.aiAnalyze]: 4,
  [QUEUE_NAMES.topics]: 1,
  [QUEUE_NAMES.aggregate]: 2,
  [QUEUE_NAMES.tokens]: 2,
  [QUEUE_NAMES.sla]: 1,
};

/**
 * Registro de processadores. Cada fase preenche as suas entradas.
 *
 * A chave é `${fila}:${nome-do-job}`, e não só a fila, porque uma fila hospeda vários tipos
 * de job — `sync` recebe backfill, reconcile e ads_sync.
 */
const processors = new Map<string, Processor>();

export function registerProcessor(queue: QueueName, jobName: string, processor: Processor): void {
  const key = `${queue}:${jobName}`;
  if (processors.has(key)) throw new Error(`processador duplicado para ${key}`);
  processors.set(key, processor);
}

function dispatch(queue: QueueName): Processor {
  return async (job: Job) => {
    const processor = processors.get(`${queue}:${job.name}`);
    if (!processor) {
      throw new Error(
        `Nenhum processador registrado para ${queue}:${job.name}. ` +
          'Se o job é esperado nesta fase, registre-o em apps/worker/src/index.ts; ' +
          'se não, alguém está enfileirando trabalho que ninguém consome.',
      );
    }
    const jobLog = log.child({ job_id: job.id, queue });
    const startedAt = Date.now();
    try {
      // `Processor` do BullMQ é tipado com ResultType `any`; estreitamos para `unknown` para
      // que o valor não se propague como any pelo resto do arquivo.
      const result: unknown = await processor(job, job.token ?? '');
      jobLog.info({ durationMs: Date.now() - startedAt }, `${job.name} concluído`);
      return result;
    } catch (error) {
      jobLog.error(
        { err: error, attempt: job.attemptsMade + 1, durationMs: Date.now() - startedAt },
        `${job.name} falhou`,
      );
      throw error;
    }
  };
}

const workers: Worker[] = [];

async function main(): Promise<void> {
  if (!(await pingDb())) throw new Error('Postgres inacessível; worker não vai subir');
  const redis = await assertRedisReady();
  if (!redis.ok) {
    // Aviso e não erro: `maxmemory-policy` errada é grave, mas derrubar o worker por isso
    // impediria a operação inteira. O alerta do §14 é o mecanismo correto.
    log.warn({ warnings: redis.warnings }, 'Redis com ressalvas; ver docs/deploy-railway.md');
  }

  for (const queue of Object.values(QUEUE_NAMES)) {
    workers.push(
      new Worker(queue, dispatch(queue), {
        connection: getRedis(),
        concurrency: CONCURRENCY[queue],
      }),
    );
  }

  log.info(
    { queues: Object.values(QUEUE_NAMES), processadoresRegistrados: processors.size },
    'worker no ar',
  );
}

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'encerrando worker');
  // Fecha os workers primeiro: isso deixa os jobs em execução terminarem em vez de
  // devolvê-los à fila como stalled, o que causaria reprocessamento desnecessário.
  await Promise.all(workers.map((worker) => worker.close()));
  await closeQueues();
  await closeRedis();
  await closeDb();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((error: unknown) => {
  log.error({ err: error }, 'worker não conseguiu subir');
  process.exit(1);
});
