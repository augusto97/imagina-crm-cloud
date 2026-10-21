import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
    ChevronLeft,
    ChevronRight,
    Download,
    ExternalLink,
    FileText,
    Loader2,
    Maximize,
    Minus,
    Plus,
    X,
} from 'lucide-react';

import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import {
    closeFilePreview,
    downloadUrlOf,
    formatBytes,
    isSameOriginUrl,
    previewKind,
    previewUrlOf,
    setFilePreviewIndex,
    TEXT_PREVIEW_BYTES,
    type PreviewFile,
} from './filePreview';

// pdf.js pesa: sólo se baja cuando se abre un PDF.
const FilePreviewPdf = lazy(() => import('./FilePreviewPdf'));

/**
 * v0.1.291 — El visor de adjuntos a pantalla completa (ver `filePreview.ts`).
 * Diálogo de Radix: atrapa el foco, Escape cierra y el lector de pantalla lo
 * anuncia con el nombre del archivo. ←/→ pasan al anterior/siguiente del mismo
 * campo; +/−/0 hacen zoom en las imágenes.
 */
export default function FilePreviewDialog({ files, index }: { files: PreviewFile[]; index: number }): JSX.Element {
    const file = files[index]!;
    const many = files.length > 1;
    const kind = isSameOriginUrl(file.url) ? previewKind(file.mimeType, file.title) : previewKind(file.mimeType, file.title) === 'image' ? 'image' : 'other';
    const [zoom, setZoom] = useState<'fit' | number>('fit');
    const [failed, setFailed] = useState<string | null>(null);

    // Otro archivo: vuelve a "ajustar" y limpia el error.
    useEffect(() => {
        setZoom('fit');
        setFailed(null);
    }, [file.url]);

    const go = useCallback((delta: number) => setFilePreviewIndex(index + delta), [index]);
    const onError = useCallback((msg: string) => setFailed(msg), []);

    const onKeyDown = (e: React.KeyboardEvent): void => {
        const tag = (e.target as HTMLElement).tagName;
        // En un video/audio las flechas adelantan; en un texto, mueven el cursor.
        if (tag === 'VIDEO' || tag === 'AUDIO' || tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (many && e.key === 'ArrowLeft') {
            e.preventDefault();
            go(-1);
        } else if (many && e.key === 'ArrowRight') {
            e.preventDefault();
            go(1);
        } else if (kind === 'image' || kind === 'svg') {
            if (e.key === '+' || e.key === '=') setZoom((z) => nextZoom(z, 1.25));
            else if (e.key === '-') setZoom((z) => nextZoom(z, 0.8));
            else if (e.key === '0') setZoom('fit');
        }
    };

    const view = previewUrlOf(file.url);
    const size = formatBytes(file.sizeBytes);

    return (
        <Dialog.Root open onOpenChange={(open) => !open && closeFilePreview()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-[60] imcrm-bg-neutral-950/95" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-inset-0 imcrm-z-[60] imcrm-flex imcrm-flex-col imcrm-text-white focus:imcrm-outline-none"
                    onKeyDown={onKeyDown}
                    data-testid="imcrm-file-preview"
                    data-kind={failed ? 'error' : kind}
                    aria-describedby={undefined}
                >
                    <header className="imcrm-flex imcrm-h-14 imcrm-shrink-0 imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-white/10 imcrm-bg-neutral-950 imcrm-px-3 sm:imcrm-px-4">
                        <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                            <Dialog.Title className="imcrm-truncate imcrm-text-sm imcrm-font-semibold" title={file.title}>
                                {file.title}
                            </Dialog.Title>
                            <span className="imcrm-truncate imcrm-text-[11px] imcrm-text-white/60">
                                {[many ? sprintf(__('%1$d de %2$d'), index + 1, files.length) : null, size || null]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </span>
                        </div>
                        {(kind === 'image' || kind === 'svg') && !failed && (
                            <div className="imcrm-hidden imcrm-items-center imcrm-gap-0.5 sm:imcrm-flex" role="group" aria-label={__('Zoom')}>
                                <ToolButton label={__('Alejar')} onClick={() => setZoom((z) => nextZoom(z, 0.8))}>
                                    <Minus className="imcrm-h-4 imcrm-w-4" />
                                </ToolButton>
                                <button
                                    type="button"
                                    onClick={() => setZoom((z) => (z === 'fit' ? 1 : 'fit'))}
                                    className="imcrm-h-8 imcrm-min-w-[4.5rem] imcrm-rounded-md imcrm-px-2 imcrm-text-xs imcrm-tabular-nums hover:imcrm-bg-white/10"
                                    title={zoom === 'fit' ? __('Ver al 100 %') : __('Ajustar a la pantalla')}
                                    data-testid="imcrm-preview-zoom"
                                >
                                    {zoom === 'fit' ? __('Ajustar') : `${Math.round(zoom * 100)} %`}
                                </button>
                                <ToolButton label={__('Acercar')} onClick={() => setZoom((z) => nextZoom(z, 1.25))}>
                                    <Plus className="imcrm-h-4 imcrm-w-4" />
                                </ToolButton>
                                <ToolButton label={__('Ajustar a la pantalla')} onClick={() => setZoom('fit')}>
                                    <Maximize className="imcrm-h-4 imcrm-w-4" />
                                </ToolButton>
                            </div>
                        )}
                        <a
                            href={downloadUrlOf(file.url)}
                            download={file.title}
                            className="imcrm-inline-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-md hover:imcrm-bg-white/10"
                            aria-label={__('Descargar')}
                            title={__('Descargar')}
                            data-testid="imcrm-preview-download"
                        >
                            <Download className="imcrm-h-4 imcrm-w-4" />
                        </a>
                        <a
                            href={view}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="imcrm-inline-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-md hover:imcrm-bg-white/10"
                            aria-label={__('Abrir en otra pestaña')}
                            title={__('Abrir en otra pestaña')}
                        >
                            <ExternalLink className="imcrm-h-4 imcrm-w-4" />
                        </a>
                        <Dialog.Close
                            className="imcrm-inline-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-md hover:imcrm-bg-white/10"
                            aria-label={__('Cerrar')}
                            title={__('Cerrar (Esc)')}
                        >
                            <X className="imcrm-h-5 imcrm-w-5" />
                        </Dialog.Close>
                    </header>

                    <div className="imcrm-relative imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-items-center imcrm-justify-center">
                        {failed ? (
                            <Unavailable file={file} reason={failed} />
                        ) : kind === 'image' ? (
                            <ImageView src={view} alt={file.title} zoom={zoom} onError={() => setFailed(__('No se pudo mostrar la imagen.'))} />
                        ) : kind === 'svg' ? (
                            <SvgView url={view} alt={file.title} zoom={zoom} onError={onError} />
                        ) : kind === 'pdf' ? (
                            <Suspense fallback={<Spinner />}>
                                <FilePreviewPdf url={view} onError={onError} />
                            </Suspense>
                        ) : kind === 'video' ? (
                            <video
                                key={view}
                                src={view}
                                controls
                                preload="metadata"
                                className="imcrm-max-h-full imcrm-max-w-full"
                                onError={() => setFailed(__('Este navegador no puede reproducir el video.'))}
                                data-testid="imcrm-preview-video"
                            />
                        ) : kind === 'audio' ? (
                            <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-4 imcrm-px-4">
                                <FileText className="imcrm-h-12 imcrm-w-12 imcrm-text-white/50" aria-hidden />
                                <audio
                                    key={view}
                                    src={view}
                                    controls
                                    preload="metadata"
                                    className="imcrm-w-[min(32rem,90vw)]"
                                    onError={() => setFailed(__('Este navegador no puede reproducir el audio.'))}
                                    data-testid="imcrm-preview-audio"
                                />
                            </div>
                        ) : kind === 'text' ? (
                            <TextView url={view} mimeType={file.mimeType} onError={onError} />
                        ) : (
                            <Unavailable file={file} reason={null} />
                        )}

                        {many && (
                            <>
                                <NavButton side="left" label={__('Anterior')} onClick={() => go(-1)} />
                                <NavButton side="right" label={__('Siguiente')} onClick={() => go(1)} />
                            </>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function nextZoom(z: 'fit' | number, factor: number): number {
    const base = z === 'fit' ? 1 : z;
    return Math.min(8, Math.max(0.1, Math.round(base * factor * 100) / 100));
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            className="imcrm-inline-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md hover:imcrm-bg-white/10"
        >
            {children}
        </button>
    );
}

function NavButton({ side, label, onClick }: { side: 'left' | 'right'; label: string; onClick: () => void }): JSX.Element {
    const Icon = side === 'left' ? ChevronLeft : ChevronRight;
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            data-testid={`imcrm-preview-${side === 'left' ? 'prev' : 'next'}`}
            className={cn(
                'imcrm-absolute imcrm-top-1/2 imcrm-z-[1] imcrm-flex imcrm-h-11 imcrm-w-11 -imcrm-translate-y-1/2 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-black/55 imcrm-text-white imcrm-ring-1 imcrm-ring-white/20 hover:imcrm-bg-black/75',
                side === 'left' ? 'imcrm-left-2 sm:imcrm-left-4' : 'imcrm-right-2 sm:imcrm-right-4',
            )}
        >
            <Icon className="imcrm-h-6 imcrm-w-6" />
        </button>
    );
}

function Spinner(): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-white/80">
            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
            {__('Cargando…')}
        </div>
    );
}

function ImageView({ src, alt, zoom, onError }: { src: string; alt: string; zoom: 'fit' | number; onError: () => void }): JSX.Element {
    const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
    if (zoom === 'fit') {
        return (
            <img
                src={src}
                alt={alt}
                onError={onError}
                onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                className="imcrm-max-h-full imcrm-max-w-full imcrm-select-none imcrm-object-contain imcrm-p-2 sm:imcrm-p-6"
                data-testid="imcrm-preview-image"
                draggable={false}
            />
        );
    }
    return (
        <div className="imcrm-h-full imcrm-w-full imcrm-overflow-auto">
            <div className="imcrm-flex imcrm-min-h-full imcrm-min-w-full imcrm-items-center imcrm-justify-center imcrm-p-4" style={{ width: 'max-content' }}>
                <img
                    src={src}
                    alt={alt}
                    onError={onError}
                    style={natural ? { width: natural.w * zoom, height: natural.h * zoom, maxWidth: 'none' } : { transform: `scale(${zoom})` }}
                    onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                    className="imcrm-select-none"
                    data-testid="imcrm-preview-image"
                    draggable={false}
                />
            </div>
        </div>
    );
}

/**
 * SVG: se baja como texto y se muestra desde un Blob en un <img> — así se ve
 * la imagen pero un script que traiga adentro NO corre (el servidor, además,
 * nunca lo sirve como documento).
 */
function SvgView({ url, alt, zoom, onError }: { url: string; alt: string; zoom: 'fit' | number; onError: (m: string) => void }): JSX.Element {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    useEffect(() => {
        let alive = true;
        let made: string | null = null;
        (async () => {
            try {
                const res = await fetch(url, { credentials: 'same-origin' });
                if (!res.ok) throw new Error(sprintf(__('El servidor respondió %d.'), res.status));
                const text = await res.text();
                made = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
                if (alive) setBlobUrl(made);
            } catch (err) {
                if (alive) onError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => {
            alive = false;
            if (made) URL.revokeObjectURL(made);
        };
    }, [url, onError]);
    if (blobUrl === null) return <Spinner />;
    return <ImageView src={blobUrl} alt={alt} zoom={zoom} onError={() => onError(__('No se pudo mostrar la imagen.'))} />;
}

/** Texto, CSV o JSON: los primeros 200 KB en monoespaciado (nunca se interpreta). */
function TextView({ url, mimeType, onError }: { url: string; mimeType: string; onError: (m: string) => void }): JSX.Element {
    const [text, setText] = useState<string | null>(null);
    const [truncated, setTruncated] = useState(false);
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await fetch(url, { credentials: 'same-origin', headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` } });
                if (!res.ok && res.status !== 206) throw new Error(sprintf(__('El servidor respondió %d.'), res.status));
                const buf = await res.arrayBuffer();
                const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1] ?? buf.byteLength);
                const cut = buf.byteLength > TEXT_PREVIEW_BYTES || total > TEXT_PREVIEW_BYTES;
                let out = new TextDecoder('utf-8').decode(buf.byteLength > TEXT_PREVIEW_BYTES ? buf.slice(0, TEXT_PREVIEW_BYTES) : buf);
                if (!cut && /json/i.test(mimeType)) {
                    try {
                        out = JSON.stringify(JSON.parse(out), null, 2);
                    } catch {
                        // No es JSON válido: se muestra tal cual.
                    }
                }
                if (alive) {
                    setText(out);
                    setTruncated(cut);
                }
            } catch (err) {
                if (alive) onError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => {
            alive = false;
        };
    }, [url, mimeType, onError]);
    if (text === null) return <Spinner />;
    return (
        <div className="imcrm-flex imcrm-h-full imcrm-w-full imcrm-flex-col imcrm-p-2 sm:imcrm-p-6">
            {truncated && (
                <p className="imcrm-mb-2 imcrm-text-xs imcrm-text-white/70">
                    {__('Se muestran los primeros 200 KB. Descárgalo para verlo completo.')}
                </p>
            )}
            <pre
                className="imcrm-m-0 imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-auto imcrm-whitespace-pre imcrm-rounded-md imcrm-bg-neutral-950 imcrm-p-4 imcrm-font-mono imcrm-text-xs imcrm-leading-relaxed imcrm-text-neutral-100 imcrm-ring-1 imcrm-ring-white/10"
                data-testid="imcrm-preview-text"
                tabIndex={0}
            >
                {text}
            </pre>
        </div>
    );
}

function Unavailable({ file, reason }: { file: PreviewFile; reason: string | null }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-max-w-sm imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-px-6 imcrm-text-center" data-testid="imcrm-preview-other">
            <span className="imcrm-flex imcrm-h-16 imcrm-w-16 imcrm-items-center imcrm-justify-center imcrm-rounded-2xl imcrm-bg-white/10">
                <FileText className="imcrm-h-8 imcrm-w-8" aria-hidden />
            </span>
            <p className="imcrm-break-all imcrm-text-base imcrm-font-semibold">{file.title}</p>
            <p className="imcrm-text-sm imcrm-text-white/70">
                {[formatBytes(file.sizeBytes), reason ?? __('Este tipo de archivo no tiene vista previa.')].filter(Boolean).join(' · ')}
            </p>
            <a
                href={downloadUrlOf(file.url)}
                download={file.title}
                className="imcrm-inline-flex imcrm-h-9 imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-white imcrm-px-4 imcrm-text-sm imcrm-font-medium imcrm-text-neutral-900 hover:imcrm-bg-white/90"
            >
                <Download className="imcrm-h-4 imcrm-w-4" />
                {__('Descargar')}
            </a>
        </div>
    );
}
