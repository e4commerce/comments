import {
  type SQL,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  ne,
  sql,
} from 'drizzle-orm';
import {
  appSettings,
  type Comment,
  type CommentFilter,
  accounts,
  commentFilters,
  comments,
  db,
  posts,
} from '@/db';
import {
  type CommentFilterRule,
  excludeCommentFilterRules,
} from './comment-filters';
import type { InboxSort } from './inbox-sort';

/**
 * Leituras da interface. Ficam juntas aqui para que inbox e dashboard usem
 * exatamente os mesmos critérios — o número do gráfico e o tamanho da lista
 * divergirem é o tipo de bug que ninguém nota e todo mundo age em cima.
 */

/** Comentário de terceiro, ainda publicado. A base de tudo que é contado. */
function moderatable(): SQL {
  return and(eq(comments.isOwn, false), eq(comments.deletedOnPlatform, false))!;
}

export interface InboxFilters {
  status?: string;
  platform?: string;
  sentiment?: string;
  motive?: string;
  urgency?: string;
  accountId?: string;
  search?: string;
  /** Só comentários de primeiro nível (esconde respostas de terceiros na fila). */
  topLevelOnly?: boolean;
  sort?: InboxSort;
  days?: number;
}

function buildWhere(
  filters: InboxFilters,
  commentFilterRules: CommentFilterRule[],
  countHiddenUnanswered = true,
): SQL {
  const clauses: SQL[] = [
    moderatable(),
    ...excludeCommentFilterRules(comments.message, commentFilterRules),
  ];

  if (filters.status && filters.status !== 'all') {
    clauses.push(eq(comments.status, filters.status));
  }
  if (filters.status === 'new' && !countHiddenUnanswered) {
    clauses.push(eq(comments.isHidden, false));
  }
  if (filters.platform && filters.platform !== 'all') {
    clauses.push(eq(comments.platform, filters.platform));
  }
  if (filters.sentiment && filters.sentiment !== 'all') {
    clauses.push(eq(comments.sentiment, filters.sentiment));
  }
  if (filters.motive && filters.motive !== 'all') {
    clauses.push(eq(comments.motive, filters.motive));
  }
  if (filters.urgency && filters.urgency !== 'all') {
    clauses.push(eq(comments.urgency, filters.urgency));
  }
  if (filters.accountId && filters.accountId !== 'all') {
    clauses.push(eq(comments.accountId, filters.accountId));
  }
  if (filters.search?.trim()) {
    clauses.push(like(comments.message, `%${filters.search.trim()}%`));
  }
  if (filters.topLevelOnly) {
    clauses.push(isNull(comments.parentExternalId));
  }
  if (filters.days) {
    clauses.push(gte(comments.publishedAt, new Date(Date.now() - filters.days * 86_400_000)));
  }

  return and(...clauses)!;
}

export interface InboxItem {
  comment: Comment;
  postPermalink: string | null;
  postMessage: string | null;
  accountName: string;
  /** Respostas na árvore, agrupadas sob o comentário ao qual respondem. */
  replies: InboxReply[];
}

export type InboxReply = Comment & {
  threadDepth: number;
  replyToAuthorName: string | null;
};

const PAGE_SIZE = 25;

/**
 * Atividade da conversa, não apenas a publicação do comentário pai.
 * Assim uma nova resposta em uma conversa antiga volta ao topo da fila.
 */
const lastActivityAt = sql<number>`coalesce(
  (
    with recursive thread(external_id, published_at) as (
      select thread_reply.external_id, thread_reply.published_at
      from comments as thread_reply
      where thread_reply.parent_external_id = ${comments.externalId}
        and thread_reply.deleted_on_platform = 0
      union all
      select child.external_id, child.published_at
      from comments as child
      inner join thread on child.parent_external_id = thread.external_id
      where child.deleted_on_platform = 0
    )
    select max(thread.published_at) from thread
  ),
  ${comments.publishedAt}
)`;

