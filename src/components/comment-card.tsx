'use client';

import { useState, useTransition } from 'react';
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

/**
 * Um comentário com sua thread e todas as ações.
 *
 * As ações que dependem da plataforma (curtir só no Facebook) são escondidas, e
 * não desabilitadas: um botão cinza sugere "falta permissão", quando o caso é
 * que o recurso não existe na API do Instagram.
 */
export function CommentCard({ item }: { item: InboxItem }) {
  const { comment, replies, postPermalink, postMessage, accountName } = item;
  const [replyOpen, setReplyOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const canLike = comment.platform === 'facebook';

  function run(action: () => Promise<{ ok: boolean; message?: string }>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    startTransition(async () => {
      const result = await action();
      setFeedback(result.message ? { ok: result.ok, message: result.message } : null);
    });
  }

  function submitReply() {
    const text = draft.trim();
    if (!text) return;
    startTransition(async () => {
      const result = await replyToComment(comment.id, text);
      setFeedback(result.message ? { ok: result.ok, message: result.message } : null);
      if (result.ok) {
        setDraft('');
        setReplyOpen(false);
      }
    });
  }

  return (
    <Card className="space-y-3">
      {/* Cabeçalho: quem, quando, onde */}
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{comment.authorName ?? 'Autor desconhecido'}</span>
            <Badge tone={comment.platform === 'instagram' ? 'accent' : 'plain'}>
              {comment.platform === 'instagram' ? 'Instagram' : 'Facebook'}
            </Badge>
            <RelativeTime value={comment.publishedAt} />
            {comment.isHidden && <Badge tone="warning">Oculto</Badge>}
            {comment.status === 'answered' && <Badge tone="positive">Respondido</Badge>}
            {comment.status === 'ignored' && <Badge tone="neutral">Arquivado</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-muted">
            {accountName}
            {postMessage ? ` · ${postMessage.slice(0, 70)}` : ''}
          </p>
        </div>

        {postPermalink && (
          <a
            href={postPermalink}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent hover:underline"
          >
            Ver no {comment.platform === 'instagram' ? 'Instagram' : 'Facebook'} ↗
          </a>
        )}
      </div>

      {/* Texto */}
      <p className="whitespace-pre-wrap text-sm">{comment.message || <em className="text-ink-muted">sem texto</em>}</p>

      {/* Classificação da IA */}
      {comment.analyzedAt ? (
        <div className="flex flex-wrap items-center gap-1.5">
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
        <p className="text-xs text-ink-muted">Sem análise de IA ainda.</p>
      )}

      {/* Thread. É o "olhar outras respostas": nossas e de terceiros, em ordem. */}
      {replies.length > 0 && (
        <div className="space-y-2 border-l-2 border-line pl-3">
          {replies.map((reply) => (
            <div key={reply.id} className="text-sm">
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

      {/* Ações */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button
          size="sm"
          variant="primary"
          onClick={() => setReplyOpen((open) => !open)}
          disabled={pending}
        >
          {replyOpen ? 'Cancelar' : 'Responder'}
        </Button>

        {canLike && (
          <Button size="sm" onClick={() => run(() => toggleLike(comment.id))} disabled={pending}>
            {comment.likedByUs ? '♥ Curtido' : '♡ Curtir'}
          </Button>
        )}

        <Button size="sm" onClick={() => run(() => toggleHide(comment.id))} disabled={pending}>
          {comment.isHidden ? 'Reexibir' : 'Ocultar'}
        </Button>

        {comment.status !== 'ignored' ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => run(() => setStatus(comment.id, 'ignored'))}
            disabled={pending}
          >
            Arquivar
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => run(() => setStatus(comment.id, 'new'))}
            disabled={pending}
          >
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
              () => removeComment(comment.id),
              'Excluir este comentário no Meta? A ação é permanente e não pode ser desfeita.',
            )
          }
        >
          Excluir
        </Button>
      </div>

      {replyOpen && (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            autoFocus
            placeholder="Escreva a resposta que será publicada no Meta…"
            className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm"
            onKeyDown={(event) => {
              // Cmd/Ctrl+Enter envia: o inbox é operado em sequência.
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitReply();
            }}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={submitReply} disabled={pending || !draft.trim()}>
              {pending ? 'Publicando…' : 'Publicar resposta'}
            </Button>
            <span className="text-xs text-ink-muted">⌘/Ctrl + Enter</span>
          </div>
        </div>
      )}

      {feedback && (
        <p
          className={`text-xs ${feedback.ok ? 'text-ink-muted' : 'text-negative'}`}
          role={feedback.ok ? undefined : 'alert'}
        >
          {feedback.message}
        </p>
      )}
    </Card>
  );
}
