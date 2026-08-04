/**
 * Camada de inteligência artificial — §6.6 do PRD [NORMATIVO].
 *
 * A dimensão dos vetores é 1536 e vem de `EMBEDDING_DIMENSIONS` em @pulse/shared, não de
 * um literal solto: o endpoint `/api/v1/embeddings` do OpenRouter não expõe parâmetro
 * `dimensions`, então o modelo configurado tem de casar com a coluna. `env.ts` valida isso
 * no boot para que a falha apareça na subida do processo e não na primeira geração.
 */

import { EMBEDDING_DIMENSIONS } from '@pulse/shared/env';
import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { aiJobStatusEnum, intentLabelEnum, sentimentLabelEnum, urgencyLabelEnum } from './enums';
import { comments } from './content';
import { organizations, users } from './organizations';

export const aiAnalyses = pgTable(
  'ai_analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    sentiment: sentimentLabelEnum('sentiment').notNull(),
    /** -1.000 a 1.000 */
    sentimentScore: numeric('sentiment_score', { precision: 4, scale: 3 }).notNull(),
    /** 0.000 a 1.000 */
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    intent: intentLabelEnum('intent').notNull(),
    urgency: urgencyLabelEnum('urgency').notNull(),
    emotions: text('emotions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    language: text('language'),
    isQuestion: boolean('is_question').notNull().default(false),
    requiresResponse: boolean('requires_response').notNull().default(false),
    isToxic: boolean('is_toxic').notNull().default(false),
    toxicityTypes: text('toxicity_types')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    containsPii: boolean('contains_pii').notNull().default(false),
    piiTypes: text('pii_types')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isSpam: boolean('is_spam').notNull().default(false),
    mentionsCompetitor: boolean('mentions_competitor').notNull().default(false),
    entities: jsonb('entities')
      .notNull()
      .default(sql`'[]'::jsonb`),
    summary: text('summary'),
    suggestedReply: text('suggested_reply'),
    reasoning: text('reasoning'),
    model: text('model').notNull(),
    modelVersion: text('model_version'),
    /**
     * Versionamento do prompt (§9.4). Faz parte da chave única com `comment_id`, o que
     * permite reprocessar com um prompt novo sem destruir a saída anterior e comparar
     * qualidade entre versões.
     */
    promptVersion: text('prompt_version').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    latencyMs: integer('latency_ms'),
    status: aiJobStatusEnum('status').notNull().default('succeeded'),
    errorMessage: text('error_message'),
    /** Correção humana. Nunca sobrescreve a saída do modelo (§9.6). */
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    humanSentiment: sentimentLabelEnum('human_sentiment'),
    humanIntent: intentLabelEnum('human_intent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_analyses_comment_prompt_key').on(t.commentId, t.promptVersion),
    index('ai_analyses_org_sentiment_idx').on(t.organizationId, t.sentiment, t.createdAt.desc()),
    index('ai_analyses_urgency_idx')
      .on(t.organizationId, t.urgency)
      .where(sql`urgency IN ('high','critical')`),
    // Painel de concordância IA versus humano (§9.6).
    index('ai_analyses_reviewed_idx')
      .on(t.organizationId, t.reviewedAt.desc())
      .where(sql`reviewed_at IS NOT NULL`),
  ],
);

export const aiTopics = pgTable(
  'ai_topics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** produto, logistica, atendimento, preco, ... */
    category: text('category'),
    parentTopicId: uuid('parent_topic_id').references((): AnyPgColumn => aiTopics.id, {
      onDelete: 'set null',
    }),
    keywords: text('keywords')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    centroid: vector('centroid', { dimensions: EMBEDDING_DIMENSIONS }),
    /** true = criado manualmente; a descoberta automática não pode alterá-lo (§8.4). */
    isManaged: boolean('is_managed').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    commentCount: integer('comment_count').notNull().default(0),
    avgSentiment: numeric('avg_sentiment', { precision: 4, scale: 3 }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_topics_org_name_key').on(t.organizationId, t.name),
    // A taxonomia ativa é injetada no prompt de classificação em lote (§9.2).
    index('ai_topics_org_active_idx')
      .on(t.organizationId, t.isActive)
      .where(sql`is_active = true`),
  ],
);

export const commentTopics = pgTable(
  'comment_topics',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => aiTopics.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    relevance: numeric('relevance', { precision: 4, scale: 3 }).notNull().default('1.0'),
    isPrimary: boolean('is_primary').notNull().default(false),
    /** ai | human | rule */
    assignedBy: text('assigned_by').notNull().default('ai'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.commentId, t.topicId] }),
    index('comment_topics_topic_idx').on(t.organizationId, t.topicId, t.createdAt.desc()),
  ],
);

export const commentEmbeddings = pgTable(
  'comment_embeddings',
  {
    commentId: uuid('comment_id')
      .primaryKey()
      .references(() => comments.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    model: text('model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('comment_embeddings_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    // A busca semântica do §7.2 é sempre escopada por organização; sem este índice a
    // varredura do HNSW cruzaria tenants antes do filtro.
    index('comment_embeddings_org_idx').on(t.organizationId),
  ],
);

export const aiUsageLog = pgTable(
  'ai_usage_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** classify | embed | topic_naming | summary | suggest_reply */
    jobType: text('job_type').notNull(),
    model: text('model').notNull(),
    /** ID retornado pelo OpenRouter; permite consultar custo exato em /generation (§9.1). */
    generationId: text('generation_id'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    itemsProcessed: integer('items_processed').notNull().default(1),
    success: boolean('success').notNull().default(true),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_usage_org_date_idx').on(t.organizationId, t.createdAt.desc())],
);

export const aiAnalysesRelations = relations(aiAnalyses, ({ one }) => ({
  organization: one(organizations, {
    fields: [aiAnalyses.organizationId],
    references: [organizations.id],
  }),
  comment: one(comments, { fields: [aiAnalyses.commentId], references: [comments.id] }),
  reviewer: one(users, { fields: [aiAnalyses.reviewedBy], references: [users.id] }),
}));

export const aiTopicsRelations = relations(aiTopics, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [aiTopics.organizationId],
    references: [organizations.id],
  }),
  parent: one(aiTopics, {
    relationName: 'topic_parent',
    fields: [aiTopics.parentTopicId],
    references: [aiTopics.id],
  }),
  commentTopics: many(commentTopics),
}));

export const commentTopicsRelations = relations(commentTopics, ({ one }) => ({
  comment: one(comments, { fields: [commentTopics.commentId], references: [comments.id] }),
  topic: one(aiTopics, { fields: [commentTopics.topicId], references: [aiTopics.id] }),
}));

export const commentEmbeddingsRelations = relations(commentEmbeddings, ({ one }) => ({
  comment: one(comments, { fields: [commentEmbeddings.commentId], references: [comments.id] }),
}));
