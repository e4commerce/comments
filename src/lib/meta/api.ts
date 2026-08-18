import { GraphError, graph, paginate } from './client';

/**
 * Leitura de publicações e comentários, e as ações de moderação.
 *
 * Facebook e Instagram não são a mesma API com nomes diferentes: os campos, os
 * endpoints de resposta e o que é sequer possível divergem. As diferenças ficam
 * explícitas aqui, e não espalhadas pela interface.
 */

export type Platform = 'facebook' | 'instagram';

export interface RemotePost {
  externalId: string;
  message: string | null;
  permalink: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
  publishedAt: Date | null;
  commentCount: number | null;
}

export interface RemoteComment {
  externalId: string;
  parentExternalId: string | null;
  authorExternalId: string | null;
  authorName: string | null;
  authorPictureUrl: string | null;
  message: string | null;
  likeCount: number;
  replyCount: number;
  publishedAt: Date | null;
  isHidden: boolean;
  raw: unknown;
}

const parseDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// --- Publicações -------------------------------------------------------------

/** Posts publicados pela Página. `since` corta o backfill. */
export async function listFacebookPosts(
  pageId: string,
  token: string,
  since: Date,
  maxPages = 20,
): Promise<RemotePost[]> {
  interface Raw {
    id: string;
    message?: string;
    story?: string;
    permalink_url?: string;
    created_time?: string;
    full_picture?: string;
    comments?: { summary?: { total_count?: number } };
  }

  const posts: RemotePost[] = [];
  for await (const post of paginate<Raw>({
    path: `${pageId}/posts`,
    token,
    params: {
      fields: 'id,message,story,permalink_url,created_time,full_picture,comments.summary(true).limit(0)',
      since: Math.floor(since.getTime() / 1000),
    },
    limit: 50,
    maxPages,
  })) {
    posts.push({
      externalId: post.id,
      // `story` cobre posts sem texto próprio ("A página atualizou a foto..."),
      // que ainda assim recebem comentários.
      message: post.message ?? post.story ?? null,
      permalink: post.permalink_url ?? null,
      mediaType: post.full_picture ? 'PHOTO' : 'STATUS',
      mediaUrl: post.full_picture ?? null,
      publishedAt: parseDate(post.created_time),
      commentCount: post.comments?.summary?.total_count ?? null,
    });
  }
  return posts;
}

/**
 * Mídias do Instagram. A coleção não aceita `since`, então paramos ao cruzar a
 * data de corte — a ordem é cronológica decrescente.
 */
export async function listInstagramMedia(
  igUserId: string,
  token: string,
  since: Date,
  maxPages = 20,
): Promise<RemotePost[]> {
  interface Raw {
    id: string;
    caption?: string;
    media_type?: string;
    media_url?: string;
    thumbnail_url?: string;
    permalink?: string;
    timestamp?: string;
    comments_count?: number;
  }

  const posts: RemotePost[] = [];
  for await (const media of paginate<Raw>({
    path: `${igUserId}/media`,
    token,
    params: {
      fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count',
    },
    limit: 50,
    maxPages,
  })) {
    const publishedAt = parseDate(media.timestamp);
    if (publishedAt && publishedAt < since) break;

    posts.push({
      externalId: media.id,
      message: media.caption ?? null,
      permalink: media.permalink ?? null,
      mediaType: media.media_type ?? null,
      // VIDEO não retorna `media_url` utilizável para exibição; a thumbnail sim.
      mediaUrl: media.media_url ?? media.thumbnail_url ?? null,
      publishedAt,
      commentCount: media.comments_count ?? null,
    });
  }
  return posts;
}

// --- Comentários -------------------------------------------------------------

/**
 * Comentários de um post do Facebook, incluindo respostas.
 *
 * `filter=stream` traz a árvore achatada — comentários e respostas na mesma
 * coleção, cada um com seu `parent`. É uma requisição em vez de uma por
 * comentário, e é o que torna o sync viável em posts com centenas de respostas.
 */
export async function listFacebookComments(
  postId: string,
  token: string,
  maxPages = 20,
): Promise<RemoteComment[]> {
  interface Raw {
    id: string;
    message?: string;
    created_time?: string;
    like_count?: number;
    comment_count?: number;
    is_hidden?: boolean;
    parent?: { id: string };
    from?: { id?: string; name?: string; picture?: { data?: { url?: string } } };
  }

  const comments: RemoteComment[] = [];
  for await (const comment of paginate<Raw>({
    path: `${postId}/comments`,
    token,
    params: {
      fields:
        'id,message,created_time,like_count,comment_count,is_hidden,parent{id},from{id,name,picture{url}}',
      filter: 'stream',
      order: 'chronological',
    },
    limit: 100,
    maxPages,
  })) {
    comments.push({
      externalId: comment.id,
      parentExternalId: comment.parent?.id ?? null,
      authorExternalId: comment.from?.id ?? null,
      authorName: comment.from?.name ?? null,
      authorPictureUrl: comment.from?.picture?.data?.url ?? null,
      message: comment.message ?? null,
      likeCount: comment.like_count ?? 0,
      replyCount: comment.comment_count ?? 0,
      publishedAt: parseDate(comment.created_time),
      isHidden: comment.is_hidden ?? false,
      raw: comment,
    });
  }
  return comments;
}