function inboxOrderBy(sort: InboxSort = 'priority'): SQL[] {
  switch (sort) {
    case 'newest':
      return [desc(lastActivityAt), desc(comments.publishedAt)];
    case 'oldest':
      return [
        sql`case when ${lastActivityAt} is null then 1 else 0 end`,
        asc(lastActivityAt),
        asc(comments.publishedAt),
      ];
    case 'most_liked':
      return [desc(comments.likeCount), desc(lastActivityAt)];
    case 'most_replied':
      return [desc(comments.replyCount), desc(lastActivityAt)];
    case 'priority':
    default:
      return [
        sql`case ${comments.urgency} when 'high' then 0 when 'medium' then 1 when 'low' then 3 else 2 end`,
        desc(lastActivityAt),
      ];
  }
}

export async function listInbox(
  filters: InboxFilters,
  page = 0,
  commentFilterRules: CommentFilterRule[] = [],
  countHiddenUnanswered?: boolean,
): Promise<{ items: InboxItem[]; total: number; hasMore: boolean }> {
  const shouldCountHidden =
    countHiddenUnanswered ?? (await getAppSettings()).countHiddenUnanswered;
  const where = buildWhere(filters, commentFilterRules, shouldCountHidden);

  const totalRow = await db.select({ value: count() }).from(comments).where(where).get();
  const total = totalRow?.value ?? 0;

  const rows = await db
    .select({
      comment: comments,
      postPermalink: posts.permalink,
      postMessage: posts.message,
      accountName: accounts.name,
    })
    .from(comments)
    .leftJoin(posts, eq(comments.postId, posts.id))
    .innerJoin(accounts, eq(comments.accountId, accounts.id))
    .where(where)
    .orderBy(...inboxOrderBy(filters.sort))
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE)
    .all();

  // Busca a árvore por níveis. Normalmente existe só um nível; o loop torna
  // visíveis também as respostas publicadas diretamente em subcomentários.
  const externalIds = rows.map((row) => row.comment.externalId);
  const descendants: Comment[] = [];
  const seenExternalIds = new Set(externalIds);
  let frontier = externalIds;

  // O Meta limita a profundidade prática das conversas. Dez níveis também
  // protegem a leitura contra um ciclo acidental em dados legados.
  for (let depth = 0; frontier.length > 0 && depth < 10; depth++) {
    const next: Comment[] = [];
    for (let start = 0; start < frontier.length; start += 500) {
      const children = await db
        .select()
        .from(comments)
        .where(
          and(
            inArray(comments.parentExternalId, frontier.slice(start, start + 500)),
            eq(comments.deletedOnPlatform, false),
          ),
        )
        .orderBy(comments.publishedAt)
        .all();
      next.push(...children);
    }

    frontier = [];
    for (const reply of next) {
      if (seenExternalIds.has(reply.externalId)) continue;
      seenExternalIds.add(reply.externalId);
      descendants.push(reply);
      frontier.push(reply.externalId);
    }
  }

  const commentsByExternalId = new Map(
    [...rows.map((row) => row.comment), ...descendants].map((comment) => [
      comment.externalId,
      comment,
    ]),
  );
  const childrenByParent = new Map<string, Comment[]>();
  for (const reply of descendants) {
    if (!reply.parentExternalId) continue;
    const children = childrenByParent.get(reply.parentExternalId) ?? [];
    children.push(reply);
    childrenByParent.set(reply.parentExternalId, children);
  }

  const repliesForRoot = (rootExternalId: string): InboxReply[] => {
    const ordered: InboxReply[] = [];
    const walk = (parentExternalId: string, depth: number) => {
      for (const reply of childrenByParent.get(parentExternalId) ?? []) {
        ordered.push({
          ...reply,
          threadDepth: depth,
          replyToAuthorName: commentsByExternalId.get(parentExternalId)?.authorName ?? null,
        });
        walk(reply.externalId, depth + 1);
      }
    };
    walk(rootExternalId, 1);
    return ordered;
  };

  return {
    items: rows.map((row) => ({
      ...row,
      replies: repliesForRoot(row.comment.externalId),
    })),
    total,
    hasMore: (page + 1) * PAGE_SIZE < total,
  };
}

