import { useContext, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { COMMENT_VARIABLES } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useHookCaptures } from '@/hooks/useAutomations';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { FilterOperator } from '@/types/record';

import { DateRangePresetButtons } from '@/admin/records/DateRangePresetButtons';
import { type DateRangePresetId } from '@/admin/records/dateRangePresets';
import { FilterValueInput } from '@/admin/records/FilterValueInput';
import { valueForOperator } from '@/admin/records/filterValue';
import { isNullaryOperator, operatorsForType } from '@/admin/records/operators';

import { AutomationEditorAutomationContext, useAutomationFlow, useStepVariables } from './flowContext';
import { payloadPaths } from './webhookPayload';

/**
 * v0.1.399 — Una condición sobre un DATO DEL JSON que llegó al webhook
 * (`payload.respuesta`), no sobre un campo: el motor la evalúa igual que las
 * demás (la ruta se lee con puntos). Operadores de texto/número sin tipo.
 */
const PAYLOAD_PREFIX = 'payload.';
const PAYLOAD_OPTION = '__payload__';
const PAYLOAD_OPS: ReadonlyArray<{ op: FilterOperator; label: string }> = [
    { op: 'eq', label: __('es') },
    { op: 'neq', label: __('no es') },
    { op: 'contains', label: __('contiene') },
    { op: 'not_contains', label: __('no contiene') },
    { op: 'in', label: __('es alguno de') },
    { op: 'nin', label: __('no es ninguno de') },
    { op: 'is_null', label: __('está vacío') },
    { op: 'is_not_null', label: __('tiene valor') },
    { op: 'gt', label: __('es mayor que') },
    { op: 'lt', label: __('es menor que') },
];

function isPayloadRule(slug: string): boolean {
    return slug.startsWith(PAYLOAD_PREFIX);
}

/**
 * v0.1.444 — Una condición sobre una VARIABLE del flujo: el comentario que
 * disparó la automatización (`comentario.texto`) o lo que dejó un paso
 * anterior con nombre (`respuestas.busqueda.cantidad`). El motor la evalúa
 * con el mismo lector que las variables de los textos.
 */
const VARIABLE_PREFIXES = ['comentario.', 'respuestas.'] as const;

function isVariableRule(slug: string): boolean {
    return VARIABLE_PREFIXES.some((p) => slug.startsWith(p));
}

interface VariableOption {
    tag: string;
    label: string;
    group: string;
}

/** En «es alguno de» el valor es una lista: se escribe separado por comas. */
function payloadValueText(value: unknown): string {
    if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
    return value === null || value === undefined ? '' : String(value);
}

function payloadValueFrom(op: FilterOperator, text: string): unknown {
    if (op === 'in' || op === 'nin') {
        return text
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s !== '');
    }
    return text;
}

/**
 * Una condición individual con operador. Reemplaza al viejo shape
 * `{slug: value}` que solo soportaba `eq`. Persistida como array de
 * estos objetos, evaluada por `ConditionEvaluator::matches` en backend.
 */
export interface ConditionRule {
    slug: string;
    op: FilterOperator;
    value: unknown;
}

/**
 * Acepta cualquiera de los dos shapes legacy:
 *  - `{slug: value, ...}` (eq-only, automations <0.20).
 *  - `[{slug, op, value}, ...]` (rico, 0.20+).
 * Si viene undefined, lista vacía.
 */
export type ConditionValue =
    | ConditionRule[]
    | Record<string, unknown>
    | undefined
    | null;

export function rulesFromValue(value: ConditionValue): ConditionRule[] {
    if (Array.isArray(value)) {
        const out: ConditionRule[] = [];
        for (const r of value) {
            if (r === null || typeof r !== 'object') continue;
            const rec = r as unknown as Record<string, unknown>;
            const slug = String(rec.slug ?? rec.field ?? '');
            out.push({
                slug,
                op: (typeof rec.op === 'string' ? rec.op : 'eq') as FilterOperator,
                value: rec.value,
            });
        }
        return out;
    }
    if (value && typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>).map(([slug, val]) => ({
            slug,
            op: 'eq' as FilterOperator,
            value: val,
        }));
    }
    return [];
}

