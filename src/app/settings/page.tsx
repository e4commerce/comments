import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { BrainCircuit, Plug, RefreshCw } from 'lucide-react';
import { accounts, db, syncRuns, users } from '@/db';
import { ActionButton } from '@/components/action-button';
import { Badge, Button, Card, EmptyState, Notice, PageHeader, SectionHeading } from '@/components/ui';
import { UserManagement } from '@/components/user-management';
import { countPendingAnalysis } from '@/lib/ai';
import { hasMetaConfig, hasOpenRouterKey } from '@/lib/env';
import { requireAdmin } from '@/lib/session';
import { disconnectAccount, runAnalysis, runSync } from '../actions';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; conectadas?: string }>;
}) {
  const currentUser = await requireAdmin();
  const params = await searchParams;

  const connected = await db.select().from(accounts).orderBy(accounts.platform, accounts.name).all();
  const runs = await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(5).all();
  const pendingAnalysis = await countPendingAnalysis();
  const managedUsers = db
    .select()
    .from(users)
    .orderBy(users.email)
    .all()
    .map((user) => ({
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      lastLoginLabel: user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'nunca',
    }));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Administração"
        title="Configurações"
        description="Contas conectadas, usuários, sincronização e análise."
      />

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

      <UserManagement users={managedUsers} currentUserId={currentUser.id} />

      <Card className="p-5 sm:p-6">
        <SectionHeading
          title="Conexão com o Meta"
          description={
            <>
              Autoriza o app nas páginas que você administra. Contas de Instagram vinculadas a uma
              página são detectadas automaticamente.
            </>
          }
          action={
            hasMetaConfig() ? (
              <Link
                href="/api/meta/connect"
                prefetch={false}
                className="inline-flex min-h-9 items-center gap-2 rounded-full bg-inverse px-4 py-2 text-sm font-medium text-[var(--text-on-dark)] transition-colors hover:bg-[var(--action-primary-hover)]"
              >
                <Plug size={14} strokeWidth={1.8} />
                {connected.length > 0 ? 'Reconectar / adicionar' : 'Conectar meu Meta'}
              </Link>
            ) : (
              <Button variant="primary" disabled>
                <Plug size={14} strokeWidth={1.8} />
                Conectar meu Meta
              </Button>
            )
          }
        />
      </Card>

      <section className="space-y-4">
        <SectionHeading
          title="Contas conectadas"
          description={`${connected.length} conta(s) disponível(is) para monitoramento.`}
        />

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
                <Card key={account.id} className="flex flex-wrap items-center gap-4 p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-muted font-display text-lg">
                    {account.name.slice(0, 1).toUpperCase()}
                  </span>
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

      <section className="space-y-4">
        <SectionHeading
          title="Sincronização e análise"
          description="Controles operacionais e histórico recente do processamento."
        />

        <Card className="space-y-5 p-5 sm:p-6">
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
              <RefreshCw size={14} strokeWidth={1.8} />
              Sincronizar agora
            </ActionButton>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-5">
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
              <BrainCircuit size={14} strokeWidth={1.8} />
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
          <Card className="p-5 sm:p-6">
            <SectionHeading title="Últimas sincronizações" />
            <ul className="mt-4 divide-y divide-line-subtle text-xs">
              {runs.map((run) => (
                <li key={run.id} className="flex flex-wrap items-center gap-2 py-2.5 first:pt-0 last:pb-0">
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
