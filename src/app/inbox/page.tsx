import Link from 'next/link';
import { Suspense } from 'react';
import { RefreshCw } from 'lucide-react';
import { ActionButton } from '@/components/action-button';
import { CommentCard } from '@/components/comment-card';
import { CommentFilterManager } from '@/components/comment-filter-manager';
import { InboxFilters } from '@/components/inbox-filters';
import { Badge, EmptyState, PageHeader } from '@/components/ui';
import { formatNumber } from '@/lib/format';
import {
  countsByStatus,
  hasAnyAccount,
  listAccountOptions,
  listCommentFilters,
  listInbox,
} from '@/lib/queries';
import { requireSession } from '@/lib/session';
import { runSync } from '../actions';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | undefined>>;

export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  const currentUser = await requireSession();
  const params = await searchParams;

  if (!(await hasAnyAccount())) {
    return (
      <EmptyState title="Conecte seu Meta para começar">
        {currentUser.role === 'admin' ? (
          <>
            Nenhuma conta conectada ainda. Vá em{' '}
            <Link href="/settings" className="text-accent hover:underline">
              Configurações
            </Link>{' '}
            e autorize suas páginas.
          </>
        ) : (
          'Nenhuma conta Meta foi conectada ainda. Peça a um ADM para fazer a configuração.'
        )}
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

  const [accounts, commentFilters] = await Promise.all([
    listAccountOptions(),
    listCommentFilters(),
  ]);
  const [{ items, total, hasMore }, counts] = await Promise.all([
    listInbox(filters, page, commentFilters),
    countsByStatus(commentFilters),
  ]);

  const queryFor = (nextPage: number) => {
    const next = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== undefined) as [string, string][],
    );
    next.set('page', String(nextPage));
    return `/inbox?${next.toString()}`;
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Caixa de entrada"
        title="Comentários"
        description={
          <>
            <Badge tone="accent">{formatNumber(counts.new ?? 0)} a responder</Badge>{' '}
            <span className="ml-1">
              {formatNumber(counts.answered ?? 0)} respondidos · {formatNumber(counts.ignored ?? 0)}{' '}
              arquivados
            </span>
          </>
        }
        actions={
          <ActionButton action={runSync} pendingLabel="Sincronizando…">
            <RefreshCw size={14} strokeWidth={1.8} />
            Sincronizar
          </ActionButton>
        }
      />

      {currentUser.role === 'admin' && <CommentFilterManager filters={commentFilters} />}

      <Suspense fallback={null}>
        <InboxFilters accounts={accounts} />
      </Suspense>

      {items.length === 0 ? (
        <EmptyState title="Nada aqui com esses filtros">
          Ajuste os filtros acima, ou rode uma sincronização para buscar comentários novos.
        </EmptyState>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-line-subtle" />
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
              {formatNumber(total)} comentário(s) · urgência e recência
            </p>
            <span className="h-px flex-1 bg-line-subtle" />
          </div>
          <div className="space-y-4">
            {items.map((item) => (
              <CommentCard key={item.comment.id} item={item} />
            ))}
          </div>
        </>
      )}

      {(page > 0 || hasMore) && (
        <div className="flex items-center justify-between border-t border-line-subtle pt-5">
          {page > 0 ? (
            <Link href={queryFor(page - 1)} className="text-sm font-medium text-ink hover:underline">
              ← Anteriores
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-ink-muted">Página {page + 1}</span>
          {hasMore ? (
            <Link href={queryFor(page + 1)} className="text-sm font-medium text-ink hover:underline">
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
