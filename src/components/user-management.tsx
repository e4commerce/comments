'use client';

import { useActionState } from 'react';
import { UserPlus, Users } from 'lucide-react';
import { addUser, toggleUserActive } from '@/app/actions';
import { ActionButton } from './action-button';
import { Badge, Button, Card, SectionHeading, inputClass, selectClass } from './ui';

export interface ManagedUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
  isActive: boolean;
  lastLoginLabel: string;
}

export function UserManagement({
  users,
  currentUserId,
}: {
  users: ManagedUser[];
  currentUserId: string;
}) {
  const [state, formAction, pending] = useActionState(addUser, null);

  return (
    <section className="space-y-4">
      <SectionHeading
        title="Usuários"
        description="Somente e-mails ativos conseguem solicitar um código de acesso."
        action={
          <span className="flex size-9 items-center justify-center rounded-lg bg-surface-muted text-ink-secondary">
            <Users size={16} strokeWidth={1.8} />
          </span>
        }
      />

      <Card className="p-4 sm:p-5">
        <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <label className="sr-only" htmlFor="new-user-email">
              E-mail do usuário
            </label>
            <input
              id="new-user-email"
              name="email"
              type="email"
              required
              placeholder="pessoa@muranojoias.com.br"
              autoComplete="off"
              className={inputClass}
            />
          </div>
          <label className="sr-only" htmlFor="new-user-role">
            Perfil
          </label>
          <select
            id="new-user-role"
            name="role"
            defaultValue="user"
            className={`${selectClass} sm:w-auto`}
          >
            <option value="user">Usuário</option>
            <option value="admin">ADM</option>
          </select>
          <Button type="submit" variant="primary" disabled={pending} className="justify-center py-2">
            <UserPlus size={14} strokeWidth={1.8} />
            {pending ? 'Adicionando…' : 'Adicionar'}
          </Button>
        </form>
        {state?.message && (
          <p className={`mt-2 text-xs ${state.ok ? 'text-positive' : 'text-negative'}`} role="status">
            {state.message}
          </p>
        )}
      </Card>

      <div className="space-y-2">
        {users.map((user) => (
          <Card key={user.id} className="flex flex-wrap items-center gap-4 p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold">
              {user.email.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium">{user.email}</span>
                <Badge tone={user.role === 'admin' ? 'accent' : 'plain'}>
                  {user.role === 'admin' ? 'ADM' : 'Usuário'}
                </Badge>
                {user.id === currentUserId && <Badge tone="plain">Você</Badge>}
                {!user.isActive && <Badge tone="negative">Desativado</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-ink-muted">Último acesso: {user.lastLoginLabel}</p>
            </div>
            {user.id !== currentUserId && (
              <ActionButton
                action={toggleUserActive.bind(null, user.id)}
                variant={user.isActive ? 'danger' : 'secondary'}
                size="sm"
                confirm={user.isActive ? `Desativar o acesso de ${user.email}?` : undefined}
              >
                {user.isActive ? 'Desativar' : 'Reativar'}
              </ActionButton>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
