'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/** Janela de tempo do dashboard. Fica na URL, como os filtros do inbox. */
export function PeriodPicker({ current }: { current: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const options = [
    { days: 7, label: '7 dias' },
    { days: 30, label: '30 dias' },
    { days: 90, label: '90 dias' },
  ];

  function select(days: number) {
    const next = new URLSearchParams(params.toString());
    next.set('days', String(days));
    startTransition(() => router.push(`/?${next.toString()}`));
  }

  return (
    <div
      className={`inline-flex rounded-md border border-line bg-surface p-0.5 ${pending ? 'opacity-60' : ''}`}
      role="group"
      aria-label="Período"
    >
      {options.map((option) => (
        <button
          key={option.days}
          type="button"
          onClick={() => select(option.days)}
          aria-pressed={current === option.days}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            current === option.days
              ? 'bg-accent text-accent-ink'
              : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
