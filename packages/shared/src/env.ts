/**
 * Validação de ambiente — §3.4 do PRD.
 *
 * Regras que este módulo impõe:
 *  - Variável obrigatória ausente derruba o processo no boot, com a lista completa
 *    do que falta. Falhar tarde e em produção é pior do que não subir.
 *  - Nenhum valor daqui pode chegar ao cliente. O guard de `window` abaixo é a
 *    última linha de defesa; o gate real é apps/web/src/__tests__/env-leak.test.ts.
 *  - `ENCRYPTION_KEY` e `AI_EMBEDDING_DIMENSIONS` são validados semanticamente, não
 *    só sintaticamente: chave de 31 bytes e vetor de 1024 dimensões passariam por um
 *    `z.string()` e quebrariam em runtime, longe da causa.
 */

// Checado via globalThis e não via `window` porque o tsconfig deste pacote não inclui a
// lib DOM — ele roda no worker e no scheduler, que não têm janela nenhuma.
if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
  throw new Error(
    '@pulse/shared/env foi importado em código de cliente. ' +
      'Segredos de servidor nunca podem cruzar essa fronteira (§3.4 do PRD).',
  );
}

import { z } from 'zod';

/**
 * Dimensão dos vetores em `comment_embeddings.embedding` e `ai_topics.centroid`.
 *
 * Fixa por decisão registrada na Seção 1 do plano de execução: o endpoint
 * `/api/v1/embeddings` do OpenRouter não expõe parâmetro `dimensions`, então a
 * escolha do modelo tem de casar com a coluna. Alterar este número exige migration
 * da coluna e reconstrução dos índices HNSW.
 */
