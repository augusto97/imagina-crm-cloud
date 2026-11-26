import { useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, ListPlus, Plus, Sparkles, Trash2 } from 'lucide-react';
import {
    ASK_AI_ITEM_TYPE_LABELS,
    ASK_AI_ITEM_TYPES,
    ASK_AI_MAX_ITEMS,
    ASK_AI_OUTPUT_LABELS,
    ASK_AI_OUTPUTS,
    ERROR_VARIABLES,
    ON_ERROR_EXEMPT_ACTIONS,
    ON_ERROR_MAX_STEPS,
    ON_ERROR_RETRY_MAX,
    SWITCH_MAX_CASES,
    SWITCH_OP_LABELS,
    SWITCH_OPS,
    SWITCH_OPS_WITHOUT_VALUE,
    askAiVariables,
    caseBranch,
    isRetryableAction,
    isUserWritableType,
    normalizeRelativeDateValue,
    readAskAiConfig,
    readOnError,
    readSwitchConfig,
    switchCaseLabel,
    writeOnError,
    type AskAiItemType,
    type AskAiOutput,
    type OnErrorConfig,
    type OnErrorFallback,
    type OnErrorMode,
    type SwitchOp,
} from '@imagina-base/shared';

import { RelativeDateRangeInput } from '@/admin/records/RelativeDateRangeInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { __, sprintf } from '@/lib/i18n';
import type { ActionMeta, ActionSpec } from '@/types/automation';
import type { FieldEntity } from '@/types/field';

import { insideFail } from './actionsTree';
import { ActionsEditor } from './config-editors';
import { useStepPath, useStepVariables } from './flowContext';
import { MergeTagInput } from './MergeTagInput';
import { ResultName } from './RecordActionsConfig';

/**
 * v0.1.460 — Los editores de «Según el valor de…» (`switch`), «Preguntarle a
 * la IA» (`ask_ai`) y «Si este paso falla» (`on_error`). Las reglas (qué se
 * lee, qué se valida, qué rama toma) viven en `packages/shared`
 * (`automation-control.ts`): lo que se ve aquí es lo que hace el motor.
 */

interface Option {
    value: string;
    label: string;
    color?: string;
}

/** Las opciones de un campo de selección (value + etiqueta). */
export function fieldOptions(field: FieldEntity | undefined): Option[] {
    const raw = (field?.config as { options?: unknown } | undefined)?.options;
    if (!Array.isArray(raw)) return [];
    return raw
        .map((o) => (o && typeof o === 'object' ? (o as Record<string, unknown>) : null))
        .filter((o): o is Record<string, unknown> => o !== null && typeof o.value === 'string' && o.value !== '')
        .map((o) => ({ value: String(o.value), label: typeof o.label === 'string' && o.label !== '' ? o.label : String(o.value), color: typeof o.color === 'string' ? o.color : undefined }));
}

const OPTION_TYPES = new Set(['select', 'multi_select']);
/** Los campos que pueden decidir una rama (los que tienen un valor que comparar). */
const SWITCH_SOURCE_SKIP = new Set(['file', 'relation', 'button', 'lookup']);
/** Con un campo de selección sólo tiene sentido comparar por opción. */
const OPTION_OPS: SwitchOp[] = ['eq', 'neq', 'in', 'nin', 'is_null', 'is_not_null'];
/** v0.1.469 — «está en» (este mes, próximos N días…) sólo para fechas (o una variable, que puede traer una). */
const DATE_SOURCE_TYPES = new Set(['date', 'datetime', 'created_at', 'updated_at']);

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
            <span className="imcrm-text-[12px] imcrm-font-semibold imcrm-text-foreground">{children}</span>
            {hint && <span className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{hint}</span>}
        </div>
    );
}

/* ── «Según el valor de…» ─────────────────────────────────────────── */

