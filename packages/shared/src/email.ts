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
import { getEnv, requireEmailConfig } from './env';
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

/**
 * Devolve o remetente apropriado.
 *
 * Sem `RESEND_API_KEY` configurada, cai no `ConsoleSender` em vez de lançar: isso mantém o
 * fluxo de convite da Fase 1 testável antes de existir chave e domínio verificado no Resend,
 * com o link aparecendo no log. Em produção, um aviso é emitido — e-mail que não sai é falha
 * silenciosa, então precisa ao menos deixar rastro.
 */
export function getEmailSender(): EmailSender {
  if (sender) return sender;

  const env = getEnv();
  const canSend =
    env.NODE_ENV !== 'test' &&
    env.RESEND_API_KEY !== undefined &&
    env.EMAIL_FROM !== undefined &&
    !env.RESEND_API_KEY.startsWith('test-');

  if (canSend) {
    const { apiKey, from } = requireEmailConfig(env);
    sender = new ResendSender(apiKey, from);
  } else {
    if (env.NODE_ENV === 'production') {
      createLogger('email').warn(
        'RESEND_API_KEY ou EMAIL_FROM ausentes em produção: convites e alertas não serão ' +
          'enviados, apenas registrados em log.',
      );
    }
    sender = new ConsoleSender();
  }
  return sender;
}

/** Apenas para testes. */
export function setEmailSender(custom: EmailSender | undefined): void {
  sender = custom;
}
