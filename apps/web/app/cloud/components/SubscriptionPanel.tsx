import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    BILLING_GRACE_DAYS,
    PERIOD_MONTHS,
    type BillingPayment,
    type CheckoutMode,
    type PaymentProvider,
    type Plan,
    type PlanPrice,
    type SubscriptionInfo,
} from '@imagina-base/shared';
import { AlertTriangle, CalendarClock, CircleCheck, CreditCard, ExternalLink, History, Loader2, Repeat } from 'lucide-react';
import { CloudApiError } from '@/lib/cloud/client';
import { api, useSession } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
    paypal: 'PayPal',
    mercadopago: 'Mercado Pago',
};
const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const DATE = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
const DAY = 24 * 60 * 60 * 1000;

function money(amount: number, currency: string): string {
    return currency === 'USD' ? USD.format(amount) : COP.format(amount);
}
function fmtDate(iso: string | null): string {
    return iso ? DATE.format(new Date(iso)) : '—';
}

/** Un proveedor sólo aplica si el plan tiene precio en su moneda. */
function priceFor(p: PlanPrice, provider: PaymentProvider): number | null {
    return provider === 'paypal' ? p.usd : p.cop;
}

const SUB_KEY = (tenantId: number | null) => ['billing-subscription', tenantId];

/**
 * Suscripción (ADR-S12, rehecho en v0.1.250). Sólo admin.
 *  - Arriba, el ESTADO: hasta cuándo está pagado, la gracia y la renovación
 *    automática (con su cancelación).
 *  - Pagar: elegir plan y, o bien N meses de una vez (PSE, Nequi, tarjeta,
 *    efectivo), o bien la renovación automática con tarjeta.
 *  - El historial de pagos con método, monto y hasta cuándo dejó pagado.
 */
export function SubscriptionPanel({ currentPlan }: { currentPlan: Plan }): JSX.Element | null {
    const tenantId = useSession((s) => s.activeTenantId);
    const cfg = useQuery({ queryKey: ['payments-config', tenantId], queryFn: () => api.paymentsConfig() });
    const info = useQuery({ queryKey: SUB_KEY(tenantId), queryFn: () => api.subscriptionInfo() });

    if (!cfg.data || !info.data) {
        return <div className="imcrm-h-56 imcrm-animate-pulse imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-muted/40" />;
    }
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="subscription-panel">
            <StatusCard info={info.data} />
            <PayCard
                currentPlan={currentPlan}
                plans={cfg.data.plans}
                providers={cfg.data.providers}
                subscriptionProviders={cfg.data.subscription_providers}
                info={info.data}
            />
            <HistoryCard payments={info.data.payments} />
        </div>
    );
}

// ── Estado ─────────────────────────────────────────────────────────────

