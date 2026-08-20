import { and, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import { type Account, accounts, comments, db, posts, syncRuns } from '@/db';
import { decrypt } from './crypto';
import { env } from './env';
import {
  type Platform,
  type RemoteComment,
  listFacebookComments,
  listFacebookPosts,
  listInstagramComments,
  listInstagramMedia,
} from './meta/api';
import { GraphError } from './meta/client';

/**
 * Ingestão por varredura: descobre todas as publicações e lê os comentários
 * dentro da janela de backfill. A distinção importa: uma publicação antiga
 * pode receber um comentário hoje.
 *
 * Não há webhook aqui de propósito. Webhook do Meta exige App Review, endpoint
 * público e assinatura HMAC — e, o que é decisivo, **não existe endpoint para
 * consultar histórico de notificações**: o que o webhook não entregar está
 * perdido, e a varredura seria necessária de qualquer forma. Começar por ela dá
 * uma plataforma que funciona hoje; o webhook, se um dia entrar, só reduz a
 * latência.
 */

export interface SyncResult {
  postsSeen: number;
  commentsNew: number;
  commentsUpdated: number;
  errors: string[];
}

const globalForSync = globalThis as unknown as { __metaCommentsSync?: Promise<SyncResult> };

/** Sincroniza todas as contas ativas. */
export async function syncAll(): Promise<SyncResult> {
  // Botão manual e agendador podem disparar juntos. Compartilhar a execução
  // evita duplicar chamadas ao Meta e disputar escrita no mesmo SQLite.
  if (globalForSync.__metaCommentsSync) return globalForSync.__metaCommentsSync;

  const current = syncAllUnlocked();
  globalForSync.__metaCommentsSync = current;
  try {
    return await current;
  } finally {
    if (globalForSync.__metaCommentsSync === current) {
      delete globalForSync.__metaCommentsSync;
    }
  }
}

async function syncAllUnlocked(): Promise<SyncResult> {
  const active = await db.select().from(accounts).where(eq(accounts.status, 'active')).all();
  const total: SyncResult = { postsSeen: 0, commentsNew: 0, commentsUpdated: 0, errors: [] };

  for (const account of active) {
    const result = await syncAccount(account);
    total.postsSeen += result.postsSeen;
    total.commentsNew += result.commentsNew;
    total.commentsUpdated += result.commentsUpdated;
    total.errors.push(...result.errors);
  }
  return total;
}

export async function syncAccount(account: Account): Promise<SyncResult> {
  const result: SyncResult = { postsSeen: 0, commentsNew: 0, commentsUpdated: 0, errors: [] };

  const run = await db
    .insert(syncRuns)
    .values({ accountId: account.id, status: 'running' })
    .returning({ id: syncRuns.id })
    .get();

  try {
    const token = decrypt(account.accessToken);
    const platform = account.platform as Platform;
    const now = new Date();
    const commentSince = new Date(now.getTime() - env.backfillDays * 24 * 60 * 60 * 1000);

    // O corte temporal vale para comentários, não para publicações. Se a mídia
    // de 2024 receber comentário hoje, ela também precisa estar nesta lista.
    const remotePosts =
      platform === 'instagram'
        ? await listInstagramMedia(account.externalId, token, new Date(0))
        : await listFacebookPosts(account.externalId, token, new Date(0));

    result.postsSeen = remotePosts.length;

    await mapWithConcurrency(remotePosts, env.syncConcurrency, async (remotePost) => {
      const postRow = await upsertPost(account, remotePost);
      const isNewKnownEmpty = postRow.isNew && remotePost.commentCount === 0;

      if (isNewKnownEmpty) {
        await markPostCommentsSynced(postRow.id, remotePost.commentCount, now, true);
        return;
      }

      const lastSyncMs = postRow.commentsSyncedAt?.getTime() ?? 0;
      const countChanged =
        remotePost.commentCount !== null &&
        remotePost.commentCount !== postRow.reportedCommentCount;
      const isRecent =
        Boolean(remotePost.publishedAt) &&
        remotePost.publishedAt!.getTime() >=
          now.getTime() - env.recentPostSyncDays * 24 * 60 * 60 * 1000;
      const needsReconciliation =
        lastSyncMs > 0 &&
        now.getTime() - lastSyncMs >= env.reconcileHours * 60 * 60 * 1000;
      const shouldFetch =
        lastSyncMs === 0 ||
        countChanged ||
        needsReconciliation ||
        (isRecent && postRow.commentsAvailable);

      if (!shouldFetch) return;

      try {
        const remoteComments =
          platform === 'instagram'
            ? await listInstagramComments(remotePost.externalId, token)
            : await listFacebookComments(remotePost.externalId, token);

        const counts = await upsertComments(account, postRow.id, remoteComments, commentSince);
        result.commentsNew += counts.inserted;
        result.commentsUpdated += counts.updated;
        await markPostCommentsSynced(postRow.id, remotePost.commentCount, new Date(), true);
      } catch (error) {
        if (error instanceof GraphError && (error.isMissing || error.isPermission)) {
          // Dark post, mídia restrita ou post sem permissão de leitura de
          // comentários. Marcamos para a interface informar, em vez de exibir
          // zero como se não houvesse comentários.
          await markPostCommentsSynced(postRow.id, remotePost.commentCount, new Date(), false);
          result.errors.push(`Post ${remotePost.externalId}: ${error.message}`);
          return;
        }
        throw error;
      }
    });

    await db.update(accounts).set({ lastSyncedAt: new Date() }).where(eq(accounts.id, account.id));
    await db
      .update(syncRuns)
      .set({
        status: 'ok',
        postsSeen: result.postsSeen,
        commentsNew: result.commentsNew,
        commentsUpdated: result.commentsUpdated,
        finishedAt: new Date(),
        error: result.errors.length ? result.errors.slice(0, 5).join('\n') : null,
      })
      .where(eq(syncRuns.id, run.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message);

    // Token revogado ou expirado não é falha transitória: a conta precisa ser
    // reconectada, e insistir a cada sync só gera ruído.
    if (error instanceof GraphError && error.needsReauth) {
      await db.update(accounts).set({ status: 'needs_reauth' }).where(eq(accounts.id, account.id));
    }

    await db
      .update(syncRuns)
      .set({ status: 'error', error: message, finishedAt: new Date() })
      .where(eq(syncRuns.id, run.id));
  }

  return result;
}

async function upsertPost(
  account: Account,
  remote: Awaited<ReturnType<typeof listFacebookPosts>>[number],
): Promise<{
  id: string;
  isNew: boolean;
  reportedCommentCount: number | null;
  commentsSyncedAt: Date | null;
  commentsAvailable: boolean;
}> {
  const existing = await db
    .select({
      id: posts.id,
      reportedCommentCount: posts.reportedCommentCount,
      commentsSyncedAt: posts.commentsSyncedAt,
      commentsAvailable: posts.commentsAvailable,
    })
    .from(posts)
    .where(and(eq(posts.accountId, account.id), eq(posts.externalId, remote.externalId)))
    .get();

  if (existing) {
    await db
      .update(posts)
      .set({
        message: remote.message,
        permalink: remote.permalink,
        mediaType: remote.mediaType,
        mediaUrl: remote.mediaUrl,
        publishedAt: remote.publishedAt,
      })
      .where(eq(posts.id, existing.id));
    return { ...existing, isNew: false };
  }

  const inserted = await db
    .insert(posts)
    .values({
      accountId: account.id,
      externalId: remote.externalId,
      platform: account.platform,
      message: remote.message,
      permalink: remote.permalink,
      mediaType: remote.mediaType,
      mediaUrl: remote.mediaUrl,
      publishedAt: remote.publishedAt,
    })
    .returning({
      id: posts.id,
      reportedCommentCount: posts.reportedCommentCount,
      commentsSyncedAt: posts.commentsSyncedAt,
      commentsAvailable: posts.commentsAvailable,
    })
    .get();
  return { ...inserted, isNew: true };
}

async function markPostCommentsSynced(
  postId: string,
  reportedCommentCount: number | null,
  commentsSyncedAt: Date,
  commentsAvailable: boolean,
): Promise<void> {
  await db
    .update(posts)
    .set({ reportedCommentCount, commentsSyncedAt, commentsAvailable })
    .where(eq(posts.id, postId));
}

/**
 * Grava os comentários de uma publicação.
 *
 * Preserva deliberadamente o que é nosso e não vem da API: `status`, os campos
 * de IA e `likedByUs`. Um re-sync que sobrescrevesse esses campos apagaria a
 * triagem já feita e obrigaria a reanalisar todo o corpus a cada varredura.
 */
async function upsertComments(
  account: Account,
  postId: string,
  remote: RemoteComment[],
  since: Date,
): Promise<{ inserted: number; updated: number }> {
  // Buscar a publicação inteira é necessário para encontrar comentários novos
  // em mídia antiga. Persistimos a janela configurada e também os pais antigos
  // necessários para dar contexto a uma resposta recente; sem o pai, a resposta
  // ficaria invisível porque o inbox exibe uma linha por conversa.
  const relevantIds = new Set(
    remote
      .filter((comment) => !comment.publishedAt || comment.publishedAt >= since)
      .map((comment) => comment.externalId),
  );
  const remoteById = new Map(remote.map((comment) => [comment.externalId, comment]));
  let addedParent = true;
  while (addedParent) {
    addedParent = false;
    for (const id of [...relevantIds]) {
      const parentId = remoteById.get(id)?.parentExternalId;
      if (parentId && remoteById.has(parentId) && !relevantIds.has(parentId)) {
        relevantIds.add(parentId);
        addedParent = true;
      }
    }
  }
  const relevantRemote = remote.filter((comment) => relevantIds.has(comment.externalId));
  const knownWindow = or(isNull(comments.publishedAt), gte(comments.publishedAt, since));
  const knownScope = relevantIds.size
    ? or(knownWindow, inArray(comments.externalId, [...relevantIds]))
    : knownWindow;
  const knownRows = await db
    .select({
      id: comments.id,
      externalId: comments.externalId,
      message: comments.message,
      publishedAt: comments.publishedAt,
      missCount: comments.missCount,
    })
    .from(comments)
    .where(
      and(
        eq(comments.postId, postId),
        knownScope,
      ),
    )
    .all();
  const known = new Map(knownRows.map((row) => [row.externalId, row]));
  const remoteIds = new Set(relevantRemote.map((comment) => comment.externalId));

  let inserted = 0;
  let updated = 0;

  for (const comment of relevantRemote) {
    // Comentário publicado pela própria página: é a nossa resposta, não algo a
    // moderar. Fica no banco para aparecer na thread, mas fora da fila.
    const isOwn = isOwnComment(account, comment);

    const existing = known.get(comment.externalId);
    if (existing) {
      // Contadores e visibilidade mudam; o texto praticamente não. Reescrever
      // `message` quando ele muda importa porque a análise de IA precisa
      // reprocessar — daí o reset de `analyzedAt`.
      const textChanged = existing.message !== comment.message;
      await db
        .update(comments)
        .set({
          postId,
          parentExternalId: comment.parentExternalId,
          authorExternalId: comment.authorExternalId,
          message: comment.message,
          likeCount: comment.likeCount,
          replyCount: comment.replyCount,
          isHidden: comment.isHidden,
          authorName: comment.authorName,
          authorPictureUrl: comment.authorPictureUrl,
          isOwn,
          publishedAt: comment.publishedAt ?? existing.publishedAt,
          raw: comment.raw,
          // Reapareceu na API: não estava excluído.
          deletedOnPlatform: false,
          missCount: 0,
          syncedAt: new Date(),
          ...(isOwn ? { status: 'answered' } : {}),
          ...(textChanged ? { analyzedAt: null } : {}),
        })
        .where(eq(comments.id, existing.id));
      updated++;
      continue;
    }

    await db.insert(comments).values({
      accountId: account.id,
      postId,
      externalId: comment.externalId,
      platform: account.platform,
      parentExternalId: comment.parentExternalId,
      authorExternalId: comment.authorExternalId,
      authorName: comment.authorName,
      authorPictureUrl: comment.authorPictureUrl,
      isOwn,
      message: comment.message,
      likeCount: comment.likeCount,
      replyCount: comment.replyCount,
      publishedAt: comment.publishedAt,
      isHidden: comment.isHidden,
      // Nossa própria resposta já nasce fora da fila de moderação.
      status: isOwn ? 'answered' : 'new',
      raw: comment.raw,
      syncedAt: new Date(),
    });
    inserted++;
  }

  // Ausência em uma leitura pode ser restrição temporária da API. Somente a
  // segunda ausência consecutiva marca a linha como excluída.
  for (const existing of knownRows) {
    if (remoteIds.has(existing.externalId)) continue;
    const nextMissCount = Math.min(2, existing.missCount + 1);
    await db
      .update(comments)
      .set({
        missCount: nextMissCount,
        deletedOnPlatform: nextMissCount >= 2,
        syncedAt: new Date(),
      })
      .where(eq(comments.id, existing.id));
    updated++;
  }

  // O estado pertence à conversa pai: resposta nossa encerra a pendência;
  // resposta posterior do cliente reabre. Respostas não viram cartões duplicados.
  await reconcileThreadStatuses(postId);

  return { inserted, updated };
}

function isOwnComment(account: Account, comment: RemoteComment): boolean {
  if (account.platform !== 'instagram') {
    return comment.authorExternalId === account.externalId;
  }

  const normalizeUsername = (value: string | null): string =>
    (value ?? '').trim().replace(/^@/, '').toLocaleLowerCase('en-US');
  const ownUsername = normalizeUsername(account.username);
  return Boolean(ownUsername) && normalizeUsername(comment.authorExternalId) === ownUsername;
}

/** Mantém o status do pai de acordo com a última atividade da conversa. */
async function reconcileThreadStatuses(postId: string): Promise<void> {
  const rows = await db
    .select({
      id: comments.id,
      externalId: comments.externalId,
      parentExternalId: comments.parentExternalId,
      isOwn: comments.isOwn,
      status: comments.status,
      publishedAt: comments.publishedAt,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .where(
      and(
        eq(comments.postId, postId),
        eq(comments.deletedOnPlatform, false),
      ),
    )
    .all();

  const parents = new Map(
    rows
      .filter((row) => !row.parentExternalId && !row.isOwn)
      .map((row) => [row.externalId, row]),
  );
  const latestReply = new Map<string, (typeof rows)[number]>();

  for (const row of rows) {
    if (!row.parentExternalId || !parents.has(row.parentExternalId)) continue;
    const current = latestReply.get(row.parentExternalId);
    const rowTime = activityTime(row);
    const currentTime = current ? activityTime(current) : -Infinity;
    // Se o Meta trouxer dois eventos no mesmo segundo, manter a conversa como
    // pendente é mais seguro do que esconder uma resposta do cliente.
    const customerWinsTie = current && rowTime === currentTime && !row.isOwn && current.isOwn;
    if (!current || rowTime > currentTime || customerWinsTie) {
      latestReply.set(row.parentExternalId, row);
    }
  }

  for (const [externalId, latest] of latestReply) {
    const parent = parents.get(externalId)!;
    // Arquivamento é uma decisão explícita do operador e não deve ser
    // desfeito a cada reconciliação da mesma thread.
    if (parent.status === 'ignored') continue;
    const nextStatus = latest.isOwn ? 'answered' : 'new';
    if (parent.status === nextStatus) continue;
    await db.update(comments).set({ status: nextStatus }).where(eq(comments.id, parent.id));
  }
}

function activityTime(row: { publishedAt: Date | null; createdAt: Date }): number {
  return row.publishedAt?.getTime() ?? row.createdAt.getTime();
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  let firstError: unknown;

  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    async () => {
      while (cursor < items.length && firstError === undefined) {
        const index = cursor++;
        try {
          await worker(items[index]);
        } catch (error) {
          firstError ??= error;
        }
      }
    },
  );

  await Promise.all(runners);
  if (firstError !== undefined) throw firstError;
}
