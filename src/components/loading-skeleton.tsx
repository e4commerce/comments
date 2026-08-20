import type { ComponentProps } from 'react';

type SkeletonProps = ComponentProps<'span'>;

export function Skeleton({ className = '', ...props }: SkeletonProps) {
  return <span aria-hidden="true" className={`skeleton block ${className}`} {...props} />;
}

function HeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="flex flex-col gap-4 border-b border-line-subtle pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3 w-28 rounded" />
        <Skeleton className="mt-4 h-10 w-56 max-w-[72%] rounded-lg" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full rounded" />
      </div>
      {action && <Skeleton className="h-9 w-32 shrink-0 rounded-full" />}
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-line-subtle bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-28 rounded" />
        <Skeleton className="size-8 rounded-lg" />
      </div>
      <Skeleton className="mt-5 h-9 w-16 rounded-lg" />
    </div>
  );
}

function PanelSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className="rounded-xl border border-line-subtle bg-surface p-5 shadow-card sm:p-6">
      <Skeleton className="h-4 w-36 rounded" />
      <Skeleton className="mt-2 h-3 w-72 max-w-full rounded" />
      <div className={`mt-6 rounded-lg bg-surface-muted ${compact ? 'h-24' : 'h-52'}`}>
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    </div>
  );
}

export function CommentListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-xl border border-line-subtle bg-surface shadow-card"
        >
          <div className="space-y-4 p-5">
            <div className="flex items-start gap-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-32 rounded" />
                  <Skeleton className="h-5 w-20 rounded" />
                </div>
                <Skeleton className="mt-2 h-3 w-52 max-w-full rounded" />
              </div>
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-[72%] rounded" />
            </div>
            <div className="flex gap-2 border-t border-line-subtle pt-3">
              <Skeleton className="h-5 w-20 rounded" />
              <Skeleton className="h-5 w-24 rounded" />
            </div>
          </div>
          <div className="flex gap-2 border-t border-line-subtle bg-canvas/60 px-5 py-3.5">
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-20 rounded-full" />
            <Skeleton className="h-8 w-24 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PlatformLoadingSkeleton({
  variant = 'dashboard',
}: {
  variant?: 'dashboard' | 'inbox' | 'settings';
}) {
  return (
    <div className="space-y-7" role="status" aria-label="Carregando conteúdo">
      <span className="sr-only">Carregando conteúdo…</span>
      <HeaderSkeleton />

      {variant === 'dashboard' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <StatCardSkeleton key={index} />
            ))}
          </div>
          <PanelSkeleton />
          <div className="grid gap-4 xl:grid-cols-2">
            <PanelSkeleton compact />
            <PanelSkeleton compact />
          </div>
        </>
      )}

      {variant === 'inbox' && (
        <>
          <div className="rounded-xl border border-line-subtle bg-surface p-3.5 shadow-card">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <Skeleton className="h-10 w-full rounded-full lg:w-96" />
              <div className="flex gap-2">
                <Skeleton className="h-10 w-48 rounded-full" />
                <Skeleton className="h-10 flex-1 rounded-full lg:w-72" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-line-subtle" />
            <Skeleton className="h-3 w-40 rounded" />
            <span className="h-px flex-1 bg-line-subtle" />
          </div>
          <CommentListSkeleton />
        </>
      )}

      {variant === 'settings' && (
        <>
          <PanelSkeleton compact />
          <div className="space-y-4">
            <Skeleton className="h-4 w-48 rounded" />
            <PanelSkeleton compact />
            <PanelSkeleton />
          </div>
        </>
      )}
    </div>
  );
}