export const EMBEDDING_DIMENSIONS = 1536;

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/**
 * String opcional que trata `''` como ausente.
 *
 * Painéis de configuração — o do Railway entre eles — gravam variável não preenchida como
 * string vazia, não como ausente. Sem este tratamento, `z.string().min(1).optional()`
 * rejeitaria `''` e o operador veria "Required" numa variável que ele acabou de criar.
 */
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

    // --- Banco -------------------------------------------------------------
    DATABASE_URL: z.string().url(),
    // Opcional em runtime: só `pnpm db:migrate` precisa do role dono das tabelas.
    // Exigi-lo no processo web forçaria a credencial de owner a viver no container
    // de aplicação, que é exatamente o que a separação de roles evita.
    DATABASE_URL_MIGRATOR: z.string().url().optional(),

    REDIS_URL: z.string().url(),

    // --- Aplicação ---------------------------------------------------------
    APP_URL: z.string().url(),
    AUTH_SECRET: z
      .string()
      .min(32, 'precisa de no mínimo 32 caracteres. Gere com: openssl rand -base64 32'),
    AUTH_GOOGLE_ID: optionalString,
    AUTH_GOOGLE_SECRET: optionalString,

    // --- Integrações externas ----------------------------------------------
    //
    // O §3.4 marca estas como obrigatórias, e são — para o sistema completo. Aqui elas são
    // OPCIONAIS no schema e exigidas no ponto de uso, por `requireMetaConfig()`,
    // `requireOpenRouterConfig()` e `requireEmailConfig()`.
    //
    // O motivo é concreto: exigi-las no boot durante a implementação faseada forçaria
    // preencher com valores falsos as credenciais de integrações que nenhum código ainda
    // consome. E um placeholder em produção é PIOR que um valor ausente — ele passa pela
    // validação e falha depois como erro opaco da Graph API, longe da causa. Exigir no
    // ponto de uso dá a mensagem certa no momento certo.
    RESEND_API_KEY: optionalString,
    EMAIL_FROM: optionalString,

    // --- Meta --------------------------------------------------------------
    META_APP_ID: optionalString,
    META_APP_SECRET: optionalString,
    META_WEBHOOK_VERIFY_TOKEN: optionalString,
    META_GRAPH_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/, 'META_GRAPH_VERSION deve ter a forma vNN.N, por exemplo v26.0')
      .default('v26.0'),
    META_API_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

    // --- Criptografia ------------------------------------------------------
    ENCRYPTION_KEY: z.string().min(1),

    // --- OpenRouter --------------------------------------------------------
    OPENROUTER_API_KEY: optionalString,
    OPENROUTER_MODEL_PRIMARY: z.string().min(1).default('google/gemini-2.5-flash'),
    OPENROUTER_MODEL_FALLBACK: z.string().optional(),
    OPENROUTER_MODEL_REASONING: z.string().optional(),
    OPENROUTER_EMBEDDING_MODEL: z.string().default('openai/text-embedding-3-small'),
    OPENROUTER_APP_TITLE: z.string().default('Pulse'),
    AI_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(EMBEDDING_DIMENSIONS),
    AI_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().optional(),

    // --- Ingestão ----------------------------------------------------------
    BACKFILL_DAYS: z.coerce.number().int().positive().max(365).default(90),
    RECONCILE_MAX_PAGES_PER_RUN: z.coerce.number().int().positive().default(20),

    // --- Privacidade -------------------------------------------------------
    RETENTION_MONTHS_DEFAULT: z.coerce.number().int().positive().default(24),

    // --- Observabilidade ---------------------------------------------------
    SENTRY_DSN: z.string().optional(),
    DEBUG_SQL: booleanish.optional(),
  })
  .superRefine((val, ctx) => {
    // AES-256-GCM exige exatamente 32 bytes. Validar o tamanho decodificado evita
    // um erro obscuro do node:crypto na primeira vez que um token for cifrado.
    let decodedLength = -1;
    try {
      decodedLength = Buffer.from(val.ENCRYPTION_KEY, 'base64').length;
    } catch {
      decodedLength = -1;
    }
    if (decodedLength !== 32) {
      // O comprimento em CARACTERES entra na mensagem junto com o de bytes porque
      // `Buffer.from(x, 'base64')` é permissivo: ele descarta silenciosamente qualquer
      // caractere inválido em vez de lançar. Colar o comando em vez da saída dele, ou um
      // valor truncado, produz uma chave curta e não um erro de formato — e sem o número de
      // caracteres o operador não tem como perceber que colou a coisa errada.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENCRYPTION_KEY'],
        message:
          `deve ser 32 bytes em base64, o que dá 44 caracteres terminando em "=". ` +
          `Recebido: ${String(val.ENCRYPTION_KEY.length)} caracteres, ` +
          `${decodedLength < 0 ? 'base64 inválido' : `${String(decodedLength)} bytes`}. ` +
          'Gere com `openssl rand -base64 32` e cole a SAÍDA do comando, a linha inteira. ' +
          'Se o banco já tem tokens cifrados, use a MESMA chave: trocá-la os torna ilegíveis.',
      });
    }

    if (val.AI_EMBEDDING_DIMENSIONS !== EMBEDDING_DIMENSIONS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_EMBEDDING_DIMENSIONS'],
        message:
          `deve ser ${EMBEDDING_DIMENSIONS} para casar com vector(${EMBEDDING_DIMENSIONS}) em ` +
          'comment_embeddings.embedding e ai_topics.centroid (§6.6). Trocar de modelo de ' +
          'embeddings com outra dimensão exige migration da coluna e dos índices HNSW.',
      });
    }

    // Google é opcional, mas metade da configuração é sempre erro de operador.
    const hasGoogleId = Boolean(val.AUTH_GOOGLE_ID);
    const hasGoogleSecret = Boolean(val.AUTH_GOOGLE_SECRET);
    if (hasGoogleId !== hasGoogleSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_GOOGLE_SECRET'],
        message:
          'AUTH_GOOGLE_ID e AUTH_GOOGLE_SECRET precisam ser definidos juntos, ou nenhum dos dois.',
      });
    }

    if (val.NODE_ENV === 'production' && val.APP_URL.startsWith('http://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_URL'],
        message:
          'em produção APP_URL precisa usar https: o callback do OAuth do Meta e os cookies ' +
          'de sessão exigem origem segura.',
      });
    }
  });

export type Env = z.infer<typeof schema>;

function formatIssues(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const key = issue.path.join('.') || '(raiz)';
    return `  • ${key}: ${issue.message}`;
  });
  return lines.join('\n');
}

let cached: Env | undefined;

/**
 * Lê e valida o ambiente. O resultado é memoizado: validar uma vez por processo
 * mantém o custo fora do caminho de request.
 */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      'Configuração de ambiente inválida.\n\n' +
        formatIssues(parsed.error) +
        '\n\nConsulte .env.example. O processo não vai subir com o ambiente incompleto — ' +
        'isso é intencional (§3.4 do PRD).',
    );
  }

  cached = parsed.data;
  return cached;
}

