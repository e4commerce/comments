import Link from 'next/link';
import { Suspense } from 'react';
import { ActionButton } from '@/components/action-button';
import { CommentCard } from '@/components/comment-card';
import { InboxFilters } from '@/components/inbox-filters';
import { Badge, EmptyState } from '@/components/ui';
import { formatNumber } from '@/lib/format';
import { countsByStatus, hasAnyAccount, listAccountOptions, listInbox } from '@/lib/queries';
import { requireSession } from '@/lib/session';
import { runSync } from '../actions';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | undefined>>;

export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const params = await searchParams;

  if (!(await hasAnyAccount())) {
    return (
      <EmptyState title="Conecte seu Meta para começar">
        Nenhuma conta conectada ainda. Vá em{' '}
        <Link href="/settings" className="text-accent hover:underline">
          Configurações
        </Link>{' '}
        e autorize suas páginas.
      </EmptyState>
    );
  }

  const page = Math.max(0, Number(params.page ?? 0) || 0);
  const filters = {
    // O default é a fila de trabalho, não "todos": abrir o inbox deve mostrar o
    // que falta responder.
    status: params.status ?? 'new',
    platform: params.platform,
    sentiment: params.sentiment,
    motive: params.motive,
    urgency: params.urgency,
    accountId: params.accountId,
    search: params.search,
    // Respostas de terceiros aparecem dentro da thread do comentário pai; na
    // fila elas só duplicariam o item.
    topLevelOnly: true,
  };

  const [{ items, total, hasMore }, accounts, counts] = await Promise.all([
    listInbox(filters, page),
    listAccountOptions(),
    countsByStatus(),
  ]);

  const queryFor = (nextPage: number) => {
    const next = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== undefined) as [string, string][],
    );
    next.set('page', String(nextPage));
    return `/inbox?${next.toString()}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Comentários</h1>
          <p className="text-sm text-ink-muted">
            <Badge tone="accent">{formatNumber(counts.new ?? 0)} a responder</Badge>{' '}
            <span className="ml-1">
              {formatNumber(counts.answered ?? 0)} respondidos · {formatNumber(counts.ignored ?? 0)}{' '}
              arquivados
            </span>
          </p>
        </div>
        <ActionButton action={runSync} pendingLabel="Sincronizando…">
          Sincronizar
        </ActionButton>
      </div>

      <Suspense fallback={null}>
        <InboxFilters accounts={accounts} />
      </Suspense>

      {items.length === 0 ? (
        <EmptyState title="Nada aqui com esses filtros">
          Ajuste os filtros acima, ou rode uma sincronização para buscar comentários novos.
        </EmptyState>
      ) : (
        <>
          <p className="text-xs text-ink-muted">
            {formatNumber(total)} comentário(s) · ordenados por urgência e depois por mais recente
          </p>
          <div className="space-y-3">
            {items.map((item) => (
              <CommentCard key={item.comment.id} item={item} />
            ))}
          </div>
        </>
      )}

      {(page > 0 || hasMore) && (
        <div className="flex items-center justify-between border-t border-line pt-4">
          {page > 0 ? (
            <Link href={queryFor(page - 1)} className="text-sm text-accent hover:underline">
              ← Anteriores
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-ink-muted">Página {page + 1}</span>
          {hasMore ? (
            <Link href={queryFor(page + 1)} className="text-sm text-accent hover:underline">
              Próximos →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
