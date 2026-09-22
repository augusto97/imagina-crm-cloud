import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    CONNECTOR_AUTH_KEY_LABEL,
    CONNECTOR_AUTH_LABEL,
    CONNECTOR_AUTH_TYPES,
    type Connection,
    type ConnectionTestResult,
    type ConnectorAuthType,
    type ConnectorAction,
    type ConnectorPair,
    type ConnectorVisibility,
    type InlineSecretCandidate,
} from '@imagina-base/shared';
import {
    AlertTriangle,
    CheckCircle2,
    Lock,
    Plug,
    Plus,
    ShieldAlert,
    Trash2,
    Users,
    Wand2,
    X,
} from 'lucide-react';

import { ConnectorActionsEditor } from '@/cloud/components/ConnectorActionsEditor';
import { api, useSession } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';

/**
 * Conectores (v0.1.196, ADR-S22).
 *
 * Una credencial se guarda UNA vez y las automatizaciones la referencian por
 * id. Antes vivía en texto plano dentro de cada acción: cinco automatizaciones
 * contra el mismo gateway eran cinco copias de la misma clave.
 *
 * El panel hace tres cosas: mostrar el inventario con su estado, ofrecer la
 * CONVERSIÓN de lo que todavía está escrito adentro de las automatizaciones, y
 * dejar probar la conexión contra la API real antes de usarla.
 */

interface FormState {
    id: number | null;
    name: string;
    base_url: string;
    auth_type: ConnectorAuthType;
    auth_key: string;
    visibility: ConnectorVisibility;
    token: string;
    username: string;
    password: string;
    signing_secret: string;
    headers: ConnectorPair[];
    actions: ConnectorAction[];
}

const EMPTY: FormState = {
    id: null,
    name: '',
    base_url: '',
    auth_type: 'bearer',
    auth_key: '',
    visibility: 'workspace',
    token: '',
    username: '',
    password: '',
    signing_secret: '',
    headers: [],
    actions: [],
};

