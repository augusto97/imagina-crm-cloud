import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COMMENT_REACTION_EMOJIS } from '@imagina-base/shared';

import { buildThreads } from '@/admin/comments/commentThreads';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import { usePortalPreview } from '../PreviewContext';
import { portalAccountHeaders } from '../portalAccount';
import type { PortalBootData } from '../types';

/** Un comentario tal como lo ve el cliente (`PortalCommentDto`). */
export interface PortalCommentItem {
    id: number;
    content: string;
    created_at: string;
    /** Lo escribió quien mira. */
    mine: boolean;
    /** «Tú», el nombre de pila de quien respondió o la empresa. */
    author_name: string;
    from_team: boolean;
    /** v0.1.288 — respuesta a otro comentario (hilos de un nivel). */
    parent_id?: number | null;
    /** v0.1.288 — cuántas reacciones por emoji y si una es tuya (sin nombres). */
    reactions?: Array<{ emoji: string; count: number; mine: boolean }>;
    /** v0.1.288 — raíz borrado que conserva sus respuestas. */
    deleted?: boolean;
}

interface Props {
    config: {
        title?: string;
        /** Si true, el cliente sólo lee (no hay caja para escribir). */
        readonly?: boolean;
    };
    boot: PortalBootData;
}

/** Cada cuánto se busca si el equipo respondió (sólo con la pestaña a la vista). */
const POLL_MS = 30_000;

export const portalCommentsKey = (accountId: number | null | undefined) => ['portal-comments', accountId ?? null] as const;

/**
 * Bloque de conversación del portal. Sólo muestra lo que la empresa marcó
 * «visible para el cliente» y lo que escribió él (el servidor nunca manda lo
 * interno, tampoco las respuestas de un hilo interno). La primera página llega
 * con `GET /portal/me`; mientras la pestaña está a la vista se busca cada 30 s
 * si el equipo respondió.
 *
 * v0.1.288 — hilos de un nivel (las respuestas van plegadas dentro de su
 * comentario) y reacciones con emoji, donde el cliente puede comentar.
 *
 * Backend:
 *  - `GET  /portal/me/comments` — la conversación del registro del cliente.
 *  - `POST /portal/me/comments` — el cliente escribe o responde (`parent_id`).
 *  - `POST /portal/me/comments/:id/reactions` — pone o quita una reacción.
 */
