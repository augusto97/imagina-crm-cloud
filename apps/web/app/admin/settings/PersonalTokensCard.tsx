import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatedPersonalToken, PersonalTokenScope } from '@imagina-base/shared';
import { AlertTriangle, Check, CheckCircle2, Copy, KeyRound, Loader2, Plug, RefreshCw, Trash2 } from 'lucide-react';

import { api, useSession } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';

const SCOPE_LABEL: Record<PersonalTokenScope, string> = {
    read: 'Sólo lectura',
    full: 'Lectura y cambios',
};

/**
 * Tokens de acceso personal (ADR-S21 fase 3): la credencial para conectar
 * Claude, Cursor u otro cliente MCP al workspace. Un token es de la persona
 * y de ESTE workspace, con el rol que ella tiene (nunca más). El secreto se
 * muestra UNA vez al crearlo, con el snippet listo para pegar.
 */
export function PersonalTokensCard(): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const tokens = useQuery({ queryKey: ['personal-tokens', tenantId], queryFn: () => api.personalTokens() });
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [scope, setScope] = useState<PersonalTokenScope>('read');
    const [expires, setExpires] = useState<'7' | '30' | '90' | '365' | 'never'>('90');
    const [created, setCreated] = useState<CreatedPersonalToken | null>(null);
    const [copied, setCopied] = useState<string | null>(null);

    const invalidate = (): Promise<void> => qc.invalidateQueries({ queryKey: ['personal-tokens', tenantId] });
    const create = useMutation({
        mutationFn: () =>
            api.createPersonalToken({ name: name.trim(), scope, expires_in_days: expires === 'never' ? null : (Number(expires) as 7 | 30 | 90 | 365) }),
        onSuccess: (res) => {
            setCreated(res);
            setCreating(false);
            setName('');
            void invalidate();
        },
    });
    const revoke = useMutation({
        mutationFn: (id: number) => api.revokePersonalToken(id),
        onSuccess: () => void invalidate(),
    });

    const copy = async (text: string, key: string): Promise<void> => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(key);
            setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
        } catch {
            // sin clipboard (http sin TLS) — el texto queda seleccionable
        }
    };

    const mcpUrl = api.mcpUrl();
    const list = tokens.data ?? [];

    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-tokens-card">
            <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                <div>
                    <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                        <Plug className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                        {__('Conexión MCP (Claude, Cursor y otros)')}
                    </h2>
                    <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Dejá que tu asistente de IA favorito lea este workspace y te proponga cambios, con tu mismo rol y permisos. Dos formas: "Autorizar" desde la app de Claude (sin copiar nada) o un token para pegar a mano.')}
                    </p>
                </div>
                {!creating && !created && (
                    <Button variant="outline" size="sm" className="imcrm-shrink-0" onClick={() => setCreating(true)} data-testid="imcrm-token-new">
                        <KeyRound className="imcrm-mr-2 imcrm-h-3.5 imcrm-w-3.5" /> {__('Nuevo token')}
                    </Button>
                )}
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-oauth-howto">
                <p className="imcrm-text-sm imcrm-font-medium">{__('Conectar desde claude.ai, Claude Desktop o el celular (sin token)')}</p>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('En Claude: Ajustes → Conectores → "Agregar conector personalizado", pegá esta URL y tocá Conectar. Claude te trae a una pantalla de esta app donde elegís el workspace y el alcance, y listo — el acceso se renueva solo y aparece abajo como una conexión, con el mismo botón Revocar.')}
                </p>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <code className="imcrm-min-w-0 imcrm-flex-1 imcrm-select-all imcrm-overflow-x-auto imcrm-rounded-md imcrm-bg-background imcrm-px-2 imcrm-py-1.5 imcrm-font-mono imcrm-text-xs imcrm-ring-1 imcrm-ring-border" data-testid="imcrm-oauth-url">
                        {mcpUrl}
                    </code>
                    <Button size="sm" variant="outline" onClick={() => void copy(mcpUrl, 'url')} aria-label={__('Copiar URL')}>
                        {copied === 'url' ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                    </Button>
                </div>
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('También sirve con "claude mcp add --transport http imagina-base <URL>" sin cabecera (Claude Code abre el navegador para autorizar) y con Cursor.')}
                </p>
                <DiscoveryCheck />
            </div>

            {creating && (
                <form
                    className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (name.trim()) create.mutate();
                    }}
                >
                    <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-3">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="tok-name" className="imcrm-text-xs">{__('Nombre (para reconocerlo)')}</Label>
                            <Input id="tok-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude en mi notebook" maxLength={80} data-testid="imcrm-token-name" />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="tok-scope" className="imcrm-text-xs">{__('Alcance')}</Label>
                            <Select id="tok-scope" value={scope} onChange={(e) => setScope(e.target.value as PersonalTokenScope)} data-testid="imcrm-token-scope">
                                <option value="read">{__('Sólo lectura (consultar listas y registros)')}</option>
                                <option value="full">{__('Lectura y cambios (propone; vos confirmás)')}</option>
                            </Select>
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="tok-exp" className="imcrm-text-xs">{__('Vence en')}</Label>
                            <Select id="tok-exp" value={expires} onChange={(e) => setExpires(e.target.value as typeof expires)}>
                                <option value="7">7 {__('días')}</option>
                                <option value="30">30 {__('días')}</option>
                                <option value="90">90 {__('días')}</option>
                                <option value="365">1 {__('año')}</option>
                                <option value="never">{__('Nunca')}</option>
                            </Select>
                        </div>
                    </div>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <Button type="submit" size="sm" disabled={!name.trim() || create.isPending} data-testid="imcrm-token-create">
                            {create.isPending && <Loader2 className="imcrm-mr-2 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                            {__('Crear token')}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
                            {__('Cancelar')}
                        </Button>
                        {create.isError && <span className="imcrm-text-xs imcrm-text-destructive">{create.error instanceof Error ? create.error.message : __('Error')}</span>}
                    </div>
                </form>
            )}

            {created && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-success/40 imcrm-bg-success/5 imcrm-p-4" data-testid="imcrm-token-created">
                    <p className="imcrm-text-sm imcrm-font-medium">{__('Token creado. Copialo ahora: no se vuelve a mostrar.')}</p>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <code className="imcrm-min-w-0 imcrm-flex-1 imcrm-select-all imcrm-overflow-x-auto imcrm-rounded-md imcrm-bg-background imcrm-px-2 imcrm-py-1.5 imcrm-font-mono imcrm-text-xs imcrm-ring-1 imcrm-ring-border" data-testid="imcrm-token-secret">
                            {created.secret}
                        </code>
                        <Button size="sm" variant="outline" onClick={() => void copy(created.secret, 'secret')} aria-label={__('Copiar token')}>
                            {copied === 'secret' ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                        </Button>
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-text-xs">
                        <span className="imcrm-font-medium">{__('Cómo conectarlo')}</span>
                        <Snippet
                            label="Claude Code"
                            text={`claude mcp add --transport http imagina-base ${mcpUrl} --header "Authorization: Bearer ${created.secret}"`}
                            copied={copied === 'cc'}
                            onCopy={(t) => void copy(t, 'cc')}
                        />
                        <Snippet
                            label={__('Claude Desktop / Cursor (JSON)')}
                            text={JSON.stringify({ mcpServers: { 'imagina-base': { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${created.secret}` } } } }, null, 2)}
                            copied={copied === 'json'}
                            onCopy={(t) => void copy(t, 'json')}
                        />
                    </div>
                    <Button size="sm" variant="ghost" className="imcrm-self-start" onClick={() => setCreated(null)}>
                        {__('Listo, ya lo guardé')}
                    </Button>
                </div>
            )}

            {tokens.isLoading ? (
                <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando…')}</p>
            ) : list.length === 0 ? (
                <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="imcrm-tokens-empty">
                    {__('Todavía no tenés tokens en este workspace.')}
                </p>
            ) : (
                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
                    {list.map((t) => (
                        <li key={t.id} className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-px-4 imcrm-py-3" data-testid="imcrm-token-row">
                            <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-text-muted-foreground imcrm-ring-1 imcrm-ring-border">
                                {t.client_name ? <Plug className="imcrm-h-4 imcrm-w-4" /> : <KeyRound className="imcrm-h-4 imcrm-w-4" />}
                            </span>
                            <div className="imcrm-min-w-0 imcrm-flex-1">
                                <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                                    {t.name}
                                    <Badge variant={t.scope === 'full' ? 'warning' : 'secondary'} className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">
                                        {__(SCOPE_LABEL[t.scope])}
                                    </Badge>
                                    {t.client_name && (
                                        <Badge variant="outline" className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]" data-testid="imcrm-token-connector">
                                            {__('Conexión autorizada')}
                                        </Badge>
                                    )}
                                </p>
                                <p className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                    <span className="imcrm-font-mono">{t.prefix}</span>
                                    {' · '}
                                    {t.last_used_at ? `${__('Último uso')} ${formatDateTimeStr(t.last_used_at)}` : __('Sin usar todavía')}
                                    {' · '}
                                    {t.client_name ? (
                                        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1"><RefreshCw className="imcrm-h-3 imcrm-w-3" />{__('se renueva solo')}</span>
                                    ) : t.expires_at ? `${__('Vence')} ${formatDateTimeStr(t.expires_at)}` : __('No vence')}
                                </p>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="imcrm-text-destructive hover:imcrm-text-destructive"
                                disabled={revoke.isPending}
                                onClick={() => {
                                    if (window.confirm(__('¿Revocar este token? El cliente que lo use dejará de funcionar al instante.'))) revoke.mutate(t.id);
                                }}
                                data-testid="imcrm-token-revoke"
                            >
                                <Trash2 className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5" /> {__('Revocar')}
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

/**
 * v0.1.186 — Autodiagnóstico del descubrimiento OAuth: lo que Claude consulta
 * al tocar "Conectar" es `/.well-known/oauth-authorization-server` en la RAÍZ
 * del host. Si el proxy no la enruta al API y el deploy no dejó el archivo
 * estático, ahí sale el HTML de la app y Claude falla con "Failed to start
 * MCP authorization". Se prueba desde el navegador (mismo origen) y se dice
 * en criollo qué pasa.
 */
function DiscoveryCheck(): JSX.Element | null {
    const [state, setState] = useState<'checking' | 'ok' | 'bad' | 'api-bad'>('checking');
    useEffect(() => {
        let cancelled = false;
        const probe = async (url: string): Promise<boolean> => {
            try {
                const r = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
                if (!r.ok) return false;
                const j = (await r.json()) as { issuer?: unknown; resource?: unknown };
                return typeof j.issuer === 'string' || typeof j.resource === 'string';
            } catch {
                return false;
            }
        };
        void (async () => {
            const base = api.mcpUrl().replace(/\/mcp$/, '');
            const apiOk = await probe(`${base}/oauth/.well-known/oauth-protected-resource`);
            const rootOk = apiOk && (await probe(`${window.location.origin}/.well-known/oauth-authorization-server`));
            if (!cancelled) setState(!apiOk ? 'api-bad' : rootOk ? 'ok' : 'bad');
        })();
        return () => {
            cancelled = true;
        };
    }, []);
    if (state === 'checking') return null;
    if (state === 'ok') {
        return (
            <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[11px] imcrm-text-success" data-testid="imcrm-oauth-discovery-ok">
                <CheckCircle2 className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Descubrimiento OAuth verificado: Claude puede conectarse a este servidor.')}
            </p>
        );
    }
    return (
        <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-warning/10 imcrm-p-2 imcrm-text-[11px] imcrm-text-foreground" data-testid="imcrm-oauth-discovery-bad">
            <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
            <span>
                {state === 'api-bad'
                    ? __('El API de este servidor todavía no responde el descubrimiento OAuth: hace falta actualizar la app a la versión 0.1.184 o superior (Plataforma → Actualizaciones).')
                    : __('La dirección /.well-known/oauth-authorization-server de este servidor devuelve la app en vez del JSON de descubrimiento, así que Claude no puede iniciar la autorización. Se corrige solo al instalar la próxima actualización (0.1.186 o superior) o agregando la regla de proxy "/.well-known/oauth-*" → API (ver deploy/Caddyfile o deploy/nginx.conf).')}
            </span>
        </p>
    );
}

function Snippet({ label, text, copied, onCopy }: { label: string; text: string; copied: boolean; onCopy: (t: string) => void }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-items-start imcrm-gap-2">
            <div className="imcrm-min-w-0 imcrm-flex-1">
                <div className="imcrm-mb-0.5 imcrm-text-muted-foreground">{label}</div>
                <pre className="imcrm-overflow-x-auto imcrm-rounded-md imcrm-bg-background imcrm-px-2 imcrm-py-1.5 imcrm-font-mono imcrm-text-[11px] imcrm-ring-1 imcrm-ring-border">{text}</pre>
            </div>
            <Button size="sm" variant="ghost" onClick={() => onCopy(text)} aria-label={`${__('Copiar')} ${label}`} className="imcrm-mt-4">
                {copied ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
            </Button>
        </div>
    );
}
