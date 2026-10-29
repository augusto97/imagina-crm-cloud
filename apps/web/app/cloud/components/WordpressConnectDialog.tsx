import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { Connection, ConnectorVisibility } from '@imagina-base/shared';
import { ChevronDown, ChevronRight, ExternalLink, ShieldCheck, X } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Conectar un sitio WordPress (v0.1.333, ADR-S83). El camino de todos los
 * días es UN clic: se escribe la dirección, se abre la pantalla «Autorizar
 * aplicación» del PROPIO WordPress, la persona aprueba y vuelve conectada —
 * nadie copia ni pega contraseñas—. Pegar una contraseña de aplicación a mano
 * queda plegado para los sitios donde la pantalla no está disponible.
 */
export function WordpressConnectDialog({
    connection,
    visibility,
    onClose,
    onDone,
}: {
    /** Si viene, se vuelve a conectar esa conexión (la contraseña se revocó). */
    connection: Connection | null;
    visibility: ConnectorVisibility;
    onClose: () => void;
    onDone: (message: string) => void;
}): JSX.Element {
    const navigate = useNavigate();
    const [siteUrl, setSiteUrl] = useState('');
    const [manual, setManual] = useState(false);
    const [login, setLogin] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const editing = connection !== null;
    // Al volver a conectar, la dirección ya se conoce (la de la sincronización).
    const known = useQuery({
        queryKey: ['site-sync', connection?.id ?? 0, 'url'],
        queryFn: () => api.siteSyncStatus(connection!.id),
        enabled: connection !== null,
        retry: false,
    });
    useEffect(() => {
        if (known.data?.site_url && siteUrl === '') setSiteUrl(known.data.site_url);
        // Sólo al llegar la dirección: después manda lo que escribe la persona.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [known.data?.site_url]);

    const start = useMutation({
        mutationFn: () => api.wordpressConnectStart({ site_url: siteUrl.trim(), visibility, connection_id: connection?.id ?? null }),
        // WordPress muestra su pantalla y vuelve solo a la página del sitio.
        onSuccess: (res) => window.location.assign(res.authorize_url),
        onError: (err) => setError(errText(err)),
    });

    const save = useMutation({
        mutationFn: () =>
            api.integrationConnect('wordpress', {
                fields: { site_url: siteUrl.trim(), user_login: login.trim(), app_password: password.trim() },
                visibility,
                connection_id: connection?.id ?? null,
            }),
        onSuccess: (res) => {
            onDone(res.warning ? `${__('El sitio quedó conectado.')} ${res.warning}` : __('El sitio quedó conectado.'));
            navigate(`/settings/sites/${res.connection.id}`);
        },
        onError: (err) => setError(errText(err)),
    });

    const busy = start.isPending || save.isPending;

    return (
        <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-lg',
                        'imcrm-max-h-[90vh] imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg',
                    )}
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="imcrm-wordpress-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <IntegrationLogo integrationKey="wordpress" size={44} />
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {editing ? __('Volver a conectar el sitio') : __('Conectar un sitio WordPress')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Trae tus páginas, entradas y tipos de contenido a listas, y edítalos desde aquí.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <form
                        className="imcrm-mt-5 imcrm-flex imcrm-flex-col imcrm-gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            setError(null);
                            if (manual) save.mutate();
                            else start.mutate();
                        }}
                    >
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="wp-site">{__('Dirección del sitio')}</Label>
                            <Input
                                id="wp-site"
                                autoFocus
                                autoComplete="url"
                                inputMode="url"
                                placeholder="https://misitio.com"
                                value={siteUrl}
                                onChange={(e) => setSiteUrl(e.target.value)}
                                data-testid="imcrm-wordpress-site"
                            />
                        </div>

                        {!manual && (
                            <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted imcrm-p-3 imcrm-text-xs imcrm-text-muted-foreground">
                                <ShieldCheck className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-success" aria-hidden />
                                <p>
                                    {__('Te llevamos a tu WordPress para que apruebes la conexión. WordPress crea una contraseña sólo para esta app, que puedes revocar cuando quieras desde tu perfil. Entra con un usuario Editor o Administrador.')}
                                </p>
                            </div>
                        )}

                        <div>
                            <button
                                type="button"
                                className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground"
                                onClick={() => {
                                    setManual((v) => !v);
                                    setError(null);
                                }}
                                aria-expanded={manual}
                                data-testid="imcrm-wordpress-manual"
                            >
                                {manual ? <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" /> : <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" />}
                                {__('Prefiero pegar una contraseña de aplicación')}
                            </button>
                            {manual && (
                                <div className="imcrm-mt-3 imcrm-flex imcrm-flex-col imcrm-gap-4">
                                    <ol className="imcrm-list-decimal imcrm-space-y-1 imcrm-rounded-md imcrm-bg-muted imcrm-py-3 imcrm-pl-8 imcrm-pr-3 imcrm-text-xs imcrm-text-muted-foreground">
                                        <li>{__('En tu WordPress entra a Usuarios → Perfil (con un usuario Editor o Administrador).')}</li>
                                        <li>{__('Baja hasta «Contraseñas de aplicación», escribe un nombre (por ejemplo «Imagina») y toca «Añadir».')}</li>
                                        <li>{__('Copia la contraseña que aparece (se muestra una sola vez) y pégala aquí con tu usuario.')}</li>
                                    </ol>
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                        <Label htmlFor="wp-login">{__('Usuario de WordPress')}</Label>
                                        <Input id="wp-login" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} data-testid="imcrm-wordpress-login" />
                                    </div>
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                        <Label htmlFor="wp-pass">{__('Contraseña de aplicación')}</Label>
                                        <Input
                                            id="wp-pass"
                                            type="password"
                                            autoComplete="off"
                                            placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            data-testid="imcrm-wordpress-password"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {error && (
                            <p className="imcrm-whitespace-pre-wrap imcrm-break-words imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-wordpress-error">
                                {error}
                            </p>
                        )}

                        <div className="imcrm-flex imcrm-flex-wrap imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-4">
                            <Button type="button" variant="ghost" onClick={onClose}>
                                {__('Cancelar')}
                            </Button>
                            <Button
                                type="submit"
                                disabled={busy || siteUrl.trim() === '' || (manual && (login.trim() === '' || password.trim() === ''))}
                                data-testid="imcrm-wordpress-continue"
                            >
                                {manual ? (
                                    save.isPending ? __('Comprobando…') : __('Conectar')
                                ) : start.isPending ? (
                                    __('Buscando el sitio…')
                                ) : (
                                    <>
                                        {__('Continuar en WordPress')}
                                        <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </>
                                )}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function errText(err: unknown): string {
    if (err instanceof CloudApiError) return err.message;
    return err instanceof Error ? err.message : String(err);
}
