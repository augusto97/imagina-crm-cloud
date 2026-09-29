import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
    STORE_META_FIELD_TYPES,
    STORE_META_RESOURCES,
    STORE_SYNC_INTERVALS,
    STORE_SYNC_RESOURCE_LABEL,
    type StoreListRole,
    type StoreMetaKey,
    type StoreMetaResource,
    type StoreSyncResource,
    type StoreSyncStatus,
} from '@imagina-base/shared';
import { AlertTriangle, ArrowLeft, ArrowLeftRight, Boxes, CheckCircle2, ChevronDown, ChevronRight, LayoutDashboard, Loader2, RefreshCw, Zap } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { StoreEditableColumns } from '@/cloud/components/StoreEditableColumns';
import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { listsKeys } from '@/hooks/useLists';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';
import { formatDateTimeStr, formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

/**
 * La tienda sincronizada (v0.1.206, ADR-S24): se activa la sincronización,
 * se ve qué trajo y cuándo, y se eligen los campos de otros plugins que se
 * quieren traer. El trabajo pesado corre en segundo plano; esta pantalla
 * pregunta el estado seguido mientras hay una corrida en curso.
 */

const RESOURCE_ORDER: StoreSyncResource[] = ['customers', 'products', 'variations', 'orders', 'line_items'];

const INTERVAL_LABEL: Record<number, string> = {
    5: 'Cada 5 minutos',
    15: 'Cada 15 minutos',
    30: 'Cada 30 minutos',
    60: 'Cada hora',
    180: 'Cada 3 horas',
    360: 'Cada 6 horas',
    1440: 'Una vez por día',
};

const META_TYPE_LABEL: Record<string, string> = {
    text: 'Texto',
    long_text: 'Texto largo',
    number: 'Número',
    date: 'Fecha',
    checkbox: 'Sí / No',
    url: 'Enlace',
};

function errText(err: unknown): string {
    if (err instanceof CloudApiError) return err.message;
    return err instanceof Error ? err.message : String(err);
}

function when(iso: string | null): string {
    if (!iso) return '—';
    return formatDateTimeStr(iso.replace('T', ' ').replace(/\.\d+Z$|Z$/, ''));
}

/** «garantia_meses» → «Garantia meses». */
function humanize(key: string): string {
    const t = key.replace(/^_+/, '').replace(/[_-]+/g, ' ').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
}

export function StoreSyncPage(): JSX.Element {
    const { connectionId } = useParams();
    const id = Number(connectionId);
    const qc = useQueryClient();
    const key = ['store-sync', id];
    /**
     * Una corrida pedida (alta, «Sincronizar ahora», traer un campo) queda EN
     * COLA hasta que el worker la toma: la respuesta todavía dice «no corre».
     * Se recuerda el `last_run_at` de ese momento y se pregunta seguido hasta
     * que cambie — si no, la pantalla esperaría 30 s para enterarse.
     */
    const [queuedFrom, setQueuedFrom] = useState<{ lastRun: string | null; at: number } | null>(null);
    const query = useQuery({
        queryKey: key,
        queryFn: () => api.storeSyncStatus(id),
        enabled: Number.isInteger(id) && id > 0,
        // Al entrar siempre se relee: la elección de columnas o «Editar desde la
        // app» pudo cambiar desde la lista (o en otra pestaña).
        refetchOnMount: 'always',
        // Mientras corre (o espera turno) se pregunta seguido; en reposo, cada tanto.
        refetchInterval: (q) => (q.state.data?.running || queuedFrom ? 2000 : 30_000),
    });
    const data = query.data;
    // «Elegir qué columnas se editan» (banner de la lista) llega con ?seccion=editar.
    const [params] = useSearchParams();
    const jumpTo = params.get('seccion');
    const configured = data?.configured === true;
    useEffect(() => {
        if (jumpTo !== 'editar' || !configured) return;
        const t = window.setTimeout(() => document.getElementById('editar')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
        return () => window.clearTimeout(t);
    }, [jumpTo, configured]);
    useEffect(() => {
        if (!queuedFrom || !data) return;
        // Ya la tomó el worker (o pasaron 2 minutos: el cartel no queda pegado).
        if (data.running || data.last_run_at !== queuedFrom.lastRun || Date.now() - queuedFrom.at > 120_000) {
            setQueuedFrom(null);
        }
    }, [data, queuedFrom]);
    const set = (s: StoreSyncStatus) => qc.setQueryData(key, s);
    const setQueued = (s: StoreSyncStatus) => {
        set(s);
        if (!s.running) setQueuedFrom({ lastRun: s.last_run_at, at: Date.now() });
    };

    if (query.isLoading) {
        return (
            <div className="imcrm-flex imcrm-h-64 imcrm-items-center imcrm-justify-center">
                <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
            </div>
        );
    }
    if (query.isError || !query.data) {
        return (
            <div className="imcrm-mx-auto imcrm-max-w-3xl imcrm-p-6">
                <BackLink />
                <p className="imcrm-mt-4 imcrm-text-sm imcrm-text-destructive">{errText(query.error)}</p>
            </div>
        );
    }
    const status = query.data;
    return (
        <div className="imcrm-mx-auto imcrm-max-w-4xl imcrm-space-y-6 imcrm-p-4 sm:imcrm-p-6" data-testid="imcrm-store-sync">
            <BackLink />
            <header className="imcrm-flex imcrm-items-center imcrm-gap-3">
                <IntegrationLogo integrationKey="woocommerce" size={44} />
                <div className="imcrm-min-w-0">
                    <h1 className="imcrm-text-xl imcrm-font-semibold">{status.store_name}</h1>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Tienda WooCommerce')}</p>
                </div>
            </header>
            {status.configured ? (
                <Configured status={status} queued={queuedFrom !== null} connectionId={id} onChange={set} onQueued={setQueued} />
            ) : (
                <Setup connectionId={id} onDone={setQueued} />
            )}
        </div>
    );
}

function BackLink(): JSX.Element {
    return (
        <Link
            to="/settings?s=conectores"
            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-sm imcrm-text-muted-foreground hover:imcrm-text-foreground"
        >
            <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
            {__('Integraciones')}
        </Link>
    );
}

// ── Alta ────────────────────────────────────────────────────────────────

function Setup({ connectionId, onDone }: { connectionId: number; onDone: (s: StoreSyncStatus) => void }): JSX.Element {
    const [resources, setResources] = useState({ customers: true, products: true, orders: true });
    const [sinceMode, setSinceMode] = useState<'all' | 'since'>('all');
    const [since, setSince] = useState('');
    const [interval, setInterval] = useState(15);
    const [mode, setMode] = useState<'realtime' | 'interval'>('realtime');
    const [error, setError] = useState<string | null>(null);
    const setup = useMutation({
        mutationFn: () =>
            api.storeSyncSetup(connectionId, {
                resources,
                orders_since: sinceMode === 'since' && since ? since : null,
                mode,
                interval_minutes: interval,
            }),
        onSuccess: onDone,
        onError: (err) => setError(errText(err)),
    });
    const nothing = !resources.customers && !resources.products && !resources.orders;
    const toggle = (k: keyof typeof resources) => setResources((r) => ({ ...r, [k]: !r[k] }));

    return (
        <section className="imcrm-space-y-5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5" data-testid="imcrm-store-sync-setup">
            <div>
                <h2 className="imcrm-text-base imcrm-font-semibold">{__('Traé tu tienda a Imagina Base')}</h2>
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    {__(
                        'Creamos una carpeta con tres listas —Clientes, Productos (cada variación, como talla o color, va adentro de su producto) y Pedidos (lo que se compró va adentro de cada pedido)— y dos tableros: ventas e inventario. Después se mantienen al día solas. Cuánto compró cada cliente, cuánto vendió cada producto (y cada talla o color), qué está agotado o por agotarse y para cuántos meses alcanza el stock se calcula solo. Los productos, pedidos y clientes se siguen creando en WooCommerce: la app los refleja.',
                    )}
                </p>
            </div>

            <fieldset className="imcrm-space-y-2">
                <legend className="imcrm-text-sm imcrm-font-medium">{__('Qué traer')}</legend>
                {(
                    [
                        ['customers', __('Clientes'), __('Los registrados. Los que compraron como invitados llegan igual, por sus pedidos.')],
                        ['products', __('Productos'), __('Con sus variaciones (talla, color…), precios, categorías e inventario: stock, alertas de stock bajo y lo que vale lo que tenés.')],
                        ['orders', __('Pedidos'), __('Con lo que se compró en cada uno (adentro del pedido).')],
                    ] as const
                ).map(([k, label, help]) => (
                    <label key={k} className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="checkbox"
                            className="imcrm-mt-0.5"
                            checked={resources[k]}
                            onChange={() => toggle(k)}
                            data-testid={`imcrm-store-sync-res-${k}`}
                        />
                        <span>
                            <span className="imcrm-font-medium">{label}</span>
                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{help}</span>
                        </span>
                    </label>
                ))}
            </fieldset>

            {resources.orders && (
                <fieldset className="imcrm-space-y-2">
                    <legend className="imcrm-text-sm imcrm-font-medium">{__('Pedidos desde')}</legend>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-4 imcrm-text-sm">
                        <label className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <input type="radio" checked={sinceMode === 'all'} onChange={() => setSinceMode('all')} />
                            {__('Todo el historial')}
                        </label>
                        <label className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <input type="radio" checked={sinceMode === 'since'} onChange={() => setSinceMode('since')} />
                            {__('Desde una fecha')}
                        </label>
                        {sinceMode === 'since' && (
                            <Input
                                type="date"
                                className="imcrm-w-44"
                                value={since}
                                onChange={(e) => setSince(e.target.value)}
                                data-testid="imcrm-store-sync-since"
                            />
                        )}
                    </div>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Cada pedido y cada línea ocupan un registro de tu plan: con años de pedidos, traer sólo los recientes ahorra lugar.')}
                    </p>
                </fieldset>
            )}

            <fieldset className="imcrm-space-y-2">
                <legend className="imcrm-text-sm imcrm-font-medium">{__('Mantener al día')}</legend>
                <ModeChoice mode={mode} onChange={setMode} />
                {mode === 'interval' && (
                    <Select
                        id="store-interval"
                        aria-label={__('Frecuencia')}
                        className="imcrm-w-60"
                        value={String(interval)}
                        onChange={(e) => setInterval(Number(e.target.value))}
                        data-testid="imcrm-store-sync-interval"
                    >
                        {STORE_SYNC_INTERVALS.map((n) => (
                            <option key={n} value={n}>
                                {__(INTERVAL_LABEL[n] ?? `Cada ${n} minutos`)}
                            </option>
                        ))}
                    </Select>
                )}
            </fieldset>

            {error && <p className="imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-store-sync-error">{error}</p>}
            <div className="imcrm-flex imcrm-justify-end">
                <Button disabled={setup.isPending || nothing} onClick={() => { setError(null); setup.mutate(); }} data-testid="imcrm-store-sync-start">
                    {setup.isPending ? __('Creando las listas…') : __('Empezar a sincronizar')}
                </Button>
            </div>
        </section>
    );
}

// ── Sincronizada ──────────────────────────────────────────────────────────

function Configured({
    status,
    queued,
    connectionId,
    onChange,
    onQueued,
}: {
    status: StoreSyncStatus;
    queued: boolean;
    connectionId: number;
    onChange: (s: StoreSyncStatus) => void;
    onQueued: (s: StoreSyncStatus) => void;
}): JSX.Element {
    const navigate = useNavigate();
    const confirm = useConfirm();
    const qc = useQueryClient();
    const [error, setError] = useState<string | null>(null);
    const onErr = (err: unknown) => setError(errText(err));
    const run = useMutation({ mutationFn: (full: boolean) => api.storeSyncRun(connectionId, full), onSuccess: onQueued, onError: onErr });
    const update = useMutation({
        mutationFn: (patch: Parameters<typeof api.storeSyncUpdate>[1]) => api.storeSyncUpdate(connectionId, patch),
        onSuccess: (s) => {
            // «Editar desde la app» cambia la marca de las listas: candados y banner.
            void qc.invalidateQueries({ queryKey: listsKeys.all });
            onChange(s);
        },
        onError: onErr,
    });
    const remove = useMutation({
        mutationFn: () => api.storeSyncRemove(connectionId),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['store-sync', connectionId] });
            // Las listas quedan como listas comunes: sin marca, sin candados.
            void qc.invalidateQueries({ queryKey: listsKeys.all });
            navigate('/settings?s=conectores');
        },
        onError: onErr,
    });

    const state: 'running' | 'queued' | 'error' | 'paused' | 'ok' | 'pending' = status.running
        ? 'running'
        : queued
          ? 'queued'
          : !status.enabled
          ? 'paused'
          : status.last_error
            ? 'error'
            : status.initial_done
              ? 'ok'
              : 'pending';

    return (
        <div className="imcrm-space-y-6">
            <section className="imcrm-space-y-4 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5" data-testid="imcrm-store-sync-status">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        {state === 'running' && (
                            <Badge variant="outline" className="imcrm-gap-1" data-testid="imcrm-store-sync-state" data-state="running">
                                <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                                {status.current
                                    ? `${__('Trayendo')} ${__(STORE_SYNC_RESOURCE_LABEL[status.current]).toLowerCase()}…`
                                    : __('Sincronizando…')}
                            </Badge>
                        )}
                        {state === 'queued' && (
                            <Badge variant="outline" className="imcrm-gap-1" data-testid="imcrm-store-sync-state" data-state="queued">
                                <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                                {__('En cola…')}
                            </Badge>
                        )}
                        {state === 'ok' && (
                            <Badge variant="success" className="imcrm-gap-1" data-testid="imcrm-store-sync-state" data-state="ok">
                                <CheckCircle2 className="imcrm-h-3 imcrm-w-3" />
                                {__('Al día')}
                            </Badge>
                        )}
                        {state === 'error' && (
                            <Badge variant="destructive" data-testid="imcrm-store-sync-state" data-state="error">
                                {__('Con problemas')}
                            </Badge>
                        )}
                        {state === 'paused' && (
                            <Badge variant="outline" data-testid="imcrm-store-sync-state" data-state="paused">
                                {__('En pausa')}
                            </Badge>
                        )}
                        {state === 'pending' && (
                            <Badge variant="outline" data-testid="imcrm-store-sync-state" data-state="pending">
                                {__('Esperando la primera vuelta')}
                            </Badge>
                        )}
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Última vez al día')}: {when(status.last_success_at)}
                            {status.enabled && status.next_run_at && !status.running && ` · ${__('Próxima')}: ${when(status.next_run_at)}`}
                        </span>
                    </div>
                    <div className="imcrm-flex imcrm-gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={status.running || queued || run.isPending}
                            onClick={() => run.mutate(false)}
                            data-testid="imcrm-store-sync-run"
                        >
                            <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Sincronizar ahora')}
                        </Button>
                        {status.dashboard_id !== null && (
                            <Button size="sm" variant="outline" asChild>
                                <Link to={`/dashboards/${status.dashboard_id}`} data-testid="imcrm-store-sync-dashboard">
                                    <LayoutDashboard className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Tablero de ventas')}
                                </Link>
                            </Button>
                        )}
                        {status.inventory_dashboard_id !== null && (
                            <Button size="sm" variant="outline" asChild>
                                <Link to={`/dashboards/${status.inventory_dashboard_id}`} data-testid="imcrm-store-sync-inventory">
                                    <Boxes className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Inventario')}
                                </Link>
                            </Button>
                        )}
                    </div>
                </div>

                {status.last_error && (
                    <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-store-sync-last-error">
                        <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                        {status.last_error}
                    </p>
                )}

                <ul className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3 sm:imcrm-grid-cols-3 lg:imcrm-grid-cols-5">
                    {RESOURCE_ORDER.map((r) => (
                        <ResourceTile key={r} resource={r} status={status} />
                    ))}
                </ul>

                {status.warnings.length > 0 && <Warnings items={status.warnings} />}
            </section>

            <section className="imcrm-space-y-4 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5">
                <h2 className="imcrm-text-base imcrm-font-semibold">{__('Cómo se mantiene al día')}</h2>
                <ModeChoice
                    mode={status.mode}
                    disabled={update.isPending}
                    onChange={(mode) => {
                        setError(null);
                        update.mutate({ mode });
                    }}
                />
                {update.isPending && update.variables?.mode === 'realtime' && (
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                        {__('Registrando los avisos en la tienda…')}
                    </p>
                )}
                {status.mode === 'realtime' ? (
                    <RealtimeStatus status={status} />
                ) : (
                    status.realtime.error && (
                        <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-xs imcrm-text-warning" data-testid="imcrm-store-realtime-error">
                            <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                            {status.realtime.error}
                        </p>
                    )
                )}
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-end imcrm-gap-4">
                    {status.mode === 'interval' && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="store-interval-edit">{__('Frecuencia')}</Label>
                            <Select
                                id="store-interval-edit"
                                className="imcrm-w-60"
                                value={String(status.interval_minutes)}
                                onChange={(e) => update.mutate({ interval_minutes: Number(e.target.value) })}
                                data-testid="imcrm-store-sync-interval-edit"
                            >
                                {STORE_SYNC_INTERVALS.map((n) => (
                                    <option key={n} value={n}>
                                        {__(INTERVAL_LABEL[n] ?? `Cada ${n} minutos`)}
                                    </option>
                                ))}
                            </Select>
                        </div>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => update.mutate({ enabled: !status.enabled })}
                        data-testid="imcrm-store-sync-toggle"
                    >
                        {status.enabled ? __('Pausar') : __('Reanudar')}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={status.running || run.isPending}
                        onClick={async () => {
                            const ok = await confirm({
                                title: __('¿Recorrer toda la tienda de nuevo?'),
                                description: __(
                                    'Se vuelven a leer todos los clientes, productos y pedidos (no se duplica nada: se actualiza lo que haya cambiado). Sirve si notás datos desactualizados. En una tienda grande puede tardar.',
                                ),
                                confirmLabel: __('Recorrer todo'),
                            });
                            if (ok) run.mutate(true);
                        }}
                        data-testid="imcrm-store-sync-full"
                    >
                        {__('Recorrer todo de nuevo')}
                    </Button>
                </div>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__(
                        'Los cambios que llegan de la tienda disparan las automatizaciones de cada lista (por ejemplo, avisar por WhatsApp de un pedido nuevo). La primera importación no dispara nada.',
                    )}
                </p>
            </section>

            <WriteBackSection
                status={status}
                // Optimista: el interruptor se mueve al tocarlo, no cuando vuelve el servidor.
                pending={update.isPending ? update.variables?.write_back : undefined}
                busy={update.isPending}
                onToggle={(on) => {
                    setError(null);
                    update.mutate({ write_back: on });
                }}
                onEditable={(role, slug, on) => {
                    setError(null);
                    update.mutate({ editable_toggle: { role, slug, on } });
                }}
            />

            <MetaSection status={status} connectionId={connectionId} onChange={onChange} onQueued={onQueued} onError={onErr} />

            {error && <p className="imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-store-sync-action-error">{error}</p>}

            <section className="imcrm-space-y-2 imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-p-5">
                <h2 className="imcrm-text-sm imcrm-font-semibold">{__('Dejar de sincronizar')}</h2>
                <p className="imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Las listas y todo lo que se trajo quedan en tu workspace; sólo deja de actualizarse.')}
                </p>
                <Button
                    variant="outline"
                    size="sm"
                    className="imcrm-text-destructive"
                    onClick={async () => {
                        const ok = await confirm({
                            title: __('¿Dejar de sincronizar la tienda?'),
                            description: __('Los datos quedan. Si la volvés a activar, se crean listas nuevas.'),
                            confirmLabel: __('Dejar de sincronizar'),
                            destructive: true,
                        });
                        if (ok) remove.mutate();
                    }}
                    data-testid="imcrm-store-sync-remove"
                >
                    {__('Dejar de sincronizar')}
                </Button>
            </section>
        </div>
    );
}

