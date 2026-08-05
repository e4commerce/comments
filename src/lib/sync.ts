import { and, eq, inArray } from 'drizzle-orm';
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
 * Ingestão por varredura: lista as publicações da janela de backfill e, para
 * cada uma, os comentários.
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

/** Sincroniza todas as contas ativas. */
export async function syncAll(): Promise<SyncResult> {
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
    const since = new Date(Date.now() - env.backfillDays * 24 * 60 * 60 * 1000);

    const remotePosts =
      platform === 'instagram'
        ? await listInstagramMedia(account.externalId, token, since)
        : await listFacebookPosts(account.externalId, token, since);

    result.postsSeen = remotePosts.length;

    for (const remotePost of remotePosts) {
      const postRow = await upsertPost(account, remotePost);

      // Publicação sem comentário nenhum: uma requisição por post que não
      // renderia nada. Em contas com muitos posts é a diferença entre um sync
      // de segundos e um de minutos.
      if (remotePost.commentCount === 0) continue;

      try {
        const remoteComments =
          platform === 'instagram'
            ? await listInstagramComments(remotePost.externalId, token)
            : await listFacebookComments(remotePost.externalId, token);

        const counts = await upsertComments(account, postRow.id, remoteComments);
        result.commentsNew += counts.inserted;
        result.commentsUpdated += counts.updated;
      } catch (error) {
        if (error instanceof GraphError && (error.isMissing || error.isPermission)) {
          // Dark post, mídia restrita ou post sem permissão de leitura de
          // comentários. Marcamos para a interface informar, em vez de exibir
          // zero como se não houvesse comentários.
          await db
            .update(posts)
            .set({ commentsAvailable: false })
            .where(eq(posts.id, postRow.id));
          result.errors.push(`Post ${remotePost.externalId}: ${error.message}`);
          continue;
        }
        throw error;
      }
    }

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
): Promise<{ id: string }> {
  const existing = await db
    .select({ id: posts.id })
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
    return existing;
  }

  return db
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
    .returning({ id: posts.id })
    .get();
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
): Promise<{ inserted: number; updated: number }> {
  if (remote.length === 0) return { inserted: 0, updated: 0 };

  const externalIds = remote.map((c) => c.externalId);
  const known = new Map(
    (
      await db
        .select({ id: comments.id, externalId: comments.externalId, message: comments.message })
        .from(comments)
        .where(inArray(comments.externalId, externalIds))
        .all()
    ).map((row) => [row.externalId, row]),
  );

  let inserted = 0;
  let updated = 0;

  for (const comment of remote) {
    // Comentário publicado pela própria página: é a nossa resposta, não algo a
    // moderar. Fica no banco para aparecer na thread, mas fora da fila.
    const isOwn = comment.authorExternalId === account.externalId;

    const existing = known.get(comment.externalId);
    if (existing) {
      // Contadores e visibilidade mudam; o texto praticamente não. Reescrever
      // `message` quando ele muda importa porque a análise de IA precisa
      // reprocessar — daí o reset de `analyzedAt`.
      const textChanged = existing.message !== comment.message;
      await db
        .update(comments)
        .set({
          message: comment.message,
          likeCount: comment.likeCount,
          replyCount: comment.replyCount,
          isHidden: comment.isHidden,
          authorName: comment.authorName,
          authorPictureUrl: comment.authorPictureUrl,
          // Reapareceu na API: não estava excluído.
          deletedOnPlatform: false,
          missCount: 0,
          syncedAt: new Date(),
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

  // Um comentário de terceiro que já tem resposta nossa na thread não deveria
  // seguir como "novo" na fila só porque a resposta foi dada fora daqui.
  await markAnsweredFromOwnReplies(postId);

  return { inserted, updated };
}

/** Marca como respondido todo comentário que tenha uma resposta nossa. */
async function markAnsweredFromOwnReplies(postId: string): Promise<void> {
  const ownReplies = await db
    .select({ parentExternalId: comments.parentExternalId })
    .from(comments)
    .where(and(eq(comments.postId, postId), eq(comments.isOwn, true)))
    .all();

  const parentIds = ownReplies
    .map((reply) => reply.parentExternalId)
    .filter((id): id is string => Boolean(id));

  if (parentIds.length === 0) return;

  await db
    .update(comments)
    .set({ status: 'answered' })
    .where(and(inArray(comments.externalId, parentIds), eq(comments.status, 'new')));
}
