'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input, Label } from '@/components/ui';
import type { ActionResult } from '@/app/actions';

type Action = (prev: ActionResult, form: FormData) => Promise<ActionResult>;

const initial: ActionResult = {};

export function SignInForm({ action }: { action: Action }) {
  const t = useTranslations('auth');
  const [state, submit, pending] = useActionState(action, initial);

  return (
    <form action={submit} className="space-y-4">
      {state.error !== undefined && <Alert tone="error">{state.error}</Alert>}

      <div>
        <Label htmlFor="email">{t('email')}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <div>
        <Label htmlFor="password">{t('password')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? '…' : t('signIn')}
      </Button>
    </form>
  );
}

export function SignUpForm({ action }: { action: Action }) {
  const t = useTranslations('auth');
  const [state, submit, pending] = useActionState(action, initial);

  return (
    <form action={submit} className="space-y-4">
      {state.error !== undefined && <Alert tone="error">{state.error}</Alert>}

      <div>
        <Label htmlFor="name">{t('name')}</Label>
        <Input id="name" name="name" autoComplete="name" required />
      </div>

      <div>
        <Label htmlFor="email">{t('email')}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <div>
        <Label htmlFor="password">{t('password')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="mt-1 text-[12px] text-[var(--color-ink-muted)]">
          {t('passwordHint')}
        </p>
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? '…' : t('signUp')}
      </Button>
    </form>
  );
}

export function CreateOrganizationForm({ action }: { action: Action }) {
  const t = useTranslations('onboarding');
  const [state, submit, pending] = useActionState(action, initial);

  return (
    <form action={submit} className="space-y-4">
      {state.error !== undefined && <Alert tone="error">{state.error}</Alert>}

      <div>
        <Label htmlFor="name">{t('orgName')}</Label>
        <Input id="name" name="name" placeholder={t('orgNamePlaceholder')} required autoFocus />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? '…' : t('create')}
      </Button>
    </form>
  );
}

export function InviteForm({ action, roles }: { action: Action; roles: readonly string[] }) {
  const t = useTranslations('team');
  const tRoles = useTranslations('roles');
  const [state, submit, pending] = useActionState(action, initial);

  return (
    <div className="space-y-4">
      <form action={submit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Label htmlFor="invite-email">{t('email')}</Label>
          <Input id="invite-email" name="email" type="email" required />
        </div>

        <div className="w-48">
          <Label htmlFor="invite-role">{t('role')}</Label>
          <select
            id="invite-role"
            name="role"
            defaultValue="agent"
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[14px]"
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {tRoles(role)}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? '…' : t('invite')}
        </Button>
      </form>

      {state.error !== undefined && <Alert tone="error">{state.error}</Alert>}

      {state.ok === true && state.emailDelivered === true && (
        <Alert tone="success">Convite enviado por e-mail.</Alert>
      )}

      {state.ok === true && state.inviteLink !== undefined && (
        <Alert tone="info">
          {t('emailNotSent')}
          <span className="mt-2 block break-all rounded bg-white px-2 py-1 font-mono text-[12px]">
            {state.inviteLink}
          </span>
        </Alert>
      )}
    </div>
  );
}
