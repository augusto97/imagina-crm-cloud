import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, CornerDownRight, Loader2, Reply } from 'lucide-react';
import type { CommentReactionEmoji } from '@imagina-base/shared';

import { CommentContent } from '@/admin/comments/CommentContent';
import { CommentReactions } from '@/admin/comments/CommentReactions';
import { MentionAutocomplete } from '@/admin/comments/MentionAutocomplete';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useCreateComment, useDeleteComment, useToggleCommentReaction, useUpdateComment } from '@/hooks/useComments';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import type { CommentEntity } from '@/types/comment';

/**
 * v0.1.291 — Lo que va debajo de un comentario raíz: reacciones, «Responder»
 * y el hilo de respuestas (plegado con su contador, de un solo nivel). Lo
 * comparten el panel de comentarios del modal/página y el feed de la ficha.
 *
 * La respuesta HEREDA la visibilidad del raíz (la decide el servidor): una
 * respuesta a un comentario interno jamás llega al portal del cliente.
 */
export function CommentThreadFooter({
    listId,
    recordId,
    root,
    replies,
    authorOf,
    canEdit,
}: {
    listId: number;
    recordId: number;
    root: CommentEntity;
    replies: readonly CommentEntity[];
    authorOf: (c: CommentEntity) => string;
    canEdit: (c: CommentEntity) => boolean;
}): JSX.Element {
    const react = useToggleCommentReaction(listId, recordId);
    const toast = useToast();
    const [expanded, setExpanded] = useState(false);
    const [replying, setReplying] = useState(false);

    const toggle = (commentId: number, emoji: CommentReactionEmoji): void => {
        react.mutate(
            { commentId, emoji },
            { onError: (err) => toast.error(__('No se pudo reaccionar'), err instanceof Error ? err.message : '') },
        );
    };
    const openReply = (): void => {
        setReplying(true);
        setExpanded(true);
    };
    const count = replies.length;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="imcrm-comment-thread">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1">
                {!root.deleted && <CommentReactions reactions={root.reactions} onToggle={(e) => toggle(root.id, e)} />}
                <button
                    type="button"
                    onClick={openReply}
                    className="imcrm-inline-flex imcrm-h-6 imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1.5 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                    data-testid="imcrm-comment-reply"
                >
                    <Reply className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Responder')}
                </button>
                {count > 0 && (
                    <button
                        type="button"
                        onClick={() => setExpanded((v) => !v)}
                        aria-expanded={expanded}
                        className="imcrm-inline-flex imcrm-h-6 imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1.5 imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-bg-accent"
                        data-testid="imcrm-comment-replies-toggle"
                    >
                        {expanded ? <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" /> : <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {sprintf(_n('%d respuesta', '%d respuestas', count), count)}
                    </button>
                )}
            </div>

            {(expanded || replying) && (count > 0 || replying) && (
                <div className="imcrm-ml-1 imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-l-2 imcrm-border-border imcrm-pl-3">
                    {expanded &&
                        replies.map((r) => (
                            <ReplyItem
                                key={r.id}
                                listId={listId}
                                recordId={recordId}
                                reply={r}
                                name={authorOf(r)}
                                canEdit={canEdit(r)}
                                onReact={(emoji) => toggle(r.id, emoji)}
                                onReply={openReply}
                            />
                        ))}
                    {replying && (
                        <ReplyComposer
                            listId={listId}
                            recordId={recordId}
                            rootId={root.id}
                            forClient={root.visibility === 'client'}
                            onDone={() => setReplying(false)}
                        />
                    )}
                </div>
            )}
        </div>
    );
}

