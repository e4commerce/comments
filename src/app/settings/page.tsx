import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { accounts, db, syncRuns } from '@/db';
import { ActionButton } from '@/components/action-button';
import { Badge, Button, Card, EmptyState, Notice } from '@/components/ui';
import { countPendingAnalysis } from '@/lib/ai';
import { hasMetaConfig, hasOpenRouterKey } from '@/lib/env';
import { requireSession } from '@/lib/session';
import { disconnectAccount, runAnalysis, runSync } from '../actions';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; conectadas?: string }>;
}) {
  await requireSession();
  const params = await searchParams;

  const connected = await db.select().from(accounts).orderBy(accounts.platform, accounts.name).all();
  const runs = await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(5).all();
  const pendingAnalysis = await countPendingAnalysis();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-ink-muted">Contas conectadas, sincronização e análise.</p>
      </div>

      {params.error && <Notice tone="negative">Falha ao conectar: {params.error}</Notice>}
      {params.conectadas && (
        <Notice tone="accent">
          {params.conectadas} página(s) processada(s). As contas aparecem abaixo — rode uma
          sincronização para trazer os comentários.
        </Notice>
      )}

      {!hasMetaConfig() && (
        <Notice>
          <strong>Meta não configurado.</strong> Preencha <code>META_APP_ID</code> e{' '}
          <code>META_APP_SECRET</code> no <code>.env</code> e reinicie. Sem isso o botão de conectar
          não tem para onde apontar.
        </Notice>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">Conexão com o Meta</h2>
            <p className="text-sm text-ink-muted">
              Autoriza o app nas páginas que você administra. Contas de Instagram vinculadas a uma
              página são detectadas automaticamente.
            </p>
          </div>
          {/* Link, e não botão com onClick: o OAuth é uma navegação de verdade,
              e assim funciona com Ctrl+clique e sem JavaScript. */}
          {hasMetaConfig() ? (
            <Link
              href="/api/meta/connect"
              className="inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
            >
              {connected.length > 0 ? 'Reconectar / adicionar' : 'Conectar meu Meta'}
            </Link>
          ) : (
            <Button variant="primary" disabled>
              Conectar meu Meta
            </Button>
          )}
        </div>
      </Card>

      <section className="space-y-3">
        <h2 className="font-medium">Contas conectadas</h2>

        {connected.length === 0 ? (
          <EmptyState title="Nenhuma conta conectada">
            Clique em <strong>Conectar meu Meta</strong> acima. Você será levado ao Facebook para
            autorizar, e volta para cá.
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {connected.map((account) => {
              // Sem a tarefa MODERATE a Graph API não retorna IDs de comentário em
              // posts de página — a conta conecta e o sync volta vazio, sem erro.
              const canModerate = account.tasks?.includes('MODERATE') ?? false;

              return (
                <Card key={account.id} className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{account.name}</span>
                      <Badge tone={account.platform === 'instagram' ? 'accent' : 'plain'}>
                        {account.platform === 'instagram' ? 'Instagram' : 'Facebook'}
                      </Badge>
                      {account.status === 'needs_reauth' && (
                        <Badge tone="negative">Reconexão necessária</Badge>
                      )}
                      {!canModerate && <Badge tone="warning">Sem tarefa MODERATE</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {account.lastSyncedAt
                        ? `Sincronizado em ${formatDateTime(account.lastSyncedAt)}`
                        : 'Nunca sincronizado'}
                      {account.username && ` · @${account.username}`}
                    </p>
                  </div>
                  <ActionButton
                    action={disconnectAccount.bind(null, account.id)}
                    variant="danger"
                    size="sm"
                    confirm={`Desconectar ${account.name}? Os comentários já baixados desta conta serão removidos daqui. Nada é alterado no Meta.`}
                  >
                    Desconectar
                  </ActionButton>
                </Card>
              );
            })}
          </div>
        )}

        {connected.some((account) => !(account.tasks?.includes('MODERATE') ?? false)) && (
          <Notice>
            Uma ou mais páginas não concederam a tarefa <strong>MODERATE</strong>. Desde a v11.0, a
            Graph API só retorna IDs de comentário para apps com essa tarefa — sem ela o sync volta
            vazio, sem mensagem de erro. Ajuste em <em>Configurações da Página → Acessos</em> e
            reconecte.
          </Notice>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Sincronização e análise</h2>

        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Buscar comentários</p>
              <p className="text-xs text-ink-muted">
                Varre as publicações da janela de backfill e traz comentários e respostas.
              </p>
            </div>
            <ActionButton
              action={runSync}
              variant="primary"
              pendingLabel="Sincronizando…"
              disabled={connected.length === 0}
            >
              Sincronizar agora
            </ActionButton>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div>
              <p className="text-sm font-medium">Analisar com IA</p>
              <p className="text-xs text-ink-muted">
                {pendingAnalysis > 0
                  ? `${pendingAnalysis} comentário(s) sem análise.`
                  : 'Todos os comentários estão analisados.'}
              </p>
            </div>
            <ActionButton
              action={runAnalysis}
              pendingLabel="Analisando…"
              disabled={!hasOpenRouterKey() || pendingAnalysis === 0}
              title={!hasOpenRouterKey() ? 'Configure OPENROUTER_API_KEY' : undefined}
            >
              Analisar pendentes
            </ActionButton>
          </div>
        </Card>

        {!hasOpenRouterKey() && (
          <Notice>
            <strong>OpenRouter não configurado.</strong> Preencha{' '}
            <code>OPENROUTER_API_KEY</code> no <code>.env</code>. A moderação funciona sem isso;
            sentimento, motivos e resumo não.
          </Notice>
        )}

        {runs.length > 0 && (
          <Card>
            <p className="mb-2 text-sm font-medium">Últimas sincronizações</p>
            <ul className="space-y-1.5 text-xs">
              {runs.map((run) => (
                <li key={run.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone={run.status === 'ok' ? 'positive' : run.status === 'error' ? 'negative' : 'neutral'}>
                    {run.status === 'ok' ? 'ok' : run.status === 'error' ? 'erro' : 'em andamento'}
                  </Badge>
                  <span className="text-ink-muted">{formatDateTime(run.startedAt)}</span>
                  <span className="text-ink-muted">
                    {run.commentsNew} novos · {run.commentsUpdated} atualizados ·{' '}
                    {run.postsSeen} publicações
                  </span>
                  {run.error && (
                    <span className="w-full truncate text-negative" title={run.error}>
                      {run.error}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
