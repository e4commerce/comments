/**
 * Publicações e comentários — §6.4 do PRD [NORMATIVO], mais o desvio aprovado.
 *
 * ---------------------------------------------------------------------------
 * DESVIO CONSCIENTE AO §6 (único do projeto; ver docs/desvios-prd.md)
 *
 * `comments` recebe nove colunas de resultado de IA (`ai_*`, `primary_topic_id`,
 * `ai_analysis_id`). São ADIÇÕES: nenhum nome, tipo ou índice do §6.4 muda, e
 * `ai_analyses` continua a fonte da verdade e o histórico por `prompt_version`.
 *
 * Motivo: o §11.1 exige p95 abaixo de 300 ms com filtros sobre 1 milhão de registros
 * por organização, e o §7.2 permite combinar sentimento, intenção, urgência, tópico,
 * toxicidade e spam com paginação keyset sobre `(published_at, id)`. Na forma
 * normalizada a query precisaria juntar `ai_analyses` — cuja unicidade é
 * `(comment_id, prompt_version)`, exigindo DISTINCT ON para achar a análise vigente —
 * mais `comment_topics`, dentro da mesma query paginada. O planner perde o keyset e
 * cai em sort.
 *
 * Mantidas na MESMA transação que grava `ai_analyses`. Divergência entre as duas é bug.
 * ---------------------------------------------------------------------------
 *
 * `primary_topic_id` e `ai_analysis_id` são declaradas sem `.references()` aqui e
 * recebem a foreign key na migration 0001. Declará-las com referência criaria um ciclo
 * de import entre content.ts e ai.ts (que já referencia `comments`), e ciclos de módulo
 * com inicialização no topo são uma fonte de falhas difíceis de diagnosticar. A
 * constraint existe no banco; só não é declarada aqui.
 */

import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  commentStatusEnum,
  intentLabelEnum,
  platformEnum,
  sentimentLabelEnum,
  sourceTypeEnum,
  urgencyLabelEnum,
} from './enums';
import { ads, socialAccounts } from './meta';
import { organizations, users } from './organizations';

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    socialAccountId: uuid('social_account_id')
      .notNull()
      .references(() => socialAccounts.id, { onDelete: 'cascade' }),
    platform: platformEnum('platform').notNull(),
    externalId: text('external_id').notNull(),
    sourceType: sourceTypeEnum('source_type').notNull().default('organic_post'),
    message: text('message'),
    permalinkUrl: text('permalink_url'),
    mediaUrl: text('media_url'),
    thumbnailUrl: text('thumbnail_url'),
    mediaType: text('media_type'),
    mediaProductType: text('media_product_type'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** Dark post: criativo de anúncio não publicado no feed da página (§5.5). */
    isDarkPost: boolean('is_dark_post').notNull().default(false),
    adId: uuid('ad_id').references(() => ads.id, { onDelete: 'set null' }),
    commentsCount: integer('comments_count').notNull().default(0),
    likesCount: integer('likes_count').notNull().default(0),
    sharesCount: integer('shares_count').notNull().default(0),
    commentsEnabled: boolean('comments_enabled').notNull().default(true),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    /**
     * Cursor de paginação persistido. O §5.8 exige interromper após um número
     * configurável de páginas e retomar daqui na execução seguinte, porque a paginação
     * pode falhar em objetos com dezenas de milhares de comentários (§15).
     */
    nextCursor: text('next_cursor'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('posts_org_platform_external_key').on(t.organizationId, t.platform, t.externalId),
    index('posts_account_published_idx').on(t.organizationId, t.socialAccountId, t.publishedAt.desc()),
    // A reconciliação prioriza publicações dos últimos sete dias e com atividade
    // recente (§5.8); esse conjunto é varrido por (org, last_synced_at).
    index('posts_reconcile_idx').on(t.organizationId, t.lastSyncedAt),
    index('posts_ad_idx').on(t.adId),
  ],
);

