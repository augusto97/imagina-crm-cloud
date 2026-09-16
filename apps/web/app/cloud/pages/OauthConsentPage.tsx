import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PersonalTokenScope } from '@imagina-base/shared';
import { Loader2, Plug, ShieldCheck } from 'lucide-react';

import { LoginPage } from '@/cloud/pages/LoginPage';
import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useBranding } from '@/hooks/useBranding';
import { __ } from '@/lib/i18n';
import { CloudApiError } from '@/lib/cloud/client';

/**
 * v0.1.184 — Pantalla "Autorizar" del OAuth del MCP. El cliente (claude.ai,
 * Claude Desktop, Cursor) manda al navegador a `/oauth/authorize?req=…`
 * (fuera del hash router, como /reset y /verify): con sesión abierta se
 * elige workspace + alcance y se confirma; sin sesión, primero el login
 * normal y después la misma pantalla. La decisión vuelve al cliente por su
 * redirect_uri (que el backend validó contra lo registrado).
 */
export function getOauthRequestId(): string | null {
    try {
        const path = window.location.pathname.replace(/\/+$/, '');
        if (!path.endsWith('/oauth/authorize')) return null;
        const id = new URLSearchParams(window.location.search).get('req');
        return id && /^[A-Za-z0-9\-_]{16,40}$/.test(id) ? id : null;
    } catch {
        return null;
    }
}

const SCOPE_TEXT: Record<PersonalTokenScope, { label: string; hint: string }> = {
    read: { label: 'Sólo lectura', hint: 'Consultar listas, esquemas, registros y agregados.' },
    full: { label: 'Lectura y cambios', hint: 'Además propone cambios (listas, campos, tableros, automatizaciones, registros) que vos confirmás desde el cliente antes de aplicarse.' },
};

export function OauthConsentPage({ requestId }: { requestId: string }): JSX.Element {
    const user = useSession((s) => s.user);
    const ready = useSession((s) => s.ready);
    const memberships = useSession((s) => s.memberships);
    const activeTenantId = useSession((s) => s.activeTenantId);
    const setSession = useSession((s) => s.setSession);
    const markReady = useSession((s) => s.markReady);
    useBranding();

    const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
    useEffect(() => {
        if (me.isSuccess) {
            setSession(me.data);
            markReady();
        }
        if (me.isError) markReady();
    }, [me.isSuccess, me.isError, me.data, setSession, markReady]);

    if (!ready) return <Centered><Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" /></Centered>;
    if (!user) return <LoginPage />;
    // v0.1.185 — el rol client (portal) es "solo portal": no conecta asistentes.
    const eligible = memberships.filter((m) => m.role !== 'client');
    if (eligible.length === 0) {
        return (
            <Centered>
                <Card>
                    <h1 className="imcrm-text-lg imcrm-font-semibold">{__('Esta cuenta no puede conectar asistentes')}</h1>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="imcrm-oauth-client-only">
                        {__('El acceso por MCP es para miembros del equipo de una empresa. Tu cuenta sólo tiene acceso al portal del cliente.')}
                    </p>
                </Card>
            </Centered>
        );
    }
    return <Consent requestId={requestId} memberships={eligible} defaultTenantId={activeTenantId} userEmail={user.email} />;
}

