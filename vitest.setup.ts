/**
 * Carrega o `.env` real, se existir, e completa o que falta com valores de teste.
 *
 * A ordem importa: os testes de banco precisam do `DATABASE_URL` de verdade, enquanto os
 * testes unitários só precisam que `getEnv()` valide. Variáveis vazias no `.env` (o caso
 * das chaves de Meta e OpenRouter antes da Fase 2) contam como ausentes — `??=` sozinho não
 * as substituiria, porque string vazia não é `undefined`.
 */

const ENV_KEYS_WITH_TEST_DEFAULTS = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  AUTH_SECRET: 'test-secret-nao-use-em-producao-0000000000',
  DATABASE_URL: 'postgresql://pulse_app:pulse_app_password@localhost:5432/pulse',
  DATABASE_URL_MIGRATOR: 'postgresql://pulse_owner:pulse_dev_password@localhost:5432/pulse',
  REDIS_URL: 'redis://localhost:6379',
  META_APP_ID: '000000000000000',
  META_APP_SECRET: 'test-app-secret',
  META_WEBHOOK_VERIFY_TOKEN: 'test-verify-token',
  META_GRAPH_VERSION: 'v26.0',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  OPENROUTER_API_KEY: 'test-openrouter-key',
  OPENROUTER_MODEL_PRIMARY: 'google/gemini-2.5-flash',
  RESEND_API_KEY: 'test-resend-key',
  EMAIL_FROM: 'Pulse <nao-responda@exemplo.com.br>',
} as const;

try {
  // Disponível no Node 20.12+. Silencioso quando o arquivo não existe.
  process.loadEnvFile('.env');
} catch {
  // Sem .env: os defaults abaixo cobrem os testes unitários.
}

// NODE_ENV do .env é `development`; nos testes tem de ser `test`, senão o ConsoleSender de
// e-mail não é selecionado e o Resend tentaria rede.
process.env.NODE_ENV = 'test';

for (const [key, fallback] of Object.entries(ENV_KEYS_WITH_TEST_DEFAULTS)) {
  const current = process.env[key];
  if (current === undefined || current.trim() === '') {
    process.env[key] = fallback;
  }
}
