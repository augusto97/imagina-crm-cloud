import { CheckCircle2, Clock3, Copy, CreditCard, Download, ExternalLink, Loader2, Mail, PackageCheck, ShoppingBag } from 'lucide-react';
import { formatShopMoney } from '@imagina-base/shared';

import { usePlanModuleOff } from '@/components/PlanModuleNotice';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useIsGuest } from '@/lib/guest';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTimeStr, getTenantFormat } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { useMarkShopOrderPaid, useRecordShopOrder, useResendShopDownloads } from './useShops';

/**
 * v0.1.412 (ADR-S103) — En la ficha de un pedido de la tienda: cómo se pagó,
 * el total y «Marcar como pagado» (llegó la transferencia o el pago contra
 * entrega). Un registro que no es un pedido no muestra nada.
 */
export function RecordShopOrderPanel({ listId, recordId, className }: { listId: number; recordId: number; className?: string }): JSX.Element | null {
    const off = usePlanModuleOff('shop');
    const isGuest = useIsGuest();
    const q = useRecordShopOrder(listId, recordId, !off && !isGuest);
    const mark = useMarkShopOrderPaid(listId, recordId);
    const resend = useResendShopDownloads(listId, recordId);
    const confirm = useConfirm();
    const toast = useToast();
    const o = q.data;
    if (!o) return null;
    const paid = o.payment_status === 'pagado';
    const total = formatShopMoney(o.total, o.currency, getTenantFormat().number_format);
    const copyPayLink = async (): Promise<void> => {
        if (!o.pay_url) return;
        try {
            await navigator.clipboard.writeText(o.pay_url);
            toast.success(__('Link de pago copiado'));
        } catch {
            toast.error(__('No se pudo copiar el link'));
        }
    };
    return (
        <section
            className={cn('imcrm-rounded-xl imcrm-border imcrm-p-3', paid ? 'imcrm-border-success/30 imcrm-bg-success/5' : 'imcrm-border-border imcrm-bg-card', className)}
            data-testid="record-shop-order"
            data-payment-status={o.payment_status}
        >
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-gap-3">
                <span className={cn('imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg', paid ? 'imcrm-bg-success/15 imcrm-text-success' : 'imcrm-bg-primary/10 imcrm-text-primary')}>
                    {paid ? <PackageCheck className="imcrm-h-4 imcrm-w-4" /> : <ShoppingBag className="imcrm-h-4 imcrm-w-4" />}
                </span>
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <p className="imcrm-text-[13px] imcrm-font-medium">
                        {sprintf(__('Pedido %1$s · %2$s'), o.number, total)}
                    </p>
                    <p className="imcrm-text-[12px] imcrm-text-muted-foreground">
                        {o.shop_name ? `${o.shop_name} · ` : ''}
                        {o.payment_label} · {o.payment_status_label}
                        {o.paid_at ? ` ${__('el')} ${formatDateTimeStr(o.paid_at)}` : ''}
                        {o.cancelled ? ` · ${__('Cancelado: el stock volvió a la tienda')}` : ''}
                    </p>
                    {o.pay_url && (
                        <p className="imcrm-mt-1 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1 imcrm-text-[12px] imcrm-text-amber-700 dark:imcrm-text-amber-300" data-testid="record-shop-online-waiting">
                            <Clock3 className="imcrm-h-3.5 imcrm-w-3.5" />
                            <span>
                                {o.pay_until
                                    ? sprintf(__('Esperando el pago en línea%1$s hasta el %2$s. Si no paga, el pedido se cancela solo y el stock vuelve.'), o.pay_provider ? ` (${o.pay_provider})` : '', formatDateTimeStr(o.pay_until))
                                    : sprintf(__('Esperando el pago en línea%s.'), o.pay_provider ? ` (${o.pay_provider})` : '')}
                            </span>
                            <button type="button" className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-font-medium imcrm-text-primary hover:imcrm-underline" onClick={() => void copyPayLink()} data-testid="record-shop-copy-pay-link">
                                <Copy className="imcrm-h-3 imcrm-w-3" />
                                {__('Copiar link de pago')}
                            </button>
                        </p>
                    )}
                    {o.downloads && (
                        <p className="imcrm-mt-1 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1 imcrm-text-[12px] imcrm-text-muted-foreground" data-testid="record-shop-downloads">
                            <Download className="imcrm-h-3.5 imcrm-w-3.5" />
                            <span>
                                {o.downloads.files === 1 ? __('1 archivo para descargar') : sprintf(__('%d archivos para descargar'), o.downloads.files)}
                                {' · '}
                                {o.downloads.used === 1 ? __('1 descarga') : sprintf(__('%d descargas'), o.downloads.used)}
                                {o.downloads.max !== null ? ` (${sprintf(__('hasta %d por archivo'), o.downloads.max)})` : ''}
                                {o.downloads.until ? ` · ${sprintf(__('sirven hasta el %s'), formatDateTimeStr(o.downloads.until))}` : ` · ${__('aparecen al confirmarse el pago')}`}
                            </span>
                            {o.can_resend && (
                                <button
                                    type="button"
                                    className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-font-medium imcrm-text-primary hover:imcrm-underline disabled:imcrm-opacity-60"
                                    disabled={resend.isPending}
                                    data-testid="record-shop-resend-downloads"
                                    onClick={() =>
                                        resend.mutate(undefined, {
                                            onSuccess: () => toast.success(__('Le volvimos a mandar las descargas'), __('Le llega un correo con los enlaces.')),
                                            onError: (e) => toast.error(__('No se pudo mandar'), e instanceof Error ? e.message : undefined),
                                        })
                                    }
                                >
                                    {resend.isPending ? <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" /> : <Mail className="imcrm-h-3 imcrm-w-3" />}
                                    {__('Reenviar las descargas')}
                                </button>
                            )}
                        </p>
                    )}
                    {o.payment_method === 'subscription' && (
                        <p className="imcrm-mt-1 imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[12px] imcrm-text-muted-foreground" data-testid="record-shop-subscription-note">
                            <CreditCard className="imcrm-h-3.5 imcrm-w-3.5" />
                            {paid
                                ? __('Suscripción activa: los cobros siguientes se ven en la sección Suscripción.')
                                : __('Suscripción: queda pagado solo cuando el cliente autoriza el débito automático.')}
                        </p>
                    )}
                    {!o.pay_url && o.pay_provider && paid && (
                        <p className="imcrm-mt-1 imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[12px] imcrm-text-muted-foreground">
                            <CreditCard className="imcrm-h-3.5 imcrm-w-3.5" />
                            {sprintf(__('Pagado en línea con %s.'), o.pay_provider)}
                        </p>
                    )}
                </div>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                    {o.public_url && (
                        <Button variant="ghost" size="sm" className="imcrm-h-8 imcrm-gap-1 imcrm-text-xs" asChild>
                            <a href={o.public_url} target="_blank" rel="noreferrer noopener" title={__('Lo que ve quien compró')}>
                                <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Ver como cliente')}
                            </a>
                        </Button>
                    )}
                    {!paid && !o.cancelled && o.payment_method !== 'subscription' && (
                        <Button
                            size="sm"
                            className="imcrm-h-8 imcrm-gap-1.5"
                            disabled={mark.isPending}
                            data-testid="record-shop-mark-paid"
                            onClick={async () => {
                                const ok = await confirm({
                                    title: __('¿Marcar el pedido como pagado?'),
                                    description: sprintf(__('Confirma que recibiste %s. Queda anotado quién lo marcó y cuándo.'), total),
                                    confirmLabel: __('Marcar como pagado'),
                                });
                                if (!ok) return;
                                mark.mutate(undefined, {
                                    onSuccess: () => toast.success(__('Pedido marcado como pagado')),
                                    onError: (e) => toast.error(__('No se pudo marcar'), e instanceof Error ? e.message : undefined),
                                });
                            }}
                        >
                            {mark.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <CheckCircle2 className="imcrm-h-3.5 imcrm-w-3.5" />}
                            {__('Marcar como pagado')}
                        </Button>
                    )}
                </div>
            </div>
        </section>
    );
}
