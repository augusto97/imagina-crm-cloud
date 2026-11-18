import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatedPersonalToken, PersonalTokenScope } from '@imagina-base/shared';
import { Braces, Check, Copy, ExternalLink, KeyRound, Loader2, Trash2 } from 'lucide-react';

import { api, useSession } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';

import { apiExamples } from './apiExamples';

const SCOPE_LABEL: Record<PersonalTokenScope, string> = {
    read: 'Sólo lectura',
    full: 'Leer y escribir',
};

/**
 * v0.1.441 (G1) — Ajustes → API: tokens para conectar programas (n8n, Make,
 * Zapier, scripts propios) por la API REST. Cada token actúa como la persona
 * que lo crea, en esta empresa; el secreto se ve UNA vez. Los tokens del MCP
 * (asistentes) siguen en Seguridad: cada uno sirve sólo para lo suyo.
 */
export function ApiTokensCard(): JSX.Element {
    const qc = useQueryClient();
    const confirm = useConfirm();
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
            api.createPersonalToken({
                name: name.trim(),
                scope,
                use: 'api',
                expires_in_days: expires === 'never' ? null : (Number(expires) as 7 | 30 | 90 | 365),
            }),
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
            // sin portapapeles (http sin TLS): el texto queda seleccionable
        }
    };

    const base = api.apiBaseUrl();
    const openapi = `${base}/openapi.json`;
    const list = (tokens.data ?? []).filter((t) => t.use === 'api');
    const examples = apiExamples(base, created?.secret ?? '<tu token>');

    return (
        <section className="imcrm-flex imcrm-max-w-3xl imcrm-flex-col imcrm-gap-4" data-testid="imcrm-api-card" data-tour="settings-api">
            <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                <div>
                    <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                        <Braces className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                        {__('Conectar programas por la API')}
                    </h2>
                    <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Lee y escribe tus listas y registros desde n8n, Make, Zapier o tus propios programas. Cada token actúa como tú: ve y cambia sólo lo que tú puedes, en esta empresa.')}
                    </p>
                </div>
                {!creating && !created && (
                    <Button size="sm" className="imcrm-shrink-0" onClick={() => setCreating(true)} data-testid="imcrm-api-token-new" data-tour="settings-api-new">
                        <KeyRound className="imcrm-mr-2 imcrm-h-3.5 imcrm-w-3.5" /> {__('Nuevo token')}
                    </Button>
                )}
            </div>

            <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                <CopyField label={__('Dirección de la API')} value={base} copied={copied === 'base'} onCopy={() => void copy(base, 'base')} testId="imcrm-api-base" />
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <span className="imcrm-text-xs imcrm-font-medium">{__('Documento OpenAPI')}</span>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <code className="imcrm-min-w-0 imcrm-flex-1 imcrm-select-all imcrm-truncate imcrm-rounded-md imcrm-bg-background imcrm-px-2 imcrm-py-1.5 imcrm-font-mono imcrm-text-xs imcrm-ring-1 imcrm-ring-border" data-testid="imcrm-api-openapi">
                            {openapi}
                        </code>
                        <Button size="sm" variant="outline" onClick={() => void copy(openapi, 'openapi')} aria-label={__('Copiar la dirección del documento')}>
                            {copied === 'openapi' ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                            <a href={openapi} target="_blank" rel="noopener noreferrer" aria-label={__('Abrir el documento')}>
                                <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                            </a>
                        </Button>
                    </div>
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Impórtalo en Postman, Insomnia o un generador de clientes: describe cada ruta.')}</span>
                </div>
            </div>

            {creating && (
                <form
                    className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (name.trim()) create.mutate();
                    }}
                    data-testid="imcrm-api-token-form"
                >
                    <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-3">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="api-tok-name" className="imcrm-text-xs">{__('Nombre (para reconocerlo)')}</Label>
                            <Input id="api-tok-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={__('n8n de ventas')} maxLength={80} autoFocus data-testid="imcrm-api-token-name" />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="api-tok-scope" className="imcrm-text-xs">{__('Qué puede hacer')}</Label>
                            <Select id="api-tok-scope" value={scope} onChange={(e) => setScope(e.target.value as PersonalTokenScope)} data-testid="imcrm-api-token-scope">
                                <option value="read">{__('Sólo leer')}</option>
                                <option value="full">{__('Leer y escribir')}</option>
                            </Select>
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="api-tok-exp" className="imcrm-text-xs">{__('Vence en')}</Label>
                            <Select id="api-tok-exp" value={expires} onChange={(e) => setExpires(e.target.value as typeof expires)}>
                                <option value="7">7 {__('días')}</option>
                                <option value="30">30 {__('días')}</option>
                                <option value="90">90 {__('días')}</option>
                                <option value="365">1 {__('año')}</option>
                                <option value="never">{__('Nunca')}</option>
                            </Select>
                        </div>
                    </div>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {scope === 'full'
                            ? __('Puede crear, cambiar y mandar a la papelera registros, y crear listas y campos, con tu mismo permiso. No puede borrar listas ni campos, invitar personas ni cambiar ajustes de la empresa.')
                            : __('Sólo consulta: listas, campos, vistas, registros, comentarios y archivos que tú puedes ver.')}
                    </p>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <Button type="submit" size="sm" disabled={!name.trim() || create.isPending} data-testid="imcrm-api-token-create">
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
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-success/40 imcrm-bg-success/5 imcrm-p-4" data-testid="imcrm-api-token-created">
                    <p className="imcrm-text-sm imcrm-font-medium">{__('Token creado. Cópialo ahora: no se vuelve a mostrar.')}</p>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <code className="imcrm-min-w-0 imcrm-flex-1 imcrm-select-all imcrm-overflow-x-auto imcrm-rounded-md imcrm-bg-background imcrm-px-2 imcrm-py-1.5 imcrm-font-mono imcrm-text-xs imcrm-ring-1 imcrm-ring-border" data-testid="imcrm-api-token-secret">
                            {created.secret}
                        </code>
                        <Button size="sm" variant="outline" onClick={() => void copy(created.secret, 'secret')} aria-label={__('Copiar token')}>
                            {copied === 'secret' ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                        </Button>
                    </div>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Mándalo en cada pedido con la cabecera «Authorization: Bearer <token>». En n8n: nodo HTTP Request → Authentication: Generic Credential Type → Header Auth, con el nombre «Authorization» y el valor «Bearer » seguido del token.')}
                    </p>
                    <Button size="sm" variant="ghost" className="imcrm-self-start" onClick={() => setCreated(null)}>
                        {__('Listo, ya lo guardé')}
                    </Button>
                </div>
            )}

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-api-examples">
                <p className="imcrm-text-sm imcrm-font-medium">{__('Primeros pasos')}</p>
                <ol className="imcrm-flex imcrm-list-decimal imcrm-flex-col imcrm-gap-1 imcrm-pl-5 imcrm-text-xs imcrm-text-muted-foreground">
                    <li>{__('Prueba el token con «¿Quién soy?»: responde tu nombre, la empresa y lo que puede hacer el token.')}</li>
                    <li>{__('Busca la lista y el id de cada campo: los valores de un registro van en «data» con la clave «f» + el id del campo (por ejemplo «f12»). Esa clave no cambia aunque renombres el campo.')}</li>
                    <li>{__('Crea, cambia o consulta registros. Si haces muchos pedidos, el límite es de 300 por minuto por token.')}</li>
                </ol>
                {examples.map((ex) => (
                    <Snippet key={ex.key} label={__(ex.label)} text={ex.text} copied={copied === ex.key} onCopy={(t) => void copy(t, ex.key)} />
                ))}
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <p className="imcrm-text-sm imcrm-font-medium">{__('Tus tokens de la API')}</p>
                {tokens.isLoading ? (
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando…')}</p>
                ) : list.length === 0 ? (
                    <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="imcrm-api-tokens-empty">
                        {__('Todavía no tienes tokens de la API en esta empresa.')}
                    </p>
                ) : (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
                        {list.map((t) => (
                            <li key={t.id} className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-px-4 imcrm-py-3" data-testid="imcrm-api-token-row">
                                <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-text-muted-foreground imcrm-ring-1 imcrm-ring-border">
                                    <KeyRound className="imcrm-h-4 imcrm-w-4" />
                                </span>
                                <div className="imcrm-min-w-0 imcrm-flex-1">
                                    <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                                        {t.name}
                                        <Badge variant={t.scope === 'full' ? 'warning' : 'secondary'} className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">
                                            {__(SCOPE_LABEL[t.scope])}
                                        </Badge>
                                    </p>
                                    <p className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                        <span className="imcrm-font-mono">{t.prefix}</span>
                                        {' · '}
                                        {t.last_used_at ? `${__('Último uso')} ${formatDateTimeStr(t.last_used_at)}` : __('Sin usar todavía')}
                                        {' · '}
                                        {t.expires_at ? `${__('Vence')} ${formatDateTimeStr(t.expires_at)}` : __('No vence')}
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="imcrm-text-destructive hover:imcrm-text-destructive"
                                    disabled={revoke.isPending}
                                    onClick={() => {
                                        void (async () => {
                                            const ok = await confirm({
                                                title: __('¿Revocar este token?'),
                                                description: __('El programa que lo use deja de funcionar al instante. Esto no se puede deshacer: tendrás que crear otro.'),
                                                confirmLabel: __('Revocar'),
                                                destructive: true,
                                            });
                                            if (ok) revoke.mutate(t.id);
                                        })();
                                    }}
                                    data-testid="imcrm-api-token-revoke"
                                >
                                    <Trash2 className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5" /> {__('Revocar')}
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}

function CopyField({ label, value, copied, onCopy, testId }: { label: string; value: string; copied: boolean; onCopy: () => void; testId: string }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <span className="imcrm-text-xs imcrm-font-medium">{label}</span>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <code className="imcrm-min-w-0 imcrm-flex-1 imcrm-select-all imcrm-truncate imcrm-rounded-md imcrm-bg-background imcrm-px-2 imcrm-py-1.5 imcrm-font-mono imcrm-text-xs imcrm-ring-1 imcrm-ring-border" data-testid={testId}>
                    {value}
                </code>
                <Button size="sm" variant="outline" onClick={onCopy} aria-label={`${__('Copiar')} ${label}`}>
                    {copied ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                </Button>
            </div>
        </div>
    );
}

function Snippet({ label, text, copied, onCopy }: { label: string; text: string; copied: boolean; onCopy: (t: string) => void }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-items-start imcrm-gap-2">
            <div className="imcrm-min-w-0 imcrm-flex-1">
                <div className="imcrm-mb-0.5 imcrm-text-xs imcrm-text-muted-foreground">{label}</div>
                <pre className="imcrm-overflow-x-auto imcrm-rounded-md imcrm-bg-background imcrm-px-2 imcrm-py-1.5 imcrm-font-mono imcrm-text-[11px] imcrm-ring-1 imcrm-ring-border">{text}</pre>
            </div>
            <Button size="sm" variant="ghost" onClick={() => onCopy(text)} aria-label={`${__('Copiar')} ${label}`} className="imcrm-mt-4">
                {copied ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
            </Button>
        </div>
    );
}
