'use client';

import { useActionState } from 'react';
import { addCommentFilter, removeCommentFilter } from '@/app/actions';
import type { CommentFilter } from '@/db';
import { ActionButton } from './action-button';
import { Badge, Button, Card } from './ui';

export function CommentFilterManager({ filters }: { filters: CommentFilter[] }) {
  const [state, formAction, pending] = useActionState(addCommentFilter, null);

  return (
    <details className="group rounded-xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Filtros de comentários</span>
            {filters.length > 0 && <Badge tone="accent">{filters.length}</Badge>}
          </div>
          <p className="text-xs text-ink-muted">
            Regras gerais para ocultar palavras, números ou frases da fila.
          </p>
        </div>
        <span
          className="text-ink-muted transition-transform group-open:rotate-180"
          aria-hidden="true"
        >
          ↓
        </span>
      </summary>

      <div className="space-y-4 border-t border-line p-4">
        <p className="text-sm text-ink-muted">
          O filtro vale para Facebook, Instagram, todas as contas e todos os usuários. Ele não
          exclui nem arquiva comentários: apenas os oculta desta aba. A correspondência ignora
          maiúsculas e minúsculas e encontra o texto em qualquer parte do comentário.
        </p>

        <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <label className="sr-only" htmlFor="new-comment-filter">
              Palavra, número ou frase
            </label>
            <input
              id="new-comment-filter"
              name="pattern"
              type="text"
              required
              maxLength={100}
              autoComplete="off"
              placeholder="Palavra, número ou frase"
              className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm"
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            disabled={pending}
            className="w-full justify-center py-2 sm:w-auto"
          >
            {pending ? 'Adicionando…' : 'Adicionar filtro'}
          </Button>
        </form>

        {state?.message && (
          <p className={`text-xs ${state.ok ? 'text-positive' : 'text-negative'}`} role="status">
            {state.message}
          </p>
        )}

        {filters.length === 0 ? (
          <p className="text-xs text-ink-muted">Nenhum filtro adicionado.</p>
        ) : (
          <div className="space-y-2">
            {filters.map((filter) => (
              <Card key={filter.id} className="flex flex-wrap items-center gap-3 p-3">
                <code className="min-w-0 flex-1 break-words text-sm">{filter.pattern}</code>
                <ActionButton
                  action={removeCommentFilter.bind(null, filter.id)}
                  variant="danger"
                  size="sm"
                  confirm={`Remover o filtro “${filter.pattern}”? Os comentários correspondentes voltarão a aparecer.`}
                >
                  Remover
                </ActionButton>
              </Card>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
