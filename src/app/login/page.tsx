'use client';

import { useActionState } from 'react';
import { Button, Card } from '@/components/ui';
import { login } from '../actions';

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null);

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Meta Comments</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Gestão e análise dos comentários do seu Facebook e Instagram.
      </p>

      <Card>
        <form action={formAction} className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="password">
            Senha de acesso
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm"
          />
          {state && !state.ok && (
            <p className="text-sm text-negative" role="alert">
              {state.message}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={pending} className="w-full justify-center">
            {pending ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </Card>

      <p className="mt-4 text-xs text-ink-muted">
        A senha é a variável <code>APP_PASSWORD</code> do seu <code>.env</code>.
      </p>
    </div>
  );
}
