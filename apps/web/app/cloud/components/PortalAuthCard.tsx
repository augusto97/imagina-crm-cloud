import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, DoorOpen, KeyRound } from 'lucide-react';
import type { PortalAuthSettings } from '@imagina-base/shared';

import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';

/**
 * v0.1.290 — Cómo entran los clientes al portal de la empresa: siempre con un
 * enlace por correo y, si la empresa lo permite, también con una contraseña
 * que cada cliente crea desde su portal. Esa contraseña es SÓLO de este
 * portal (no es la de ninguna otra cuenta). Más el enlace de entrada para
 * compartir.
 */
export function PortalAuthCard(): JSX.Element | null {
    const qc = useQueryClient();
    const q = useQuery({ queryKey: ['portal-auth'], queryFn: () => api.portalAuthGet(), retry: false });
    const [pending, setPending] = useState<boolean | null>(null);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const save = useMutation({
        mutationFn: (next: boolean) => api.portalAuthSet(next),
        // El interruptor se mueve al toque (el valor del servidor llega un tick después).
        onMutate: (next) => {
            setError(null);
            setPending(next);
        },
        onSuccess: (res: PortalAuthSettings) => qc.setQueryData(['portal-auth'], res),
        onError: (err) => setError(err instanceof CloudApiError || err instanceof Error ? err.message : String(err)),
        onSettled: () => setPending(null),
    });

    if (q.isError) return null;
    const enabled = pending ?? q.data?.password_enabled ?? false;
    const entry = q.data?.entry_url ?? '';

    return (
        <Card data-testid="portal-auth-card">
            <CardHeader>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-ring-1 imcrm-ring-border">
                        <DoorOpen className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    </span>
                    <CardTitle>{__('Cómo entran tus clientes al portal')}</CardTitle>
                </div>
                <CardDescription>
                    {__('Siempre pueden entrar con un enlace que les llega al correo. Si lo permites, también con una contraseña que cada cliente crea desde su portal.')}
                </CardDescription>
            </CardHeader>
            <CardContent className="imcrm-space-y-4">
                <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
                    <input
                        type="checkbox"
                        className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-accent-[hsl(var(--imcrm-primary))]"
                        checked={enabled}
                        disabled={!q.data || save.isPending}
                        onChange={(e) => save.mutate(e.target.checked)}
                        data-testid="portal-password-toggle"
                    />
                    <span className="imcrm-space-y-1">
                        <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                            <KeyRound className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {__('Permitir contraseña en el portal')}
                        </span>
                        <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Es una contraseña SÓLO para el portal de tu empresa: no sirve para ninguna otra cuenta ni para otras empresas. Si un cliente la olvida, entra con un enlace por correo y crea una nueva. Al quitarle el acceso, su contraseña se borra.')}
                        </span>
                    </span>
                </label>
                {error && (
                    <p role="alert" className="imcrm-text-xs imcrm-text-destructive">
                        {error}
                    </p>
                )}
                <div className="imcrm-space-y-1.5">
                    <p className="imcrm-text-sm imcrm-font-medium">{__('Enlace de entrada al portal')}</p>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Compártelo con tus clientes (en un correo o en tu sitio): abre la pantalla de entrar con tu marca.')}
                    </p>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <code
                            className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-2 imcrm-py-1.5 imcrm-text-xs"
                            data-testid="portal-entry-url"
                        >
                            {entry || '…'}
                        </code>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!entry}
                            onClick={() =>
                                void navigator.clipboard
                                    .writeText(entry)
                                    .then(() => {
                                        setCopied(true);
                                        window.setTimeout(() => setCopied(false), 1600);
                                    })
                                    .catch(() => undefined)
                            }
                            data-testid="portal-entry-copy"
                        >
                            {copied ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                            {copied ? __('Copiado') : __('Copiar')}
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
