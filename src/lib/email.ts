import { Resend } from 'resend';
import { requireResendConfig } from './env';

export async function sendLoginCode(email: string, code: string): Promise<void> {
  const config = requireResendConfig();
  const resend = new Resend(config.apiKey);
  const { error } = await resend.emails.send({
    from: config.from,
    to: email,
    subject: `${code} é seu código de acesso`,
    text:
      `Seu código para entrar no Meta Comments é ${code}.\n\n` +
      'Ele expira em 10 minutos e só pode ser usado uma vez. Se você não solicitou, ignore este e-mail.',
    html:
      '<div style="font-family:Arial,sans-serif;color:#20222a;max-width:520px;margin:auto">' +
      '<p style="font-size:14px;color:#666">Meta Comments</p>' +
      '<h1 style="font-size:22px;margin:24px 0 8px">Seu código de acesso</h1>' +
      `<p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:20px 0">${code}</p>` +
      '<p style="font-size:14px;line-height:1.5;color:#555">Ele expira em 10 minutos e só pode ser usado uma vez.</p>' +
      '<p style="font-size:12px;color:#777;margin-top:28px">Se você não solicitou este código, ignore este e-mail.</p>' +
      '</div>',
  });

  if (error) throw new Error(`O Resend recusou o envio: ${error.message}`);
}
