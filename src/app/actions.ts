'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, count, eq } from 'drizzle-orm';
import {
  type Comment,
  accounts,
  actionLog,
  appSettings,
  commentFilters,
  comments,
  db,
  users,
} from '@/db';
import { analyzePending, summarizeMotives } from '@/lib/ai';
import { normalizeCommentFilterText } from '@/lib/comment-filters';
import { decrypt } from '@/lib/crypto';
import * as meta from '@/lib/meta/api';
import { GraphError } from '@/lib/meta/client';
import { getOverview } from '@/lib/queries';
import { destroySession, requireAdmin, requireSession } from '@/lib/session';
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

export async function replyToComment(
  commentId: string,
  message: string,
  revalidateImmediately = true,
): Promise<ActionResult> {
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
    if (revalidateImmediately) {
      revalidatePath('/');
      revalidatePath('/inbox');
    }
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

export async function toggleHide(
  commentId: string,
  revalidateImmediately = true,
): Promise<ActionResult> {
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
    if (revalidateImmediately) {
      revalidatePath('/');
      revalidatePath('/inbox');
    }
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
export async function removeComment(
  commentId: string,
  revalidateImmediately = true,
): Promise<ActionResult> {
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
    if (revalidateImmediately) {
      revalidatePath('/');
      revalidatePath('/inbox');
    }
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
  revalidateImmediately = true,
): Promise<ActionResult> {
  await requireSession();
  await db.update(comments).set({ status }).where(eq(comments.id, commentId));
  if (revalidateImmediately) {
    revalidatePath('/');
    revalidatePath('/inbox');
  }
  return ok();
}

// --- Preferências globais ---------------------------------------------------

export async function setCountHiddenUnanswered(enabled: boolean): Promise<ActionResult> {
  await requireAdmin();

  await db
    .insert(appSettings)
    .values({ id: 'global', countHiddenUnanswered: enabled, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { countHiddenUnanswered: enabled, updatedAt: new Date() },
    });

  revalidatePath('/');
  revalidatePath('/inbox');
  revalidatePath('/settings');
  return ok(
    enabled
      ? 'Comentários ocultos voltaram a contar como “A responder”.'
      : 'Comentários ocultos não contam mais como “A responder”.',
  );
}

// --- Filtros globais da fila -------------------------------------------------

export async function addCommentFilter(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const pattern = String(formData.get('pattern') ?? '').trim();
  if (!pattern) return fail('Digite uma palavra, número ou frase para filtrar.');
  if (pattern.length > 100) return fail('O filtro pode ter no máximo 100 caracteres.');

  const normalizedPattern = normalizeCommentFilterText(pattern);
  const existing = await db
    .select({ id: commentFilters.id })
    .from(commentFilters)
    .where(eq(commentFilters.normalizedPattern, normalizedPattern))
    .get();
  if (existing) return fail('Este filtro já foi adicionado.');

  await db.insert(commentFilters).values({ pattern, normalizedPattern });
  revalidatePath('/');
  revalidatePath('/inbox');
  revalidatePath('/settings');
  return ok('Filtro adicionado. Os comentários foram ocultados da fila e das análises.');
}

export async function removeCommentFilter(filterId: string): Promise<ActionResult> {
  await requireAdmin();

  const existing = await db
    .select({ id: commentFilters.id })
    .from(commentFilters)
    .where(eq(commentFilters.id, filterId))
    .get();
  if (!existing) return fail('Filtro não encontrado.');

  await db.delete(commentFilters).where(eq(commentFilters.id, filterId));
  revalidatePath('/');
  revalidatePath('/inbox');
  revalidatePath('/settings');
  return ok('Filtro removido. Os comentários voltaram para a fila e para as análises.');
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
  await requireAdmin();
  await db.delete(accounts).where(eq(accounts.id, accountId));
  revalidatePath('/settings');
  revalidatePath('/inbox');
  return ok('Conta desconectada.');
}

// --- Usuários ----------------------------------------------------------------

export async function addUser(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = String(formData.get('role') ?? 'user');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Digite um e-mail válido.');
  if (role !== 'admin' && role !== 'user') return fail('Perfil inválido.');

  const existing = await db.select().from(users).where(eq(users.email, email)).get();
  if (existing?.isActive) return fail('Este usuário já está ativo.');

  if (existing) {
    await db.update(users).set({ role, isActive: true }).where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({ email, role, isActive: true });
  }

  revalidatePath('/settings');
  return ok('Usuário adicionado. Ele já pode receber um código pelo e-mail.');
}

export async function toggleUserActive(userId: string): Promise<ActionResult> {
  const currentUser = await requireAdmin();
  const target = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) return fail('Usuário não encontrado.');

  if (target.id === currentUser.id && target.isActive) {
    return fail('Você não pode desativar seu próprio usuário.');
  }

  if (target.isActive && target.role === 'admin') {
    const activeAdmins = await db
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.isActive, true)))
      .get();
    if ((activeAdmins?.value ?? 0) <= 1) return fail('É necessário manter pelo menos um ADM ativo.');
  }

  await db.update(users).set({ isActive: !target.isActive }).where(eq(users.id, target.id));
  revalidatePath('/settings');
  return ok(target.isActive ? 'Usuário desativado.' : 'Usuário reativado.');
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect('/login');
}
