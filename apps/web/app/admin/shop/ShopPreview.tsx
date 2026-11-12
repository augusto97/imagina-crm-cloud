import { useEffect, useRef, useState } from 'react';
import { Loader2, Monitor, Moon, Package, ShoppingCart, Smartphone, Store, Sun } from 'lucide-react';
import type { ShopConfig } from '@imagina-base/shared';

import { IconToggleGroup, PreviewToolbar } from '@/admin/builder/BuilderShell';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { fetchShopPreview } from './useShops';

type Device = 'desktop' | 'mobile';
/** v0.1.424 — «Producto»: la ficha del primer producto abierta (para ver su diseño). */
type View = 'catalog' | 'product' | 'checkout';

/**
 * v0.1.412 (ADR-S103) — La vista previa del editor: la página REAL de la
 * tienda (`/public/s/preview`) con lo que se está editando, sin guardar. El
 * catálogo lo arma el servidor (con las fotos por URL firmada) y llega al
 * marco por `postMessage`; nada se envía desde ahí.
 */
export function ShopPreview({
    shopId,
    config,
    compact,
    version = 0,
    focus,
}: {
    shopId: number;
    config: ShopConfig;
    compact?: boolean;
    version?: number;
    /** v0.1.424 — Pedir una pantalla desde el panel (ej.: la ficha al elegir su diseño). `n` cambia en cada pedido. */
    focus?: { view: View; n: number } | null;
}): JSX.Element {
    const frame = useRef<HTMLIFrameElement>(null);
    const [ready, setReady] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [device, setDevice] = useState<Device>(compact ? 'mobile' : 'desktop');
    const [view, setView] = useState<View>('catalog');
    useEffect(() => {
        if (focus) setView(focus.view);
    }, [focus]);
    // v0.1.422 — Con el modo «Automático», ver la tienda clara u oscura.
    const [scheme, setScheme] = useState<'light' | 'dark'>('light');
    const auto = config.design.mode === 'auto';
    const last = useRef<{ meta: unknown; products: unknown } | null>(null);
    const seq = useRef(0);
    // Lo que se ve ahora (pantalla y claro/oscuro): `post` lo lee al enviar, así
    // una vista previa que llega tarde no vuelve a la pantalla o al modo de antes.
    const shown = useRef<{ view: View; scheme: 'light' | 'dark' | null }>({ view, scheme: null });
    shown.current = { view, scheme: auto ? scheme : null };

    useEffect(() => {
        const onMsg = (e: MessageEvent): void => {
            if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
            if ((e.data as { type?: string } | null)?.type === 'imb-shop-ready') setReady(true);
        };
        window.addEventListener('message', onMsg);
        return () => window.removeEventListener('message', onMsg);
    }, []);

    // Lo editado → el servidor arma el catálogo (sin guardar), con una pausa para no pedir por tecla.
    useEffect(() => {
        const n = ++seq.current;
        setLoading(true);
        const t = window.setTimeout(() => {
            fetchShopPreview(shopId, config)
                .then((d) => {
                    if (n !== seq.current) return;
                    last.current = d;
                    setError(null);
                    post();
                })
                .catch((e: unknown) => {
                    if (n === seq.current) setError(e instanceof Error ? e.message : __('No se pudo armar la vista previa.'));
                })
                .finally(() => {
                    if (n === seq.current) setLoading(false);
                });
        }, 350);
        return () => window.clearTimeout(t);
    }, [shopId, config, version]);

    const post = (): void => {
        const w = frame.current?.contentWindow;
        if (!w || !last.current) return;
        w.postMessage({ type: 'imb-shop-preview', ...last.current, ...shown.current }, window.location.origin);
    };
    useEffect(() => {
        if (ready) post();
    }, [ready, view, scheme, auto]);

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-min-h-0 imcrm-flex-col imcrm-bg-canvas" data-testid="shop-preview">
            <PreviewToolbar hint={__('Así la ven tus clientes. En la vista previa no se hacen pedidos.')}>
                {loading && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin imcrm-text-muted-foreground" aria-label={__('Actualizando')} />}
                <IconToggleGroup
                    label={__('Qué pantalla')}
                    value={view}
                    onChange={setView}
                    options={[
                        { id: 'catalog', label: __('Catálogo'), icon: Store, testId: 'shop-preview-catalog', showLabel: !compact },
                        { id: 'product', label: __('Producto'), icon: Package, testId: 'shop-preview-product', showLabel: !compact },
                        { id: 'checkout', label: __('Compra'), icon: ShoppingCart, testId: 'shop-preview-checkout', showLabel: !compact },
                    ]}
                />
                {auto && (
                    <IconToggleGroup
                        label={__('Claro u oscuro')}
                        value={scheme}
                        onChange={setScheme}
                        options={[
                            { id: 'light', label: __('Claro'), icon: Sun, testId: 'shop-preview-light' },
                            { id: 'dark', label: __('Oscuro'), icon: Moon, testId: 'shop-preview-dark' },
                        ]}
                    />
                )}
                {!compact && (
                    <IconToggleGroup
                        label={__('Dispositivo')}
                        value={device}
                        onChange={setDevice}
                        options={[
                            { id: 'desktop', label: __('Computador'), icon: Monitor, testId: 'shop-preview-desktop' },
                            { id: 'mobile', label: __('Celular'), icon: Smartphone, testId: 'shop-preview-mobile' },
                        ]}
                    />
                )}
            </PreviewToolbar>
            {error && <p className="imcrm-mx-4 imcrm-mt-2 imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-destructive">{error}</p>}
            <div className={cn('imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-justify-center imcrm-overflow-hidden', device === 'mobile' && !compact ? 'imcrm-p-4' : 'imcrm-p-0 sm:imcrm-p-3')}>
                <div
                    className={cn(
                        'imcrm-h-full imcrm-overflow-hidden imcrm-bg-white imcrm-shadow-sm',
                        device === 'mobile' && !compact ? 'imcrm-w-[390px] imcrm-max-w-full imcrm-rounded-[28px] imcrm-border-[6px] imcrm-border-zinc-800' : 'imcrm-w-full sm:imcrm-rounded-lg sm:imcrm-border sm:imcrm-border-border',
                    )}
                >
                    <iframe
                        ref={frame}
                        title={__('Vista previa de la tienda')}
                        src="/api/v1/public/s/preview"
                        className="imcrm-h-full imcrm-w-full imcrm-border-0"
                        data-testid="shop-preview-frame"
                    />
                </div>
            </div>
        </div>
    );
}
