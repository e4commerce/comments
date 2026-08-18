import Link from 'next/link';
import { Suspense } from 'react';
import { AiSummary } from '@/components/ai-summary';
import { DailyVolumeChart, MotiveBars, SentimentShareBar } from '@/components/charts';
import { PeriodPicker } from '@/components/period-picker';
import { Card, EmptyState, Notice } from '@/components/ui';
import { countPendingAnalysis } from '@/lib/ai';
import { hasOpenRouterKey } from '@/lib/env';
import { formatNumber, formatPercent } from '@/lib/format';
import { getOverview, hasAnyAccount, totalComments } from '@/lib/queries';
import { requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const currentUser = await requireSession();
  const params = await searchParams;

  if (!(await hasAnyAccount())) {
    return (
      <EmptyState title="Bem-vindo ao Meta Comments">
        {currentUser.role === 'admin' ? (
          <>
            Para começar, conecte suas páginas do Facebook e contas do Instagram em{' '}
            <Link href="/settings" className="text-accent hover:underline">
              Configurações
            </Link>
            .
          </>
        ) : (
          'Nenhuma conta Meta foi conectada ainda. Peça a um ADM para fazer a configuração.'
        )}
      </EmptyState>
    );
  }

  const allowed = [7, 30, 90];
  const days = allowed.includes(Number(params.days)) ? Number(params.days) : 30;

  const [overview, pendingAnalysis, total] = await Promise.all([
    getOverview(days),
    countPendingAnalysis(),
    totalComments(),
  ]);

  const analyzedShare = formatPercent(overview.analyzed, overview.total);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Análise</h1>
          <p className="text-sm text-ink-muted">
            {formatNumber(total)} comentários no banco · {analyzedShare} do período analisado por IA
          </p>
        </div>
        <Suspense fallback={null}>
          <PeriodPicker current={days} />
        </Suspense>
      </div>

      {total === 0 && (
        <Notice tone="accent">
          Nenhum comentário ainda. Rode uma sincronização em{' '}
          <Link href="/settings" className="underline">
            Configurações
          </Link>
          .
        </Notice>
      )}

      {pendingAnalysis > 0 && hasOpenRouterKey() && (
        <Notice>
          {formatNumber(pendingAnalysis)} comentário(s) sem análise de IA. Os gráficos de
          sentimento e motivo só contam o que já foi analisado
          {currentUser.role === 'admin' ? (
            <>
              {' — '}
              <Link href="/settings" className="underline">
                analisar agora
              </Link>
            </>
          ) : (
            '.'
          )}
          {currentUser.role === 'admin' && '.'}
        </Notice>
      )}

      {!hasOpenRouterKey() && (
        <Notice>
          <strong>Sem análise de IA configurada.</strong> Volumetria funciona; sentimento e motivos
          ficam vazios
          {currentUser.role === 'admin' && (
            <>
              {' até preencher '} <code>OPENROUTER_API_KEY</code>
            </>
          )}
          .
        </Notice>
      )}

      {/* KPIs. Números que respondem "preciso agir agora?" antes dos gráficos. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Comentários no período" value={formatNumber(overview.total)} />
        <StatTile
          label="A responder"
          value={formatNumber(overview.pendingReply)}
          href="/inbox?status=new"
        />
        <StatTile
          label="Urgentes sem resposta"
          value={formatNumber(overview.highUrgency)}
          tone={overview.highUrgency > 0 ? 'negative' : undefined}
          href="/inbox?status=new&urgency=high"
        />
        <StatTile
          label="Perguntas"
          value={formatNumber(overview.questions)}
          hint={overview.spam > 0 ? `${formatNumber(overview.spam)} marcados como spam` : undefined}
        />
      </div>

      <Card className="space-y-3">
        <div>
          <h2 className="font-medium">Volumetria diária</h2>
          <p className="text-xs text-ink-muted">
            Pela data em que o comentário foi publicado, no horário de São Paulo. Dias sem
            comentário aparecem como zero.
          </p>
        </div>
        <DailyVolumeChart data={overview.daily} />
      </Card>

      {/* items-start: sem isso o card de sentimento estica até a altura do de
          motivos e sobra um vazio grande embaixo da barra. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <div>
            <h2 className="font-medium">Sentimento do período</h2>
            <p className="text-xs text-ink-muted">
              Participação sobre os comentários analisados, do negativo ao positivo.
            </p>
          </div>
          <SentimentShareBar sentiment={overview.sentiment} />
        </Card>

        <Card className="space-y-3">
          <div>
            <h2 className="font-medium">Principais motivos</h2>
            <p className="text-xs text-ink-muted">
              Até 10 motivos, por volume. Clique na barra para ver os comentários.
            </p>
          </div>
          <MotiveBars motives={overview.motives} hrefBase="/inbox?status=all&motive=" />
        </Card>
      </div>

      <Card className="space-y-3">
        <div>
          <h2 className="font-medium">Leitura dos motivos</h2>
          <p className="text-xs text-ink-muted">
            Interpretação em texto do que os motivos do período indicam.
          </p>
        </div>
        <AiSummary days={days} disabled={!hasOpenRouterKey() || overview.motives.length === 0} />
      </Card>

      {overview.byPlatform.length > 1 && (
        <Card>
          <h2 className="mb-2 font-medium">Por plataforma</h2>
          <ul className="flex flex-wrap gap-6 text-sm">
            {overview.byPlatform.map((row) => (
              <li key={row.platform}>
                <span className="text-ink-muted">
                  {row.platform === 'instagram' ? 'Instagram' : 'Facebook'}:
                </span>{' '}
                <span className="[font-variant-numeric:tabular-nums]">
                  {formatNumber(row.count)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/**
 * Ladrilho de indicador. Valor em figuras proporcionais (não tabular): um número
 * grande com dígitos de largura fixa fica visualmente solto.
 */
function StatTile({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'negative';
  href?: string;
}) {
  const body = (
    <>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === 'negative' ? 'text-negative' : ''}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="rounded-xl border border-line bg-surface p-4 transition-colors hover:bg-surface-muted"
      >
        {body}
      </Link>
    );
  }
  return <Card>{body}</Card>;
}
