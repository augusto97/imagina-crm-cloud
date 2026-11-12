import { useEffect, useRef, useState } from 'react';
import { Menu, Monitor, MousePointerClick, Rocket, Save, Smartphone, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { buttonInk, defaultEmbedLabel, safeHex, type EmbedMode, type EmbedOpen } from './embedCode';

export type DemoDevice = 'desktop' | 'mobile';

/**
 * v0.1.381 — La demostración de «Insertar en tu sitio»: un sitio de ejemplo con
 * el formulario o la agenda REALES (la página publicada, con `imb_demo=1`: se
 * usa como de verdad pero nada se envía ni se cuenta). En la página va metido
 * en el contenido; con «Ventana al hacer clic» o «Botón flotante», tocar el
 * botón lo abre como lo hará en tu sitio (ventana, panel lateral o pantalla
 * completa). Los colores del sitio son fijos a propósito: es un ejemplo.
 *
 * v0.1.397 — Ocupa todo el alto disponible (`fill`) y se ve en un computador o
 * en un celular. En el celular la ventana y el panel lateral ocupan toda la
 * pantalla, igual que lo hace `embed.js` en un teléfono.
 */
export function EmbedDemo({
    kind,
    path,
    version,
    mode,
    open,
    position,
    label,
    color,
    bare,
    published,
    dirty,
    onPublish,
    onSave,
    busy,
    fill,
    testId,
    title,
}: {
    /** v0.1.419 — también la tienda (una página entera, con su propio scroll). */
    kind: 'form' | 'booking' | 'shop';
    /** La dirección pública SIN origen (`/api/v1/public/f/…`): la demo se carga del mismo origen de la app. */
    path: string;
    /** Cambia al guardar: la demo vuelve a cargar lo nuevo (y salta la caché del navegador). */
    version: string;
    mode: EmbedMode;
    open: EmbedOpen;
    position: 'left' | 'right';
    label: string;
    color: string;
    bare: boolean;
    published: boolean;
    dirty: boolean;
    onPublish?: () => void;
    onSave?: () => void;
    busy?: boolean;
    /** Llena el alto de su contenedor (en la computadora) en vez de una altura fija. */
    fill?: boolean;
    testId: string;
    /** v0.1.419 — El nombre (la barra de la ventana de la tienda). */
    title?: string;
}): JSX.Element {
    const [shown, setShown] = useState(false);
    // En pantallas angostas la demo ya es angosta: no hace falta elegir el aparato.
    const canPickDevice = useMediaQuery('(min-width: 1024px)');
    const [picked, setPicked] = useState<DemoDevice>('desktop');
    const device: DemoDevice = canPickDevice ? picked : 'desktop';
    // Cambiar la forma de insertar (o el aparato) cierra lo que estaba abierto.
    useEffect(() => setShown(false), [mode, open, position, device]);
    // Escape dentro de la ventana de la demostración la cierra, como en el sitio.
    useEffect(() => {
        if (!shown || mode === 'inline') return;
        const onMsg = (e: MessageEvent): void => {
            if (e.origin === window.location.origin && (e.data as { type?: unknown } | null)?.type === 'imb-popup-close') setShown(false);
        };
        window.addEventListener('message', onMsg);
        return () => window.removeEventListener('message', onMsg);
    }, [shown, mode]);
    const btnColor = safeHex(color);
    const btnLabel = label.trim() || defaultEmbedLabel(kind);
    const src = demoSrc(path, version, mode === 'inline' ? (bare ? 'bare' : 'card') : null);
    const what = kind === 'booking' ? __('la agenda') : kind === 'shop' ? __('la tienda') : __('el formulario');
    const shop = kind === 'shop';
    const phone = device === 'mobile';

    const site = (
        <div className="imcrm-relative imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-hidden">
            <div className="imcrm-absolute imcrm-inset-0 imcrm-overflow-y-auto" style={{ background: '#ffffff' }}>
                <SiteHeader phone={phone} />
                <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-3', phone ? 'imcrm-px-4 imcrm-py-4' : 'imcrm-px-6 imcrm-py-6')}>
                    <span className={cn('imcrm-font-bold', phone ? 'imcrm-text-base' : 'imcrm-text-lg')} style={{ color: '#111827' }}>
                        {kind === 'booking' ? __('Agenda tu cita con nosotros') : shop ? __('Compra en línea') : __('Contáctanos')}
                    </span>
                    <Bars widths={['88%', '72%']} />
                    {mode === 'popup' && (
                        <div>
                            <button
                                type="button"
                                onClick={() => setShown(true)}
                                className="imcrm-mt-1 imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-px-4 imcrm-py-2 imcrm-text-xs imcrm-font-semibold imcrm-shadow-sm imcrm-transition-transform hover:imcrm-scale-[1.03]"
                                style={{ background: btnColor, color: buttonInk(btnColor) }}
                                data-testid={`${testId}-demo-button`}
                            >
                                {btnLabel}
                            </button>
                        </div>
                    )}
                    {mode === 'inline' ? (
                        <div className="imcrm-mt-1 imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <span className="imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide" style={{ color: '#0369a1' }}>
                                {shop ? __('La tienda dentro de tu página') : bare ? __('Sin marco: ocupa todo el espacio') : __('Con su tarjeta')}
                            </span>
                            <div style={{ outline: '1px dashed #38bdf8' }}>
                                {published ? (
                                    <InlineFrame key={device} src={src} title={what} testId={`${testId}-demo-frame`} fixedHeight={shop ? (phone ? 560 : 640) : undefined} />
                                ) : (
                                    <Unpublished what={what} feminine={kind !== 'form'} onPublish={onPublish} busy={busy} testId={testId} />
                                )}
                            </div>
                        </div>
                    ) : (
                        <>
                            <Bars widths={['94%', '80%', '86%', '60%']} />
                            <div className={cn('imcrm-mt-2 imcrm-grid imcrm-gap-3', phone ? 'imcrm-grid-cols-2' : 'imcrm-grid-cols-3')} aria-hidden="true">
                                {(phone ? [0, 1] : [0, 1, 2]).map((i) => (
                                    <div key={i} className="imcrm-h-20 imcrm-rounded-lg" style={{ background: '#f3f4f6' }} />
                                ))}
                            </div>
                            <Bars widths={['76%', '90%', '66%']} />
                            {!shown && (
                                <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[11px]" style={{ color: '#6b7280' }}>
                                    <MousePointerClick className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {mode === 'float' ? __('Toca el botón de la esquina para probarlo.') : __('Toca el botón para probarlo.')}
                                </p>
                            )}
                        </>
                    )}
                    <Bars widths={['70%', '84%']} />
                </div>
            </div>
            {mode === 'float' && !shown && (
                <button
                    type="button"
                    onClick={() => setShown(true)}
                    className={cn(
                        'imcrm-absolute imcrm-bottom-3 imcrm-z-10 imcrm-inline-flex imcrm-items-center imcrm-rounded-full imcrm-px-4 imcrm-py-2.5 imcrm-text-xs imcrm-font-semibold imcrm-shadow-lg imcrm-transition-transform hover:imcrm-scale-[1.03]',
                        position === 'left' ? 'imcrm-left-3' : 'imcrm-right-3',
                    )}
                    style={{ background: btnColor, color: buttonInk(btnColor) }}
                    data-testid={`${testId}-demo-float`}
                >
                    {btnLabel}
                </button>
            )}
            {mode !== 'inline' && shown && (
                <Opened open={open} position={position} phone={phone} onClose={() => setShown(false)} testId={testId} shop={shop ? title?.trim() || __('Tienda') : null}>
                    {published ? (
                        <iframe
                            // En la ventana o el panel de embed.js la página se ve con su tarjeta.
                            name="imagina-popup"
                            src={src}
                            title={what}
                            className="imcrm-block imcrm-h-full imcrm-w-full imcrm-border-0"
                            data-testid={`${testId}-demo-frame`}
                        />
                    ) : (
                        <div className="imcrm-flex imcrm-h-full imcrm-items-center imcrm-justify-center imcrm-p-4">
                            <Unpublished what={what} feminine={kind !== 'form'} onPublish={onPublish} busy={busy} testId={testId} />
                        </div>
                    )}
                </Opened>
            )}
        </div>
    );

    return (
        <div
            className={cn('imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-2', fill && 'imcrm-h-full imcrm-min-h-0')}
            data-testid={`${testId}-demo`}
            data-mode={mode}
            data-open={mode === 'inline' ? undefined : open}
            data-device={device}
        >
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1.5">
                <p className="imcrm-text-sm imcrm-font-medium">{__('Vista previa')}</p>
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Funciona de verdad, pero nada se envía.')}</span>
                {canPickDevice && (
                    <div role="radiogroup" aria-label={__('Ver en')} className="imcrm-ml-auto imcrm-inline-flex imcrm-rounded-lg imcrm-bg-muted imcrm-p-0.5" data-testid={`${testId}-demo-device`}>
                        {([
                            { id: 'desktop', label: __('Computador'), icon: Monitor },
                            { id: 'mobile', label: __('Celular'), icon: Smartphone },
                        ] as const).map((d) => {
                            const on = picked === d.id;
                            const Icon = d.icon;
                            return (
                                <button
                                    key={d.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={on}
                                    onClick={() => setPicked(d.id)}
                                    className={cn(
                                        'imcrm-inline-flex imcrm-h-7 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-px-2.5 imcrm-text-xs imcrm-transition-colors',
                                        on ? 'imcrm-bg-card imcrm-font-medium imcrm-text-foreground imcrm-shadow-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                                    )}
                                    data-testid={`${testId}-demo-device-${d.id}`}
                                >
                                    <Icon className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {d.label}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
            <div
                className={cn(
                    'imcrm-relative imcrm-flex imcrm-min-h-0 imcrm-justify-center imcrm-overflow-hidden imcrm-rounded-xl imcrm-bg-muted/60 imcrm-ring-1 imcrm-ring-inset imcrm-ring-border',
                    fill ? 'imcrm-flex-1' : 'imcrm-h-[540px]',
                    phone ? 'imcrm-items-center imcrm-p-4' : 'imcrm-items-stretch imcrm-p-3 sm:imcrm-p-4',
                )}
            >
                {dirty && published && (
                    <div
                        className="imcrm-absolute imcrm-left-1/2 imcrm-top-2 imcrm-z-30 imcrm-flex imcrm-w-[min(92%,460px)] -imcrm-translate-x-1/2 imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-warning/40 imcrm-bg-card imcrm-px-3 imcrm-py-1.5 imcrm-text-[11px] imcrm-shadow-md"
                        data-testid={`${testId}-demo-dirty`}
                    >
                        <span className="imcrm-h-2 imcrm-w-2 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-warning" />
                        <span className="imcrm-min-w-0 imcrm-flex-1">{__('Tienes cambios sin guardar: aquí se ve lo último que guardaste.')}</span>
                        {onSave && (
                            <Button size="sm" variant="outline" className="imcrm-h-7 imcrm-shrink-0 imcrm-gap-1 imcrm-text-xs" onClick={onSave} disabled={busy}>
                                <Save className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Guardar')}
                            </Button>
                        )}
                    </div>
                )}
                {phone ? (
                    <div
                        className="imcrm-flex imcrm-h-full imcrm-max-h-[760px] imcrm-w-[min(100%,360px)] imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-[28px] imcrm-shadow-xl"
                        style={{ background: '#ffffff', color: '#1f2937', border: '7px solid #1f2937' }}
                    >
                        <PhoneBar />
                        {site}
                    </div>
                ) : (
                    <div className="imcrm-flex imcrm-w-full imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-lg imcrm-shadow-lg imcrm-ring-1 imcrm-ring-black/5" style={{ background: '#ffffff', color: '#1f2937' }}>
                        <BrowserBar />
                        {site}
                    </div>
                )}
            </div>
        </div>
    );
}

/** La dirección de la demo: misma página publicada, marcada para no enviar ni contar nada. */
export function demoSrc(path: string, version: string, style: 'bare' | 'card' | null): string {
    const q = new URLSearchParams({ imb_demo: '1', v: version });
    if (style) q.set('imb_style', style);
    return `${path}${path.includes('?') ? '&' : '?'}${q.toString()}`;
}

/**
 * Insertado en la página: crece con el contenido, como lo hace `embed.js` en tu
 * sitio. La tienda no crece: va con un alto fijo y su propio scroll.
 */
function InlineFrame({ src, title, testId, fixedHeight }: { src: string; title: string; testId: string; fixedHeight?: number }): JSX.Element {
    const ref = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(fixedHeight ?? 480);
    useEffect(() => {
        if (fixedHeight) return;
        const onMessage = (e: MessageEvent): void => {
            if (e.source !== ref.current?.contentWindow) return;
            const d = e.data as { type?: string; height?: number } | null;
            if (d?.type === 'imb-form-height' && typeof d.height === 'number' && Number.isFinite(d.height)) {
                setHeight(Math.min(2400, Math.max(160, Math.ceil(d.height))));
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [fixedHeight]);
    return (
        <iframe
            ref={ref}
            src={src}
            title={title}
            className="imcrm-block imcrm-w-full imcrm-border-0"
            style={{ height: fixedHeight ?? height, background: 'transparent' }}
            data-testid={testId}
        />
    );
}

function Opened({
    open,
    position,
    phone,
    onClose,
    testId,
    shop,
    children,
}: {
    open: EmbedOpen;
    position: 'left' | 'right';
    /** En un teléfono `embed.js` abre la ventana y el panel a pantalla completa. */
    phone: boolean;
    onClose: () => void;
    testId: string;
    /**
     * v0.1.419 — La tienda: `embed.js` la abre más ancha y alta, con una barra
     * arriba (título y X) para no tapar el carrito del encabezado de la tienda.
     */
    shop?: string | null;
    children: React.ReactNode;
}): JSX.Element {
    const close = (
        <button
            type="button"
            aria-label={__('Cerrar')}
            onClick={onClose}
            className="imcrm-absolute imcrm-right-2 imcrm-top-2 imcrm-z-10 imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-shadow"
            style={{ background: '#ffffff', color: '#374151' }}
            data-testid={`${testId}-demo-close`}
        >
            <X className="imcrm-h-4 imcrm-w-4" />
        </button>
    );
    const body = shop ? (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col">
            <div className="imcrm-flex imcrm-h-10 imcrm-shrink-0 imcrm-items-center imcrm-gap-2 imcrm-pl-3 imcrm-pr-1.5" style={{ borderBottom: '1px solid #e5e7eb', color: '#111827' }}>
                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-xs imcrm-font-semibold">{shop}</span>
                <button
                    type="button"
                    aria-label={__('Cerrar')}
                    onClick={onClose}
                    className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-full hover:imcrm-bg-black/5"
                    style={{ color: '#374151' }}
                    data-testid={`${testId}-demo-close`}
                >
                    <X className="imcrm-h-4 imcrm-w-4" />
                </button>
            </div>
            <div className="imcrm-min-h-0 imcrm-flex-1">{children}</div>
        </div>
    ) : (
        <>
            {close}
            {children}
        </>
    );
    if (open === 'full' || (phone && open === 'window')) {
        return (
            <div className="imcrm-absolute imcrm-inset-0 imcrm-z-20 imcrm-animate-in imcrm-fade-in" style={{ background: '#ffffff' }} data-testid={`${testId}-demo-opened`} data-open={open}>
                {body}
            </div>
        );
    }
    return (
        <div className="imcrm-absolute imcrm-inset-0 imcrm-z-20" data-testid={`${testId}-demo-opened`} data-open={open}>
            <button type="button" aria-label={__('Cerrar')} className="imcrm-absolute imcrm-inset-0 imcrm-animate-in imcrm-fade-in" style={{ background: 'rgba(15,23,42,0.45)' }} onClick={onClose} />
            {open === 'side' ? (
                <div
                    className={cn(
                        'imcrm-absolute imcrm-bottom-0 imcrm-top-0 imcrm-overflow-hidden imcrm-shadow-2xl imcrm-animate-in imcrm-duration-300',
                        phone ? 'imcrm-w-full' : shop ? 'imcrm-w-[min(88%,500px)]' : 'imcrm-w-[min(88%,420px)]',
                        position === 'left' ? 'imcrm-left-0 imcrm-slide-in-from-left-full' : 'imcrm-right-0 imcrm-slide-in-from-right-full',
                    )}
                    style={{ background: '#ffffff' }}
                >
                    {body}
                </div>
            ) : (
                // Centrada con flex (no con translate: la animación de entrada pisaría el transform).
                <div className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-0 imcrm-flex imcrm-items-center imcrm-justify-center">
                    <div
                        className={cn(
                            'imcrm-pointer-events-auto imcrm-relative imcrm-overflow-hidden imcrm-rounded-xl imcrm-shadow-2xl imcrm-animate-in imcrm-zoom-in-95',
                            shop ? 'imcrm-h-[92%] imcrm-w-[min(96%,880px)]' : 'imcrm-h-[88%] imcrm-w-[min(92%,560px)]',
                        )}
                        style={{ background: '#ffffff' }}
                    >
                        {body}
                    </div>
                </div>
            )}
        </div>
    );
}

function Unpublished({ what, feminine, onPublish, busy, testId }: { what: string; feminine?: boolean; onPublish?: () => void; busy?: boolean; testId: string }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-px-4 imcrm-py-8 imcrm-text-center" data-testid={`${testId}-demo-unpublished`}>
            <Rocket className="imcrm-h-6 imcrm-w-6" style={{ color: '#0369a1' }} />
            <p className="imcrm-text-sm imcrm-font-semibold" style={{ color: '#111827' }}>
                {feminine ? __('Todavía no está publicada') : __('Todavía no está publicado')}
            </p>
            <p className="imcrm-max-w-xs imcrm-text-xs" style={{ color: '#6b7280' }}>
                {(feminine ? __('Publica %s para verla aquí tal como la verá la gente en tu sitio.') : __('Publica %s para verlo aquí tal como lo verá la gente en tu sitio.')).replace('%s', what)}
            </p>
            {onPublish && (
                <Button size="sm" onClick={onPublish} disabled={busy}>
                    {__('Publicar ahora')}
                </Button>
            )}
        </div>
    );
}

function BrowserBar(): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2" style={{ background: '#f1f3f5', borderBottom: '1px solid #e5e7eb' }} aria-hidden="true">
            <span className="imcrm-flex imcrm-gap-1">
                <span className="imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-full" style={{ background: '#f87171' }} />
                <span className="imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-full" style={{ background: '#fbbf24' }} />
                <span className="imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-full" style={{ background: '#34d399' }} />
            </span>
            <span className="imcrm-mx-auto imcrm-w-[min(60%,320px)] imcrm-truncate imcrm-rounded-md imcrm-px-2 imcrm-py-0.5 imcrm-text-center imcrm-text-[11px]" style={{ background: '#ffffff', color: '#6b7280' }}>
                tusitio.com
            </span>
            <span className="imcrm-w-[42px]" />
        </div>
    );
}

function PhoneBar(): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-shrink-0 imcrm-flex-col imcrm-gap-1.5 imcrm-px-3 imcrm-pb-2 imcrm-pt-1.5" style={{ background: '#f1f3f5', borderBottom: '1px solid #e5e7eb' }} aria-hidden="true">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-px-1 imcrm-text-[10px] imcrm-font-semibold" style={{ color: '#111827' }}>
                <span>9:41</span>
                <span className="imcrm-h-1.5 imcrm-w-12 imcrm-rounded-full" style={{ background: '#1f2937' }} />
                <span className="imcrm-flex imcrm-gap-0.5">
                    <span className="imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full" style={{ background: '#111827' }} />
                    <span className="imcrm-h-1.5 imcrm-w-3 imcrm-rounded-sm" style={{ background: '#111827' }} />
                </span>
            </div>
            <span className="imcrm-truncate imcrm-rounded-md imcrm-px-2 imcrm-py-0.5 imcrm-text-center imcrm-text-[11px]" style={{ background: '#ffffff', color: '#6b7280' }}>
                tusitio.com
            </span>
        </div>
    );
}

function SiteHeader({ phone }: { phone: boolean }): JSX.Element {
    return (
        <div className={cn('imcrm-flex imcrm-items-center imcrm-gap-3', phone ? 'imcrm-px-4 imcrm-py-2.5' : 'imcrm-px-6 imcrm-py-3')} style={{ borderBottom: '1px solid #f1f3f5' }} aria-hidden="true">
            <span className="imcrm-h-6 imcrm-w-6 imcrm-rounded-md" style={{ background: '#1f2937' }} />
            <span className="imcrm-text-sm imcrm-font-semibold" style={{ color: '#111827' }}>
                {__('Tu negocio')}
            </span>
            {phone ? (
                <Menu className="imcrm-ml-auto imcrm-h-4 imcrm-w-4" style={{ color: '#374151' }} />
            ) : (
                <span className="imcrm-ml-auto imcrm-flex imcrm-gap-3">
                    {[44, 52, 40].map((w) => (
                        <span key={w} className="imcrm-h-2 imcrm-rounded" style={{ width: w, background: '#e5e7eb' }} />
                    ))}
                </span>
            )}
        </div>
    );
}

function Bars({ widths }: { widths: string[] }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" aria-hidden="true">
            {widths.map((w, i) => (
                <span key={i} className="imcrm-h-2 imcrm-rounded" style={{ width: w, background: '#e5e7eb' }} />
            ))}
        </div>
    );
}

/**
 * Una huella corta de lo guardado: cambia cuando se guarda algo, así la
 * demostración no muestra la página vieja que el navegador tenía en caché.
 */
export function demoVersion(value: unknown): string {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}
