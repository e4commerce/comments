'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  Archive,
  ExternalLink,
  Eye,
  EyeOff,
  Heart,
  Reply,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react';
import {
  removeComment,
  replyToComment,
  setStatus,
  toggleHide,
  toggleLike,
} from '@/app/actions';
import type { InboxItem } from '@/lib/queries';
import { RelativeTime } from './relative-time';
import {
  INTENT_LABELS,
  SENTIMENT_LABELS,
  URGENCY_LABELS,
  motiveLabel,
  type Intent,
  type Sentiment,
  type Urgency,
} from '@/lib/taxonomy';
import { Badge, Button, Card } from './ui';

export type InboxStatus = 'new' | 'answered' | 'ignored' | 'all';

/**
 * Um comentário com sua thread e todas as ações.
 *
 * As ações que dependem da plataforma (curtir só no Facebook) são escondidas, e
 * não desabilitadas: um botão cinza sugere "falta permissão", quando o caso é
 * que o recurso não existe na API do Instagram.
 */
export function CommentCard({
  item,
  activeStatus,
  countHiddenUnanswered,
}: {
  item: InboxItem;
  activeStatus: InboxStatus;
  countHiddenUnanswered: boolean;
}) {
  const { comment, replies, postPermalink, postMessage, accountName } = item;
  const router = useRouter();
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [exiting, setExiting] = useState(false);
  const [pending, startTransition] = useTransition();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitFrame = useRef<number | null>(null);
  const refreshStarted = useRef(false);

  const canLike = comment.platform === 'facebook';

  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (exitFrame.current !== null) cancelAnimationFrame(exitFrame.current);
    },
    [],
  );

  function leavesCurrentCategory(nextStatus: Exclude<InboxStatus, 'all'>): boolean {
    return activeStatus !== 'all' && activeStatus !== nextStatus;
  }

  function refreshAfterExit() {
    if (refreshStarted.current) return;
    refreshStarted.current = true;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    router.refresh();
  }

  function beginExit() {
    // A atualização visual fica fora da transition assíncrona da Server Action.
    // Isso garante um frame real entre o resultado confirmado e o início da
    // animação, em vez de o React poder agrupar saída e refresh.
    exitFrame.current = requestAnimationFrame(() => {
      setExiting(true);
      // Fallback para navegadores que não disparem transitionend (ou se a aba
      // perder foco no meio da animação).
      refreshTimer.current = setTimeout(refreshAfterExit, 700);
    });
  }

  function handleActionError(error: unknown) {
    const message = error instanceof Error ? error.message : '';

    // Uma aba aberta durante um deploy ainda aponta para os IDs das Server
    // Actions do build anterior. O servidor novo responde fora do protocolo
    // esperado pelo cliente antigo; sem este catch, o React derruba a página
    // inteira. Um reload completo sincroniza os dois builds e também confirma
    // o estado real caso a ação tenha chegado a ser processada.
    if (message.includes('An unexpected response was received from the server')) {
      window.location.reload();
      return;
    }

    setFeedback({
      ok: false,
      message: 'Não foi possível concluir a ação. Recarregue a página e tente novamente.',
    });
  }

  function run(
    action: () => Promise<{ ok: boolean; message?: string }>,
    options: { confirmText?: string; leaveAfterSuccess?: boolean } = {},
  ) {
    if (options.confirmText && !window.confirm(options.confirmText)) return;
    startTransition(async () => {
      try {
        const result = await action();
        setFeedback(result.message ? { ok: result.ok, message: result.message } : null);
        if (result.ok && options.leaveAfterSuccess) beginExit();
      } catch (error) {
        handleActionError(error);
      }
    });
  }

  function toggleReplyComposer(targetId: string) {
    setDraft('');
    setReplyTargetId((current) => (current === targetId ? null : targetId));
  }

  function submitReply(targetId: string) {
    const text = draft.trim();
    if (!text) return;
    const leaveAfterSuccess = leavesCurrentCategory('answered');
    startTransition(async () => {
      try {
        const result = await replyToComment(targetId, text, !leaveAfterSuccess);
        setFeedback(result.message ? { ok: result.ok, message: result.message } : null);
        if (result.ok) {
          setDraft('');
          setReplyTargetId(null);
          if (leaveAfterSuccess) beginExit();
        }
      } catch (error) {
        handleActionError(error);
      }
    });
  }

  function replyComposer(targetId: string, targetAuthorName: string | null, compact = false) {
    return (
      <div className={compact ? 'mt-3 space-y-2.5' : 'space-y-3 border-t border-line-subtle p-5'}>
        <p className="text-xs font-medium text-ink-muted">
          Respondendo a {targetAuthorName ?? 'este comentário'}
        </p>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={compact ? 2 : 3}
          autoFocus
          placeholder="Escreva a resposta que será publicada no Meta…"
          className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm leading-relaxed placeholder:text-ink-muted"
          onKeyDown={(event) => {
            // Cmd/Ctrl+Enter envia: o inbox é operado em sequência.
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitReply(targetId);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={() => submitReply(targetId)}
            disabled={pending || !draft.trim()}
          >
            <Send size={13} strokeWidth={1.8} />
            {pending ? 'Publicando…' : 'Publicar resposta'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => toggleReplyComposer(targetId)} disabled={pending}>
            Cancelar
          </Button>
          <span className="text-xs text-ink-muted">⌘/Ctrl + Enter</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="comment-card-shell"
      data-comment-id={comment.id}
      data-exiting={exiting ? 'true' : 'false'}
      aria-hidden={exiting}
      inert={exiting ? true : undefined}
      onTransitionEnd={(event) => {
        if (
          exiting &&
          event.target === event.currentTarget &&
          event.propertyName === 'grid-template-rows'
        ) {
          refreshAfterExit();
        }
      }}
    >
      <div className="min-h-0 overflow-hidden">
        <Card className="overflow-hidden p-0 transition-colors hover:border-line">
      <div className="space-y-4 p-5">
        {/* Cabeçalho: quem, quando, onde */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
            {(comment.authorName ?? '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold">{comment.authorName ?? 'Autor desconhecido'}</span>
            <Badge tone={comment.platform === 'instagram' ? 'accent' : 'plain'}>
              {comment.platform === 'instagram' ? 'Instagram' : 'Facebook'}
            </Badge>
            <RelativeTime value={comment.publishedAt} />
            {comment.isHidden && <Badge tone="warning">Oculto</Badge>}
            {comment.status === 'answered' && <Badge tone="positive">Respondido</Badge>}
            {comment.status === 'ignored' && <Badge tone="neutral">Arquivado</Badge>}
          </div>
            <p className="mt-1 truncate text-xs text-ink-muted">
            {accountName}
            {postMessage ? ` · ${postMessage.slice(0, 70)}` : ''}
          </p>
        </div>

        {postPermalink && (
          <a
            href={postPermalink}
            target="_blank"
            rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink"
          >
              Ver no {comment.platform === 'instagram' ? 'Instagram' : 'Facebook'}
              <ExternalLink size={12} strokeWidth={1.8} />
          </a>
        )}
      </div>

      {/* Texto */}
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
          {comment.message || <em className="text-ink-muted">sem texto</em>}
        </p>

      {/* Classificação da IA */}
      {comment.analyzedAt ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-line-subtle pt-3">
          {comment.sentiment && (
            <Badge
              tone={
                comment.sentiment === 'positive'
                  ? 'positive'
                  : comment.sentiment === 'negative'
                    ? 'negative'
                    : 'neutral'
              }
            >
              {SENTIMENT_LABELS[comment.sentiment as Sentiment] ?? comment.sentiment}
            </Badge>
          )}
          {comment.motive && <Badge tone="plain">{motiveLabel(comment.motive)}</Badge>}
          {comment.intent && (
            <Badge tone="plain">{INTENT_LABELS[comment.intent as Intent] ?? comment.intent}</Badge>
          )}
          {comment.urgency && comment.urgency !== 'low' && (
            <Badge tone={comment.urgency === 'high' ? 'negative' : 'warning'}>
              Urgência {URGENCY_LABELS[comment.urgency as Urgency]?.toLowerCase()}
            </Badge>
          )}
          {comment.isSpam && <Badge tone="warning">Spam</Badge>}
        </div>
      ) : (
          <p className="border-t border-line-subtle pt-3 text-xs text-ink-muted">
            Sem análise de IA ainda.
          </p>
      )}

      {/* Thread. É o "olhar outras respostas": nossas e de terceiros, em ordem. */}
      {replies.length > 0 && (
          <div className="space-y-3 rounded-lg bg-surface-muted p-3.5">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
              Respostas na conversa
            </p>
          {replies.map((reply) => (
              <div
                key={reply.id}
                className="border-l-2 border-line-strong pl-3 text-sm"
                style={{ marginLeft: `${Math.min(Math.max(reply.threadDepth - 1, 0), 3) * 16}px` }}
              >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-xs font-medium ${reply.isOwn ? 'text-accent' : ''}`}>
                  {reply.isOwn ? 'Você' : (reply.authorName ?? 'Autor desconhecido')}
                </span>
                <RelativeTime value={reply.publishedAt} />
                {reply.isHidden && <Badge tone="warning">Oculto</Badge>}
              </div>
              {reply.threadDepth > 1 && (
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  Em resposta a {reply.replyToAuthorName ?? 'outro comentário'}
                </p>
              )}
              <p className="whitespace-pre-wrap">{reply.message}</p>
              {!reply.isOwn && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleReplyComposer(reply.id)}
                    disabled={pending}
                  >
                    <Reply size={12} strokeWidth={1.8} />
                    {replyTargetId === reply.id ? 'Cancelar' : 'Responder'}
                  </Button>
                  {canLike && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => run(() => toggleLike(reply.id))}
                      disabled={pending}
                    >
                      <Heart
                        size={12}
                        strokeWidth={1.8}
                        fill={reply.likedByUs ? 'currentColor' : 'none'}
                      />
                      {reply.likedByUs ? 'Curtido' : 'Curtir'}
                      {reply.likeCount > 0 ? ` · ${reply.likeCount.toLocaleString('pt-BR')}` : ''}
                    </Button>
                  )}
                </div>
              )}
              {replyTargetId === reply.id &&
                replyComposer(reply.id, reply.authorName ?? 'Autor desconhecido', true)}
            </div>
          ))}
        </div>
      )}
      </div>

      {/* Ações */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line-subtle bg-canvas/60 px-5 py-3.5">
        <Button
          size="sm"
          variant="primary"
          onClick={() => toggleReplyComposer(comment.id)}
          disabled={pending}
        >
          <Reply size={13} strokeWidth={1.8} />
          {replyTargetId === comment.id ? 'Cancelar' : 'Responder'}
        </Button>

        {canLike && (
          <Button size="sm" onClick={() => run(() => toggleLike(comment.id))} disabled={pending}>
            <Heart size={13} strokeWidth={1.8} fill={comment.likedByUs ? 'currentColor' : 'none'} />
            {comment.likedByUs ? 'Curtido' : 'Curtir'}
            {comment.likeCount > 0 ? ` · ${comment.likeCount.toLocaleString('pt-BR')}` : ''}
          </Button>
        )}

        <Button
          size="sm"
          onClick={() => {
            const leaveAfterSuccess =
              activeStatus === 'new' && !comment.isHidden && !countHiddenUnanswered;
            run(() => toggleHide(comment.id, !leaveAfterSuccess), { leaveAfterSuccess });
          }}
          disabled={pending}
        >
          {comment.isHidden ? <Eye size={13} strokeWidth={1.8} /> : <EyeOff size={13} strokeWidth={1.8} />}
          {comment.isHidden ? 'Reexibir' : 'Ocultar'}
        </Button>

        {comment.status !== 'ignored' ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const leaveAfterSuccess = leavesCurrentCategory('ignored');
              run(() => setStatus(comment.id, 'ignored', !leaveAfterSuccess), {
                leaveAfterSuccess,
              });
            }}
            disabled={pending}
          >
            <Archive size={13} strokeWidth={1.8} />
            Arquivar
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const leaveAfterSuccess = leavesCurrentCategory('new');
              run(() => setStatus(comment.id, 'new', !leaveAfterSuccess), {
                leaveAfterSuccess,
              });
            }}
            disabled={pending}
          >
            <RotateCcw size={13} strokeWidth={1.8} />
            Reabrir
          </Button>
        )}

        <Button
          size="sm"
          variant="danger"
          className="ml-auto"
          disabled={pending}
          onClick={() =>
            run(
              () => removeComment(comment.id, false),
              {
                confirmText:
                  'Excluir este comentário no Meta? A ação é permanente e não pode ser desfeita.',
                leaveAfterSuccess: true,
              },
            )
          }
        >
          <Trash2 size={13} strokeWidth={1.8} />
          Excluir
        </Button>
      </div>

      {replyTargetId === comment.id && replyComposer(comment.id, comment.authorName)}

      {feedback && (
        <p
          className={`border-t border-line-subtle px-5 py-3 text-xs ${
            feedback.ok ? 'text-ink-muted' : 'text-negative'
          }`}
          role={feedback.ok ? undefined : 'alert'}
        >
          {feedback.message}
        </p>
      )}
        </Card>
      </div>
    </div>
  );
}
