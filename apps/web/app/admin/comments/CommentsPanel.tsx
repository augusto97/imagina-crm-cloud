import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageSquare, Pencil, Send, Trash2 } from 'lucide-react';

import { CommentContent } from '@/admin/comments/CommentContent';
import { CommentThreadFooter, DeletedCommentPlaceholder } from '@/admin/comments/CommentThread';
import { buildThreads } from '@/admin/comments/commentThreads';
import { ClientVisibilityToggle, ClientVisibleBadge, useListPortalEnabled } from '@/admin/comments/clientVisibility';
import { MentionAutocomplete } from '@/admin/comments/MentionAutocomplete';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Textarea } from '@/components/ui/textarea';
import {
    useCommentAuthors,
    useComments,
    useCreateComment,
    useDeleteComment,
    useUpdateComment,
} from '@/hooks/useComments';
import { ApiError } from '@/lib/api';
import { useGuestCanComment } from '@/hooks/useGuests';
import { useIsGuest } from '@/lib/guest';
import { __ } from '@/lib/i18n';
import type { CommentEntity } from '@/types/comment';
import { parseUtcDate } from '@/lib/utcDate';

import { formatDateTime } from '@/lib/tenantFormat';
/**
 * Hilo de comentarios para un registro específico.
 *
 * Render:
 * - Lista cronológica con burbujas (tipo Slack/Linear).
 * - El autor puede editar inline o eliminar; otros usuarios sólo ven.
 *   El back-end es la autoridad final — el front no asume permisos
 *   más allá de mostrar/ocultar botones.
 * - Composer abajo con Cmd/Ctrl+Enter para enviar.
 *
 * El nombre del autor viaja en el DTO (`user_name`); lo que falte se
 * resuelve en lote (`useCommentAuthors`).
 */
interface CommentsPanelProps {
    listId: number;
    recordId: number;
    currentUserId: number;
    isAdmin: boolean;
}

