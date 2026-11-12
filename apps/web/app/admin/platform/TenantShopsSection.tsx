import { useState } from 'react';
import { ExternalLink, Loader2, ShoppingBag } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { usePlatformShops, useSuspendPlatformShop } from '../shop/useShops';

/**
 * v0.1.412 (ADR-S103) — Las tiendas de una empresa en la consola, para
 * suspender una que se usa mal (estafa, productos prohibidos). Suspendida, su
 * página deja de verse y la empresa no la puede volver a publicar. Los
 * pedidos y los productos no se tocan.
 */
export function TenantShopsSection({ tenantId }: { tenantId: number }): JSX.Element | null {
    const shops = usePlatformShops(tenantId);
    const suspend = useSuspendPlatformShop(tenantId);
    const toast = useToast();
    const [reasonFor, setReasonFor] = useState<number | null>(null);
    const [reason, setReason] = useState('');
    const list = shops.data ?? [];
    if (shops.isLoading || list.length === 0) return null;
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="tenant-shops">
            <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                <ShoppingBag className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Tiendas')} ({list.length})
            </h3>
            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                {list.map((s) => (
                    <li key={s.id} className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-2.5" data-platform-shop={s.id}>
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <div className="imcrm-min-w-0 imcrm-flex-1">
                                <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                                    <span className="imcrm-truncate">{s.name}</span>
                                    <span
                                        className={cn(
                                            'imcrm-shrink-0 imcrm-rounded imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium',
                                            s.suspended ? 'imcrm-bg-destructive/10 imcrm-text-destructive' : s.enabled ? 'imcrm-bg-success/10 imcrm-text-success' : 'imcrm-bg-muted imcrm-text-muted-foreground',
                                        )}
                                    >
                                        {s.suspended ? __('Suspendida') : s.enabled ? __('Publicada') : __('Sin publicar')}
                                    </span>
                                </p>
                                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                    {s.orders_count} {s.orders_count === 1 ? __('pedido') : __('pedidos')}
                                    {s.suspended && s.suspended_reason ? ` · ${s.suspended_reason}` : ''}
                                </p>
                            </div>
                            {s.enabled && (
                                <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" asChild aria-label={__('Abrir la tienda')}>
                                    <a href={s.public_path} target="_blank" rel="noreferrer noopener">
                                        <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </a>
                                </Button>
                            )}
                            {s.suspended ? (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="imcrm-h-7 imcrm-text-xs"
                                    disabled={suspend.isPending}
                                    onClick={() =>
                                        suspend.mutate(
                                            { id: s.id, suspended: false },
                                            { onSuccess: () => toast.success(__('Tienda reactivada: la empresa ya puede publicarla')), onError: (e) => toast.error(__('No se pudo'), e instanceof Error ? e.message : undefined) },
                                        )
                                    }
                                    data-testid="platform-shop-unsuspend"
                                >
                                    {__('Reactivar')}
                                </Button>
                            ) : (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="imcrm-h-7 imcrm-text-xs imcrm-text-destructive hover:imcrm-text-destructive"
                                    onClick={() => {
                                        setReasonFor(s.id);
                                        setReason('');
                                    }}
                                    data-testid="platform-shop-suspend"
                                >
                                    {__('Suspender')}
                                </Button>
                            )}
                        </div>
                        {reasonFor === s.id && (
                            <div className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={__('Motivo (lo ve la empresa)')} aria-label={__('Motivo')} />
                                <div className="imcrm-flex imcrm-justify-end imcrm-gap-1.5">
                                    <Button size="sm" variant="ghost" className="imcrm-h-7 imcrm-text-xs" onClick={() => setReasonFor(null)}>
                                        {__('Cancelar')}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="destructive"
                                        className="imcrm-h-7 imcrm-gap-1 imcrm-text-xs"
                                        disabled={suspend.isPending}
                                        onClick={() =>
                                            suspend.mutate(
                                                { id: s.id, suspended: true, reason: reason.trim() || null },
                                                {
                                                    onSuccess: () => {
                                                        setReasonFor(null);
                                                        toast.success(__('Tienda suspendida'));
                                                    },
                                                    onError: (e) => toast.error(__('No se pudo'), e instanceof Error ? e.message : undefined),
                                                },
                                            )
                                        }
                                        data-testid="platform-shop-suspend-confirm"
                                    >
                                        {suspend.isPending && <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />}
                                        {__('Suspender la tienda')}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}
