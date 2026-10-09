import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    INTEGRATIONS,
    INTEGRATION_PROVIDER_DEFS,
    PROVIDER_GUIDES,
    appDescriptionText,
    integrationScopes,
    registrableDomain,
    scopeJustificationText,
    videoScriptText,
    type IntegrationProvider,
    type PlatformIntegrationApp,
    type PlatformLegalView,
} from '@imagina-base/shared';
import { Check, Copy, KeyRound } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';

import { LEGAL_QUERY_KEY, PlatformLegalCard } from './PlatformLegalCard';
import { ProviderGuideView, type GuideValues } from './ProviderGuideView';

/**
 * Consola de plataforma → Integraciones (v0.1.203, ADR-S22 fase 4).
 *
 * El operador registra UNA vez la app de cada proveedor (Google, Microsoft,
 * Slack) y con eso todas las empresas pueden conectar su cuenta con un botón.
 * Es exactamente lo que hace ClickUp: la complejidad técnica la absorbe quien
 * opera la plataforma, no cada cliente. El client id identifica a la APP; las
 * cuentas y los tokens siguen siendo de cada empresa.
 */
export function PlatformIntegrationsCard(): JSX.Element {
    const q = useQuery({
        queryKey: ['platform-integrations'],
        queryFn: () => api.platformIntegrationsGet(),
        retry: false,
    });
    const legal = useQuery({
        queryKey: LEGAL_QUERY_KEY,
        queryFn: () => api.platformLegalGet(),
        retry: false,
    });

    if (q.isError) {
        return <p className="imcrm-text-sm imcrm-text-destructive">{errText(q.error)}</p>;
    }
    const data = q.data;

    return (
        <div className="imcrm-space-y-4" data-testid="imcrm-platform-integrations">
            <Card>
                <CardHeader>
                    <CardTitle>{__('Integraciones')}</CardTitle>
                    <CardDescription>
                        {__(
                            'Registra una vez la app de cada proveedor y todas las empresas podrán conectar su Google, Microsoft o Slack con un solo botón. Las apps que funcionan con una clave (WhatsApp, Telegram) no necesitan nada aquí.',
                        )}
                    </CardDescription>
                </CardHeader>
                {data && (
                    <CardContent>
                        <Label>{__('URI de redirección (la misma para los tres proveedores)')}</Label>
                        <CopyField value={data.redirect_uri} testId="imcrm-platform-redirect-uri" />
                    </CardContent>
                )}
            </Card>
            <PlatformLegalCard q={legal} />
            {(data?.apps ?? []).map((app) => (
                <ProviderCard key={app.provider} app={app} redirectUri={data!.redirect_uri} legal={legal.data ?? null} />
            ))}
        </div>
    );
}