export function CommentsPanel({
    listId,
    recordId,
    currentUserId,
    isAdmin,
}: CommentsPanelProps): JSX.Element {
    const comments = useComments(listId, recordId);
    const create = useCreateComment(listId, recordId);
    const update = useUpdateComment(listId, recordId);
    const remove = useDeleteComment(listId, recordId);
    const authorOf = useCommentAuthors(comments.data);
    // v0.1.291 — hilos de un nivel: las respuestas van dentro de su raíz.
    const threads = useMemo(() => buildThreads(comments.data), [comments.data]);
    const canEditComment = (c: CommentEntity): boolean => isAdmin || c.user_id === currentUserId;

    const [draft, setDraft] = useState('');
    // Todo comentario nace INTERNO (sólo el equipo); el cliente ve lo que se marca.
    const isGuest = useIsGuest();
    // C3 — un invitado no publica para el cliente del portal.
    const portalEnabled = useListPortalEnabled(listId) && !isGuest;
    const canPost = useGuestCanComment(listId, recordId);
    const [forClient, setForClient] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [cursor, setCursor] = useState(0);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    /**
     * Detecta si el cursor está dentro de un token `@<word>` activo.
     * Si sí, devuelve la query (sin el `@`) y los offsets del token
     * para reemplazar al seleccionar.
     */
    const mentionToken = useMemo<{ query: string; start: number; end: number } | null>(() => {
        const before = draft.slice(0, cursor);
        // Buscamos el último @ precedido por inicio de línea o
        // whitespace, sin whitespace dentro del token.
        const m = /(?:^|\s)@([A-Za-z0-9._-]{0,60})$/.exec(before);
        if (!m) return null;
        const query = m[1] ?? '';
        const start = cursor - query.length - 1; // -1 por el '@'
        return { query, start, end: cursor };
    }, [draft, cursor]);

    // Scroll al final al recibir nuevos comentarios — UX típica de chat.
    // v0.1.286 — se mueve SÓLO el contenedor del hilo (su scrollTop). Antes
    // era `scrollIntoView`, que también scrollea a los ancestros: la página
    // del registro abría corrida hacia abajo (162-197 px en escritorio,
    // ~1100 en el celular) apenas cargaban los comentarios. Al cargar, salta
    // sin animación; con un comentario nuevo, suave. Si el panel no es su
    // propio scroller (crece con la página), asignar scrollTop no hace nada.
    const prevCountRef = useRef<number | null>(null);
    useEffect(() => {
        const count = comments.data?.length;
        if (count === undefined) return;
        const prev = prevCountRef.current;
        prevCountRef.current = count;
        const el = scrollRef.current;
        if (!el || el.scrollHeight <= el.clientHeight) return;
        if (prev === null) el.scrollTop = el.scrollHeight;
        else if (count > prev) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, [comments.data?.length]);

    const handleSubmit = async (e?: React.FormEvent): Promise<void> => {
        e?.preventDefault();
        setSubmitError(null);
        const content = draft.trim();
        if (content === '') return;
        try {
            await create.mutateAsync({ content, visibility: portalEnabled && forClient ? 'client' : 'internal' });
            setDraft('');
            setForClient(false);
        } catch (err) {
            if (err instanceof ApiError || err instanceof Error) {
                setSubmitError(err.message);
            }
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent): void => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void handleSubmit();
        }
    };

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-3">
            <div ref={scrollRef} className="imcrm-flex-1 imcrm-overflow-y-auto imcrm-pr-1">
                {comments.isLoading ? (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                        {__('Cargando comentarios…')}
                    </div>
                ) : comments.isError ? (
                    <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                        {(comments.error as Error).message}
                    </div>
                ) : !comments.data || comments.data.length === 0 ? (
                    <EmptyState />
                ) : (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                        {threads.map(({ root: c, replies }) => (
                            <CommentItem
                                key={c.id}
                                comment={c}
                                authorName={authorOf(c)}
                                canEdit={canEditComment(c)}
                                canDelete={canEditComment(c)}
                                hasReplies={replies.length > 0}
                                onUpdate={(content) =>
                                    update.mutateAsync({ id: c.id, content })
                                }
                                onDelete={() => remove.mutateAsync(c.id)}
                                footer={
                                    <CommentThreadFooter
                                        listId={listId}
                                        recordId={recordId}
                                        root={c}
                                        replies={replies}
                                        authorOf={authorOf}
                                        canEdit={canEditComment}
                                    />
                                }
                            />
                        ))}
                    </ul>
                )}
            </div>

            {!canPost ? (
                <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-comment-readonly">
                    {__('Puedes ver este registro, pero no comentar en él.')}
                </p>
            ) : (
            <form
                onSubmit={handleSubmit}
                className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3"
            >
                <div className="imcrm-relative">
                    <Textarea
                        ref={textareaRef}
                        placeholder={__('Escribe un comentario… Usa @ para mencionar.')}
                        rows={3}
                        value={draft}
                        onChange={(e) => {
                            setDraft(e.target.value);
                            setCursor(e.target.selectionStart ?? e.target.value.length);
                        }}
                        onKeyUp={(e) => {
                            const t = e.currentTarget;
                            setCursor(t.selectionStart ?? t.value.length);
                        }}
                        onClick={(e) => {
                            const t = e.currentTarget;
                            setCursor(t.selectionStart ?? t.value.length);
                        }}
                        onKeyDown={handleKeyDown}
                        disabled={create.isPending}
                    />

                    <MentionAutocomplete
                        query={mentionToken?.query ?? ''}
                        anchor={
                            mentionToken !== null
                                ? { top: 'bottom', left: 8 }
                                : null
                        }
                    onSelect={(user) => {
                        if (mentionToken === null) return;
                        // Reemplaza `@<query>` por `@<login> ` y reposiciona cursor.
                        const before = draft.slice(0, mentionToken.start);
                        const after = draft.slice(mentionToken.end);
                        const inserted = `@${user.login} `;
                        const next = before + inserted + after;
                        setDraft(next);
                        const newCursor = before.length + inserted.length;
                        setCursor(newCursor);
                        // Re-foco + posicionar cursor real del DOM.
                        requestAnimationFrame(() => {
                            const ta = textareaRef.current;
                            if (ta) {
                                ta.focus();
                                ta.setSelectionRange(newCursor, newCursor);
                            }
                        });
                    }}
                        onClose={() => {
                            // Cerrar = mover el cursor un espacio para escapar
                            // del token; el menú simplemente desaparece sin
                            // mutar texto.
                            if (mentionToken !== null) {
                                setCursor(mentionToken.end);
                            }
                        }}
                    />
                </div>
                {submitError && (
                    <p className="imcrm-text-xs imcrm-text-destructive">{submitError}</p>
                )}
                <div className="imcrm-flex imcrm-items-center imcrm-justify-end imcrm-gap-2">
                    {portalEnabled && <ClientVisibilityToggle checked={forClient} onChange={setForClient} disabled={create.isPending} />}
                    <Button
                        type="submit"
                        size="sm"
                        disabled={draft.trim() === '' || create.isPending}
                        className="imcrm-gap-1.5"
                    >
                        <Send className="imcrm-h-3.5 imcrm-w-3.5" />
                        {create.isPending ? __('Enviando…') : __('Enviar')}
                    </Button>
                </div>
            </form>
            )}
        </div>
    );
}

