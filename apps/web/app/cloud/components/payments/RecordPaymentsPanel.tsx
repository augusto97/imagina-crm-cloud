import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COLLECTION_PROVIDER_LABEL, type PaymentLink, type RecordPayments } from '@imagina-base/shared';
import { Ban, Columns3, ExternalLink, Loader2, RefreshCw, Wallet, X } from 'lucide-react';
import { Link } from 'react-router';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { fieldsKeys } from '@/hooks/useFields';
import { invalidateForList, recordsKeys } from '@/hooks/useRecords';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { CopyButton, PaymentStatusChip, formatMoney } from './paymentUi';
import { parseLocalAmount } from '@/lib/money';

/**
 * Cobros de un registro (v0.1.251, ADR-S31): los links de pago que se le
 * crearon (Mercado Pago o Wompi), si ya pagó, y el botón «Cobrar». El estado
 * lo actualiza el aviso del proveedor solo; «Verificar» pregunta a mano.
 *
 * Sin conexión de cobro y sin links, en la ficha clásica no se dibuja nada
 * (sería ruido en cada registro de cada lista); el bloque «Cobros» de la
 * ficha diseñada sí explica cómo conectar (`showEmptyHint`).
 */
export function RecordPaymentsPanel({
    listId,
    recordId,
    showEmptyHint = false,
}: {
    listId: number;
    recordId: number;
    showEmptyHint?: boolean;
}): JSX.Element | null {
    const qc = useQueryClient();
    const toast = useToast();
    const confirm = useConfirm();
    const [collecting, setCollecting] = useState(false);
    const key = ['record-payments', listId, recordId] as const;
    const q = useQuery({
        queryKey: key,
        queryFn: () => api.recordPayments(listId, recordId),
        retry: false,
        // Mientras haya un link pendiente, mirar seguido: el cliente puede
        // estar pagando ahora mismo (el aviso llega en segundos).
        refetchInterval: (query) => ((query.state.data?.links ?? []).some((l) => l.status === 'pending') ? 15_000 : false),
    });

    const refresh = (): void => {
        void qc.invalidateQueries({ queryKey: key });
        invalidateForList(qc, recordsKeys.all, listId);
    };

    const verify = useMutation({
        mutationFn: (id: number) => api.verifyPaymentLink(id),
        onSuccess: (link) => {
            refresh();
            toast.info(__('Consultado'), statusSentence(link));
        },
        onError: (err) => toast.error(__('No se pudo verificar'), errText(err)),
    });
    const cancel = useMutation({
        mutationFn: (id: number) => api.cancelPaymentLink(id),
        onSuccess: () => refresh(),
        onError: (err) => toast.error(__('No se pudo anular'), errText(err)),
    });
    const setup = useMutation({
        mutationFn: () => api.setupCollectionFields(listId),
        onSuccess: () => {
            refresh();
            invalidateForList(qc, fieldsKeys.all, listId);
            toast.success(__('Columnas de cobro agregadas'), __('Ahora la lista muestra el link, el estado, la fecha, el monto y el medio de cada pago.'));
        },
        onError: (err) => toast.error(__('No se pudieron agregar'), errText(err)),
    });

    if (q.isLoading || q.isError || !q.data) return null;
    const data = q.data;
    if (data.connections.length === 0 && data.links.length === 0) {
        if (!showEmptyHint) return null;
        return (
            <section className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-4 imcrm-text-sm imcrm-text-muted-foreground" data-testid="imcrm-record-payments">
                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-font-medium imcrm-text-foreground">
                    <Wallet className="imcrm-h-4 imcrm-w-4" />
                    {__('Cobros')}
                </p>
                <p className="imcrm-mt-1">
                    {__('Conecta Mercado Pago o Wompi en')}{' '}
                    <Link to="/settings?s=conectores" className="imcrm-text-primary hover:imcrm-underline">
                        {__('Ajustes → Integraciones')}
                    </Link>{' '}
                    {__('para cobrar desde aquí y saber quién ya pagó.')}
                </p>
            </section>
        );
    }

    const paid = data.links.find((l) => l.status === 'approved');
    // v0.1.253 — en la ficha clásica, una lista que no cobra (sin columnas de
    // cobro ni links para este registro) no lleva la tarjeta completa: salía
    // en TODAS las fichas, también en Tareas. Queda una línea discreta para
    // cobrar igual si hace falta; el bloque «Cobros» de una ficha diseñada se
    // pone a propósito, así que ahí siempre va completo.
    if (!showEmptyHint && data.fields === null && data.links.length === 0) {
        return (
            <>
                <button
                    type="button"
                    onClick={() => setCollecting(true)}
                    className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-self-start imcrm-rounded-md imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground"
                    data-testid="imcrm-payment-collect"
                >
                    <Wallet className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Cobrar este registro')}
                </button>
                {collecting && (
                    <CollectDialog
                        data={data}
                        listId={listId}
                        recordId={recordId}
                        onClose={() => setCollecting(false)}
                        onCreated={(link) => {
                            setCollecting(false);
                            refresh();
                            void navigator.clipboard?.writeText(link.url).catch(() => undefined);
                            toast.success(__('Link de pago creado'), __('Ya está copiado: pégaselo al cliente por WhatsApp o correo.'));
                        }}
                    />
                )}
            </>
        );
    }
    return (
        <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-record-payments">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <p className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                    <Wallet className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    {__('Cobros')}
                    {paid && <PaymentStatusChip status="approved" />}
                </p>
                {data.connections.length > 0 && (
                    <Button size="sm" onClick={() => setCollecting(true)} data-testid="imcrm-payment-collect">
                        <Wallet className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Cobrar')}
                    </Button>
                )}
            </div>

            {data.fields === null && data.can_setup && data.connections.length > 0 && (
                <div className="imcrm-mt-3 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted/50 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                    <span className="imcrm-flex-1">
                        {__('Agrega las columnas de cobro a la lista (link, estado, fecha, monto y medio) para ver y filtrar quién ya pagó sin abrir cada registro.')}
                    </span>
                    <Button size="sm" variant="outline" disabled={setup.isPending} onClick={() => setup.mutate()} data-testid="imcrm-payment-setup">
                        <Columns3 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Agregar columnas')}
                    </Button>
                </div>
            )}

            {data.links.length === 0 ? (
                <p className="imcrm-mt-3 imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Todavía no se le cobró. «Cobrar» crea un link para mandarle al cliente por WhatsApp o correo.')}
                </p>
            ) : (
                <ul className="imcrm-mt-3 imcrm-divide-y imcrm-divide-border">
                    {data.links.map((l) => (
                        <li key={l.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1 imcrm-py-2" data-testid="imcrm-payment-link">
                            <IntegrationLogo integrationKey={l.provider} size={24} />
                            <div className="imcrm-min-w-0 imcrm-flex-1">
                                <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                    <span className="imcrm-font-medium">{formatMoney(l.amount, l.currency)}</span>
                                    <PaymentStatusChip status={l.status} />
                                    <span className="imcrm-truncate imcrm-text-muted-foreground">{l.title}</span>
                                </p>
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">{detailLine(l)}</p>
                                {l.note && <p className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">{l.note}</p>}
                            </div>
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-0.5">
                                <CopyButton value={l.url} label={__('Copiar link')} testId="imcrm-payment-copy" />
                                <a
                                    href={l.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="imcrm-inline-flex imcrm-items-center imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                    title={__('Abrir la página de pago')}
                                >
                                    <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                                </a>
                                {l.connection_id !== null && (
                                    <button
                                        type="button"
                                        disabled={verify.isPending}
                                        onClick={() => verify.mutate(l.id)}
                                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1.5 imcrm-py-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                        title={__('Preguntarle al proveedor si ya pagó')}
                                        data-testid="imcrm-payment-verify"
                                    >
                                        <RefreshCw className={cn('imcrm-h-3.5 imcrm-w-3.5', verify.isPending && verify.variables === l.id && 'imcrm-animate-spin')} />
                                        {__('Verificar')}
                                    </button>
                                )}
                                {l.status === 'pending' && (
                                    <button
                                        type="button"
                                        disabled={cancel.isPending}
                                        onClick={async () => {
                                            const ok = await confirm({
                                                title: __('¿Anular este link?'),
                                                description:
                                                    l.provider === 'wompi'
                                                        ? __('El link se desactiva en Wompi y queda «Anulado».')
                                                        : __('Queda «Anulado» aquí. Mercado Pago no permite desactivar el link: si el cliente igual paga, se registra el pago.'),
                                                confirmLabel: __('Anular'),
                                                destructive: true,
                                            });
                                            if (ok) cancel.mutate(l.id);
                                        }}
                                        className="imcrm-inline-flex imcrm-items-center imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                                        title={__('Anular')}
                                        data-testid="imcrm-payment-cancel"
                                    >
                                        <Ban className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {collecting && (
                <CollectDialog
                    data={data}
                    listId={listId}
                    recordId={recordId}
                    onClose={() => setCollecting(false)}
                    onCreated={(link) => {
                        setCollecting(false);
                        refresh();
                        void navigator.clipboard?.writeText(link.url).catch(() => undefined);
                        toast.success(__('Link de pago creado'), __('Ya está copiado: pégaselo al cliente por WhatsApp o correo.'));
                    }}
                />
            )}
        </section>
    );
}

function CollectDialog({
    data,
    listId,
    recordId,
    onClose,
    onCreated,
}: {
    data: RecordPayments;
    listId: number;
    recordId: number;
    onClose: () => void;
    onCreated: (link: PaymentLink) => void;
}): JSX.Element {
    const [connectionId, setConnectionId] = useState<number>(data.connections[0]!.id);
    const conn = data.connections.find((c) => c.id === connectionId) ?? data.connections[0]!;
    const [title, setTitle] = useState(data.suggested.title);
    const [amount, setAmount] = useState(data.suggested.amount !== null ? String(data.suggested.amount) : '');
    const [currency, setCurrency] = useState(data.suggested.currency ?? 'COP');
    const [email, setEmail] = useState(data.suggested.payer_email ?? '');
    const [days, setDays] = useState('');
    const [error, setError] = useState<string | null>(null);

    // Wompi cobra sólo en pesos colombianos.
    useEffect(() => {
        if (conn.provider === 'wompi') setCurrency('COP');
    }, [conn.provider]);

    const create = useMutation({
        mutationFn: () =>
            api.createPaymentLink(listId, recordId, {
                connection_id: connectionId,
                title: title.trim(),
                amount: parseLocalAmount(amount),
                currency,
                payer_email: email.trim() || null,
                expires_days: days.trim() === '' ? null : Number(days),
            }),
        onSuccess: onCreated,
        onError: (err) => setError(errText(err)),
    });

    const amountValue = parseLocalAmount(amount);
    const valid = title.trim() !== '' && amountValue > 0;

    return (
        <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="imcrm-collect-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <IntegrationLogo integrationKey={conn.provider} size={40} />
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Cobrar')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Se crea un link de pago; cuando el cliente pague, el registro se actualiza solo.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent" aria-label={__('Cerrar')}>
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Dialog.Close>
                    </div>

                    <form
                        className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-3"
                        onSubmit={(e) => {
                            e.preventDefault();
                            setError(null);
                            if (valid) create.mutate();
                        }}
                    >
                        {data.connections.length > 1 && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="pay-conn">{__('Cobrar con')}</Label>
                                <Select id="pay-conn" value={String(connectionId)} onChange={(e) => setConnectionId(Number(e.target.value))}>
                                    {data.connections.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {COLLECTION_PROVIDER_LABEL[c.provider]} · {c.account_label ?? c.name}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                        )}
                        {conn.test_mode && (
                            <p className="imcrm-rounded-md imcrm-bg-amber-500/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-amber-800 dark:imcrm-text-amber-300">
                                {__('Esta conexión usa credenciales de PRUEBA: el link no cobra dinero real.')}
                            </p>
                        )}
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="pay-title">{__('Concepto')}</Label>
                            <Input id="pay-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} data-testid="imcrm-pay-title" />
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Lo que el cliente ve al pagar.')}</p>
                        </div>
                        <div className="imcrm-grid imcrm-grid-cols-[1fr_auto] imcrm-gap-2">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="pay-amount">{__('Monto')}</Label>
                                <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="imcrm-pay-amount" />
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="pay-currency">{__('Moneda')}</Label>
                                <Select
                                    id="pay-currency"
                                    value={currency}
                                    disabled={conn.provider === 'wompi'}
                                    onChange={(e) => setCurrency(e.target.value)}
                                >
                                    {['COP', 'MXN', 'ARS', 'CLP', 'PEN', 'UYU', 'BRL', 'USD'].map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                        </div>
                        {amountValue > 0 && (
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Se cobra')} <strong>{formatMoney(amountValue, currency)}</strong>
                            </p>
                        )}
                        <div className="imcrm-grid imcrm-grid-cols-[1fr_7rem] imcrm-gap-2">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="pay-email">{__('Correo del cliente (opcional)')}</Label>
                                <Input id="pay-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="pay-days">{__('Vence en (días)')}</Label>
                                <Input id="pay-days" inputMode="numeric" placeholder={__('No vence')} value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
                            </div>
                        </div>
                        {error && (
                            <p className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-pay-error">
                                {error}
                            </p>
                        )}
                        <div className="imcrm-mt-1 imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Button type="button" variant="ghost" onClick={onClose}>
                                {__('Cancelar')}
                            </Button>
                            <Button type="submit" disabled={!valid || create.isPending} data-testid="imcrm-pay-create">
                                {create.isPending && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                                {__('Crear link de pago')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function detailLine(l: PaymentLink): string {
    const parts: string[] = [`${COLLECTION_PROVIDER_LABEL[l.provider]} · ${__('creado')} ${formatDateTimeStr(l.created_at)}`];
    if (l.paid_at) parts.push(`${__('pagado')} ${formatDateTimeStr(l.paid_at)}`);
    if (l.method) parts.push(l.method);
    if (l.paid_amount !== null && l.status !== 'approved') parts.push(`${__('pagó')} ${formatMoney(l.paid_amount, l.currency)}`);
    if (l.status === 'pending' && l.expires_at) parts.push(`${__('vence')} ${formatDateTimeStr(l.expires_at)}`);
    return parts.join(' · ');
}

function statusSentence(l: PaymentLink): string {
    switch (l.status) {
        case 'approved':
            return __('Está pagado.');
        case 'pending':
            return __('Todavía no hay un pago aprobado.');
        case 'rejected':
            return l.note ?? __('El último intento fue rechazado.');
        case 'mismatch':
            return l.note ?? __('Se pagó por otro monto.');
        case 'expired':
            return __('El link venció sin pago.');
        case 'refunded':
            return __('El pago se reembolsó.');
        default:
            return __('Anulado.');
    }
}

function errText(err: unknown): string {
    if (err instanceof CloudApiError) return err.message;
    return err instanceof Error ? err.message : String(err);
}
