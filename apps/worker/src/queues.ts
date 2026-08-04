/**
 * Definição das filas — §3.2 e §3.3 do PRD.
 *
 * As filas existem desde a Fase 1 mesmo sem processadores, porque o nome da fila é contrato
 * entre o `web` (que enfileira) e o `worker` (que consome), e são processos com deploy
 * independente. Fixar os nomes agora evita divergência silenciosa depois.
 *
 * A separação por fila não é organizacional, é de política de execução: a fila de ingestão
 * NÃO pode acumular atraso (§11.1 — o comentário precisa estar disponível para moderação
 * antes de ser classificado), enquanto a de IA pode. Concorrência e prioridade diferentes
 * exigem filas diferentes.
 */

import { createLogger } from '@pulse/shared/logger';
import { Queue, type JobsOptions } from 'bullmq';
import { getRedis } from './redis';

const log = createLogger('queues');

export const QUEUE_NAMES = {
  /** Processa payloads brutos de webhook. Latência é o requisito (§11.1: p95 < 10 s). */
  ingest: 'ingest',
  /** Backfill inicial e reconciliação incremental. Throughput sobre latência. */
  sync: 'sync',
  /** Ações de moderação contra a Graph API. Idempotentes por idempotency_key. */
  actions: 'actions',
  /** Classificação, embeddings e sugestão de resposta. Pode acumular atraso. */
  aiAnalyze: 'ai-analyze',
  /** Descoberta de tópicos por clusterização. Diária. */
  topics: 'topics',
  /** Agregação em metrics_daily e topic_metrics_daily. */
  aggregate: 'aggregate',
  /** Verificação diária de tokens via debug_token (§5.2). */
  tokens: 'tokens',
  /** SLA e recálculo periódico de urgency_score (§7.7 e Seção 4 do plano). */
  sla: 'sla',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Defaults de retentativa.
 *
 * Cinco tentativas com backoff exponencial e jitter é o que o §5.6 exige para chamadas à
 * Graph API. `removeOnFail` guarda os falhos: o §11.2 exige dead-letter queue com interface
 * de inspeção e reprocessamento manual, e jobs apagados não podem ser reprocessados.
 */
const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 24 * 3600, count: 5_000 },
  removeOnFail: { age: 14 * 24 * 3600 },
};

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;

  const queue = new Queue(name, {
    connection: getRedis(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  queues.set(name, queue);
  return queue;
}

/** Todas as filas, para o painel administrativo do §14 e o healthcheck do §10. */
export function getAllQueues(): Queue[] {
  return Object.values(QUEUE_NAMES).map((name) => getQueue(name));
}

export interface QueueDepth {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
}

/**
 * Profundidade de cada fila. Alimenta o painel do §14 e o alerta obrigatório de
 * "fila de ingestão com mais de mil itens pendentes por mais de dez minutos".
 */
export async function getQueueDepths(): Promise<QueueDepth[]> {
  return Promise.all(
    getAllQueues().map(async (queue) => {
      const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed');
      return {
        name: queue.name,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      };
    }),
  );
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
  log.debug('filas encerradas');
}