export function ConnectorsPanel(): JSX.Element | null {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const list = useQuery({
        queryKey: ['connections', tenantId],
        queryFn: () => api.connectionsList(),
        retry: false,
    });
    const settings = useQuery({
        queryKey: ['connector-settings', tenantId],
        queryFn: () => api.connectorSettingsGet(),
        retry: false,
    });
    const inline = useQuery({
        queryKey: ['connections-inline', tenantId],
        queryFn: () => api.connectionsInlineSecrets(),
        retry: false,
    });

    const [form, setForm] = useState<FormState | null>(null);
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const [test, setTest] = useState<ConnectionTestResult | null>(null);

    const invalidate = (): void => {
        void qc.invalidateQueries({ queryKey: ['connections', tenantId] });
        void qc.invalidateQueries({ queryKey: ['connections-inline', tenantId] });
    };

    const save = useMutation({
        mutationFn: async (f: FormState) => {
            const secrets = {
                ...(f.token.trim() ? { token: f.token.trim() } : {}),
                ...(f.username.trim() ? { username: f.username.trim() } : {}),
                ...(f.password.trim() ? { password: f.password.trim() } : {}),
                ...(f.signing_secret.trim() ? { signing_secret: f.signing_secret.trim() } : {}),
            };
            const body = {
                name: f.name.trim(),
                base_url: f.base_url.trim(),
                auth_type: f.auth_type,
                auth_key: f.auth_key.trim(),
                visibility: f.visibility,
                headers: f.headers.filter((h) => h.key.trim() !== ''),
                query_params: [],
                actions: f.actions.filter((a) => a.label.trim() !== '' && a.key.trim() !== ''),
                ...secrets,
            };
            return f.id === null
                ? api.connectionCreate({ provider: 'http', ...body })
                : api.connectionUpdate(f.id, body);
        },
        onSuccess: () => {
            setNotice({ kind: 'ok', text: __('Conexión guardada.') });
            setForm(null);
            setTest(null);
            invalidate();
        },
        onError: (err) => setNotice({ kind: 'err', text: errText(err) }),
    });

    const runTest = useMutation({
        mutationFn: (f: FormState) =>
            api.connectionTest({
                provider: 'http',
                name: f.name.trim() || 'Prueba',
                base_url: f.base_url.trim(),
                auth_type: f.auth_type,
                auth_key: f.auth_key.trim(),
                headers: f.headers.filter((h) => h.key.trim() !== ''),
                query_params: [],
                actions: [],
                visibility: f.visibility,
                path: '',
                method: f.auth_type === 'body' ? 'POST' : 'GET',
                ...(f.id !== null ? { connection_id: f.id } : {}),
                ...(f.token.trim() ? { token: f.token.trim() } : {}),
                ...(f.username.trim() ? { username: f.username.trim() } : {}),
                ...(f.password.trim() ? { password: f.password.trim() } : {}),
            }),
        onSuccess: (r) => setTest(r),
        onError: (err) => setNotice({ kind: 'err', text: errText(err) }),
    });

    const remove = useMutation({
        mutationFn: ({ id, force }: { id: number; force: boolean }) => api.connectionDelete(id, force),
        onSuccess: () => {
            setNotice({ kind: 'ok', text: __('Conexión eliminada.') });
            invalidate();
        },
        onError: (err) => setNotice({ kind: 'err', text: errText(err) }),
    });

    const togglePrivate = useMutation({
        mutationFn: (allow: boolean) => api.connectorSettingsSet({ allow_private: allow }),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['connector-settings', tenantId] }),
        onError: (err) => setNotice({ kind: 'err', text: errText(err) }),
    });

    if (list.isError) {
        const e = list.error;
        // 403 = el rol no arma automatizaciones; el sidebar ya lo oculta.
        if (e instanceof CloudApiError && e.status === 403) return null;
        return <p className="imcrm-text-sm imcrm-text-destructive">{errText(e)}</p>;
    }

    const rows = list.data ?? [];
    const canManage = settings.data?.can_manage ?? false;
    const allowPrivate = settings.data?.allow_private ?? false;
    const candidates = inline.data ?? [];

    return (
        <div className="imcrm-space-y-4" data-testid="imcrm-connectors">
            {candidates.length > 0 && (
                <InlineSecretsCard
                    candidates={candidates}
                    onDone={(text) => {
                        setNotice({ kind: 'ok', text });
                        invalidate();
                    }}
                    onError={(text) => setNotice({ kind: 'err', text })}
                />
            )}

            <Card>
                <CardHeader className="imcrm-flex imcrm-flex-row imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div>
                        <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <Plug className="imcrm-h-4 imcrm-w-4" />
                            {__('Conectores')}
                        </CardTitle>
                        <CardDescription>
                            {__(
                                'Guardá una vez la credencial de un servicio externo y usala desde cualquier automatización. El secreto se guarda cifrado y no vuelve a mostrarse.',
                            )}
                        </CardDescription>
                    </div>
                    <Button
                        size="sm"
                        onClick={() => {
                            setForm({ ...EMPTY, visibility: canManage ? 'workspace' : 'private' });
                            setTest(null);
                            setNotice(null);
                        }}
                        data-testid="imcrm-connector-new"
                    >
                        <Plus className="imcrm-h-4 imcrm-w-4" />
                        {__('Nueva conexión')}
                    </Button>
                </CardHeader>
                <CardContent className="imcrm-space-y-3">
                    {notice && (
                        <p
                            className={
                                notice.kind === 'ok'
                                    ? 'imcrm-text-sm imcrm-text-success-foreground'
                                    : 'imcrm-text-sm imcrm-text-destructive'
                            }
                            data-testid="imcrm-connector-notice"
                        >
                            {notice.text}
                        </p>
                    )}

                    {rows.length === 0 && !form && (
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">
                            {__('Todavía no hay conexiones. Creá una y elegila desde la acción "Llamar a un webhook".')}
                        </p>
                    )}

                    <ul className="imcrm-space-y-2">
                        {rows.map((c) => (
                            <ConnectionRow
                                key={c.id}
                                connection={c}
                                onEdit={() => {
                                    setForm(toForm(c));
                                    setTest(null);
                                    setNotice(null);
                                }}
                                onDelete={(force) => remove.mutate({ id: c.id, force })}
                                deleting={remove.isPending}
                            />
                        ))}
                    </ul>

                    {form && (
                        <ConnectionForm
                            form={form}
                            onChange={setForm}
                            onCancel={() => {
                                setForm(null);
                                setTest(null);
                            }}
                            onSave={() => save.mutate(form)}
                            onTest={() => runTest.mutate(form)}
                            saving={save.isPending}
                            testing={runTest.isPending}
                            result={test}
                            canWorkspace={canManage}
                            allowPrivate={allowPrivate || canManage}
                        />
                    )}

                    {canManage && (
                        <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-border-t imcrm-pt-3 imcrm-text-sm">
                            <input
                                type="checkbox"
                                className="imcrm-mt-0.5"
                                checked={allowPrivate}
                                onChange={(e) => togglePrivate.mutate(e.target.checked)}
                                data-testid="imcrm-connector-allow-private"
                            />
                            <span>
                                <span className="imcrm-font-medium">{__('Permitir conexiones privadas')}</span>
                                <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                    {__(
                                        'Quien arma automatizaciones puede guardar su propia credencial, visible sólo para esa persona. Las conexiones del equipo las creás vos.',
                                    )}
                                </span>
                            </span>
                        </label>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function ConnectionRow({
    connection,
    onEdit,
    onDelete,
    deleting,
}: {
    connection: Connection;
    onEdit: () => void;
    onDelete: (force: boolean) => void;
    deleting: boolean;
}): JSX.Element {
    const [confirming, setConfirming] = useState(false);
    const c = connection;
    return (
        <li
            className="imcrm-rounded-md imcrm-border imcrm-p-3"
            data-testid="imcrm-connector-row"
            data-connector-name={c.name}
        >
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <span className="imcrm-font-medium">{c.name}</span>
                {c.visibility === 'private' ? (
                    <Badge variant="outline" className="imcrm-gap-1">
                        <Lock className="imcrm-h-3 imcrm-w-3" />
                        {__('Privada')}
                    </Badge>
                ) : (
                    <Badge variant="outline" className="imcrm-gap-1">
                        <Users className="imcrm-h-3 imcrm-w-3" />
                        {__('Del equipo')}
                    </Badge>
                )}
                {c.secret_state === 'unreadable' && (
                    <Badge variant="destructive" className="imcrm-gap-1" data-testid="imcrm-connector-unreadable">
                        <ShieldAlert className="imcrm-h-3 imcrm-w-3" />
                        {__('Credencial ilegible')}
                    </Badge>
                )}
                {c.last_check_ok === true && (
                    <Badge variant="outline" className="imcrm-gap-1">
                        <CheckCircle2 className="imcrm-h-3 imcrm-w-3" />
                        {__('Probada')}
                    </Badge>
                )}
                <span className="imcrm-ml-auto imcrm-flex imcrm-gap-1">
                    {c.can_edit && (
                        <Button size="sm" variant="ghost" onClick={onEdit} data-testid="imcrm-connector-edit">
                            {__('Editar')}
                        </Button>
                    )}
                    {c.can_edit && (
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={deleting}
                            onClick={() => (c.usage_count > 0 && !confirming ? setConfirming(true) : onDelete(confirming))}
                            data-testid="imcrm-connector-delete"
                        >
                            <Trash2 className="imcrm-h-4 imcrm-w-4" />
                        </Button>
                    )}
                </span>
            </div>
            <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                {CONNECTOR_AUTH_LABEL[c.auth_type]}
                {c.secret_hint ? ` · ${c.secret_hint}` : ''}
                {c.base_url ? ` · ${c.base_url}` : ''}
                {c.owner_name ? ` · ${c.owner_name}` : ''}
            </p>
            <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                {c.usage_count === 0
                    ? __('No la usa ninguna automatización todavía.')
                    : c.usage_count === 1
                      ? __('La usa 1 acción de automatización.')
                      : `${__('La usan')} ${c.usage_count} ${__('acciones de automatización.')}`}
            </p>
            {c.secret_state === 'unreadable' && (
                <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-destructive">
                    {__(
                        'La credencial guardada no se puede descifrar con la clave actual del servidor. Las automatizaciones que la usan van a fallar hasta que la escribas de nuevo.',
                    )}
                </p>
            )}
            {confirming && c.usage_count > 0 && (
                <p className="imcrm-mt-2 imcrm-text-xs imcrm-text-destructive" data-testid="imcrm-connector-confirm">
                    {__('Está en uso: si la borrás, esas automatizaciones van a fallar. Tocá la papelera otra vez para confirmar.')}
                </p>
            )}
        </li>
    );
}

function ConnectionForm({
    form,
    onChange,
    onCancel,
    onSave,
    onTest,
    saving,
    testing,
    result,
    canWorkspace,
    allowPrivate,
}: {
    form: FormState;
    onChange: (f: FormState) => void;
    onCancel: () => void;
    onSave: () => void;
    onTest: () => void;
    saving: boolean;
    testing: boolean;
    result: ConnectionTestResult | null;
    canWorkspace: boolean;
    allowPrivate: boolean;
}): JSX.Element {
    const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
        onChange({ ...form, [key]: value });
    const keyLabel = CONNECTOR_AUTH_KEY_LABEL[form.auth_type];
    const editing = form.id !== null;

    return (
        <div className="imcrm-space-y-3 imcrm-rounded-md imcrm-border imcrm-p-3" data-testid="imcrm-connector-form">
            <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                <div>
                    <Label htmlFor="conn-name">{__('Nombre')}</Label>
                    <Input
                        id="conn-name"
                        value={form.name}
                        onChange={(e) => set('name', e.target.value)}
                        placeholder={__('WhatsApp de la empresa')}
                    />
                </div>
                <div>
                    <Label htmlFor="conn-url">{__('URL base')}</Label>
                    <Input
                        id="conn-url"
                        value={form.base_url}
                        onChange={(e) => set('base_url', e.target.value)}
                        placeholder="https://was.imagina.cloud"
                    />
                </div>
                <div>
                    <Label htmlFor="conn-auth">{__('Autenticación')}</Label>
                    <Select
                        id="conn-auth"
                        value={form.auth_type}
                        onChange={(e) => set('auth_type', e.target.value as ConnectorAuthType)}
                    >
                        {CONNECTOR_AUTH_TYPES.map((t) => (
                            <option key={t} value={t}>
                                {CONNECTOR_AUTH_LABEL[t]}
                            </option>
                        ))}
                    </Select>
                </div>
                {keyLabel && (
                    <div>
                        <Label htmlFor="conn-key">{keyLabel}</Label>
                        <Input
                            id="conn-key"
                            value={form.auth_key}
                            onChange={(e) => set('auth_key', e.target.value)}
                            placeholder={form.auth_type === 'header' ? 'X-Api-Key' : 'secret'}
                        />
                    </div>
                )}
                {form.auth_type === 'basic' ? (
                    <>
                        <div>
                            <Label htmlFor="conn-user">{__('Usuario')}</Label>
                            <Input id="conn-user" value={form.username} onChange={(e) => set('username', e.target.value)} />
                        </div>
                        <div>
                            <Label htmlFor="conn-pass">{__('Contraseña')}</Label>
                            <Input
                                id="conn-pass"
                                type="password"
                                value={form.password}
                                onChange={(e) => set('password', e.target.value)}
                                placeholder={editing ? __('Dejar vacío para conservar') : ''}
                            />
                        </div>
                    </>
                ) : (
                    form.auth_type !== 'none' && (
                        <div>
                            <Label htmlFor="conn-token">{__('Clave / token')}</Label>
                            <Input
                                id="conn-token"
                                type="password"
                                value={form.token}
                                onChange={(e) => set('token', e.target.value)}
                                placeholder={editing ? __('Dejar vacío para conservar') : ''}
                                data-testid="imcrm-connector-token"
                            />
                        </div>
                    )
                )}
                <div>
                    <Label htmlFor="conn-sign">{__('Secreto de firma (opcional)')}</Label>
                    <Input
                        id="conn-sign"
                        type="password"
                        value={form.signing_secret}
                        onChange={(e) => set('signing_secret', e.target.value)}
                        placeholder={editing ? __('Dejar vacío para conservar') : ''}
                    />
                </div>
                <div>
                    <Label htmlFor="conn-vis">{__('Quién la usa')}</Label>
                    <Select
                        id="conn-vis"
                        value={form.visibility}
                        onChange={(e) => set('visibility', e.target.value as ConnectorVisibility)}
                    >
                        {canWorkspace && <option value="workspace">{__('Todo el equipo')}</option>}
                        {allowPrivate && <option value="private">{__('Sólo yo')}</option>}
                    </Select>
                </div>
            </div>

            {form.auth_type === 'body' && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__(
                        'La clave se agrega como un campo más del cuerpo. Sólo aplica cuando la acción arma el cuerpo con filas clave/valor.',
                    )}
                </p>
            )}

            {result && (
                <div
                    className={
                        result.ok
                            ? 'imcrm-rounded imcrm-bg-muted imcrm-p-2 imcrm-text-xs'
                            : 'imcrm-rounded imcrm-bg-muted imcrm-p-2 imcrm-text-xs imcrm-text-destructive'
                    }
                    data-testid="imcrm-connector-test-result"
                >
                    <p className="imcrm-font-medium">
                        {result.ok ? __('Conectó correctamente') : (result.error ?? __('No conectó'))}
                        {result.status !== null ? ` · HTTP ${result.status}` : ''}
                    </p>
                    <p className="imcrm-mt-1 imcrm-break-all imcrm-text-muted-foreground">{result.url}</p>
                    {Object.entries(result.sent_headers).map(([k, v]) => (
                        <p key={k} className="imcrm-break-all imcrm-text-muted-foreground">
                            {k}: {v}
                        </p>
                    ))}
                </div>
            )}

            <ConnectorActionsEditor
                actions={form.actions}
                onChange={(actions) => set('actions', actions)}
            />

            <div className="imcrm-flex imcrm-gap-2">
                <Button size="sm" onClick={onSave} disabled={saving || form.name.trim() === ''}>
                    {saving ? __('Guardando…') : __('Guardar')}
                </Button>
                <Button size="sm" variant="outline" onClick={onTest} disabled={testing || form.base_url.trim() === ''}>
                    {testing ? __('Probando…') : __('Probar conexión')}
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancel}>
                    <X className="imcrm-h-4 imcrm-w-4" />
                    {__('Cancelar')}
                </Button>
            </div>
        </div>
    );
}

