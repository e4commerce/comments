/**
 * Infraestrutura operacional e métricas — §6.7 do PRD [NORMATIVO].
 */

import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { platformEnum, sourceTypeEnum } from './enums';
import { aiTopics } from './ai';
import { socialAccounts } from './meta';
import { organizations, users } from './organizations';

/** O Drizzle não tem `inet` nativo; §6.7 exige o tipo para audit_logs.ip_address. */
const inet = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'inet';
  },
});

/**
 * Payloads brutos de webhook.
 *
 * Sem `organization_id`, e isso é correto: no momento da recepção a organização ainda é
 * desconhecida — ela é resolvida a partir de `entry.id` contra `social_accounts` já no
 * job. É a única tabela de dados fora da RLS, e por isso o handler não pode expor nada
 * dela por API.
 *
 * A persistência do payload íntegro é obrigatória e não negociável: o §5.7 registra que
 * NÃO é possível consultar histórico de notificações de webhook na API. O que não for
 * capturado está perdido.
 *
 * ATENÇÃO à constraint `unique(payload_hash, received_at)` do §6.7: como `received_at`
 * tem DEFAULT now(), reentregas do mesmo payload recebem timestamps distintos e passam
 * pela constraint. Ela NÃO deduplica nada. A idempotência real está no job de ingestão,
 * pela chave do §5.7 (platform + external_comment_id + verb + hash). A constraint é
 * mantida porque o §6.7 é normativo, mas não deve ser tratada como proteção.
 * Ver Seção 4 do plano de execução.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** page | instagram */
    objectType: text('object_type').notNull(),
    signatureValid: boolean('signature_valid').notNull(),
    payload: jsonb('payload').notNull(),
    payloadHash: text('payload_hash').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processStatus: text('process_status').notNull().default('pending'),
    errorMessage: text('error_message'),
  },
  (t) => [
    unique('webhook_events_payload_hash_received_at_key').on(t.payloadHash, t.receivedAt),
    index('webhook_events_pending_idx').on(t.processStatus, t.receivedAt),
    // Investigar reentrega exige buscar por hash sem depender do timestamp.
    index('webhook_events_hash_idx').on(t.payloadHash),
  ],
);

export const syncJobs = pgTable(
  'sync_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    socialAccountId: uuid('social_account_id').references(() => socialAccounts.id, {
      onDelete: 'cascade',
    }),
    /** backfill | reconcile | ads_sync | token_refresh */
    jobType: text('job_type').notNull(),
    status: text('status').notNull().default('pending'),
    progress: numeric('progress', { precision: 5, scale: 2 }).notNull().default('0'),
    itemsProcessed: integer('items_processed').notNull().default(0),
    itemsTotal: integer('items_total'),
    cursor: text('cursor'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A interface mostra progresso do backfill por conta (§5.8).
    index('sync_jobs_account_idx').on(t.organizationId, t.socialAccountId, t.createdAt.desc()),
    index('sync_jobs_status_idx').on(t.status, t.createdAt),
  ],
);

export const automationRules = pgTable(
  'automation_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    priority: smallint('priority').notNull().default(100),
    /** Formato declarativo com `all`/`any` — contrato no §9.7. */
    conditions: jsonb('conditions').notNull(),
    actions: jsonb('actions').notNull(),
    /** Contas e páginas aplicáveis. */
    scope: jsonb('scope')
      .notNull()
      .default(sql`'{}'::jsonb`),
    runCount: integer('run_count').notNull().default(0),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // O motor avalia as regras ativas em ordem de prioridade após a análise de IA.
    index('automation_rules_active_idx')
      .on(t.organizationId, t.priority)
      .where(sql`is_active = true`),
  ],
);

export const savedViews = pgTable(
  'saved_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    filters: jsonb('filters').notNull(),
    isShared: boolean('is_shared').notNull().default(false),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('saved_views_org_user_idx').on(t.organizationId, t.userId, t.sortOrder)],
);

