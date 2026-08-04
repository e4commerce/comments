/**
 * Logger estruturado — §11.3 e §14 do PRD.
 *
 * Duas exigências do PRD moldam este arquivo:
 *
 *  §11.3 "Nenhum token, segredo ou payload completo de webhook deve aparecer em logs;
 *         o logger precisa ter redação automática de campos sensíveis por nome."
 *  §14   "Todo log deve ser estruturado em JSON com organization_id, trace_id, job_id e
 *         social_account_id quando aplicável, permitindo reconstruir o caminho completo
 *         de um comentário desde o webhook até a resposta publicada."
 *
 * A redação é por nome de campo e por caminho, e cobre as variações de grafia que
 * aparecem na prática (snake_case da Graph API, camelCase do nosso código).
 */

import { pino, type Logger, type LoggerOptions } from 'pino';

/**
 * O logger lê `LOG_LEVEL` e `NODE_ENV` direto de process.env, sem passar por `getEnv()`.
 *
 * Deliberado: se o logger dependesse da validação completa do ambiente, seria impossível
 * logar a própria falha de validação — e scripts que não precisam de configuração de Meta
 * ou OpenRouter (migrations, criação de roles) não conseguiriam nem emitir uma linha.
 * Logar é infraestrutura, não domínio.
 */
const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
type Level = (typeof LEVELS)[number];

function readLevel(): Level {
  const raw = process.env.LOG_LEVEL;
  return LEVELS.includes(raw as Level) ? (raw as Level) : 'info';
}

/**
 * Nomes de campo cujo valor nunca pode ser impresso.
 *
 * `payload` está aqui por causa do §11.3: o corpo bruto do webhook fica em
 * `webhook_events.payload` no banco, onde é obrigatório (§5.7), mas não no log.
 */
const SENSITIVE_FIELD_NAMES = [
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'accessToken',
  'access_token',
  'accessTokenEncrypted',
  'access_token_encrypted',
  'pageAccessToken',
  'page_access_token',
  'page_access_token_encrypted',
  'refreshToken',
  'refresh_token',
  'inputToken',
  'input_token',
  'appsecretProof',
  'appsecret_proof',
  'appSecret',
  'app_secret',
  'clientSecret',
  'client_secret',
  'encryptionKey',
  'ENCRYPTION_KEY',
  'META_APP_SECRET',
  'AUTH_SECRET',
  'OPENROUTER_API_KEY',
  'RESEND_API_KEY',
  'apiKey',
  'api_key',
  'authorization',
  'Authorization',
  'cookie',
  'Cookie',
  'setCookie',
  'set-cookie',
  'signature',
  'x-hub-signature-256',
  'tokenHash',
  'token_hash',
  'payload',
  'rawPayload',
  'raw',
] as const;

/**
 * Constrói os caminhos de redação. Pino exige caminhos explícitos, então cobrimos a
 * raiz e os invólucros usados no código: err, error, req, res, headers, ctx, data,
 * body, result, meta.
 */
function buildRedactPaths(): string[] {
  const wrappers = [
    '',
    'err.',
    'error.',
    'req.',
    'req.headers.',
    'res.',
    'res.headers.',
    'headers.',
    'ctx.',
    'data.',
    'body.',
    'result.',
    'meta.',
    'connection.',
    'account.',
    'job.data.',
    '*.',
  ];
  const paths: string[] = [];
  for (const wrapper of wrappers) {
    for (const field of SENSITIVE_FIELD_NAMES) {
      paths.push(`${wrapper}${field}`);
    }
  }
  return paths;
}

/**
 * Campos de correlação exigidos pelo §14. Tipados para que o call site não invente
 * nomes divergentes — reconstruir o caminho de um comentário depende de consistência.
 */
export interface LogContext {
  organization_id?: string;
  trace_id?: string;
  job_id?: string;
  social_account_id?: string;
  comment_id?: string;
  webhook_event_id?: string;
  user_id?: string;
  platform?: 'facebook' | 'instagram';
}

/**
 * Opções do logger. Exportado para que o teste de redação construa um logger sobre um
 * stream de captura usando exatamente esta configuração — em vez de inspecionar
 * internals do Pino, que é o que a primeira versão deste arquivo fazia e não funcionou.
 */
export function buildLoggerOptions(): LoggerOptions {
  return {
    level: readLevel(),
    redact: {
      paths: buildRedactPaths(),
      censor: '[REDACTED]',
      remove: false,
    },
    // `time` em ISO facilita correlacionar com a Graph API e com o Sentry.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    base: {
      env: process.env.NODE_ENV ?? 'development',
    },
  };
}

let rootLogger: Logger | undefined;

/** Logger raiz do processo. Prefira `createLogger` para ter o campo `service`. */
export function getLogger(): Logger {
  rootLogger ??= pino(buildLoggerOptions());
  return rootLogger;
}

/**
 * Logger de um serviço ou job. `service` aparece em todas as linhas, o que é o que
 * permite filtrar web, worker e scheduler separadamente no agregador de logs.
 */
export function createLogger(service: string, context: LogContext = {}): Logger {
  return getLogger().child({ service, ...context });
}

/** Deriva um logger com contexto adicional, preservando o que já existe. */
export function withContext(logger: Logger, context: LogContext): Logger {
  return logger.child(context);
}

/** Exposto para o teste de redação; não use em código de produção. */
export const __sensitiveFieldNames: readonly string[] = SENSITIVE_FIELD_NAMES;