interface ConditionEditorProps {
    listId?: number;
    value: ConditionValue;
    onChange: (next: ConditionRule[]) => void;
    fields: FieldEntity[];
    /** Texto del CTA "Añadir …" (default: "Añadir condición"). */
    addLabel?: string;
    /** Si true, muestra una nota explicativa arriba. */
    helperText?: string;
}

/**
 * Editor unificado de condiciones para automatizaciones (triggers,
 * actions, if_else). Cada fila tiene Campo / Operador / Valor y, para
 * campos de fecha, los chips de rangos rápidos (hoy, esta semana, etc.)
 * que generan un `between_relative` (se evalúa cada vez que corre).
 *
 * Buffer local: filas con slug vacío persisten visualmente durante la
 * edición — sin esto "Añadir" parecía no hacer nada porque la fila
 * vacía se descartaba antes del re-render.
 */
export function ConditionEditor({
    listId,
    value,
    onChange,
    fields,
    addLabel,
    helperText,
}: ConditionEditorProps): JSX.Element {
    const [rows, setRows] = useState<ConditionRule[]>(() => rulesFromValue(value));
    // v0.1.399 — en un webhook entrante, las condiciones también miran el JSON
    // que llegó (con las rutas de la última captura como sugerencias).
    const flow = useAutomationFlow();
    const isWebhook = flow?.triggerType === 'incoming_webhook';
    const automationId = useContext(AutomationEditorAutomationContext);
    const captures = useHookCaptures(isWebhook ? automationId : undefined, false);
    const suggestions = isWebhook ? payloadPaths(captures.data?.[0]?.payload ?? {}) : [];
    const datalistId = `imcrm-payload-paths-${automationId ?? 'new'}`;
    const stepVars = useStepVariables();
    const variables: VariableOption[] = [
        ...(flow?.triggerType === 'comment_added'
            ? COMMENT_VARIABLES.map((v) => ({ tag: `comentario.${v.key}`, label: __(v.label), group: __('Comentario') }))
            : []),
        ...stepVars.flatMap((section) =>
            section.items
                .filter((it) => it.tag.startsWith('respuestas.'))
                .map((it) => ({ tag: it.tag, label: it.label, group: section.title })),
        ),
    ];

    const commit = (next: ConditionRule[]): void => {
        setRows(next);
        // Solo persistimos las filas con slug válido (descarta las
        // recién añadidas-en-progreso del buffer local, y un dato del JSON
        // sin ruta todavía).
        onChange(next.filter((r) => r.slug !== '' && r.slug !== PAYLOAD_PREFIX));
    };

    const updateRow = (idx: number, patch: Partial<ConditionRule>): void => {
        const next = [...rows];
        next[idx] = { ...next[idx]!, ...patch };
        commit(next);
    };

    const removeRow = (idx: number): void => {
        commit(rows.filter((_, i) => i !== idx));
    };

    const addRow = (): void => {
        commit([...rows, { slug: '', op: 'eq', value: '' }]);
    };

    /**
     * Un rango rápido («Este mes», «Hoy») queda como `between_relative` con
     * el PRESET, no como dos fechas fijas: la automatización evalúa «este
     * mes» cada vez que corre, en el reloj de la empresa. Antes el botón
     * congelaba las fechas del día en que se configuró y en un mes la
     * condición ya no se cumplía nunca.
     */
    const applyDateRange = (idx: number, slug: string, preset: DateRangePresetId): void => {
        if (preset === 'custom') return;
        const next = [...rows];
        next.splice(idx, 1, { slug, op: 'between_relative', value: preset });
        commit(next);
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            {helperText !== undefined && helperText !== '' && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{helperText}</p>
            )}

            {isWebhook && suggestions.length > 0 && (
                <datalist id={datalistId}>
                    {suggestions.map((p) => (
                        <option key={p} value={p} />
                    ))}
                </datalist>
            )}
            {rows.map((rule, i) => {
                if (isPayloadRule(rule.slug) || (isWebhook && rule.slug === PAYLOAD_PREFIX)) {
                    return (
                        <PayloadRuleRow
                            key={i}
                            rule={rule}
                            fields={fields}
                            datalistId={suggestions.length > 0 ? datalistId : undefined}
                            onChange={(patch) => updateRow(i, patch)}
                            onRemove={() => removeRow(i)}
                        />
                    );
                }
                if (isVariableRule(rule.slug)) {
                    return (
                        <VariableRuleRow
                            key={i}
                            rule={rule}
                            fields={fields}
                            variables={variables}
                            onChange={(patch) => updateRow(i, patch)}
                            onRemove={() => removeRow(i)}
                        />
                    );
                }
                const field = fields.find((f) => f.slug === rule.slug);
                const operators = field ? operatorsForType(field.type, field) : [];
                const isNullary = isNullaryOperator(rule.op);
                const isDate = field?.type === 'date' || field?.type === 'datetime';

                return (
                    <div key={i} className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <div
                            className={cn(
                                'imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2',
                                'imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card/50 imcrm-px-2 imcrm-py-2',
                            )}
                        >
                            <Select
                                value={rule.slug}
                                onChange={(e) => {
                                    const newSlug = e.target.value;
                                    if (newSlug === PAYLOAD_OPTION) {
                                        updateRow(i, { slug: PAYLOAD_PREFIX, op: 'eq', value: '' });
                                        return;
                                    }
                                    if (isVariableRule(newSlug)) {
                                        updateRow(i, { slug: newSlug, op: 'eq', value: '' });
                                        return;
                                    }
                                    const newField = fields.find((f) => f.slug === newSlug);
                                    const newOps = newField ? operatorsForType(newField.type, newField) : [];
                                    const validOp = newOps.some((o) => o.op === rule.op)
                                        ? rule.op
                                        : (newOps[0]?.op ?? 'eq');
                                    updateRow(i, {
                                        slug: newSlug,
                                        op: validOp,
                                        value: '',
                                    });
                                }}
                                aria-label={__('Campo')}
                                className="imcrm-h-8 imcrm-min-w-[140px] imcrm-flex-1"
                            >
                                <option value="">{__('— Campo —')}</option>
                                {fields
                                    .filter((f) => f.type !== 'relation' && f.type !== 'button')
                                    .map((f) => (
                                        <option key={f.id} value={f.slug}>
                                            {f.label}
                                        </option>
                                    ))}
                                {isWebhook && <option value={PAYLOAD_OPTION}>{__('Un dato del JSON del webhook…')}</option>}
                                <VariableOptions variables={variables} />
                            </Select>

                            {field && (
                                <Select
                                    value={rule.op}
                                    onChange={(e) =>
                                        updateRow(i, {
                                            op: e.target.value as FilterOperator,
                                            // v0.1.191 — escalar ↔ lista según el operador.
                                            value: valueForOperator(e.target.value as FilterOperator, rule.value),
                                        })
                                    }
                                    aria-label={__('Operador')}
                                    className="imcrm-h-8 imcrm-min-w-[110px]"
                                >
                                    {operators.map((o) => (
                                        <option key={o.op} value={o.op}>
                                            {o.label}
                                        </option>
                                    ))}
                                </Select>
                            )}

                            {field && !isNullary && (
                                <div className="imcrm-min-w-[180px] imcrm-flex-1">
                                    <FilterValueInput
                                        listId={listId}
                                        field={field}
                                        op={rule.op}
                                        value={rule.value}
                                        onChange={(next) => updateRow(i, { value: next })}
                                    />
                                </div>
                            )}

                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeRow(i)}
                                aria-label={__('Eliminar condición')}
                                className="imcrm-shrink-0"
                            >
                                <Trash2 className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </div>

                        {isDate && field && (
                            <DateRangePresetButtons onPick={(preset) => applyDateRange(i, field.slug, preset)} />
                        )}
                    </div>
                );
            })}

            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addRow}
                className="imcrm-self-start imcrm-gap-2"
            >
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {addLabel ?? __('Añadir condición')}
            </Button>
        </div>
    );
}

