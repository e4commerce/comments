/**
 * Scheduler — §3.2 do PRD.
 *
 * Processo separado que registra os jobs recorrentes. Roda como serviço próprio no Railway,
 * e NÃO como cron da plataforma: um cron dispararia um container novo, sem acesso ao estado
 * das filas nem à conexão Redis das repetições.
 *
 * `upsertJobScheduler` é idempotente por chave, então redeploy não duplica agendamento —
 * o modo de falha clássico de scheduler, que produz reconciliações concorrentes disputando
 * o mesmo rate limit da Graph API.
 */

import { createLogger } from '@pulse/shared/logger';
import { QUEUE_NAMES, closeQueues, getQueue, type QueueName } from './queues';
import { assertRedisReady, closeRedis } from './redis';

const log = createLogger('scheduler');

interface Schedule {
  key: string;
  queue: QueueName;
  jobName: string;
  /** Cron de 5 campos, ou `every` em milissegundos. */
  pattern?: string;
  every?: number;
  fase: string;
}

/**
 * Os intervalos vêm do PRD, não de preferência:
 *   reconcile a cada 30 min      §5.8
 *   tokens diariamente           §5.2 (debug_token)
 *   sla a cada 5 min             §7.7 — e aqui também o recálculo de urgency_score, porque
 *                                o termo de tempo de espera do §6.8 cresce com o tempo e
 *                                recálculo só por evento deixaria a fila estagnada
 *   topics diariamente           §9.2 (descoberta por clusterização)
 *   aggregate diariamente        §8 (metrics_daily e topic_metrics_daily)
 */
const SCHEDULES: readonly Schedule[] = [
  {
    key: 'reconcile-comments',
    queue: QUEUE_NAMES.sync,
    jobName: 'reconcile-comments',
    every: 30 * 60 * 1000,
    fase: '3',
  },
  {
    key: 'refresh-tokens',
    queue: QUEUE_NAMES.tokens,
    jobName: 'refresh-tokens',
    // 03:00 no fuso do container. O horário importa pouco; a distância do pico de tráfego,
    // sim: verificar centenas de tokens consome cota da Graph API.
    pattern: '0 3 * * *',
    fase: '2',
  },
  {
    key: 'sla-and-urgency',
    queue: QUEUE_NAMES.sla,
    jobName: 'sla-and-urgency',
    every: 5 * 60 * 1000,
    fase: '4',
  },
  {
    key: 'discover-topics',
    queue: QUEUE_NAMES.topics,
    jobName: 'discover-topics',
    pattern: '30 4 * * *',
    fase: '6',
  },
  {
    key: 'aggregate-metrics',
    queue: QUEUE_NAMES.aggregate,
    jobName: 'aggregate-metrics',
    // Depois da descoberta de tópicos, para que os agregados do dia já reflitam a taxonomia
    // nova — do contrário topic_metrics_daily ficaria um dia atrás.
    pattern: '0 5 * * *',
    fase: '6',
  },
];

async function main(): Promise<void> {
  const redis = await assertRedisReady();
  if (!redis.ok) log.warn({ warnings: redis.warnings }, 'Redis com ressalvas');

  for (const schedule of SCHEDULES) {
    const queue = getQueue(schedule.queue);
    await queue.upsertJobScheduler(
      schedule.key,
      schedule.pattern === undefined
        ? { every: schedule.every ?? 0 }
        : { pattern: schedule.pattern },
      { name: schedule.jobName },
    );
    log.info(
      {
        key: schedule.key,
        queue: schedule.queue,
        cadencia: schedule.pattern ?? `every ${String(schedule.every)}ms`,
        faseDoProcessador: schedule.fase,
      },
      'agendamento registrado',
    );
  }

  log.info(
    { total: SCHEDULES.length },
    'scheduler no ar. Agendamentos cujos processadores ainda não existem vão falhar com ' +
      'mensagem explícita no worker — comportamento intencional até a fase correspondente.',
  );
}

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'encerrando scheduler');
  await closeQueues();
  await closeRedis();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((error: unknown) => {
  log.error({ err: error }, 'scheduler não conseguiu subir');
  process.exit(1);
});
