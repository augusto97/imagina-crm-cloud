import { useMemo } from 'react';
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
        /** Slug del field tipo `file` cuyo valor es una URL (o array de URLs). */
        field_slug?: string;
        /** `list` (default) lista vertical. `grid` 3-col con icono encima. */
        variant?: 'list' | 'grid';
    };
    record: PortalRecord;
}

interface ResolvedFile {
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
 * Bloque `download_files`. Lista archivos adjuntos al record del cliente.
 *
 * Implementación 100% client-side y sin red: el valor del field `file` en
 * Imagina Base es una URL (o array de URLs) — se listan directamente como
 * links de descarga. El mime se infiere de la extensión para el icono.
 *
 * Edge cases:
 *  - Field con valor null/''/no-URL → "sin archivos".
 *  - Field múltiple (array) → lista cada URL.
 */
export function DownloadFilesBlock({ config, record }: Props): JSX.Element {
    const fieldSlug = config.field_slug ?? '';
    const value = record.fields[fieldSlug];

    const isPreview = usePortalPreview();
    const resolved = useMemo(() => normalizeFileUrls(value), [value]);
    const items: ResolvedFile[] | null = isPreview ? MOCK_FILES : resolved;
    const error = !isPreview && fieldSlug === '' ? 'Bloque no configurado: falta field_slug.' : null;

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
 * Normaliza el valor del field a archivos descargables. Acepta una URL
 * http(s) o un array de URLs; cualquier otro shape se ignora.
 */
function normalizeFileUrls(value: unknown): ResolvedFile[] {
    const urls = (Array.isArray(value) ? value : [value]).filter(
        (v): v is string =>
            typeof v === 'string' && (/^https?:\/\//i.test(v.trim()) || v.trim().startsWith('/')),
    );
    return urls.map((raw, i) => {
        const url = raw.trim();
        let name = `Archivo ${i + 1}`;
        try {
            const path = decodeURIComponent(new URL(url).pathname);
            const last = path.split('/').filter(Boolean).pop();
            if (last) name = last;
        } catch {
            // URL rara: dejamos el nombre genérico.
        }
        return { id: i + 1, title: name, url, mimeType: mimeFromName(name) };
    });
}

/** Mime aproximado por extensión — solo para elegir el icono. */
function mimeFromName(name: string): string {
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image/' + ext;
    if (['mp4', 'mov', 'webm'].includes(ext)) return 'video/' + ext;
    if (['mp3', 'wav', 'ogg'].includes(ext)) return 'audio/' + ext;
    if (['zip', 'rar', '7z', 'gz'].includes(ext)) return 'application/zip';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'text/csv';
    return 'application/octet-stream';
}

const MOCK_FILES: ResolvedFile[] = [
    { id: 1, title: 'Contrato_2026.pdf',  url: '#', mimeType: 'application/pdf' },
    { id: 2, title: 'Factura_mayo.xlsx',  url: '#', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    { id: 3, title: 'Logo_corporativo.png', url: '#', mimeType: 'image/png' },
];
