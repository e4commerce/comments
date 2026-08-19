'use client';

import { useState, useTransition } from 'react';
import { EyeOff } from 'lucide-react';
import { setCountHiddenUnanswered } from '@/app/actions';
import { Card } from './ui';

export function CommentCountSettings({
  initialCountHiddenUnanswered,
}: {
  initialCountHiddenUnanswered: boolean;
}) {
  const [enabled, setEnabled] = useState(initialCountHiddenUnanswered);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    setFeedback(null);

    startTransition(async () => {
      const result = await setCountHiddenUnanswered(next);
      if (!result.ok) setEnabled(!next);
      setFeedback({
        ok: result.ok,
        message: result.message ?? (result.ok ? 'Preferência salva.' : 'Não foi possível salvar.'),
      });
    });
  }

  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="flex min-w-0 gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <EyeOff size={16} strokeWidth={1.8} />
        </span>
        <div>
          <p className="text-sm font-medium">Contar ocultos em “A responder”</p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">
            Quando desativado, comentários ocultos que ainda não receberam resposta saem da fila e
            dos indicadores “A responder” e “Urgentes sem resposta”. Eles continuam disponíveis em
            “Todos”.
          </p>
          {feedback && (
            <p
              className={`mt-2 text-xs ${feedback.ok ? 'text-positive' : 'text-negative'}`}
              role="status"
            >
              {feedback.message}
            </p>
          )}
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Contar comentários ocultos sem resposta como a responder"
        disabled={pending}
        onClick={toggle}
        className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:cursor-wait disabled:opacity-60 ${
          enabled ? 'border-accent bg-accent' : 'border-line-strong bg-surface-muted'
        }`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white shadow-card transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </Card>
  );
}
