import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { normalizeCommentFilterText } from '@/lib/comment-filters';
import * as schema from './schema';

/**
 * Uma conexão por processo. Em desenvolvimento o Next recarrega os módulos a
 * cada edição, e uma nova conexão por reload esgota os file descriptors — daí o
 * cache no globalThis.
 */
const globalForDb = globalThis as unknown as { __sqlite?: Database.Database };

function open(): Database.Database {
  // O Next importa os módulos das rotas em vários processos paralelos durante
  // `next build`. Abrir o arquivo real nessa etapa faria cada processo tentar
  // configurar WAL ao mesmo tempo e pode resultar em SQLITE_BUSY. As rotas são
  // dinâmicas e não consultam dados no build, então uma conexão isolada em
  // memória é suficiente para resolver os imports sem tocar no banco real.
  const isBuild = process.env.MC_BUILD === '1';
  const path = isBuild ? ':memory:' : (process.env.DATABASE_PATH ?? './data/comments.db');

  if (!isBuild) {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const conn = new Database(path);
  // WAL: leituras do dashboard não bloqueiam a escrita da sincronização. Banco
  // em memória não suporta WAL e existe somente no processo temporário de build.
  if (!isBuild) conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  // Esta tabela foi adicionada depois dos primeiros volumes de produção. A
  // criação idempotente mantém esses bancos compatíveis mesmo quando o deploy
  // apenas reinicia o app, sem executar `drizzle-kit push` antes do `next start`.
  conn.exec(`
    create table if not exists app_settings (
      id text primary key not null,
      count_hidden_unanswered integer default 1 not null,
      updated_at integer default (unixepoch() * 1000) not null
    )
  `);
  // O lower() nativo do SQLite não cobre bem caracteres Unicode. Esta função
  // mantém filtros como "PÉSSIMO" insensíveis a maiúsculas e minúsculas.
  conn.function(
    'mc_normalize_comment_text',
    { deterministic: true },
    (value: string | null) => normalizeCommentFilterText(value ?? ''),
  );
  // A sincronização escreve em lote enquanto a interface lê; sem isto, um
  // "database is locked" aparece como erro de página em vez de esperar.
  conn.pragma('busy_timeout = 5000');
  return conn;
}

export const sqlite = (globalForDb.__sqlite ??= open());
export const db = drizzle(sqlite, { schema });
export * from './schema';
