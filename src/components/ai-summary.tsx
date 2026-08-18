'use client';

import { useState, useTransition } from 'react';
import { Sparkles } from 'lucide-react';
import { summarizePeriod } from '@/app/actions';
import { Button } from './ui';

/**
 * Leitura em texto dos motivos do período.
 *
 * Sob demanda, e não gerado a cada carregamento da página: é uma chamada paga ao
 * modelo, e o dashboard é recarregado a cada troca de filtro.
 */
export function AiSummary({ days, disabled }: { days: number; disabled?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await summarizePeriod(days);
      if (result.ok) {
        setText(result.message ?? null);
        setError(null);
      } else {
        setError(result.message ?? 'Falha ao gerar o resumo.');
      }
    });
  }

  return (
    <div className="space-y-2">
      {text && <p className="text-sm whitespace-pre-wrap">{text}</p>}
      {error && (
        <p className="text-sm text-negative" role="alert">
          {error}
        </p>
      )}
      <Button size="sm" onClick={run} disabled={pending || disabled}>
        <Sparkles size={13} strokeWidth={1.8} />
        {pending ? 'Analisando…' : text ? 'Gerar de novo' : 'Interpretar com IA'}
      </Button>
    </div>
  );
}
