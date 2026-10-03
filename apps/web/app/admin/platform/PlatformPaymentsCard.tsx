import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BillingPayment, PlatformPaymentRow } from '@imagina-base/shared';
import { Check, Copy, ExternalLink, KeyRound, Receipt, Wallet } from 'lucide-react';

import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';

const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const DATE = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });

const STATUS: Record<BillingPayment['status'], { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
    approved: { label: 'Aprobado', variant: 'success' },
    pending: { label: 'Pendiente', variant: 'warning' },
    rejected: { label: 'Rechazado', variant: 'destructive' },
    refunded: { label: 'Devuelto', variant: 'secondary' },
};

/**
 * v0.1.250 — Plataforma → Cobros. Las credenciales con las que la plataforma
 * cobra sus planes (Mercado Pago: access token + clave secreta de los avisos,
 * cifradas; el `.env` queda de respaldo) con los pasos para registrar la URL
 * de avisos, y los últimos pagos de todas las empresas.
 */
export function PlatformPaymentsCard(): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="platform-payments">
            <CredentialsCard />
            <RecentCard />
        </div>
    );
}

function CredentialsCard(): JSX.Element | null {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const q = useQuery({ queryKey: ['platform-payments'], queryFn: () => api.platformPaymentsGet(), retry: false });
    const [token, setToken] = useState('');
    const [secret, setSecret] = useState('');
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const [copied, setCopied] = useState(false);

    const save = useMutation({
        mutationFn: (clear: boolean) =>
            api.platformPaymentsUpdate(
                clear
                    ? { clear_mercadopago: true }
                    : {
                          ...(token.trim() ? { mercadopago_access_token: token.trim() } : {}),
                          ...(secret.trim() ? { mercadopago_webhook_secret: secret.trim() } : {}),
                      },
            ),
        onSuccess: (data, clear) => {
            qc.setQueryData(['platform-payments'], data);
            setToken('');
            setSecret('');
            setNotice({ kind: 'ok', text: clear ? __('Credenciales quitadas.') : __('Credenciales guardadas.') });
        },
        onError: (err) => setNotice({ kind: 'err', text: err instanceof CloudApiError ? err.message : __('No se pudo guardar') }),
    });

    if (q.isError) return null;
    if (!q.data) return <div className="imcrm-h-56 imcrm-animate-pulse imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-muted/40" />;
    const mp = q.data.mercadopago;

    const copy = async (): Promise<void> => {
        await navigator.clipboard.writeText(mp.webhook_url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-2">
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                            <Wallet className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div>
                            <CardTitle>{__('Mercado Pago — cobro de los planes')}</CardTitle>
                            <CardDescription>
                                {__('Con esta cuenta se cobran los planes a las empresas: pagos de varios meses (PSE, Nequi, tarjeta, efectivo) y la renovación automática con tarjeta.')}
                            </CardDescription>
                        </div>
                    </div>
                    <div className="imcrm-flex imcrm-gap-1.5" data-testid="mp-status">
                        {mp.configured ? (
                            <>
                                <Badge variant="success" dot>{__('Configurado')}</Badge>
                                {mp.mode && <Badge variant={mp.mode === 'test' ? 'warning' : 'secondary'}>{mp.mode === 'test' ? __('Prueba') : __('Producción')}</Badge>}
                                {mp.from_env && <Badge variant="outline">{__('desde .env')}</Badge>}
                            </>
                        ) : (
                            <Badge variant="warning">{__('Sin configurar')}</Badge>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-5 imcrm-pt-0">
                <ol className="imcrm-list-decimal imcrm-space-y-2 imcrm-pl-5 imcrm-text-sm">
                    <li>
                        {__('En Mercado Pago → Tus integraciones, creá una aplicación (producto «Pagos online» / Checkout Pro) y copiá el ')}
                        <strong>Access Token</strong>
                        {__(' de producción (empieza con APP_USR-). Para probar, el de prueba (TEST-).')}{' '}
                        <a className="imcrm-inline-flex imcrm-items-center imcrm-gap-0.5 imcrm-text-primary hover:imcrm-underline" href="https://www.mercadopago.com.co/developers/panel/app" target="_blank" rel="noreferrer">
                            {__('Abrir el panel')} <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                        </a>
                    </li>
                    <li>
                        {__('En esa aplicación, Webhooks → Configurar notificaciones: pegá esta URL y marcá los eventos ')}
                        <strong>{__('Pagos')}</strong>, <strong>{__('Planes y suscripciones')}</strong>
                        {__(' (suscripciones y pagos de suscripciones).')}
                        <div className="imcrm-mt-1.5 imcrm-flex imcrm-max-w-xl imcrm-items-center imcrm-gap-2">
                            <code className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-2 imcrm-py-1.5 imcrm-text-xs" data-testid="mp-webhook-url">
                                {mp.webhook_url}
                            </code>
                            <Button size="sm" variant="outline" onClick={() => void copy()}>
                                {copied ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                                {copied ? __('Copiado') : __('Copiar')}
                            </Button>
                        </div>
                    </li>
                    <li>{__('Al guardar los webhooks, Mercado Pago muestra la «Clave secreta»: pegala abajo. Sin ella los avisos de pago se rechazan (no se puede verificar que vienen de Mercado Pago).')}</li>
                </ol>

                <div className="imcrm-grid imcrm-gap-4 sm:imcrm-grid-cols-2">
                    <div className="imcrm-space-y-1.5">
                        <Label htmlFor="mp-token">Access Token</Label>
                        <Input
                            id="mp-token"
                            type="password"
                            autoComplete="off"
                            placeholder={mp.access_token_hint ? `${__('Guardado')} ${mp.access_token_hint} — ${__('dejá vacío para conservarlo')}` : 'APP_USR-…'}
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                        />
                    </div>
                    <div className="imcrm-space-y-1.5">
                        <Label htmlFor="mp-secret">{__('Clave secreta de los webhooks')}</Label>
                        <Input
                            id="mp-secret"
                            type="password"
                            autoComplete="off"
                            placeholder={mp.webhook_secret_set ? __('Guardada — dejá vacío para conservarla') : __('Pegala desde Webhooks')}
                            value={secret}
                            onChange={(e) => setSecret(e.target.value)}
                        />
                    </div>
                </div>
                {mp.configured && !mp.webhook_secret_set && (
                    <p className="imcrm-rounded-md imcrm-border imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-p-2.5 imcrm-text-sm imcrm-text-warning">
                        {__('Falta la clave secreta: las empresas pueden pagar, pero los avisos se rechazan y el período NO se extiende.')}
                    </p>
                )}
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    <Button onClick={() => save.mutate(false)} disabled={save.isPending || (!token.trim() && !secret.trim())} data-testid="mp-save">
                        <KeyRound className="imcrm-h-4 imcrm-w-4" />
                        {__('Guardar')}
                    </Button>
                    {mp.configured && !mp.from_env && (
                        <Button
                            variant="ghost"
                            onClick={async () => {
                                const ok = await confirm({
                                    title: __('Quitar las credenciales'),
                                    description: __('Las empresas dejan de poder pagar con Mercado Pago (salvo que haya credenciales en el .env del servidor).'),
                                    confirmLabel: __('Quitar'),
                                    destructive: true,
                                });
                                if (ok) save.mutate(true);
                            }}
                        >
                            {__('Quitar')}
                        </Button>
                    )}
                    {notice && (
                        <span className={notice.kind === 'ok' ? 'imcrm-text-sm imcrm-text-success' : 'imcrm-text-sm imcrm-text-destructive'}>{notice.text}</span>
                    )}
                </div>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {q.data.paypal.configured
                        ? __('PayPal (USD) también está configurado, por el .env del servidor.')
                        : __('PayPal (USD) se configura en el .env del servidor; hoy no está activo.')}{' '}
                    {__('Los precios de cada plan se editan en la pestaña Planes.')}
                </p>
            </CardContent>
        </Card>
    );
}

function RecentCard(): JSX.Element | null {
    const q = useQuery({ queryKey: ['platform-payments-recent'], queryFn: () => api.platformPaymentsRecent(), retry: false });
    if (q.isError) return null;
    const rows: PlatformPaymentRow[] = q.data ?? [];
    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <Receipt className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>{__('Pagos recientes')}</CardTitle>
                        <CardDescription>{__('Todos los pagos de planes de todas las empresas, con su estado.')}</CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-pt-0">
                {rows.length === 0 ? (
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">{q.isLoading ? __('Cargando…') : __('Todavía no hay pagos.')}</p>
                ) : (
                    <div className="imcrm-overflow-x-auto">
                        <table className="imcrm-w-full imcrm-text-sm" data-testid="platform-payments-table">
                            <thead>
                                <tr className="imcrm-text-left imcrm-text-xs imcrm-text-muted-foreground">
                                    <th className="imcrm-py-2 imcrm-pr-3 imcrm-font-medium">{__('Fecha')}</th>
                                    <th className="imcrm-py-2 imcrm-pr-3 imcrm-font-medium">{__('Empresa')}</th>
                                    <th className="imcrm-py-2 imcrm-pr-3 imcrm-font-medium">{__('Concepto')}</th>
                                    <th className="imcrm-py-2 imcrm-pr-3 imcrm-font-medium">{__('Medio')}</th>
                                    <th className="imcrm-py-2 imcrm-pr-3 imcrm-text-right imcrm-font-medium">{__('Monto')}</th>
                                    <th className="imcrm-py-2 imcrm-font-medium">{__('Estado')}</th>
                                </tr>
                            </thead>
                            <tbody className="imcrm-divide-y imcrm-divide-border">
                                {rows.map((p) => (
                                    <tr key={p.id}>
                                        <td className="imcrm-whitespace-nowrap imcrm-py-2 imcrm-pr-3">{DATE.format(new Date(p.created_at))}</td>
                                        <td className="imcrm-py-2 imcrm-pr-3">{p.tenant_name}</td>
                                        <td className="imcrm-whitespace-nowrap imcrm-py-2 imcrm-pr-3">
                                            <span className="imcrm-capitalize">{p.plan}</span> ·{' '}
                                            {p.kind === 'subscription' ? __('renovación') : p.months === 1 ? __('1 mes') : `${p.months} ${__('meses')}`}
                                        </td>
                                        <td className="imcrm-py-2 imcrm-pr-3 imcrm-text-muted-foreground">{p.method ?? '—'}</td>
                                        <td className="imcrm-whitespace-nowrap imcrm-py-2 imcrm-pr-3 imcrm-text-right imcrm-tabular-nums">
                                            {p.currency === 'USD' ? USD.format(p.amount) : COP.format(p.amount)}
                                        </td>
                                        <td className="imcrm-py-2">
                                            <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
