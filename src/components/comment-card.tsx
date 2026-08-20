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
}: {
  item: InboxItem;
  activeStatus: InboxStatus;
}) {
  const { comment, replies, postPermalink, postMessage, accountName } = item;
  const router = useRouter();
  const [replyOpen, setReplyOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [exiting, setExiting] = useState(false);
  const [pending, startTransition] = useTransition();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshStarted = useRef(false);

  const canLike = comment.platform === 'facebook';

  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
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
    setExiting(true);
    // Fallback para navegadores que não disparem transitionend (ou se a aba
    // perder foco no meio da animação).
    refreshTimer.current = setTimeout(refreshAfterExit, 440);
  }

  function run(
    action: () => Promise<{ ok: boolean; message?: string }>,
    options: { confirmText?: string; leaveAfterSuccess?: boolean } = {},
  ) {
    if (options.confirmText && !window.confirm(options.confirmText)) return;
    startTransition(async () => {
      const result = await action();
      setFeedback(result.message ? { ok: result.ok, message: result.message } : null);
      if (result.ok && options.leaveAfterSuccess) beginExit();
    });
  }

  function submitReply() {
    const text = draft.trim();
    if (!text) return;
    const leaveAfterSuccess = leavesCurrentCategory('answered');
    startTransition(async () => {
      const result = await replyToComment(comment.id, text, !leaveAfterSuccess);
      setFeedback(result.message ? { ok: result.ok, message: result.message } : null);
      if (result.ok) {
        setDraft('');
        setReplyOpen(false);
        if (leaveAfterSuccess) beginExit();
      }
    });
  }

  return (
    <div
      className={`comment-card-shell grid origin-top transition-[grid-template-rows,opacity,transform] duration-[360ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
        exiting
          ? 'grid-rows-[0fr] -translate-y-2 scale-[0.985] opacity-0'
          : 'grid-rows-[1fr] translate-y-0 scale-100 opacity-100'
      }`}
      data-comment-id={comment.id}
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
      <div className="min-h-0 overflow-hidden pb-4">
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
              <div key={reply.id} className="border-l-2 border-line-strong pl-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-xs font-medium ${reply.isOwn ? 'text-accent' : ''}`}>
                  {reply.isOwn ? 'Você' : (reply.authorName ?? 'Autor desconhecido')}
                </span>
                <RelativeTime value={reply.publishedAt} />
                {reply.isHidden && <Badge tone="warning">Oculto</Badge>}
              </div>
              <p className="whitespace-pre-wrap">{reply.message}</p>
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
          onClick={() => setReplyOpen((open) => !open)}
          disabled={pending}
        >
          <Reply size={13} strokeWidth={1.8} />
          {replyOpen ? 'Cancelar' : 'Responder'}
        </Button>

        {canLike && (
          <Button size="sm" onClick={() => run(() => toggleLike(comment.id))} disabled={pending}>
            <Heart size={13} strokeWidth={1.8} fill={comment.likedByUs ? 'currentColor' : 'none'} />
            {comment.likedByUs ? 'Curtido' : 'Curtir'}
          </Button>
        )}

        <Button size="sm" onClick={() => run(() => toggleHide(comment.id))} disabled={pending}>
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

      {replyOpen && (
        <div className="space-y-3 border-t border-line-subtle p-5">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            autoFocus
            placeholder="Escreva a resposta que será publicada no Meta…"
            className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm leading-relaxed placeholder:text-ink-muted"
            onKeyDown={(event) => {
              // Cmd/Ctrl+Enter envia: o inbox é operado em sequência.
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitReply();
            }}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={submitReply} disabled={pending || !draft.trim()}>
              <Send size={13} strokeWidth={1.8} />
              {pending ? 'Publicando…' : 'Publicar resposta'}
            </Button>
            <span className="text-xs text-ink-muted">⌘/Ctrl + Enter</span>
          </div>
        </div>
      )}

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
