import { useSyncExternalStore } from 'react';

/**
 * v0.1.291 — Vista previa de adjuntos a pantalla completa.
 *
 * Un solo visor para toda la app: cualquier lugar que muestre un archivo
 * (celda de la tabla, ficha, bloque de archivos, descripción) llama a
 * `openFilePreview` y el visor —montado una vez en la raíz y cargado a
 * pedido— lo muestra. Sin prop drilling ni un diálogo por celda.
 *
 * Los archivos se piden con `preview=1`: el servidor los SIRVE él mismo (aunque
 * vivan en un bucket S3) con rangos de bytes, así el visor no tiene que abrir
 * la CSP a otros orígenes y el video puede adelantarse.
 */
export interface PreviewFile {
    id?: number;
    /** URL del archivo (firmada o con sesión); sin `preview=1`. */
    url: string;
    title: string;
    mimeType: string;
    sizeBytes?: number;
}

export type PreviewKind = 'image' | 'svg' | 'pdf' | 'video' | 'audio' | 'text' | 'other';

interface PreviewState {
    files: PreviewFile[];
    index: number;
}

let state: PreviewState | null = null;
const listeners = new Set<() => void>();

function emit(): void {
    for (const l of listeners) l();
}

export function openFilePreview(files: readonly PreviewFile[], index = 0): void {
    if (files.length === 0) return;
    state = { files: [...files], index: Math.max(0, Math.min(files.length - 1, index)) };
    emit();
}

export function closeFilePreview(): void {
    if (state === null) return;
    state = null;
    emit();
}

export function setFilePreviewIndex(index: number): void {
    if (state === null) return;
    const n = state.files.length;
    state = { ...state, index: ((index % n) + n) % n };
    emit();
}

export function useFilePreviewState(): PreviewState | null {
    return useSyncExternalStore(
        (cb) => {
            listeners.add(cb);
            return () => listeners.delete(cb);
        },
        () => state,
        () => null,
    );
}

/** Tipos de texto que se muestran tal cual (monoespaciado). */
const TEXT_MIMES = new Set([
    'application/json',
    'application/x-ndjson',
    'application/xml',
    'application/javascript',
    'application/x-yaml',
    'application/yaml',
    'application/sql',
]);
const TEXT_EXT = /\.(txt|csv|tsv|json|ndjson|md|markdown|log|xml|ya?ml|ini|sql|html?|css|js|ts)$/i;

/**
 * Qué visor usar. El SVG va aparte: se dibuja como imagen a partir de un
 * Blob (en un <img> un SVG no ejecuta scripts) y nunca se abre como documento.
 */
export function previewKind(mimeType: string, title = ''): PreviewKind {
    const mime = mimeType.toLowerCase().split(';')[0]!.trim();
    if (mime === 'image/svg+xml' || /\.svg$/i.test(title)) return 'svg';
    if (mime.startsWith('image/')) return 'image';
    if (mime === 'application/pdf') return 'pdf';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('text/') || TEXT_MIMES.has(mime) || mime.endsWith('+json') || mime.endsWith('+xml')) return 'text';
    if ((mime === '' || mime === 'application/octet-stream') && TEXT_EXT.test(title)) return 'text';
    return 'other';
}

/** URL relativa al propio servidor (las de otros orígenes no se piden por fetch). */
export function isSameOriginUrl(url: string): boolean {
    if (url.startsWith('/') && !url.startsWith('//')) return true;
    try {
        return new URL(url, window.location.href).origin === window.location.origin;
    } catch {
        return false;
    }
}

function withParam(url: string, key: string): string {
    if (!isSameOriginUrl(url)) return url;
    const [base, hash = ''] = url.split('#') as [string, string?];
    const sep = base.includes('?') ? '&' : '?';
    if (new RegExp(`[?&]${key}=1(&|$)`).test(base)) return url;
    return `${base}${sep}${key}=1${hash ? `#${hash}` : ''}`;
}

/** La URL para mirarlo en el visor (servida por el servidor, con rangos). */
export function previewUrlOf(url: string): string {
    return withParam(url, 'preview');
}

/** La URL para descargarlo (fuerza «guardar como»). */
export function downloadUrlOf(url: string): string {
    return withParam(url, 'dl');
}

/** «1,5 MB», «820 KB». */
export function formatBytes(bytes: number | undefined): string {
    if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1).replace('.', ',')} GB`;
}

/** Cuánto texto se muestra como máximo (el resto se descarga). */
export const TEXT_PREVIEW_BYTES = 200 * 1024;
