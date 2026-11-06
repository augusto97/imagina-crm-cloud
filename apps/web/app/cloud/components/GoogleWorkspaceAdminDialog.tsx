import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { Copy, ExternalLink, Loader2, ShieldCheck, X } from 'lucide-react';
import { googleWorkspaceAdminMessage, googleWorkspaceAdminSteps, type GoogleWorkspaceAdminHelp, type IntegrationKey } from '@imagina-base/shared';

import { useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';

/**
 * v0.1.384 — «¿Tu empresa bloquea la app?» para Google Workspace.
 *
 * Es lo que en Microsoft 365 es el enlace de aprobación (v0.1.363), pero
 * Google no tiene ese enlace: si el administrador de Workspace no deja usar
 * apps de terceros, Google muestra «Acceso bloqueado» o «Error 400:
 * admin_policy_enforced» en SU pantalla y no vuelve a la app. La salida es
 * que el administrador marque la app como «De confianza» en admin.google.com,
 * buscándola por su ID de cliente. Aquí está el mensaje listo para copiar.
 */

type Target = { kind: 'integration'; key: IntegrationKey; name: string } | { kind: 'agenda' };

function path(t: Target): string {
    return t.kind === 'agenda' ? '/me/agenda-calendar/google-admin' : `/integrations/${t.key}/google-admin`;
}

function appName(t: Target): string {
    return t.kind === 'agenda' ? 'Google Calendar' : t.name;
}

export function GoogleWorkspaceAdminDialog({ target, open, onClose, onConnect }: { target: Target; open: boolean; onClose: () => void; onConnect?: () => void }): JSX.Element {
    const tenantId = useSession((s) => s.activeTenantId);
    const [copied, setCopied] = useState<'message' | 'id' | null>(null);
    const help = useQuery({
        queryKey: ['google-workspace-help', tenantId, target.kind === 'agenda' ? 'agenda' : target.key],
        queryFn: async () => (await api.get<GoogleWorkspaceAdminHelp>(path(target))).data,
        enabled: open,
        retry: false,
        staleTime: 5 * 60_000,
    });
    const h = help.data;

    const copy = async (what: 'message' | 'id'): Promise<void> => {
        if (!h) return;
        try {
            await navigator.clipboard.writeText(what === 'id' ? h.client_id : googleWorkspaceAdminMessage(h, appName(target)));
            setCopied(what);
            window.setTimeout(() => setCopied(null), 2000);
        } catch {
            // Sin permiso de portapapeles: el texto queda a la vista para copiarlo a mano.
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/50" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[90dvh] imcrm-w-[min(560px,calc(100vw-2rem))] -imcrm-translate-x-1/2 -imcrm-translate-y-1/2 imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-background imcrm-shadow-xl"
                    data-testid="google-admin-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-p-4">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                            <ShieldCheck className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Si Google Workspace bloquea la app')}</Dialog.Title>
                            <Dialog.Description className="imcrm-mt-0.5 imcrm-text-sm imcrm-text-muted-foreground">
                                {sprintf(__('Para conectar %s en tu empresa'), appName(target))}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-overflow-y-auto imcrm-p-4 imcrm-text-sm">
                        <p className="imcrm-text-muted-foreground">
                            {__('Si al conectar, Google te mostró «Acceso bloqueado», «Esta app está bloqueada» o «Error 400: admin_policy_enforced», el administrador de Google Workspace de tu empresa no deja usar apps de terceros sin revisarlas. Tiene que marcarla como de confianza una sola vez para toda la organización. Mándale este mensaje:')}
                        </p>

                        {help.isLoading && (
                            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-muted-foreground">
                                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Cargando…')}
                            </p>
                        )}
                        {help.isError && <p className="imcrm-text-destructive">{(help.error as Error).message}</p>}

                        {h && (
                            <>
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                                    <Button size="sm" className="imcrm-gap-1.5" onClick={() => void copy('message')} data-testid="google-admin-copy-message">
                                        <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {copied === 'message' ? __('¡Copiado!') : __('Copiar mensaje para tu administrador')}
                                    </Button>
                                    <Button size="sm" variant="outline" className="imcrm-gap-1.5" onClick={() => void copy('id')} data-testid="google-admin-copy-id">
                                        <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {copied === 'id' ? __('¡Copiado!') : __('Copiar el ID de cliente')}
                                    </Button>
                                </div>

                                <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-3">
                                    <p className="imcrm-mb-2 imcrm-font-medium">{__('Lo que hace tu administrador')}</p>
                                    <ol className="imcrm-list-decimal imcrm-space-y-1.5 imcrm-pl-5" data-testid="google-admin-steps">
                                        {googleWorkspaceAdminSteps(h.client_id).map((step) => (
                                            <li key={step} className="imcrm-break-words">{__(step)}</li>
                                        ))}
                                    </ol>
                                    <a
                                        href="https://admin.google.com/ac/owl/list?tab=configuredApps"
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        className="imcrm-mt-3 imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-primary hover:imcrm-underline"
                                    >
                                        <ExternalLink className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                        {__('Abrir esa pantalla en la consola de Google (sólo para el administrador)')}
                                    </a>
                                </div>

                                {h.permissions.length > 0 && (
                                    <div>
                                        <p className="imcrm-mb-1 imcrm-font-medium">{__('Lo que pide la app')}</p>
                                        <ul className="imcrm-list-disc imcrm-space-y-0.5 imcrm-pl-5 imcrm-text-muted-foreground" data-testid="google-admin-permissions">
                                            {h.permissions.map((p) => (
                                                <li key={p}>{__(p)}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                <p className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3 imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('¿El mensaje de Google dice que la app «no completó el proceso de verificación de Google»? Eso no lo arregla tu empresa: avísale a quien administra esta plataforma.')}
                                </p>

                                {onConnect && (
                                    <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-3">
                                        <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('¿Tu administrador ya la marcó como de confianza?')}</span>
                                        <Button size="sm" variant="outline" onClick={onConnect} data-testid="google-admin-connect">
                                            {sprintf(__('Conectar %s'), appName(target))}
                                        </Button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
