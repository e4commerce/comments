/**
 * Servidor HTTP mínimo de saúde do worker.
 *
 * O worker é um processo de background e não precisa de HTTP para funcionar. Este servidor
 * existe por dois motivos operacionais:
 *
 *  1. Plataformas de container — Railway, Fly, Render — atribuem um domínio ao serviço e
 *     esperam um listener. Sem ele, acessar a URL devolve "Application failed to respond",
 *     que parece falha de deploy quando o worker está perfeitamente saudável.
 *
 *  2. Dá uma forma de responder "está de pé e conectado?" sem abrir o painel de logs, que é
 *     o que o §14 do PRD pede do painel administrativo, na sua forma mais reduzida.
 *
 * Não expõe dado de cliente nem segredo: apenas estado de conexão, tempo de atividade e
 * contagem por fila. Ainda assim, prefira NÃO publicar um domínio para este serviço — o
 * healthcheck interno da plataforma alcança a porta sem exposição pública.
 */

import { pingDb } from '@pulse/db';
import { getIntegrationStatus } from '@pulse/shared/env';
import { createLogger } from '@pulse/shared/logger';
import { createServer, type Server } from 'node:http';
import { getQueueDepths } from './queues';
import { assertRedisReady } from './redis';

const log = createLogger('health-server');

const startedAt = Date.now();

async function buildPayload(): Promise<{ status: number; body: unknown }> {
  const [dbOk, redis, depths] = await Promise.all([
    pingDb(),
    assertRedisReady().catch(() => null),
    getQueueDepths().catch(() => []),
  ]);

  const healthy = dbOk && redis !== null;
  return {
    status: healthy ? 200 : 503,
    body: {
      service: 'worker',
      status: healthy ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      postgres: dbOk ? 'ok' : 'inacessível',
      redis:
        redis === null
          ? 'inacessível'
          : { version: redis.version, maxmemoryPolicy: redis.maxmemoryPolicy, warnings: redis.warnings },
      integracoes: getIntegrationStatus(),
      filas: depths,
      // Deixa explícito que fila vazia é o estado correto nesta fase, e não sintoma.
      nota: 'Nenhum processador registrado até a Fase 2: filas vazias são o esperado.',
    },
  };
}

export function startHealthServer(): Server {
  // PORT é injetada pela plataforma. 3001 no local para não colidir com o Next em 3000.
  const port = Number.parseInt(process.env.PORT ?? '3001', 10);

  const server = createServer((req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }

    if (req.url !== '/' && req.url !== '/health') {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'not found', tente: '/health' }));
      return;
    }

    buildPayload()
      .then(({ status, body }) => {
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          // Healthcheck cacheado é healthcheck inútil.
          'cache-control': 'no-store',
        });
        res.end(JSON.stringify(body, null, 2));
      })
      .catch((error: unknown) => {
        const cause = error instanceof Error ? error.message : String(error);
        log.error({ err: error }, `falha ao montar payload de saúde: ${cause}`);
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'error', message: cause }));
      });
  });

  // `0.0.0.0` e não `localhost`: em container, ligar ao loopback torna a porta inalcançável
  // de fora, e o sintoma é idêntico a não ter servidor nenhum.
  server.listen(port, '0.0.0.0', () => {
    log.info({ port }, 'servidor de saúde escutando em /health');
  });

  return server;
}
