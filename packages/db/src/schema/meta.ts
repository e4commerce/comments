/**
 * Conexões Meta e ativos — §6.3 do PRD [NORMATIVO].
 *
 * Toda coluna de token termina em `_encrypted` por exigência explícita do §5.2: o nome
 * torna o contrato visível no call site. O conteúdo é AES-256-GCM com prefixo de versão
 * (`v1:<iv>:<tag>:<ciphertext>`), o que permite rotacionar `ENCRYPTION_KEY` sem downtime.
 */

import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { connectionStatusEnum, platformEnum } from './enums';
import { organizations, users } from './organizations';

export const metaConnections = pgTable(
  'meta_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    connectedBy: uuid('connected_by').references(() => users.id),
    metaUserId: text('meta_user_id').notNull(),
    metaUserName: text('meta_user_name'),
    accessTokenEncrypted: text('access_token_encrypted').notNull(),
    /**
     * `long_lived_user` (padrão) ou `system_user`. O System User token é a forma estável
     * de operação em produção porque não depende da sessão de um indivíduo (§5.2), e é
     * configurado por organização — nunca por variável de ambiente.
     */
    tokenType: text('token_type').notNull().default('long_lived_user'),
    grantedScopes: text('granted_scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: connectionStatusEnum('status').notNull().default('active'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    dataAccessExpiresAt: timestamp('data_access_expires_at', { withTimezone: true }),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    lastError: jsonb('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('meta_connections_org_user_key').on(t.organizationId, t.metaUserId),
    // O job diário de debug_token (§5.2) varre por status e data de verificação.
    index('meta_connections_verify_idx').on(t.status, t.lastVerifiedAt),
  ],
);

export const socialAccounts = pgTable(
  'social_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'cascade' }),
    platform: platformEnum('platform').notNull(),
    /** page_id (facebook) ou ig_user_id (instagram). */
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    username: text('username'),
    pictureUrl: text('picture_url'),
    followersCount: integer('followers_count'),
    category: text('category'),
    /** Somente facebook. */
    pageAccessTokenEncrypted: text('page_access_token_encrypted'),
    /** Para instagram, a página do Facebook vinculada. */
    linkedPageId: text('linked_page_id'),
    /** MODERATE, MANAGE, CREATE_CONTENT, etc. */
    tasks: text('tasks')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * Derivado de `tasks` conter MODERATE. Desde a v11.0 da Graph API os IDs de
     * comentário em posts de página só são retornados a aplicações com essa tarefa
     * (§5.3), então sem ela não há moderação — e o §15 exige avisar o usuário em vez
     * de falhar silenciosamente.
     */
    canModerate: boolean('can_moderate').notNull().default(false),
    webhookSubscribed: boolean('webhook_subscribed').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    status: connectionStatusEnum('status').notNull().default('active'),
    backfillCompletedAt: timestamp('backfill_completed_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    /** Última leitura de X-App-Usage e X-Business-Use-Case-Usage (§5.6). */
    rateLimitSnapshot: jsonb('rate_limit_snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('social_accounts_org_platform_external_key').on(
      t.organizationId,
      t.platform,
      t.externalId,
    ),
    // O handler de webhook resolve a conta a partir de `entry.id`, sem saber a
    // organização ainda: esse lookup precisa ser por (platform, external_id).
    index('social_accounts_external_idx').on(t.platform, t.externalId),
    index('social_accounts_connection_idx').on(t.connectionId),
  ],
);

export const adAccounts = pgTable(
  'ad_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'cascade' }),
    /** Formato act_XXXX. */
    externalId: text('external_id').notNull(),
    name: text('name'),
    currency: text('currency'),
    isActive: boolean('is_active').notNull().default(true),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ad_accounts_org_external_key').on(t.organizationId, t.externalId)],
);

export const ads = pgTable(
  'ads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    adAccountId: uuid('ad_account_id')
      .notNull()
      .references(() => adAccounts.id, { onDelete: 'cascade' }),
    externalAdId: text('external_ad_id').notNull(),
    name: text('name'),
    status: text('status'),
    campaignId: text('campaign_id'),
    campaignName: text('campaign_name'),
    adsetId: text('adset_id'),
    adsetName: text('adset_name'),
    creativeId: text('creative_id'),
    /** Publicação subjacente do criativo; é onde os comentários realmente vivem (§5.5). */
    effectiveObjectStoryId: text('effective_object_story_id'),
    effectiveInstagramMediaId: text('effective_instagram_media_id'),
    /**
     * Falso quando o dark post não retorna comentários apesar de os metadados do
     * criativo estarem visíveis — condição conhecida e sem solução via API (§5.5, §15).
     * O sistema degrada graciosamente e informa o usuário em vez de falhar em loop.
     */
    commentsAvailable: boolean('comments_available').notNull().default(true),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ads_org_external_key').on(t.organizationId, t.externalAdId),
    // Os dois índices do §6.3: resolvem "de qual anúncio veio este comentário" a partir
    // do objeto retornado pela API, que é o caminho inverso do usado na sincronização.
    index('ads_story_idx').on(t.effectiveObjectStoryId),
    index('ads_ig_media_idx').on(t.effectiveInstagramMediaId),
    index('ads_account_idx').on(t.adAccountId),
  ],
);

export const metaConnectionsRelations = relations(metaConnections, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [metaConnections.organizationId],
    references: [organizations.id],
  }),
  connectedByUser: one(users, {
    fields: [metaConnections.connectedBy],
    references: [users.id],
  }),
  socialAccounts: many(socialAccounts),
  adAccounts: many(adAccounts),
}));

export const socialAccountsRelations = relations(socialAccounts, ({ one }) => ({
  organization: one(organizations, {
    fields: [socialAccounts.organizationId],
    references: [organizations.id],
  }),
  connection: one(metaConnections, {
    fields: [socialAccounts.connectionId],
    references: [metaConnections.id],
  }),
}));

export const adAccountsRelations = relations(adAccounts, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [adAccounts.organizationId],
    references: [organizations.id],
  }),
  connection: one(metaConnections, {
    fields: [adAccounts.connectionId],
    references: [metaConnections.id],
  }),
  ads: many(ads),
}));

export const adsRelations = relations(ads, ({ one }) => ({
  organization: one(organizations, {
    fields: [ads.organizationId],
    references: [organizations.id],
  }),
  adAccount: one(adAccounts, { fields: [ads.adAccountId], references: [adAccounts.id] }),
}));