// ── Tiempo real y edición en los dos sentidos (fase 3) ─────────────────────

function ModeChoice({
    mode,
    disabled,
    onChange,
}: {
    mode: 'realtime' | 'interval';
    disabled?: boolean;
    onChange: (m: 'realtime' | 'interval') => void;
}): JSX.Element {
    const options = [
        {
            value: 'realtime' as const,
            icon: <Zap className="imcrm-h-4 imcrm-w-4" />,
            title: __('En tiempo real'),
            badge: __('Recomendado'),
            help: __('La tienda avisa al instante cada pedido, producto o cliente que cambia. Igual se revisa una vez por hora por si se perdió algún aviso. Necesita una clave de API con permiso de Lectura/Escritura.'),
        },
        {
            value: 'interval' as const,
            icon: <RefreshCw className="imcrm-h-4 imcrm-w-4" />,
            title: __('Cada cierto tiempo'),
            badge: null,
            help: __('La app le pregunta a la tienda qué cambió cada tanto. Sirve con una clave de sólo lectura o si la tienda no puede llegar a este servidor.'),
        },
    ];
    return (
        <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2" role="radiogroup" aria-label={__('Cómo se mantiene al día')}>
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={mode === o.value}
                    disabled={disabled}
                    onClick={() => mode !== o.value && onChange(o.value)}
                    className={cn(
                        'imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-p-3 imcrm-text-left imcrm-transition-colors disabled:imcrm-opacity-60',
                        mode === o.value ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-ring-1 imcrm-ring-primary' : 'imcrm-border-border hover:imcrm-bg-accent',
                    )}
                    data-testid={`imcrm-store-mode-${o.value}`}
                >
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                        {o.icon}
                        {o.title}
                        {o.badge && <Badge variant="outline" className="imcrm-text-[10px]">{o.badge}</Badge>}
                    </span>
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{o.help}</span>
                </button>
            ))}
        </div>
    );
}

