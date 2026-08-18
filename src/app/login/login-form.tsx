'use client';

import { useActionState } from 'react';
import { ArrowRight, BarChart3, MessageCircle, Sparkles } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button, Card, inputClass } from '@/components/ui';
import { requestLoginCode, verifyLoginCode } from './actions';

export function LoginForm() {
  const [requestState, requestAction, requesting] = useActionState(requestLoginCode, null);
  const [verifyState, verifyAction, verifying] = useActionState(verifyLoginCode, null);
  const requestedEmail = requestState?.ok ? requestState.email : undefined;
  const developmentCode = requestState?.ok ? requestState.developmentCode : undefined;

  return (
    <div className="relative grid min-h-screen bg-canvas lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
      <div className="absolute right-5 top-5 z-20">
        <ThemeToggle />
      </div>

      <section className="flex items-center justify-center px-5 py-20 sm:px-8">
        <div className="w-full max-w-[430px]">
          <div className="mb-9">
            <div className="mb-8 flex items-center gap-2.5 text-sm font-semibold tracking-tight">
              <span className="flex size-9 items-center justify-center rounded-xl bg-inverse text-xs text-[var(--text-on-dark)] shadow-card">
                M<span className="text-accent">•</span>
              </span>
              Meta Comments
            </div>
            <p className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
              <span className="size-1.5 rounded-sm bg-accent" />
              Central de comentários
            </p>
            <h1 className="max-w-sm font-display text-[42px] leading-[1.04] tracking-[-0.025em] sm:text-[48px]">
              Entenda. Responda. Evolua.
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-muted">
              Gestão e análise dos comentários do Facebook e Instagram em um só lugar.
            </p>
          </div>

          <Card className="p-6 sm:p-7">
            {requestedEmail ? (
              <form key="verify-code" action={verifyAction} className="space-y-4">
                <div>
                  <h2 className="text-base font-semibold">Digite o código</h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                    {developmentCode ? (
                      <>Use o código local para acessar <strong>{requestedEmail}</strong>.</>
                    ) : (
                      <>Enviamos um código de 6 dígitos para <strong>{requestedEmail}</strong>.</>
                    )}
                  </p>
                </div>

                {developmentCode && (
                  <div className="rounded-xl border border-accent/20 bg-accent-soft px-4 py-3 text-center">
                    <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-accent">
                      Código local · somente desenvolvimento
                    </p>
                    <code className="mt-1 block text-2xl font-semibold tracking-[0.25em] text-ink">
                      {developmentCode}
                    </code>
                  </div>
                )}

                <input type="hidden" name="email" value={requestedEmail} />
                <label className="sr-only" htmlFor="code">
                  Código de acesso
                </label>
                <input
                  id="code"
                  name="code"
                  type="text"
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="000000"
                  className={`${inputClass} bg-canvas text-center text-xl tracking-[0.35em] [font-variant-numeric:tabular-nums]`}
                />
                {verifyState && !verifyState.ok && (
                  <p className="text-sm text-negative" role="alert">
                    {verifyState.message}
                  </p>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  disabled={verifying}
                  className="w-full justify-center"
                >
                  {verifying ? 'Verificando…' : 'Entrar'}
                  {!verifying && <ArrowRight size={14} strokeWidth={1.8} />}
                </Button>
                <a
                  href="/login"
                  className="block text-center text-xs text-ink-muted hover:text-ink hover:underline"
                >
                  Usar outro e-mail
                </a>
              </form>
            ) : (
              <form key="request-code" action={requestAction} className="space-y-4">
                <div>
                  <h2 className="text-base font-semibold">Acesse com seu e-mail</h2>
                  <p className="mt-1.5 text-xs text-ink-muted">
                    Você receberá um código seguro para entrar.
                  </p>
                </div>
                <label className="sr-only" htmlFor="email">
                  E-mail
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  placeholder="voce@empresa.com.br"
                  className={`${inputClass} bg-canvas`}
                />
                {requestState && !requestState.ok && (
                  <p className="text-sm text-negative" role="alert">
                    {requestState.message}
                  </p>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  disabled={requesting}
                  className="w-full justify-center"
                >
                  {requesting ? 'Enviando…' : 'Enviar código'}
                  {!requesting && <ArrowRight size={14} strokeWidth={1.8} />}
                </Button>
              </form>
            )}
          </Card>
          <p className="mt-5 text-center text-[11px] text-ink-muted">
            Acesso restrito a usuários autorizados.
          </p>
        </div>
      </section>

      <aside className="relative hidden overflow-hidden bg-[#171614] p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-36 -top-28 size-[420px] rounded-full bg-[#7b5baa]/20 blur-3xl" />
        <div className="absolute -bottom-36 -left-24 size-[360px] rounded-full bg-[#e8551e]/10 blur-3xl" />

        <div className="relative z-10 flex items-center gap-2 text-xs text-white/60">
          <Sparkles size={14} strokeWidth={1.8} className="text-[#ed6b3b]" />
          Inteligência aplicada à operação
        </div>

        <div className="relative z-10 mx-auto w-full max-w-lg">
          <p className="font-display text-[38px] leading-[1.12] tracking-[-0.02em]">
            Da conversa dispersa à decisão clara.
          </p>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/55">
            Priorize o que exige ação, acompanhe o sentimento e transforme cada comentário em um
            sinal útil para o negócio.
          </p>

          <div className="mt-10 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
              <MessageCircle size={18} strokeWidth={1.6} className="text-[#ed6b3b]" />
              <p className="mt-7 text-3xl font-display">1 inbox</p>
              <p className="mt-1 text-xs text-white/45">Facebook e Instagram</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
              <BarChart3 size={18} strokeWidth={1.6} className="text-[#a28cc4]" />
              <div className="mt-7 flex h-8 items-end gap-1">
                {[38, 58, 44, 78, 62, 92, 70].map((height, index) => (
                  <span
                    key={index}
                    className="flex-1 rounded-sm bg-[#7b5baa]"
                    style={{ height: `${height}%`, opacity: 0.55 + index * 0.06 }}
                  />
                ))}
              </div>
              <p className="mt-2 text-xs text-white/45">Leitura contínua da operação</p>
            </div>
          </div>
        </div>

        <p className="relative z-10 text-[11px] text-white/30">Murano Joias · Growth operations</p>
      </aside>
    </div>
  );
}
