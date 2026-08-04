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
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET precisa de no mínimo 32 caracteres'),
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),

    // --- E-mail ------------------------------------------------------------
    RESEND_API_KEY: z.string().min(1),
    EMAIL_FROM: z.string().min(3),

    // --- Meta --------------------------------------------------------------
    META_APP_ID: z.string().min(1),
    META_APP_SECRET: z.string().min(1),
    META_WEBHOOK_VERIFY_TOKEN: z.string().min(1),
    META_GRAPH_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/, 'META_GRAPH_VERSION deve ter a forma vNN.N, por exemplo v26.0')
      .default('v26.0'),
    META_API_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

    // --- Criptografia ------------------------------------------------------
    ENCRYPTION_KEY: z.string().min(1),

    // --- OpenRouter --------------------------------------------------------
    OPENROUTER_API_KEY: z.string().min(1),
    OPENROUTER_MODEL_PRIMARY: z.string().min(1),
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
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENCRYPTION_KEY'],
        message:
          `deve ser 32 bytes em base64 (recebido: ${decodedLength < 0 ? 'base64 inválido' : `${decodedLength} bytes`}). ` +
          'Gere com: openssl rand -base64 32',
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
export function getDerived(env: Env = getEnv()) {
  return {
    graphBaseUrl: `https://graph.facebook.com/${env.META_GRAPH_VERSION}`,
    /** Header HTTP-Referer exigido pelo OpenRouter (§9.1); derivado de APP_URL. */
    openRouterReferer: env.APP_URL,
    metaWebhookUrl: `${env.APP_URL.replace(/\/$/, '')}/api/webhooks/meta`,
    isProduction: env.NODE_ENV === 'production',
  } as const;
}
