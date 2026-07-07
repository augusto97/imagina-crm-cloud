import { useEffect, useState } from 'react';

import { fetchRelatedRecords } from '../api';
import { usePortalPreview } from '../PreviewContext';
import type { PortalBootData, PortalRecord } from '../types';

interface Props {
    config: {
        list_slug?: string;
        visible_field_slugs?: string[];
        title?: string;
        per_page?: number;
        variant?: 'table' | 'compact_list';
    };
    boot: PortalBootData;
}

/**
 * Bloque `related_records_table` (Fase 9 — 3.D). Renderiza records
 * de una lista relacionada al cliente. El backend (PortalController +
 * PortalScopeService) garantiza que SOLO devuelve records del cliente
 * actual — confiamos en eso.
 *
 * Fetch on-mount, sin paginación interactiva todavía (llega cuando
 * el bloque tenga UI más rica en 3.E). Para 3.D: primera página y
 * footer con conteo.
 */
export function RelatedRecordsTableBlock({ config, boot }: Props): JSX.Element {
    const listSlug = config.list_slug ?? '';
    const perPage = config.per_page ?? 10;
    const columns = config.visible_field_slugs ?? [];
    const variant = config.variant ?? 'table';

    const isPreview = usePortalPreview();
    const [records, setRecords] = useState<PortalRecord[] | null>(
        isPreview ? buildMockRecords(columns) : null,
    );
    const [total, setTotal] = useState(isPreview ? 3 : 0);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isPreview) return;
        if (listSlug === '') {
            setError('Bloque no configurado: falta list_slug.');
            return;
        }
        const ac = new AbortController();
        fetchRelatedRecords(boot, listSlug, { page: 1, per_page: perPage }, ac.signal)
            .then((res) => {
                setRecords(res.data);
                setTotal(res.meta.total);
            })
            .catch((err: unknown) => {
                if (err instanceof DOMException && err.name === 'AbortError') return;
                setError('No se pudieron cargar los registros.');
            });
        return () => ac.abort();
    }, [boot, listSlug, perPage, isPreview]);

    return (
        <section className="imcrm-portal-block imcrm-portal-block--related">
            <h2 className="imcrm-portal-block__title">{config.title ?? listSlug}</h2>

            {error !== null ? (
                <p className="imcrm-portal-block__error" role="alert">
                    {error}
                </p>
            ) : records === null ? (
                <p className="imcrm-portal-block__loading">Cargando…</p>
            ) : records.length === 0 ? (
                <p className="imcrm-portal-block__empty">No hay registros para mostrar.</p>
            ) : variant === 'compact_list' ? (
                <>
                    <ul className="imcrm-portal-related-list">
                        {records.map((rec) => {
                            const [firstSlug, ...restSlugs] = columns;
                            return (
                                <li key={rec.id} className="imcrm-portal-related-list__item">
                                    <p className="imcrm-portal-related-list__title">
                                        {firstSlug ? renderCell(rec.fields[firstSlug]) : `#${rec.id}`}
                                    </p>
                                    {restSlugs.length > 0 && (
                                        <p className="imcrm-portal-related-list__meta">
                                            {restSlugs
                                                .map((slug) => `${slug}: ${renderCell(rec.fields[slug])}`)
                                                .join(' · ')}
                                        </p>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                    {total > records.length ? (
                        <p className="imcrm-portal-related-table__footer">
                            Mostrando {records.length} de {total} registros.
                        </p>
                    ) : null}
                </>
            ) : (
                <>
                    <div className="imcrm-portal-related-table-wrap">
                    <table className="imcrm-portal-related-table">
                        <thead>
                            <tr>
                                {columns.map((slug) => (
                                    <th key={slug}>{slug}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {records.map((rec) => (
                                <tr key={rec.id}>
                                    {columns.map((slug) => (
                                        <td key={slug}>{renderCell(rec.fields[slug])}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                    {total > records.length ? (
                        <p className="imcrm-portal-related-table__footer">
                            Mostrando {records.length} de {total} registros.
                        </p>
                    ) : null}
                </>
            )}
        </section>
    );
}

function renderCell(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (value === true || value === 1 || value === '1') return '✓';
    if (value === false || value === 0 || value === '0') return '✗';
    if (Array.isArray(value)) return value.map(String).join(', ');
    return String(value);
}

function buildMockRecords(columns: string[]): PortalRecord[] {
    const samples = ['Proyecto Alpha', 'Sitio web v2', 'Campaña mayo'];
    const dates = ['2026-05-26', '2026-05-20', '2026-05-15'];
    const statuses = ['Activo', 'En revisión', 'Completado'];
    return samples.map((_, i) => {
        const fields: Record<string, unknown> = {};
        const useCols = columns.length > 0 ? columns : ['name', 'status', 'date'];
        useCols.forEach((slug) => {
            const lower = slug.toLowerCase();
            if (lower.includes('date') || lower.includes('fecha')) fields[slug] = dates[i] ?? '2026-01-01';
            else if (lower.includes('status') || lower.includes('estado')) fields[slug] = statuses[i] ?? 'Activo';
            else if (lower.includes('total') || lower.includes('monto') || lower.includes('amount')) fields[slug] = (i + 1) * 350;
            else fields[slug] = samples[i] ?? `Item ${i + 1}`;
        });
        return { id: i + 1, fields, relations: {} };
    });
}