function RealtimeStatus({ status }: { status: StoreSyncStatus }): JSX.Element {
    const rt = status.realtime;
    return (
        <div className="imcrm-space-y-1 imcrm-text-xs" data-testid="imcrm-store-realtime">
            {rt.active ? (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-success">
                    <span className="imcrm-relative imcrm-flex imcrm-h-2 imcrm-w-2">
                        <span className="imcrm-absolute imcrm-inline-flex imcrm-h-full imcrm-w-full imcrm-animate-ping imcrm-rounded-full imcrm-bg-success imcrm-opacity-60" />
                        <span className="imcrm-relative imcrm-inline-flex imcrm-h-2 imcrm-w-2 imcrm-rounded-full imcrm-bg-success" />
                    </span>
                    {__('Escuchando a la tienda')} · {rt.webhooks} {__('avisos registrados')}
                </p>
            ) : (
                <p className="imcrm-text-muted-foreground">{__('Los avisos todavía no están registrados en la tienda.')}</p>
            )}
            <p className="imcrm-text-muted-foreground" data-testid="imcrm-store-realtime-received">
                {rt.received === 0
                    ? __('Todavía no llegó ningún aviso: aparecen cuando algo cambie en la tienda.')
                    : `${formatNumber(rt.received)} ${rt.received === 1 ? __('aviso recibido') : __('avisos recibidos')} · ${__('último')}: ${when(rt.last_received_at)}`}
            </p>
            {rt.error && (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-warning" data-testid="imcrm-store-realtime-error">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    {rt.error}
                </p>
            )}
        </div>
    );
}

