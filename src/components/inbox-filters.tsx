'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { MOTIVES, SENTIMENTS, SENTIMENT_LABELS, URGENCIES, URGENCY_LABELS } from '@/lib/taxonomy';

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
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    // Mudar filtro sem voltar à página 1 mostraria "nenhum resultado" numa
    // página que não existe mais.
    next.delete('page');
    startTransition(() => router.push(`/inbox?${next.toString()}`));
  }

  const current = (key: string, fallback = 'all') => params.get(key) ?? fallback;

  return (
    <div className={`flex flex-wrap items-end gap-2 ${pending ? 'opacity-60' : ''}`}>
      <Select
        label="Situação"
        value={current('status', 'new')}
        onChange={(value) => update('status', value)}
        options={[
          { value: 'new', label: 'A responder' },
          { value: 'answered', label: 'Respondidos' },
          { value: 'ignored', label: 'Arquivados' },
          { value: 'all', label: 'Todos' },
        ]}
      />

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

      <form
        onSubmit={(event) => {
          event.preventDefault();
          update('search', search);
        }}
        className="flex items-end gap-1"
      >
        <label className="block">
          <span className="mb-1 block text-xs text-ink-muted">Buscar no texto</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="palavra…"
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm hover:bg-surface-muted"
        >
          Buscar
        </button>
      </form>
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
      <span className="mb-1 block text-xs text-ink-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
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
