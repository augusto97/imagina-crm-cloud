import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    SUBSCRIPTION_CHARGE_STATUS_LABELS,
    isLiveSubscriptionStatus,
    type RecordSubscriptions,
    type Subscription,
    type SubscriptionWithCharges,
} from '@imagina-base/shared';
import { Ban, Columns3, ExternalLink, Loader2, Pause, Pencil, Play, RefreshCw, Repeat, X } from 'lucide-react';
import { Link } from 'react-router';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { usePlanModuleOff } from '@/components/PlanModuleNotice';
import { useFields } from '@/hooks/useFields';
import { invalidateForList, recordsKeys } from '@/hooks/useRecords';
import { CloudApiError } from '@/lib/cloud/client';
import { useIsGuest } from '@/lib/guest';
import { __, sprintf } from '@/lib/i18n';
import { parseLocalAmount } from '@/lib/money';
import { formatDate, formatDateTimeStr } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { CopyButton, formatMoney } from '../payments/paymentUi';
import { SubscriptionChargeLogEditor } from './SubscriptionChargeLogEditor';
import { SubscriptionFieldsEditor } from './SubscriptionFieldsEditor';
import { cyclesText, frequencyText, statusOption, statusSentence } from './subscriptionText';

/**
 * v0.1.367 (ADR-S96) — La suscripción de un registro: el plan, si está al
 * día, el próximo cobro, cada cobro con su resultado y «Suscribir». El estado
 * lo mantienen solos los avisos de Mercado Pago y la revisión periódica.
 *
 * Sin planes y sin suscripciones, en la ficha clásica no se dibuja nada; el
 * bloque de la ficha diseñada sí explica cómo empezar (`showEmptyHint`).
 */
