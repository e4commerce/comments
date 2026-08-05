import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

/**
 * Uma conexão por processo. Em desenvolvimento o Next recarrega os módulos a
 * cada edição, e uma nova conexão por reload esgota os file descriptors — daí o
 * cache no globalThis.
 */
const globalForDb = globalThis as unknown as { __sqlite?: Database.Database };

function open(): Database.Database {
  const path = process.env.DATABASE_PATH ?? './data/comments.db';
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const conn = new Database(path);
  // WAL: leituras do dashboard não bloqueiam a escrita da sincronização.
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  // A sincronização escreve em lote enquanto a interface lê; sem isto, um
  // "database is locked" aparece como erro de página em vez de esperar.
  conn.pragma('busy_timeout = 5000');
  return conn;
}

export const sqlite = (globalForDb.__sqlite ??= open());
export const db = drizzle(sqlite, { schema });
export * from './schema';
