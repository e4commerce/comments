/**
 * Ações, eventos e respostas — §6.5 do PRD [NORMATIVO].
 *
 * `comment_actions` é o registro de intenção que sustenta o padrão do §4.2: a interface
 * grava `pending`, o worker executa contra a Graph API, o resultado vira `succeeded` ou
 * `failed` com o código de erro. A `idempotency_key` única por organização é o que impede
 * resposta duplicada quando um job é reprocessado (§11.2).
 */

import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actionStatusEnum, actionTypeEnum } from './enums';
import { comments } from './content';
import { organizations, users } from './organizations';

export const commentActions = pgTable(
  'comment_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: actionTypeEnum('action').notNull(),
    status: actionStatusEnum('status').notNull().default('pending'),
    /** Ex.: { "message": "..." } para reply_public. */
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    result: jsonb('result'),
    /** ID do comentário criado na plataforma, quando a ação o produz. */
    externalResultId: text('external_result_id'),
    errorCode: integer('error_code'),
    errorSubcode: integer('error_subcode'),
    errorMessage: text('error_message'),
    attempts: smallint('attempts').notNull().default(0),
    idempotencyKey: text('idempotency_key').notNull(),
    /** manual | automation | ai_suggested — a interface precisa distinguir (§9.7). */
    source: text('source').notNull().default('manual'),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('comment_actions_org_idempotency_key').on(t.organizationId, t.idempotencyKey),
    index('comment_actions_comment_idx').on(t.commentId, t.createdAt.desc()),
    index('comment_actions_pending_idx')
      .on(t.status, t.createdAt)
      .where(sql`status IN ('pending','processing')`),
  ],
);

export const commentEvents = pgTable(
  'comment_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    /** created, status_changed, assigned, replied, hidden, ... */
    eventType: text('event_type').notNull(),
    /** user | system | automation | platform */
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    fromValue: jsonb('from_value'),
    toValue: jsonb('to_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('comment_events_comment_idx').on(t.commentId, t.createdAt)],
);

export const replyTemplates = pgTable(
  'reply_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    body: text('body').notNull(),
    /** Atalho digitado no compositor, ex. `/frete` (§7.4). */
    shortcut: text('shortcut'),
    category: text('category'),
    usageCount: integer('usage_count').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('reply_templates_org_idx').on(t.organizationId),
    // A expansão por atalho no compositor precisa ser inequívoca dentro da organização.
    uniqueIndex('reply_templates_org_shortcut_key')
      .on(t.organizationId, t.shortcut)
      .where(sql`shortcut IS NOT NULL`),
  ],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#64748b'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tags_org_name_key').on(t.organizationId, t.name)],
);

export const commentTags = pgTable(
  'comment_tags',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.commentId, t.tagId] }),
    // Filtrar a inbox por etiqueta parte da tag, não do comentário.
    index('comment_tags_tag_idx').on(t.tagId),
  ],
);

export const commentActionsRelations = relations(commentActions, ({ one }) => ({
  organization: one(organizations, {
    fields: [commentActions.organizationId],
    references: [organizations.id],
  }),
  comment: one(comments, { fields: [commentActions.commentId], references: [comments.id] }),
  user: one(users, { fields: [commentActions.userId], references: [users.id] }),
}));

export const commentEventsRelations = relations(commentEvents, ({ one }) => ({
  organization: one(organizations, {
    fields: [commentEvents.organizationId],
    references: [organizations.id],
  }),
  comment: one(comments, { fields: [commentEvents.commentId], references: [comments.id] }),
  actor: one(users, { fields: [commentEvents.actorId], references: [users.id] }),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  organization: one(organizations, { fields: [tags.organizationId], references: [organizations.id] }),
  commentTags: many(commentTags),
}));

export const commentTagsRelations = relations(commentTags, ({ one }) => ({
  comment: one(comments, { fields: [commentTags.commentId], references: [comments.id] }),
  tag: one(tags, { fields: [commentTags.tagId], references: [tags.id] }),
}));
