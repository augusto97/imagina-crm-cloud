import { useContext, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
    INTEGRATIONS,
    WA_WEB_ABILITY_LABEL,
    WHATS_ACTION_MERGE_TAGS,
    WHATS_ACTION_OUTPUTS,
    WHATS_PARAM_LOOKUP,
    isWhatsAction,
    readWhatsKeyValues,
    whatsFlag,
    whatsNameKey,
    whatsNames,
    writeWhatsKeyValues,
    type ConnectorParam,
    type WhatsActionTestResult,
    type WhatsLookupKind,
    type WhatsLookupResult,
} from '@imagina-base/shared';
import { AlertTriangle, CheckCircle2, Eye, Play, Plus, Trash2 } from 'lucide-react';

import { api as cloud } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { CloudApiError } from '@/lib/cloud/client';
import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import { AutomationEditorListContext } from './config-editors';
import { MergeTagInput } from './MergeTagInput';

/**
 * v0.1.401 — Los datos de las acciones de Whats que no son «Enviar mensaje» ni
 * «Enviar archivo»: salen del catálogo (`INTEGRATIONS` → `whatsapp_web`), así
 * una acción nueva aparece sola. Lo que se elige de la cuenta (etiquetas,
 * grupos, flujos, goteos, campos del contacto) se trae de Whats con la clave
 * de la conexión; si no se puede, queda el campo para escribirlo a mano.
 */

type Values = Record<string, unknown>;

function str(v: unknown): string {
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

/** Los datos de una acción de Whats, sin el teléfono (lo dibuja el editor arriba). */
export function whatsActionParams(actionKey: string): ConnectorParam[] {
    const def = INTEGRATIONS.find((i) => i.key === 'whatsapp_web');
    return (def?.actions.find((a) => a.key === actionKey)?.params ?? []) as ConnectorParam[];
}

export function whatsActionDescription(actionKey: string): string {
    const def = INTEGRATIONS.find((i) => i.key === 'whatsapp_web');
    return def?.actions.find((a) => a.key === actionKey)?.description ?? '';
}

function useWhatsOptions(connectionId: number | null, kind: WhatsLookupKind | null) {
    return useQuery<WhatsLookupResult>({
        queryKey: ['whats-options', connectionId, kind],
        queryFn: () => cloud.whatsOptions(connectionId ?? 0, kind as WhatsLookupKind),
        enabled: connectionId !== null && kind !== null,
        retry: false,
        staleTime: 60_000,
    });
}

/** Los permisos que le faltan a la clave para esta acción (nada si no se pudo saber). */
export function WhatsAbilitiesNotice({ connectionId, actionKey }: { connectionId: number | null; actionKey: string }): JSX.Element | null {
    const q = useQuery({
        queryKey: ['whats-abilities', connectionId],
        queryFn: () => cloud.whatsAbilities(connectionId ?? 0),
        enabled: connectionId !== null,
        retry: false,
        staleTime: 60_000,
    });
    const missing = q.data?.missing[actionKey] ?? [];
    if (missing.length === 0) return null;
    return (
        <p
            className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-amber-50 imcrm-p-2 imcrm-text-xs imcrm-text-amber-900 dark:imcrm-bg-amber-500/10 dark:imcrm-text-amber-200"
            data-testid="imcrm-whats-missing-abilities"
        >
            <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
            <span>
                {sprintf(
                    /* translators: %s: lista de permisos */
                    __(
                        'La clave de Whats de esta conexión no tiene permiso para: %s. La acción va a fallar hasta que crees una clave con esos permisos en Whats (Cuenta → Claves de API) y la pongas en Ajustes → Integraciones.',
                    ),
                    missing.map((a) => WA_WEB_ABILITY_LABEL[a] ?? a).join(', '),
                )}
            </span>
        </p>
    );
}

export function WhatsActionFields({
    connectionId,
    actionKey,
    values,
    setValues,
    fields,
}: {
    connectionId: number | null;
    actionKey: string;
    values: Values;
    setValues: (patch: Values) => void;
    fields: FieldEntity[];
}): JSX.Element {
    const params = whatsActionParams(actionKey).filter((p) => p.key !== 'recipient');
    const outputs = isWhatsAction(actionKey) ? WHATS_ACTION_OUTPUTS[actionKey] : [];

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-whats-action-fields" data-action={actionKey}>
            {params.map((param) => (
                <WhatsParamField key={param.key} param={param} actionKey={actionKey} connectionId={connectionId} values={values} setValues={setValues} fields={fields} />
            ))}
            {outputs.length > 0 && (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground" data-testid="imcrm-whats-outputs">
                    {__('Deja para los pasos siguientes:')}{' '}
                    {outputs.map((o, i) => {
                        const tag = `whats.${o}`;
                        const label = WHATS_ACTION_MERGE_TAGS.find((t) => t.tag === tag)?.label ?? o;
                        return (
                            <span key={o}>
                                {i > 0 ? ', ' : ''}
                                <code className="imcrm-rounded imcrm-bg-muted imcrm-px-1">{`{{${tag}}}`}</code> ({__(label)})
                            </span>
                        );
                    })}
                </p>
            )}
        </div>
    );
}

