/** Inicialização exclusiva do runtime Node do Next.js. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startSyncScheduler } = await import('./lib/sync-scheduler');
  startSyncScheduler();
}