/** v0.1.399 — fila de una condición sobre un dato del JSON del webhook. */
function PayloadRuleRow({
    rule,
    fields,
    datalistId,
    onChange,
    onRemove,
}: {
    rule: ConditionRule;
    fields: FieldEntity[];
    datalistId?: string;
    onChange: (patch: Partial<ConditionRule>) => void;
    onRemove: () => void;
}): JSX.Element {
    const path = rule.slug.slice(PAYLOAD_PREFIX.length);
    // Texto local: «2, cancelar» se escribe con comas y la lista se arma al vuelo
    // (si el input mostrara la lista ya armada, la coma recién tipeada se perdería).
    const [text, setText] = useState(() => payloadValueText(rule.value));
    const ops = PAYLOAD_OPS.some((o) => o.op === rule.op) ? PAYLOAD_OPS : [...PAYLOAD_OPS, { op: rule.op, label: rule.op }];
    return (
        <div
            className={cn(
                'imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2',
                'imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card/50 imcrm-px-2 imcrm-py-2',
            )}
            data-testid="condition-payload-row"
        >
            <Select
                value={PAYLOAD_OPTION}
                onChange={(e) => {
                    const v = e.target.value;
                    if (v === PAYLOAD_OPTION) return;
                    onChange({ slug: v, op: 'eq', value: '' });
                }}
                aria-label={__('Campo')}
                className="imcrm-h-8 imcrm-w-auto imcrm-min-w-[150px]"
            >
                <option value={PAYLOAD_OPTION}>{__('Dato del JSON')}</option>
                {fields
                    .filter((f) => f.type !== 'relation' && f.type !== 'button')
                    .map((f) => (
                        <option key={f.id} value={f.slug}>
                            {f.label}
                        </option>
                    ))}
            </Select>
            <div className="imcrm-flex imcrm-min-w-[140px] imcrm-flex-1 imcrm-items-center imcrm-rounded-lg imcrm-border imcrm-border-input imcrm-bg-card imcrm-pl-2">
                <span className="imcrm-font-mono imcrm-text-xs imcrm-text-muted-foreground">payload.</span>
                <Input
                    value={path}
                    list={datalistId}
                    placeholder="respuesta"
                    onChange={(e) => onChange({ slug: `${PAYLOAD_PREFIX}${e.target.value.trim()}` })}
                    aria-label={__('Ruta del dato en el JSON')}
                    className="imcrm-h-8 imcrm-border-0 imcrm-pl-0.5 imcrm-font-mono imcrm-text-xs imcrm-shadow-none focus-visible:imcrm-ring-0"
                    data-testid="condition-payload-path"
                />
            </div>
            <Select
                value={rule.op}
                onChange={(e) => {
                    const op = e.target.value as FilterOperator;
                    onChange({ op, value: payloadValueFrom(op, text) });
                }}
                aria-label={__('Operador')}
                className="imcrm-h-8 imcrm-w-auto imcrm-min-w-[120px]"
                data-testid="condition-payload-op"
            >
                {ops.map((o) => (
                    <option key={o.op} value={o.op}>
                        {o.label}
                    </option>
                ))}
            </Select>
            {!isNullaryOperator(rule.op) && (
                <Input
                    value={text}
                    placeholder={rule.op === 'in' || rule.op === 'nin' ? __('2, cancelar') : __('Valor')}
                    onChange={(e) => {
                        setText(e.target.value);
                        onChange({ value: payloadValueFrom(rule.op, e.target.value) });
                    }}
                    aria-label={__('Valor')}
                    className="imcrm-h-8 imcrm-min-w-[140px] imcrm-flex-1 imcrm-text-sm"
                    data-testid="condition-payload-value"
                />
            )}
            <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={__('Eliminar condición')} className="imcrm-shrink-0">
                <Trash2 className="imcrm-h-4 imcrm-w-4" />
            </Button>
        </div>
    );
}

