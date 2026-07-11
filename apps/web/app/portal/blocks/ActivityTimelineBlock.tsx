import { useEffect, useState } from 'react';

import { usePortalPreview } from '../PreviewContext';
import type { PortalBootData } from '../types';

interface ActivityItem {
    id: number;
    action: string;
    created_at: string;
    user_id: number | null;
    /** Cambios concretos cuando aplica. Shape libre por type de evento. */
    changes?: Record<string, unknown> | null;
}

interface Props {
    config: {
        title?: string;
        limit?: number;
    };
    boot: PortalBootData;
}

/**
 * Bloque `activity_timeline` (Fase 9 — pulidos). Timeline de eventos
 * del record del cliente.
 *
 * Backend: `GET /portal/me/activity` resuelve list_id + record_id
 * desde el ClientResolver — sin que el cliente pueda spoofear IDs.
 *
 * Formato visual: timeline simple con dot + meta line. Sin avatares
 * (la activity puede ser del sistema sin user_id concreto). Sin
 * iconos por type de action (cubrir 20+ types implicaría mucho
 * mapeo; texto crudo de `action` es suficiente para 3.G).
 */
export function ActivityTimelineBlock({ config, boot }: Props): JSX.Element {
    const limit = config.limit ?? 20;
    const isPreview = usePortalPreview();
    const [items, setItems] = useState<ActivityItem[] | null>(isPreview ? MOCK_ACTIVITY : null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isPreview) return;
        const ac = new AbortController();
        const url = `${boot.rest_root.replace(/\/$/, '')}/portal/me/activity?limit=${limit}`;
        fetch(url, {
            signal: ac.signal,
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        })
            .then(async (res) => {
                if (!res.ok) throw new Error(`http-${res.status}`);
                const body = (await res.json()) as { data: ActivityItem[] };
                setItems(body.data);
            })
            .catch((err: unknown) => {
                if (err instanceof DOMException && err.name === 'AbortError') return;
                setError('No se pudo cargar la actividad.');
            });
        return () => ac.abort();
    }, [boot, limit, isPreview]);

    return (
        <section className="imcrm-portal-block imcrm-portal-block--activity">
            <h2 className="imcrm-portal-block__title">{config.title ?? 'Actividad reciente'}</h2>
            {error !== null ? (
                <p className="imcrm-portal-block__error" role="alert">
                    {error}
                </p>
            ) : items === null ? (
                <p className="imcrm-portal-block__loading">Cargando…</p>
            ) : items.length === 0 ? (
                <p className="imcrm-portal-block__empty">Sin actividad reciente.</p>
            ) : (
                <ul className="imcrm-portal-activity">
                    {items.map((item) => (
                        <li key={item.id} className="imcrm-portal-activity__item">
                            <span aria-hidden className="imcrm-portal-activity__dot" />
                            <div className="imcrm-portal-activity__body">
                                <p className="imcrm-portal-activity__action">
                                    {readableAction(item.action)}
                                </p>
                                <p className="imcrm-portal-activity__meta">
                                    {formatDate(item.created_at)}
                                </p>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

/**
 * Mapea los `action` slugs internos a frases legibles. Lista mínima
 * — los slugs no mapeados caen al fallback `String(action)`.
 */
function readableAction(action: string): string {
    const map: Record<string, string> = {
        'record.created':         'Registro creado',
        'record.updated':         'Registro actualizado',
        'record.deleted':         'Registro eliminado',
        'comment.created':        'Comentario agregado',
        'comment.updated':        'Comentario actualizado',
        'comment.deleted':        'Comentario eliminado',
        'mention.received':       'Mención recibida',
        'automation.run':         'Automatización ejecutada',
    };
    return map[action] ?? action;
}

function formatDate(iso: string): string {
    try {
        const d = new Date(iso + 'Z');
        return d.toLocaleString();
    } catch {
        return iso;
    }
}

const MOCK_ACTIVITY: ActivityItem[] = [
    { id: 1, action: 'record.updated',  created_at: '2026-05-26T14:30:00', user_id: 1 },
    { id: 2, action: 'comment.created', created_at: '2026-05-25T11:15:00', user_id: 2 },
    { id: 3, action: 'record.created',  created_at: '2026-05-20T09:00:00', user_id: 1 },
];