function WriteBackSection({
    status,
    pending,
    busy,
    onToggle,
    onEditable,
}: {
    status: StoreSyncStatus;
    pending: boolean | undefined;
    busy: boolean;
    onToggle: (on: boolean) => void;
    onEditable: (role: StoreListRole, slug: string, on: boolean) => void;
}): JSX.Element {
    const wb = status.write_back_status;
    // Optimista de verdad: el estado de la mutación de React Query se notifica
    // un tick después, y un checkbox controlado vuelve a su valor viejo en ese
    // hueco. El valor local se fija EN el evento y se suelta al terminar.
    const [local, setLocal] = useState<boolean | null>(null);
    useEffect(() => {
        if (!busy) setLocal(null);
    }, [busy]);
    const on = local ?? pending ?? status.write_back;
    return (
        <section className="imcrm-space-y-4 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5" data-testid="imcrm-store-write-back">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-3">
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                        <ArrowLeftRight className="imcrm-h-4 imcrm-w-4" />
                        {__('Editar desde la app')}
                    </h2>
                    <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                        {__(
                            'Cambiá un precio, el stock, el nombre de un producto o el estado de un pedido en la app y se actualiza en la tienda. Sólo viaja lo que cambiaste: nunca se pisan datos que la tienda cambió mientras tanto.',
                        )}
                    </p>
                </div>
                <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <input
                        type="checkbox"
                        role="switch"
                        className="imcrm-peer imcrm-sr-only"
                        checked={on}
                        disabled={busy}
                        onChange={(e) => {
                            setLocal(e.target.checked);
                            onToggle(e.target.checked);
                        }}
                        data-testid="imcrm-store-write-back-toggle"
                    />
                    <span
                        aria-hidden
                        className={cn(
                            'imcrm-relative imcrm-inline-flex imcrm-h-5 imcrm-w-9 imcrm-items-center imcrm-rounded-full imcrm-transition-colors peer-focus-visible:imcrm-ring-2 peer-focus-visible:imcrm-ring-ring',
                            on ? 'imcrm-bg-primary' : 'imcrm-bg-muted',
                        )}
                    >
                        <span
                            className={cn(
                                'imcrm-inline-block imcrm-h-4 imcrm-w-4 imcrm-rounded-full imcrm-bg-background imcrm-shadow imcrm-transition-transform',
                                on ? 'imcrm-translate-x-[18px]' : 'imcrm-translate-x-0.5',
                            )}
                        />
                    </span>
                    {on ? __('Activado') : __('Desactivado')}
                </label>
            </div>
            <div className="imcrm-space-y-2 imcrm-border-t imcrm-border-border imcrm-pt-3" id="editar">
                <p className="imcrm-text-sm imcrm-font-medium">{__('Columnas que se editan desde la app')}</p>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__(
                        'Elegí qué se puede cambiar desde cada lista. Lo que no marques se sigue editando en WooCommerce. Además, cada fila acepta lo que acepta la tienda: un producto con variaciones no tiene precio ni stock propio (se cambian en cada variación) y con el stock controlado el estado del stock lo calcula WooCommerce. Necesita una clave con permiso de Lectura/Escritura.',
                    )}
                </p>
                <StoreEditableColumns status={status} busy={busy} onToggle={onEditable} />
            </div>
            {(wb.pushed > 0 || wb.failed > 0) && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-store-write-back-stats">
                    {formatNumber(wb.pushed)} {wb.pushed === 1 ? __('cambio enviado') : __('cambios enviados')}
                    {wb.failed > 0 && ` · ${formatNumber(wb.failed)} ${wb.failed === 1 ? __('falló') : __('fallaron')}`}
                    {wb.last_at && ` · ${__('último')}: ${when(wb.last_at)}`}
                </p>
            )}
            {wb.last_error && (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-destructive" data-testid="imcrm-store-write-back-error">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    {__('El último cambio no llegó a la tienda')}: {wb.last_error}
                </p>
            )}
        </section>
    );
}

