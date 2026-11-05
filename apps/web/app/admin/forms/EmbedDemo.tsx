import { useEffect, useRef, useState } from 'react';
import { MousePointerClick, Rocket, Save, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { buttonInk, defaultEmbedLabel, safeHex, type EmbedMode, type EmbedOpen } from './embedCode';

/**
 * v0.1.381 — La demostración de «Insertar en tu sitio»: un sitio de ejemplo con
 * el formulario o la agenda REALES (la página publicada, con `imb_demo=1`: se
 * usa como de verdad pero nada se envía ni se cuenta). En la página va metido
 * en el contenido; con «Ventana al hacer clic» o «Botón flotante», tocar el
 * botón lo abre como lo hará en tu sitio (ventana, panel lateral o pantalla
 * completa). Los colores del sitio son fijos a propósito: es un ejemplo.
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
    testId,
}: {
    kind: 'form' | 'booking';
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
    testId: string;
}): JSX.Element {
    const [shown, setShown] = useState(false);
    // Cambiar la forma de insertar cierra lo que estaba abierto.
    useEffect(() => setShown(false), [mode, open, position]);
    const btnColor = safeHex(color);
    const btnLabel = label.trim() || defaultEmbedLabel(kind);
    const src = demoSrc(path, version, mode === 'inline' ? (bare ? 'bare' : 'card') : null);
    const what = kind === 'booking' ? __('la agenda') : __('el formulario');

    return (
        <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-2" data-testid={`${testId}-demo`} data-mode={mode} data-open={mode === 'inline' ? undefined : open}>
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <p className="imcrm-text-xs imcrm-font-medium">{__('Así se ve en un sitio')}</p>
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Demostración: nada se envía')}</span>
            </div>
            {dirty && published && (
                <div
                    className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-px-2.5 imcrm-py-1.5 imcrm-text-[11px]"
                    data-testid={`${testId}-demo-dirty`}
                >
                    <span className="imcrm-min-w-0 imcrm-flex-1">{__('Tienes cambios sin guardar: la demostración muestra lo último que guardaste.')}</span>
                    {onSave && (
                        <Button size="sm" variant="outline" className="imcrm-h-7 imcrm-gap-1 imcrm-text-xs" onClick={onSave} disabled={busy}>
                            <Save className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Guardar')}
                        </Button>
                    )}
                </div>
            )}
            <div
                className="imcrm-flex imcrm-h-[min(64dvh,560px)] imcrm-min-h-[420px] imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-shadow-sm"
                style={{ background: '#ffffff', color: '#1f2937' }}
            >
                <BrowserBar />
                {/* La ventana del navegador: lo que se abre (ventana, panel) queda adentro. */}
                <div className="imcrm-relative imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-hidden">
                    <div className="imcrm-absolute imcrm-inset-0 imcrm-overflow-y-auto" style={{ background: '#ffffff' }}>
                        <SiteHeader />
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-px-5 imcrm-py-5">
                            <span className="imcrm-text-lg imcrm-font-bold" style={{ color: '#111827' }}>
                                {kind === 'booking' ? __('Agenda tu cita con nosotros') : __('Contáctanos')}
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
                                        {bare ? __('Sin marco: ocupa todo el espacio') : __('Con su tarjeta')}
                                    </span>
                                    <div style={{ outline: '1px dashed #38bdf8' }}>
                                        {published ? (
                                            <InlineFrame src={src} title={what} testId={`${testId}-demo-frame`} />
                                        ) : (
                                            <Unpublished what={what} onPublish={onPublish} busy={busy} testId={testId} />
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <Bars widths={['94%', '80%', '86%', '60%']} />
                                    <div className="imcrm-mt-2 imcrm-grid imcrm-grid-cols-3 imcrm-gap-3" aria-hidden="true">
                                        {[0, 1, 2].map((i) => (
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
                        <Opened open={open} position={position} onClose={() => setShown(false)} testId={testId}>
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
                                    <Unpublished what={what} onPublish={onPublish} busy={busy} testId={testId} />
                                </div>
                            )}
                        </Opened>
                    )}
                </div>
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

/** Insertado en la página: crece con el contenido, como lo hace `embed.js` en tu sitio. */
function InlineFrame({ src, title, testId }: { src: string; title: string; testId: string }): JSX.Element {
    const ref = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(480);
    useEffect(() => {
        const onMessage = (e: MessageEvent): void => {
            if (e.source !== ref.current?.contentWindow) return;
            const d = e.data as { type?: string; height?: number } | null;
            if (d?.type === 'imb-form-height' && typeof d.height === 'number' && Number.isFinite(d.height)) {
                setHeight(Math.min(2400, Math.max(160, Math.ceil(d.height))));
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, []);
    return (
        <iframe
            ref={ref}
            src={src}
            title={title}
            className="imcrm-block imcrm-w-full imcrm-border-0"
            style={{ height, background: 'transparent' }}
            data-testid={testId}
        />
    );
}

function Opened({
    open,
    position,
    onClose,
    testId,
    children,
}: {
    open: EmbedOpen;
    position: 'left' | 'right';
    onClose: () => void;
    testId: string;
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
    if (open === 'full') {
        return (
            <div className="imcrm-absolute imcrm-inset-0 imcrm-z-20 imcrm-animate-in imcrm-fade-in" style={{ background: '#ffffff' }} data-testid={`${testId}-demo-opened`} data-open="full">
                {close}
                {children}
            </div>
        );
    }
    return (
        <div className="imcrm-absolute imcrm-inset-0 imcrm-z-20" data-testid={`${testId}-demo-opened`} data-open={open}>
            <button type="button" aria-label={__('Cerrar')} className="imcrm-absolute imcrm-inset-0 imcrm-animate-in imcrm-fade-in" style={{ background: 'rgba(15,23,42,0.45)' }} onClick={onClose} />
            {open === 'side' ? (
                <div
                    className={cn(
                        'imcrm-absolute imcrm-bottom-0 imcrm-top-0 imcrm-w-[min(88%,380px)] imcrm-overflow-hidden imcrm-shadow-2xl imcrm-animate-in imcrm-duration-300',
                        position === 'left' ? 'imcrm-left-0 imcrm-slide-in-from-left-full' : 'imcrm-right-0 imcrm-slide-in-from-right-full',
                    )}
                    style={{ background: '#ffffff' }}
                >
                    {close}
                    {children}
                </div>
            ) : (
                // Centrada con flex (no con translate: la animación de entrada pisaría el transform).
                <div className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-0 imcrm-flex imcrm-items-center imcrm-justify-center">
                    <div
                        className="imcrm-pointer-events-auto imcrm-relative imcrm-h-[88%] imcrm-w-[min(92%,520px)] imcrm-overflow-hidden imcrm-rounded-xl imcrm-shadow-2xl imcrm-animate-in imcrm-zoom-in-95"
                        style={{ background: '#ffffff' }}
                    >
                        {close}
                        {children}
                    </div>
                </div>
            )}
        </div>
    );
}

function Unpublished({ what, onPublish, busy, testId }: { what: string; onPublish?: () => void; busy?: boolean; testId: string }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-px-4 imcrm-py-8 imcrm-text-center" data-testid={`${testId}-demo-unpublished`}>
            <Rocket className="imcrm-h-6 imcrm-w-6" style={{ color: '#0369a1' }} />
            <p className="imcrm-text-sm imcrm-font-semibold" style={{ color: '#111827' }}>
                {__('Todavía no está publicado')}
            </p>
            <p className="imcrm-max-w-xs imcrm-text-xs" style={{ color: '#6b7280' }}>
                {__('Publica %s para verlo aquí tal como lo verá la gente en tu sitio.').replace('%s', what)}
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
            <span className="imcrm-ml-1 imcrm-flex-1 imcrm-truncate imcrm-rounded imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px]" style={{ background: '#ffffff', color: '#6b7280' }}>
                tusitio.com
            </span>
        </div>
    );
}

function SiteHeader(): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-px-5 imcrm-py-3" style={{ borderBottom: '1px solid #f1f3f5' }} aria-hidden="true">
            <span className="imcrm-h-6 imcrm-w-6 imcrm-rounded-md" style={{ background: '#1f2937' }} />
            <span className="imcrm-text-sm imcrm-font-semibold" style={{ color: '#111827' }}>
                {__('Tu negocio')}
            </span>
            <span className="imcrm-ml-auto imcrm-flex imcrm-gap-3">
                {[44, 52, 40].map((w) => (
                    <span key={w} className="imcrm-h-2 imcrm-rounded" style={{ width: w, background: '#e5e7eb' }} />
                ))}
            </span>
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
