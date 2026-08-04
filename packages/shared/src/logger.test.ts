import { describe, expect, it } from 'vitest';
import { pino, type Logger } from 'pino';
import { buildLoggerOptions, __sensitiveFieldNames } from './logger';

/**
 * §11.3: "Nenhum token, segredo ou payload completo de webhook deve aparecer em logs."
 *
 * Testar redação exige capturar a saída real do Pino, porque a redação acontece no
 * serializador — inspecionar o objeto passado ao logger não prova nada.
 */
function capture(fn: (log: Logger) => void): string {
  const chunks: string[] = [];
  const stream = {
    write(chunk: string) {
      chunks.push(chunk);
    },
  };
  // Mesmas opções da aplicação, outro destino. Se a redação for afrouxada em
  // buildLoggerOptions, estes testes quebram.
  const log = pino({ ...buildLoggerOptions(), level: 'trace' }, stream as never);
  fn(log);
  return chunks.join('');
}

describe('redação de campos sensíveis no logger', () => {
  it('redige token na raiz', () => {
    const out = capture((log) => log.info({ access_token: 'EAAG-segredo-real' }, 'ok'));
    expect(out).not.toContain('EAAG-segredo-real');
    expect(out).toContain('[REDACTED]');
  });

  it('redige o payload bruto de webhook (§5.7 grava no banco, não no log)', () => {
    const out = capture((log) =>
      log.info({ payload: { entry: [{ id: '123', changes: [] }] } }, 'webhook recebido'),
    );
    expect(out).not.toContain('entry');
    expect(out).toContain('[REDACTED]');
  });

  it('redige a assinatura HMAC do header', () => {
    const out = capture((log) =>
      log.warn({ headers: { 'x-hub-signature-256': 'sha256=deadbeef' } }, 'assinatura inválida'),
    );
    expect(out).not.toContain('deadbeef');
  });

  it('redige token dentro de err', () => {
    const out = capture((log) => log.error({ err: { access_token: 'segredo' } }, 'falhou'));
    expect(out).not.toContain('segredo');
  });

  it('redige page_access_token_encrypted, o nome usado na coluna do §6.3', () => {
    const out = capture((log) =>
      log.info({ account: { page_access_token_encrypted: 'v1:abc:def' } }, 'conta'),
    );
    expect(out).not.toContain('v1:abc:def');
  });

  it('preserva os campos de correlação do §14', () => {
    const out = capture((log) =>
      log.info(
        {
          organization_id: 'org-1',
          trace_id: 'trace-1',
          job_id: 'job-1',
          social_account_id: 'acct-1',
        },
        'processado',
      ),
    );
    expect(out).toContain('org-1');
    expect(out).toContain('trace-1');
    expect(out).toContain('job-1');
    expect(out).toContain('acct-1');
  });

  it('cobre as grafias snake_case e camelCase dos mesmos segredos', () => {
    expect(__sensitiveFieldNames).toContain('access_token');
    expect(__sensitiveFieldNames).toContain('accessToken');
    expect(__sensitiveFieldNames).toContain('token_hash');
    expect(__sensitiveFieldNames).toContain('tokenHash');
  });
});
