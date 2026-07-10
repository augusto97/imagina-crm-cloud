import { useEffect, useMemo, useState } from 'react';
import {
    Download,
    FileArchive,
    FileAudio,
    FileImage,
    FileSpreadsheet,
    FileText,
    FileVideo,
    type LucideIcon,
} from 'lucide-react';

import { sanitizeHref } from '@/lib/sanitize';
import { usePortalPreview } from '../PreviewContext';
import type { PortalRecord } from '../types';

interface Props {
    config: {
        title?: string;
        /** Slug del field tipo `file` cuyo valor es un attachment ID (o array). */
        field_slug?: string;
        /** `list` (default) lista vertical. `grid` 3-col con icono encima. */
        variant?: 'list' | 'grid';
    };
    record: PortalRecord;
}

interface ResolvedAttachment {
    id: number;
    title: string;
    url: string;
    mimeType: string;
}

/**
 * Mapea un mime type a un icono lucide específico por categoría.
 * Refleja el tipo de archivo en el preview visual del listado.
 */
function iconForMime(mime: string): LucideIcon {
    if (mime.startsWith('image/')) return FileImage;
    if (mime.startsWith('video/')) return FileVideo;
    if (mime.startsWith('audio/')) return FileAudio;
    if (
        mime === 'application/zip'
        || mime === 'application/x-rar-compressed'
        || mime === 'application/x-7z-compressed'
        || mime === 'application/gzip'
    ) return FileArchive;
    if (
        mime === 'application/vnd.ms-excel'
        || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        || mime === 'text/csv'
    ) return FileSpreadsheet;
    return FileText;
}

/**
 * Devuelve la extensión del archivo (en mayúsculas, sin punto)
 * desde una URL. Si no se puede extraer, devuelve null.
 */
function extensionFromUrl(url: string): string | null {
    try {
        const path = new URL(url, window.location.origin).pathname;
        const dot = path.lastIndexOf('.');
        const slash = path.lastIndexOf('/');
        if (dot <= slash) return null;
        const ext = path.slice(dot + 1).toUpperCase();
        return ext.length > 0 && ext.length <= 5 ? ext : null;
    } catch {
        return null;
    }
}

/**
 * Bloque `download_files` (Fase 9 — pulidos). Lista archivos
 * adjuntos al record del cliente.
 *
 * Implementación 100% client-side — usa el endpoint nativo de WP
 * `/wp-json/wp/v2/media/<id>` que es público para attachments. No
 * requiere agregar superficie REST al plugin.
 *
 * Edge cases:
 *  - Field tipo `file` con valor null/0 → "sin archivo".
 *  - Si el field permite múltiples archivos (array de IDs) → lista
 *    cada uno.
 *  - Si el media endpoint devuelve 404 (attachment borrado) → se
 *    omite del listado (no se muestra entry rota).
 */
