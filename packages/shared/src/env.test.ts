import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getEnv,
  getDerived,
  resetEnvCache,
  requireMetaConfig,
  requireOpenRouterConfig,
  requireEmailConfig,
  getIntegrationStatus,
  EMBEDDING_DIMENSIONS,
} from './env';

const original = { ...process.env };

function reset(): void {
  process.env = { ...original };
  resetEnvCache();
}

describe('validação de ambiente (§3.4)', () => {
  beforeEach(reset);
  afterEach(reset);

  it('aceita o ambiente completo do vitest.setup.ts', () => {
    const env = getEnv();
    expect(env.META_GRAPH_VERSION).toBe('v26.0');
    expect(env.AI_EMBEDDING_DIMENSIONS).toBe(EMBEDDING_DIMENSIONS);
  });

  it('memoiza: duas chamadas devolvem a mesma instância', () => {
    expect(getEnv()).toBe(getEnv());
  });

  it('falha listando TODAS as variáveis obrigatórias ausentes, não só a primeira', () => {
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    delete process.env.AUTH_SECRET;
    resetEnvCache();

    try {
      getEnv();
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('REDIS_URL');
      expect(message).toContain('AUTH_SECRET');
    }
  });

  it('sobe sem as credenciais de integração: elas são exigidas no ponto de uso', () => {
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    delete process.env.META_WEBHOOK_VERIFY_TOKEN;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    resetEnvCache();
    expect(() => getEnv()).not.toThrow();
  });

  it('trata string vazia como ausente — painéis de config gravam "" e não undefined', () => {
    process.env.META_APP_ID = '';
    process.env.AUTH_GOOGLE_ID = '   ';
    resetEnvCache();
    const env = getEnv();
    expect(env.META_APP_ID).toBeUndefined();
    expect(env.AUTH_GOOGLE_ID).toBeUndefined();
  });

  it('rejeita ENCRYPTION_KEY que não decodifica para exatamente 32 bytes', () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    resetEnvCache();
    expect(() => getEnv()).toThrowError(/ENCRYPTION_KEY.*16 bytes/s);
  });

  it('reporta o comprimento em CARACTERES, não só em bytes', () => {
    // Buffer.from(x, 'base64') descarta caracteres inválidos em silêncio, então colar o
    // comando em vez da saída dele gera uma chave curta e não um erro de formato. Sem o
    // número de caracteres na mensagem, o operador não percebe que colou a coisa errada.
    process.env.ENCRYPTION_KEY = 'openssl rand -base64 32';
    resetEnvCache();
    expect(() => getEnv()).toThrowError(/23 caracteres/);
  });

  it('aceita ENCRYPTION_KEY de 32 bytes', () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    resetEnvCache();
    expect(() => getEnv()).not.toThrow();
  });

  it('rejeita dimensão de embedding divergente da coluna vector(1536)', () => {
    process.env.AI_EMBEDDING_DIMENSIONS = '1024';
    resetEnvCache();
    expect(() => getEnv()).toThrowError(/AI_EMBEDDING_DIMENSIONS.*1536/s);
  });

  it('rejeita META_GRAPH_VERSION fora do formato vNN.N', () => {
    process.env.META_GRAPH_VERSION = '26';
    resetEnvCache();
    expect(() => getEnv()).toThrowError(/META_GRAPH_VERSION/);
  });

  it('rejeita AUTH_SECRET curto', () => {
    process.env.AUTH_SECRET = 'curto';
    resetEnvCache();
    expect(() => getEnv()).toThrowError(/AUTH_SECRET/);
  });

  it('rejeita metade da configuração do Google', () => {
    process.env.AUTH_GOOGLE_ID = 'algum-id';
    delete process.env.AUTH_GOOGLE_SECRET;
    resetEnvCache();
    expect(() => getEnv()).toThrowError(/AUTH_GOOGLE_SECRET/);
  });

  it('aceita nenhum dos dois campos do Google', () => {
    delete process.env.AUTH_GOOGLE_ID;
    delete process.env.AUTH_GOOGLE_SECRET;
    resetEnvCache();
    expect(() => getEnv()).not.toThrow();
  });

  it('exige https em APP_URL quando NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_URL = 'http://pulse.exemplo.com.br';
    resetEnvCache();
    expect(() => getEnv()).toThrowError(/APP_URL.*https/s);
  });

  it('DATABASE_URL_MIGRATOR é opcional: o runtime não deve carregar credencial de owner', () => {
    delete process.env.DATABASE_URL_MIGRATOR;
    resetEnvCache();
    expect(() => getEnv()).not.toThrow();
  });
});

describe('exigência no ponto de uso', () => {
  beforeEach(reset);
  afterEach(reset);

  it('requireMetaConfig lança nomeando o que falta e a fase que precisa', () => {
    delete process.env.META_APP_SECRET;
    delete process.env.META_WEBHOOK_VERIFY_TOKEN;
    resetEnvCache();
    try {
      requireMetaConfig();
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('META_APP_SECRET');
      expect(message).toContain('META_WEBHOOK_VERIFY_TOKEN');
      expect(message).not.toContain('META_APP_ID');
      expect(message).toContain('Fase 2');
    }
  });

  it('requireMetaConfig devolve a configuração quando presente', () => {
    process.env.META_APP_ID = 'app-id-de-teste';
    process.env.META_APP_SECRET = 'app-secret-de-teste';
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-token-de-teste';
    resetEnvCache();

    const config = requireMetaConfig();
    expect(config.appId).toBe('app-id-de-teste');
    expect(config.appSecret).toBe('app-secret-de-teste');
    expect(config.webhookVerifyToken).toBe('verify-token-de-teste');
    expect(config.graphVersion).toBe('v26.0');
    expect(config.timeoutMs).toBe(15_000);
  });

  it('requireOpenRouterConfig aponta a Fase 5 e usa APP_URL como referer', () => {
    expect(requireOpenRouterConfig().referer).toBe(getEnv().APP_URL);
    delete process.env.OPENROUTER_API_KEY;
    resetEnvCache();
    expect(() => requireOpenRouterConfig()).toThrowError(/OPENROUTER_API_KEY.*Fase 5/s);
  });

  it('requireEmailConfig aponta a Fase 1, onde os convites são entregáveis', () => {
    delete process.env.RESEND_API_KEY;
    resetEnvCache();
    expect(() => requireEmailConfig()).toThrowError(/RESEND_API_KEY.*Fase 1/s);
  });

  it('getIntegrationStatus reporta configuração sem expor valor', () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.AUTH_GOOGLE_ID;
    resetEnvCache();
    const status = getIntegrationStatus();
    expect(status.meta).toBe(true);
    expect(status.openRouter).toBe(false);
    expect(status.google).toBe(false);
    expect(JSON.stringify(status)).not.toContain('test-');
  });
});

describe('derivados', () => {
  beforeEach(reset);
  afterEach(reset);

  it('monta a base da Graph API a partir da versão configurada', () => {
    expect(getDerived().graphBaseUrl).toBe('https://graph.facebook.com/v26.0');
  });

  it('monta a URL de webhook sem barra dupla', () => {
    process.env.APP_URL = 'http://localhost:3000/';
    resetEnvCache();
    expect(getDerived().metaWebhookUrl).toBe('http://localhost:3000/api/webhooks/meta');
  });

  it('usa APP_URL como HTTP-Referer do OpenRouter (§9.1)', () => {
    expect(getDerived().openRouterReferer).toBe(getEnv().APP_URL);
  });
});
