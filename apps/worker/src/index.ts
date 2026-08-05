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
import { getEnv, getIntegrationStatus } from '@pulse/shared/env';
import { createLogger } from '@pulse/shared/logger';
import { Worker, type Job, type Processor } from 'bullmq';
import { startHealthServer } from './health-server';
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
let healthServer: ReturnType<typeof startHealthServer> | undefined;

async function main(): Promise<void> {
  // Valida o ambiente ANTES de qualquer conexão, e explicitamente.
  //
  // Sem isso, `pingDb()` capturava a exceção de validação junto com as de rede e reportava
  // tudo como "healthcheck de banco falhou" — uma variável faltando aparecia como problema
  // de conectividade, o que manda o diagnóstico para o lado errado.
  const env = getEnv();
  log.info(
    {
      // Só nomes e formas, nunca valores. `host` é seguro e é o que responde à pergunta
      // "estou apontando para a rede privada ou para o proxy público?".
      dbHost: safeHost(env.DATABASE_URL),
      redisHost: safeHost(env.REDIS_URL),
      graphVersion: env.META_GRAPH_VERSION,
      // Integrações não configuradas não impedem o boot: são exigidas no ponto de uso, pelas
      // funções require* de @pulse/shared/env. O worker da Fase 1 não fala com nenhuma delas.
      integracoes: getIntegrationStatus(env),
    },
    'ambiente validado',
  );

  await waitForDb();
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

  healthServer = startHealthServer();

  log.info(
    { queues: Object.values(QUEUE_NAMES), processadoresRegistrados: processors.size },
    'worker no ar',
  );
}

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'encerrando worker');
  // O servidor de saúde fecha primeiro: a partir daqui o processo está saindo, e continuar
  // respondendo 200 faria a plataforma seguir roteando healthcheck para um serviço em queda.
  healthServer?.close();
  // Depois os workers: isso deixa os jobs em execução terminarem em vez de devolvê-los à
  // fila como stalled, o que causaria reprocessamento desnecessário.
  await Promise.all(workers.map((worker) => worker.close()));
  await closeQueues();
  await closeRedis();
  await closeDb();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

/**
 * Espera o Postgres ficar acessível, com tentativas.
 *
 * Não é paranoia: a rede privada do Railway leva alguns instantes para inicializar depois
 * que o container sobe, então uma conexão imediata pelo domínio interno falha com ENOTFOUND
 * mesmo estando tudo correto. O mesmo vale quando o serviço de banco reinicia junto com o
 * worker. Sem retry, o container entra em crash loop por uma condição transitória.
 */
async function waitForDb(attempts = 6): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await pingDb()) {
      if (attempt > 1) log.info({ attempt }, 'Postgres acessível após retentativa');
      return;
    }
    if (attempt === attempts) break;
    const delay = Math.min(1_000 * 2 ** (attempt - 1), 8_000);
    log.warn({ attempt, attempts, delayMs: delay }, 'Postgres inacessível; nova tentativa');
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error(
    `Postgres inacessível após ${String(attempts)} tentativas. ` +
      'Verifique DATABASE_URL: em rede privada do Railway o host é ' +
      '${{NomeDoServico.RAILWAY_PRIVATE_DOMAIN}} e o usuário deve ser pulse_app, não postgres.',
  );
}

/** Extrai host e porta de uma URL de conexão, descartando credencial. */
function safeHost(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '(default)'}`;
  } catch {
    return '(url inválida)';
  }
}

main().catch((error: unknown) => {
  // A causa entra no texto da mensagem porque agregadores de log costumam exibir apenas
  // `msg` em linhas JSON. Sem isso, o operador vê "não conseguiu subir" e nada mais.
  const cause = error instanceof Error ? error.message : String(error);
  log.error({ err: error }, `worker não conseguiu subir: ${cause}`);
  process.exit(1);
});
