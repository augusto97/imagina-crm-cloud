import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

import { __, sprintf } from '@/lib/i18n';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Páginas que se dibujan como máximo (el resto se descarga). */
const MAX_PAGES = 60;

/**
 * v0.1.291 — PDF del visor de adjuntos: pdf.js (el mismo del editor de
 * documentos) dibuja cada página en un canvas, una debajo de otra, y se
 * scrollea. Se ve igual en todos los navegadores, también en el celular
 * (donde el visor nativo del navegador no existe o descarga el archivo), y no
 * hace falta abrir la CSP: el archivo lo trae un `fetch` al propio servidor.
 *
 * Las páginas se dibujan de a una a medida que llegan.
 */
export default function FilePreviewPdf({ url, onError }: { url: string; onError: (message: string) => void }): JSX.Element {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const pagesRef = useRef<HTMLDivElement | null>(null);
    const [loading, setLoading] = useState(true);
    const [info, setInfo] = useState<{ total: number; shown: number } | null>(null);

    useEffect(() => {
        let alive = true;
        const host = pagesRef.current;
        if (!host) return undefined;
        host.replaceChildren();
        let task: ReturnType<typeof pdfjs.getDocument> | null = null;
        (async () => {
            try {
                const res = await fetch(url, { credentials: 'same-origin' });
                if (!res.ok) throw new Error(sprintf(__('El servidor respondió %d.'), res.status));
                const data = new Uint8Array(await res.arrayBuffer());
                if (!alive) return;
                // Sin WebAssembly: la CSP no lo habilita (los PDF raros con JPX/JBIG2 se descargan).
                task = pdfjs.getDocument({ data, useWasm: false });
                const doc = await task.promise;
                const total = doc.numPages;
                const shown = Math.min(total, MAX_PAGES);
                if (alive) setInfo({ total, shown });
                const width = Math.min(900, Math.max(260, (wrapRef.current?.clientWidth ?? 800) - 32));
                const ratio = Math.min(2, window.devicePixelRatio || 1);
                for (let n = 1; n <= shown && alive; n++) {
                    const page = await doc.getPage(n);
                    const base = page.getViewport({ scale: 1 });
                    const viewport = page.getViewport({ scale: (width / base.width) * ratio });
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.round(viewport.width);
                    canvas.height = Math.round(viewport.height);
                    canvas.style.width = `${Math.round(viewport.width / ratio)}px`;
                    canvas.style.maxWidth = '100%';
                    canvas.setAttribute('aria-label', sprintf(__('Página %d'), n));
                    canvas.setAttribute('role', 'img');
                    canvas.className = 'imcrm-block imcrm-bg-white imcrm-shadow-imcrm-lg';
                    await page.render({ canvas, viewport }).promise;
                    if (!alive) break;
                    host.appendChild(canvas);
                    if (n === 1) setLoading(false);
                }
                if (alive) setLoading(false);
            } catch (err) {
                if (alive) {
                    setLoading(false);
                    onError(err instanceof Error ? err.message : String(err));
                }
            } finally {
                if (task) void task.destroy();
            }
        })();
        return () => {
            alive = false;
        };
    }, [url, onError]);

    return (
        <div ref={wrapRef} className="imcrm-h-full imcrm-w-full imcrm-overflow-auto" data-testid="imcrm-preview-pdf">
            {loading && (
                <div className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-py-16 imcrm-text-sm imcrm-text-white/80">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando el PDF…')}
                </div>
            )}
            <div ref={pagesRef} className="imcrm-mx-auto imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-4 imcrm-px-4 imcrm-py-4" />
            {info !== null && info.total > info.shown && (
                <p className="imcrm-pb-6 imcrm-text-center imcrm-text-sm imcrm-text-white/80">
                    {sprintf(__('Se muestran las primeras %1$d de %2$d páginas. Descárgalo para ver el resto.'), info.shown, info.total)}
                </p>
            )}
        </div>
    );
}
