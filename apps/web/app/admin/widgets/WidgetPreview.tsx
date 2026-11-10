import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Monitor, Smartphone } from 'lucide-react';
import type { PublicWidgetMeta } from '@imagina-base/shared';

import { Segmented } from '@/admin/records/layout/editor/inspectorUi';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { PREVIEW_HOST } from './widgetEditor';

export type PreviewDevice = 'desktop' | 'mobile';

/**
 * v0.1.394 (ADR-S99) — La vista previa del widget: la página REAL del widget
 * (`/public/w/preview`) sobre un sitio de ejemplo, en computador o celular.
 * El diseño le llega por mensaje (`imb-w-preview`), así se ve al instante lo
 * que se edita, sin guardar.
 */
export function WidgetPreview({ meta }: { meta: PublicWidgetMeta }): JSX.Element {
    const [device, setDevice] = useState<PreviewDevice>('desktop');
    const [open, setOpen] = useState(true);
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

    // Lo que se edita llega con una pausa corta: escribir no rearma el widget en cada tecla.
    useEffect(() => {
        if (!ready || size.width === 0) return;
        const t = window.setTimeout(() => {
            frame.current?.contentWindow?.postMessage(
                { type: 'imb-w-preview', meta, open, hours_open: hoursOpen, host: { ...PREVIEW_HOST, width: size.width, height: size.height } },
                window.location.origin,
            );
        }, 180);
        return () => window.clearTimeout(t);
    }, [ready, meta, open, hoursOpen, size.width, size.height]);

    const mobile = device === 'mobile';
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="widget-preview" data-tour="widget-preview">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-w-56">
                    <Segmented<PreviewDevice>
                        ariaLabel={__('Ver en')}
                        value={device}
                        onChange={setDevice}
                        options={[
                            { value: 'desktop', label: __('Computador'), icon: <Monitor /> },
                            { value: 'mobile', label: __('Celular'), icon: <Smartphone /> },
                        ]}
                    />
                </div>
                <div className="imcrm-w-48">
                    <Segmented<'open' | 'closed'>
                        ariaLabel={__('Panel')}
                        value={open ? 'open' : 'closed'}
                        onChange={(v) => setOpen(v === 'open')}
                        options={[
                            { value: 'closed', label: __('Cerrado') },
                            { value: 'open', label: __('Abierto') },
                        ]}
                    />
                </div>
                {meta.hours && (
                    <div className="imcrm-w-full sm:imcrm-w-80" data-testid="widget-preview-hours">
                        <Segmented<'now' | 'open' | 'closed'>
                            ariaLabel={__('Horario')}
                            value={hoursView}
                            onChange={setHoursView}
                            options={[
                                { value: 'now', label: __('Ahora') },
                                { value: 'open', label: __('En horario') },
                                { value: 'closed', label: __('Fuera de horario') },
                            ]}
                        />
                    </div>
                )}
            </div>
            <div className={cn('imcrm-mx-auto imcrm-w-full', mobile && 'imcrm-max-w-[375px]')}>
                <div
                    className={cn(
                        'imcrm-relative imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-white imcrm-shadow-imcrm-sm',
                        mobile ? 'imcrm-h-[640px] imcrm-rounded-[28px] imcrm-border-[6px] imcrm-border-foreground/80' : 'imcrm-h-[560px]',
                    )}
                >
                    {!mobile && (
                        <div className="imcrm-flex imcrm-h-8 imcrm-items-center imcrm-gap-1.5 imcrm-border-b imcrm-border-slate-200 imcrm-bg-slate-100 imcrm-px-3">
                            <span className="imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-full imcrm-bg-slate-300" />
                            <span className="imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-full imcrm-bg-slate-300" />
                            <span className="imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-full imcrm-bg-slate-300" />
                            <span className="imcrm-ml-3 imcrm-truncate imcrm-rounded imcrm-bg-white imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-text-slate-500">
                                tusitio.com/planes
                            </span>
                        </div>
                    )}
                    <div ref={box} className={cn('imcrm-absolute imcrm-inset-x-0 imcrm-bottom-0', mobile ? 'imcrm-top-0' : 'imcrm-top-8')}>
                        <MockSite />
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
            <p className="imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                {__('Así se ve en tu sitio. Puedes tocar los botones: un formulario o la agenda se abren de prueba (no se guarda nada).')}
            </p>
        </div>
    );
}

/** Una página de ejemplo detrás del widget (siempre clara: es «tu sitio»). */
function MockSite(): JSX.Element {
    return (
        <div className="imcrm-absolute imcrm-inset-0 imcrm-overflow-hidden imcrm-bg-white imcrm-p-5" aria-hidden>
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                <span className="imcrm-h-4 imcrm-w-20 imcrm-rounded imcrm-bg-slate-800" />
                <div className="imcrm-flex imcrm-gap-2">
                    <span className="imcrm-h-2.5 imcrm-w-10 imcrm-rounded imcrm-bg-slate-200" />
                    <span className="imcrm-h-2.5 imcrm-w-10 imcrm-rounded imcrm-bg-slate-200" />
                    <span className="imcrm-h-2.5 imcrm-w-10 imcrm-rounded imcrm-bg-slate-200" />
                </div>
            </div>
            <div className="imcrm-mt-10 imcrm-flex imcrm-max-w-md imcrm-flex-col imcrm-gap-3">
                <span className="imcrm-h-6 imcrm-w-4/5 imcrm-rounded imcrm-bg-slate-800/90" />
                <span className="imcrm-h-6 imcrm-w-3/5 imcrm-rounded imcrm-bg-slate-800/90" />
                <span className="imcrm-mt-2 imcrm-h-2.5 imcrm-w-full imcrm-rounded imcrm-bg-slate-200" />
                <span className="imcrm-h-2.5 imcrm-w-11/12 imcrm-rounded imcrm-bg-slate-200" />
                <span className="imcrm-h-2.5 imcrm-w-3/4 imcrm-rounded imcrm-bg-slate-200" />
                <span className="imcrm-mt-3 imcrm-h-9 imcrm-w-32 imcrm-rounded-lg imcrm-bg-slate-300" />
            </div>
            <div className="imcrm-mt-10 imcrm-grid imcrm-grid-cols-3 imcrm-gap-3">
                <span className="imcrm-h-24 imcrm-rounded-lg imcrm-bg-slate-100" />
                <span className="imcrm-h-24 imcrm-rounded-lg imcrm-bg-slate-100" />
                <span className="imcrm-h-24 imcrm-rounded-lg imcrm-bg-slate-100" />
            </div>
        </div>
    );
}