function FieldShell({ param, children }: { param: ConnectorParam; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid={`imcrm-whats-param-${param.key}`}>
            <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                {__(param.label)}
                {param.required && <span className="imcrm-text-destructive"> *</span>}
            </Label>
            {children}
            {param.help && <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__(param.help)}</p>}
        </div>
    );
}

function WhatsParamField({
    param,
    actionKey,
    connectionId,
    values,
    setValues,
    fields,
}: {
    param: ConnectorParam;
    actionKey: string;
    connectionId: number | null;
    values: Values;
    setValues: (patch: Values) => void;
    fields: FieldEntity[];
}): JSX.Element {
    const value = str(values[param.key]);
    const lookup = WHATS_PARAM_LOOKUP[param.key] ?? null;

    if (lookup === 'tags') return <NamesField param={param} kind="tags" multi connectionId={connectionId} value={value} values={values} setValues={setValues} fields={fields} actionKey={actionKey} />;
    if (lookup === 'groups')
        return <NamesField param={param} kind="groups" multi={false} connectionId={connectionId} value={value} values={values} setValues={setValues} fields={fields} actionKey={actionKey} />;
    if (lookup === 'flows' || lookup === 'drips') return <IdField param={param} kind={lookup} connectionId={connectionId} value={value} setValues={setValues} />;
    if (param.key === 'variables' || param.key === 'fields') {
        return (
            <FieldShell param={param}>
                <KeyValueRows
                    value={value}
                    onChange={(next) => setValues({ [param.key]: next })}
                    fields={fields}
                    keyKind={param.key === 'fields' ? 'contact_fields' : null}
                    connectionId={connectionId}
                    testId={`imcrm-whats-kv-${param.key}`}
                />
            </FieldShell>
        );
    }
    if (param.type === 'boolean') {
        const checked = whatsFlag(values[param.key], whatsFlag(param.default, false));
        return (
            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs" data-testid={`imcrm-whats-param-${param.key}`}>
                <input type="checkbox" checked={checked} onChange={(e) => setValues({ [param.key]: e.target.checked ? 'true' : 'false' })} />
                {__(param.label)}
            </label>
        );
    }
    if (param.type === 'select' && param.options.length > 0) {
        return (
            <FieldShell param={param}>
                <Select value={value || param.default} onChange={(e) => setValues({ [param.key]: e.target.value })} data-testid={`imcrm-whats-select-${param.key}`}>
                    {param.options.map((o) => (
                        <option key={o.value} value={o.value}>
                            {__(o.label)}
                        </option>
                    ))}
                </Select>
            </FieldShell>
        );
    }
    const long = param.type === 'long_text';
    return (
        <FieldShell param={param}>
            <MergeTagInput
                value={value}
                onChange={(next) => setValues({ [param.key]: next })}
                fields={fields}
                rows={long ? 3 : undefined}
                autoGrow={long}
                data-testid={`imcrm-whats-input-${param.key}`}
            />
        </FieldShell>
    );
}

/**
 * Etiquetas (varias) o un grupo (uno), por NOMBRE: se eligen de la cuenta con
 * un toque o se escriben (con variables). Avisa los que no existen.
 */