interface CommentItemProps {
    comment: CommentEntity;
    authorName: string;
    canEdit: boolean;
    canDelete: boolean;
    hasReplies: boolean;
    onUpdate: (content: string) => Promise<unknown>;
    onDelete: () => Promise<unknown>;
    footer: React.ReactNode;
}

function CommentItem({
    comment,
    authorName,
    canEdit: canEditRaw,
    canDelete: canDeleteRaw,
    hasReplies,
    onUpdate,
    onDelete,
    footer,
}: CommentItemProps): JSX.Element {
    // Un raíz eliminado (con respuestas vivas) ya no se edita ni se borra.
    const canEdit = canEditRaw && !comment.deleted;
    const canDelete = canDeleteRaw && !comment.deleted;
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(comment.content);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const confirm = useConfirm();

    const handleSave = async (): Promise<void> => {
        const content = draft.trim();
        if (content === '' || content === comment.content) {
            setEditing(false);
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await onUpdate(content);
            setEditing(false);
        } catch (err) {
            if (err instanceof Error) setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (): Promise<void> => {
        const ok = await confirm({
            title: __('Eliminar comentario'),
            description: hasReplies
                ? __('Sus respuestas se conservan: en su lugar quedará «Comentario eliminado».')
                : __('Esta acción no se puede deshacer.'),
            destructive: true,
            confirmLabel: __('Eliminar'),
        });
        if (!ok) return;
        try {
            await onDelete();
        } catch (err) {
            if (err instanceof Error) setError(err.message);
        }
    };

    const wasEdited = comment.created_at !== comment.updated_at;

    return (
        <li className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3">
            <header className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                    <span
                        aria-hidden
                        className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-[10px] imcrm-text-primary imcrm-font-semibold"
                    >
                        {initialsOf(authorName)}
                    </span>
                    <span className="imcrm-font-medium">{authorName}</span>
                    <ClientVisibleBadge comment={comment} />
                    <span className="imcrm-text-muted-foreground">
                        {formatDateTime(parseUtcDate(comment.created_at))}
                    </span>
                    {wasEdited && (
                        <span className="imcrm-text-muted-foreground">{__('(editado)')}</span>
                    )}
                </div>
                {!editing && (canEdit || canDelete) && (
                    <div className="imcrm-flex imcrm-gap-1">
                        {canEdit && (
                            <button
                                type="button"
                                onClick={() => setEditing(true)}
                                className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                aria-label={__('Editar')}
                            >
                                <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                            </button>
                        )}
                        {canDelete && (
                            <button
                                type="button"
                                onClick={handleDelete}
                                className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                                aria-label={__('Eliminar')}
                            >
                                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            </button>
                        )}
                    </div>
                )}
            </header>

            {editing ? (
                <div className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <Textarea
                        rows={3}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        autoFocus
                    />
                    {error && <p className="imcrm-text-xs imcrm-text-destructive">{error}</p>}
                    <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                                setDraft(comment.content);
                                setEditing(false);
                                setError(null);
                            }}
                        >
                            {__('Cancelar')}
                        </Button>
                        <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
                            {saving ? __('Guardando…') : __('Guardar')}
                        </Button>
                    </div>
                </div>
            ) : comment.deleted ? (
                <DeletedCommentPlaceholder />
            ) : (
                <CommentContent content={comment.content} />
            )}
            {!editing && <div className="imcrm-mt-2">{footer}</div>}
        </li>
    );
}

function EmptyState(): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-py-8 imcrm-text-center imcrm-text-muted-foreground">
            <MessageSquare className="imcrm-h-6 imcrm-w-6" />
            <p className="imcrm-text-sm">{__('Aún no hay comentarios.')}</p>
            <p className="imcrm-text-xs">{__('Empieza la conversación con el primero.')}</p>
        </div>
    );
}

/** Iniciales para el avatar ("Ana Gómez" → "AG"; "ana@acme.co" → "A"). */
function initialsOf(name: string): string {
    const clean = name.replace(/#\d+/g, '').replace(/@.*$/, '').trim();
    const parts = clean.split(/\s+/).filter(Boolean).slice(0, 2);
    return parts.map((w) => w.charAt(0).toUpperCase()).join('') || '·';
}
