import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Monitor, Smartphone } from 'lucide-react';
import type { PublicWidgetMeta } from '@imagina-base/shared';

import { IconToggleGroup, PanelSegments, PreviewToolbar } from '@/admin/builder/BuilderShell';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { PREVIEW_HOST } from './widgetEditor';

export type PreviewDevice = 'desktop' | 'mobile';

/** v0.1.408 — Con menos de esto el widget se arma como en un celular. */
const DESKTOP_MIN_WIDTH = 1024;

/**
 * v0.1.394 (ADR-S99) — La vista previa del widget: la página REAL del widget
 * (`/public/w/preview`) sobre un sitio de ejemplo, en computador o celular.
 * El diseño le llega por mensaje (`imb-w-preview`), así se ve al instante lo
 * que se edita, sin guardar.
 *
 * v0.1.408 — Llena su columna (a todo el alto) y, en «Computador», el widget
 * se arma SIEMPRE como en una computadora: antes, con la vista previa más
 * angosta que 640 px, el widget se creía en un celular y el panel ocupaba
 * todo el ancho.
 */
export function WidgetPreview({
    meta,
    showClosed = false,
    compact = false,
    initialDevice = 'desktop',
}: {
    meta: PublicWidgetMeta;
    showClosed?: boolean;
    /** En el celular: los controles en dos renglones, sin la explicación. */
    compact?: boolean;
    initialDevice?: PreviewDevice;
}): JSX.Element {
    const [device, setDevice] = useState<PreviewDevice>(initialDevice);
    const [open, setOpen] = useState(true);
    // v0.1.396 — el saludo sólo se ve con el widget cerrado: al editarlo, se muestra cerrado.
    useEffect(() => {
        if (showClosed) setOpen(false);
    }, [showClosed]);
    /** v0.1.395 — con horario: ver cómo queda ahora, en horario o fuera de horario. */
    const [hoursView, setHoursView] = useState<'now' | 'open' | 'closed'>('now');
    const hoursOpen = !meta.hours || hoursView === 'now' ? null : hoursView === 'open';
    const frame = useRef<HTMLIFrameElement | null>(null);
    const box = useRef<HTMLDivElement | null>(null);
    const [ready, setReady] = useState(false);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useLayoutEffect(() => {
        const el = box.current;
        if (!el) return;
        const measure = (): void => setSize({ width: el.clientWidth, height: el.clientHeight });
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [device]);

    useEffect(() => {
        const onMsg = (e: MessageEvent): void => {
            if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
            const d = e.data as { type?: unknown } | null;
            if (d && d.type === 'imb-w-ready') setReady(true);
        };
        window.addEventListener('message', onMsg);
        return () => window.removeEventListener('message', onMsg);
    }, []);

    const mobile = device === 'mobile';
    // Lo que se edita llega con una pausa corta: escribir no rearma el widget en cada tecla.
    useEffect(() => {
        if (!ready || size.width === 0) return;
        const width = mobile ? size.width : Math.max(size.width, DESKTOP_MIN_WIDTH);
        const t = window.setTimeout(() => {
            frame.current?.contentWindow?.postMessage(
                { type: 'imb-w-preview', meta, open, hours_open: hoursOpen, host: { ...PREVIEW_HOST, width, height: size.height } },
                window.location.origin,
            );
        }, 180);
        return () => window.clearTimeout(t);
    }, [ready, meta, open, hoursOpen, size.width, size.height, mobile]);

    const controls = (
        <>
                {meta.hours && (
                    <div className="imcrm-w-[244px]" data-testid="widget-preview-hours">
                        <PanelSegments<'now' | 'open' | 'closed'>
                            value={hoursView}
                            onChange={setHoursView}
                            options={[
                                { id: 'now', label: __('Ahora') },
                                { id: 'open', label: __('En horario') },
                                { id: 'closed', label: __('Fuera') },
                            ]}
                        />
                    </div>
                )}
                <div className="imcrm-w-[150px]">
                    <PanelSegments<'open' | 'closed'>
                        value={open ? 'open' : 'closed'}
                        onChange={(v) => setOpen(v === 'open')}
                        testId="widget-preview-open"
                        options={[
                            { id: 'closed', label: __('Cerrado') },
                            { id: 'open', label: __('Abierto') },
                        ]}
                    />
                </div>
                <IconToggleGroup<PreviewDevice>
                    label={__('Ver en')}
                    value={device}
                    onChange={setDevice}
                    testId="widget-preview-device"
                    options={[
                        { id: 'desktop', label: __('Computador'), icon: Monitor },
                        { id: 'mobile', label: __('Celular'), icon: Smartphone },
                    ]}
                />
        </>
    );
    return (
        <div className="imcrm-flex imcrm-h-full imcrm-min-h-0 imcrm-flex-col imcrm-bg-canvas" data-testid="widget-preview" data-tour="widget-preview">
            {compact ? (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-px-3 imcrm-py-2.5">{controls}</div>
            ) : (
                <PreviewToolbar hint={__('así se ve en tu sitio (los botones se pueden tocar)')}>{controls}</PreviewToolbar>
            )}
            <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-px-4 imcrm-pb-4 sm:imcrm-px-5 sm:imcrm-pb-5">
                <div
                    className={cn(
                        'imcrm-relative imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-bg-white imcrm-shadow-imcrm-md',
                        mobile
                            ? 'imcrm-aspect-[9/19] imcrm-h-full imcrm-max-h-[720px] imcrm-max-w-full imcrm-rounded-[34px] imcrm-border-[7px] imcrm-border-neutral-900'
                            : 'imcrm-h-full imcrm-w-full imcrm-max-w-[1100px] imcrm-rounded-xl imcrm-border imcrm-border-border',
                    )}
                >
                    {mobile ? (
                        <div className="imcrm-flex imcrm-h-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-bg-white">
                            <span className="imcrm-h-1.5 imcrm-w-16 imcrm-rounded-full imcrm-bg-neutral-900" aria-hidden />
                        </div>
                    ) : (
                        <div className="imcrm-flex imcrm-h-9 imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5 imcrm-border-b imcrm-border-slate-200 imcrm-bg-slate-100 imcrm-px-3">
                            <span className="imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-full imcrm-bg-[#ff5f57]" />
                            <span className="imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-full imcrm-bg-[#febc2e]" />
                            <span className="imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-full imcrm-bg-[#28c840]" />
                            <span className="imcrm-ml-3 imcrm-flex imcrm-h-6 imcrm-max-w-[360px] imcrm-flex-1 imcrm-items-center imcrm-truncate imcrm-rounded-md imcrm-bg-white imcrm-px-2.5 imcrm-text-[11px] imcrm-text-slate-500">
                                tusitio.com/planes
                            </span>
                        </div>
                    )}
                    <div ref={box} className="imcrm-relative imcrm-min-h-0 imcrm-flex-1">
                        <MockSite mobile={mobile} />
                        <iframe
                            ref={frame}
                            title={__('Vista previa del widget')}
                            src="/api/v1/public/w/preview"
                            className="imcrm-absolute imcrm-inset-0 imcrm-h-full imcrm-w-full imcrm-border-0"
                            style={{ background: 'transparent', colorScheme: 'normal' }}
                            data-testid="widget-preview-frame"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

/** Una página de ejemplo detrás del widget (siempre clara: es «tu sitio»). */
function MockSite({ mobile }: { mobile: boolean }): JSX.Element {
    return (
        <div className="imcrm-absolute imcrm-inset-0 imcrm-overflow-hidden imcrm-bg-white" aria-hidden>
            <div className={cn('imcrm-flex imcrm-items-center imcrm-justify-between imcrm-border-b imcrm-border-slate-100', mobile ? 'imcrm-px-4 imcrm-py-3' : 'imcrm-px-8 imcrm-py-4')}>
                <span className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <span className="imcrm-h-6 imcrm-w-6 imcrm-rounded-md imcrm-bg-slate-800" />
                    <span className="imcrm-h-3 imcrm-w-16 imcrm-rounded imcrm-bg-slate-800/80" />
                </span>
                {mobile ? (
                    <span className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <span className="imcrm-h-0.5 imcrm-w-5 imcrm-rounded imcrm-bg-slate-400" />
                        <span className="imcrm-h-0.5 imcrm-w-5 imcrm-rounded imcrm-bg-slate-400" />
                        <span className="imcrm-h-0.5 imcrm-w-5 imcrm-rounded imcrm-bg-slate-400" />
                    </span>
                ) : (
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-5">
                        <span className="imcrm-h-2 imcrm-w-12 imcrm-rounded imcrm-bg-slate-200" />
                        <span className="imcrm-h-2 imcrm-w-12 imcrm-rounded imcrm-bg-slate-200" />
                        <span className="imcrm-h-2 imcrm-w-12 imcrm-rounded imcrm-bg-slate-200" />
                        <span className="imcrm-h-7 imcrm-w-20 imcrm-rounded-md imcrm-bg-slate-800" />
                    </span>
                )}
            </div>
            <div className={cn('imcrm-grid imcrm-items-center imcrm-gap-8', mobile ? 'imcrm-px-4 imcrm-py-6' : 'imcrm-grid-cols-[1.1fr_1fr] imcrm-px-8 imcrm-py-10')}>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    <span className="imcrm-h-2.5 imcrm-w-24 imcrm-rounded-full imcrm-bg-slate-200" />
                    <span className="imcrm-h-6 imcrm-w-11/12 imcrm-rounded imcrm-bg-slate-800/90" />
                    <span className="imcrm-h-6 imcrm-w-3/5 imcrm-rounded imcrm-bg-slate-800/90" />
                    <span className="imcrm-mt-2 imcrm-h-2.5 imcrm-w-full imcrm-rounded imcrm-bg-slate-200" />
                    <span className="imcrm-h-2.5 imcrm-w-10/12 imcrm-rounded imcrm-bg-slate-200" />
                    <span className="imcrm-mt-3 imcrm-flex imcrm-gap-2">
                        <span className="imcrm-h-9 imcrm-w-28 imcrm-rounded-lg imcrm-bg-slate-800" />
                        <span className="imcrm-h-9 imcrm-w-24 imcrm-rounded-lg imcrm-border imcrm-border-slate-300" />
                    </span>
                </div>
                {!mobile && <span className="imcrm-h-44 imcrm-rounded-2xl imcrm-bg-gradient-to-br imcrm-from-slate-100 imcrm-to-slate-200" />}
            </div>
            <div className={cn('imcrm-grid imcrm-gap-3', mobile ? 'imcrm-grid-cols-2 imcrm-px-4' : 'imcrm-grid-cols-3 imcrm-px-8')}>
                {[0, 1, 2].map((i) => (
                    <span key={i} className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-slate-100 imcrm-p-3', mobile && i === 2 && 'imcrm-hidden')}>
                        <span className="imcrm-h-16 imcrm-rounded-lg imcrm-bg-slate-100" />
                        <span className="imcrm-h-2.5 imcrm-w-3/4 imcrm-rounded imcrm-bg-slate-300" />
                        <span className="imcrm-h-2 imcrm-w-1/2 imcrm-rounded imcrm-bg-slate-200" />
                    </span>
                ))}
            </div>
        </div>
    );
}