function RecordSubscriptionPanelInner({
    listId,
    recordId,
    showEmptyHint = false,
}: {
    listId: number;
    recordId: number;
    showEmptyHint?: boolean;
}): JSX.Element | null {
    const qc = useQueryClient();
    const isGuest = useIsGuest();
    const [subscribing, setSubscribing] = useState(false);
    const [choosingColumns, setChoosingColumns] = useState(false);
    const [showOld, setShowOld] = useState(false);
    const key = ['record-subscriptions', listId, recordId] as const;
    const q = useQuery({
        queryKey: key,
        queryFn: () => api.recordSubscriptions(listId, recordId),
        enabled: !isGuest,
        retry: false,
        // Un cobro llega por un aviso de Mercado Pago: al abrir la ficha, siempre fresco.
        staleTime: 0,
        // Mientras el cliente no autorice la tarjeta, mirar seguido (puede estar haciéndolo ahora).
        refetchInterval: (query) => ((query.state.data?.subscriptions ?? []).some((s) => s.status === 'pending') ? 15_000 : false),
    });
    const refresh = (): void => {
        void qc.invalidateQueries({ queryKey: key });
        invalidateForList(qc, recordsKeys.all, listId);
    };

    if (isGuest || q.isLoading || q.isError || !q.data) return null;
    const data = q.data;
    if (data.plans.length === 0 && data.subscriptions.length === 0) {
        if (!showEmptyHint) return null;
        return (
            <section className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-4 imcrm-text-sm imcrm-text-muted-foreground" data-testid="imcrm-record-subscriptions">
                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-font-medium imcrm-text-foreground">
                    <Repeat className="imcrm-h-4 imcrm-w-4" />
                    {__('Suscripción')}
                </p>
                <p className="imcrm-mt-1">
                    {__('Para cobrar cada mes con débito automático, conecta Mercado Pago o PayPal en')}{' '}
                    <Link to="/settings?s=conectores" className="imcrm-text-primary hover:imcrm-underline">
                        {__('Ajustes → Integraciones')}
                    </Link>{' '}
                    {__('y crea un plan en «Cobros» de esa conexión.')}
                </p>
            </section>
        );
    }

    const [current, ...older] = data.subscriptions;
    // Una suscripción viva ya cobrando: no se ofrece otra (una por registro).
    const blocksNew = current !== undefined && isLiveSubscriptionStatus(current.status) && current.status !== 'pending';
    const canSubscribe = data.can_edit && data.plans.length > 0 && !blocksNew;

    return (
        <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-record-subscriptions" data-tour="record-subscription">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <p className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                    <Repeat className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    {__('Suscripción')}
                    {current && <SubscriptionStatusChip status={current.status} />}
                </p>
                {data.fields !== null && data.can_setup && (
                    <button
                        type="button"
                        onClick={() => setChoosingColumns(true)}
                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1.5 imcrm-py-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                        title={__('En qué columnas de la lista queda cada dato de la suscripción')}
                        data-testid="imcrm-subscription-columns"
                    >
                        <Columns3 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Columnas')}
                    </button>
                )}
                {canSubscribe && (
                    <Button size="sm" onClick={() => setSubscribing(true)} data-testid="imcrm-subscribe">
                        <Repeat className="imcrm-h-3.5 imcrm-w-3.5" />
                        {current?.status === 'pending' ? __('Crear otro link') : __('Suscribir')}
                    </Button>
                )}
            </div>

            {data.fields === null && data.can_setup && (
                <div className="imcrm-mt-3 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-amber-50 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-amber-900 dark:imcrm-bg-amber-950/40 dark:imcrm-text-amber-200">
                    <span className="imcrm-flex-1">
                        {__('El estado de la suscripción se ve sólo aquí: elige columnas de la lista para verlo en la tabla y filtrar quién está al día, en mora o vencido.')}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => setChoosingColumns(true)} data-testid="imcrm-subscription-setup">
                        <Columns3 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Elegir columnas')}
                    </Button>
                </div>
            )}

            {!current ? (
                <p className="imcrm-mt-3 imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Sin suscripción. «Suscribir» crea un link para que el cliente autorice el pago (su tarjeta en Mercado Pago, o su cuenta PayPal); desde ahí se le cobra solo cada período.')}
                </p>
            ) : (
                <SubscriptionCard sub={current} canEdit={data.can_edit} onChanged={refresh} />
            )}

            {older.length > 0 && (
                <div className="imcrm-mt-3 imcrm-border-t imcrm-border-border imcrm-pt-2">
                    <button
                        type="button"
                        className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground"
                        onClick={() => setShowOld((v) => !v)}
                    >
                        {showOld ? __('Ocultar las anteriores') : sprintf(__('Ver las anteriores (%d)'), older.length)}
                    </button>
                    {showOld && (
                        <ul className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-2">
                            {older.map((s) => (
                                <li key={s.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                                    <SubscriptionStatusChip status={s.status} />
                                    <span className="imcrm-font-medium">{s.plan_name ?? s.title}</span>
                                    <span className="imcrm-text-muted-foreground">
                                        {formatMoney(s.amount, s.currency)} {frequencyText(s.frequency, s.frequency_type)} · {__('creada')} {formatDateTimeStr(s.created_at)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {subscribing && (
                <SubscribeDialog
                    data={data}
                    listId={listId}
                    recordId={recordId}
                    onClose={() => setSubscribing(false)}
                    onCreated={() => {
                        setSubscribing(false);
                        refresh();
                    }}
                />
            )}
            {choosingColumns && <SubscriptionColumnsDialog listId={listId} onClose={() => setChoosingColumns(false)} onSaved={() => { setChoosingColumns(false); refresh(); }} />}
        </section>
    );
}

export function SubscriptionStatusChip({ status, className }: { status: Subscription['status']; className?: string }): JSX.Element {
    const opt = statusOption(status);
    return (
        <span
            data-testid="imcrm-subscription-status"
            data-status={status}
            className={cn('imcrm-inline-flex imcrm-items-center imcrm-rounded-full imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-semibold imcrm-text-white', className)}
            style={{ backgroundColor: opt.color }}
        >
            {__(opt.label)}
        </span>
    );
}

function SubscriptionCard({ sub, canEdit, onChanged }: { sub: SubscriptionWithCharges; canEdit: boolean; onChanged: () => void }): JSX.Element {
    const toast = useToast();
    const [dialog, setDialog] = useState<'cancel' | 'amount' | null>(null);
    const act = useMutation({
        mutationFn: (action: 'pause' | 'resume' | 'verify') => api.subscriptionAction(sub.id, action),
        onSuccess: (next, action) => {
            onChanged();
            if (action === 'verify') toast.info(__('Consultado'), statusSentence(next));
            else toast.success(action === 'pause' ? __('Suscripción pausada') : __('Suscripción reanudada'), statusSentence(next));
        },
        onError: (err) => toast.error(__('No se pudo'), errText(err)),
    });
    const live = isLiveSubscriptionStatus(sub.status);
    const details: string[] = [];
    if (sub.next_charge_at && live && sub.status !== 'paused') details.push(`${__('próximo cobro')} ${formatDate(new Date(sub.next_charge_at))}`);
    if (sub.paid_until) details.push(`${__('pagado hasta')} ${formatDate(new Date(sub.paid_until))}`);
    if (sub.charges_paid > 0) details.push(sprintf(__('%d cuotas pagadas'), sub.charges_paid));
    if (sub.cycles) details.push(cyclesText(sub.cycles));
    return (
        <div className="imcrm-mt-3 imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-subscription-card">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-gap-3">
                <IntegrationLogo integrationKey={sub.provider} size={32} />
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <p className="imcrm-flex imcrm-flex-wrap imcrm-items-baseline imcrm-gap-x-2 imcrm-text-sm">
                        <span className="imcrm-font-semibold" data-testid="imcrm-subscription-amount">
                            {formatMoney(sub.amount, sub.currency)}
                        </span>
                        <span className="imcrm-text-muted-foreground">{frequencyText(sub.frequency, sub.frequency_type)}</span>
                        <span className="imcrm-truncate imcrm-text-muted-foreground">· {sub.plan_name ?? sub.title}</span>
                    </p>
                    <p className={cn('imcrm-text-xs', sub.status === 'expired' || sub.status === 'past_due' ? 'imcrm-text-destructive' : 'imcrm-text-muted-foreground')} data-testid="imcrm-subscription-sentence">
                        {statusSentence(sub)}
                    </p>
                    {details.length > 0 && <p className="imcrm-text-xs imcrm-text-muted-foreground">{details.join(' · ')}</p>}
                    {sub.payer_email && <p className="imcrm-text-xs imcrm-text-muted-foreground">{sub.payer_email}</p>}
                </div>
            </div>

            {sub.status === 'pending' && sub.url && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted/60 imcrm-px-3 imcrm-py-2 imcrm-text-xs">
                    <span className="imcrm-flex-1">
                        {sub.provider === 'paypal' ? __('Mándale este link al cliente para que apruebe la suscripción en PayPal:') : __('Mándale este link al cliente para que autorice su tarjeta:')}
                    </span>
                    <CopyButton value={sub.url} label={__('Copiar link')} testId="imcrm-subscription-copy" />
                    <a
                        href={sub.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="imcrm-inline-flex imcrm-items-center imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                        title={sub.provider === 'paypal' ? __('Abrir la página de PayPal') : __('Abrir la página de Mercado Pago')}
                    >
                        <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                    </a>
                </div>
            )}

            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1">
                {sub.connection_id !== null && (
                    <SmallAction onClick={() => act.mutate('verify')} disabled={act.isPending} testId="imcrm-subscription-verify" title={sub.provider === 'paypal' ? __('Preguntarle a PayPal cómo va') : __('Preguntarle a Mercado Pago cómo va')}>
                        <RefreshCw className={cn('imcrm-h-3.5 imcrm-w-3.5', act.isPending && act.variables === 'verify' && 'imcrm-animate-spin')} />
                        {__('Verificar')}
                    </SmallAction>
                )}
                {canEdit && live && sub.connection_id !== null && (
                    <>
                        {sub.status === 'paused' ? (
                            <SmallAction onClick={() => act.mutate('resume')} disabled={act.isPending} testId="imcrm-subscription-resume">
                                <Play className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Reanudar')}
                            </SmallAction>
                        ) : (
                            sub.status !== 'pending' && (
                                <SmallAction onClick={() => act.mutate('pause')} disabled={act.isPending} testId="imcrm-subscription-pause">
                                    <Pause className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Pausar')}
                                </SmallAction>
                            )
                        )}
                        {sub.status !== 'pending' && (
                            <SmallAction onClick={() => setDialog('amount')} testId="imcrm-subscription-amount-change">
                                <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Cambiar el valor')}
                            </SmallAction>
                        )}
                        <SmallAction onClick={() => setDialog('cancel')} danger testId="imcrm-subscription-cancel">
                            <Ban className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Cancelar')}
                        </SmallAction>
                    </>
                )}
            </div>

            {sub.charges.length > 0 && (
                <div>
                    <p className="imcrm-mb-1 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{__('Cobros')}</p>
                    <ul className="imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border" data-testid="imcrm-subscription-charges">
                        {sub.charges.map((c) => (
                            <li key={c.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-0.5 imcrm-px-3 imcrm-py-1.5 imcrm-text-xs" data-status={c.status}>
                                <span
                                    className={cn(
                                        'imcrm-font-medium',
                                        c.status === 'approved' && 'imcrm-text-emerald-700 dark:imcrm-text-emerald-400',
                                        c.status === 'rejected' && 'imcrm-text-destructive',
                                    )}
                                >
                                    {__(SUBSCRIPTION_CHARGE_STATUS_LABELS[c.status])}
                                </span>
                                <span>{formatMoney(c.amount, c.currency)}</span>
                                <span className="imcrm-text-muted-foreground">{formatDateTimeStr(c.paid_at ?? c.period_start ?? c.created_at)}</span>
                                {c.attempt !== null && c.attempt > 0 && <span className="imcrm-text-muted-foreground">{sprintf(__('reintento %d'), c.attempt)}</span>}
                                {c.method && <span className="imcrm-text-muted-foreground">{c.method}</span>}
                                {c.failure_reason && <span className="imcrm-basis-full imcrm-text-muted-foreground">{c.failure_reason}</span>}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {dialog && <SubscriptionChangeDialog kind={dialog} sub={sub} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChanged(); }} />}
        </div>
    );
}

function SmallAction({
    children,
    onClick,
    disabled,
    danger,
    title,
    testId,
}: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    danger?: boolean;
    title?: string;
    testId?: string;
}): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            data-testid={testId}
            className={cn(
                'imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1.5 imcrm-py-1 imcrm-text-xs imcrm-text-muted-foreground disabled:imcrm-opacity-50',
                danger ? 'hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive' : 'hover:imcrm-bg-accent hover:imcrm-text-foreground',
            )}
        >
            {children}
        </button>
    );
}

/** Cancelar (con motivo) o cambiar el valor de los próximos cobros. */
function SubscriptionChangeDialog({
    kind,
    sub,
    onClose,
    onDone,
}: {
    kind: 'cancel' | 'amount';
    sub: Subscription;
    onClose: () => void;
    onDone: () => void;
}): JSX.Element {
    const toast = useToast();
    const [reason, setReason] = useState('');
    const [amount, setAmount] = useState(String(sub.amount));
    const [error, setError] = useState<string | null>(null);
    const save = useMutation({
        mutationFn: () => (kind === 'cancel' ? api.cancelSubscription(sub.id, reason.trim() || null) : api.changeSubscriptionAmount(sub.id, parseLocalAmount(amount))),
        onSuccess: (next) => {
            toast.success(kind === 'cancel' ? __('Suscripción cancelada') : __('Valor cambiado'), kind === 'cancel' ? sprintf(__('%s ya no le cobra al cliente.'), providerLabel(sub.provider)) : sprintf(__('Desde el próximo cobro: %s.'), formatMoney(next.amount, next.currency)));
            onDone();
        },
        onError: (err) => setError(errText(err)),
    });
    const amountValue = parseLocalAmount(amount);
    return (
        <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="imcrm-subscription-change-dialog"
                >
                    <div className="imcrm-mb-3 imcrm-flex imcrm-items-start imcrm-gap-3">
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {kind === 'cancel' ? __('¿Cancelar la suscripción?') : __('Cambiar el valor')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {kind === 'cancel'
                                    ? sprintf(
                                          __('Se cancela en %s y no se le vuelve a cobrar. Lo ya cobrado no se devuelve. No se puede deshacer: para volver a cobrarle hay que crear otra suscripción.'),
                                          providerLabel(sub.provider),
                                      )
                                    : sprintf(__('El valor nuevo se cobra desde el próximo período. %s le avisa al cliente del cambio.'), providerLabel(sub.provider))}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent" aria-label={__('Cerrar')}>
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Dialog.Close>
                    </div>
                    <form
                        className="imcrm-flex imcrm-flex-col imcrm-gap-3"
                        onSubmit={(e) => {
                            e.preventDefault();
                            setError(null);
                            save.mutate();
                        }}
                    >
                        {kind === 'cancel' ? (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="sub-reason">{__('Motivo (opcional)')}</Label>
                                <Textarea id="sub-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={2} data-testid="imcrm-subscription-reason" />
                            </div>
                        ) : (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="sub-amount">{sprintf(__('Valor nuevo (%s)'), sub.currency)}</Label>
                                <Input id="sub-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="imcrm-subscription-new-amount" />
                                {amountValue > 0 && <p className="imcrm-text-xs imcrm-text-muted-foreground">{formatMoney(amountValue, sub.currency)} {frequencyText(sub.frequency, sub.frequency_type)}</p>}
                            </div>
                        )}
                        {error && <p className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive">{error}</p>}
                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Button type="button" variant="ghost" onClick={onClose}>
                                {__('Volver')}
                            </Button>
                            <Button
                                type="submit"
                                variant={kind === 'cancel' ? 'destructive' : 'default'}
                                disabled={save.isPending || (kind === 'amount' && amountValue <= 0)}
                                data-testid="imcrm-subscription-change-confirm"
                            >
                                {save.isPending && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                                {kind === 'cancel' ? __('Cancelar la suscripción') : __('Guardar el valor')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function SubscribeDialog({
    data,
    listId,
    recordId,
    onClose,
    onCreated,
}: {
    data: RecordSubscriptions;
    listId: number;
    recordId: number;
    onClose: () => void;
    onCreated: (sub: Subscription) => void;
}): JSX.Element {
    const toast = useToast();
    const [planId, setPlanId] = useState<number>(data.plans[0]!.id);
    const plan = data.plans.find((p) => p.id === planId) ?? data.plans[0]!;
    const [email, setEmail] = useState(data.suggested.payer_email ?? '');
    const [amount, setAmount] = useState('');
    const [start, setStart] = useState('');
    const [error, setError] = useState<string | null>(null);
    const create = useMutation({
        mutationFn: () =>
            api.createSubscription(listId, recordId, {
                plan_id: planId,
                payer_email: email.trim(),
                amount: amount.trim() === '' ? null : parseLocalAmount(amount),
                start_date: start || null,
                title: null,
            }),
        onSuccess: (sub) => {
            if (sub.url) void navigator.clipboard?.writeText(sub.url).catch(() => undefined);
            toast.success(
                __('Suscripción creada'),
                sub.provider === 'paypal'
                    ? __('El link ya está copiado: mándaselo al cliente para que apruebe la suscripción en PayPal.')
                    : __('El link ya está copiado: mándaselo al cliente para que autorice su tarjeta.'),
            );
            onCreated(sub);
        },
        onError: (err) => setError(errText(err)),
    });
    const value = amount.trim() === '' ? plan.amount : parseLocalAmount(amount);
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    return (
        <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="imcrm-subscribe-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <IntegrationLogo integrationKey={plan.provider === 'paypal' ? 'paypal' : 'mercadopago'} size={40} />
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Suscribir')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {plan.provider === 'paypal'
                                    ? __('Se crea un link de PayPal. Cuando el cliente aprueba la suscripción con su cuenta PayPal o tarjeta, se le cobra solo cada período y el registro se actualiza con cada cobro.')
                                    : __('Se crea un link de Mercado Pago. Cuando el cliente autoriza su tarjeta, se le cobra solo cada período y el registro se actualiza con cada cobro.')}
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
                            if (validEmail && value > 0) create.mutate();
                        }}
                    >
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="sub-plan">{__('Plan')}</Label>
                            <Select id="sub-plan" value={String(planId)} onChange={(e) => setPlanId(Number(e.target.value))} data-testid="imcrm-subscribe-plan">
                                {data.plans.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name} · {formatMoney(p.amount, p.currency)} {frequencyText(p.frequency, p.frequency_type)}
                                    </option>
                                ))}
                            </Select>
                            {plan.trial_days > 0 && <p className="imcrm-text-xs imcrm-text-muted-foreground">{sprintf(__('Incluye %d días gratis antes del primer cobro.'), plan.trial_days)}</p>}
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="sub-email">{__('Correo del cliente')}</Label>
                            <Input id="sub-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="imcrm-subscribe-email" />
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">{sprintf(__('%s lo pide: la suscripción queda a nombre de ese correo.'), providerLabel(plan.provider))}</p>
                        </div>
                        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="sub-value">{__('Valor (opcional)')}</Label>
                                <Input id="sub-value" inputMode="decimal" placeholder={String(plan.amount)} value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="imcrm-subscribe-amount" />
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="sub-start">{__('Primer cobro (opcional)')}</Label>
                                <Input id="sub-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="imcrm-subscribe-start" />
                            </div>
                        </div>
                        {value > 0 && (
                            <p className="imcrm-rounded-md imcrm-bg-muted/60 imcrm-px-3 imcrm-py-2 imcrm-text-xs" data-testid="imcrm-subscribe-summary">
                                {__('Se cobra')} <strong>{formatMoney(value, plan.currency)}</strong> {frequencyText(plan.frequency, plan.frequency_type)}
                                {start
                                    ? `, ${__('desde el')} ${formatDate(new Date(`${start}T12:00:00`))}`
                                    : plan.provider === 'paypal'
                                      ? `, ${__('desde que la aprueba en PayPal')}`
                                      : `, ${__('desde que autoriza la tarjeta en Mercado Pago')}`}
                                {plan.cycles ? ` · ${cyclesText(plan.cycles)}` : ''}.
                            </p>
                        )}
                        {error && (
                            <p className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-subscribe-error">
                                {error}
                            </p>
                        )}
                        <div className="imcrm-mt-1 imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Button type="button" variant="ghost" onClick={onClose}>
                                {__('Cancelar')}
                            </Button>
                            <Button type="submit" disabled={!validEmail || value <= 0 || create.isPending} data-testid="imcrm-subscribe-create">
                                {create.isPending && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                                {__('Crear la suscripción')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function SubscriptionColumnsDialog({ listId, onClose, onSaved }: { listId: number; onClose: () => void; onSaved: () => void }): JSX.Element {
    const fields = useFields(listId);
    return (
        <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-xl imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="imcrm-subscription-columns-dialog"
                >
                    <div className="imcrm-mb-3 imcrm-flex imcrm-items-start imcrm-gap-3">
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Columnas y registro de cobros')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Cada cambio de la suscripción (un cobro, un rechazo, la mora) se escribe en estas columnas. Así filtras quién está al día y agrupas por estado.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent" aria-label={__('Cerrar')}>
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Dialog.Close>
                    </div>
                    {fields.data ? (
                        <SubscriptionFieldsEditor listId={listId} fields={fields.data} onSaved={onSaved} />
                    ) : (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Cargando…')}</p>
                    )}
                    {/* v0.1.371 — cada cobro como un registro en otra lista (con su tablero). */}
                    <section className="imcrm-mt-5 imcrm-border-t imcrm-border-border imcrm-pt-4" data-tour="subscription-charge-log">
                        <h3 className="imcrm-text-sm imcrm-font-semibold">{__('Registro de cobros')}</h3>
                        <p className="imcrm-mb-2 imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Cada cobro (pagado, rechazado o reembolsado) queda como un registro en otra lista, vinculado a este cliente: lo filtras, lo sumas y lo graficas como cualquier dato.')}
                        </p>
                        <SubscriptionChargeLogEditor listId={listId} />
                    </section>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function errText(err: unknown): string {
    if (err instanceof CloudApiError) return err.message;
    return err instanceof Error ? err.message : String(err);
}

/** Sin el módulo de integraciones en el plan, no aparece. */
/** «Mercado Pago» / «PayPal». */
function providerLabel(provider: string): string {
    return provider === 'paypal' ? 'PayPal' : 'Mercado Pago';
}

export function RecordSubscriptionPanel(props: Parameters<typeof RecordSubscriptionPanelInner>[0]): JSX.Element | null {
    const off = usePlanModuleOff('integrations');
    return off ? null : <RecordSubscriptionPanelInner {...props} />;
}