/**
 * Agregados diários. Fonte primária dos dashboards (§8).
 *
 * A unique do §6.7 inclui três colunas nuláveis. Em Postgres, NULLs são DISTINTOS em
 * unique constraints por padrão, então linhas de rollup com `social_account_id`,
 * `platform` ou `source_type` nulos duplicariam a cada execução do job de agregação —
 * e o §8 exige que a contagem do gráfico coincida com a da inbox. `NULLS NOT DISTINCT`
 * (PG15+, e o §3.1 especifica PG16) corrige isso.
 * Ver Seção 4 do plano de execução.
 */
export const metricsDaily = pgTable(
  'metrics_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    socialAccountId: uuid('social_account_id').references(() => socialAccounts.id, {
      onDelete: 'cascade',
    }),
    platform: platformEnum('platform'),
    sourceType: sourceTypeEnum('source_type'),
    commentsTotal: integer('comments_total').notNull().default(0),
    commentsReplied: integer('comments_replied').notNull().default(0),
    commentsHidden: integer('comments_hidden').notNull().default(0),
    commentsDeleted: integer('comments_deleted').notNull().default(0),
    sentimentVeryNegative: integer('sentiment_very_negative').notNull().default(0),
    sentimentNegative: integer('sentiment_negative').notNull().default(0),
    sentimentNeutral: integer('sentiment_neutral').notNull().default(0),
    sentimentPositive: integer('sentiment_positive').notNull().default(0),
    sentimentVeryPositive: integer('sentiment_very_positive').notNull().default(0),
    netSentimentScore: numeric('net_sentiment_score', { precision: 5, scale: 2 }),
    avgFirstResponseMinutes: numeric('avg_first_response_minutes', { precision: 10, scale: 2 }),
    medianFirstResponseMinutes: numeric('median_first_response_minutes', {
      precision: 10,
      scale: 2,
    }),
    slaBreaches: integer('sla_breaches').notNull().default(0),
    uniqueAuthors: integer('unique_authors').notNull().default(0),
    aiCostUsd: numeric('ai_cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('metrics_daily_org_date_account_platform_source_key')
      .on(t.organizationId, t.date, t.socialAccountId, t.platform, t.sourceType)
      .nullsNotDistinct(),
    index('metrics_daily_org_date_idx').on(t.organizationId, t.date.desc()),
  ],
);

export const topicMetricsDaily = pgTable(
  'topic_metrics_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => aiTopics.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    commentsTotal: integer('comments_total').notNull().default(0),
    avgSentiment: numeric('avg_sentiment', { precision: 4, scale: 3 }),
    shareOfVoice: numeric('share_of_voice', { precision: 5, scale: 2 }),
  },
  (t) => [
    uniqueIndex('topic_metrics_daily_org_topic_date_key').on(t.organizationId, t.topicId, t.date),
    // O ranking de motivos com tendência (§8.4) varre por período.
    index('topic_metrics_daily_org_date_idx').on(t.organizationId, t.date.desc()),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_logs_org_idx').on(t.organizationId, t.createdAt.desc())],
);

export const syncJobsRelations = relations(syncJobs, ({ one }) => ({
  organization: one(organizations, {
    fields: [syncJobs.organizationId],
    references: [organizations.id],
  }),
  socialAccount: one(socialAccounts, {
    fields: [syncJobs.socialAccountId],
    references: [socialAccounts.id],
  }),
}));

export const metricsDailyRelations = relations(metricsDaily, ({ one }) => ({
  organization: one(organizations, {
    fields: [metricsDaily.organizationId],
    references: [organizations.id],
  }),
  socialAccount: one(socialAccounts, {
    fields: [metricsDaily.socialAccountId],
    references: [socialAccounts.id],
  }),
}));

export const topicMetricsDailyRelations = relations(topicMetricsDaily, ({ one }) => ({
  topic: one(aiTopics, { fields: [topicMetricsDaily.topicId], references: [aiTopics.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  organization: one(organizations, {
    fields: [auditLogs.organizationId],
    references: [organizations.id],
  }),
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));
