'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { type Comment, accounts, actionLog, comments, db } from '@/db';
import { analyzePending, summarizeMotives } from '@/lib/ai';
import { decrypt } from '@/lib/crypto';
import * as meta from '@/lib/meta/api';
import { GraphError } from '@/lib/meta/client';
import { getOverview } from '@/lib/queries';
import { createSession, destroySession, requireSession, verifyPassword } from '@/lib/session';
import { syncAll } from '@/lib/sync';
import { motiveLabel } from '@/lib/taxonomy';

/**
 * Ações do operador. Toda ação que fala com o Meta segue a mesma ordem:
 * chama a API primeiro, e só grava localmente se a API aceitou.
 *
 * O inverso — otimista, gravando antes — produziria um inbox que discorda do
 * que está publicado, que é o pior estado possível para uma ferramenta de
 * moderação: a pessoa acredita ter respondido e não respondeu.
 */

export interface ActionResult {
  ok: boolean;
  message?: string;
}

const ok = (message?: string): ActionResult => ({ ok: true, message });
const fail = (message: string): ActionResult => ({ ok: false, message });

/** Traduz o erro da Graph API para algo acionável na interface. */
function explain(error: unknown, what: string): string {
  if (error instanceof GraphError) {
    if (error.needsReauth) {
      return `A conexão com o Meta expirou. Reconecte a conta em Configurações.`;
    }
    if (error.isPermission) {
      return `Sem permissão para ${what}. A página precisa conceder a tarefa MODERATE ao app.`;
    }
    if (error.isMissing) {
      return `Este comentário não existe mais no Meta — provavelmente foi excluído.`;
    }
    if (error.isRateLimit) {
      return `Limite de chamadas do Meta atingido. Tente de novo em alguns minutos.`;
    }
    return `O Meta recusou (${error.code}): ${error.message}`;
  }
  return error instanceof Error ? error.message : `Falha ao ${what}.`;
}

async function log(
  commentExternalId: string | null,
  action: string,
  result: 'ok' | 'error',
  detail?: string,
): Promise<void> {
  await db.insert(actionLog).values({ commentExternalId, action, result, detail });
}

/** Comentário + token decifrado da conta dona dele. */
async function loadComment(
  commentId: string,
): Promise<{ comment: Comment; token: string; accountExternalId: string } | null> {
  const row = await db
    .select({ comment: comments, accessToken: accounts.accessToken, accountExternalId: accounts.externalId })
    .from(comments)
    .innerJoin(accounts, eq(comments.accountId, accounts.id))
    .where(eq(comments.id, commentId))
    .get();

  if (!row) return null;
  return {
    comment: row.comment,
    token: decrypt(row.accessToken),
    accountExternalId: row.accountExternalId,
  };
}

// --- Moderação ---------------------------------------------------------------

export async function replyToComment(commentId: string, message: string): Promise<ActionResult> {
  await requireSession();

  const text = message.trim();
  if (!text) return fail('A resposta está vazia.');

  const loaded = await loadComment(commentId);
  if (!loaded) return fail('Comentário não encontrado.');
  const { comment, token, accountExternalId } = loaded;

  try {
    const replyId = await meta.replyToComment(
      comment.platform as meta.Platform,
      comment.externalId,
      token,
      text,
    );

    // Grava a resposta localmente para ela aparecer na thread agora, sem
    // esperar o próximo sync.
    await db.insert(comments).values({
      accountId: comment.accountId,
      postId: comment.postId,
      externalId: replyId,
      platform: comment.platform,
      parentExternalId: comment.externalId,
      authorExternalId: accountExternalId,
      authorName: 'Você',
      isOwn: true,
      message: text,
      publishedAt: new Date(),
      status: 'answered',
      syncedAt: new Date(),
    });

    await db
      .update(comments)
      .set({ status: 'answered', replyCount: comment.replyCount + 1 })
      .where(eq(comments.id, comment.id));

    await log(comment.externalId, 'reply', 'ok', text.slice(0, 200));
    revalidatePath('/inbox');
    return ok('Resposta publicada.');
  } catch (error) {
    const detail = explain(error, 'responder');
    await log(comment.externalId, 'reply', 'error', detail);
    return fail(detail);
  }
}

/**
 * Curte ou descurte. Só Facebook: a Graph API não expõe endpoint para curtir
 * comentários do Instagram.
 */
export async function toggleLike(commentId: string): Promise<ActionResult> {
  await requireSession();

  const loaded = await loadComment(commentId);
  if (!loaded) return fail('Comentário não encontrado.');
  const { comment, token } = loaded;

  if (comment.platform === 'instagram') {
    return fail('O Instagram não permite curtir comentários pela API.');
  }

  const nextLiked = !comment.likedByUs;
  try {
    if (nextLiked) await meta.likeComment(comment.externalId, token);
    else await meta.unlikeComment(comment.externalId, token);

    await db.update(comments).set({ likedByUs: nextLiked }).where(eq(comments.id, comment.id));
    await log(comment.externalId, nextLiked ? 'like' : 'unlike', 'ok');
    revalidatePath('/inbox');
    return ok(nextLiked ? 'Curtido.' : 'Curtida removida.');
  } catch (error) {
    const detail = explain(error, nextLiked ? 'curtir' : 'descurtir');
    await log(comment.externalId, nextLiked ? 'like' : 'unlike', 'error', detail);
    return fail(detail);
  }
}

