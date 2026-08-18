/**
 * Validação de ambiente em dois níveis: o que o processo precisa para subir, e
 * o que uma feature precisa para funcionar.
 *
 * Um `META_APP_ID` ausente não deve impedir a plataforma de subir — deve
 * impedir só a conexão com o Meta, e dizer o nome do que falta. Placeholder é
 * pior que ausência: passa pela validação e falha depois como erro opaco da
 * Graph API, longe da causa.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `Variável de ambiente obrigatória ausente: ${name}. ` +
        `Copie .env.example para .env e preencha.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value : fallback;
}

/** Configuração base, validada quando cada valor é usado. */
export const env = {
  get appUrl() {
    const url = required('APP_URL').replace(/\/+$/, '');
    if (process.env.NODE_ENV === 'production' && !url.startsWith('https://')) {
      throw new Error('APP_URL deve usar https em produção — o Meta rejeita redirect http.');
    }
    return url;
  },
  get authSecret() {
    return required('AUTH_SECRET');
  },
  get encryptionKey() {
    return required('ENCRYPTION_KEY');
  },
  get graphVersion() {
    return optional('META_GRAPH_VERSION', 'v23.0');
  },
  get metaTimeoutMs() {
    return Number(optional('META_API_TIMEOUT_MS', '15000'));
  },
  get openRouterModel() {
    return optional('OPENROUTER_MODEL', 'google/gemini-2.5-flash');
  },
  get openRouterTitle() {
    return optional('OPENROUTER_APP_TITLE', 'Meta Comments');
  },
  get aiBatchSize() {
    return Math.max(1, Number(optional('AI_BATCH_SIZE', '25')));
  },
  get backfillDays() {
    return Math.max(1, Number(optional('BACKFILL_DAYS', '90')));
  },
  get autoSyncIntervalMinutes() {
    return Math.max(0, Number(optional('AUTO_SYNC_INTERVAL_MINUTES', '5')));
  },
  get syncConcurrency() {
    return Math.max(1, Math.min(10, Number(optional('SYNC_CONCURRENCY', '3'))));
  },
  get recentPostSyncDays() {
    return Math.max(1, Number(optional('RECENT_POST_SYNC_DAYS', '7')));
  },
  get reconcileHours() {
    return Math.max(1, Number(optional('SYNC_RECONCILE_HOURS', '24')));
  },
};

/** Exigidas somente quando um código de acesso vai ser enviado. */
export function requireResendConfig(): { apiKey: string; from: string } {
  return { apiKey: required('RESEND_API_KEY'), from: required('RESEND_FROM_EMAIL') };
}

export function hasResendConfig(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim());
}

/** Exigidas só quando algo vai efetivamente falar com a Graph API. */
export function requireMetaConfig(): { appId: string; appSecret: string } {
  return { appId: required('META_APP_ID'), appSecret: required('META_APP_SECRET') };
}

export function hasMetaConfig(): boolean {
  return Boolean(process.env.META_APP_ID?.trim() && process.env.META_APP_SECRET?.trim());
}

/** Exigida só pela análise de IA. A plataforma é útil sem ela. */
export function requireOpenRouterKey(): string {
  return required('OPENROUTER_API_KEY');
}

export function hasOpenRouterKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}