function ResourceTile({ resource, status }: { resource: StoreSyncResource; status: StoreSyncStatus }): JSX.Element {
    const list = status.lists[resource];
    const p = status.progress[resource] ?? { count: 0, done: 0, total: null };
    const active = status.running && status.current === resource;
    const pct = active && p.total ? Math.min(100, Math.round((p.done / Math.max(p.total, 1)) * 100)) : null;
    const body = (
        <>
            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                {__(STORE_SYNC_RESOURCE_LABEL[resource])}
                {/* v0.1.213 — variaciones y líneas viven adentro de su padre. */}
                {resource === 'variations' && <span className="imcrm-block imcrm-text-[10px]">{__('dentro de cada producto')}</span>}
                {resource === 'line_items' && <span className="imcrm-block imcrm-text-[10px]">{__('dentro de cada pedido')}</span>}
            </span>
            <span className="imcrm-text-lg imcrm-font-semibold imcrm-tabular-nums" data-testid={`imcrm-store-sync-count-${resource}`}>
                {formatNumber(p.count)}
            </span>
            {active && (
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {p.total ? `${formatNumber(p.done)} / ${formatNumber(p.total)}` : `${formatNumber(p.done)}…`}
                </span>
            )}
            {pct !== null && (
                <span className="imcrm-mt-1 imcrm-block imcrm-h-1 imcrm-overflow-hidden imcrm-rounded imcrm-bg-muted">
                    <span className="imcrm-block imcrm-h-full imcrm-bg-primary" style={{ width: `${pct}%` }} />
                </span>
            )}
        </>
    );
    const cls = 'imcrm-flex imcrm-flex-col imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2';
    return (
        <li data-testid={`imcrm-store-sync-tile-${resource}`}>
            {list ? (
                <Link to={`/lists/${list.slug}/records`} className={cn(cls, 'hover:imcrm-bg-accent')}>
                    {body}
                </Link>
            ) : (
                <div className={cn(cls, 'imcrm-opacity-60')}>{body}</div>
            )}
        </li>
    );
}

