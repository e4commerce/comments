'use client';

import { useActionState } from 'react';
import { Button, Card } from '@/components/ui';
import { requestLoginCode, verifyLoginCode } from './actions';

export function LoginForm() {
  const [requestState, requestAction, requesting] = useActionState(requestLoginCode, null);
  const [verifyState, verifyAction, verifying] = useActionState(verifyLoginCode, null);
  const requestedEmail = requestState?.ok ? requestState.email : undefined;

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Meta Comments</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Gestão e análise dos comentários do seu Facebook e Instagram.
      </p>

      <Card>
        {requestedEmail ? (
          <form action={verifyAction} className="space-y-3">
            <div>
              <h2 className="text-sm font-medium">Digite o código</h2>
              <p className="mt-1 text-xs text-ink-muted">
                Enviamos um código de 6 dígitos para <strong>{requestedEmail}</strong>.
              </p>
            </div>
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
              className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-center text-lg tracking-[0.35em] [font-variant-numeric:tabular-nums]"
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
            </Button>
            <a
              href="/login"
              className="block text-center text-xs text-ink-muted hover:text-ink hover:underline"
            >
              Usar outro e-mail
            </a>
          </form>
        ) : (
          <form action={requestAction} className="space-y-3">
            <div>
              <h2 className="text-sm font-medium">Acesse com seu e-mail</h2>
              <p className="mt-1 text-xs text-ink-muted">Você receberá um código para entrar.</p>
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
              className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm"
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
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
