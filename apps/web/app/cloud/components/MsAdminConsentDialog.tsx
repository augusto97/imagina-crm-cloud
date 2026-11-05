import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, Link2, Loader2, ShieldCheck, X } from 'lucide-react';
import type { MsAdminConsentStatus } from '@imagina-base/shared';

import { useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';

/**
 * v0.1.363 — «Enlace para tu administrador» de Microsoft 365.
 *
 * Muchas empresas con Microsoft 365 no dejan que sus empleados aprueben apps
 * de terceros: al conectar Outlook o Teams aparece «Se necesita la aprobación
 * del administrador». Aquí se crea el enlace con los permisos exactos para
 * que la persona se lo mande a su administrador de TI; él lo abre en su
 * navegador, aprueba una vez para toda la organización, y la persona vuelve a
 * «Conectar». El estado se ve aquí mismo («Esperando» / «Aprobado»).
 */

type Target = { kind: 'integration'; key: 'outlook' | 'teams' } | { kind: 'agenda' };

function basePath(t: Target): string {
    return t.kind === 'agenda' ? '/me/agenda-calendar/admin-consent' : `/integrations/${t.key}/admin-consent`;
}

function appName(t: Target): string {
    return t.kind === 'agenda' || t.key === 'outlook' ? 'Outlook' : 'Microsoft Teams';
}

export function msAdminConsentKey(tenantId: number | null, t: Target): readonly unknown[] {
    return ['ms-admin-consent', tenantId, t.kind === 'agenda' ? 'agenda' : t.key] as const;
}

function adminMessage(t: Target, url: string): string {
    return [
        __('Hola. Quiero conectar') + ` ${appName(t)} ` + __('a la app que usamos en la empresa, pero Microsoft 365 me pide «la aprobación del administrador».'),
        __('¿Me ayudas a aprobarla? Sólo tienes que abrir este enlace, entrar con tu cuenta de administrador de Microsoft 365 (global, de aplicaciones o de aplicaciones en la nube) y aceptar. Es una sola vez para toda la organización:'),
        url,
        __('¡Gracias!'),
    ].join('\n\n');
}

export function MsAdminConsentDialog({ target, open, onClose, onConnect }: { target: Target; open: boolean; onClose: () => void; onConnect?: () => void }): JSX.Element {
    const tenantId = useSession((s) => s.activeTenantId);
    const qc = useQueryClient();
    const [copied, setCopied] = useState<'link' | 'message' | null>(null);
    const key = msAdminConsentKey(tenantId, target);

    const status = useQuery({
        queryKey: key,
        queryFn: async () => (await api.get<MsAdminConsentStatus>(basePath(target))).data,
        enabled: open,
        // Mientras el diálogo está abierto, se entera solo si el administrador ya aprobó.
        refetchInterval: open ? 10_000 : false,
        retry: false,
    });
    const create = useMutation({
        mutationFn: async () => (await api.post<MsAdminConsentStatus>(basePath(target), {})).data,
        onSuccess: (doc) => qc.setQueryData(key, doc),
    });

    const s = status.data;
    const url = s?.url ?? null;
    // v0.1.366 — una aprobación de antes de que la app pidiera un permiso nuevo
    // (el calendario de Teams) no alcanza: hace falta aprobar otra vez.
    const outdated = s?.outdated === true;
    const approved = outdated ? null : (s?.approved_at ?? null);

    const copy = async (what: 'link' | 'message'): Promise<void> => {
        if (!url) return;
        try {
            await navigator.clipboard.writeText(what === 'link' ? url : adminMessage(target, url));
            setCopied(what);
            window.setTimeout(() => setCopied(null), 2000);
        } catch {
            // Sin permiso de portapapeles: el enlace queda a la vista para copiarlo a mano.
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/50" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[90dvh] imcrm-w-[min(560px,calc(100vw-2rem))] -imcrm-translate-x-1/2 -imcrm-translate-y-1/2 imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-background imcrm-shadow-xl"
                    data-testid="ms-admin-consent-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-p-4">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                            <ShieldCheck className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Aprobación del administrador de Microsoft 365')}</Dialog.Title>
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
                            {__('Si al conectar Microsoft te mostró «Se necesita la aprobación del administrador», tu empresa no deja que cada persona apruebe apps por su cuenta. Un administrador de Microsoft 365 de tu empresa tiene que aprobarla una sola vez para toda la organización. Mándale este enlace:')}
                        </p>

                        {approved && (
                            <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-success/30 imcrm-bg-success/10 imcrm-p-3" data-testid="ms-admin-consent-approved">
                                <CheckCircle2 className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-success" aria-hidden />
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                                    <span>
                                        <strong>{__('Tu administrador ya aprobó.')}</strong> {sprintf(__('Fue el %s. Ya puedes conectar %s.'), formatDateTimeStr(approved), appName(target))}
                                    </span>
                                    {onConnect && (
                                        <Button size="sm" className="imcrm-self-start" onClick={onConnect} data-testid="ms-admin-consent-connect">
                                            {sprintf(__('Conectar %s'), appName(target))}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}

                        {outdated && (
                            <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-p-3" data-testid="ms-admin-consent-outdated">
                                <ShieldCheck className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-warning" aria-hidden />
                                <span>
                                    <strong>{__('Hace falta aprobar un permiso nuevo.')}</strong>{' '}
                                    {sprintf(
                                        __('Tu administrador aprobó la app el %1$s, pero desde entonces %2$s pide además: %3$s. Lo de antes sigue funcionando; para lo nuevo, crea un enlace y mándaselo otra vez.'),
                                        formatDateTimeStr(s?.approved_at ?? ''),
                                        appName(target),
                                        (s?.missing_permissions ?? []).join(', ').toLowerCase(),
                                    )}
                                </span>
                            </div>
                        )}

                        {status.isLoading && (
                            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-muted-foreground">
                                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Cargando…')}
                            </p>
                        )}
                        {status.isError && <p className="imcrm-text-destructive">{(status.error as Error).message}</p>}

                        {s && !url && (
                            <Button onClick={() => create.mutate()} disabled={create.isPending} className="imcrm-gap-2 imcrm-self-start" data-testid="ms-admin-consent-create">
                                {create.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Link2 className="imcrm-h-4 imcrm-w-4" />}
                                {approved ? __('Crear un enlace nuevo') : __('Crear el enlace para mi administrador')}
                            </Button>
                        )}
                        {create.isError && <p className="imcrm-text-destructive">{(create.error as Error).message}</p>}

                        {url && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                                <input
                                    readOnly
                                    value={url}
                                    onFocus={(e) => e.currentTarget.select()}
                                    className="imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-muted/40 imcrm-px-3 imcrm-py-2 imcrm-font-mono imcrm-text-xs"
                                    aria-label={__('Enlace para tu administrador')}
                                    data-testid="ms-admin-consent-url"
                                />
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                                    <Button size="sm" onClick={() => void copy('message')} className="imcrm-gap-1.5" data-testid="ms-admin-consent-copy-message">
                                        <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {copied === 'message' ? __('¡Copiado!') : __('Copiar mensaje para tu administrador')}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => void copy('link')} className="imcrm-gap-1.5" data-testid="ms-admin-consent-copy-link">
                                        <Link2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {copied === 'link' ? __('¡Copiado!') : __('Copiar sólo el enlace')}
                                    </Button>
                                </div>
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {s?.expires_at ? sprintf(__('Sirve hasta el %s.'), formatDateTimeStr(s.expires_at)) + ' ' : ''}
                                    {__('Cuando tu administrador lo apruebe, esta ventana lo muestra sola y puedes volver a «Conectar».')}
                                </p>
                            </div>
                        )}

                        {s?.error && !approved && (
                            <div className="imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-3 imcrm-text-destructive" data-testid="ms-admin-consent-error">
                                <strong>{__('El último intento no funcionó:')}</strong> {s.error}
                            </div>
                        )}

                        {s && s.permissions.length > 0 && (
                            <div>
                                <p className="imcrm-mb-1 imcrm-text-xs imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Lo que aprueba')}</p>
                                <ul className="imcrm-list-disc imcrm-pl-5 imcrm-text-muted-foreground">
                                    {s.permissions.map((p) => (
                                        <li key={p}>{p}</li>
                                    ))}
                                </ul>
                                <p className="imcrm-mt-2 imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Cada persona conecta su propia cuenta: la app sólo usa estos permisos con la cuenta de quien conecta.')}
                                </p>
                            </div>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