export const commentAuthors = pgTable(
  'comment_authors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    platform: platformEnum('platform').notNull(),
    /**
     * PSID (facebook) ou IGSID (instagram).
     *
     * ATENÇÃO — limitação real da plataforma, registrada na Seção 5 do plano de execução:
     * esses identificadores são escopados por página/app. O mesmo indivíduo comentando em
     * duas páginas da organização produz DOIS registros aqui. O "histórico do autor na
     * organização" do §7.1 é, na prática, histórico por conta conectada. Não há solução
     * via API oficial; a interface precisa rotular como tal em vez de somar números errados.
     */
    externalId: text('external_id').notNull(),
    name: text('name'),
    username: text('username'),
    pictureUrl: text('picture_url'),
    isPage: boolean('is_page').notNull().default(false),
    isVerified: boolean('is_verified').notNull().default(false),
    commentsCount: integer('comments_count').notNull().default(0),
    negativeCount: integer('negative_count').notNull().default(0),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    isBlocked: boolean('is_blocked').notNull().default(false),
  },
  (t) => [
    uniqueIndex('comment_authors_org_platform_external_key').on(
      t.organizationId,
      t.platform,
      t.externalId,
    ),
    // "Autores únicos versus comentários repetidos do mesmo autor" (§8.2) e a lista de
    // autores observados ordenam por volume.
    index('comment_authors_org_volume_idx').on(t.organizationId, t.commentsCount.desc()),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    socialAccountId: uuid('social_account_id')
      .notNull()
      .references(() => socialAccounts.id, { onDelete: 'cascade' }),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'set null' }),
    adId: uuid('ad_id').references(() => ads.id, { onDelete: 'set null' }),
    authorId: uuid('author_id').references(() => commentAuthors.id, { onDelete: 'set null' }),
    platform: platformEnum('platform').notNull(),
    externalId: text('external_id').notNull(),
    externalParentId: text('external_parent_id'),
    /**
     * Auto-referências. Preenchimento tardio é esperado e não é erro: na ingestão por
     * webhook a resposta chega antes do pai com frequência, e a inserção não pode falhar
     * por isso. A reconciliação religa órfãos (§5.8).
     */
    parentCommentId: uuid('parent_comment_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'set null',
    }),
    threadRootId: uuid('thread_root_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'set null',
    }),
    depth: smallint('depth').notNull().default(0),
    sourceType: sourceTypeEnum('source_type').notNull().default('organic_post'),
    message: text('message'),
    /** Minúsculas, sem acento. Base da busca por trigramas do §7.2. */
    messageNormalized: text('message_normalized'),
    attachment: jsonb('attachment'),
    messageTags: jsonb('message_tags'),
    permalinkUrl: text('permalink_url'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    likeCount: integer('like_count').notNull().default(0),
    replyCount: integer('reply_count').notNull().default(0),
    isHidden: boolean('is_hidden').notNull().default(false),
    isPrivate: boolean('is_private').notNull().default(false),
    isFromPage: boolean('is_from_page').notNull().default(false),
    isOwnReply: boolean('is_own_reply').notNull().default(false),
    /**
     * Os `can_*` vêm da Graph API e governam a disponibilidade das ações na interface
     * (§5.3). Não assuma que uma ação é sempre possível: é o que evita apresentar erro
     * de permissão ao usuário como falha inexplicável.
     */
    canHide: boolean('can_hide').notNull().default(false),
    canLike: boolean('can_like').notNull().default(false),
    canRemove: boolean('can_remove').notNull().default(false),
    canComment: boolean('can_comment').notNull().default(true),
    canReplyPrivately: boolean('can_reply_privately').notNull().default(false),
    userLikes: boolean('user_likes').notNull().default(false),
    status: commentStatusEnum('status').notNull().default('new'),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    slaDueAt: timestamp('sla_due_at', { withTimezone: true }),
    slaBreached: boolean('sla_breached').notNull().default(false),
    /**
     * Escore do §6.8, de 0 a 100. Recalculado quando a análise de IA conclui, quando o
     * comentário é atualizado E periodicamente — o termo de tempo de espera cresce até
     * saturar em 5 horas, então recálculo apenas por evento deixaria a fila estagnada.
     * Ver Seção 4 do plano de execução.
     */
    urgencyScore: numeric('urgency_score', { precision: 5, scale: 2 }).notNull().default('0'),
    editHistory: jsonb('edit_history')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /**
     * Verdadeiro só após DUAS reconciliações consecutivas sem o comentário na API.
     * Ausência tem outras causas além de exclusão: usuário restringido pela conta e
     * mídia com restrição de idade não retornam comentários (§15). Marcar na primeira
     * ausência produz falso positivo.
     */
    deletedOnPlatform: boolean('deleted_on_platform').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** webhook | backfill | reconcile */
    ingestedVia: text('ingested_via').notNull().default('webhook'),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // --- Desvio aprovado: resultado de IA desnormalizado. Ver cabeçalho. ---------
    aiAnalysisId: uuid('ai_analysis_id'),
    aiSentiment: sentimentLabelEnum('ai_sentiment'),
    aiIntent: intentLabelEnum('ai_intent'),
    aiUrgency: urgencyLabelEnum('ai_urgency'),
    aiConfidence: numeric('ai_confidence', { precision: 4, scale: 3 }),
    aiIsToxic: boolean('ai_is_toxic').notNull().default(false),
    aiIsSpam: boolean('ai_is_spam').notNull().default(false),
    aiIsQuestion: boolean('ai_is_question').notNull().default(false),
    primaryTopicId: uuid('primary_topic_id'),
  },
  (t) => [
    // Chave de idempotência da ingestão (§5.7).
    uniqueIndex('comments_org_platform_external_key').on(t.organizationId, t.platform, t.externalId),

    // --- Índices do §6.4, literais -------------------------------------------
    index('comments_inbox_idx')
      .on(t.organizationId, t.status, t.publishedAt.desc())
      .where(sql`deleted_on_platform = false`),
    index('comments_account_idx').on(t.organizationId, t.socialAccountId, t.publishedAt.desc()),
    index('comments_post_idx').on(t.postId, t.publishedAt),
    index('comments_assigned_idx').on(t.organizationId, t.assignedTo, t.status),
    index('comments_urgency_idx').on(t.organizationId, t.urgencyScore.desc(), t.publishedAt.desc()),
    index('comments_thread_idx').on(t.threadRootId, t.depth, t.publishedAt),
    index('comments_search_idx').using('gin', t.messageNormalized.op('gin_trgm_ops')),
    index('comments_sla_idx')
      .on(t.organizationId, t.slaDueAt)
      .where(sql`status IN ('new','in_progress')`),

    // --- Índices dos filtros desnormalizados (§7.2) --------------------------
    // Keyset sobre (published_at, id) preservado em cada um: sem a coluna de ordenação
    // no fim do índice, o filtro por sentimento derruba a paginação para sort.
    index('comments_ai_sentiment_idx')
      .on(t.organizationId, t.aiSentiment, t.publishedAt.desc(), t.id.desc())
      .where(sql`deleted_on_platform = false`),
    index('comments_ai_intent_idx')
      .on(t.organizationId, t.aiIntent, t.publishedAt.desc(), t.id.desc())
      .where(sql`deleted_on_platform = false`),
    index('comments_topic_idx')
      .on(t.organizationId, t.primaryTopicId, t.publishedAt.desc(), t.id.desc())
      .where(sql`deleted_on_platform = false`),
    // Fila de contenção de risco (§2.1 e §8.3): parcial, porque tóxico é raro e o
    // índice cheio seria desperdício.
    index('comments_toxic_idx')
      .on(t.organizationId, t.publishedAt.desc())
      .where(sql`ai_is_toxic = true AND deleted_on_platform = false`),
    // Comentários em anúncios, para o painel de mídia paga (§8.5).
    index('comments_ad_idx')
      .on(t.organizationId, t.adId, t.publishedAt.desc())
      .where(sql`ad_id IS NOT NULL`),
  ],
);

