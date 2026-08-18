import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Tudo em uma base SQLite local. Uma organização com vários usuários — não há
 * tenant, então não há coluna de tenant em lugar nenhum.
 *
 * IDs do Meta são strings opacas e ficam sempre em `externalId`. A chave
 * primária é nossa, para que um comentário excluído na plataforma não perca a
 * linha de histórico aqui.
 */

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

/** Pessoa autorizada a acessar o app. A autenticação é por código enviado ao e-mail. */
export const users = sqliteTable(
  'users',
  {
    id: id(),
    /** Sempre normalizado em minúsculas antes de gravar. */
    email: text('email').notNull(),
    /** 'admin' | 'user' */
    role: text('role').$type<'admin' | 'user'>().notNull().default('user'),
    /** Desativar revoga a sessão na próxima requisição e impede novos códigos. */
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email').on(t.email)],
);

/** Código de uso único. Só o HMAC do código é persistido, nunca o código enviado. */
export const loginCodes = sqliteTable(
  'login_codes',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    usedAt: integer('used_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [index('login_codes_user_created').on(t.userId, t.createdAt)],
);

/** Conta conectada: uma Página do Facebook ou uma conta do Instagram. */
export const accounts = sqliteTable(
  'accounts',
  {
    id: id(),
    /** 'facebook' | 'instagram' */
    platform: text('platform').notNull(),
    /** ID da Página ou do IG User na Graph API. */
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    username: text('username'),
    pictureUrl: text('picture_url'),
    /**
     * Page Access Token cifrado (v1:iv:tag:data). Contas de Instagram usam o
     * token da Página vinculada — o IG não emite token próprio.
     */
    accessToken: text('access_token').notNull(),
    /** Para contas de Instagram: a Página do Facebook que a administra. */
    parentPageId: text('parent_page_id'),
    /**
     * Tarefas concedidas na Página (MODERATE, CREATE_CONTENT, ...). Sem
     * MODERATE a Graph API nem retorna IDs de comentário — avisamos na conexão
     * em vez de falhar depois, opaco.
     */
    tasks: text('tasks', { mode: 'json' }).$type<string[]>(),
    /** 'active' | 'needs_reauth' | 'disabled' */
    status: text('status').notNull().default('active'),
    lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('accounts_platform_external').on(t.platform, t.externalId)],
);

/** Publicação (post do Facebook ou mídia do Instagram) que hospeda comentários. */
export const posts = sqliteTable(
  'posts',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    platform: text('platform').notNull(),
    permalink: text('permalink'),
    /** `message` no Facebook, `caption` no Instagram. */
    message: text('message'),
    /** IMAGE | VIDEO | CAROUSEL_ALBUM | STATUS | LINK ... */
    mediaType: text('media_type'),
    mediaUrl: text('media_url'),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    /**
     * Alguns posts (dark posts, mídia com restrição) não retornam comentários
     * mesmo existindo. Marcamos e informamos, em vez de mostrar zero como se
     * fosse ausência de comentários.
     */
    commentsAvailable: integer('comments_available', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('posts_account_external').on(t.accountId, t.externalId),
    index('posts_published').on(t.publishedAt),
  ],
);

/**
 * Comentários e respostas na mesma tabela: uma resposta é um comentário com
 * `parentExternalId` preenchido. É o que permite "ver as outras respostas" sem
 * uma segunda consulta a outra tabela.
 */
export const comments = sqliteTable(
  'comments',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    postId: text('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    platform: text('platform').notNull(),
    /** ID externo do comentário pai. Nulo em comentário de primeiro nível. */
    parentExternalId: text('parent_external_id'),

    authorExternalId: text('author_external_id'),
    authorName: text('author_name'),
    authorPictureUrl: text('author_picture_url'),
    /** Comentário publicado pela própria página/conta (nossa resposta). */
    isOwn: integer('is_own', { mode: 'boolean' }).notNull().default(false),

    message: text('message'),
    likeCount: integer('like_count').notNull().default(0),
    replyCount: integer('reply_count').notNull().default(0),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),

    isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),
    /**
     * Ausência na API não é exclusão: comentários de usuários restringidos
     * também desaparecem. Só marcamos após duas reconciliações consecutivas
     * sem o comentário — daí o contador.
     */
    deletedOnPlatform: integer('deleted_on_platform', { mode: 'boolean' }).notNull().default(false),
    missCount: integer('miss_count').notNull().default(0),

    /** Fluxo de moderação: 'new' | 'answered' | 'ignored' */
    status: text('status').notNull().default('new'),
    /** Curtido por nós (Facebook apenas; o IG não tem endpoint de curtir). */
    likedByUs: integer('liked_by_us', { mode: 'boolean' }).notNull().default(false),

    // --- Resultado da IA, desnormalizado aqui porque todo filtro do inbox e
    // todo gráfico do dashboard cruza estes campos com published_at.
    /** 'positive' | 'neutral' | 'negative' */
    sentiment: text('sentiment'),
    /** Rótulo da taxonomia de motivos (ver src/lib/taxonomy.ts). */
    motive: text('motive'),
    /** 'question' | 'complaint' | 'praise' | 'purchase_intent' | 'other' */
    intent: text('intent'),
    /** 'low' | 'medium' | 'high' */
    urgency: text('urgency'),
    isQuestion: integer('is_question', { mode: 'boolean' }).notNull().default(false),
    isSpam: integer('is_spam', { mode: 'boolean' }).notNull().default(false),
    /** 0..1 — confiança declarada pelo modelo. */
    aiConfidence: integer('ai_confidence'),
    aiModel: text('ai_model'),
    analyzedAt: integer('analyzed_at', { mode: 'timestamp_ms' }),

    /** Payload cru da Graph API, para depurar sem reconsultar. */
    raw: text('raw', { mode: 'json' }),
    syncedAt: integer('synced_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('comments_external').on(t.externalId),
    index('comments_published').on(t.publishedAt),
    index('comments_status').on(t.status),
    index('comments_parent').on(t.parentExternalId),
    index('comments_account').on(t.accountId),
    // A fila de análise varre "analyzed_at IS NULL"; sem índice ela vira
    // varredura completa depois do primeiro backfill grande.
    index('comments_analyzed').on(t.analyzedAt),
  ],
);

/**
 * Termos que não devem entrar na fila de Comentários. As regras são globais:
 * valem para todas as contas, plataformas e pessoas que usam o app.
 *
 * O comentário continua salvo localmente e publicado no Meta. A regra só o
 * retira da fila de trabalho, então removê-la reexibe o histórico imediatamente.
 */
export const commentFilters = sqliteTable(
  'comment_filters',
  {
    id: id(),
    /** Texto original, preservado para exibição na interface. */
    pattern: text('pattern').notNull(),
    /** Versão normalizada usada para impedir regras duplicadas. */
    normalizedPattern: text('normalized_pattern').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('comment_filters_normalized').on(t.normalizedPattern)],
);

/** Auditoria do que enviamos ao Meta. Erro da API fica registrado, não só logado. */
export const actionLog = sqliteTable(
  'action_log',
  {
    id: id(),
    commentExternalId: text('comment_external_id'),
    /** 'reply' | 'like' | 'unlike' | 'hide' | 'unhide' | 'delete' */
    action: text('action').notNull(),
    /** 'ok' | 'error' */
    result: text('result').notNull(),
    detail: text('detail'),
    createdAt: createdAt(),
  },
  (t) => [index('action_log_comment').on(t.commentExternalId)],
);

/** Uma execução de sincronização, para a interface dizer o que aconteceu. */
export const syncRuns = sqliteTable('sync_runs', {
  id: id(),
  accountId: text('account_id'),
  /** 'running' | 'ok' | 'error' */
  status: text('status').notNull().default('running'),
  postsSeen: integer('posts_seen').notNull().default(0),
  commentsNew: integer('comments_new').notNull().default(0),
  commentsUpdated: integer('comments_updated').notNull().default(0),
  error: text('error'),
  startedAt: createdAt(),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
});

export type Account = typeof accounts.$inferSelect;
export type User = typeof users.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type CommentFilter = typeof commentFilters.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;