/** Apenas para testes: descarta a memoização. */
export function resetEnvCache(): void {
  cached = undefined;
}

/**
 * Derivados que mais de um pacote precisa, centralizados para não divergirem.
 */
/**
 * Exigências no ponto de uso.
 *
 * Cada função abaixo é a fronteira entre "o processo sobe" e "esta integração funciona".
 * Chame no início do módulo que realmente fala com o serviço externo — não no boot.
 */

function missingFrom(env: Env, keys: (keyof Env)[]): string[] {
  return keys.filter((key) => env[key] === undefined).map(String);
}

function integrationError(integration: string, missing: string[], fase: string): Error {
  return new Error(
    `${integration} não está configurado: ${missing.join(', ')} ` +
      `${missing.length === 1 ? 'está ausente' : 'estão ausentes'}. ` +
      `Necessário a partir da Fase ${fase}. Ver .env.example e docs/deploy-railway.md.`,
  );
}

export interface MetaConfig {
  appId: string;
  appSecret: string;
  webhookVerifyToken: string;
  graphVersion: string;
  timeoutMs: number;
}

export function requireMetaConfig(env: Env = getEnv()): MetaConfig {
  const missing = missingFrom(env, ['META_APP_ID', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN']);
  if (missing.length > 0) throw integrationError('Meta / Graph API', missing, '2');
  return {
    // Os non-null são seguros: `missingFrom` acabou de garantir que estão presentes.
    appId: env.META_APP_ID as string,
    appSecret: env.META_APP_SECRET as string,
    webhookVerifyToken: env.META_WEBHOOK_VERIFY_TOKEN as string,
    graphVersion: env.META_GRAPH_VERSION,
    timeoutMs: env.META_API_TIMEOUT_MS,
  };
}

export interface OpenRouterConfig {
  apiKey: string;
  modelPrimary: string;
  modelFallback: string | undefined;
  modelReasoning: string | undefined;
  embeddingModel: string;
  appTitle: string;
  referer: string;
}

export function requireOpenRouterConfig(env: Env = getEnv()): OpenRouterConfig {
  const missing = missingFrom(env, ['OPENROUTER_API_KEY']);
  if (missing.length > 0) throw integrationError('OpenRouter', missing, '5');
  return {
    apiKey: env.OPENROUTER_API_KEY as string,
    modelPrimary: env.OPENROUTER_MODEL_PRIMARY,
    modelFallback: env.OPENROUTER_MODEL_FALLBACK,
    modelReasoning: env.OPENROUTER_MODEL_REASONING,
    embeddingModel: env.OPENROUTER_EMBEDDING_MODEL,
    appTitle: env.OPENROUTER_APP_TITLE,
    referer: env.APP_URL,
  };
}

export interface EmailConfig {
  apiKey: string;
  from: string;
}

export function requireEmailConfig(env: Env = getEnv()): EmailConfig {
  const missing = missingFrom(env, ['RESEND_API_KEY', 'EMAIL_FROM']);
  if (missing.length > 0) throw integrationError('Envio de e-mail (Resend)', missing, '1');
  return { apiKey: env.RESEND_API_KEY as string, from: env.EMAIL_FROM as string };
}

/** Diagnóstico de boot: quais integrações estão configuradas. Sem valores, só nomes. */
export function getIntegrationStatus(env: Env = getEnv()) {
  return {
    meta: env.META_APP_ID !== undefined && env.META_APP_SECRET !== undefined,
    openRouter: env.OPENROUTER_API_KEY !== undefined,
    email: env.RESEND_API_KEY !== undefined && env.EMAIL_FROM !== undefined,
    google: env.AUTH_GOOGLE_ID !== undefined,
  } as const;
}

export function getDerived(env: Env = getEnv()) {
  return {
    graphBaseUrl: `https://graph.facebook.com/${env.META_GRAPH_VERSION}`,
    /** Header HTTP-Referer exigido pelo OpenRouter (§9.1); derivado de APP_URL. */
    openRouterReferer: env.APP_URL,
    metaWebhookUrl: `${env.APP_URL.replace(/\/$/, '')}/api/webhooks/meta`,
    isProduction: env.NODE_ENV === 'production',
  } as const;
}
