import { Plus, X } from 'lucide-react';

import {
    FORM_CALC_OPS,
    FORM_CONDITION_MAX_RULES,
    FORM_CONDITION_OPS,
    formConditionRules,
    isFormCalcCondition,
    isFormConditionGroup,
    type FormCalcCondition,
    type FormCondition,
    type FormConditionOp,
    type FormFieldCondition,
    type FormShowIf,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

/**
 * v0.1.356 — Editor de condiciones: una o varias reglas («si Tipo es
 * Empresa») que se cumplen TODAS o ALGUNA. Lo usan «Mostrar sólo si…» de
 * cada pregunta, los saltos entre páginas y las pantallas finales. Con una
 * sola regla guarda una condición suelta (la forma de siempre); con más, un
 * grupo.
 */

export const OP_LABELS: Record<FormConditionOp, string> = {
    eq: 'es',
    neq: 'no es',
    in: 'es alguno de',
    contains: 'contiene',
    gt: 'es mayor que',
    lt: 'es menor que',
    is_empty: 'está vacío',
    is_not_empty: 'tiene respuesta',
};

const NUMERIC = new Set(['number', 'currency', 'percent', 'rating', 'duration']);

/** v0.1.357 — Un cálculo del formulario que una regla puede mirar (saltos y pantallas finales). */
export interface CalcChoice {
    key: string;
    name: string;
}
const CALC_PREFIX = 'calc:';

/** Las comparaciones que tienen sentido para el tipo del campo que controla. */
export function opsFor(type: string | undefined): FormConditionOp[] {
    if (type === 'checkbox') return ['eq', 'is_empty', 'is_not_empty'];
    if (type && NUMERIC.has(type)) return ['eq', 'neq', 'gt', 'lt', 'is_empty', 'is_not_empty'];
    if (type === 'select' || type === 'multi_select') return ['eq', 'neq', 'is_empty', 'is_not_empty'];
    return [...FORM_CONDITION_OPS].filter((o) => o !== 'in' && o !== 'gt' && o !== 'lt');
}

/** Junta las reglas en la forma que se guarda: una suelta o un grupo. */
export function packRules(rules: FormCondition[], match: 'all' | 'any'): FormShowIf | null {
    if (rules.length === 0) return null;
    if (rules.length === 1) return rules[0]!;
    return { match, rules };
}

export function ConditionEditor({
    value,
    onChange,
    candidates,
    fieldsById,
    emptyHint,
    addLabel = 'Agregar una condición',
    testId = 'form-condition',
    calcs = [],
}: {
    value: FormShowIf | null;
    onChange: (v: FormShowIf | null) => void;
    candidates: ReadonlyArray<{ field_id: number }>;
    fieldsById: Map<number, FieldEntity>;
    /** Qué se ve cuando no hay preguntas de las que depender. */
    emptyHint: string;
    addLabel?: string;
    testId?: string;
    /** v0.1.357 — Cálculos que se pueden mirar (sólo en saltos y pantallas finales). */
    calcs?: ReadonlyArray<CalcChoice>;
}): JSX.Element {
    const usable = candidates.filter((c, i, all) => fieldsById.has(c.field_id) && all.findIndex((x) => x.field_id === c.field_id) === i);
    const rules = formConditionRules(value);
    const match = isFormConditionGroup(value) ? value.match : 'all';
    const set = (next: FormCondition[], m: 'all' | 'any' = match): void => onChange(packRules(next, m));
    const firstField = usable[usable.length - 1]?.field_id;
    // Sin preguntas antes, la primera regla puede ser sobre un cálculo.
    const firstRule = (): FormCondition | null =>
        firstField !== undefined ? { field_id: firstField, op: 'eq', value: '' } : calcs[0] ? { calc: calcs[0].key, op: 'gt', value: 0 } : null;
    const first = firstRule();

    if (usable.length === 0 && calcs.length === 0 && rules.length === 0) return <p className="imcrm-text-xs imcrm-text-muted-foreground">{__(emptyHint)}</p>;
    if (rules.length === 0) {
        return (
            <Button variant="outline" size="sm" className="imcrm-self-start" onClick={() => first && set([first])} data-testid={`${testId}-add`}>
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {__(addLabel)}
            </Button>
        );
    }
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid={testId}>
            {rules.length > 1 && (
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                    <span className="imcrm-text-muted-foreground">{__('Se tienen que cumplir')}</span>
                    <Select
                        value={match}
                        onChange={(e) => set(rules, e.target.value as 'all' | 'any')}
                        className="imcrm-h-8 imcrm-w-auto imcrm-text-xs"
                        aria-label={__('Cómo se combinan las condiciones')}
                        data-testid={`${testId}-match`}
                    >
                        <option value="all">{__('todas')}</option>
                        <option value="any">{__('alguna')}</option>
                    </Select>
                </label>
            )}
            {rules.map((rule, idx) => (
                <div key={idx} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2" data-testid={`${testId}-rule`}>
                    {idx > 0 && (
                        <span className="imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                            {match === 'all' ? __('y además') : __('o')}
                        </span>
                    )}
                    <RuleRow
                        testId={testId}
                        rule={rule}
                        usable={usable}
                        calcs={calcs}
                        fieldsById={fieldsById}
                        onChange={(r) => set(rules.map((x, i) => (i === idx ? r : x)))}
                        onRemove={() => set(rules.filter((_, i) => i !== idx))}
                    />
                </div>
            ))}
            {rules.length < FORM_CONDITION_MAX_RULES && first && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="imcrm-self-start"
                    onClick={() => set([...rules, first])}
                    data-testid={`${testId}-more`}
                >
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Otra condición')}
                </Button>
            )}
        </div>
    );
}