/**
 * Comentários de uma mídia do Instagram.
 *
 * Não existe `filter=stream` aqui: as respostas vêm aninhadas em `replies` e
 * são achatadas abaixo. O IG também não expõe ID de autor utilizável em
 * comentários — só `username` —, então `authorExternalId` recebe o username.
 */
export async function listInstagramComments(
  mediaId: string,
  token: string,
  maxPages = 20,
): Promise<RemoteComment[]> {
  interface RawReply {
    id: string;
    text?: string;
    timestamp?: string;
    like_count?: number;
    username?: string;
    hidden?: boolean;
  }
  interface Raw extends RawReply {
    replies?: { data?: RawReply[] };
  }

  const map = (raw: RawReply, parentId: string | null): RemoteComment => ({
    externalId: raw.id,
    parentExternalId: parentId,
    authorExternalId: raw.username ?? null,
    authorName: raw.username ?? null,
    authorPictureUrl: null,
    message: raw.text ?? null,
    likeCount: raw.like_count ?? 0,
    replyCount: 0,
    publishedAt: parseDate(raw.timestamp),
    isHidden: raw.hidden ?? false,
    raw,
  });

  const comments: RemoteComment[] = [];
  for await (const comment of paginate<Raw>({
    path: `${mediaId}/comments`,
    token,
    params: {
      fields:
        'id,text,timestamp,like_count,username,hidden,replies.limit(100){id,text,timestamp,like_count,username,hidden}',
    },
    limit: 50,
    maxPages,
  })) {
    const replies = comment.replies?.data ?? [];
    comments.push({ ...map(comment, null), replyCount: replies.length });
    for (const reply of replies) comments.push(map(reply, comment.id));
  }
  return comments;
}

// --- Ações de moderação ------------------------------------------------------

/** Responde a um comentário. O endpoint difere por plataforma. */
export async function replyToComment(
  platform: Platform,
  commentId: string,
  token: string,
  message: string,
): Promise<string> {
  const path = platform === 'instagram' ? `${commentId}/replies` : `${commentId}/comments`;
  const result = await graph<{ id: string }>({ path, token, method: 'POST', body: { message } });
  return result.id;
}

/**
 * Curtir um comentário — Facebook apenas.
 *
 * A Graph API não expõe endpoint para curtir comentários do Instagram. Não é
 * limitação de permissão: o recurso não existe. A interface esconde o botão em
 * vez de oferecer uma ação que sempre falha.
 */
export async function likeComment(commentId: string, token: string): Promise<void> {
  await graph({ path: `${commentId}/likes`, token, method: 'POST' });
}

export async function unlikeComment(commentId: string, token: string): Promise<void> {
  await graph({ path: `${commentId}/likes`, token, method: 'DELETE' });
}

/**
 * Oculta ou reexibe. O parâmetro tem nome diferente em cada plataforma.
 *
 * Atenção: no Instagram, comentários do próprio dono da mídia continuam
 * visíveis mesmo ocultados.
 */
export async function setCommentHidden(
  platform: Platform,
  commentId: string,
  token: string,
  hidden: boolean,
): Promise<void> {
  const body = platform === 'instagram' ? { hide: hidden } : { is_hidden: hidden };
  await graph({ path: commentId, token, method: 'POST', body });
}

/**
 * Exclui um comentário.
 *
 * No Instagram só o dono da mídia pode excluir, mesmo quando o solicitante é o
 * autor do comentário — falha de exclusão é resultado esperado em alguns casos,
 * não bug.
 */
export async function deleteComment(commentId: string, token: string): Promise<void> {
  await graph({ path: commentId, token, method: 'DELETE' });
}

/** Confirma se um comentário ainda existe, para a reconciliação. */
export async function commentExists(commentId: string, token: string): Promise<boolean> {
  try {
    await graph({ path: commentId, token, params: { fields: 'id' } });
    return true;
  } catch (error) {
    if (error instanceof GraphError && error.isMissing) return false;
    throw error;
  }
}