export function CommentsThreadBlock({ config, boot }: Props): JSX.Element {
    const readonly = config.readonly ?? false;
    const isPreview = usePortalPreview();
    const qc = useQueryClient();
    const [draft, setDraft] = useState('');
    const [sendError, setSendError] = useState<string | null>(null);
    const baseUrl = boot.rest_root.replace(/\/$/, '');
    const key = portalCommentsKey(boot.account_id);

    const thread = useQuery({
        queryKey: key,
        queryFn: async (): Promise<PortalCommentItem[]> => {
            const res = await fetch(`${baseUrl}/portal/me/comments`, {
                credentials: 'same-origin',
                headers: { Accept: 'application/json', ...portalAccountHeaders() },
            });
            if (!res.ok) throw new Error(`http-${res.status}`);
            return ((await res.json()) as { data: PortalCommentItem[] }).data;
        },
        enabled: !isPreview,
        refetchInterval: POLL_MS,
        // react-query no busca en segundo plano: con la pestaña oculta, nada.
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        staleTime: 10_000,
    });

    const send = useMutation({
        mutationFn: async (input: { content: string; parent_id?: number }): Promise<PortalCommentItem> => {
            const res = await fetch(`${baseUrl}/portal/me/comments`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...portalAccountHeaders() },
                body: JSON.stringify(input),
            });
            const body = (await res.json().catch(() => ({}))) as { data?: PortalCommentItem; message?: string };
            if (!res.ok || !body.data) throw new Error(body.message || 'No se pudo enviar el comentario.');
            return body.data;
        },
        onSuccess: (created) => {
            qc.setQueryData<PortalCommentItem[]>(key, (prev) => [...(prev ?? []), created]);
            setSendError(null);
        },
        onError: (err) => setSendError(err instanceof Error ? err.message : 'No se pudo enviar el comentario.'),
    });

    // Reacciones: optimistas (el contador cambia al toque).
    const react = useMutation({
        mutationFn: async ({ id, emoji }: { id: number; emoji: string }) => {
            const res = await fetch(`${baseUrl}/portal/me/comments/${id}/reactions`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...portalAccountHeaders() },
                body: JSON.stringify({ emoji }),
            });
            const body = (await res.json().catch(() => ({}))) as {
                data?: { reactions: PortalCommentItem['reactions'] };
                message?: string;
            };
            if (!res.ok || !body.data) throw new Error(body.message || 'No se pudo reaccionar.');
            return body.data.reactions ?? [];
        },
        onMutate: ({ id, emoji }) => {
            const prev = qc.getQueryData<PortalCommentItem[]>(key);
            qc.setQueryData<PortalCommentItem[]>(key, (list) =>
                list?.map((c) => (c.id === id ? { ...c, reactions: togglePortalReaction(c.reactions, emoji) } : c)),
            );
            return { prev };
        },
        onError: (err, _vars, ctx) => {
            if (ctx?.prev) qc.setQueryData(key, ctx.prev);
            setSendError(err instanceof Error ? err.message : 'No se pudo reaccionar.');
        },
        onSuccess: (reactions, { id }) => {
            qc.setQueryData<PortalCommentItem[]>(key, (list) => list?.map((c) => (c.id === id ? { ...c, reactions } : c)));
        },
    });

    const items = isPreview ? MOCK_COMMENTS : thread.data ?? null;
    const threads = useMemo(() => buildThreads(items ?? []), [items]);
    const loadError = !isPreview && thread.isError && !thread.data;
    const interactive = !readonly && !isPreview;

    const handleSubmit = (e: React.FormEvent): void => {
        e.preventDefault();
        const content = draft.trim();
        if (content === '' || isPreview) return;
        send.mutate({ content }, { onSuccess: () => setDraft('') });
    };

    return (
        <section className="imcrm-portal-block imcrm-portal-block--comments">
            <h2 className="imcrm-portal-block__title">{config.title ?? 'Comentarios'}</h2>

            {(loadError || sendError !== null) && (
                <p className="imcrm-portal-block__error" role="alert">
                    {sendError ?? 'No se pudieron cargar los comentarios.'}
                </p>
            )}

            {items === null ? (
                !loadError && <p className="imcrm-portal-block__loading">Cargando…</p>
            ) : threads.length === 0 ? (
                <p className="imcrm-portal-block__empty">Aún no hay comentarios.</p>
            ) : (
                <ul className="imcrm-portal-comments">
                    {threads.map(({ root, replies }) => (
                        <PortalThread
                            key={root.id}
                            root={root}
                            replies={replies}
                            interactive={interactive}
                            sending={send.isPending}
                            onReact={(id, emoji) => react.mutate({ id, emoji })}
                            onReply={(content) => send.mutateAsync({ content, parent_id: root.id })}
                        />
                    ))}
                </ul>
            )}

            {!readonly && (
                <form onSubmit={handleSubmit} className="imcrm-portal-comments__composer">
                    <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="Escribe tu comentario…"
                        rows={3}
                        maxLength={5000}
                        disabled={send.isPending}
                        className="imcrm-portal-comments__textarea"
                    />
                    <button
                        type="submit"
                        disabled={send.isPending || draft.trim() === ''}
                        className="imcrm-portal-comments__submit"
                    >
                        {send.isPending ? 'Enviando…' : 'Enviar'}
                    </button>
                </form>
            )}
        </section>
    );
}

/** Un comentario raíz con sus reacciones y su hilo de respuestas (plegado). */
function PortalThread({
    root,
    replies,
    interactive,
    sending,
    onReact,
    onReply,
}: {
    root: PortalCommentItem;
    replies: PortalCommentItem[];
    interactive: boolean;
    sending: boolean;
    onReact: (id: number, emoji: string) => void;
    onReply: (content: string) => Promise<unknown>;
}): JSX.Element {
    const [open, setOpen] = useState(false);
    const [replying, setReplying] = useState(false);
    const [draft, setDraft] = useState('');
    const count = replies.length;

    const submit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        const content = draft.trim();
        if (content === '') return;
        try {
            await onReply(content);
            setDraft('');
            setReplying(false);
            setOpen(true);
        } catch {
            // El error lo muestra el bloque.
        }
    };

    return (
        <li
            className={`imcrm-portal-comments__item${root.mine ? ' imcrm-portal-comments__item--mine' : ''}`}
            data-testid="portal-comment"
        >
            {!root.deleted && <span className="imcrm-portal-comments__author">{root.author_name}</span>}
            {root.deleted ? (
                <p className="imcrm-portal-comments__content imcrm-portal-comments__content--deleted">Comentario eliminado</p>
            ) : (
                <p className="imcrm-portal-comments__content">{root.content}</p>
            )}
            <span className="imcrm-portal-comments__meta">{formatDateTimeStr(root.created_at)}</span>
            <div className="imcrm-portal-comments__actions">
                {!root.deleted && (
                    <PortalReactions reactions={root.reactions} interactive={interactive} onToggle={(e) => onReact(root.id, e)} />
                )}
                {interactive && (
                    <button
                        type="button"
                        className="imcrm-portal-comments__link"
                        onClick={() => {
                            setReplying(true);
                            setOpen(true);
                        }}
                        data-testid="portal-comment-reply"
                    >
                        Responder
                    </button>
                )}
                {count > 0 && (
                    <button
                        type="button"
                        className="imcrm-portal-comments__link"
                        aria-expanded={open}
                        onClick={() => setOpen((v) => !v)}
                        data-testid="portal-comment-replies"
                    >
                        {open ? 'Ocultar respuestas' : count === 1 ? '1 respuesta' : `${count} respuestas`}
                    </button>
                )}
            </div>
            {(open || replying) && (
                <ul className="imcrm-portal-comments__replies">
                    {open &&
                        replies.map((r) => (
                            <li key={r.id} className="imcrm-portal-comments__reply" data-testid="portal-comment-reply-item">
                                <span className="imcrm-portal-comments__author">{r.author_name}</span>
                                <p className="imcrm-portal-comments__content">{r.content}</p>
                                <span className="imcrm-portal-comments__meta">{formatDateTimeStr(r.created_at)}</span>
                                <div className="imcrm-portal-comments__actions">
                                    <PortalReactions reactions={r.reactions} interactive={interactive} onToggle={(e) => onReact(r.id, e)} />
                                </div>
                            </li>
                        ))}
                    {replying && (
                        <li>
                            <form onSubmit={(e) => void submit(e)} className="imcrm-portal-comments__composer">
                                <textarea
                                    autoFocus
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    placeholder="Escribe tu respuesta…"
                                    rows={2}
                                    maxLength={5000}
                                    disabled={sending}
                                    aria-label="Respuesta"
                                    className="imcrm-portal-comments__textarea imcrm-portal-comments__textarea--reply"
                                />
                                <div className="imcrm-portal-comments__reply-actions">
                                    <button type="button" className="imcrm-portal-comments__link" onClick={() => setReplying(false)}>
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        className="imcrm-portal-comments__submit"
                                        disabled={sending || draft.trim() === ''}
                                        data-testid="portal-reply-send"
                                    >
                                        Responder
                                    </button>
                                </div>
                            </form>
                        </li>
                    )}
                </ul>
            )}
        </li>
    );
}

