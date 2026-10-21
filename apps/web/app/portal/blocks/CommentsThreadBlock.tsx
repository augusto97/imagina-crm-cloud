import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
 * interno). La primera página llega con `GET /portal/me`; mientras la pestaña
 * está a la vista se busca cada 30 s si el equipo respondió.
 *
 * Backend:
 *  - `GET  /portal/me/comments` — la conversación del registro del cliente.
 *  - `POST /portal/me/comments` — el cliente escribe (si el diseño lo permite).
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
        mutationFn: async (content: string): Promise<PortalCommentItem> => {
            const res = await fetch(`${baseUrl}/portal/me/comments`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...portalAccountHeaders() },
                body: JSON.stringify({ content }),
            });
            const body = (await res.json().catch(() => ({}))) as { data?: PortalCommentItem; message?: string };
            if (!res.ok || !body.data) throw new Error(body.message || 'No se pudo enviar el comentario.');
            return body.data;
        },
        onSuccess: (created) => {
            qc.setQueryData<PortalCommentItem[]>(key, (prev) => [...(prev ?? []), created]);
            setDraft('');
            setSendError(null);
        },
        onError: (err) => setSendError(err instanceof Error ? err.message : 'No se pudo enviar el comentario.'),
    });

    const items = isPreview ? MOCK_COMMENTS : thread.data ?? null;
    const loadError = !isPreview && thread.isError && !thread.data;

    const handleSubmit = (e: React.FormEvent): void => {
        e.preventDefault();
        const content = draft.trim();
        if (content === '' || isPreview) return;
        send.mutate(content);
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
            ) : items.length === 0 ? (
                <p className="imcrm-portal-block__empty">Aún no hay comentarios.</p>
            ) : (
                <ul className="imcrm-portal-comments">
                    {items.map((c) => (
                        <li
                            key={c.id}
                            className={`imcrm-portal-comments__item${c.mine ? ' imcrm-portal-comments__item--mine' : ''}`}
                            data-testid="portal-comment"
                        >
                            <span className="imcrm-portal-comments__author">{c.author_name}</span>
                            <p className="imcrm-portal-comments__content">{c.content}</p>
                            <span className="imcrm-portal-comments__meta">{formatDateTimeStr(c.created_at)}</span>
                        </li>
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

const MOCK_COMMENTS: PortalCommentItem[] = [
    { id: 1, mine: true, from_team: false, author_name: 'Tú', created_at: '2026-05-26 10:15:00', content: 'Hola, ¿podemos coordinar una reunión esta semana?' },
    { id: 2, mine: false, from_team: true, author_name: 'Laura', created_at: '2026-05-26 11:20:00', content: 'Claro, tengo disponible el jueves a las 15h. ¿Te sirve?' },
];