function Warnings({ items }: { items: string[] }): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <div className="imcrm-text-sm">
            <button
                type="button"
                className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-warning"
                onClick={() => setOpen((v) => !v)}
            >
                {open ? <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" /> : <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" />}
                {items.length === 1 ? __('1 dato no se pudo guardar') : `${items.length} ${__('datos no se pudieron guardar')}`}
            </button>
            {open && (
                <ul className="imcrm-mt-2 imcrm-list-disc imcrm-space-y-1 imcrm-pl-6 imcrm-text-xs imcrm-text-muted-foreground">
                    {items.map((w) => (
                        <li key={w}>{w}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// ── Campos de otros plugins ─────────────────────────────────────────────

const META_RESOURCE_HELP: Record<StoreMetaResource, string> = {
    customers: 'Campos extra de los clientes (fecha de nacimiento, documento…).',
    products: 'Campos de productos que agregan plugins (ACF, Yoast, fichas técnicas…).',
    variations: 'Campos propios de cada variación (código de barras, peso…).',
    orders: 'Datos extra de los pedidos (NIT, origen, datos de envío de otros plugins…).',
};

function MetaSection({
    status,
    connectionId,
    onChange,
    onQueued,
    onError,
}: {
    status: StoreSyncStatus;
    connectionId: number;
    onChange: (s: StoreSyncStatus) => void;
    onQueued: (s: StoreSyncStatus) => void;
    onError: (err: unknown) => void;
}): JSX.Element {
    const [tab, setTab] = useState<StoreMetaResource>('products');
    const [showPrivate, setShowPrivate] = useState(false);
    const keys = status.meta_keys[tab] ?? [];
    const publicKeys = keys.filter((k) => !k.private || k.field_id !== null);
    const privateKeys = keys.filter((k) => k.private && k.field_id === null);
    const visible = showPrivate ? [...publicKeys, ...privateKeys] : publicKeys;

    return (
        <section className="imcrm-space-y-4 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5" data-testid="imcrm-store-sync-meta">
            <div>
                <h2 className="imcrm-text-base imcrm-font-semibold">{__('Campos de otros plugins')}</h2>
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    {__(
                        'Los plugins de WooCommerce guardan datos propios en cada producto, pedido o cliente. Estos son los que encontramos: elegí cuáles traer a una columna (de sólo lectura: se editan en WooCommerce).',
                    )}
                </p>
            </div>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1 imcrm-border-b imcrm-border-border" role="tablist">
                {STORE_META_RESOURCES.map((r) => (
                    <button
                        key={r}
                        type="button"
                        role="tab"
                        aria-selected={tab === r}
                        onClick={() => setTab(r)}
                        className={cn(
                            '-imcrm-mb-px imcrm-border-b-2 imcrm-px-3 imcrm-py-1.5 imcrm-text-sm',
                            tab === r ? 'imcrm-border-primary imcrm-font-medium' : 'imcrm-border-transparent imcrm-text-muted-foreground hover:imcrm-text-foreground',
                        )}
                        data-testid={`imcrm-store-meta-tab-${r}`}
                    >
                        {__(STORE_SYNC_RESOURCE_LABEL[r])}
                        {(status.meta_keys[r] ?? []).some((k) => k.field_id !== null) && (
                            <span className="imcrm-ml-1 imcrm-text-primary">•</span>
                        )}
                    </button>
                ))}
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__(META_RESOURCE_HELP[tab])}</p>
            {keys.length === 0 ? (
                <p className="imcrm-text-sm imcrm-text-muted-foreground">
                    {status.initial_done
                        ? __('No encontramos campos extra acá.')
                        : __('Aparecen cuando termine la primera sincronización.')}
                </p>
            ) : (
                <ul className="imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border">
                    {visible.map((k) => (
                        <MetaRow key={k.key} meta={k} resource={tab} connectionId={connectionId} onChange={onChange} onQueued={onQueued} onError={onError} />
                    ))}
                </ul>
            )}
            {privateKeys.length > 0 && (
                <button
                    type="button"
                    className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground"
                    onClick={() => setShowPrivate((v) => !v)}
                    data-testid="imcrm-store-meta-private"
                >
                    {showPrivate
                        ? __('Ocultar los internos')
                        : `${__('Mostrar los internos de los plugins')} (${privateKeys.length})`}
                </button>
            )}
        </section>
    );
}

function MetaRow({
    meta,
    resource,
    connectionId,
    onChange,
    onQueued,
    onError,
}: {
    meta: StoreMetaKey;
    resource: StoreMetaResource;
    connectionId: number;
    onChange: (s: StoreSyncStatus) => void;
    onQueued: (s: StoreSyncStatus) => void;
    onError: (err: unknown) => void;
}): JSX.Element {
    const [editing, setEditing] = useState(false);
    const [label, setLabel] = useState(humanize(meta.key));
    const [type, setType] = useState<string>(meta.suggested_type);
    useEffect(() => setType(meta.suggested_type), [meta.suggested_type]);
    const map = useMutation({
        mutationFn: () =>
            api.storeSyncMapMeta(connectionId, {
                resource,
                key: meta.key,
                label: label.trim() || humanize(meta.key),
                type: type as (typeof STORE_META_FIELD_TYPES)[number],
            }),
        // Traer un campo relee ese recurso entero para rellenar los registros.
        onSuccess: (s) => {
            setEditing(false);
            onQueued(s);
        },
        onError,
    });
    const unmap = useMutation({
        mutationFn: () => api.storeSyncUnmapMeta(connectionId, { resource, key: meta.key }),
        onSuccess: onChange,
        onError,
    });
    const sample = useMemo(() => meta.sample, [meta.sample]);
    return (
        <li className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-2" data-testid="imcrm-store-meta-row" data-key={meta.key}>
            <div className="imcrm-min-w-0 imcrm-flex-1">
                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <code className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-xs">{meta.key}</code>
                    {meta.private && <Badge variant="outline" className="imcrm-text-[10px]">{__('Interno')}</Badge>}
                    {meta.count > 0 && <span className="imcrm-text-xs imcrm-text-muted-foreground">{meta.count} {__('registros')}</span>}
                </p>
                {sample && <p className="imcrm-mt-0.5 imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{__('Ejemplo')}: {sample}</p>}
            </div>
            {meta.field_id !== null ? (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Badge variant="success" data-testid="imcrm-store-meta-mapped">{__('Se trae')}</Badge>
                    <Button size="sm" variant="ghost" disabled={unmap.isPending} onClick={() => unmap.mutate()} data-testid="imcrm-store-meta-unmap">
                        {__('Dejar de traer')}
                    </Button>
                </div>
            ) : editing ? (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    <Input
                        className="imcrm-h-8 imcrm-w-48"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        aria-label={__('Nombre de la columna')}
                        data-testid="imcrm-store-meta-label"
                    />
                    <Select className="imcrm-h-8 imcrm-w-36" value={type} onChange={(e) => setType(e.target.value)} data-testid="imcrm-store-meta-type">
                        {STORE_META_FIELD_TYPES.map((t) => (
                            <option key={t} value={t}>
                                {__(META_TYPE_LABEL[t] ?? t)}
                            </option>
                        ))}
                    </Select>
                    <Button size="sm" disabled={map.isPending} onClick={() => map.mutate()} data-testid="imcrm-store-meta-save">
                        {map.isPending ? __('Creando…') : __('Traer')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                        {__('Cancelar')}
                    </Button>
                </div>
            ) : (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="imcrm-store-meta-add">
                    {__('Traer como columna')}
                </Button>
            )}
        </li>
    );
}