function Consent({
    requestId,
    memberships,
    defaultTenantId,
    userEmail,
}: {
    requestId: string;
    memberships: Array<{ tenant_id: number; tenant_name: string; role: string }>;
    defaultTenantId: number | null;
    userEmail: string;
}): JSX.Element {
    const request = useQuery({ queryKey: ['oauth-request', requestId], queryFn: () => api.oauthRequest(requestId), retry: false });
    const [tenantId, setTenantId] = useState<number | null>(defaultTenantId ?? memberships[0]?.tenant_id ?? null);
    const [scope, setScope] = useState<PersonalTokenScope | null>(null);
    const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const effectiveScope = scope ?? request.data?.scope ?? 'full';
    const logout = useSession((s) => s.clear);

    const decide = async (kind: 'approve' | 'deny'): Promise<void> => {
        setBusy(kind);
        setError(null);
        try {
            const decision = kind === 'approve' && tenantId !== null
                ? await api.oauthApprove(requestId, { tenant_id: tenantId, scope: effectiveScope })
                : await api.oauthDeny(requestId);
            window.location.assign(decision.redirect_to);
        } catch (err) {
            setError(err instanceof CloudApiError ? err.message : __('Error inesperado'));
            setBusy(null);
        }
    };

    if (request.isLoading) return <Centered><Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" /></Centered>;
    if (request.isError || !request.data) {
        return (
            <Centered>
                <Card>
                    <h1 className="imcrm-text-lg imcrm-font-semibold">{__('Este pedido de autorización venció')}</h1>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="imcrm-oauth-expired">
                        {__('Volvé al cliente (Claude, Cursor…) y repetí "Conectar": tenés 10 minutos para autorizar desde que lo iniciás.')}
                    </p>
                    <Button variant="outline" size="sm" className="imcrm-self-start" onClick={() => window.location.assign('/')}>
                        {__('Ir a la app')}
                    </Button>
                </Card>
            </Centered>
        );
    }
    const req = request.data;

    return (
        <Centered>
            <Card>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-muted imcrm-text-muted-foreground imcrm-ring-1 imcrm-ring-border">
                        <Plug className="imcrm-h-5 imcrm-w-5" />
                    </span>
                    <div className="imcrm-min-w-0">
                        <h1 className="imcrm-text-lg imcrm-font-semibold imcrm-leading-tight" data-testid="imcrm-oauth-title">
                            <span className="imcrm-text-primary">{req.client_name}</span> {__('quiere conectarse a tu cuenta')}
                        </h1>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Desde')} <span className="imcrm-font-mono">{req.redirect_host}</span> · {__('como')} {userEmail}
                        </p>
                    </div>
                </div>

                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <label htmlFor="oauth-ws" className="imcrm-text-xs imcrm-font-medium">{__('Workspace')}</label>
                    <Select id="oauth-ws" value={tenantId ?? ''} onChange={(e) => setTenantId(Number(e.target.value))} data-testid="imcrm-oauth-workspace">
                        {memberships.map((m) => (
                            <option key={m.tenant_id} value={m.tenant_id}>
                                {m.tenant_name} · {m.role}
                            </option>
                        ))}
                    </Select>
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('El cliente actúa con TU rol en ese workspace, nunca con más permisos. Cambiarte de rol o salir del workspace lo desconecta al instante.')}
                    </p>
                </div>

                <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <legend className="imcrm-mb-1 imcrm-text-xs imcrm-font-medium">{__('Qué puede hacer')}</legend>
                    {(['read', 'full'] as const).map((s) => (
                        <label
                            key={s}
                            className={`imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-p-2.5 imcrm-text-sm ${effectiveScope === s ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border'}`}
                        >
                            <input type="radio" name="scope" value={s} checked={effectiveScope === s} onChange={() => setScope(s)} className="imcrm-mt-1" data-testid={`imcrm-oauth-scope-${s}`} />
                            <span>
                                <span className="imcrm-font-medium">{__(SCOPE_TEXT[s].label)}</span>
                                <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__(SCOPE_TEXT[s].hint)}</span>
                            </span>
                        </label>
                    ))}
                </fieldset>

                <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted/60 imcrm-p-2.5 imcrm-text-xs imcrm-text-muted-foreground">
                    <ShieldCheck className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    <span>{__('Podés revocar esta conexión cuando quieras desde Ajustes → Cuenta → Seguridad → Conexión MCP.')}</span>
                </p>

                {error && <p className="imcrm-text-xs imcrm-text-destructive" data-testid="imcrm-oauth-error">{error}</p>}

                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                    <button type="button" className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-underline" onClick={() => { void api.logout().finally(() => { logout(); window.location.reload(); }); }}>
                        {__('No soy yo — cambiar de cuenta')}
                    </button>
                    <div className="imcrm-flex imcrm-gap-2">
                        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void decide('deny')} data-testid="imcrm-oauth-deny">
                            {__('Cancelar')}
                        </Button>
                        <Button size="sm" disabled={busy !== null || tenantId === null} onClick={() => void decide('approve')} data-testid="imcrm-oauth-approve">
                            {busy === 'approve' && <Loader2 className="imcrm-mr-2 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                            {__('Autorizar')}
                        </Button>
                    </div>
                </div>
            </Card>
        </Centered>
    );
}

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
    return <div className="imcrm-flex imcrm-min-h-screen imcrm-items-center imcrm-justify-center imcrm-bg-muted/30 imcrm-p-4">{children}</div>;
}

function Card({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-w-full imcrm-max-w-md imcrm-flex-col imcrm-gap-4 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-md" data-testid="imcrm-oauth-consent">
            {children}
        </div>
    );
}
