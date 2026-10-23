import { useEffect, useState } from 'react';

import { changeSentence, changesOf } from '@/admin/activity/activityText';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import type { ActivityEntity } from '@/types/activity';
import type { FieldEntity } from '@/types/field';
import { usePortalPreview } from '../PreviewContext';
import { portalAccountHeaders } from '../portalAccount';
import type { PortalBootData } from '../types';

interface ActivityItem {
    id: number;
    action: string;
    created_at: string;
    /** Sólo viene cuando lo hizo el propio cliente (del equipo nunca se expone). */
    user_id: number | null;
    /** Diff por campo `{ fN: { from, to } }`, ya acotado a lo que el cliente ve. */
    diff?: Record<string, unknown> | null;
}

interface Props {
    config: {
        title?: string;
        limit?: number;
    };
    boot: PortalBootData;
}

/**
 * Bloque `activity_timeline`: lo que pasó con el registro del cliente, en
 * lenguaje humano y con el MISMO formateo que la ficha del equipo («Laura
 * cambió Estado de Pendiente a Pagado»; antes se veían códigos internos como
 * `record_updated`). El servidor ya manda sólo los campos que el cliente ve;
 * lo que hizo el equipo se firma con el nombre de la empresa.
 *
 * Backend: `GET /portal/me/activity` (el registro sale de la sesión: el
 * cliente no puede pedir el de otro).
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
            headers: { Accept: 'application/json', ...portalAccountHeaders() },
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
    }, [boot.rest_root, boot.account_id, limit, isPreview]);

    const fields = (boot.fields ?? []) as unknown as FieldEntity[];
    const company = boot.company_name?.trim() || 'El equipo';

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
                    {items.map((item) => {
                        const text = portalActivityText(item, fields, { mine: item.user_id !== null && item.user_id === boot.user_id, company });
                        return (
                            <li key={item.id} className="imcrm-portal-activity__item">
                                <span aria-hidden className="imcrm-portal-activity__dot" />
                                <div className="imcrm-portal-activity__body">
                                    <p className="imcrm-portal-activity__action">{text.title}</p>
                                    {text.lines.length > 0 && (
                                        <ul className="imcrm-portal-activity__changes">
                                            {text.lines.map((l, i) => (
                                                <li key={i}>{l}</li>
                                            ))}
                                        </ul>
                                    )}
                                    <p className="imcrm-portal-activity__meta">{formatDateTimeStr(item.created_at)}</p>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

/** Verbos del cliente en segunda persona («cambiaste»); los del equipo, como la ficha. */
const YOU: Record<string, string> = { estableció: 'estableciste', cambió: 'cambiaste', vació: 'vaciaste' };

/**
 * La entrada en lenguaje humano para el cliente. Reusa la traducción del log
 * de la ficha (`activityText`: etiquetas de las opciones, fechas y montos con
 * el formato de la empresa); el sujeto es «Tú» o la empresa, nunca un
 * miembro del equipo ni un código interno.
 */
export function portalActivityText(
    item: ActivityItem,
    fields: FieldEntity[],
    who: { mine: boolean; company: string },
): { title: string; lines: string[] } {
    const entry = { ...item, list_id: 0, record_id: null, user_name: null, changes: (item.diff ?? {}) as Record<string, unknown> } as ActivityEntity;
    const action = item.action;
    if (action === 'record_created' || action === 'record.created') {
        return { title: who.mine ? 'Creaste este registro' : `${who.company} creó este registro`, lines: [] };
    }
    if (action === 'record_deleted' || action === 'record.deleted') {
        return { title: `${who.company} eliminó este registro`, lines: [] };
    }
    if (action === 'record_restored') {
        return { title: `${who.company} restauró este registro`, lines: [] };
    }
    const changes = changesOf(entry, fields);
    if (changes.length === 0) {
        return { title: who.mine ? 'Actualizaste tus datos' : `${who.company} actualizó este registro`, lines: [] };
    }
    const sentence = (c: (typeof changes)[number]): string => {
        const s = changeSentence(c);
        const verb = who.mine ? (YOU[s.verb] ?? s.verb) : s.verb;
        if (s.from !== null && s.to !== null) return `${verb} ${c.label} de ${s.from} a ${s.to}`;
        if (s.to !== null) return `${verb} ${c.label} en ${s.to}`;
        return `${verb} ${c.label}`;
    };
    const subject = who.mine ? '' : `${who.company} `;
    if (changes.length === 1) {
        const line = sentence(changes[0]!);
        return { title: who.mine ? capitalize(line) : `${subject}${line}`, lines: [] };
    }
    return {
        title: who.mine ? `Cambiaste ${changes.length} datos` : `${subject}cambió ${changes.length} datos`,
        lines: changes.map((c) => capitalize(sentence(c))),
    };
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

const MOCK_ACTIVITY: ActivityItem[] = [
    { id: 1, action: 'record_updated', created_at: '2026-05-26T14:30:00Z', user_id: null, diff: {} },
    { id: 3, action: 'record_created', created_at: '2026-05-20T09:00:00Z', user_id: null, diff: {} },
];