function NamesField({
    param,
    kind,
    multi,
    connectionId,
    value,
    values,
    setValues,
    fields,
    actionKey,
}: {
    param: ConnectorParam;
    kind: 'tags' | 'groups';
    multi: boolean;
    connectionId: number | null;
    value: string;
    values: Values;
    setValues: (patch: Values) => void;
    fields: FieldEntity[];
    actionKey: string;
}): JSX.Element {
    const q = useWhatsOptions(connectionId, kind);
    const items = q.data?.items ?? [];
    const chosen = multi ? whatsNames(value) : value.trim() === '' ? [] : [value.trim()];
    const chosenKeys = new Set(chosen.map(whatsNameKey));
    const known = new Set(items.map((i) => whatsNameKey(i.value)));
    // Las variables se resuelven al correr: no se juzgan.
    const unknown = q.data && !q.data.truncated ? chosen.filter((n) => !n.includes('{{') && !known.has(whatsNameKey(n))) : [];
    const canCreate = actionKey === 'add_tags' || actionKey === 'add_to_group';
    const creates = canCreate && whatsFlag(values.create_missing, true);

    const toggle = (name: string): void => {
        if (!multi) {
            setValues({
                [param.key]: chosenKeys.has(whatsNameKey(name)) ? '' : name,
            });
            return;
        }
        const next = chosenKeys.has(whatsNameKey(name)) ? chosen.filter((n) => whatsNameKey(n) !== whatsNameKey(name)) : [...chosen, name];
        setValues({ [param.key]: next.join(', ') });
    };

    return (
        <FieldShell param={param}>
            <MergeTagInput
                value={value}
                onChange={(next) => setValues({ [param.key]: next })}
                fields={fields}
                placeholder={multi ? __('Cliente VIP, Bogotá') : __('Clientes 2026')}
                data-testid={`imcrm-whats-input-${param.key}`}
            />
            {q.isLoading && <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Cargando las de tu cuenta…')}</p>}
            {q.data?.error && <p className="imcrm-text-[11px] imcrm-text-amber-700 dark:imcrm-text-amber-400">{q.data.error}</p>}
            {items.length > 0 && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1" data-testid={`imcrm-whats-options-${param.key}`}>
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{kind === 'tags' ? __('De tu cuenta:') : __('Tus grupos:')}</span>
                    {items.slice(0, 40).map((it) => {
                        const on = chosenKeys.has(whatsNameKey(it.value));
                        return (
                            <button
                                key={it.value}
                                type="button"
                                aria-pressed={on}
                                onClick={() => toggle(it.value)}
                                className={
                                    'imcrm-rounded-full imcrm-border imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] ' +
                                    (on ? 'imcrm-border-primary imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-border-border hover:imcrm-bg-accent')
                                }
                            >
                                {it.label}
                            </button>
                        );
                    })}
                    {items.length > 40 && (
                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{sprintf(/* translators: %d: cuántas más */ __('y %d más: escríbelas.'), items.length - 40)}</span>
                    )}
                </div>
            )}
            {unknown.length > 0 && (
                <p className={'imcrm-text-[11px] ' + (creates ? 'imcrm-text-muted-foreground' : 'imcrm-text-destructive')} data-testid={`imcrm-whats-unknown-${param.key}`}>
                    {creates
                        ? sprintf(/* translators: %s: nombres */ __('No existen todavía en Whats y se van a crear: %s.'), unknown.join(', '))
                        : canCreate
                          ? sprintf(/* translators: %s: nombres */ __('No existen en Whats: %s. Activa «crear» o elige de tu cuenta.'), unknown.join(', '))
                          : sprintf(/* translators: %s: nombres */ __('No existen en Whats: %s.'), unknown.join(', '))}
                </p>
            )}
        </FieldShell>
    );
}

/** Un flujo o un goteo de la cuenta, por id (se guarda también el nombre, para los mensajes). */
function IdField({
    param,
    kind,
    connectionId,
    value,
    setValues,
}: {
    param: ConnectorParam;
    kind: 'flows' | 'drips';
    connectionId: number | null;
    value: string;
    setValues: (patch: Values) => void;
}): JSX.Element {
    const q = useWhatsOptions(connectionId, kind);
    const items = q.data?.items ?? [];
    const labelKey = `${param.key}_label`;
    const current = items.find((i) => i.value === value) ?? null;
    // Sin la lista (clave sin permiso, Whats caído) igual se puede escribir el número.
    if (q.data?.error || (q.isError && !q.isLoading)) {
        return (
            <FieldShell param={param}>
                <Input
                    value={value}
                    onChange={(e) =>
                        setValues({
                            [param.key]: e.target.value.replace(/[^0-9]/g, ''),
                            [labelKey]: '',
                        })
                    }
                    placeholder={__('Número del flujo o goteo')}
                    className="imcrm-h-8"
                    data-testid={`imcrm-whats-id-${param.key}`}
                />
                <p className="imcrm-text-[11px] imcrm-text-amber-700 dark:imcrm-text-amber-400">{q.data?.error ?? __('No se pudo traer la lista de Whats.')}</p>
            </FieldShell>
        );
    }
    return (
        <FieldShell param={param}>
            <Select
                value={value}
                onChange={(e) => {
                    const it = items.find((i) => i.value === e.target.value);
                    setValues({
                        [param.key]: e.target.value,
                        [labelKey]: it?.label ?? '',
                    });
                }}
                data-testid={`imcrm-whats-select-${param.key}`}
            >
                <option value="">{q.isLoading ? __('Cargando…') : kind === 'flows' ? __('(elige un flujo)') : __('(elige un goteo)')}</option>
                {items.map((it) => (
                    <option key={it.value} value={it.value}>
                        {it.hint ? `${it.label} · ${it.hint}` : it.label}
                    </option>
                ))}
                {value !== '' && !current && !q.isLoading && <option value={value}>{sprintf(/* translators: %s: número */ __('#%s — ya no está en tu cuenta'), value)}</option>}
            </Select>
            {!q.isLoading && items.length === 0 && (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {kind === 'flows' ? __('Tu cuenta de Whats no tiene flujos todavía. Créalos en Whats → Flujos.') : __('Tu cuenta de Whats no tiene goteos todavía. Créalos en Whats → Goteos.')}
                </p>
            )}
            {current?.hint && /borrador|pausad|inactiv/i.test(current.hint) && (
                <p className="imcrm-text-[11px] imcrm-text-amber-700 dark:imcrm-text-amber-400">
                    {kind === 'flows'
                        ? __('Este flujo no está activo: la acción va a fallar hasta que lo actives en Whats.')
                        : __('Este goteo no está activo: la acción va a fallar hasta que lo actives en Whats.')}
                </p>
            )}
        </FieldShell>
    );
}

