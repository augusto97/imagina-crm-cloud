import { useEffect, useRef, useState } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COLLECTION_PROVIDER_LABEL, readPortalPaymentsConfig, type PortalPaymentLink, type PortalPaymentsBlockData } from '@imagina-base/shared';
import { ExternalLink, Loader2, Receipt, Wallet, X } from 'lucide-react';

import { CopyButton, PaymentStatusChip, formatMoney } from '@/cloud/components/payments/paymentUi';
import { portalApi } from '@/cloud-portal/portalClient';
import { api } from '@/cloud/session';
import { CloudApiError } from '@/lib/cloud/client';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

/** Cuánto se sigue mirando si el pago llegó después de mandar al checkout. */
const WATCH_MS = 15 * 60 * 1000;
const WATCH_EVERY_MS = 8000;

/**
 * v0.1.290 — Bloque «Pagos» del portal del cliente: sus links de pago (de su
 * registro y de las listas vinculadas que eligió la empresa) con su estado, y
 * el botón para pagar el monto que el SERVIDOR lee de su registro. Al pagar,
 * el checkout del proveedor se abre en otra pestaña y este bloque mira cada
 * pocos segundos hasta que el aviso del proveedor marca el pago.
 */
export function PortalPaymentsBlockView({
    blockId,
    data,
    preview = false,
}: {
    blockId: string;
    data: PortalPaymentsBlockData;
    /** En el editor: se ve igual pero no cobra nada. */
    preview?: boolean;
}): JSX.Element | null {
    const qc = useQueryClient();
    const [watchUntil, setWatchUntil] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [receipt, setReceipt] = useState<PortalPaymentLink | null>(null);
    const paidBefore = useRef(new Set(data.links.filter((l) => l.status === 'approved').map((l) => l.id)));

    const pay = useMutation({
        mutationFn: () => portalApi.portalPay(blockId),
    });

    // Mientras se espera el aviso del proveedor: refrescar el portal.
    useEffect(() => {
        if (watchUntil === null) return;
        const t = window.setInterval(() => {
            if (Date.now() > watchUntil) {
                setWatchUntil(null);
                return;
            }
            if (document.visibilityState === 'visible') void qc.invalidateQueries({ queryKey: ['portal-me'] });
        }, WATCH_EVERY_MS);
        return () => window.clearInterval(t);
    }, [watchUntil, qc]);
    // Llegó un pago nuevo: se deja de mirar.
    const newlyPaid = data.links.find((l) => l.status === 'approved' && !paidBefore.current.has(l.id));
    useEffect(() => {
        if (newlyPaid) setWatchUntil(null);
    }, [newlyPaid]);

    const onPay = (): void => {
        if (preview) return;
        setError(null);
        // La pestaña se abre YA (dentro del click) para que el navegador no la
        // bloquee; la dirección del checkout se le pone cuando llega.
        const tab = window.open('', '_blank');
        pay.mutate(undefined, {
            onSuccess: (res) => {
                if (tab && !tab.closed) {
                    tab.opener = null;
                    tab.location.href = res.url;
                } else {
                    window.location.assign(res.url);
                }
                setWatchUntil(Date.now() + WATCH_MS);
                void qc.invalidateQueries({ queryKey: ['portal-me'] });
            },
            onError: (err) => {
                tab?.close();
                setError(err instanceof CloudApiError || err instanceof Error ? err.message : 'No se pudo iniciar el pago.');
            },
        });
    };

    if (data.links.length === 0 && !data.pay) {
        return (
            <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-5 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground" data-testid="portal-payments-empty">
                No tienes pagos por ahora.
            </div>
        );
    }

    return (
        <div className="imcrm-space-y-3" data-testid="portal-payments">
            {data.pay && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-px-4 imcrm-py-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/15 imcrm-text-primary">
                        <Wallet className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div className="imcrm-min-w-0 imcrm-flex-1">
                        <p className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{data.pay.concept}</p>
                        <p className="imcrm-text-lg imcrm-font-semibold imcrm-tabular-nums" data-testid="portal-pay-amount">
                            {formatMoney(data.pay.amount, data.pay.currency)}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onPay}
                        disabled={pay.isPending}
                        data-testid="portal-pay-button"
                        className="imcrm-inline-flex imcrm-h-10 imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-primary imcrm-px-4 imcrm-text-sm imcrm-font-semibold imcrm-text-primary-foreground disabled:imcrm-opacity-60"
                    >
                        {pay.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" aria-hidden /> : null}
                        {data.pay.label}
                    </button>
                    <p className="imcrm-w-full imcrm-text-[11px] imcrm-text-muted-foreground">
                        Pagas en {COLLECTION_PROVIDER_LABEL[data.pay.provider]} (se abre en otra pestaña). Cuando el pago se apruebe, lo verás aquí.
                    </p>
                </div>
            )}
            {watchUntil !== null && (
                <p role="status" className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground" data-testid="portal-pay-waiting">
                    <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" aria-hidden />
                    Esperando la confirmación del pago…
                </p>
            )}
            {newlyPaid && (
                <p role="status" className="imcrm-rounded-md imcrm-bg-emerald-500/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-emerald-700 dark:imcrm-text-emerald-300" data-testid="portal-pay-done">
                    ¡Listo! Recibimos tu pago de {formatMoney(newlyPaid.paid_amount ?? newlyPaid.amount, newlyPaid.currency)}.
                </p>
            )}
            {error && (
                <p role="alert" className="imcrm-text-sm imcrm-text-destructive">
                    {error}
                </p>
            )}
            {data.links.length > 0 && (
                <ul className="imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border">
                    {data.links.map((l) => (
                        <li key={l.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1.5 imcrm-px-3 imcrm-py-2.5" data-testid="portal-payment-row">
                            <div className="imcrm-min-w-0 imcrm-flex-1">
                                <p className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{l.title}</p>
                                <p className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                    {l.record_title} · {formatDateTimeStr(l.paid_at ?? l.created_at)}
                                </p>
                            </div>
                            <span className="imcrm-text-sm imcrm-font-semibold imcrm-tabular-nums">{formatMoney(l.amount, l.currency)}</span>
                            <PaymentStatusChip status={l.status} />
                            {l.status === 'pending' && l.url ? (
                                <a
                                    href={l.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    data-testid="portal-payment-link"
                                    onClick={() => setWatchUntil(Date.now() + WATCH_MS)}
                                    className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-bg-primary imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-semibold imcrm-text-primary-foreground"
                                >
                                    Pagar <ExternalLink className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                </a>
                            ) : l.status === 'approved' ? (
                                <button
                                    type="button"
                                    onClick={() => setReceipt(l)}
                                    data-testid="portal-payment-receipt"
                                    className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-2.5 imcrm-py-1 imcrm-text-xs hover:imcrm-bg-muted"
                                >
                                    <Receipt className="imcrm-h-3 imcrm-w-3" aria-hidden /> Ver comprobante
                                </button>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
            <ReceiptDialog link={receipt} onClose={() => setReceipt(null)} />
        </div>
    );
}

function ReceiptDialog({ link, onClose }: { link: PortalPaymentLink | null; onClose: () => void }): JSX.Element {
    const rows: Array<[string, string | null]> = link
        ? [
              ['Concepto', link.title],
              ['De', link.record_title],
              ['Monto pagado', formatMoney(link.paid_amount ?? link.amount, link.currency)],
              ['Fecha', link.paid_at ? formatDateTimeStr(link.paid_at) : null],
              ['Medio de pago', link.method],
              ['Referencia', link.payment_id],
          ]
        : [];
    return (
        <RDialog.Root open={link !== null} onOpenChange={(o) => !o && onClose()}>
            <RDialog.Portal>
                <RDialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40" />
                <RDialog.Content
                    data-testid="portal-receipt"
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[min(24rem,calc(100vw-2rem))] -imcrm-translate-x-1/2 -imcrm-translate-y-1/2 imcrm-space-y-4 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-lg"
                >
                    <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                        <RDialog.Title className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                            <Receipt className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden /> Comprobante de pago
                        </RDialog.Title>
                        <RDialog.Close className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-muted" aria-label="Cerrar">
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </RDialog.Close>
                    </div>
                    <RDialog.Description className="imcrm-sr-only">El detalle de un pago aprobado.</RDialog.Description>
                    <dl className="imcrm-space-y-2 imcrm-text-sm">
                        {rows
                            .filter((r): r is [string, string] => r[1] !== null && r[1] !== '')
                            .map(([k, v]) => (
                                <div key={k} className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-4">
                                    <dt className="imcrm-text-muted-foreground">{k}</dt>
                                    <dd className={cn('imcrm-text-right imcrm-font-medium', k === 'Referencia' && 'imcrm-font-mono imcrm-text-xs')}>
                                        {v}
                                        {k === 'Referencia' && <CopyButton value={v} />}
                                    </dd>
                                </div>
                            ))}
                    </dl>
                </RDialog.Content>
            </RDialog.Portal>
        </RDialog.Root>
    );
}

/**
 * Vista previa en el editor del portal: lo que verá el cliente con la
 * configuración actual — o, si la empresa no tiene una conexión de cobro del
 * equipo, por qué el bloque no se le va a mostrar.
 */
export function PortalPaymentsPreview({
    config,
    amount,
    currency,
}: {
    config: Record<string, unknown>;
    /** El valor del campo del monto en el registro de muestra. */
    amount: unknown;
    /** La moneda del campo del monto (Wompi siempre cobra en COP). */
    currency: string;
}): JSX.Element {
    const cfg = readPortalPaymentsConfig(config);
    const conns = useQuery({ queryKey: ['collections-connections'], queryFn: () => api.collectionConnections(), retry: false, staleTime: 60_000 });
    const shared = (conns.data ?? []).filter((c) => c.shared !== false);
    if (conns.isLoading) return <div className="imcrm-h-16 imcrm-animate-pulse imcrm-rounded-lg imcrm-bg-muted" />;
    if (shared.length === 0) {
        return (
            <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-amber-500/50 imcrm-bg-amber-500/5 imcrm-px-4 imcrm-py-3 imcrm-text-sm" data-testid="portal-payments-no-connection">
                <p className="imcrm-font-medium">Falta una conexión de cobro</p>
                <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                    Conecta Mercado Pago o Wompi en Ajustes → Integraciones (para todo el equipo). Sin una, tus clientes no ven este bloque.
                </p>
            </div>
        );
    }
    const n = typeof amount === 'number' ? amount : typeof amount === 'string' && amount.trim() !== '' ? Number(amount) : NaN;
    const conn = shared.find((c) => c.id === cfg.pay_button.connection_id);
    const pay =
        cfg.pay_button.enabled && conn && Number.isFinite(n) && n > 0
            ? {
                  label: cfg.pay_button.label || 'Pagar ahora',
                  amount: n,
                  currency: conn.provider === 'wompi' ? 'COP' : currency,
                  concept: cfg.pay_button.concept || 'Concepto del pago',
                  provider: conn.provider,
              }
            : null;
    return (
        <div className="imcrm-space-y-2" data-testid="portal-payments-preview">
            <PortalPaymentsBlockView blockId="preview" data={{ links: [], pay }} preview />
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {cfg.show_links ? 'Debajo, el cliente ve los links de pago de sus registros con su estado. ' : ''}
                {cfg.pay_button.enabled && !pay ? 'El botón aparece cuando el registro tiene un monto mayor a cero. ' : ''}
                {cfg.pay_button.enabled && !conn ? 'Elige la conexión de cobro del botón. ' : ''}
            </p>
        </div>
    );
}
