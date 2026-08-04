/**
 * Remove todos os job schedulers e drena as filas.
 *
 * Necessário enquanto não há processadores: os agendamentos do §3.2 disparariam a cada 5 e
 * 30 minutos contra filas que ninguém consome, acumulando trabalho morto. Também é a
 * ferramenta correta para limpar agendamento órfão depois de renomear uma chave.
 */
import { createLogger } from '@pulse/shared/logger';
import { closeQueues, getAllQueues } from './queues';
import { closeRedis } from './redis';

const log = createLogger('unschedule');

async function main(): Promise<void> {
  let removed = 0;
  for (const queue of getAllQueues()) {
    for (const scheduler of await queue.getJobSchedulers()) {
      if (scheduler.key) {
        await queue.removeJobScheduler(scheduler.key);
        removed += 1;
      }
    }
    await queue.drain(true);
  }
  log.info({ removed }, 'agendamentos removidos e filas drenadas');
  await closeQueues();
  await closeRedis();
}

main().catch((error: unknown) => {
  log.error({ err: error }, 'falha ao remover agendamentos');
  process.exit(1);
});
