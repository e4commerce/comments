/**
 * Organizações, usuários e acessos — §6.2 do PRD [NORMATIVO].
 *
 * Os nomes de coluna são explícitos em todo o schema, apesar de `casing: 'snake_case'`
 * no drizzle.config.ts, porque o §6 é normativo quanto a nomes: deixar a conversão
 * implícita transformaria um erro de digitação em uma divergência silenciosa do contrato.
 *
 * Nota sobre `users`: as propriedades JS `image` e `emailVerified` mapeiam para as colunas
 * `avatar_url` e `email_verified` do §6.2. O adapter do Auth.js exige aqueles nomes de
 * propriedade; o PRD exige estes nomes de coluna. O mapeamento satisfaz os dois sem
 * inventar colunas.
 */

import { relations, sql } from 'drizzle-orm';
import {
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
} from 'drizzle-orm/pg-core';
import { memberRoleEnum } from './enums';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  locale: text('locale').notNull().default('pt-BR'),
  settings: jsonb('settings')
    .notNull()
    .default(sql`'{}'::jsonb`),
  aiBudgetUsd: numeric('ai_budget_usd', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  image: text('avatar_url'),
  passwordHash: text('password_hash'),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull().default('agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('memberships_org_user_key').on(t.organizationId, t.userId),
    // Resolver "quais organizações este usuário acessa" é a primeira query de todo
    // request autenticado.
    index('memberships_user_idx').on(t.userId),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: memberRoleEnum('role').notNull().default('agent'),
    // Armazenamos o hash, nunca o token: um convite vazado do banco não pode ser usado.
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Aceitar convite é uma busca por hash do token.
    uniqueIndex('invitations_token_hash_key').on(t.tokenHash),
    index('invitations_org_email_idx').on(t.organizationId, t.email),
  ],
);

// ---------------------------------------------------------------------------
// Tabelas do Auth.js (NextAuth v5) com adapter Drizzle.
//
// Não fazem parte do §6 porque o PRD não especifica o mecanismo de sessão além de
// "Sessões em banco, suporte a convites" (§3.1). São o contrato do adapter, não
// modelo de domínio, e por isso ficam separadas e sem `organization_id`: um usuário
// existe antes de pertencer a qualquer organização.
// ---------------------------------------------------------------------------

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<'oauth' | 'oidc' | 'email' | 'webauthn'>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    // `integer` e não `numeric`: é um timestamp Unix em segundos, e o adapter do Auth.js
    // tipa a coluna como PgInteger. Com numeric o build falha na atribuição do adapter.
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ---------------------------------------------------------------------------
// Relações
// ---------------------------------------------------------------------------

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  invitations: many(invitations),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  accounts: many(accounts),
  sessions: many(sessions),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberships.organizationId],
    references: [organizations.id],
  }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  organization: one(organizations, {
    fields: [invitations.organizationId],
    references: [organizations.id],
  }),
  inviter: one(users, { fields: [invitations.invitedBy], references: [users.id] }),
}));