function ProviderCard({
    app,
    redirectUri,
    legal,
}: {
    app: PlatformIntegrationApp;
    redirectUri: string;
    legal: PlatformLegalView | null;
}): JSX.Element {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const def = INTEGRATION_PROVIDER_DEFS[app.provider];
    const [clientId, setClientId] = useState(app.client_id);
    const [secret, setSecret] = useState('');
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const unlocks = INTEGRATIONS.filter((i) => i.auth.kind === 'oauth' && i.auth.provider === app.provider);
    const scopes = [
        ...new Set(
            unlocks.flatMap((i) => integrationScopes(i).split(def.scope_separator === ',' ? ',' : ' ')),
        ),
    ].filter(Boolean);
    const values = guideValues(redirectUri, scopes, legal);

    const save = useMutation({
        mutationFn: (input: { client_id?: string; client_secret?: string; clear?: boolean }) =>
            api.platformIntegrationSet(app.provider as IntegrationProvider, input),
        onSuccess: (res, input) => {
            setSecret('');
            setClientId(res.client_id);
            setNotice({ kind: 'ok', text: input.clear ? __('Configuración quitada.') : __('Guardado.') });
            void qc.invalidateQueries({ queryKey: ['platform-integrations'] });
        },
        onError: (err) => setNotice({ kind: 'err', text: errText(err) }),
    });

    return (
        <Card data-testid="imcrm-platform-provider" data-provider={app.provider}>
            <CardHeader>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                    <div className="imcrm-flex -imcrm-space-x-1.5">
                        {unlocks.map((i) => (
                            <IntegrationLogo key={i.key} integrationKey={i.key} size={28} className="imcrm-ring-2 imcrm-ring-card" />
                        ))}
                    </div>
                    <CardTitle className="imcrm-flex-1">{def.label}</CardTitle>
                    {app.configured ? (
                        <Badge variant="success">{__('Configurada')}</Badge>
                    ) : (
                        <Badge variant="outline">{__('Sin configurar')}</Badge>
                    )}
                </div>
                <CardDescription>
                    {__('Habilita')}: {unlocks.map((i) => i.name).join(', ')}.
                    {app.connections > 0 && (
                        <>
                            {' '}
                            {app.connections === 1
                                ? __('1 conexión de empresas la usa hoy.')
                                : `${app.connections} ${__('conexiones de empresas la usan hoy.')}`}
                        </>
                    )}
                </CardDescription>
            </CardHeader>
            <CardContent className="imcrm-space-y-4">
                <ProviderGuideView provider={app.provider} guide={PROVIDER_GUIDES[app.provider]} values={values} />
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-4">
                    <KeyRound className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    <span className="imcrm-text-sm imcrm-font-medium">{__('Credenciales de la app')}</span>
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('— lo que te da')} {def.label} {__('al crear el cliente')}
                    </span>
                </div>
                <form
                    className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        setNotice(null);
                        save.mutate({ client_id: clientId.trim(), client_secret: secret.trim() });
                    }}
                >
                    <div className="imcrm-space-y-1">
                        <Label htmlFor={`pi-${app.provider}-id`}>{__('Client ID')}</Label>
                        <Input
                            id={`pi-${app.provider}-id`}
                            value={clientId}
                            onChange={(e) => setClientId(e.target.value)}
                            autoComplete="off"
                            data-testid="imcrm-platform-client-id"
                        />
                    </div>
                    <div className="imcrm-space-y-1">
                        <Label htmlFor={`pi-${app.provider}-secret`}>{__('Client Secret')}</Label>
                        <Input
                            id={`pi-${app.provider}-secret`}
                            type="password"
                            value={secret}
                            onChange={(e) => setSecret(e.target.value)}
                            autoComplete="off"
                            placeholder={
                                app.has_secret
                                    ? `${app.secret_hint ?? '••••'} — ${__('deja vacío para conservarlo')}`
                                    : ''
                            }
                            data-testid="imcrm-platform-client-secret"
                        />
                        {app.secret_unreadable && (
                            <p className="imcrm-text-xs imcrm-text-destructive">
                                {__('El secreto guardado no se puede leer con la clave actual del servidor: cárgalo de nuevo.')}
                            </p>
                        )}
                    </div>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 sm:imcrm-col-span-2">
                        <Button
                            type="submit"
                            size="sm"
                            disabled={save.isPending || clientId.trim() === '' || (!app.has_secret && secret.trim() === '')}
                            data-testid="imcrm-platform-save"
                        >
                            {__('Guardar')}
                        </Button>
                        {(app.client_id !== '' || app.has_secret) && (
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={save.isPending}
                                onClick={async () => {
                                    const ok = await confirm({
                                        title: `${__('¿Quitar la app de')} ${def.label}?`,
                                        description: __(
                                            'Las empresas ya no podrán conectar esas apps, y las conexiones existentes dejarán de renovarse.',
                                        ),
                                        confirmLabel: __('Quitar'),
                                        destructive: true,
                                    });
                                    if (ok) save.mutate({ clear: true });
                                }}
                            >
                                {__('Quitar')}
                            </Button>
                        )}
                        {notice && (
                            <span
                                className={
                                    notice.kind === 'ok'
                                        ? 'imcrm-text-sm imcrm-text-success'
                                        : 'imcrm-text-sm imcrm-text-destructive'
                                }
                            >
                                {notice.text}
                            </span>
                        )}
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}

function CopyField({ value, testId }: { value: string; testId?: string }): JSX.Element {
    const [copied, setCopied] = useState(false);
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
            <code
                className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-rounded-md imcrm-bg-muted imcrm-px-2 imcrm-py-1.5 imcrm-text-xs"
                data-testid={testId}
            >
                {value}
            </code>
            <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                    void navigator.clipboard?.writeText(value).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                    });
                }}
            >
                {copied ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                {copied ? __('Copiada') : __('Copiar')}
            </Button>
        </div>
    );
}

/** Valores de la guía resueltos con los datos de ESTA instalación. */
function guideValues(redirectUri: string, scopes: string[], legal: PlatformLegalView | null): GuideValues {
    let origin = '';
    let host = '';
    try {
        const u = new URL(redirectUri);
        origin = u.origin;
        host = u.hostname;
    } catch {
        /* URI inválida: los valores derivados quedan vacíos */
    }
    const appName = legal?.settings.app_name || 'Imagina Base';
    const email = legal?.settings.contact_email ?? '';
    const missingLegal = legal ? undefined : __('Cargando…');
    return {
        redirect_uri: { label: __('URI de redirección'), value: redirectUri },
        origin: { label: __('Origen'), value: origin },
        domain: { label: __('Dominio'), value: registrableDomain(host) },
        scopes: { label: __('Permisos'), value: scopes.join(' ') },
        scopes_lines: { label: __('Permisos'), value: scopes.join('\n') },
        home_url: { label: __('Página principal'), value: legal?.urls.home ?? '', missing: missingLegal },
        privacy_url: { label: __('Privacidad'), value: legal?.urls.privacy ?? '', missing: missingLegal },
        terms_url: { label: __('Condiciones'), value: legal?.urls.terms ?? '', missing: missingLegal },
        app_name: { label: __('Nombre de la app'), value: appName },
        support_email: {
            label: __('Correo de asistencia'),
            value: email,
            missing: email === '' ? __('complétalo en «Páginas públicas» (arriba)') : undefined,
        },
        scope_justification: { label: __('Justificación de permisos'), value: scopeJustificationText(scopes) },
        video_script: { label: __('Guion del video'), value: videoScriptText(appName, origin) },
        app_description: { label: __('Descripción de la app'), value: appDescriptionText(appName) },
    };
}

function errText(err: unknown): string {
    if (err instanceof CloudApiError) return err.message;
    return err instanceof Error ? err.message : String(err);
}
