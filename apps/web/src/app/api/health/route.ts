/**
 * `GET /api/health` — §10 do PRD: "Healthcheck com status de banco, Redis e filas. Público."
 *
 * Público de propósito, e por isso deliberadamente pobre em detalhe: informa se cada
 * dependência responde, sem versão de servidor, contagem de fila ou nome de organização.
 * Um healthcheck público que enumera infraestrutura é reconhecimento gratuito para quem
 * estiver sondando.
 *
 * O detalhamento operacional do §14 vive no painel administrativo autenticado (Fase 7) e no
 * `/health` do worker, que não deve ter domínio público.
 */

import { pingDb } from '@pulse/db';
import { getEnv } from '@pulse/shared/env';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();

  const database = await pingDb();
  // Redis é checado por TCP em vez de importar ioredis: o processo web não fala com as filas,
  // e carregar o cliente aqui traria a dependência para o bundle do servidor sem necessidade.
  const redis = await probeRedis();

  const healthy = database && redis;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      checks: { database, redis },
      latencyMs: Date.now() - startedAt,
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}

async function probeRedis(): Promise<boolean> {
  const { createConnection } = await import('node:net');
  let url: URL;
  try {
    url = new URL(getEnv().REDIS_URL);
  } catch {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const socket = createConnection({
      host: url.hostname,
      port: Number.parseInt(url.port || '6379', 10),
      // `family: 0` porque a rede privada do Railway é IPv6-only, mesmo motivo do ioredis
      // no worker.
      family: 0,
    });
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(3000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}