// --- Dashboard ---------------------------------------------------------------

export interface Overview {
  total: number;
  analyzed: number;
  pendingReply: number;
  highUrgency: number;
  questions: number;
  spam: number;
  sentiment: { positive: number; neutral: number; negative: number };
  /** Volumetria diária, já com os dias vazios preenchidos. */
  daily: { day: string; total: number; positive: number; neutral: number; negative: number }[];
  motives: { motive: string; count: number; negative: number }[];
  byPlatform: { platform: string; count: number }[];
}

export async function getOverview(days: number): Promise<Overview> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [commentFilterRules, settings] = await Promise.all([
    listCommentFilters(),
    getAppSettings(),
  ]);
  const window = and(
    moderatable(),
    ...excludeCommentFilterRules(comments.message, commentFilterRules),
    gte(comments.publishedAt, since),
  )!;
  // A fila tem uma linha por conversa. Respostas aparecem dentro da thread e
  // não podem inflar os KPIs como se fossem novos cartões independentes.
  const pendingReply = settings.countHiddenUnanswered
    ? and(eq(comments.status, 'new'), isNull(comments.parentExternalId))!
    : and(
        eq(comments.status, 'new'),
        eq(comments.isHidden, false),
        isNull(comments.parentExternalId),
      )!;

  const totals = await db
    .select({
      total: count(),
      analyzed: sql<number>`sum(case when ${comments.analyzedAt} is not null then 1 else 0 end)`,
      pendingReply: sql<number>`sum(case when ${pendingReply} then 1 else 0 end)`,
      highUrgency: sql<number>`sum(case when ${and(eq(comments.urgency, 'high'), pendingReply)} then 1 else 0 end)`,
      questions: sql<number>`sum(case when ${comments.isQuestion} = 1 then 1 else 0 end)`,
      spam: sql<number>`sum(case when ${comments.isSpam} = 1 then 1 else 0 end)`,
      positive: sql<number>`sum(case when ${comments.sentiment} = 'positive' then 1 else 0 end)`,
      neutral: sql<number>`sum(case when ${comments.sentiment} = 'neutral' then 1 else 0 end)`,
      negative: sql<number>`sum(case when ${comments.sentiment} = 'negative' then 1 else 0 end)`,
    })
    .from(comments)
    .where(window)
    .get();

  // published_at é o timestamp original do Meta, não o instante do sync.
  // Railway roda em UTC; -03:00 deixa a virada do dia explícita no fuso de
  // São Paulo (o Brasil não adota horário de verão desde 2019).
  const dayExpr = sql<string>`date(${comments.publishedAt} / 1000, 'unixepoch', '-3 hours')`;

  const dailyRows = await db
    .select({
      day: dayExpr,
      total: count(),
      positive: sql<number>`sum(case when ${comments.sentiment} = 'positive' then 1 else 0 end)`,
      neutral: sql<number>`sum(case when ${comments.sentiment} = 'neutral' then 1 else 0 end)`,
      negative: sql<number>`sum(case when ${comments.sentiment} = 'negative' then 1 else 0 end)`,
    })
    .from(comments)
    .where(window)
    .groupBy(dayExpr)
    .orderBy(dayExpr)
    .all();

  const motiveRows = await db
    .select({
      motive: comments.motive,
      count: count(),
      negative: sql<number>`sum(case when ${comments.sentiment} = 'negative' then 1 else 0 end)`,
    })
    .from(comments)
    .where(and(window, sql`${comments.motive} is not null`))
    .groupBy(comments.motive)
    .orderBy(desc(count()))
    .all();

  const platformRows = await db
    .select({ platform: comments.platform, count: count() })
    .from(comments)
    .where(window)
    .groupBy(comments.platform)
    .all();

  return {
    total: totals?.total ?? 0,
    analyzed: totals?.analyzed ?? 0,
    pendingReply: totals?.pendingReply ?? 0,
    highUrgency: totals?.highUrgency ?? 0,
    questions: totals?.questions ?? 0,
    spam: totals?.spam ?? 0,
    sentiment: {
      positive: totals?.positive ?? 0,
      neutral: totals?.neutral ?? 0,
      negative: totals?.negative ?? 0,
    },
    daily: fillMissingDays(dailyRows, days),
    motives: motiveRows
      .filter((row): row is { motive: string; count: number; negative: number } =>
        Boolean(row.motive),
      )
      .map((row) => ({ motive: row.motive, count: row.count, negative: row.negative })),
    byPlatform: platformRows,
  };
}

