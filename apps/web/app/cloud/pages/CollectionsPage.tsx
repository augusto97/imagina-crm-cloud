import { useQuery } from '@tanstack/react-query';
import { COLLECTION_PROVIDER_LABEL } from '@imagina-base/shared';
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, Wallet, Zap } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { CopyButton, PaymentStatusChip, formatMoney } from '@/cloud/components/payments/paymentUi';
import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';

/**
 * Cobros de una conexión de Mercado Pago o Wompi (v0.1.251, ADR-S31): cómo
 * llegan los avisos de pago, cuánto se cobró y los últimos links. Los links se
 * crean desde un registro («Cobrar») o desde una automatización («Crear link
 * de pago»).
 */
export function CollectionsPage(): JSX.Element {
    const { connectionId } = useParams();
    const id = Number(connectionId);
    const q = useQuery({
        queryKey: ['collection-connection', id],
        queryFn: () => api.collectionConnection(id),
        enabled: Number.isInteger(id) && id > 0,
        retry: false,
        refetchInterval: 30_000,
    });

    const back = (
        <Link to="/settings?s=conectores" className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-sm imcrm-text-muted-foreground hover:imcrm-text-foreground">
            <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
            {__('Integraciones')}
        </Link>
    );

    if (q.isLoading) return <div className="imcrm-p-6 imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando…')}</div>;
    if (q.isError || !q.data) {
        const msg = q.error instanceof CloudApiError ? q.error.message : __('No se pudo cargar la conexión.');
        return (
            <div className="imcrm-mx-auto imcrm-max-w-4xl imcrm-space-y-4 imcrm-p-6">
                {back}
                <p className="imcrm-text-sm imcrm-text-destructive">{msg}</p>
            </div>
        );
    }
    const d = q.data;
    const provider = d.connection.provider;
    const label = COLLECTION_PROVIDER_LABEL[provider];

    return (
        <div className="imcrm-mx-auto imcrm-max-w-5xl imcrm-space-y-6 imcrm-p-4 sm:imcrm-p-6" data-testid="imcrm-collections-page">
            {back}
            <header className="imcrm-flex imcrm-items-center imcrm-gap-3">
                <IntegrationLogo integrationKey={provider} size={48} />
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <h1 className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-xl imcrm-font-semibold">
                        {__('Cobros')} · {d.connection.name}
                        {d.connection.test_mode && <Badge variant="warning">{__('Modo prueba')}</Badge>}
                    </h1>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {d.connection.account_label ?? label} — {__('el dinero va directo a tu cuenta, sin comisión de la plataforma.')}
                    </p>
                </div>
            </header>

            <section className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-3">
                <Stat label={__('Pendientes')} value={String(d.totals.pending)} />
                <Stat label={__('Pagados')} value={String(d.totals.approved)} />
                <Stat label={__('Cobrado')} value={d.links[0] ? formatMoney(d.totals.approved_amount, d.links[0].currency) : formatMoney(d.totals.approved_amount, 'COP')} />
            </section>

            <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-collections-hook">
                <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                    <Zap className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    {__('Avisos de pago')}
                    {d.last_hook_at ? (
                        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-font-normal imcrm-text-emerald-700 dark:imcrm-text-emerald-400">
                            <CheckCircle2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Último aviso')} {formatDateTimeStr(d.last_hook_at)}
                        </span>
                    ) : null}
                </h2>
                {d.hook_needs_setup ? (
                    <div className="imcrm-mt-2 imcrm-space-y-2 imcrm-text-sm">
                        <p className="imcrm-text-muted-foreground">
                            {__('Para que la app se entere sola de cada pago, pega esta URL en Wompi → Desarrolladores → «URL de Eventos» (en el ambiente de')}{' '}
                            {d.connection.test_mode ? __('Sandbox') : __('Producción')}).
                        </p>
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted/50 imcrm-px-3 imcrm-py-2">
                            <code className="imcrm-min-w-0 imcrm-flex-1 imcrm-break-all imcrm-text-xs" data-testid="imcrm-collections-hook-url">{d.hook_url}</code>
                            <CopyButton value={d.hook_url} label={__('Copiar')} testId="imcrm-collections-hook-copy" />
                        </div>
                        {!d.events_secret_set && (
                            <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">
                                <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                                {__('Falta el «Secreto de eventos»: cárgalo en «Actualizar clave» para que cada aviso se verifique con su firma. Igual cada pago se confirma volviendo a consultarlo en Wompi.')}
                            </p>
                        )}
                        {!d.last_hook_at && (
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Todavía no llegó ningún aviso. Mientras tanto, «Verificar» en cada cobro consulta a Wompi a mano.')}
                            </p>
                        )}
                    </div>
                ) : (
                    <p className="imcrm-mt-2 imcrm-text-sm imcrm-text-muted-foreground">
                        {__('No hay que configurar nada: cada link de Mercado Pago le avisa a la app cuando se paga. Cada aviso se confirma consultando el pago con tu Access Token antes de marcar nada como pagado.')}
                    </p>
                )}
            </section>

            <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4">
                <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                    <Wallet className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    {__('Cómo cobrar')}
                </h2>
                <ul className="imcrm-mt-2 imcrm-list-disc imcrm-space-y-1 imcrm-pl-5 imcrm-text-sm imcrm-text-muted-foreground">
                    <li>{__('Desde un registro: ábrelo y toca «Cobrar». El link queda copiado para mandarlo por WhatsApp o correo.')}</li>
                    <li>{__('Desde una automatización: acción «Crear link de pago» (por ejemplo, al crear una factura) y después «Enviar WhatsApp» o «Enviar correo» con {{pago.link}}.')}</li>
                    <li>{__('Para reaccionar al pago: disparador «Cuando se recibe un pago» (agradecer, marcar la factura, avisar al equipo).')}</li>
                    <li>{__('Con «Agregar columnas» en un registro, la lista muestra el estado de cada pago y puedes filtrar quién debe.')}</li>
                </ul>
            </section>

            <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
                <h2 className="imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-py-3 imcrm-text-sm imcrm-font-semibold">{__('Últimos links de pago')}</h2>
                {d.links.length === 0 ? (
                    <p className="imcrm-px-4 imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">{__('Todavía no se creó ningún link con esta conexión.')}</p>
                ) : (
                    <div className="imcrm-overflow-x-auto">
                        <table className="imcrm-w-full imcrm-text-sm" data-testid="imcrm-collections-table">
                            <thead className="imcrm-text-left imcrm-text-xs imcrm-text-muted-foreground">
                                <tr>
                                    <th className="imcrm-px-4 imcrm-py-2 imcrm-font-medium">{__('Registro')}</th>
                                    <th className="imcrm-px-4 imcrm-py-2 imcrm-font-medium">{__('Concepto')}</th>
                                    <th className="imcrm-px-4 imcrm-py-2 imcrm-text-right imcrm-font-medium">{__('Monto')}</th>
                                    <th className="imcrm-px-4 imcrm-py-2 imcrm-font-medium">{__('Estado')}</th>
                                    <th className="imcrm-px-4 imcrm-py-2 imcrm-font-medium">{__('Medio')}</th>
                                    <th className="imcrm-px-4 imcrm-py-2 imcrm-font-medium">{__('Creado')}</th>
                                    <th className="imcrm-px-4 imcrm-py-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {d.links.map((l) => (
                                    <tr key={l.id} className="imcrm-border-t imcrm-border-border">
                                        <td className="imcrm-px-4 imcrm-py-2">
                                            <Link to={`/lists/${l.list_slug}/records/${l.record_id}`} className="imcrm-font-medium hover:imcrm-underline">
                                                {l.record_title}
                                            </Link>
                                            <div className="imcrm-text-xs imcrm-text-muted-foreground">{l.list_name}</div>
                                        </td>
                                        <td className="imcrm-max-w-[16rem] imcrm-truncate imcrm-px-4 imcrm-py-2">{l.title}</td>
                                        <td className="imcrm-whitespace-nowrap imcrm-px-4 imcrm-py-2 imcrm-text-right imcrm-tabular-nums">{formatMoney(l.amount, l.currency)}</td>
                                        <td className="imcrm-px-4 imcrm-py-2">
                                            <PaymentStatusChip status={l.status} />
                                        </td>
                                        <td className="imcrm-px-4 imcrm-py-2 imcrm-text-muted-foreground">{l.method ?? '—'}</td>
                                        <td className="imcrm-whitespace-nowrap imcrm-px-4 imcrm-py-2 imcrm-text-muted-foreground">{formatDateTimeStr(l.created_at)}</td>
                                        <td className="imcrm-whitespace-nowrap imcrm-px-4 imcrm-py-2 imcrm-text-right">
                                            <CopyButton value={l.url} />
                                            <a href={l.url} target="_blank" rel="noopener noreferrer" className="imcrm-inline-flex imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent" title={__('Abrir')}>
                                                <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                                            </a>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
    return (
        <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-4 imcrm-py-3">
            <div className="imcrm-text-xs imcrm-text-muted-foreground">{label}</div>
            <div className="imcrm-mt-0.5 imcrm-text-xl imcrm-font-semibold imcrm-tabular-nums">{value}</div>
        </div>
    );
}