export async function toggleHide(commentId: string): Promise<ActionResult> {
  await requireSession();

  const loaded = await loadComment(commentId);
  if (!loaded) return fail('Comentário não encontrado.');
  const { comment, token } = loaded;

  const nextHidden = !comment.isHidden;
  try {
    await meta.setCommentHidden(
      comment.platform as meta.Platform,
      comment.externalId,
      token,
      nextHidden,
    );
    await db.update(comments).set({ isHidden: nextHidden }).where(eq(comments.id, comment.id));
    await log(comment.externalId, nextHidden ? 'hide' : 'unhide', 'ok');
    revalidatePath('/inbox');
    return ok(nextHidden ? 'Comentário oculto.' : 'Comentário reexibido.');
  } catch (error) {
    const detail = explain(error, nextHidden ? 'ocultar' : 'reexibir');
    await log(comment.externalId, nextHidden ? 'hide' : 'unhide', 'error', detail);
    return fail(detail);
  }
}

/**
 * Exclui no Meta. A linha local permanece, marcada — o histórico de moderação
 * não deve desaparecer junto com o comentário.
 */
export async function removeComment(commentId: string): Promise<ActionResult> {
  await requireSession();

  const loaded = await loadComment(commentId);
  if (!loaded) return fail('Comentário não encontrado.');
  const { comment, token } = loaded;

  try {
    await meta.deleteComment(comment.externalId, token);
    await db
      .update(comments)
      .set({ deletedOnPlatform: true, status: 'ignored' })
      .where(eq(comments.id, comment.id));
    await log(comment.externalId, 'delete', 'ok');
    revalidatePath('/inbox');
    return ok('Comentário excluído.');
  } catch (error) {
    const detail = explain(error, 'excluir');
    await log(comment.externalId, 'delete', 'error', detail);
    return fail(detail);
  }
}

/** Triagem local: não toca no Meta, só organiza a fila. */
export async function setStatus(
  commentId: string,
  status: 'new' | 'answered' | 'ignored',
): Promise<ActionResult> {
  await requireSession();
  await db.update(comments).set({ status }).where(eq(comments.id, commentId));
  revalidatePath('/inbox');
  return ok();
}

// --- Sincronização e análise -------------------------------------------------

export async function runSync(): Promise<ActionResult> {
  await requireSession();

  const connected = await db.select({ id: accounts.id }).from(accounts).all();
  if (connected.length === 0) {
    return fail('Nenhuma conta conectada. Conecte seu Meta em Configurações.');
  }

  const result = await syncAll();
  revalidatePath('/inbox');
  revalidatePath('/');

  const summary =
    `${result.commentsNew} novos, ${result.commentsUpdated} atualizados ` +
    `em ${result.postsSeen} publicações.`;

  // Erro parcial não é sucesso silencioso: alguns posts podem ter falhado
  // enquanto outros entraram.
  if (result.errors.length > 0) {
    return { ok: true, message: `${summary} ${result.errors.length} publicação(ões) com problema.` };
  }
  return ok(summary);
}

export async function runAnalysis(): Promise<ActionResult> {
  await requireSession();

  const result = await analyzePending();
  revalidatePath('/');
  revalidatePath('/inbox');

  if (result.analyzed === 0 && result.errors.length > 0) {
    return fail(result.errors[0]);
  }
  const tail = result.skipped > 0 ? ` ${result.skipped} pendentes para a próxima rodada.` : '';
  return ok(`${result.analyzed} comentários analisados.${tail}`);
}

/**
 * Interpreta os motivos do período em texto. A mensagem de retorno é o próprio
 * resumo — não há tabela para guardá-lo, porque ele muda a cada janela e a cada
 * nova rodada de análise.
 */
export async function summarizePeriod(days: number): Promise<ActionResult> {
  await requireSession();

  try {
    const overview = await getOverview(days);
    if (overview.motives.length === 0) {
      return fail('Nenhum motivo analisado no período. Rode a análise de IA primeiro.');
    }
    // Rótulos legíveis, e não ids da taxonomia: o modelo escreve melhor sobre
    // "Frete e prazo de entrega" do que sobre "frete_entrega".
    const named = overview.motives.map((row) => ({ ...row, motive: motiveLabel(row.motive) }));
    return ok(await summarizeMotives(named));
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Falha ao gerar o resumo.');
  }
}

// --- Contas ------------------------------------------------------------------

/**
 * Remove a conta e, em cascata, publicações e comentários dela. Não mexe em nada
 * no Meta — desconectar aqui não apaga comentário publicado.
 */
export async function disconnectAccount(accountId: string): Promise<ActionResult> {
  await requireSession();
  await db.delete(accounts).where(eq(accounts.id, accountId));
  revalidatePath('/settings');
  revalidatePath('/inbox');
  return ok('Conta desconectada.');
}

// --- Sessão ------------------------------------------------------------------

export async function login(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const password = String(formData.get('password') ?? '');
  if (!verifyPassword(password)) {
    return fail('Senha incorreta.');
  }
  await createSession();
  redirect('/');
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect('/login');
}
