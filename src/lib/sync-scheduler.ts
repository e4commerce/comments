import { env } from './env';
import { syncAll } from './sync';

const globalForScheduler = globalThis as unknown as {
  __metaCommentsSyncInterval?: ReturnType<typeof setInterval>;
  __metaCommentsInitialSync?: ReturnType<typeof setTimeout>;
};

async function runScheduledSync(): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await syncAll();
    console.info('[sync] execução automática concluída', {
      durationMs: Date.now() - startedAt,
      postsSeen: result.postsSeen,
      commentsNew: result.commentsNew,
      commentsUpdated: result.commentsUpdated,
      errors: result.errors.length,
    });
  } catch (error) {
    console.error(
      '[sync] falha na execução automática',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Agenda o sync dentro do processo persistente do Next na Railway. O estado
 * global evita timers duplicados durante hot reload e importações repetidas.
 */
export function startSyncScheduler(): void {
  if (process.env.MC_BUILD === '1' || process.env.NODE_ENV !== 'production') return;
  if (env.autoSyncIntervalMinutes <= 0 || globalForScheduler.__metaCommentsSyncInterval) return;

  const intervalMs = env.autoSyncIntervalMinutes * 60 * 1000;
  globalForScheduler.__metaCommentsInitialSync = setTimeout(() => {
    void runScheduledSync();
  }, 15_000);
  globalForScheduler.__metaCommentsInitialSync.unref?.();

  globalForScheduler.__metaCommentsSyncInterval = setInterval(() => {
    void runScheduledSync();
  }, intervalMs);
  globalForScheduler.__metaCommentsSyncInterval.unref?.();

  console.info(`[sync] agendador ativo a cada ${env.autoSyncIntervalMinutes} minuto(s)`);
}