/**
 * Preenche dias sem comentário com zero.
 *
 * Sem isso o gráfico de linha liga 10/03 direto a 15/03 como se fosse um
 * intervalo contínuo, escondendo cinco dias de silêncio — que é justamente o
 * que se quer ver em volumetria.
 */
function fillMissingDays(
  rows: { day: string; total: number; positive: number; neutral: number; negative: number }[],
  days: number,
): Overview['daily'] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const result: Overview['daily'] = [];
  const saoPauloDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(Date.now() - offset * 86_400_000);
    const key = saoPauloDay.format(date);
    result.push(byDay.get(key) ?? { day: key, total: 0, positive: 0, neutral: 0, negative: 0 });
  }
  return result;
}

/** Contas conectadas, para os seletores de filtro. */
export async function listAccountOptions(): Promise<{ id: string; name: string }[]> {
  return db.select({ id: accounts.id, name: accounts.name }).from(accounts).orderBy(accounts.name).all();
}

/** Regras globais que retiram comentários da fila sem apagar o histórico. */
export async function listCommentFilters(): Promise<CommentFilter[]> {
  return db.select().from(commentFilters).orderBy(commentFilters.createdAt).all();
}

export interface GlobalAppSettings {
  countHiddenUnanswered: boolean;
}

/** Preferências globais com fallback compatível para bancos ainda sem uma linha. */
export async function getAppSettings(): Promise<GlobalAppSettings> {
  const row = await db
    .select({ countHiddenUnanswered: appSettings.countHiddenUnanswered })
    .from(appSettings)
    .where(eq(appSettings.id, 'global'))
    .get();

  return { countHiddenUnanswered: row?.countHiddenUnanswered ?? true };
}

/** Contagem por status, para os contadores das abas do inbox. */
export async function countsByStatus(
  filters: InboxFilters = {},
  commentFilterRules: CommentFilterRule[] = [],
  countHiddenUnanswered?: boolean,
): Promise<Record<string, number>> {
  const shouldCountHidden =
    countHiddenUnanswered ?? (await getAppSettings()).countHiddenUnanswered;
  const pendingReply = shouldCountHidden
    ? eq(comments.status, 'new')
    : and(eq(comments.status, 'new'), eq(comments.isHidden, false))!;
  const row = await db
    .select({
      new: sql<number>`sum(case when ${pendingReply} then 1 else 0 end)`,
      answered: sql<number>`sum(case when ${comments.status} = 'answered' then 1 else 0 end)`,
      ignored: sql<number>`sum(case when ${comments.status} = 'ignored' then 1 else 0 end)`,
    })
    .from(comments)
    .where(
      buildWhere(
        { ...filters, status: 'all', sort: undefined, topLevelOnly: true },
        commentFilterRules,
      ),
    )
    .get();

  return {
    new: row?.new ?? 0,
    answered: row?.answered ?? 0,
    ignored: row?.ignored ?? 0,
  };
}

/** Existe alguma conta conectada? Decide entre onboarding e interface normal. */
export async function hasAnyAccount(): Promise<boolean> {
  const row = await db.select({ value: count() }).from(accounts).get();
  return (row?.value ?? 0) > 0;
}

/** Total visível no painel, independente da janela de tempo. */
export async function totalComments(): Promise<number> {
  const commentFilterRules = await listCommentFilters();
  const row = await db
    .select({ value: count() })
    .from(comments)
    .where(
      and(
        ne(comments.isOwn, true),
        ...excludeCommentFilterRules(comments.message, commentFilterRules),
      ),
    )
    .get();
  return row?.value ?? 0;
}
