import Link from 'next/link';
import { Suspense } from 'react';
import { CircleHelp, Inbox, MessageSquareText, Siren } from 'lucide-react';
import { AiSummary } from '@/components/ai-summary';
import { DailyVolumeChart, MotiveBars, SentimentShareBar } from '@/components/charts';
import { PeriodPicker } from '@/components/period-picker';
import { Card, EmptyState, Notice, PageHeader, SectionHeading } from '@/components/ui';
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
    <div className="space-y-8">
      <PageHeader
        eyebrow="Visão geral"
        title="Análise de comentários"
        description={
          <>
            {formatNumber(total)} comentários no banco · {analyzedShare} do período analisado por IA
          </>
        }
        actions={
          <Suspense fallback={null}>
            <PeriodPicker current={days} />
          </Suspense>
        }
      />

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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Comentários e respostas"
          value={formatNumber(overview.total)}
          icon={MessageSquareText}
        />
        <StatTile
          label="A responder"
          value={formatNumber(overview.pendingReply)}
          icon={Inbox}
          href={`/inbox?status=new&days=${days}`}
        />
        <StatTile
          label="Urgentes sem resposta"
          value={formatNumber(overview.highUrgency)}
          icon={Siren}
          tone={overview.highUrgency > 0 ? 'negative' : undefined}
          href={`/inbox?status=new&urgency=high&days=${days}`}
        />
        <StatTile
          label="Perguntas"
          value={formatNumber(overview.questions)}
          icon={CircleHelp}
          hint={overview.spam > 0 ? `${formatNumber(overview.spam)} marcados como spam` : undefined}
        />
      </div>

      <Card className="space-y-5 p-5 sm:p-6">
        <SectionHeading
          title="Volumetria diária"
          description={
            <>
            Cada comentário ou resposta de cliente conta como uma interação. A caixa agrupa essas
            respostas dentro da conversa. Horário de São Paulo.
            </>
          }
        />
        <DailyVolumeChart data={overview.daily} />
      </Card>

      {/* items-start: sem isso o card de sentimento estica até a altura do de
          motivos e sobra um vazio grande embaixo da barra. */}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card className="space-y-5 p-5 sm:p-6">
          <SectionHeading
            title="Sentimento do período"
            description={
              <>
              Participação sobre os comentários analisados, do negativo ao positivo.
              </>
            }
          />
          <SentimentShareBar sentiment={overview.sentiment} />
        </Card>

        <Card className="space-y-5 p-5 sm:p-6">
          <SectionHeading
            title="Principais motivos"
            description={
              <>
              Até 10 motivos, por volume. Clique na barra para ver os comentários.
              </>
            }
          />
          <MotiveBars
            motives={overview.motives}
            hrefBase={`/inbox?status=all&days=${days}&motive=`}
          />
        </Card>
      </div>

      <Card className="space-y-5 p-5 sm:p-6">
        <SectionHeading
          title="Leitura dos motivos"
          description="Interpretação em texto do que os motivos do período indicam."
        />
        <AiSummary days={days} disabled={!hasOpenRouterKey() || overview.motives.length === 0} />
      </Card>

      {overview.byPlatform.length > 1 && (
        <Card className="p-5 sm:p-6">
          <SectionHeading title="Por plataforma" />
          <ul className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            {overview.byPlatform.map((row) => (
              <li
                key={row.platform}
                className="flex items-center justify-between rounded-lg bg-surface-muted px-4 py-3"
              >
                <span className="font-medium">
                  {row.platform === 'instagram' ? 'Instagram' : 'Facebook'}:
                </span>
                <span className="font-display text-xl [font-variant-numeric:tabular-nums]">
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
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'negative';
  href?: string;
  icon: typeof MessageSquareText;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-ink-muted">{label}</p>
        <span
          className={`flex size-8 items-center justify-center rounded-lg ${
            tone === 'negative' ? 'bg-error-soft text-negative' : 'bg-surface-muted text-ink-secondary'
          }`}
        >
          <Icon size={15} strokeWidth={1.8} />
        </span>
      </div>
      <p
        className={`mt-5 font-display text-[34px] leading-none tracking-[-0.02em] ${
          tone === 'negative' ? 'text-negative' : ''
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={`group rounded-xl border bg-surface p-5 shadow-card transition-[background-color,border-color,transform] hover:-translate-y-0.5 hover:bg-surface-muted ${
          tone === 'negative' ? 'border-negative/25' : 'border-line-subtle'
        }`}
      >
        {body}
      </Link>
    );
  }
  return <Card className="p-5">{body}</Card>;
}
