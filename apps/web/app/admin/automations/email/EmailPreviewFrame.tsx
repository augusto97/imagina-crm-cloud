import { useEffect, useMemo, useRef } from 'react';
import { EMAIL_DARK_MEDIA, localizeGoogleFonts } from '@imagina-base/shared';

import { cn } from '@/lib/utils';

import type { DragSource, DropTarget } from './emailDesignOps';
import type { DropGeometry, DropResolution } from './emailDnd';

/**
 * v0.1.265 — Vista previa del correo en un iframe aislado (ADR-S34).
 *
 * El HTML es EXACTAMENTE el que sale por correo (lo arma `renderEmailHtml`
 * de packages/shared): así lo que se ve aquí es lo que recibe Gmail/Outlook,
 * sin que los estilos de la app lo contaminen. `sandbox` sin `allow-scripts`
 * — nada adentro ejecuta código (la firma y el bloque «HTML propio» los
 * escribe una persona) — pero con `allow-same-origin` para que la app pueda
 * escuchar los eventos y marcar el bloque elegido.
 *
 * v0.1.270 — Además:
 *  - ARRASTRAR Y SOLTAR: los bloques se arrastran para reordenarlos (también
 *    dentro y fuera de las columnas) y los del panel de la izquierda se sueltan
 *    donde se quieran; una línea muestra dónde caen. Los listeners viven en la
 *    app (el iframe no ejecuta scripts) y se vuelven a poner tras cada escritura.
 *  - Barra flotante del bloque elegido (subir, bajar, duplicar, eliminar).
 *  - Vista en MODO OSCURO: con colores propios del tema, se muestran esos
 *    (el `@media (prefers-color-scheme: dark)` pasa a `@media all`); sin ellos,
 *    se simula lo que hacen Gmail/Outlook (invierten los colores claros).
 *  - Los atajos del teclado funcionan también con el foco dentro del iframe.
 */
const EDITOR_CSS = `
[data-ib-block]{cursor:pointer;outline:1px dashed transparent;outline-offset:-1px;transition:outline-color .12s;}
[data-ib-block]:hover{outline-color:rgba(14,116,144,.55);}
[data-ib-block][draggable="true"]{cursor:grab;}
[data-ib-selected]{outline:2px solid #0e7490 !important;outline-offset:-2px;}
[data-ib-dragging]{opacity:.35;}
a{pointer-events:none;}
img{-webkit-user-drag:none;}
#ib-drop-line{position:absolute;height:4px;margin-top:-2px;background:#0e7490;border-radius:2px;pointer-events:none;z-index:2147483646;box-shadow:0 0 0 2px rgba(255,255,255,.85);}
#ib-drop-line::before,#ib-drop-line::after{content:"";position:absolute;top:-3px;width:10px;height:10px;border-radius:50%;background:#0e7490;}
#ib-drop-line::before{left:-5px;}#ib-drop-line::after{right:-5px;}
#ib-toolbar{position:absolute;z-index:2147483647;display:flex;align-items:center;gap:1px;padding:2px;background:#0e7490;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.25);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;}
#ib-toolbar span{color:#fff;font-size:11px;font-weight:600;padding:0 6px 0 6px;white-space:nowrap;}
#ib-toolbar button{all:unset;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:4px;color:#fff;cursor:pointer;}
#ib-toolbar button:hover{background:rgba(255,255,255,.2);}
#ib-toolbar button[disabled]{opacity:.35;cursor:default;background:none;}
#ib-toolbar svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}
`;

/** Simulación del modo oscuro de Gmail/Outlook (invierten los claros). */
const SIMULATED_DARK_CSS = `html{filter:invert(1) hue-rotate(180deg);background:#fff;}img,[data-ib-keep],#ib-drop-line{filter:invert(1) hue-rotate(180deg);}`;

const ICONS: Record<string, string> = {
    up: '<svg viewBox="0 0 24 24"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>',
    duplicate: '<svg viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
    remove: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
};

export type BlockAction = 'up' | 'down' | 'duplicate' | 'remove';

