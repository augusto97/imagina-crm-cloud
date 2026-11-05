import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    DEFAULT_RECONCILE_INTERVAL,
    PLATFORM_RECONCILE_INTERVALS,
    reconcileIntervalLabel,
    type PlatformPaymentsView,
    type PlatformReconcileRun,
} from '@imagina-base/shared';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';

import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';

const DATETIME = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const TIME = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' });

/**
 * v0.1.382 — Plataforma → Cobros → «Revisión de respaldo». Los avisos de
 * Mercado Pago y PayPal pueden no llegar (servidor apagado, URL cambiada,
 * sin clave secreta): cada cierto tiempo la app busca ella misma los pagos
 * recientes, relee las renovaciones automáticas y las órdenes abiertas y
 * aplica lo que falte. Aquí se elige cada cuánto y se corre en el momento.
 */
export function PlatformReconcileCard(): JSX.Element | null {
    const qc = useQueryClient();
    const q = useQuery({
        queryKey: ['platform-payments'],
        queryFn: () => api.platformPaymentsGet(),
        retry: false,
        // Mientras corre, se pregunta seguido para mostrar el resultado apenas termina.
        refetchInterval: (query) => (query.state.data?.reconcile.running ? 2000 : false),
    });
    const status = q.data?.reconcile;
    // El selector se mueve al tocarlo (no espera al servidor).
    const [interval, setIntervalValue] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const wasRunning = useRef(false);

    useEffect(() => {
        if (!status) return;
        if (wasRunning.current && !status.running) {
            void qc.invalidateQueries({ queryKey: ['platform-payments-recent'] });
        }
        wasRunning.current = status.running;
    }, [status, qc]);

    const saveInterval = useMutation({
        mutationFn: (minutes: number) => api.platformPaymentsUpdate({ reconcile_interval_minutes: minutes }),
        onSuccess: (data) => {
            qc.setQueryData(['platform-payments'], data);
            setIntervalValue(null);
            setError(null);
        },
        onError: (err) => {
            setIntervalValue(null);
            setError(err instanceof CloudApiError ? err.message : __('No se pudo guardar la frecuencia'));
        },
    });
    const runNow = useMutation({
        mutationFn: () => api.platformPaymentsReconcile(),
        onSuccess: (reconcile) => {
            qc.setQueryData<PlatformPaymentsView>(['platform-payments'], (prev) => (prev ? { ...prev, reconcile } : prev));
            setError(null);
        },
        onError: (err) => setError(err instanceof CloudApiError ? err.message : __('No se pudo empezar la revisión')),
    });

    if (q.isError || !q.data || !status) return null;
    const current = interval ?? status.interval_minutes;
    const running = status.running || runNow.isPending;
    const anyProvider = q.data.mercadopago.configured || q.data.paypal.configured;

    return (
        <Card data-testid="platform-reconcile" data-tour="platform-payments-reconcile">
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <ShieldCheck className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>{__('Revisión de respaldo')}</CardTitle>
                        <CardDescription>
                            {__('Si un aviso de Mercado Pago o PayPal no llega (el servidor estaba apagado, la URL cambió o falta la clave secreta), la app igual se entera: cada cierto tiempo busca los pagos recientes, relee las renovaciones automáticas y las órdenes abiertas, y aplica lo que falte. Nada se aplica dos veces.')}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-4 imcrm-pt-0">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-end imcrm-gap-3">
                    <div className="imcrm-w-full imcrm-max-w-xs imcrm-space-y-1.5">
                        <Label htmlFor="reconcile-interval">{__('Cada cuánto revisar')}</Label>
                        <Select
                            id="reconcile-interval"
                            data-testid="reconcile-interval"
                            value={String(current)}
                            disabled={saveInterval.isPending}
                            onChange={(e) => {
                                const minutes = Number(e.target.value);
                                setIntervalValue(minutes);
                                saveInterval.mutate(minutes);
                            }}
                        >
                            {PLATFORM_RECONCILE_INTERVALS.map((m) => (
                                <option key={m} value={m}>
                                    {reconcileIntervalLabel(m)}
                                    {m === DEFAULT_RECONCILE_INTERVAL ? ` ${__('(recomendado)')}` : ''}
                                </option>
                            ))}
                        </Select>
                    </div>
                    <Button onClick={() => runNow.mutate()} disabled={running || !anyProvider} data-testid="reconcile-run">
                        <RefreshCw className={running ? 'imcrm-h-4 imcrm-w-4 imcrm-animate-spin' : 'imcrm-h-4 imcrm-w-4'} />
                        {running ? __('Revisando…') : __('Revisar ahora')}
                    </Button>
                </div>
                <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="reconcile-next">
                    {!anyProvider
                        ? __('Carga las credenciales de Mercado Pago arriba para que haya algo que revisar.')
                        : current === 0
                          ? __('Apagada: sólo se aplica lo que llega por los avisos. Puedes revisar a mano cuando quieras.')
                          : status.next_at
                            ? __('Próxima revisión automática: %s (aproximado).').replace('%s', whenText(status.next_at))
                            : null}
                </p>
                {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
                {running && !status.last && <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Revisando en Mercado Pago y PayPal…')}</p>}
                {status.last && <LastRun run={status.last} running={running} />}
            </CardContent>
        </Card>
    );
}

/** «hoy 11:45 p. m.» o «6 nov, 9:00 a. m.». */
function whenText(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    if (d.getTime() - now.getTime() < 90_000) return __('en unos minutos');
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay ? `${__('hoy')} ${TIME.format(d)}` : DATETIME.format(d);
}

function LastRun({ run, running }: { run: PlatformReconcileRun; running: boolean }): JSX.Element {
    const parts: string[] = [];
    if (run.checked.payments > 0 || run.checked.subscriptions === 0) {
        parts.push(run.checked.payments === 1 ? __('1 pago') : __('%s pagos').replace('%s', String(run.checked.payments)));
    }
    if (run.checked.subscriptions > 0) {
        parts.push(run.checked.subscriptions === 1 ? __('1 renovación automática') : __('%s renovaciones automáticas').replace('%s', String(run.checked.subscriptions)));
    }
    if (run.checked.orders > 0) {
        parts.push(run.checked.orders === 1 ? __('1 orden de PayPal') : __('%s órdenes de PayPal').replace('%s', String(run.checked.orders)));
    }
    const tone = run.skipped ? 'muted' : run.errors.length > 0 ? 'err' : run.applied > 0 ? 'changed' : 'ok';
    const box =
        tone === 'err'
            ? 'imcrm-border-destructive/30 imcrm-bg-destructive/10'
            : tone === 'changed'
              ? 'imcrm-border-primary/30 imcrm-bg-primary/5'
              : tone === 'ok'
                ? 'imcrm-border-success/30 imcrm-bg-success/10'
                : 'imcrm-border-border imcrm-bg-muted/40';
    let title: string;
    if (run.skipped) title = run.skipped;
    else if (run.applied === 0) title = run.errors.length > 0 ? __('No se pudo revisar todo') : __('Todo estaba al día: no faltaba ningún cambio.');
    else title = run.applied === 1 ? __('Se aplicó 1 cambio que no había llegado por aviso') : __('Se aplicaron %s cambios que no habían llegado por aviso').replace('%s', String(run.applied));

    return (
        <div className={`imcrm-rounded-md imcrm-border imcrm-p-3 ${box}`} data-testid="reconcile-last" data-tone={tone} aria-busy={running}>
            <p className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                {__('Última revisión')}: {DATETIME.format(new Date(run.started_at))} · {run.trigger === 'manual' ? __('a mano') : __('automática')}
            </p>
            <p className={`imcrm-mt-0.5 imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium ${tone === 'err' ? 'imcrm-text-destructive' : tone === 'muted' ? 'imcrm-text-foreground' : tone === 'ok' ? 'imcrm-text-success' : 'imcrm-text-foreground'}`}>
                {tone === 'err' ? (
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                ) : tone === 'ok' ? (
                    <CheckCircle2 className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                ) : null}
                <span>{title}</span>
            </p>
            {!run.skipped && (
                <p className="imcrm-mt-0.5 imcrm-text-sm imcrm-text-muted-foreground">
                    {(singleCheck(run) ? __('Se revisó %s.') : __('Se revisaron %s.')).replace('%s', joinParts(parts))}
                </p>
            )}
            {run.changes.length > 0 && (
                <ul className="imcrm-mt-2 imcrm-space-y-1 imcrm-text-sm" data-testid="reconcile-changes">
                    {run.changes.map((c, i) => (
                        <li key={`${c.tenant_id}-${i}`} className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-1.5">
                            <span className="imcrm-font-medium">{c.tenant_name}</span>
                            <span className="imcrm-text-muted-foreground">— {c.text}</span>
                            <span className="imcrm-text-xs imcrm-text-muted-foreground">({c.provider === 'mercadopago' ? 'Mercado Pago' : 'PayPal'})</span>
                        </li>
                    ))}
                    {run.applied > run.changes.length && (
                        <li className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('…y %s más (están en «Pagos recientes»).').replace('%s', String(run.applied - run.changes.length))}
                        </li>
                    )}
                </ul>
            )}
            {run.errors.length > 0 && (
                <ul className="imcrm-mt-2 imcrm-list-disc imcrm-space-y-1 imcrm-pl-5 imcrm-text-sm imcrm-text-destructive" data-testid="reconcile-errors">
                    {run.errors.map((e) => (
                        <li key={e}>{e}</li>
                    ))}
                </ul>
            )}
            {run.errors.length > 0 && (
                <p className="imcrm-mt-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                    {__('La próxima revisión vuelve a buscar desde la última que salió bien: no se pierde nada.')}
                </p>
            )}
        </div>
    );
}

/** «Se revisó 1 pago» / «Se revisaron 3 pagos y 1 renovación»: el verbo concuerda. */
function singleCheck(run: PlatformReconcileRun): boolean {
    const { payments, subscriptions, orders } = run.checked;
    const kinds = [payments, subscriptions, orders].filter((n) => n > 0);
    return kinds.length === 1 && kinds[0] === 1;
}

function joinParts(parts: string[]): string {
    if (parts.length <= 1) return parts[0] ?? __('0 pagos');
    return `${parts.slice(0, -1).join(', ')} ${__('y')} ${parts[parts.length - 1]}`;
}
