import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import {
    INTEGRATIONS,
    INTEGRATION_CATEGORY_LABEL,
    integrationDef,
    type Connection,
    type IntegrationDef,
    type IntegrationsOverview,
} from '@imagina-base/shared';
import { ChevronDown, ChevronRight, Lock, Settings2 } from 'lucide-react';

import { ConnectorsPanel } from '@/cloud/components/ConnectorsPanel';
import { IntegrationKeyDialog } from '@/cloud/components/IntegrationKeyDialog';
import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { api, useSession } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';

/**
 * Integraciones (v0.1.203, ADR-S22 fase 4) — la galería de apps.
 *
 * Reemplaza a la sección técnica de Conectores como cara principal: la persona
 * ve el logo de la app, toca «Conectar», autoriza con SU cuenta (o pega una
 * clave, para WhatsApp y Telegram) y la app queda lista para usar en las
 * automatizaciones con acciones ya armadas. Lo técnico —client ids, scopes,
 * URLs de tokens— lo resolvió el operador una sola vez en Plataforma.
 *
 * La API personalizada (cualquier servicio con su URL, cabeceras y método)
 * sigue existiendo, plegada al final bajo «Avanzado»: es la salida para lo
 * que no está en la galería, no el camino de todos los días.
 */
export function IntegrationsPanel(): JSX.Element | null {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const tenantId = useSession((s) => s.activeTenantId);
    const [params, setParams] = useSearchParams();
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const [dialog, setDialog] = useState<{ def: IntegrationDef; connection: Connection | null } | null>(null);
    const [advanced, setAdvanced] = useState(false);

    const overview = useQuery({
        queryKey: ['integrations-overview', tenantId],
        queryFn: () => api.integrationsOverview(),
        retry: false,
    });
    const list = useQuery({
        queryKey: ['connections', tenantId],
        queryFn: () => api.connectionsList(),
        retry: false,
    });

    /**
     * Vuelta del proveedor: el callback del backend redirige acá con el
     * resultado. Se muestra y se limpian los parámetros para que no quede
     * pegado en el historial ni reaparezca al recargar.
     */
    const oauthResult = params.get('oauth');
    useEffect(() => {
        if (!oauthResult) return;
        setNotice(
            oauthResult === 'ok'
                ? { kind: 'ok', text: __('¡Listo! La app quedó conectada y ya la podés usar en tus automatizaciones.') }
                : { kind: 'err', text: params.get('msg') ?? __('No se pudo conectar la app.') },
        );
        const next = new URLSearchParams(params);
        next.delete('oauth');
        next.delete('msg');
        setParams(next, { replace: true });
        void qc.invalidateQueries({ queryKey: ['connections', tenantId] });
        // Sólo importa el cambio de resultado: las demás dependencias son
        // estables y re-correr esto pisaría el aviso recién mostrado.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [oauthResult]);

    const authorize = useMutation({
        mutationFn: ({ def, connection }: { def: IntegrationDef; connection: Connection | null }) =>
            api.integrationAuthorize(def.key, {
                visibility: overview.data?.can_connect_workspace ? 'workspace' : 'private',
                connection_id: connection?.id ?? null,
            }),
        // El proveedor abre su pantalla de permisos y vuelve solo a esta página.
        onSuccess: (res) => window.location.assign(res.authorize_url),
        onError: (err) => setNotice({ kind: 'err', text: errText(err) }),
    });

    const remove = useMutation({
        mutationFn: ({ id, force }: { id: number; force: boolean }) => api.connectionDelete(id, force),
        onSuccess: () => {
            setNotice({ kind: 'ok', text: __('La app se desconectó.') });
            void qc.invalidateQueries({ queryKey: ['connections', tenantId] });
        },
        onError: (err) => setNotice({ kind: 'err', text: errText(err) }),
    });

    if (list.isError) {
        const e = list.error;
        // 403 = el rol no arma automatizaciones; el menú de Ajustes ya lo oculta.
        if (e instanceof CloudApiError && e.status === 403) return null;
        return <p className="imcrm-text-sm imcrm-text-destructive">{errText(e)}</p>;
    }

    const rows = list.data ?? [];
    const connected = rows.filter((c) => c.integration_key !== null);
    const customCount = rows.filter((c) => c.integration_key === null).length;
    const info = overview.data;
    const canConnect = (info?.can_connect_workspace ?? false) || (info?.can_connect_private ?? false);

    const start = (def: IntegrationDef, connection: Connection | null): void => {
        setNotice(null);
        if (def.auth.kind === 'oauth') authorize.mutate({ def, connection });
        else setDialog({ def, connection });
    };

    const disconnect = async (c: Connection): Promise<void> => {
        const ok = await confirm({
            title: __('¿Desconectar esta app?'),
            description:
                c.usage_count > 0
                    ? `${__('La usan')} ${c.usage_count} ${__('acciones de automatización: van a fallar hasta que la conectes de nuevo.')}`
                    : __('Podés volver a conectarla cuando quieras.'),
            confirmLabel: __('Desconectar'),
            destructive: true,
        });
        if (ok) remove.mutate({ id: c.id, force: c.usage_count > 0 });
    };

    return (
        <div className="imcrm-space-y-6" data-testid="imcrm-integrations">
            {/* El título de la sección lo pone la página de Ajustes. */}
            <p className="imcrm-text-sm imcrm-text-muted-foreground">
                {__(
                    'Conectá las apps que usa tu empresa y usalas en tus automatizaciones: mandá un WhatsApp, avisá en Slack, agendá en tu calendario o sumá filas a una planilla.',
                )}
            </p>

            {notice && (
                <p
                    className={
                        notice.kind === 'ok'
                            ? 'imcrm-rounded-md imcrm-border imcrm-border-success/25 imcrm-bg-success/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-success'
                            : 'imcrm-rounded-md imcrm-border imcrm-border-destructive/25 imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive'
                    }
                    data-testid="imcrm-integrations-notice"
                >
                    {notice.text}
                </p>
            )}

            {info && !canConnect && (
                <p className="imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Las apps las conecta el administrador del workspace. Las que ya estén conectadas las podés usar en tus automatizaciones.')}
                </p>
            )}

            {connected.length > 0 && (
                <section className="imcrm-space-y-2">
                    <h3 className="imcrm-text-sm imcrm-font-semibold">{__('Conectadas')}</h3>
                    <ul className="imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
                        {connected.map((c) => (
                            <ConnectedRow
                                key={c.id}
                                connection={c}
                                onReconnect={() => {
                                    const def = integrationDef(c.integration_key);
                                    if (def) start(def, c);
                                }}
                                onDisconnect={() => void disconnect(c)}
                                busy={authorize.isPending || remove.isPending}
                            />
                        ))}
                    </ul>
                </section>
            )}

            <section className="imcrm-space-y-2">
                <h3 className="imcrm-text-sm imcrm-font-semibold">{__('Apps')}</h3>
                <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2 xl:imcrm-grid-cols-3">
                    {INTEGRATIONS.map((def) => (
                        <AppTile
                            key={def.key}
                            def={def}
                            info={info ?? null}
                            connectedCount={connected.filter((c) => c.integration_key === def.key).length}
                            canConnect={canConnect}
                            busy={authorize.isPending && authorize.variables?.def.key === def.key}
                            onConnect={() => start(def, null)}
                        />
                    ))}
                </div>
            </section>

            <section className="imcrm-rounded-lg imcrm-border imcrm-border-border">
                <button
                    type="button"
                    onClick={() => setAdvanced((v) => !v)}
                    className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-4 imcrm-py-3 imcrm-text-left"
                    aria-expanded={advanced}
                    data-testid="imcrm-integrations-advanced"
                >
                    {advanced ? (
                        <ChevronDown className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    ) : (
                        <ChevronRight className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    )}
                    <span className="imcrm-flex-1">
                        <span className="imcrm-block imcrm-text-sm imcrm-font-medium">
                            {__('Avanzado: API personalizada')}
                            {customCount > 0 && (
                                <span className="imcrm-ml-2 imcrm-text-xs imcrm-font-normal imcrm-text-muted-foreground">
                                    {customCount === 1 ? __('1 conexión') : `${customCount} ${__('conexiones')}`}
                                </span>
                            )}
                        </span>
                        <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Para conectar un servicio que no está en la lista con su URL y su clave. Pensado para quien sabe de APIs.')}
                        </span>
                    </span>
                </button>
                {advanced && (
                    <div className="imcrm-border-t imcrm-border-border imcrm-p-4">
                        <ConnectorsPanel />
                    </div>
                )}
            </section>

            {dialog && (
                <IntegrationKeyDialog
                    def={dialog.def}
                    connection={dialog.connection}
                    visibility={info?.can_connect_workspace ? 'workspace' : 'private'}
                    onClose={() => setDialog(null)}
                    onDone={(text) => {
                        setDialog(null);
                        setNotice({ kind: 'ok', text });
                        void qc.invalidateQueries({ queryKey: ['connections', tenantId] });
                    }}
                />
            )}
        </div>
    );
}

function AppTile({
    def,
    info,
    connectedCount,
    canConnect,
    busy,
    onConnect,
}: {
    def: IntegrationDef;
    info: IntegrationsOverview | null;
    connectedCount: number;
    canConnect: boolean;
    busy: boolean;
    onConnect: () => void;
}): JSX.Element | null {
    const provider = def.auth.kind === 'oauth' ? def.auth.provider : null;
    const available = provider === null || info?.providers[provider]?.configured === true;
    // Una app cuyo proveedor el operador no configuró no se le muestra a la
    // empresa: un botón que no puede funcionar es peor que no tenerlo. El
    // operador sí la ve, con el atajo a configurarla.
    if (!available && !info?.is_platform_admin) return null;

    return (
        <div
            className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4"
            data-testid="imcrm-integration-tile"
            data-integration={def.key}
        >
            <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                <IntegrationLogo integrationKey={def.key} size={40} />
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-font-medium">
                        {def.name}
                        {connectedCount > 0 && (
                            <Badge variant="success" className="imcrm-text-[10px]">
                                {__('Conectada')}
                            </Badge>
                        )}
                    </p>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__(INTEGRATION_CATEGORY_LABEL[def.category])}
                    </p>
                </div>
            </div>
            <p className="imcrm-flex-1 imcrm-text-sm imcrm-text-muted-foreground">{def.tagline}</p>
            {available ? (
                <Button
                    size="sm"
                    variant={connectedCount > 0 ? 'outline' : 'default'}
                    disabled={!canConnect || busy}
                    onClick={onConnect}
                    data-testid="imcrm-integration-connect"
                >
                    {busy
                        ? __('Abriendo…')
                        : connectedCount > 0
                          ? __('Conectar otra cuenta')
                          : __('Conectar')}
                </Button>
            ) : (
                <Button size="sm" variant="outline" asChild>
                    <Link to="/platform?tab=integraciones" data-testid="imcrm-integration-configure">
                        <Settings2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Configurar en Plataforma')}
                    </Link>
                </Button>
            )}
        </div>
    );
}

function ConnectedRow({
    connection: c,
    onReconnect,
    onDisconnect,
    busy,
}: {
    connection: Connection;
    onReconnect: () => void;
    onDisconnect: () => void;
    busy: boolean;
}): JSX.Element {
    const def = integrationDef(c.integration_key);
    const broken =
        c.secret_state === 'unreadable' ||
        (c.oauth_status !== null && (!c.oauth_status.connected || c.oauth_status.last_error !== null));
    const isOAuth = def?.auth.kind === 'oauth';
    return (
        <li
            className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-px-4 imcrm-py-3"
            data-testid="imcrm-integration-connected"
            data-integration={c.integration_key ?? ''}
        >
            <IntegrationLogo integrationKey={c.integration_key} size={32} />
            <div className="imcrm-min-w-0 imcrm-flex-1">
                <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                    {def?.name ?? c.name}
                    {c.account_label && (
                        <span className="imcrm-font-normal imcrm-text-muted-foreground">{c.account_label}</span>
                    )}
                    {c.visibility === 'private' && (
                        <Badge variant="outline" className="imcrm-gap-1 imcrm-text-[10px]">
                            <Lock className="imcrm-h-3 imcrm-w-3" />
                            {__('Sólo vos')}
                        </Badge>
                    )}
                    {broken ? (
                        <Badge variant="destructive" className="imcrm-text-[10px]">
                            {__('Hay que volver a conectarla')}
                        </Badge>
                    ) : (
                        <Badge variant="success" className="imcrm-text-[10px]">
                            {__('Conectada')}
                        </Badge>
                    )}
                </p>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {c.usage_count === 0
                        ? __('Todavía no la usa ninguna automatización.')
                        : c.usage_count === 1
                          ? __('La usa 1 acción de automatización.')
                          : `${__('La usan')} ${c.usage_count} ${__('acciones de automatización.')}`}
                </p>
                {c.oauth_status?.last_error && (
                    <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-destructive">{c.oauth_status.last_error}</p>
                )}
                {c.secret_state === 'unreadable' && (
                    <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-destructive">
                        {__('La clave guardada ya no se puede leer: volvé a cargarla.')}
                    </p>
                )}
            </div>
            {c.can_edit && (
                <div className="imcrm-flex imcrm-gap-1">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={onReconnect} data-testid="imcrm-integration-reconnect">
                        {isOAuth ? __('Reconectar') : __('Actualizar clave')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={onDisconnect} data-testid="imcrm-integration-disconnect">
                        {__('Desconectar')}
                    </Button>
                </div>
            )}
        </li>
    );
}

function errText(err: unknown): string {
    if (err instanceof CloudApiError) return err.message;
    return err instanceof Error ? err.message : String(err);
}