/** Reacciones en el portal: contador por emoji y si es tuya (sin nombres). */
function PortalReactions({
    reactions,
    interactive,
    onToggle,
}: {
    reactions: PortalCommentItem['reactions'];
    interactive: boolean;
    onToggle: (emoji: string) => void;
}): JSX.Element | null {
    const [picking, setPicking] = useState(false);
    const list = reactions ?? [];
    if (list.length === 0 && !interactive) return null;
    return (
        <span className="imcrm-portal-reactions" data-testid="portal-reactions">
            {list.map((r) => (
                <button
                    key={r.emoji}
                    type="button"
                    disabled={!interactive}
                    aria-pressed={r.mine}
                    aria-label={`${r.emoji} ${r.count}`}
                    onClick={() => onToggle(r.emoji)}
                    className={`imcrm-portal-reactions__pill${r.mine ? ' imcrm-portal-reactions__pill--mine' : ''}`}
                >
                    <span aria-hidden>{r.emoji}</span> {r.count}
                </button>
            ))}
            {interactive && (
                <>
                    <button
                        type="button"
                        aria-expanded={picking}
                        aria-label="Reaccionar"
                        title="Reaccionar"
                        onClick={() => setPicking((v) => !v)}
                        className="imcrm-portal-reactions__add"
                        data-testid="portal-reaction-add"
                    >
                        <span aria-hidden>☺</span>+
                    </button>
                    {picking && (
                        <span className="imcrm-portal-reactions__picker" role="group" aria-label="Elige una reacción">
                            {COMMENT_REACTION_EMOJIS.map((e) => (
                                <button
                                    key={e}
                                    type="button"
                                    aria-label={e}
                                    data-emoji={e}
                                    onClick={() => {
                                        onToggle(e);
                                        setPicking(false);
                                    }}
                                >
                                    {e}
                                </button>
                            ))}
                        </span>
                    )}
                </>
            )}
        </span>
    );
}

/** Lo mismo que hace el servidor con la reacción de quien mira. */
function togglePortalReaction(
    reactions: PortalCommentItem['reactions'],
    emoji: string,
): NonNullable<PortalCommentItem['reactions']> {
    const list = (reactions ?? []).map((r) => ({ ...r }));
    const cur = list.find((r) => r.emoji === emoji);
    if (cur && cur.mine) {
        cur.mine = false;
        cur.count = Math.max(0, cur.count - 1);
    } else if (cur) {
        cur.mine = true;
        cur.count += 1;
    } else {
        list.push({ emoji, count: 1, mine: true });
    }
    const order = COMMENT_REACTION_EMOJIS as readonly string[];
    return list.filter((r) => r.count > 0).sort((a, b) => order.indexOf(a.emoji) - order.indexOf(b.emoji));
}

const MOCK_COMMENTS: PortalCommentItem[] = [
    { id: 1, mine: true, from_team: false, author_name: 'Tú', created_at: '2026-05-26 10:15:00', content: 'Hola, ¿podemos coordinar una reunión esta semana?' },
    {
        id: 2,
        mine: false,
        from_team: true,
        author_name: 'Laura',
        created_at: '2026-05-26 11:20:00',
        content: 'Claro, tengo disponible el jueves a las 15h. ¿Te sirve?',
        parent_id: 1,
        reactions: [{ emoji: '👍', count: 1, mine: true }],
    },
];
