'use client';

import { useState, useTransition } from 'react';
import type { ActionResult } from '@/app/actions';
import { Button } from './ui';

/**
 * Botão para uma server action que retorna resultado.
 *
 * Existe porque `<form action={...}>` engole a mensagem de retorno, e em
 * moderação a mensagem é o essencial: "o Meta recusou porque falta a tarefa
 * MODERATE" precisa chegar à tela, não ao log do servidor.
 */
export function ActionButton({
  action,
  children,
  pendingLabel,
  confirm,
  variant = 'secondary',
  size = 'md',
  onDone,
  disabled,
  title,
}: {
  action: () => Promise<ActionResult>;
  children: React.ReactNode;
  pendingLabel?: string;
  /** Texto de confirmação. Presente = pergunta antes (usado em excluir). */
  confirm?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  onDone?: (result: ActionResult) => void;
  disabled?: boolean;
  title?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  function run() {
    if (confirm && !window.confirm(confirm)) return;
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome);
      onDone?.(outcome);
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={run}
        disabled={pending || disabled}
        title={title}
      >
        {pending && pendingLabel ? pendingLabel : children}
      </Button>
      {result?.message && (
        <span
          className={`text-xs ${result.ok ? 'text-ink-muted' : 'text-negative'}`}
          role={result.ok ? undefined : 'alert'}
        >
          {result.message}
        </span>
      )}
    </span>
  );
}