export function SwitchConfig({
    spec,
    onChange,
    fields,
    actionsCatalog,
    nestedInline = true,
}: {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fields: FieldEntity[];
    actionsCatalog: ActionMeta[];
    nestedInline?: boolean;
}): JSX.Element {
    const cfg = readSwitchConfig(spec.config);
    const stepPath = useStepPath() ?? [];
    const variables = useStepVariables();
    const rawCases = Array.isArray(spec.config.cases) ? (spec.config.cases as Array<Record<string, unknown>>) : [];
    const sourceField = cfg.source.kind === 'field' ? fields.find((f) => f.id === (cfg.source as { fieldId: number }).fieldId) : undefined;
    const options = OPTION_TYPES.has(sourceField?.type ?? '') ? fieldOptions(sourceField) : [];
    const byOption = options.length > 0;
    const labelOf = byOption ? (v: string) => options.find((o) => o.value === v)?.label ?? v : undefined;
    const sourceChoices = fields.filter((f) => !SWITCH_SOURCE_SKIP.has(f.type));
    const sourceValue = cfg.source.kind === 'field' ? `f:${cfg.source.fieldId}` : cfg.source.kind === 'variable' ? 'var' : '';
    const varPath = typeof spec.config.source_variable === 'string' ? spec.config.source_variable : '';
    const suggestions = variables.flatMap((s) => s.items.map((i) => i.tag)).filter((t) => !t.endsWith('.body')).slice(0, 10);

    const setConfig = (patch: Record<string, unknown>): void => onChange({ ...spec, config: { ...spec.config, ...patch } });
    const setCases = (next: Array<Record<string, unknown>>): void => setConfig({ cases: next });
    const patchCase = (i: number, patch: Record<string, unknown>): void => {
        const next = [...rawCases];
        next[i] = { ...(next[i] ?? {}), ...patch };
        setCases(next);
    };
    const moveCase = (i: number, to: number): void => {
        if (to < 0 || to >= rawCases.length) return;
        const next = [...rawCases];
        const [c] = next.splice(i, 1);
        next.splice(to, 0, c!);
        setCases(next);
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-tour="automation-switch">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-primary/20 imcrm-bg-primary/5 imcrm-p-3">
                <SectionTitle hint={__('Corre la PRIMERA rama que coincide; si ninguna coincide, «En otro caso».')}>{__('Según el valor de')}</SectionTitle>
                <Select
                    value={sourceValue}
                    onChange={(e) => {
                        const v = e.target.value;
                        if (v === 'var') setConfig({ source_field_id: undefined, source_variable: varPath || 'respuestas.ia.valor' });
                        else if (v.startsWith('f:')) setConfig({ source_field_id: Number(v.slice(2)), source_variable: undefined });
                        else setConfig({ source_field_id: undefined, source_variable: undefined });
                    }}
                    aria-label={__('Según el valor de')}
                    className="imcrm-h-8"
                    data-testid="switch-source"
                >
                    <option value="">{__('Elige un campo o una variable…')}</option>
                    <optgroup label={__('Un campo del registro')}>
                        {sourceChoices.map((f) => (
                            <option key={f.id} value={`f:${f.id}`}>
                                {f.label}
                            </option>
                        ))}
                    </optgroup>
                    <option value="var">{__('Una variable (la respuesta de la IA, un dato del webhook…)')}</option>
                </Select>
                {sourceValue === 'var' && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Input
                            value={varPath}
                            onChange={(e) => setConfig({ source_variable: e.target.value.replace(/[{}\s]/g, '') })}
                            placeholder="respuestas.ia.valor"
                            className="imcrm-h-8 imcrm-font-mono imcrm-text-[12px]"
                            aria-label={__('Variable')}
                            data-testid="switch-variable"
                        />
                        {suggestions.length > 0 && (
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                                {suggestions.map((t) => (
                                    <button
                                        key={t}
                                        type="button"
                                        className="imcrm-rounded imcrm-bg-card imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-text-primary"
                                        onClick={() => setConfig({ source_variable: t })}
                                    >
                                        {`{{${t}}}`}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {byOption && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="imcrm-self-start imcrm-gap-1.5"
                        onClick={() => {
                            const kept = new Map(rawCases.map((c) => [String(c.value ?? ''), c]));
                            setCases(
                                options.slice(0, SWITCH_MAX_CASES).map((o) => kept.get(o.value) ?? { op: 'eq', value: o.value, actions: [] }),
                            );
                        }}
                        data-testid="switch-one-per-option"
                    >
                        <ListPlus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Una rama por cada opción')}
                    </Button>
                )}
            </div>

            {cfg.cases.map((c, i) => {
                const dateSource = cfg.source.kind === 'variable' || DATE_SOURCE_TYPES.has(sourceField?.type ?? '');
                const ops = byOption
                    ? OPTION_OPS
                    : (SWITCH_OPS as readonly SwitchOp[]).filter((op) => op !== 'between_relative' || dateSource || c.op === op);
                const needsValue = !SWITCH_OPS_WITHOUT_VALUE.includes(c.op);
                const multi = c.op === 'in' || c.op === 'nin';
                const relative = c.op === 'between_relative';
                const values = Array.isArray(c.value)
                    ? c.value.map(String)
                    : c.value === null || c.value === undefined || c.value === '' || typeof c.value === 'object'
                      ? []
                      : [String(c.value)];
                return (
                    <div
                        key={i}
                        className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-xl imcrm-border imcrm-border-success/25 imcrm-bg-success/5 imcrm-p-3"
                        data-testid="switch-case"
                    >
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <Badge variant="success" dot>
                                {sprintf(__('Rama %d'), i + 1)}
                            </Badge>
                            <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-[12px] imcrm-font-medium">{switchCaseLabel(c, i, labelOf)}</span>
                            <Button type="button" variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" disabled={i === 0} onClick={() => moveCase(i, i - 1)} aria-label={__('Subir rama')}>
                                <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" disabled={i === cfg.cases.length - 1} onClick={() => moveCase(i, i + 1)} aria-label={__('Bajar rama')}>
                                <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" onClick={() => setCases(rawCases.filter((_, j) => j !== i))} aria-label={__('Quitar rama')}>
                                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            </Button>
                        </div>
                        <div className="imcrm-grid imcrm-grid-cols-[minmax(0,140px)_minmax(0,1fr)] imcrm-gap-2">
                            <Select
                                value={c.op}
                                onChange={(e) => {
                                    const op = e.target.value as SwitchOp;
                                    const toMulti = op === 'in' || op === 'nin';
                                    const value = SWITCH_OPS_WITHOUT_VALUE.includes(op)
                                        ? null
                                        : op === 'between_relative'
                                          ? (normalizeRelativeDateValue(c.value) ?? 'this_month')
                                          : toMulti
                                            ? values
                                            : (values[0] ?? '');
                                    patchCase(i, { op, value });
                                }}
                                className="imcrm-h-8"
                                aria-label={__('Cómo se compara')}
                                data-testid="switch-case-op"
                            >
                                {ops.map((op) => (
                                    <option key={op} value={op}>
                                        {__(SWITCH_OP_LABELS[op])}
                                    </option>
                                ))}
                            </Select>
                            {needsValue && relative && (
                                <RelativeDateRangeInput value={c.value} onChange={(v) => patchCase(i, { value: v })} aria-label={__('Rango de fechas')} />
                            )}
                            {needsValue &&
                                !relative &&
                                (byOption ? (
                                    multi ? (
                                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-1.5">
                                            {options.map((o) => {
                                                const on = values.includes(o.value);
                                                return (
                                                    <label key={o.value} className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[12px]">
                                                        <input
                                                            type="checkbox"
                                                            checked={on}
                                                            onChange={() => patchCase(i, { value: on ? values.filter((v) => v !== o.value) : [...values, o.value] })}
                                                        />
                                                        {o.label}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <Select
                                            value={values[0] ?? ''}
                                            onChange={(e) => patchCase(i, { value: e.target.value })}
                                            className="imcrm-h-8"
                                            aria-label={__('Valor')}
                                            data-testid="switch-case-value"
                                        >
                                            <option value="">{__('Elige una opción…')}</option>
                                            {options.map((o) => (
                                                <option key={o.value} value={o.value}>
                                                    {o.label}
                                                </option>
                                            ))}
                                        </Select>
                                    )
                                ) : (
                                    <Input
                                        value={multi ? values.join(', ') : (values[0] ?? '')}
                                        onChange={(e) =>
                                            patchCase(i, {
                                                value: multi
                                                    ? e.target.value
                                                          .split(',')
                                                          .map((s) => s.trim())
                                                          .filter(Boolean)
                                                    : e.target.value,
                                            })
                                        }
                                        placeholder={multi ? __('Valores separados por coma') : __('Valor')}
                                        className="imcrm-h-8"
                                        aria-label={__('Valor')}
                                        data-testid="switch-case-value"
                                    />
                                ))}
                        </div>
                        <Input
                            value={typeof rawCases[i]?.label === 'string' ? (rawCases[i]!.label as string) : ''}
                            onChange={(e) => patchCase(i, { label: e.target.value.slice(0, 60) || undefined })}
                            placeholder={__('Nombre de la rama (opcional)')}
                            className="imcrm-h-8 imcrm-text-[12px]"
                            aria-label={__('Nombre de la rama')}
                        />
                        {nestedInline && (
                            <ActionsEditor
                                value={c.actions as ActionSpec[]}
                                onChange={(next) => patchCase(i, { actions: next })}
                                actionsCatalog={actionsCatalog}
                                fields={fields}
                                seqPath={[...stepPath, caseBranch(i)]}
                            />
                        )}
                    </div>
                );
            })}

            {cfg.cases.length < SWITCH_MAX_CASES && (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="imcrm-self-start imcrm-gap-1.5"
                    onClick={() => setCases([...rawCases, { op: 'eq', value: '', actions: [] }])}
                    data-testid="switch-add-case"
                >
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar rama')}
                </Button>
            )}

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-xl imcrm-border imcrm-border-warning/30 imcrm-bg-warning/5 imcrm-p-3">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Badge variant="warning" dot>
                        {__('En otro caso')}
                    </Badge>
                    <span className="imcrm-text-[12px] imcrm-text-muted-foreground">{__('Si ninguna rama coincide (puede quedar vacío).')}</span>
                </div>
                {nestedInline && (
                    <ActionsEditor
                        value={cfg.defaultActions as ActionSpec[]}
                        onChange={(next) => setConfig({ default_actions: next })}
                        actionsCatalog={actionsCatalog}
                        fields={fields}
                        seqPath={[...stepPath, 'default']}
                    />
                )}
            </div>
            {!nestedInline && (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Los pasos de cada rama se arman en el lienzo, en su columna.')}</p>
            )}
        </div>
    );
}

/* ── «Preguntarle a la IA» ────────────────────────────────────────── */

const LENGTH_LABELS: Record<'short' | 'medium' | 'long', string> = {
    short: 'Corta (un par de frases)',
    medium: 'Media (un párrafo)',
    long: 'Larga (varios párrafos)',
};

/** Dónde puede guardar la IA: lo que se escribe a mano (no archivos ni vínculos). */
function savableFields(fields: FieldEntity[]): FieldEntity[] {
    return fields.filter((f) => isUserWritableType(f.type) && f.type !== 'file' && f.type !== 'relation');
}

export function AskAiConfig({ spec, onChange, fields }: { spec: ActionSpec; onChange: (next: ActionSpec) => void; fields: FieldEntity[] }): JSX.Element {
    const c = readAskAiConfig(spec.config);
    const set = (patch: Record<string, unknown>): void => {
        const config = { ...spec.config, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete config[k];
        onChange({ ...spec, config });
    };
    const selectFields = fields.filter((f) => f.type === 'select');
    const savable = savableFields(fields);
    const items = Array.isArray(spec.config.items) ? (spec.config.items as Array<Record<string, unknown>>) : [];
    const choicesText = Array.isArray(spec.config.choices) ? (spec.config.choices as unknown[]).map(String).join('\n') : typeof spec.config.choices === 'string' ? spec.config.choices : '';
    const [fromFieldPick, setFromField] = useState(c.choicesFieldId !== null);
    const fromField = c.choicesFieldId !== null || fromFieldPick;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-tour="automation-ask-ai">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label className="imcrm-text-xs">{__('Qué le pides a la IA')}</Label>
                <MergeTagInput
                    value={typeof spec.config.instruction === 'string' ? spec.config.instruction : ''}
                    onChange={(v) => set({ instruction: v })}
                    fields={fields}
                    rows={3}
                    autoGrow
                    placeholder={__('Por ejemplo: «Clasifica la prioridad de este ticket según el mensaje del cliente».')}
                    aria-label={__('Qué le pides a la IA')}
                />
            </div>
            <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-xs">
                <input type="checkbox" checked={c.includeRecord} onChange={(e) => set({ include_record: e.target.checked ? undefined : false })} className="imcrm-mt-0.5" />
                <span>
                    {__('Incluir los datos del registro')}
                    <span className="imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Viajan como datos (nunca archivos ni campos que parezcan claves). Lo que escribe un cliente no se toma como una orden.')}
                    </span>
                </span>
            </label>

            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label className="imcrm-text-xs">{__('Qué tiene que responder')}</Label>
                    <Select value={c.output} onChange={(e) => set({ output: e.target.value as AskAiOutput })} className="imcrm-h-8" aria-label={__('Qué tiene que responder')} data-testid="ask-ai-output">
                        {ASK_AI_OUTPUTS.map((o) => (
                            <option key={o} value={o}>
                                {__(ASK_AI_OUTPUT_LABELS[o])}
                            </option>
                        ))}
                    </Select>
                </div>
                {c.output === 'text' && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label className="imcrm-text-xs">{__('Largo de la respuesta')}</Label>
                        <Select value={c.length} onChange={(e) => set({ length: e.target.value === 'short' ? undefined : e.target.value })} className="imcrm-h-8" aria-label={__('Largo de la respuesta')}>
                            {(['short', 'medium', 'long'] as const).map((l) => (
                                <option key={l} value={l}>
                                    {__(LENGTH_LABELS[l])}
                                </option>
                            ))}
                        </Select>
                    </div>
                )}
            </div>

            {c.output === 'choice' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-2.5">
                    <Select
                        value={fromField ? 'field' : 'list'}
                        onChange={(e) => {
                            const field = e.target.value === 'field';
                            setFromField(field);
                            set(field ? { choices: undefined } : { choices_field_id: undefined });
                        }}
                        className="imcrm-h-8"
                        aria-label={__('De dónde salen las opciones')}
                    >
                        <option value="list">{__('Opciones escritas aquí')}</option>
                        <option value="field">{__('Las opciones de un campo de selección')}</option>
                    </Select>
                    {fromField ? (
                        <Select
                            value={c.choicesFieldId ?? ''}
                            onChange={(e) => set({ choices_field_id: e.target.value === '' ? undefined : Number(e.target.value) })}
                            className="imcrm-h-8"
                            aria-label={__('Campo de selección')}
                        >
                            <option value="">{__('Elige el campo…')}</option>
                            {selectFields.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.label}
                                </option>
                            ))}
                        </Select>
                    ) : (
                        <Textarea
                            value={choicesText}
                            onChange={(e) => set({ choices: e.target.value.split('\n') })}
                            rows={3}
                            placeholder={__('Una opción por renglón (Alta, Media, Baja)')}
                            aria-label={__('Opciones')}
                            data-testid="ask-ai-choices"
                        />
                    )}
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Si la IA responde algo que no está en la lista, el paso falla con el motivo (no se adivina).')}
                    </span>
                </div>
            )}

            {c.output === 'fields' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-2.5">
                    <SectionTitle hint={__('La IA saca cada dato del texto; cada uno puede guardarse en un campo.')}>{__('Datos que tiene que sacar')}</SectionTitle>
                    {items.map((it, i) => (
                        <div key={i} className="imcrm-grid imcrm-grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] imcrm-gap-1.5 sm:imcrm-grid-cols-[minmax(0,110px)_minmax(0,1fr)_minmax(0,100px)_minmax(0,1fr)_auto]">
                            <Input
                                value={typeof it.key === 'string' ? it.key : ''}
                                onChange={(e) => {
                                    const next = [...items];
                                    next[i] = { ...it, key: e.target.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') };
                                    set({ items: next });
                                }}
                                placeholder="monto"
                                className="imcrm-h-8 imcrm-font-mono imcrm-text-[12px]"
                                aria-label={__('Nombre del dato')}
                            />
                            <Input
                                value={typeof it.label === 'string' ? it.label : ''}
                                onChange={(e) => {
                                    const next = [...items];
                                    next[i] = { ...it, label: e.target.value };
                                    set({ items: next });
                                }}
                                placeholder={__('Qué es (para la IA)')}
                                className="imcrm-h-8"
                                aria-label={__('Descripción del dato')}
                            />
                            <Select
                                value={typeof it.type === 'string' ? it.type : 'text'}
                                onChange={(e) => {
                                    const next = [...items];
                                    next[i] = { ...it, type: e.target.value as AskAiItemType };
                                    set({ items: next });
                                }}
                                className="imcrm-h-8"
                                aria-label={__('Tipo del dato')}
                            >
                                {ASK_AI_ITEM_TYPES.map((t) => (
                                    <option key={t} value={t}>
                                        {__(ASK_AI_ITEM_TYPE_LABELS[t])}
                                    </option>
                                ))}
                            </Select>
                            <Select
                                value={typeof it.field_id === 'number' ? String(it.field_id) : ''}
                                onChange={(e) => {
                                    const next = [...items];
                                    next[i] = { ...it, field_id: e.target.value === '' ? undefined : Number(e.target.value) };
                                    set({ items: next });
                                }}
                                className="imcrm-h-8"
                                aria-label={__('Guardar en')}
                            >
                                <option value="">{__('No guardar')}</option>
                                {savable.map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {sprintf(__('Guardar en «%s»'), f.label)}
                                    </option>
                                ))}
                            </Select>
                            <Button type="button" variant="ghost" size="icon" className="imcrm-h-8 imcrm-w-8" onClick={() => set({ items: items.filter((_, j) => j !== i) })} aria-label={__('Quitar dato')}>
                                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            </Button>
                        </div>
                    ))}
                    {items.length < ASK_AI_MAX_ITEMS && (
                        <Button type="button" variant="ghost" size="sm" className="imcrm-self-start imcrm-gap-1.5" onClick={() => set({ items: [...items, { key: '', label: '', type: 'text' }] })}>
                            <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Agregar dato')}
                        </Button>
                    )}
                </div>
            )}

            {c.output !== 'fields' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label className="imcrm-text-xs">{__('Guardar la respuesta en un campo (opcional)')}</Label>
                    <Select
                        value={c.saveFieldId ?? ''}
                        onChange={(e) => set({ save_field_id: e.target.value === '' ? undefined : Number(e.target.value) })}
                        className="imcrm-h-8"
                        aria-label={__('Guardar la respuesta en')}
                        data-testid="ask-ai-save"
                    >
                        <option value="">{__('No guardar (sólo usarla en los pasos siguientes)')}</option>
                        {savable.map((f) => (
                            <option key={f.id} value={f.id}>
                                {f.label}
                            </option>
                        ))}
                    </Select>
                </div>
            )}

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label className="imcrm-text-xs">{__('Calidad')}</Label>
                <Select value={c.quality} onChange={(e) => set({ quality: e.target.value === 'assistant' ? 'assistant' : undefined })} className="imcrm-h-8" aria-label={__('Calidad')}>
                    <option value="fast">{__('Rápida (recomendada para clasificar y extraer)')}</option>
                    <option value="assistant">{__('La del asistente (mejor para textos largos, más lenta)')}</option>
                </Select>
            </div>

            <ResultName spec={spec} onChange={onChange} fallback="ia" outputs={askAiVariables(spec.config).map((v) => v.key.split('.').slice(2).join('.'))} />

            <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-info/20 imcrm-bg-info/5 imcrm-p-2 imcrm-text-[11px] imcrm-leading-snug imcrm-text-foreground/80">
                <Sparkles className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-info" />
                {__('Cada vez que corre usa un pedido de IA de tu plan (o tu clave propia). «Probar» no le pregunta a la IA salvo que marques «Ejecutar de verdad» en este paso.')}
            </p>
        </div>
    );
}

/* ── «Si este paso falla» ─────────────────────────────────────────── */

const FALLBACK_LABELS: Record<OnErrorFallback, string> = {
    stop: 'Detener la automatización',
    continue: 'Seguir con el resto',
    steps: 'Hacer otros pasos',
};

/**
 * El editor de «Si este paso falla» de cualquier paso (salvo los
 * contenedores, que no fallan por sí mismos). `nestedInline` = false en el
 * lienzo: los pasos de «Si falla» se arman ahí, en su columna.
 */
export function OnErrorEditor({
    spec,
    onChange,
    fields,
    actionsCatalog,
    nestedInline = true,
}: {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fields: FieldEntity[];
    actionsCatalog: ActionMeta[];
    nestedInline?: boolean;
}): JSX.Element | null {
    const stepPath = useStepPath() ?? [];
    if (ON_ERROR_EXEMPT_ACTIONS.includes(spec.type)) return null;
    const cfg = readOnError(spec.on_error);
    const inFail = insideFail(stepPath);
    const retryable = isRetryableAction(spec.type);
    const write = (next: OnErrorConfig): void => {
        const raw = writeOnError(next);
        if (raw === undefined) {
            const { on_error: _omit, ...rest } = spec;
            onChange(rest as ActionSpec);
        } else onChange({ ...spec, on_error: raw });
    };
    const final = cfg.mode === 'retry' ? cfg.ifStillFails : cfg.mode;
    const modes: OnErrorMode[] = ['stop', 'continue', ...(retryable ? (['retry'] as const) : []), ...(inFail ? [] : (['steps'] as const))];
    const fallbacks: OnErrorFallback[] = ['stop', 'continue', ...(inFail ? [] : (['steps'] as const))];
    const isDefault = cfg.mode === 'stop';

    return (
        <details
            className="imcrm-group imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-px-3 imcrm-py-2.5 [&[open]]:imcrm-bg-card [&[open]]:imcrm-shadow-imcrm-sm"
            open={!isDefault}
            data-tour="automation-on-error"
        >
            <summary className="imcrm-flex imcrm-cursor-pointer imcrm-list-none imcrm-items-center imcrm-gap-2 imcrm-text-[12px] imcrm-font-medium imcrm-text-foreground/80 [&::-webkit-details-marker]:imcrm-hidden">
                <AlertTriangle className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                <span>{__('Si este paso falla')}</span>
                <Badge variant={isDefault ? 'outline' : 'warning'} className="imcrm-ml-auto">
                    {cfg.mode === 'retry' ? sprintf(__('Reintentar %d'), cfg.retries) : __(FALLBACK_LABELS[cfg.mode])}
                </Badge>
            </summary>
            <div className="imcrm-mt-3 imcrm-flex imcrm-flex-col imcrm-gap-2.5">
                <Select
                    value={cfg.mode}
                    onChange={(e) => write({ ...cfg, mode: e.target.value as OnErrorMode })}
                    className="imcrm-h-8"
                    aria-label={__('Si este paso falla')}
                    data-testid="on-error-mode"
                >
                    {modes.map((m) => (
                        <option key={m} value={m}>
                            {m === 'retry' ? __('Reintentar (sirve si el otro servicio falla un momento)') : __(FALLBACK_LABELS[m as OnErrorFallback])}
                        </option>
                    ))}
                </Select>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {cfg.mode === 'stop'
                        ? __('La automatización se detiene aquí y queda «Falló» en el historial (y en Problemas).')
                        : cfg.mode === 'continue'
                          ? __('Sigue con los pasos siguientes; la corrida queda «Con errores» y no abre un problema.')
                          : cfg.mode === 'retry'
                            ? __('Lo vuelve a intentar con esperas que crecen (3 s, 10 s, 30 s). Si sale bien, sigue como si nada.')
                            : __('Corre estos pasos en vez de detenerse (por ejemplo, avisarle al responsable). Puedes usar {{error.mensaje}} y {{error.paso}}.')}
                </p>
                {cfg.mode === 'retry' && (
                    <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label className="imcrm-text-xs">{__('Cuántas veces')}</Label>
                            <Select value={cfg.retries} onChange={(e) => write({ ...cfg, retries: Number(e.target.value) })} className="imcrm-h-8" aria-label={__('Cuántas veces reintentar')} data-testid="on-error-retries">
                                {Array.from({ length: ON_ERROR_RETRY_MAX }, (_, i) => i + 1).map((n) => (
                                    <option key={n} value={n}>
                                        {n === 1 ? __('1 vez') : sprintf(__('%d veces'), n)}
                                    </option>
                                ))}
                            </Select>
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label className="imcrm-text-xs">{__('Si sigue fallando')}</Label>
                            <Select value={cfg.ifStillFails} onChange={(e) => write({ ...cfg, ifStillFails: e.target.value as OnErrorFallback })} className="imcrm-h-8" aria-label={__('Si sigue fallando')} data-testid="on-error-still-fails">
                                {fallbacks.map((f) => (
                                    <option key={f} value={f}>
                                        {__(FALLBACK_LABELS[f])}
                                    </option>
                                ))}
                            </Select>
                        </div>
                    </div>
                )}
                {final === 'steps' && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-xl imcrm-border imcrm-border-destructive/25 imcrm-bg-destructive/5 imcrm-p-3">
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                            <Badge variant="destructive" dot>
                                {__('Si falla')}
                            </Badge>
                            {ERROR_VARIABLES.map((v) => (
                                <code key={v.key} className="imcrm-rounded imcrm-bg-card imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground" title={__(v.label)}>
                                    {`{{${v.key}}}`}
                                </code>
                            ))}
                        </div>
                        {nestedInline ? (
                            <ActionsEditor
                                value={cfg.actions as ActionSpec[]}
                                onChange={(next) => write({ ...cfg, actions: next.slice(0, ON_ERROR_MAX_STEPS) })}
                                actionsCatalog={actionsCatalog}
                                fields={fields}
                                seqPath={[...stepPath, 'fail']}
                            />
                        ) : (
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Los pasos de «Si falla» se arman en el lienzo, a la derecha del paso.')}</p>
                        )}
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <Label className="imcrm-shrink-0 imcrm-text-xs">{__('Después')}</Label>
                            <Select
                                value={cfg.afterSteps}
                                onChange={(e) => write({ ...cfg, afterSteps: e.target.value === 'continue' ? 'continue' : 'stop' })}
                                className="imcrm-h-8 imcrm-flex-1"
                                aria-label={__('Después de los pasos de «Si falla»')}
                                data-testid="on-error-after"
                            >
                                <option value="stop">{__('Terminar la automatización')}</option>
                                <option value="continue">{__('Seguir con el resto de los pasos')}</option>
                            </Select>
                        </div>
                    </div>
                )}
            </div>
        </details>
    );
}
