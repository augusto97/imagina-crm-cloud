import { useState } from 'react';
import { BellOff, BellRing, Loader2, Monitor, Send, Smartphone, Trash2, TriangleAlert } from 'lucide-react';

import { relativeTime } from '@/admin/activity/activityText';
import { useSession } from '@/cloud/session';
import { InstallAppDialog } from '@/components/pwa/InstallAppDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useDisablePush, useEnablePush, usePushStatus, useRemovePushDevice, useSendTestPush, useThisDevice } from '@/hooks/usePushDevice';
import { describeDevice } from '@/lib/deviceLabel';
import { __, sprintf } from '@/lib/i18n';
import { currentAppName } from '@/lib/pwa/appMeta';
import { browserName, deviceInfo } from '@/lib/pwa/platform';
import { cn } from '@/lib/utils';

/**
 * H1 — Ajustes → Cuenta → Avisos: las notificaciones push de ESTE dispositivo
 * (activar con el permiso del navegador, prueba, desactivar), la lista de los
 * dispositivos de la persona en esta empresa (con quitar) y, cuando no se
 * puede, por qué: navegador sin soporte, permiso bloqueado (con cómo
 * desbloquearlo) o un iPhone que necesita la app instalada.
 */
export function PushDeviceCard(): JSX.Element {
    const tenantId = useSession((s) => s.activeTenantId);
    const impersonating = useSession((s) => s.impersonating);
    const toast = useToast();
    const device = useThisDevice();
    const status = usePushStatus();
    const enable = useEnablePush();
    const disable = useDisablePush();
    const remove = useRemovePushDevice();
    const test = useSendTestPush();
    const [installHelp, setInstallHelp] = useState(false);

    const devices = status.data?.devices ?? [];
    const thisDevice = device.hash !== null ? devices.find((d) => d.endpoint_hash === device.hash) : undefined;
    const active = device.support === 'ok' && device.permission === 'granted' && thisDevice !== undefined;

    const onEnable = async (): Promise<void> => {
        if (tenantId === null || !status.data) return;
        const r = await enable.mutateAsync({ tenantId, publicKey: status.data.public_key });
        device.refresh();
        if (r.ok) toast.success(__('Notificaciones activadas en este dispositivo'));
        else if (r.reason === 'error') toast.error(__('No se pudieron activar'), r.message);
        else if (r.reason === 'unsupported') toast.error(__('Este navegador no permite notificaciones push'));
    };

    const onDisable = async (): Promise<void> => {
        if (tenantId === null) return;
        await disable.mutateAsync(tenantId);
        device.refresh();
        toast.success(__('Notificaciones desactivadas en este dispositivo'));
    };

    const onTest = async (): Promise<void> => {
        try {
            const r = await test.mutateAsync();
            if (r.sent > 0) {
                toast.success(
                    sprintf(r.sent === 1 ? __('Prueba enviada a %d dispositivo') : __('Prueba enviada a %d dispositivos'), r.sent),
                    __('Si no la ves en unos segundos, revisa que las notificaciones del sistema no estén silenciadas.'),
                );
            } else if (r.failed > 0) {
                toast.error(__('No se pudo enviar la prueba'), r.errors[0] ?? undefined);
            } else {
                toast.error(__('No hay dispositivos activos'), __('Activa las notificaciones en este dispositivo primero.'));
            }
        } catch (err) {
            toast.error(__('No se pudo enviar la prueba'), err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <Card data-testid="push-device-card">
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-pt-4">
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span
                        className={cn(
                            'imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md',
                            active ? 'imcrm-bg-success/15 imcrm-text-success' : 'imcrm-bg-muted imcrm-text-muted-foreground',
                        )}
                        aria-hidden
                    >
                        {active ? <BellRing className="imcrm-h-4 imcrm-w-4" /> : <BellOff className="imcrm-h-4 imcrm-w-4" />}
                    </span>
                    <div className="imcrm-min-w-0 imcrm-flex-1">
                        <p className="imcrm-text-sm imcrm-font-medium">{__('Notificaciones en este dispositivo')}</p>
                        <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground" data-testid="push-state">
                            {active
                                ? __('Activadas: los avisos que elijas abajo llegan también como notificación del teléfono o del computador.')
                                : __('Recibe los avisos como notificación del teléfono o del computador, aunque la app esté cerrada.')}
                        </p>
                    </div>
                </div>

                <PushBody
                    impersonating={impersonating !== undefined && impersonating !== null}
                    support={device.support}
                    permission={device.permission}
                    active={active}
                    busy={enable.isPending || disable.isPending || status.isLoading}
                    testing={test.isPending}
                    unavailable={status.isError}
                    onEnable={() => void onEnable()}
                    onDisable={() => void onDisable()}
                    onTest={() => void onTest()}
                    onRecheck={device.refresh}
                    onInstallHelp={() => setInstallHelp(true)}
                />

                {devices.length > 0 && (
                    <div className="imcrm-border-t imcrm-border-border imcrm-pt-3">
                        <p className="imcrm-mb-1.5 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                            {__('Dispositivos con notificaciones en esta empresa')}
                        </p>
                        <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid="push-devices">
                            {devices.map((d) => {
                                const info = describeDevice(d.user_agent);
                                const mine = d.endpoint_hash === device.hash;
                                const Icon = info.mobile ? Smartphone : Monitor;
                                return (
                                    <li
                                        key={d.id}
                                        className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-md imcrm-px-2 imcrm-py-2 hover:imcrm-bg-accent/40"
                                        data-push-device={d.id}
                                    >
                                        <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                                        <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                                            <span className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                                <span className="imcrm-truncate">{info.label}</span>
                                                {mine && (
                                                    <span className="imcrm-shrink-0 imcrm-rounded-full imcrm-bg-primary/10 imcrm-px-2 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-primary">
                                                        {__('Este dispositivo')}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                                                {d.last_used_at
                                                    ? sprintf(__('Último aviso %s'), relativeTime(d.last_used_at))
                                                    : sprintf(__('Activado %s'), relativeTime(d.created_at))}
                                            </span>
                                            {d.last_error && (
                                                <span className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-warning">
                                                    <TriangleAlert className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0" aria-hidden />
                                                    <span className="imcrm-truncate">{d.last_error}</span>
                                                </span>
                                            )}
                                        </span>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-text-muted-foreground hover:imcrm-text-destructive"
                                            aria-label={sprintf(__('Quitar %s'), info.label)}
                                            title={__('Quitar')}
                                            disabled={remove.isPending}
                                            onClick={() =>
                                                void (mine && tenantId !== null ? onDisable() : remove.mutateAsync(d.id).then(() => toast.success(__('Dispositivo quitado'))))
                                            }
                                        >
                                            <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                        </Button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
                {status.data && (
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {sprintf(
                            __('Como mucho %d notificaciones por hora: el resto queda en la campana. La notificación trae sólo el título y una línea; el detalle se ve al abrirla.'),
                            status.data.per_hour,
                        )}
                    </p>
                )}
            </CardContent>
            {installHelp && <InstallAppDialog open={installHelp} onOpenChange={setInstallHelp} appName={currentAppName()} />}
        </Card>
    );
}

function PushBody({
    impersonating,
    support,
    permission,
    active,
    busy,
    testing,
    unavailable,
    onEnable,
    onDisable,
    onTest,
    onRecheck,
    onInstallHelp,
}: {
    impersonating: boolean;
    support: ReturnType<typeof useThisDevice>['support'];
    permission: NotificationPermission | 'unsupported';
    active: boolean;
    busy: boolean;
    testing: boolean;
    unavailable: boolean;
    onEnable: () => void;
    onDisable: () => void;
    onTest: () => void;
    onRecheck: () => void;
    onInstallHelp: () => void;
}): JSX.Element {
    if (impersonating) {
        return <Notice tone="muted">{__('No disponible mientras ves la app como otra persona.')}</Notice>;
    }
    if (support === 'ios-install') {
        return (
            <Notice tone="warning" testId="push-ios-notice">
                <span>
                    {__('En iPhone y iPad las notificaciones sólo funcionan con la app instalada en la pantalla de inicio, en iOS 16.4 o más nuevo.')}
                </span>
                <Button type="button" variant="outline" size="sm" className="imcrm-mt-2 imcrm-self-start" onClick={onInstallHelp}>
                    {__('Cómo instalarla')}
                </Button>
            </Notice>
        );
    }
    if (support === 'ios-old') {
        return <Notice tone="warning">{__('Este iPhone tiene un iOS anterior a 16.4: actualízalo para recibir notificaciones de la app.')}</Notice>;
    }
    if (support === 'unsupported') {
        return (
            <Notice tone="muted" testId="push-unsupported">
                {__('Este navegador no permite notificaciones push (o la página no se abrió con https). Prueba con Chrome, Edge, Firefox o Safari actualizados.')}
            </Notice>
        );
    }
    if (unavailable) {
        return <Notice tone="warning">{__('Las notificaciones push no están disponibles en este servidor ahora. Intenta más tarde.')}</Notice>;
    }
    if (permission === 'denied') {
        return (
            <Notice tone="warning" testId="push-blocked">
                <span className="imcrm-font-medium">{__('Bloqueaste las notificaciones para este sitio.')}</span>
                <span>{unblockHint()}</span>
                <Button type="button" variant="outline" size="sm" className="imcrm-mt-2 imcrm-self-start" onClick={onRecheck}>
                    {__('Ya las desbloqueé')}
                </Button>
            </Notice>
        );
    }
    if (!active) {
        return (
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Button type="button" size="sm" onClick={onEnable} disabled={busy} data-testid="push-enable">
                    {busy ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <BellRing className="imcrm-h-3.5 imcrm-w-3.5" />}
                    {__('Activar en este dispositivo')}
                </Button>
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('El navegador te va a pedir permiso.')}</span>
            </div>
        );
    }
    return (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
            <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-bg-success/15 imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-success" data-testid="push-active">
                <BellRing className="imcrm-h-3 imcrm-w-3" aria-hidden />
                {__('Activadas en este dispositivo')}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={onTest} disabled={testing} data-testid="push-test">
                {testing ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Send className="imcrm-h-3.5 imcrm-w-3.5" />}
                {__('Enviarme una prueba')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onDisable} disabled={busy} data-testid="push-disable">
                {__('Desactivar')}
            </Button>
        </div>
    );
}

/** Cómo desbloquear el permiso, según el navegador. */
function unblockHint(): string {
    const info = deviceInfo();
    if (info.ios) return __('Abre los Ajustes del iPhone → Notificaciones → busca la app → activa «Permitir notificaciones».');
    const b = browserName();
    if (info.android && (b === 'chrome' || b === 'samsung' || b === 'edge')) {
        return __('Toca el candado (o ⋮ → Información del sitio) junto a la dirección → Permisos → Notificaciones → Permitir. Después vuelve aquí.');
    }
    if (b === 'firefox') return __('Haz clic en el candado junto a la dirección, quita el bloqueo de «Enviar notificaciones» y recarga la página.');
    if (b === 'safari') return __('En Safari → Ajustes → Sitios web → Notificaciones, elige «Permitir» para este sitio.');
    return __('Haz clic en el candado (o en los ajustes del sitio) junto a la dirección → Notificaciones → Permitir, y recarga la página.');
}

function Notice({ tone, children, testId }: { tone: 'warning' | 'muted'; children: React.ReactNode; testId?: string }): JSX.Element {
    return (
        <div
            data-testid={testId}
            className={cn(
                'imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-md imcrm-px-3 imcrm-py-2 imcrm-text-xs',
                tone === 'warning' ? 'imcrm-bg-warning/15 imcrm-text-foreground' : 'imcrm-bg-muted imcrm-text-muted-foreground',
            )}
        >
            {children}
        </div>
    );
}
