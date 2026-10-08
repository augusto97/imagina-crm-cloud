import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { DocBlockRegion } from '@imagina-base/shared';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * v0.1.266 — Vista previa del editor de documentos (ADR-S35): el PDF REAL
 * que arma el servidor, dibujado página por página con pdf.js (se ve igual en
 * todos los navegadores, también en el celular, a diferencia del visor de PDF
 * de cada uno). Encima de cada página van las ZONAS de los bloques que el
 * servidor midió al maquetar: tocar una zona elige ese bloque.
 *
 * Las páginas se dibujan fuera de pantalla y se cambian todas juntas: sin
 * parpadeo mientras se edita.
 */
export interface PdfCanvasPreviewProps {
    pdf: string | null;
    regions: DocBlockRegion[];
    pageWidth: number;
    pageHeight: number;
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    loading: boolean;
    /** Ancho máximo de la hoja en pantalla (px). */
    maxWidth?: number;
}

export function PdfCanvasPreview(p: PdfCanvasPreviewProps): JSX.Element {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const [width, setWidth] = useState(720);
    const [pages, setPages] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [hover, setHover] = useState<string | null>(null);

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setWidth(Math.max(240, Math.min(p.maxWidth ?? 820, el.clientWidth - 32))));
        ro.observe(el);
        return () => ro.disconnect();
    }, [p.maxWidth]);

    // Dibuja las páginas cuando cambia el PDF o el ancho.
    useEffect(() => {
        if (!p.pdf) return;
        let alive = true;
        const bin = atob(p.pdf);
        const data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        // Sin WebAssembly: los PDF propios no traen JPX/JBIG2 y la CSP no habilita wasm.
        const task = pdfjs.getDocument({ data, useWasm: false });
        (async () => {
            try {
                const doc = await task.promise;
                const out: string[] = [];
                const ratio = Math.min(2, window.devicePixelRatio || 1);
                for (let n = 1; n <= doc.numPages; n++) {
                    const page = await doc.getPage(n);
                    const base = page.getViewport({ scale: 1 });
                    const viewport = page.getViewport({ scale: (width / base.width) * ratio });
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.round(viewport.width);
                    canvas.height = Math.round(viewport.height);
                    await page.render({ canvas, viewport }).promise;
                    out.push(canvas.toDataURL('image/png'));
                }
                if (alive) {
                    setPages(out);
                    setError(null);
                }
                // pdf.js 6: el documento se libera destruyendo su tarea de carga.
                void task.destroy();
            } catch (err) {
                if (alive) setError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => {
            alive = false;
            void task.destroy();
        };
    }, [p.pdf, width]);

    const scale = width / (p.pageWidth || 612);
    const pageH = (p.pageHeight || 792) * scale;

    return (
        <div ref={wrapRef} className="imcrm-relative imcrm-h-full imcrm-overflow-y-auto imcrm-bg-canvas imcrm-py-4" data-testid="doc-preview">
            {p.loading && (
                <div className="imcrm-pointer-events-none imcrm-absolute imcrm-right-4 imcrm-top-3 imcrm-z-10 imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-bg-card imcrm-px-2.5 imcrm-py-1 imcrm-text-[11px] imcrm-text-muted-foreground imcrm-shadow-imcrm-sm">
                    <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                    {__('Actualizando…')}
                </div>
            )}
            {error && <p className="imcrm-mx-auto imcrm-max-w-md imcrm-p-4 imcrm-text-center imcrm-text-sm imcrm-text-destructive">{error}</p>}
            {pages.length === 0 && !error && (
                <div className="imcrm-flex imcrm-h-64 imcrm-items-center imcrm-justify-center imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-mr-2 imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Armando el PDF…')}
                </div>
            )}
            <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-4">
                {pages.map((src, i) => (
                    <div
                        key={i}
                        className="imcrm-relative imcrm-bg-white imcrm-shadow-imcrm-md"
                        style={{ width, height: pageH }}
                        data-testid="doc-page"
                        onClick={(e) => {
                            if (e.target === e.currentTarget) p.onSelect(null);
                        }}
                    >
                        <img src={src} alt={`${__('Página')} ${i + 1}`} className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-0 imcrm-h-full imcrm-w-full imcrm-select-none" />
                        {p.regions
                            .filter((r) => r.page === i + 1)
                            .map((r, k) => {
                                const active = r.id === p.selectedId;
                                const hovered = r.id === hover && !active;
                                return (
                                    <button
                                        key={`${r.id}-${k}`}
                                        type="button"
                                        aria-label={__('Elegir este bloque')}
                                        data-block-region={r.id}
                                        onMouseEnter={() => setHover(r.id)}
                                        onMouseLeave={() => setHover((h) => (h === r.id ? null : h))}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            p.onSelect(r.id);
                                        }}
                                        className={cn(
                                            'imcrm-absolute imcrm-rounded-sm imcrm-outline-none',
                                            active && 'imcrm-ring-2 imcrm-ring-primary imcrm-ring-offset-1',
                                            hovered && 'imcrm-ring-1 imcrm-ring-primary/50 imcrm-bg-primary/[0.03]',
                                        )}
                                        style={{ left: r.x * scale - 3, top: r.y * scale - 2, width: r.w * scale + 6, height: Math.max(8, r.h * scale) + 2 }}
                                    />
                                );
                            })}
                    </div>
                ))}
            </div>
        </div>
    );
}