interface KvRow {
    id: number;
    key: string;
    value: string;
}

/** Filas «nombre → valor» (variables de un flujo, campos del contacto). */
function KeyValueRows({
    value,
    onChange,
    fields,
    keyKind,
    connectionId,
    testId,
}: {
    value: string;
    onChange: (next: string) => void;
    fields: FieldEntity[];
    keyKind: 'contact_fields' | null;
    connectionId: number | null;
    testId: string;
}): JSX.Element {
    const [rows, setRows] = useState<KvRow[]>(() => {
        const entries = Object.entries(readWhatsKeyValues(value));
        return entries.length > 0 ? entries.map(([k, v], i) => ({ id: i + 1, key: k, value: v })) : [{ id: 1, key: '', value: '' }];
    });
    const q = useWhatsOptions(connectionId, keyKind);
    const suggestions = q.data?.items ?? [];
    const listId = `${testId}-keys`;
    const commit = (next: KvRow[]): void => {
        setRows(next);
        onChange(writeWhatsKeyValues(next));
    };
    const nextId = useMemo(() => Math.max(0, ...rows.map((r) => r.id)) + 1, [rows]);
    const used = new Set(rows.map((r) => r.key.trim()));

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2" data-testid={testId}>
            {rows.map((row, idx) => (
                <div key={row.id} className="imcrm-flex imcrm-flex-col imcrm-gap-1 sm:imcrm-flex-row sm:imcrm-items-start">
                    <Input
                        value={row.key}
                        onChange={(e) => commit(rows.map((r) => (r.id === row.id ? { ...r, key: e.target.value } : r)))}
                        placeholder={keyKind ? __('Campo de Whats') : __('Nombre, ej. pedido')}
                        className="imcrm-h-8 sm:imcrm-w-40 sm:imcrm-shrink-0"
                        list={suggestions.length > 0 ? listId : undefined}
                        aria-label={__('Nombre')}
                        data-testid={`${testId}-key-${idx}`}
                    />
                    <div className="imcrm-min-w-0 imcrm-flex-1">
                        <MergeTagInput
                            value={row.value}
                            onChange={(next) => commit(rows.map((r) => (r.id === row.id ? { ...r, value: next } : r)))}
                            fields={fields}
                            placeholder={__('Valor o variable, ej. {{numero}}')}
                            aria-label={__('Valor')}
                        />
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-p-0"
                        onClick={() => commit(rows.length > 1 ? rows.filter((r) => r.id !== row.id) : [{ id: nextId, key: '', value: '' }])}
                        aria-label={__('Quitar')}
                    >
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    </Button>
                </div>
            ))}
            {suggestions.length > 0 && (
                <datalist id={listId}>
                    {suggestions
                        .filter((s) => !used.has(s.value))
                        .map((s) => (
                            <option key={s.value} value={s.value}>
                                {s.hint ? `${s.label} · ${s.hint}` : s.label}
                            </option>
                        ))}
                </datalist>
            )}
            <div>
                <Button type="button" variant="outline" size="sm" className="imcrm-h-7" onClick={() => setRows([...rows, { id: nextId, key: '', value: '' }])} data-testid={`${testId}-add`}>
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar dato')}
                </Button>
            </div>
            {keyKind && q.data?.error && <p className="imcrm-text-[11px] imcrm-text-amber-700 dark:imcrm-text-amber-400">{q.data.error}</p>}
        </div>
    );
}

