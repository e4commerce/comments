/**
 * Envio de e-mail.
 *
 * O provedor é Resend (decisão registrada na Seção 8 do plano de execução), mas todo
 * call site fala com a interface `EmailSender`. Trocar por SMTP depois é escrever uma
 * segunda implementação, não editar os pontos de uso — que já são cinco no PRD:
 * convites (§6.2), needs_reauth (§5.2), SLA (§7.7), anomalia de sentimento (§8.3) e
 * link de exportação (§8.7).
 */

import { Resend } from 'resend';
import { getEnv } from './env';
import { createLogger } from './logger';

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  /** Alternativa em texto puro. Recomendada: melhora entregabilidade. */
  text?: string;
  replyTo?: string;
}

export interface EmailSendResult {
  id: string | null;
  delivered: boolean;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

class ResendSender implements EmailSender {
  private readonly client: Resend;
  private readonly from: string;
  private readonly log = createLogger('email');

  constructor(apiKey: string, from: string) {
    this.client = new Resend(apiKey);
    this.from = from;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const { data, error } = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      ...(message.text === undefined ? {} : { text: message.text }),
      ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
    });

    if (error) {
      // Não logamos o corpo: convites e alertas de SLA carregam dado pessoal.
      this.log.error(
        { name: error.name, message: error.message, subject: message.subject },
        'falha ao enviar e-mail',
      );
      return { id: null, delivered: false };
    }

    this.log.info({ emailId: data?.id, subject: message.subject }, 'e-mail enviado');
    return { id: data?.id ?? null, delivered: true };
  }
}

/**
 * Implementação de desenvolvimento: escreve no log em vez de enviar.
 *
 * Existe para que o fluxo de convite da Fase 1 seja testável sem chave de Resend e
 * sem enviar e-mail de verdade para endereços reais durante o desenvolvimento.
 */
class ConsoleSender implements EmailSender {
  private readonly log = createLogger('email:console');

  send(message: EmailMessage): Promise<EmailSendResult> {
    this.log.warn(
      { to: message.to, subject: message.subject },
      'e-mail NÃO enviado (ConsoleSender). Conteúdo abaixo.',
    );
    // Intencional: em desenvolvimento o link do convite precisa ser copiável do terminal.
    this.log.info({ html: message.html }, 'corpo do e-mail');
    return Promise.resolve({ id: null, delivered: false });
  }
}

let sender: EmailSender | undefined;

export function getEmailSender(): EmailSender {
  if (sender) return sender;

  const env = getEnv();
  // A chave de teste do vitest.setup.ts não deve tentar rede.
  const isPlaceholder = env.RESEND_API_KEY.startsWith('test-');
  sender =
    isPlaceholder || env.NODE_ENV === 'test'
      ? new ConsoleSender()
      : new ResendSender(env.RESEND_API_KEY, env.EMAIL_FROM);
  return sender;
}

/** Apenas para testes. */
export function setEmailSender(custom: EmailSender | undefined): void {
  sender = custom;
}