/** Las comparaciones de una regla sobre un cálculo (un número). */
export const CALC_OP_LABELS: Record<(typeof FORM_CALC_OPS)[number], string> = {
    eq: 'es igual a',
    neq: 'no es',
    gt: 'es mayor que',
    lt: 'es menor que',
};

function RuleRow({
    testId,
    rule,
    usable,
    calcs,
    fieldsById,
    onChange,
    onRemove,
}: {
    testId: string;
    rule: FormCondition;
    usable: ReadonlyArray<{ field_id: number }>;
    calcs: ReadonlyArray<CalcChoice>;
    fieldsById: Map<number, FieldEntity>;
    onChange: (r: FormCondition) => void;
    onRemove: () => void;
}): JSX.Element {
    // v0.1.357 — elegir un cálculo o una pregunta en el mismo desplegable.
    const pickSource = (raw: string): void => {
        if (raw.startsWith(CALC_PREFIX)) onChange({ calc: raw.slice(CALC_PREFIX.length), op: 'gt', value: 0 });
        else onChange({ field_id: Number(raw), op: 'eq', value: '' });
    };
    if (isFormCalcCondition(rule)) return <CalcRuleRow rule={rule} usable={usable} calcs={calcs} fieldsById={fieldsById} onPick={pickSource} onChange={onChange} onRemove={onRemove} />;
    return <FieldRuleRow testId={testId} rule={rule} usable={usable} calcs={calcs} fieldsById={fieldsById} onPick={pickSource} onChange={onChange} onRemove={onRemove} />;
}

/** El desplegable de «qué mira la regla»: las preguntas y, si hay, los cálculos. */
function SourceSelect({
    value,
    missing,
    usable,
    calcs,
    fieldsById,
    onPick,
}: {
    value: string;
    missing: string | null;
    usable: ReadonlyArray<{ field_id: number }>;
    calcs: ReadonlyArray<CalcChoice>;
    fieldsById: Map<number, FieldEntity>;
    onPick: (raw: string) => void;
}): JSX.Element {
    return (
        <Select value={value} onChange={(e) => onPick(e.target.value)} aria-label={__('Pregunta que controla')} className="imcrm-min-w-0 imcrm-flex-1">
            {missing && <option value={value}>{missing}</option>}
            {usable.map((c) => (
                <option key={c.field_id} value={c.field_id}>
                    {fieldsById.get(c.field_id)?.label}
                </option>
            ))}
            {calcs.length > 0 && (
                <optgroup label={__('Cálculos')}>
                    {calcs.map((c) => (
                        <option key={c.key} value={CALC_PREFIX + c.key}>
                            {c.name || c.key}
                        </option>
                    ))}
                </optgroup>
            )}
        </Select>
    );
}