function StatusCard({ info }: { info: SubscriptionInfo }): JSX.Element {
    const tenantId = useSession((s) => s.activeTenantId);
    const qc = useQueryClient();
    const confirm = useConfirm();
    const cancel = useMutation({
        mutationFn: () => api.cancelAutoRenew(),
        onSuccess: (data) => {
            qc.setQueryData(SUB_KEY(tenantId), data);
            void qc.invalidateQueries({ queryKey: ['billing', tenantId] });
        },
    });
    const now = Date.now();
    const paid = info.paid_until ? new Date(info.paid_until).getTime() : null;
    const cut = info.read_only_at ? new Date(info.read_only_at).getTime() : null;
    const ar = info.auto_renew;

    let tone: 'ok' | 'warn' | 'bad' | 'none' = 'none';
    let headline = 'Todavía no pagaste un período desde la app.';
    let detail: string | null = null;
    if (paid !== null && cut !== null) {
        if (now < paid) {
            const days = Math.ceil((paid - now) / DAY);
            tone = days <= 3 && ar?.status !== 'authorized' ? 'warn' : 'ok';
            headline = `Pagado hasta el ${fmtDate(info.paid_until)}`;
            detail = days === 1 ? 'Queda 1 día.' : `Quedan ${days} días.`;
        } else if (now < cut) {
            tone = 'warn';
            headline = `Venció el ${fmtDate(info.paid_until)}`;
            detail = `Tenés hasta el ${fmtDate(info.read_only_at)} para renovar. Después el espacio pasa a solo-lectura (tus datos se conservan).`;
        } else {
            tone = 'bad';
            headline = `Venció el ${fmtDate(info.paid_until)}: el espacio está en solo-lectura`;
            detail = 'Tus datos están intactos y se pueden consultar y exportar. Al pagar, se reactiva al instante.';
        }
    }

    const onCancel = async (): Promise<void> => {
        const ok = await confirm({
            title: 'Cancelar la renovación automática',
            description: `Mercado Pago deja de cobrar tu tarjeta. Lo que ya pagaste se conserva${
                info.paid_until ? ` hasta el ${fmtDate(info.paid_until)}` : ''
            }; después podés pagar por períodos cuando quieras.`,
            confirmLabel: 'Cancelar la renovación',
            cancelLabel: 'Volver',
            destructive: true,
        });
        if (ok) cancel.mutate();
    };

    const toneClass = {
        ok: 'imcrm-border-success/25 imcrm-bg-success/10 imcrm-text-success',
        warn: 'imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-text-warning',
        bad: 'imcrm-border-destructive/30 imcrm-bg-destructive/10 imcrm-text-destructive',
        none: 'imcrm-border-border imcrm-bg-muted/40 imcrm-text-muted-foreground',
    }[tone];
    const ToneIcon = tone === 'ok' ? CircleCheck : tone === 'none' ? CalendarClock : AlertTriangle;

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <CalendarClock className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>Tu suscripción</CardTitle>
                        <CardDescription>
                            Plan <span className="imcrm-font-medium imcrm-capitalize imcrm-text-foreground">{info.plan}</span>. Cada pago extiende el período; al vencer hay {BILLING_GRACE_DAYS} días de gracia.
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-3 imcrm-pt-0">
                <div className={cn('imcrm-flex imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-sm', toneClass)} data-testid="subscription-status" data-tone={tone}>
                    <ToneIcon className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                    <div>
                        <p className="imcrm-font-medium">{headline}</p>
                        {detail && <p className="imcrm-mt-0.5 imcrm-opacity-90">{detail}</p>}
                    </div>
                </div>
                {info.manual_ends_at && (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        Además, el operador fijó un corte manual el {fmtDate(info.manual_ends_at)}.
                    </p>
                )}

                {ar && (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3" data-testid="auto-renew" data-status={ar.status}>
                        <div className="imcrm-flex imcrm-items-start imcrm-gap-2.5 imcrm-text-sm">
                            <Repeat className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                            <div>
                                {ar.status === 'authorized' && (
                                    <>
                                        <p className="imcrm-font-medium">Renovación automática activa</p>
                                        <p className="imcrm-text-muted-foreground">
                                            {money(ar.amount, ar.currency)} por mes con tarjeta (Mercado Pago)
                                            {ar.next_payment_at ? ` · próximo cobro el ${fmtDate(ar.next_payment_at)}` : ''}.
                                        </p>
                                    </>
                                )}
                                {ar.status === 'pending' && (
                                    <>
                                        <p className="imcrm-font-medium">Falta autorizar la tarjeta</p>
                                        <p className="imcrm-text-muted-foreground">
                                            La renovación de {money(ar.amount, ar.currency)}/mes queda activa cuando termines en Mercado Pago.
                                        </p>
                                    </>
                                )}
                                {ar.status === 'paused' && (
                                    <>
                                        <p className="imcrm-font-medium">Renovación en pausa</p>
                                        <p className="imcrm-text-muted-foreground">
                                            Mercado Pago no pudo cobrar la tarjeta y la pausó. Revisá el medio de pago en tu cuenta de Mercado Pago o pagá por período.
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="imcrm-flex imcrm-gap-2">
                            {ar.status === 'pending' && ar.authorize_url && (
                                <Button size="sm" asChild>
                                    <a href={ar.authorize_url}>
                                        Terminar en Mercado Pago <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </a>
                                </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => void onCancel()} disabled={cancel.isPending} data-testid="auto-renew-cancel">
                                {cancel.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : null}
                                {ar.status === 'pending' ? 'Descartar' : 'Cancelar renovación'}
                            </Button>
                        </div>
                    </div>
                )}
                {cancel.isError && (
                    <p className="imcrm-text-sm imcrm-text-destructive">
                        {cancel.error instanceof CloudApiError ? cancel.error.message : 'No se pudo cancelar la renovación.'}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

// ── Pagar ──────────────────────────────────────────────────────────────

function PayCard({
    currentPlan,
    plans,
    providers,
    subscriptionProviders,
    info,
}: {
    currentPlan: Plan;
    plans: PlanPrice[];
    providers: PaymentProvider[];
    subscriptionProviders: PaymentProvider[];
    info: SubscriptionInfo;
}): JSX.Element {
    const userEmail = useSession((s) => s.user?.email ?? '');
    const initialPlan = plans.some((p) => p.slug === currentPlan) ? currentPlan : (plans[0]?.slug ?? '');
    const [plan, setPlan] = useState<Plan>(initialPlan);
    const [mode, setMode] = useState<CheckoutMode>('period');
    const [months, setMonths] = useState<number>(1);
    const [email, setEmail] = useState(userEmail);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => setEmail((e) => e || userEmail), [userEmail]);

    const selected = plans.find((p) => p.slug === plan) ?? null;
    const canSubscribe = selected !== null && subscriptionProviders.some((p) => priceFor(selected, p) !== null);
    const effectiveMode: CheckoutMode = canSubscribe ? mode : 'period';
    const renewing = info.auto_renew?.status === 'authorized' || info.auto_renew?.status === 'paused';
    const firstCharge = info.paid_until && new Date(info.paid_until).getTime() > Date.now() ? info.paid_until : null;
    const applicable = useMemo(
        () => (selected ? providers.filter((p) => priceFor(selected, p) !== null) : []),
        [selected, providers],
    );

    const go = async (provider: PaymentProvider): Promise<void> => {
        if (!selected) return;
        setBusy(provider);
        setError(null);
        try {
            const res = await api.createCheckout(
                effectiveMode === 'subscription'
                    ? { plan: selected.slug, provider, mode: 'subscription', months: 1, payer_email: email.trim() || undefined }
                    : { plan: selected.slug, provider, mode: 'period', months },
            );
            window.location.href = res.url; // redirige al proveedor
        } catch (e) {
            setError(e instanceof CloudApiError ? e.message : 'No se pudo iniciar el pago');
            setBusy(null);
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <CreditCard className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>Pagar o cambiar de plan</CardTitle>
                        <CardDescription>Pagá varios meses de una vez o dejá la renovación automática con tarjeta.</CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-5 imcrm-pt-0">
                {providers.length === 0 ? (
                    <p className="imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">
                        Los pagos todavía no están configurados en este entorno.
                    </p>
                ) : plans.length === 0 ? (
                    <p className="imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">
                        No hay planes con precio configurado para vender.
                    </p>
                ) : (
                    <>
                        <div role="radiogroup" aria-label="Plan" className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-3">
                            {plans.map((p) => {
                                const active = p.slug === plan;
                                return (
                                    <button
                                        key={p.slug}
                                        type="button"
                                        role="radio"
                                        aria-checked={active}
                                        data-testid="pay-plan"
                                        data-plan={p.slug}
                                        onClick={() => setPlan(p.slug)}
                                        className={cn(
                                            'imcrm-space-y-1 imcrm-rounded-xl imcrm-border imcrm-p-3 imcrm-text-left imcrm-transition-colors',
                                            active
                                                ? 'imcrm-border-primary imcrm-shadow-[0_0_0_3px_hsl(var(--imcrm-primary)/0.12)]'
                                                : 'imcrm-border-border hover:imcrm-border-input',
                                        )}
                                    >
                                        <span className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                                            <span className="imcrm-font-semibold">{p.name}</span>
                                            {currentPlan === p.slug && <Badge dot>Actual</Badge>}
                                        </span>
                                        <span className="imcrm-block imcrm-text-sm imcrm-text-muted-foreground">
                                            {[p.cop !== null ? `${COP.format(p.cop)} / mes` : null, p.usd !== null ? `${USD.format(p.usd)} / mes` : null]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        {canSubscribe && (
                            <div role="tablist" aria-label="Forma de pago" className="imcrm-inline-flex imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-0.5">
                                {(
                                    [
                                        ['period', 'Pagar meses'],
                                        ['subscription', 'Renovación automática'],
                                    ] as const
                                ).map(([m, label]) => (
                                    <button
                                        key={m}
                                        type="button"
                                        role="tab"
                                        aria-selected={effectiveMode === m}
                                        data-testid={`pay-mode-${m}`}
                                        onClick={() => setMode(m)}
                                        className={cn(
                                            'imcrm-rounded-md imcrm-px-3 imcrm-py-1.5 imcrm-text-sm imcrm-transition-colors',
                                            effectiveMode === m ? 'imcrm-bg-background imcrm-font-medium imcrm-shadow-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                                        )}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        )}

                        {selected && effectiveMode === 'period' && (
                            <div className="imcrm-space-y-3">
                                <div>
                                    <p className="imcrm-mb-1.5 imcrm-text-sm imcrm-font-medium">¿Cuántos meses?</p>
                                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                                        {PERIOD_MONTHS.map((m) => (
                                            <button
                                                key={m}
                                                type="button"
                                                data-testid="pay-months"
                                                data-months={m}
                                                aria-pressed={months === m}
                                                onClick={() => setMonths(m)}
                                                className={cn(
                                                    'imcrm-rounded-full imcrm-border imcrm-px-3.5 imcrm-py-1 imcrm-text-sm imcrm-transition-colors',
                                                    months === m
                                                        ? 'imcrm-border-primary imcrm-bg-primary imcrm-text-primary-foreground'
                                                        : 'imcrm-border-border hover:imcrm-border-input',
                                                )}
                                            >
                                                {m === 1 ? '1 mes' : m === 12 ? '1 año' : `${m} meses`}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {info.paid_until && new Date(info.paid_until).getTime() > Date.now()
                                        ? `Se suma a lo que ya tenés: quedaría pagado ${months === 1 ? 'un mes' : `${months} meses`} más desde el ${fmtDate(info.paid_until)}.`
                                        : `Queda pagado ${months === 1 ? 'un mes' : `${months} meses`} desde el día del pago.`}{' '}
                                    Con Mercado Pago podés pagar con PSE, Nequi, tarjeta o en efectivo.
                                </p>
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                                    {applicable.map((provider) => {
                                        const unit = priceFor(selected, provider)!;
                                        return (
                                            <Button key={provider} onClick={() => void go(provider)} disabled={busy !== null} data-testid={`pay-${provider}`}>
                                                {busy === provider
                                                    ? 'Redirigiendo…'
                                                    : `Pagar ${money(unit * months, provider === 'paypal' ? 'USD' : 'COP')} con ${PROVIDER_LABELS[provider]}`}
                                            </Button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {selected && effectiveMode === 'subscription' && (
                            <div className="imcrm-space-y-3" data-testid="pay-subscription">
                                {renewing ? (
                                    <p className="imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">
                                        Ya tenés la renovación automática activa. Para cambiar de plan, cancelala arriba y activala de nuevo: lo que ya pagaste se conserva.
                                    </p>
                                ) : (
                                    <>
                                        <p className="imcrm-text-sm">
                                            Mercado Pago cobra <strong>{COP.format(selected.cop ?? 0)}</strong> a tu tarjeta todos los meses
                                            {firstCharge ? `, empezando el ${fmtDate(firstCharge)} (cuando vence lo que ya pagaste)` : ', empezando hoy'}.
                                            Se cancela cuando quieras.
                                        </p>
                                        <label className="imcrm-block imcrm-max-w-sm imcrm-space-y-1 imcrm-text-sm">
                                            <span className="imcrm-font-medium">Correo de tu cuenta de Mercado Pago</span>
                                            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="pay-email" />
                                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                                Mercado Pago pide que sea el mismo con el que vas a iniciar sesión para autorizar la tarjeta.
                                            </span>
                                        </label>
                                        <Button onClick={() => void go('mercadopago')} disabled={busy !== null} data-testid="pay-subscribe">
                                            {busy ? 'Redirigiendo…' : `Activar renovación automática · ${COP.format(selected.cop ?? 0)}/mes`}
                                        </Button>
                                    </>
                                )}
                            </div>
                        )}
                    </>
                )}
                {error && <p className="imcrm-text-sm imcrm-text-destructive" data-testid="pay-error">{error}</p>}
            </CardContent>
        </Card>
    );
}

// ── Historial ──────────────────────────────────────────────────────────

const STATUS: Record<BillingPayment['status'], { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
    approved: { label: 'Aprobado', variant: 'success' },
    pending: { label: 'Pendiente', variant: 'warning' },
    rejected: { label: 'Rechazado', variant: 'destructive' },
    refunded: { label: 'Devuelto', variant: 'secondary' },
};

function HistoryCard({ payments }: { payments: BillingPayment[] }): JSX.Element {
    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <History className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>Historial de pagos</CardTitle>
                        <CardDescription>Los pagos de tu plan, con el medio y hasta cuándo dejó pagado cada uno.</CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-pt-0">
                {payments.length === 0 ? (
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">Todavía no hay pagos.</p>
                ) : (
                    <ul className="imcrm-divide-y imcrm-divide-border" data-testid="payments-history">
                        {payments.map((p) => (
                            <li key={p.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-x-4 imcrm-gap-y-1 imcrm-py-2.5 imcrm-text-sm" data-testid="payment-row" data-status={p.status}>
                                <div className="imcrm-min-w-0">
                                    <p className="imcrm-font-medium">
                                        <span className="imcrm-capitalize">{p.plan}</span> ·{' '}
                                        {p.kind === 'subscription' ? 'renovación mensual' : p.months === 1 ? '1 mes' : `${p.months} meses`}
                                    </p>
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {fmtDate(p.created_at)}
                                        {p.method ? ` · ${p.method}` : ''} · {PROVIDER_LABELS[p.provider]}
                                        {p.status === 'approved' && p.period_end ? ` · pagado hasta el ${fmtDate(p.period_end)}` : ''}
                                    </p>
                                </div>
                                <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                                    <span className="imcrm-tabular-nums">{money(p.amount, p.currency)}</span>
                                    <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
