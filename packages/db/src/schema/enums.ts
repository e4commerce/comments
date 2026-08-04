/**
 * Tipos enumerados — §6.1 do PRD [NORMATIVO].
 *
 * Nomes de tipo e de valor são transcrição literal. Não reordene os valores: a ordem
 * define o operador de comparação do enum no Postgres, e `sentiment_label` é comparado
 * por ordem nos agregados do §8.3.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const platformEnum = pgEnum('platform', ['facebook', 'instagram']);

export const memberRoleEnum = pgEnum('member_role', [
  'owner',
  'admin',
  'manager',
  'agent',
  'analyst',
]);

export const connectionStatusEnum = pgEnum('connection_status', [
  'active',
  'needs_reauth',
  'revoked',
  'error',
  'paused',
]);

export const sourceTypeEnum = pgEnum('source_type', [
  'organic_post',
  'reel',
  'story',
  'video',
  'live',
  'ad_comment',
  'album',
  'other',
]);

export const commentStatusEnum = pgEnum('comment_status', [
  'new',
  'in_progress',
  'replied',
  'resolved',
  'ignored',
  'archived',
]);

export const sentimentLabelEnum = pgEnum('sentiment_label', [
  'very_negative',
  'negative',
  'neutral',
  'positive',
  'very_positive',
]);

export const intentLabelEnum = pgEnum('intent_label', [
  'question',
  'complaint',
  'praise',
  'purchase_intent',
  'support_request',
  'suggestion',
  'spam',
  'troll',
  'off_topic',
  'other',
]);

export const urgencyLabelEnum = pgEnum('urgency_label', ['low', 'medium', 'high', 'critical']);

export const actionTypeEnum = pgEnum('action_type', [
  'reply_public',
  'reply_private',
  'hide',
  'unhide',
  'delete',
  'like',
  'unlike',
  'assign',
  'status_change',
  'tag',
  'untag',
]);

export const actionStatusEnum = pgEnum('action_status', [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
]);

export const aiJobStatusEnum = pgEnum('ai_job_status', [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'skipped',
]);