export function DownloadFilesBlock({ config, record }: Props): JSX.Element {
    const fieldSlug = config.field_slug ?? '';
    const value = record.fields[fieldSlug];
    const attachmentIds = useMemo(() => normalizeAttachmentIds(value), [value]);

    const isPreview = usePortalPreview();
    const [items, setItems] = useState<ResolvedAttachment[] | null>(isPreview ? MOCK_FILES : null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isPreview) return;
        if (fieldSlug === '') {
            setError('Bloque no configurado: falta field_slug.');
            return;
        }
        if (attachmentIds.length === 0) {
            setItems([]);
            return;
        }

        const ac = new AbortController();
        // El endpoint nativo de WP acepta múltiples IDs como
        // `?include=1,2,3`. Eso ahorra round-trips.
        const url = `/wp-json/wp/v2/media?include=${attachmentIds.join(',')}&per_page=${attachmentIds.length}`;
        fetch(url, { signal: ac.signal, credentials: 'same-origin' })
            .then(async (res) => {
                if (!res.ok) throw new Error(`http-${res.status}`);
                const body = (await res.json()) as Array<{
                    id: number;
                    title: { rendered: string };
                    source_url: string;
                    mime_type?: string;
                }>;
                setItems(
                    body.map((m) => ({
                        id: m.id,
                        title: stripHtml(m.title.rendered) || `Archivo #${m.id}`,
                        url: m.source_url,
                        mimeType: m.mime_type ?? '',
                    })),
                );
            })
            .catch((err: unknown) => {
                if (err instanceof DOMException && err.name === 'AbortError') return;
                setError('No se pudieron cargar los archivos.');
            });
        return () => ac.abort();
    }, [attachmentIds, fieldSlug, isPreview]);

    const variant = config.variant ?? 'list';
    return (
        <section className="imcrm-portal-block imcrm-portal-block--downloads">
            <h2 className="imcrm-portal-block__title">{config.title ?? 'Archivos'}</h2>
            {error !== null ? (
                <p className="imcrm-portal-block__error" role="alert">
                    {error}
                </p>
            ) : items === null ? (
                <p className="imcrm-portal-block__loading">Cargando…</p>
            ) : items.length === 0 ? (
                <p className="imcrm-portal-block__empty">Sin archivos disponibles.</p>
            ) : variant === 'grid' ? (
                <ul className="imcrm-portal-downloads-grid">
                    {items.map((att) => {
                        const Icon = iconForMime(att.mimeType);
                        const ext = extensionFromUrl(att.url);
                        return (
                            <li key={att.id} className="imcrm-portal-downloads-grid__item">
                                <a
                                    href={sanitizeHref(att.url)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="imcrm-portal-downloads-grid__link"
                                    download
                                >
                                    <Icon className="imcrm-portal-downloads-grid__icon" aria-hidden />
                                    <span className="imcrm-portal-downloads-grid__title">
                                        {att.title}
                                    </span>
                                    {ext !== null && (
                                        <span className="imcrm-portal-downloads-grid__ext">{ext}</span>
                                    )}
                                    <Download
                                        className="imcrm-portal-downloads-grid__action"
                                        aria-hidden
                                    />
                                </a>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <ul className="imcrm-portal-downloads">
                    {items.map((att) => {
                        const Icon = iconForMime(att.mimeType);
                        const ext = extensionFromUrl(att.url);
                        return (
                            <li key={att.id} className="imcrm-portal-downloads__item">
                                <Icon className="imcrm-portal-downloads__icon" aria-hidden />
                                <a
                                    href={sanitizeHref(att.url)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="imcrm-portal-downloads__link"
                                    download
                                >
                                    {att.title}
                                </a>
                                {ext !== null && (
                                    <span className="imcrm-portal-downloads__ext">{ext}</span>
                                )}
                                <Download className="imcrm-portal-downloads__action" aria-hidden />
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

/**
 * Normaliza el valor del field a array de attachment IDs.
 * El field tipo `file` puede guardar:
 *  - un único int (single file).
 *  - array de ints (multiple files — config.multiple = true).
 *  - null / 0 / '' → sin archivos.
 */
function normalizeAttachmentIds(value: unknown): number[] {
    if (value === null || value === undefined || value === '' || value === 0) return [];
    if (typeof value === 'number') return value > 0 ? [value] : [];
    if (typeof value === 'string') {
        const n = parseInt(value, 10);
        return n > 0 ? [n] : [];
    }
    if (Array.isArray(value)) {
        const out: number[] = [];
        for (const v of value) {
            if (typeof v === 'number' && v > 0) out.push(v);
            else if (typeof v === 'string') {
                const n = parseInt(v, 10);
                if (n > 0) out.push(n);
            }
        }
        return out;
    }
    return [];
}

function stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, '').trim();
}

const MOCK_FILES: ResolvedAttachment[] = [
    { id: 1, title: 'Contrato_2026.pdf',  url: '#', mimeType: 'application/pdf' },
    { id: 2, title: 'Factura_mayo.xlsx',  url: '#', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    { id: 3, title: 'Logo_corporativo.png', url: '#', mimeType: 'image/png' },
];
