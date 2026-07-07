import { useEffect, useState } from 'react';

import { usePortalPreview } from '../PreviewContext';
import type { PortalBootData } from '../types';

interface CommentItem {
    id: number;
    content: string;
    created_at: string;
    user_id: number;
}

interface Props {
    config: {
        title?: string;
        /** Si true, el cliente puede crear comentarios. Default true. */
        readonly?: boolean;
    };
    boot: PortalBootData;
}

/**
 * Bloque `comments_thread` (Fase 12.D). Hilo de comentarios del
 * record del cliente.
 *
 * Backend:
 *  - `GET  /portal/me/comments` — lista los comments del record del
 *    cliente. list_id + record_id se resuelven desde el ClientResolver
 *    (sin spoofing).
 *  - `POST /portal/me/comments` — el cliente crea un comment.
 *    user_id viene de la session.
 *
 * Estado vacío + loading + error nativos. Sin menciones / edit /
 * delete — el portal mantiene UX simple. El admin maneja la
 * moderación desde el `CommentsPanel` del CRM.
 */
export function CommentsThreadBlock({ config, boot }: Props): JSX.Element {
    const readonly = config.readonly ?? false;
    const isPreview = usePortalPreview();
    const [items, setItems] = useState<CommentItem[] | null>(isPreview ? MOCK_COMMENTS : null);
    const [error, setError] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const baseUrl = boot.rest_root.replace(/\/$/, '');

    useEffect(() => {
        if (isPreview) return;
        const ac = new AbortController();
        fetch(`${baseUrl}/portal/me/comments`, {
            signal: ac.signal,
            credentials: 'same-origin',
            headers: { Accept: 'application/json', 'X-WP-Nonce': boot.rest_nonce },
        })
            .then(async (res) => {
                if (!res.ok) throw new Error(`http-${res.status}`);
                const body = (await res.json()) as { data: CommentItem[] };
                setItems(body.data);
            })
            .catch((err: unknown) => {
                if (err instanceof DOMException && err.name === 'AbortError') return;
                setError('No se pudieron cargar los comentarios.');
            });
        return () => ac.abort();
    }, [baseUrl, boot.rest_nonce, isPreview]);

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        const content = draft.trim();
        if (content === '') return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch(`${baseUrl}/portal/me/comments`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-WP-Nonce': boot.rest_nonce,
                },
                body: JSON.stringify({ content }),
            });
            if (!res.ok) throw new Error(`http-${res.status}`);
            const body = (await res.json()) as { data: CommentItem };
            setItems((prev) => (prev !== null ? [...prev, body.data] : [body.data]));
            setDraft('');
        } catch {
            setError('No se pudo enviar el comentario.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <section className="imcrm-portal-block imcrm-portal-block--comments">
            <h2 className="imcrm-portal-block__title">{config.title ?? 'Comentarios'}</h2>

            {error !== null && (
                <p className="imcrm-portal-block__error" role="alert">
                    {error}
                </p>
            )}

            {items === null ? (
                <p className="imcrm-portal-block__loading">Cargando…</p>
            ) : items.length === 0 ? (
                <p className="imcrm-portal-block__empty">Aún no hay comentarios.</p>
            ) : (
                <ul className="imcrm-portal-comments">
                    {items.map((c) => (
                        <li key={c.id} className="imcrm-portal-comments__item">
                            <p className="imcrm-portal-comments__content">{c.content}</p>
                            <span className="imcrm-portal-comments__meta">
                                {formatRelativeDate(c.created_at)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            {! readonly && (
                <form onSubmit={handleSubmit} className="imcrm-portal-comments__composer">
                    <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="Escribí tu comentario…"
                        rows={3}
                        maxLength={5000}
                        disabled={submitting}
                        className="imcrm-portal-comments__textarea"
                    />
                    <button
                        type="submit"
                        disabled={submitting || draft.trim() === ''}
                        className="imcrm-portal-comments__submit"
                    >
                        {submitting ? 'Enviando…' : 'Enviar'}
                    </button>
                </form>
            )}
        </section>
    );
}

function formatRelativeDate(iso: string): string {
    const date = new Date(iso.replace(' ', 'T') + 'Z');
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString();
}

const MOCK_COMMENTS: CommentItem[] = [
    { id: 1, user_id: 2, created_at: '2026-05-26 10:15:00', content: 'Hola, ¿podemos coordinar una reunión esta semana?' },
    { id: 2, user_id: 1, created_at: '2026-05-26 11:20:00', content: 'Claro, tengo disponible el jueves a las 15h. ¿Te sirve?' },
];
