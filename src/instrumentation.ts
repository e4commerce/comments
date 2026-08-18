/**
 * O Next compila este arquivo para os runtimes Node e Edge. O import positivo
 * dentro do bloco permite ao bundler eliminar completamente o módulo Node (e o
 * better-sqlite3) do bundle Edge.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