export const postsRelations = relations(posts, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [posts.organizationId],
    references: [organizations.id],
  }),
  socialAccount: one(socialAccounts, {
    fields: [posts.socialAccountId],
    references: [socialAccounts.id],
  }),
  ad: one(ads, { fields: [posts.adId], references: [ads.id] }),
  comments: many(comments),
}));

export const commentAuthorsRelations = relations(commentAuthors, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [commentAuthors.organizationId],
    references: [organizations.id],
  }),
  comments: many(comments),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  organization: one(organizations, {
    fields: [comments.organizationId],
    references: [organizations.id],
  }),
  socialAccount: one(socialAccounts, {
    fields: [comments.socialAccountId],
    references: [socialAccounts.id],
  }),
  post: one(posts, { fields: [comments.postId], references: [posts.id] }),
  ad: one(ads, { fields: [comments.adId], references: [ads.id] }),
  author: one(commentAuthors, {
    fields: [comments.authorId],
    references: [commentAuthors.id],
  }),
  assignee: one(users, { fields: [comments.assignedTo], references: [users.id] }),
  parent: one(comments, {
    relationName: 'comment_parent',
    fields: [comments.parentCommentId],
    references: [comments.id],
  }),
  threadRoot: one(comments, {
    relationName: 'comment_thread_root',
    fields: [comments.threadRootId],
    references: [comments.id],
  }),
}));