function CalcRuleRow({
    rule,
    usable,
    calcs,
    fieldsById,
    onPick,
    onChange,
    onRemove,
}: {
    rule: FormCalcCondition;
    usable: ReadonlyArray<{ field_id: number }>;
    calcs: ReadonlyArray<CalcChoice>;
    fieldsById: Map<number, FieldEntity>;
    onPick: (raw: string) => void;
    onChange: (r: FormCondition) => void;
    onRemove: () => void;
}): JSX.Element {
    const known = calcs.some((c) => c.key === rule.calc);
    const raw = rule.value === undefined || rule.value === null ? '' : String(rule.value);
    return (
        <>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                <SourceSelect value={CALC_PREFIX + rule.calc} missing={known ? null : __('Cálculo borrado')} usable={usable} calcs={calcs} fieldsById={fieldsById} onPick={onPick} />
                <Button variant="ghost" size="icon" className="imcrm-h-8 imcrm-w-8 imcrm-shrink-0" aria-label={__('Quitar esta condición')} onClick={onRemove}>
                    <X className="imcrm-h-3.5 imcrm-w-3.5" />
                </Button>
            </div>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                <Select value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as FormCalcCondition['op'] })} aria-label={__('Comparación')} className="imcrm-flex-1">
                    {FORM_CALC_OPS.map((o) => (
                        <option key={o} value={o}>
                            {__(CALC_OP_LABELS[o])}
                        </option>
                    ))}
                </Select>
                <Input
                    className="imcrm-w-24"
                    inputMode="decimal"
                    value={raw}
                    onChange={(e) => {
                        const t = e.target.value.trim().replace(',', '.');
                        const n = Number(t);
                        onChange({ ...rule, value: t === '' || t === '-' || !Number.isFinite(n) ? t : n });
                    }}
                    aria-label={__('Valor')}
                    data-testid="form-condition-calc-value"
                />
            </div>
        </>
    );
}

function FieldRuleRow({
    testId,
    rule,
    usable,
    calcs,
    fieldsById,
    onPick,
    onChange,
    onRemove,
}: {
    testId: string;
    rule: FormFieldCondition;
    usable: ReadonlyArray<{ field_id: number }>;
    calcs: ReadonlyArray<CalcChoice>;
    fieldsById: Map<number, FieldEntity>;
    onPick: (raw: string) => void;
    onChange: (r: FormCondition) => void;
    onRemove: () => void;
}): JSX.Element {
    const ctl = fieldsById.get(rule.field_id);
    const options =
        ctl && (ctl.type === 'select' || ctl.type === 'multi_select')
            ? ((ctl.config.options as Array<{ value: string; label?: string }> | undefined) ?? [])
            : [];
    const ops = opsFor(ctl?.type);
    const needsValue = rule.op !== 'is_empty' && rule.op !== 'is_not_empty';
    const missing = !ctl;
    return (
        <>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                <SourceSelect value={String(rule.field_id)} missing={missing ? __('Pregunta borrada') : null} usable={usable} calcs={calcs} fieldsById={fieldsById} onPick={onPick} />
                <Button variant="ghost" size="icon" className="imcrm-h-8 imcrm-w-8 imcrm-shrink-0" aria-label={__('Quitar esta condición')} onClick={onRemove}>
                    <X className="imcrm-h-3.5 imcrm-w-3.5" />
                </Button>
            </div>
            <Select value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as FormConditionOp } as FormFieldCondition)} aria-label={__('Comparación')}>
                {ops.map((o) => (
                    <option key={o} value={o}>
                        {__(OP_LABELS[o])}
                    </option>
                ))}
            </Select>
            {needsValue &&
                (ctl?.type === 'checkbox' ? (
                    <Select value={String(rule.value === true)} onChange={(e) => onChange({ ...rule, value: e.target.value === 'true' })} aria-label={__('Valor')}>
                        <option value="true">{__('Marcada')}</option>
                        <option value="false">{__('Sin marcar')}</option>
                    </Select>
                ) : options.length > 0 ? (
                    <Select value={String(rule.value ?? '')} onChange={(e) => onChange({ ...rule, value: e.target.value })} aria-label={__('Valor')}>
                        <option value="">{__('Elige una opción')}</option>
                        {options.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label || o.value}
                            </option>
                        ))}
                    </Select>
                ) : (
                    <Input
                        value={String(rule.value ?? '')}
                        inputMode={ctl && NUMERIC.has(ctl.type) ? 'decimal' : undefined}
                        onChange={(e) => onChange({ ...rule, value: e.target.value })}
                        aria-label={__('Valor')}
                    />
                ))}
            {needsValue && ctl?.type !== 'checkbox' && (rule.value === '' || rule.value == null) && (
                <p className="imcrm-rounded imcrm-bg-warning/10 imcrm-px-2 imcrm-py-1 imcrm-text-[11px] imcrm-leading-snug" data-testid={`${testId}-missing`}>
                    {__('Falta el valor: elige o escribe con qué comparar para que la regla funcione.')}
                </p>
            )}
        </>
    );
}