/** Las variables del flujo como opciones del selector, agrupadas. */
function VariableOptions({ variables }: { variables: VariableOption[] }): JSX.Element | null {
    if (variables.length === 0) return null;
    const groups = [...new Set(variables.map((v) => v.group))];
    return (
        <>
            {groups.map((g) => (
                <optgroup key={g} label={g}>
                    {variables
                        .filter((v) => v.group === g)
                        .map((v) => (
                            <option key={v.tag} value={v.tag}>
                                {v.label}
                            </option>
                        ))}
                </optgroup>
            ))}
        </>
    );
}

/** v0.1.444 — fila de una condición sobre una variable del flujo (comentario o resultado de un paso). */
function VariableRuleRow({
    rule,
    fields,
    variables,
    onChange,
    onRemove,
}: {
    rule: ConditionRule;
    fields: FieldEntity[];
    variables: VariableOption[];
    onChange: (patch: Partial<ConditionRule>) => void;
    onRemove: () => void;
}): JSX.Element {
    const [text, setText] = useState(() => payloadValueText(rule.value));
    const ops = PAYLOAD_OPS.some((o) => o.op === rule.op) ? PAYLOAD_OPS : [...PAYLOAD_OPS, { op: rule.op, label: rule.op }];
    // Una variable que ya no está a la vista (el paso se borró o cambió de nombre) se conserva.
    const all = variables.some((v) => v.tag === rule.slug) ? variables : [...variables, { tag: rule.slug, label: rule.slug, group: __('Otra') }];
    return (
        <div
            className={cn(
                'imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2',
                'imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card/50 imcrm-px-2 imcrm-py-2',
            )}
            data-testid="condition-variable-row"
        >
            <Select
                value={rule.slug}
                onChange={(e) => {
                    const v = e.target.value;
                    onChange({ slug: v, op: isVariableRule(v) ? rule.op : 'eq', value: isVariableRule(v) ? rule.value : '' });
                }}
                aria-label={__('Campo')}
                className="imcrm-h-8 imcrm-w-auto imcrm-min-w-[170px] imcrm-flex-1"
                data-testid="condition-variable"
            >
                <VariableOptions variables={all} />
                <optgroup label={__('Campos del registro')}>
                    {fields
                        .filter((f) => f.type !== 'relation' && f.type !== 'button')
                        .map((f) => (
                            <option key={f.id} value={f.slug}>
                                {f.label}
                            </option>
                        ))}
                </optgroup>
            </Select>
            <Select
                value={rule.op}
                onChange={(e) => {
                    const op = e.target.value as FilterOperator;
                    onChange({ op, value: payloadValueFrom(op, text) });
                }}
                aria-label={__('Operador')}
                className="imcrm-h-8 imcrm-w-auto imcrm-min-w-[120px]"
            >
                {ops.map((o) => (
                    <option key={o.op} value={o.op}>
                        {o.label}
                    </option>
                ))}
            </Select>
            {!isNullaryOperator(rule.op) && (
                <Input
                    value={text}
                    placeholder={rule.op === 'in' || rule.op === 'nin' ? __('urgente, reclamo') : __('Valor')}
                    onChange={(e) => {
                        setText(e.target.value);
                        onChange({ value: payloadValueFrom(rule.op, e.target.value) });
                    }}
                    aria-label={__('Valor')}
                    className="imcrm-h-8 imcrm-min-w-[140px] imcrm-flex-1 imcrm-text-sm"
                    data-testid="condition-variable-value"
                />
            )}
            <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={__('Eliminar condición')} className="imcrm-shrink-0">
                <Trash2 className="imcrm-h-4 imcrm-w-4" />
            </Button>
        </div>
    );
}