/**
 * «Probar ahora» de las acciones que no mandan un mensaje: primero muestra lo
 * que haría con un registro real; «Hacerlo de verdad» lo ejecuta en Whats.
 */
export function WhatsActionTest({ connectionId, actionKey, values }: { connectionId: number; actionKey: string; values: Values }): JSX.Element {
    const listId = useContext(AutomationEditorListContext);
    const [real, setReal] = useState(false);
    const [result, setResult] = useState<WhatsActionTestResult | null>(null);
    const run = useMutation({
        mutationFn: (execute: boolean) =>
            cloud.whatsActionTest(listId ?? 0, {
                connection_id: connectionId,
                action_key: actionKey,
                values,
                execute,
            }),
        onSuccess: setResult,
        onError: (err) =>
            setResult({
                ok: false,
                executed: false,
                summary: '',
                steps: [],
                outputs: {},
                error: err instanceof CloudApiError || err instanceof Error ? err.message : String(err),
                sample_record_id: null,
            }),
    });
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3" data-testid="imcrm-whats-action-test">
            <Label className="imcrm-text-xs imcrm-text-muted-foreground">{__('Probar ahora')}</Label>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => run.mutate(false)} disabled={run.isPending} data-testid="imcrm-whats-action-preview">
                    <Eye className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Ver qué haría')}
                </Button>
                <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs">
                    <input type="checkbox" checked={real} onChange={(e) => setReal(e.target.checked)} data-testid="imcrm-whats-action-real" />
                    {__('Hacerlo de verdad en Whats')}
                </label>
                {real && (
                    <Button type="button" size="sm" onClick={() => run.mutate(true)} disabled={run.isPending} data-testid="imcrm-whats-action-run">
                        <Play className="imcrm-h-3.5 imcrm-w-3.5" />
                        {run.isPending ? __('Probando…') : __('Probar ahora')}
                    </Button>
                )}
            </div>
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('Los datos se completan con el último registro de la lista que puedes ver. «Hacerlo de verdad» cambia el contacto de ese teléfono en Whats; ningún registro de aquí cambia.')}
            </p>
            {result && <WhatsActionReport result={result} />}
        </div>
    );
}

function WhatsActionReport({ result }: { result: WhatsActionTestResult }): JSX.Element {
    const outs = Object.entries(result.outputs).filter(([, v]) => v !== '');
    return (
        <div
            className="imcrm-space-y-1.5 imcrm-rounded-md imcrm-bg-muted/50 imcrm-p-2 imcrm-text-xs"
            data-testid="imcrm-whats-action-report"
            data-ok={result.ok ? '1' : '0'}
            data-executed={result.executed ? '1' : '0'}
        >
            {result.ok ? (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-font-medium imcrm-text-emerald-700 dark:imcrm-text-emerald-400">
                    <CheckCircle2 className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    <span>{result.executed ? result.summary : sprintf(/* translators: %s: lo que haría */ __('Sin cambiar nada todavía: %s'), result.summary)}</span>
                </p>
            ) : (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-font-medium imcrm-text-destructive">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    {result.error ?? __('No se pudo.')}
                </p>
            )}
            {result.sample_record_id !== null && (
                <p className="imcrm-text-muted-foreground">{sprintf(/* translators: %d: id del registro */ __('Con los datos del registro #%d.'), result.sample_record_id)}</p>
            )}
            {outs.length > 0 && <p className="imcrm-text-muted-foreground">{outs.map(([k, v]) => `{{whats.${k}}} = ${v}`).join(' · ')}</p>}
            {result.steps.length > 0 && (
                <details>
                    <summary className="imcrm-cursor-pointer imcrm-text-muted-foreground">{sprintf(/* translators: %d: pasos */ __('Ver los %d pedidos a Whats'), result.steps.length)}</summary>
                    <ol className="imcrm-mt-1 imcrm-space-y-1">
                        {result.steps.map((s, i) => (
                            <li key={i} className="imcrm-rounded imcrm-bg-background imcrm-p-2">
                                <p className="imcrm-font-medium">{s.label}</p>
                                <p className="imcrm-break-all imcrm-text-[11px] imcrm-text-muted-foreground">
                                    {`${s.method} ${s.url}`}
                                    {s.status !== null ? ` → HTTP ${s.status}` : ''}
                                </p>
                                {s.body && <pre className="imcrm-mt-1 imcrm-max-h-32 imcrm-overflow-auto imcrm-whitespace-pre-wrap imcrm-break-all imcrm-text-[11px]">{s.body}</pre>}
                            </li>
                        ))}
                    </ol>
                </details>
            )}
        </div>
    );
}