export interface PreviewDnd {
    /** Lo que se está arrastrando ahora (del panel, del esquema o de la vista previa). */
    current: () => DragSource | null;
    start: (src: DragSource) => void;
    end: () => void;
    resolve: (x: number, y: number, g: DropGeometry) => DropResolution | null;
    drop: (target: DropTarget) => void;
}

export interface ToolbarInfo {
    label: string;
    canUp: boolean;
    canDown: boolean;
}

/** Aplica el modo de color de la vista previa al HTML del correo. */
export function previewHtmlFor(source: string, dark: boolean): string {
    // v0.1.272 — Las fuentes web, servidas por la app (la CSP no deja pedirlas
    // a Google Fonts): se ve exactamente la letra que verá quien lo reciba.
    const html = source ? localizeGoogleFonts(source, typeof window === 'undefined' ? '' : window.location.origin) : source;
    if (!dark || !html) return html;
    if (html.includes(EMAIL_DARK_MEDIA)) return html.split(EMAIL_DARK_MEDIA).join('@media all');
    return html.replace('</head>', `<style data-ib-sim>${SIMULATED_DARK_CSS}</style></head>`);
}

export function EmailPreviewFrame({
    html,
    onSelect,
    width,
    className,
    interactive = true,
    dark = false,
    dnd,
    toolbar,
    onAction,
    onKeyDown,
    title = 'Vista previa del correo',
}: {
    html: string;
    onSelect?: (id: string | null) => void;
    /** Ancho del "dispositivo" (px) o null = todo el espacio. */
    width?: number | null;
    className?: string;
    interactive?: boolean;
    /** Ver el correo como en un programa en modo oscuro. */
    dark?: boolean;
    dnd?: PreviewDnd;
    /** Barra del bloque elegido (null = sin barra). */
    toolbar?: ToolbarInfo | null;
    onAction?: (action: BlockAction) => void;
    onKeyDown?: (e: KeyboardEvent) => void;
    title?: string;
}): JSX.Element {
    const ref = useRef<HTMLIFrameElement | null>(null);
    const cb = useRef({ onSelect, dnd, onAction, onKeyDown, toolbar });
    cb.current = { onSelect, dnd, onAction, onKeyDown, toolbar };
    const finalHtml = useMemo(() => previewHtmlFor(html, dark), [html, dark]);

    useEffect(() => {
        const frame = ref.current;
        const doc = frame?.contentDocument;
        const win = frame?.contentWindow;
        if (!frame || !doc || !win) return;
        const scrollY = win.scrollY ?? 0;
        // `document.open()` borra los listeners del documento Y de su ventana
        // (spec HTML): se vuelven a poner después de cada escritura.
        doc.open();
        doc.write(finalHtml);
        doc.close();
        win.scrollTo(0, scrollY);
        if (!interactive) return;

        const style = doc.createElement('style');
        style.textContent = EDITOR_CSS;
        doc.head?.appendChild(style);

        const canDrag = Boolean(cb.current.dnd);
        if (canDrag) {
            doc.querySelectorAll<HTMLElement>('[data-ib-block]').forEach((el) => {
                if (el.getAttribute('data-ib-block') !== '__signature') el.setAttribute('draggable', 'true');
            });
            doc.querySelectorAll('img').forEach((img) => img.setAttribute('draggable', 'false'));
        }

        // --- Barra flotante del bloque elegido -------------------------------
        const placeToolbar = (): void => {
            doc.getElementById('ib-toolbar')?.remove();
            const info = cb.current.toolbar;
            const el = doc.querySelector<HTMLElement>('[data-ib-selected]');
            if (!info || !el || !doc.body) return;
            const r = el.getBoundingClientRect();
            const bar = doc.createElement('div');
            bar.id = 'ib-toolbar';
            bar.setAttribute('data-ib-keep', '');
            const btn = (action: BlockAction, label: string, disabled = false): string =>
                `<button type="button" data-ib-action="${action}" title="${label}" aria-label="${label}"${disabled ? ' disabled' : ''}>${ICONS[action]}</button>`;
            const label = doc.createElement('span');
            label.textContent = info.label;
            bar.appendChild(label);
            bar.insertAdjacentHTML(
                'beforeend',
                btn('up', 'Subir', !info.canUp) + btn('down', 'Bajar', !info.canDown) + btn('duplicate', 'Duplicar') + btn('remove', 'Eliminar'),
            );
            doc.body.appendChild(bar);
            const top = Math.max(win.scrollY + 2, r.top + win.scrollY - bar.offsetHeight - 2);
            const left = Math.max(2, Math.min(r.right + win.scrollX - bar.offsetWidth, win.innerWidth - bar.offsetWidth - 2));
            bar.style.top = `${top}px`;
            bar.style.left = `${left}px`;
        };
        placeToolbar();

        // --- Arrastrar y soltar --------------------------------------------
        const box = (el: Element): { top: number; bottom: number; left: number; right: number } => {
            const r = el.getBoundingClientRect();
            return { top: r.top + win.scrollY, bottom: r.bottom + win.scrollY, left: r.left + win.scrollX, right: r.right + win.scrollX };
        };
        const geometry = (): DropGeometry | null => {
            const sheet = doc.querySelector('.ib-container');
            if (!sheet) return null;
            const top = Array.from(doc.querySelectorAll('.ib-container > tbody > tr > td[data-ib-block]')).map((el) => ({
                id: el.getAttribute('data-ib-block') ?? '',
                box: box(el),
            }));
            const columns = Array.from(doc.querySelectorAll('[data-ib-col]')).map((el) => {
                const raw = el.getAttribute('data-ib-col') ?? '';
                const cut = raw.lastIndexOf(':');
                return {
                    parentId: raw.slice(0, cut),
                    columnIndex: Number(raw.slice(cut + 1)),
                    box: box(el),
                    blocks: Array.from(el.querySelectorAll('[data-ib-block]')).map((b) => ({ id: b.getAttribute('data-ib-block') ?? '', box: box(b) })),
                };
            });
            return { sheet: box(sheet), top, columns };
        };
        const line = (): HTMLElement => {
            let el = doc.getElementById('ib-drop-line');
            if (!el) {
                el = doc.createElement('div');
                el.id = 'ib-drop-line';
                doc.body?.appendChild(el);
            }
            return el;
        };
        const hideLine = (): void => doc.getElementById('ib-drop-line')?.remove();
        let pending: DropResolution | null = null;

        const onDragStart = (e: DragEvent): void => {
            const el = (e.target as Element | null)?.closest?.('[data-ib-block]');
            const id = el?.getAttribute('data-ib-block');
            const d = cb.current.dnd;
            if (!el || !id || !d || id === '__signature') {
                e.preventDefault();
                return;
            }
            e.stopPropagation();
            e.dataTransfer?.setData('text/plain', '');
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            d.start({ kind: 'move', id });
            doc.getElementById('ib-toolbar')?.remove();
            // El "fantasma" del arrastre se saca ANTES de atenuar el bloque.
            window.setTimeout(() => el.setAttribute('data-ib-dragging', ''), 0);
        };
        const onDragOver = (e: DragEvent): void => {
            const d = cb.current.dnd;
            const src = d?.current();
            if (!d || !src) return;
            e.preventDefault();
            // Desplazamiento automático cerca de los bordes.
            if (e.clientY < 48) win.scrollBy(0, -14);
            else if (e.clientY > win.innerHeight - 48) win.scrollBy(0, 14);
            const g = geometry();
            pending = g ? d.resolve(e.clientX + win.scrollX, e.clientY + win.scrollY, g) : null;
            if (e.dataTransfer) e.dataTransfer.dropEffect = pending ? (src.kind === 'new' ? 'copy' : 'move') : 'none';
            if (!pending) {
                hideLine();
                return;
            }
            const l = line();
            l.style.top = `${pending.line.top}px`;
            l.style.left = `${pending.line.left}px`;
            l.style.width = `${pending.line.width}px`;
        };
        const onDragLeave = (e: DragEvent): void => {
            if (!e.relatedTarget) {
                hideLine();
                pending = null;
            }
        };
        const onDrop = (e: DragEvent): void => {
            e.preventDefault();
            hideLine();
            const d = cb.current.dnd;
            const target = pending?.target ?? null;
            pending = null;
            if (d && target) d.drop(target);
            d?.end();
        };
        const onDragEnd = (): void => {
            hideLine();
            doc.querySelectorAll('[data-ib-dragging]').forEach((el) => el.removeAttribute('data-ib-dragging'));
            cb.current.dnd?.end();
            placeToolbar();
        };

        // --- Clicks y teclado ------------------------------------------------
        const onClick = (e: Event): void => {
            e.preventDefault();
            const target = e.target as Element | null;
            const action = target?.closest?.('[data-ib-action]');
            if (action) {
                if (!action.hasAttribute('disabled')) cb.current.onAction?.(action.getAttribute('data-ib-action') as BlockAction);
                return;
            }
            const block = target?.closest?.('[data-ib-block]');
            cb.current.onSelect?.(block?.getAttribute('data-ib-block') ?? null);
        };
        const onKey = (e: KeyboardEvent): void => cb.current.onKeyDown?.(e);
        const onResize = (): void => placeToolbar();

        doc.addEventListener('click', onClick, true);
        doc.addEventListener('keydown', onKey);
        doc.addEventListener('dragstart', onDragStart);
        doc.addEventListener('dragover', onDragOver);
        doc.addEventListener('dragleave', onDragLeave);
        doc.addEventListener('drop', onDrop);
        doc.addEventListener('dragend', onDragEnd);
        win.addEventListener('resize', onResize);
        return () => {
            doc.removeEventListener('click', onClick, true);
            doc.removeEventListener('keydown', onKey);
            doc.removeEventListener('dragstart', onDragStart);
            doc.removeEventListener('dragover', onDragOver);
            doc.removeEventListener('dragleave', onDragLeave);
            doc.removeEventListener('drop', onDrop);
            doc.removeEventListener('dragend', onDragEnd);
            win.removeEventListener('resize', onResize);
        };
    }, [finalHtml, interactive]);

    // La barra cambia (p. ej. "Subir" deshabilitado) sin reescribir el documento.
    const toolbarKey = toolbar ? `${toolbar.label}|${toolbar.canUp}|${toolbar.canDown}` : '';
    useEffect(() => {
        const doc = ref.current?.contentDocument;
        if (!doc || !interactive) return;
        const bar = doc.getElementById('ib-toolbar');
        if (!toolbar) bar?.remove();
        else if (bar) {
            bar.querySelector('[data-ib-action="up"]')?.toggleAttribute('disabled', !toolbar.canUp);
            bar.querySelector('[data-ib-action="down"]')?.toggleAttribute('disabled', !toolbar.canDown);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [toolbarKey, interactive]);

    return (
        <iframe
            ref={ref}
            title={title}
            sandbox="allow-same-origin"
            data-testid="email-preview-frame"
            className={cn('imcrm-block imcrm-h-full imcrm-border-0', dark ? 'imcrm-bg-neutral-900' : 'imcrm-bg-white', className)}
            style={{ width: width ? `${width}px` : '100%', maxWidth: '100%' }}
        />
    );
}

/** Miniatura no interactiva (escala un render de 600px a `width`). */
export function EmailThumbnail({ html, width = 220, height = 150 }: { html: string; width?: number; height?: number }): JSX.Element {
    const scale = width / 660;
    return (
        <div
            className="imcrm-relative imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-white"
            style={{ width, height }}
            aria-hidden
        >
            <iframe
                title="Miniatura"
                sandbox=""
                srcDoc={localizeGoogleFonts(html, window.location.origin)}
                tabIndex={-1}
                className="imcrm-pointer-events-none imcrm-absolute imcrm-left-0 imcrm-top-0 imcrm-origin-top-left imcrm-border-0"
                style={{ width: 660, height: height / scale, transform: `scale(${scale})` }}
            />
        </div>
    );
}