function ReplyItem({
    listId,
    recordId,
    reply,
    name,
    canEdit,
    onReact,
    onReply,
}: {
    listId: number;
    recordId: number;
    reply: CommentEntity;
    name: string;
    canEdit: boolean;
    onReact: (emoji: CommentReactionEmoji) => void;
    onReply: () => void;
}): JSX.Element {
    const update = useUpdateComment(listId, recordId);
    const remove = useDeleteComment(listId, recordId);
    const confirm = useConfirm();
    const toast = useToast();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(reply.content);
    const edited = reply.created_at !== reply.updated_at;

    const save = async (): Promise<void> => {
        const content = draft.trim();
        if (content === '' || content === reply.content) {
            setEditing(false);
            return;
        }
        try {
            await update.mutateAsync({ id: reply.id, content });
            setEditing(false);
        } catch (err) {
            toast.error(__('No se pudo editar'), err instanceof Error ? err.message : '');
        }
    };
    const del = async (): Promise<void> => {
        const ok = await confirm({
            title: __('Eliminar respuesta'),
            description: __('Esta acción no se puede deshacer.'),
            destructive: true,
            confirmLabel: __('Eliminar'),
        });
        if (ok) remove.mutate(reply.id);
    };

    return (
        <div className="imcrm-group/reply imcrm-flex imcrm-gap-2" data-testid="imcrm-comment-reply-item">
            <Initials name={name} size={20} />
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                <p className="imcrm-flex imcrm-flex-wrap imcrm-items-baseline imcrm-gap-x-1.5 imcrm-text-[12.5px]">
                    <span className="imcrm-font-medium imcrm-text-foreground">{name}</span>
                    <TimeStamp iso={reply.created_at} />
                    {edited && <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('(editado)')}</span>}
                </p>
                {editing ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                        <Textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                        <div className="imcrm-flex imcrm-gap-2">
                            <Button size="sm" className="imcrm-h-7" onClick={() => void save()} disabled={draft.trim() === '' || update.isPending}>
                                {__('Guardar')}
                            </Button>
                            <Button size="sm" variant="ghost" className="imcrm-h-7" onClick={() => setEditing(false)}>
                                {__('Cancelar')}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="imcrm-text-sm imcrm-text-foreground">
                        <CommentContent content={reply.content} />
                    </div>
                )}
                {!editing && (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1">
                        <CommentReactions reactions={reply.reactions} onToggle={onReact} />
                        <button
                            type="button"
                            onClick={onReply}
                            className="imcrm-inline-flex imcrm-h-6 imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1.5 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                        >
                            <Reply className="imcrm-h-3 imcrm-w-3" />
                            {__('Responder')}
                        </button>
                        {canEdit && (
                            <span className="imcrm-flex imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground [@media(hover:hover)]:imcrm-opacity-0 [@media(hover:hover)]:group-hover/reply:imcrm-opacity-100 focus-within:imcrm-opacity-100">
                                <button type="button" onClick={() => setEditing(true)} className="hover:imcrm-text-foreground">
                                    {__('Editar')}
                                </button>
                                <button type="button" onClick={() => void del()} className="hover:imcrm-text-destructive">
                                    {__('Eliminar')}
                                </button>
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

/** Caja para responder dentro del hilo (con @menciones, como el composer). */
function ReplyComposer({
    listId,
    recordId,
    rootId,
    forClient,
    onDone,
}: {
    listId: number;
    recordId: number;
    rootId: number;
    forClient: boolean;
    onDone: () => void;
}): JSX.Element {
    const create = useCreateComment(listId, recordId);
    const toast = useToast();
    const [draft, setDraft] = useState('');
    const [cursor, setCursor] = useState(0);
    const ref = useRef<HTMLTextAreaElement | null>(null);

    const mention = useMemo(() => {
        const m = /(?:^|\s)@([A-Za-z0-9._-]{0,60})$/.exec(draft.slice(0, cursor));
        if (!m) return null;
        const query = m[1] ?? '';
        return { query, start: cursor - query.length - 1, end: cursor };
    }, [draft, cursor]);

    const submit = async (): Promise<void> => {
        const content = draft.trim();
        if (content === '') return;
        try {
            await create.mutateAsync({ content, parent_id: rootId });
            setDraft('');
            onDone();
        } catch (err) {
            toast.error(__('No se pudo responder'), err instanceof Error ? err.message : '');
        }
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="imcrm-reply-composer">
            <div className="imcrm-relative">
                <Textarea
                    ref={ref}
                    autoFocus
                    rows={2}
                    value={draft}
                    placeholder={__('Escribe una respuesta… Usa @ para mencionar.')}
                    aria-label={__('Respuesta')}
                    onChange={(e) => {
                        setDraft(e.target.value);
                        setCursor(e.target.selectionStart ?? e.target.value.length);
                    }}
                    onKeyUp={(e) => setCursor(e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
                    onClick={(e) => setCursor(e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
                    onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                            e.preventDefault();
                            void submit();
                        }
                        if (e.key === 'Escape' && draft.trim() === '' && mention === null) {
                            e.stopPropagation();
                            onDone();
                        }
                    }}
                    className="imcrm-min-h-[56px] imcrm-text-sm"
                />
                <MentionAutocomplete
                    query={mention?.query ?? ''}
                    anchor={mention !== null ? { top: 'top', left: 8 } : null}
                    onSelect={(user) => {
                        if (mention === null) return;
                        const before = draft.slice(0, mention.start);
                        const inserted = `@${user.login} `;
                        const next = before + inserted + draft.slice(mention.end);
                        setDraft(next);
                        const pos = before.length + inserted.length;
                        setCursor(pos);
                        requestAnimationFrame(() => {
                            ref.current?.focus();
                            ref.current?.setSelectionRange(pos, pos);
                        });
                    }}
                    onClose={() => {
                        if (mention !== null) setCursor(mention.end);
                    }}
                />
            </div>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                    <CornerDownRight className="imcrm-h-3 imcrm-w-3" />
                    {forClient ? __('El cliente también verá tu respuesta.') : __('Respuesta interna: sólo la ve el equipo.')}
                </span>
                <span className="imcrm-flex-1" />
                <Button type="button" size="sm" variant="ghost" className="imcrm-h-7" onClick={onDone}>
                    {__('Cancelar')}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    className="imcrm-h-7 imcrm-gap-1.5"
                    disabled={draft.trim() === '' || create.isPending}
                    onClick={() => void submit()}
                    data-testid="imcrm-reply-send"
                >
                    {create.isPending && <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />}
                    {__('Responder')}
                </Button>
            </div>
        </div>
    );
}

/** El raíz borrado que conserva sus respuestas. */
export function DeletedCommentPlaceholder(): JSX.Element {
    return (
        <p className="imcrm-text-sm imcrm-italic imcrm-text-muted-foreground" data-testid="imcrm-comment-deleted">
            {__('Comentario eliminado')}
        </p>
    );
}

function Initials({ name, size }: { name: string; size: number }): JSX.Element {
    const text =
        name
            .replace(/#\d+/g, '')
            .replace(/@.*$/, '')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w.charAt(0).toUpperCase())
            .join('') || '·';
    return (
        <span
            aria-hidden
            className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-font-semibold imcrm-text-foreground/75 imcrm-ring-1 imcrm-ring-border"
            style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
        >
            {text}
        </span>
    );
}

function TimeStamp({ iso }: { iso: string }): JSX.Element {
    // Una respuesta puede llegar días después del raíz: fecha y hora completas.
    return (
        <time dateTime={iso} className="imcrm-text-[11px] imcrm-tabular-nums imcrm-text-muted-foreground">
            {formatDateTimeStr(iso)}
        </time>
    );
}