/**
 * Lo que todavía está escrito dentro de las automatizaciones. Es el motivo
 * por el que existe esta pantalla, así que va arriba de todo y con el nombre
 * ya propuesto: convertir tiene que ser un click, no una tarea.
 */
function InlineSecretsCard({
    candidates,
    onDone,
    onError,
}: {
    candidates: InlineSecretCandidate[];
    onDone: (text: string) => void;
    onError: (text: string) => void;
}): JSX.Element {
    const [names, setNames] = useState<Record<string, string>>({});
    useEffect(() => {
        setNames(Object.fromEntries(candidates.map((c) => [c.host, c.suggested_name])));
    }, [candidates]);

    const convert = useMutation({
        mutationFn: (hosts: string[]) =>
            api.connectionsConvertInline({
                items: hosts.map((h) => ({
                    host: h,
                    name: (names[h] ?? h).trim() || h,
                    visibility: 'workspace' as const,
                })),
            }),
        onSuccess: (r) => {
            const extra = r.warnings.length > 0 ? ` ${r.warnings.join(' ')}` : '';
            onDone(
                `${__('Listo:')} ${r.created.length} ${__('conexión(es) creada(s) y')} ${r.actions_rewritten} ${__('acción(es) sin el secreto escrito adentro.')}${extra}`,
            );
        },
        onError: (err) => onError(errText(err)),
    });

    const all = useMemo(() => candidates.map((c) => c.host), [candidates]);

    return (
        <Card className="imcrm-border-warning" data-testid="imcrm-connectors-inline">
            <CardHeader>
                <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <AlertTriangle className="imcrm-h-4 imcrm-w-4" />
                    {__('Hay credenciales escritas dentro de tus automatizaciones')}
                </CardTitle>
                <CardDescription>
                    {__(
                        'Se guardan en claro y hay que cambiarlas una por una cada vez que rotás la clave. Convertirlas las mueve a una conexión cifrada; las automatizaciones siguen funcionando igual.',
                    )}
                </CardDescription>
            </CardHeader>
            <CardContent className="imcrm-space-y-3">
                {candidates.map((c) => (
                    <div key={c.host} className="imcrm-rounded-md imcrm-border imcrm-p-3" data-testid="imcrm-inline-candidate">
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                            <Input
                                value={names[c.host] ?? c.suggested_name}
                                onChange={(e) => setNames((n) => ({ ...n, [c.host]: e.target.value }))}
                                className="imcrm-max-w-xs"
                                aria-label={__('Nombre de la conexión')}
                            />
                            <Badge variant="outline">{CONNECTOR_AUTH_LABEL[c.auth_type]}</Badge>
                            {c.secret_hint && <Badge variant="outline">{c.secret_hint}</Badge>}
                        </div>
                        <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                            {c.base_url} ·{' '}
                            {c.automations.map((a) => `${a.name} (${a.actions})`).join(', ')}
                        </p>
                    </div>
                ))}
                <Button
                    size="sm"
                    onClick={() => convert.mutate(all)}
                    disabled={convert.isPending}
                    data-testid="imcrm-connectors-convert"
                >
                    <Wand2 className="imcrm-h-4 imcrm-w-4" />
                    {convert.isPending ? __('Convirtiendo…') : __('Convertir todo a conexiones')}
                </Button>
            </CardContent>
        </Card>
    );
}

function toForm(c: Connection): FormState {
    return {
        id: c.id,
        name: c.name,
        base_url: c.base_url,
        auth_type: c.auth_type,
        auth_key: c.auth_key,
        visibility: c.visibility,
        // Los secretos NO vuelven del backend: vacío = conservar el guardado.
        token: '',
        username: '',
        password: '',
        signing_secret: '',
        headers: c.headers,
        actions: c.actions,
    };
}

function errText(err: unknown): string {
    return err instanceof Error ? err.message : __('Ocurrió un error');
}
