'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ArrowUpDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { INBOX_SORT_OPTIONS } from '@/lib/inbox-sort';
import { MOTIVES, SENTIMENTS, SENTIMENT_LABELS, URGENCIES, URGENCY_LABELS } from '@/lib/taxonomy';
import { selectClass } from './ui';

/**
 * Filtros na URL, e não em estado do componente: a URL filtrada é
 * compartilhável e sobrevive ao recarregamento — "os negativos sobre entrega dos
 * últimos 7 dias" é um link.
 */
export function InboxFilters({
  accounts,
}: {
  accounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get('search') ?? '');

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === 'all' || (key === 'sort' && value === 'priority')) next.delete(key);
    else next.set(key, value);
    // Mudar filtro sem voltar à página 1 mostraria "nenhum resultado" numa
    // página que não existe mais.
    next.delete('page');
    startTransition(() => router.push(`/inbox?${next.toString()}`));
  }

  const current = (key: string, fallback = 'all') => params.get(key) ?? fallback;
  const advancedKeys = ['platform', 'sentiment', 'motive', 'urgency', 'accountId', 'days'];
  const advancedCount = advancedKeys.filter((key) => {
    const value = params.get(key);
    return Boolean(value && value !== 'all');
  }).length;

  function clearAdvanced() {
    const next = new URLSearchParams(params.toString());
    advancedKeys.forEach((key) => next.delete(key));
    next.delete('page');
    startTransition(() => router.push(`/inbox?${next.toString()}`));
  }

  return (
    <div
      className={`overflow-hidden rounded-xl border border-line-subtle bg-surface shadow-card transition-opacity ${
        pending ? 'opacity-60' : ''
      }`}
    >
      <div className="flex flex-col gap-3 p-3.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-surface-muted p-1">
          {[
            { value: 'new', label: 'A responder' },
            { value: 'answered', label: 'Respondidos' },
            { value: 'ignored', label: 'Arquivados' },
            { value: 'all', label: 'Todos' },
          ].map((option) => {
            const active = current('status', 'new') === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => update('status', option.value)}
                aria-pressed={active}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-inverse text-[var(--text-on-dark)]'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative min-w-0 sm:w-56">
            <span className="sr-only">Ordenar comentários</span>
            <ArrowUpDown
              size={14}
              strokeWidth={1.8}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
            />
            <select
              value={current('sort', 'priority')}
              onChange={(event) => update('sort', event.target.value)}
              className="w-full rounded-full border border-line bg-surface py-2 pl-9 pr-8 text-sm text-ink"
            >
              {INBOX_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              update('search', search);
            }}
            className="flex min-w-0 items-center gap-2"
          >
            <label className="relative min-w-0 flex-1 lg:w-72">
              <span className="sr-only">Buscar no texto</span>
              <Search
                size={14}
                strokeWidth={1.8}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar nos comentários…"
                className="w-full rounded-full border border-line bg-surface py-2 pl-9 pr-3 text-sm placeholder:text-ink-muted"
              />
            </label>
            <button
              type="submit"
              className="rounded-full border border-line bg-surface px-4 py-2 text-xs font-medium hover:bg-surface-muted"
            >
              Buscar
            </button>
          </form>
        </div>

      </div>

      <details className="group border-t border-line-subtle" open={advancedCount > 0}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink [&::-webkit-details-marker]:hidden">
          <SlidersHorizontal size={14} strokeWidth={1.8} />
          Filtros avançados
          {advancedCount > 0 && (
            <span className="flex size-5 items-center justify-center rounded-full bg-accent-soft text-[10px] text-accent">
              {advancedCount}
            </span>
          )}
          <span className="ml-auto transition-transform group-open:rotate-180">↓</span>
        </summary>

        <div className="border-t border-line-subtle bg-canvas/55 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Select
              label="Plataforma"
              value={current('platform')}
              onChange={(value) => update('platform', value)}
              options={[
                { value: 'all', label: 'Todas' },
                { value: 'facebook', label: 'Facebook' },
                { value: 'instagram', label: 'Instagram' },
              ]}
            />

            <Select
              label="Sentimento"
              value={current('sentiment')}
              onChange={(value) => update('sentiment', value)}
              options={[
                { value: 'all', label: 'Todos' },
                ...SENTIMENTS.map((s) => ({ value: s, label: SENTIMENT_LABELS[s] })),
              ]}
            />

            <Select
              label="Motivo"
              value={current('motive')}
              onChange={(value) => update('motive', value)}
              options={[
                { value: 'all', label: 'Todos' },
                ...MOTIVES.map((m) => ({ value: m.id, label: m.label })),
              ]}
            />

            <Select
              label="Urgência"
              value={current('urgency')}
              onChange={(value) => update('urgency', value)}
              options={[
                { value: 'all', label: 'Todas' },
                ...URGENCIES.map((u) => ({ value: u, label: URGENCY_LABELS[u] })),
              ]}
            />

            {accounts.length > 1 && (
              <Select
                label="Conta"
                value={current('accountId')}
                onChange={(value) => update('accountId', value)}
                options={[
                  { value: 'all', label: 'Todas' },
                  ...accounts.map((account) => ({ value: account.id, label: account.name })),
                ]}
              />
            )}

            <Select
              label="Período"
              value={current('days')}
              onChange={(value) => update('days', value)}
              options={[
                { value: 'all', label: 'Todo o histórico' },
                { value: '7', label: 'Últimos 7 dias' },
                { value: '30', label: 'Últimos 30 dias' },
                { value: '90', label: 'Últimos 90 dias' },
              ]}
            />
          </div>

          {advancedCount > 0 && (
            <button
              type="button"
              onClick={clearAdvanced}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink"
            >
              <X size={13} strokeWidth={1.8} />
              Limpar filtros avançados
            </button>
          )}
        </div>
      </details>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={selectClass}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
