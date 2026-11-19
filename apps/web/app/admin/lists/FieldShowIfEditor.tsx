import { useMemo } from 'react';
import { Eye, Plus, Trash2 } from 'lucide-react';
import {
    SHOW_IF_MAX_CONDITIONS,
    showIfCycle,
    showIfDeadConditions,
    showIfOpLabel,
    showIfOpNeedsValue,
    showIfSourceOps,
    type FieldType,
    type ShowIfOp,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useFields } from '@/hooks/useFields';
import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

/**
 * v0.1.457 (A7) — «Mostrar sólo si…»: el campo aparece en el alta y en la
 * ficha sólo cuando OTROS campos de la lista cumplen la condición (todas o
 * alguna de las reglas). Escribe `config.show_if` con los campos por ID; el
 * servidor lo vuelve a validar (tipos, operadores y ciclos) al guardar.
 */
interface Props {
    config: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
    listId?: number;
    currentFieldId?: number;
}

interface RuleRow {
    field_id: number | null;
    op: ShowIfOp;
    value?: unknown;
}

interface RuleDraft {
    logic: 'and' | 'or';
    conditions: RuleRow[];
}

function readDraft(config: Record<string, unknown>): RuleDraft | null {
    const raw = config.show_if;
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as { logic?: unknown; conditions?: unknown };
    const conditions = Array.isArray(r.conditions)
        ? r.conditions
              .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
              .map((c) => ({
                  field_id: typeof c.field_id === 'number' ? c.field_id : null,
                  op: (typeof c.op === 'string' ? c.op : 'eq') as ShowIfOp,
                  ...(c.value !== undefined ? { value: c.value } : {}),
              }))
        : [];
    return { logic: r.logic === 'or' ? 'or' : 'and', conditions };
}

function optionsOf(field: FieldEntity): Array<{ value: string; label: string }> {
    const raw = Array.isArray(field.config.options) ? field.config.options : [];
    return raw
        .map((o) => (o && typeof o === 'object' ? (o as Record<string, unknown>) : null))
        .filter((o): o is Record<string, unknown> => o !== null && typeof o.value === 'string' && o.value !== '')
        .map((o) => ({ value: String(o.value), label: typeof o.label === 'string' && o.label !== '' ? o.label : String(o.value) }));
}

const NUMERIC: ReadonlySet<string> = new Set(['number', 'currency', 'percent', 'rating', 'duration']);

/** ¿Falta completar esta regla (campo o valor)? */
function incomplete(row: RuleRow): boolean {
    if (row.field_id === null) return true;
    if (!showIfOpNeedsValue(row.op)) return false;
    const v = row.value;
    return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

export function FieldShowIfEditor({ config, onChange, listId, currentFieldId }: Props): JSX.Element | null {
    const fieldsQuery = useFields(listId);
    const allFields = useMemo(() => (fieldsQuery.data ?? []) as FieldEntity[], [fieldsQuery.data]);
    const candidates = useMemo(
        () => allFields.filter((f) => f.id !== currentFieldId && showIfSourceOps(f.type).length > 0).sort((a, b) => a.position - b.position),
        [allFields, currentFieldId],
    );
    const draft = readDraft(config);

    if (listId === undefined) return null;

    const write = (next: RuleDraft | null): void => {
        const out = { ...config };
        if (next === null || next.conditions.length === 0) out.show_if = null;
        else out.show_if = { logic: next.logic, conditions: next.conditions };
        onChange(out);
    };
    const setRow = (i: number, patch: Partial<RuleRow>): void => {
        if (!draft) return;
        const conditions = draft.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c));
        write({ ...draft, conditions });
    };
    const addRow = (): void => {
        const first = candidates[0];
        const row: RuleRow = first ? { field_id: first.id, op: showIfSourceOps(first.type)[0]! } : { field_id: null, op: 'eq' };
        write({ logic: draft?.logic ?? 'and', conditions: [...(draft?.conditions ?? []), row] });
    };

    const dead = showIfDeadConditions(config, allFields);
    const cycle =
        draft && currentFieldId !== undefined
            ? showIfCycle(
                  allFields,
                  currentFieldId,
                  { logic: draft.logic, conditions: draft.conditions.filter((c) => c.field_id !== null) } as never,
              )
            : null;
    const labelOf = (id: number): string => allFields.find((f) => f.id === id)?.label ?? `#${id}`;

    return (
        <div
            className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3"
            data-tour="field-show-if"
            data-testid="field-show-if"
        >
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                    <Eye className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                    {__('Mostrar sólo si…')}
                </span>
                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('El campo aparece en el alta y en la ficha sólo cuando otros campos cumplen esto. Mientras está oculto no es obligatorio, y lo que ya tenía guardado se conserva.')}
                </span>
            </div>

            {!draft || draft.conditions.length === 0 ? (
                <Button type="button" variant="outline" size="sm" className="imcrm-self-start" onClick={addRow} disabled={candidates.length === 0}>
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {candidates.length === 0 ? __('No hay otros campos para usar de condición') : __('Agregar una condición')}
                </Button>
            ) : (
                <>
                    {draft.conditions.length > 1 && (
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                            <span className="imcrm-text-muted-foreground">{__('Se muestra cuando')}</span>
                            <Select
                                value={draft.logic}
                                aria-label={__('Cómo se combinan las reglas')}
                                className="imcrm-h-8 imcrm-w-auto"
                                onChange={(e) => write({ ...draft, logic: e.target.value === 'or' ? 'or' : 'and' })}
                            >
                                <option value="and">{__('se cumplen todas')}</option>
                                <option value="or">{__('se cumple alguna')}</option>
                            </Select>
                        </div>
                    )}
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                        {draft.conditions.map((row, i) => {
                            const other = row.field_id !== null ? allFields.find((f) => f.id === row.field_id) ?? null : null;
                            const ops = other ? showIfSourceOps(other.type) : [];
                            return (
                                // El panel del campo es angosto: el campo de la condición va en su
                                // renglón y la regla con su valor debajo (antes, en una sola línea, los
                                // selectores quedaban tan chicos que no se leía lo elegido).
                                <div key={i} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-muted/30 imcrm-p-2" data-testid="field-show-if-rule">
                                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                        <div className="imcrm-min-w-0 imcrm-flex-1">
                                            <Select
                                                value={row.field_id !== null ? String(row.field_id) : ''}
                                                aria-label={__('Campo de la condición')}
                                                onChange={(e) => {
                                                    const id = Number(e.target.value);
                                                    const f = candidates.find((x) => x.id === id);
                                                    if (!f) return setRow(i, { field_id: null });
                                                    setRow(i, { field_id: id, op: showIfSourceOps(f.type)[0]!, value: undefined });
                                                }}
                                            >
                                                {row.field_id !== null && !other && <option value={row.field_id}>{__('(un campo que ya no existe)')}</option>}
                                                {row.field_id === null && <option value="">{__('Elige un campo')}</option>}
                                                {candidates.map((f) => (
                                                    <option key={f.id} value={f.id}>
                                                        {f.label}
                                                    </option>
                                                ))}
                                            </Select>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            aria-label={__('Quitar esta regla')}
                                            onClick={() => write({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) })}
                                        >
                                            <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                        </Button>
                                    </div>
                                    {other && (
                                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                                            <div className="imcrm-min-w-[7rem] imcrm-flex-1">
                                                <Select
                                                    value={row.op}
                                                    aria-label={__('Regla')}
                                                    onChange={(e) => {
                                                        const op = e.target.value as ShowIfOp;
                                                        // Al pasar de «es» a «es alguno de» (o al revés) se conserva lo elegido.
                                                        const multi = op === 'in' || op === 'nin';
                                                        const prev = row.value;
                                                        const value = !showIfOpNeedsValue(op)
                                                            ? undefined
                                                            : multi
                                                              ? Array.isArray(prev) ? prev : prev === undefined || prev === null || prev === '' ? undefined : [prev]
                                                              : Array.isArray(prev) ? prev[0] : prev;
                                                        setRow(i, { op, value });
                                                    }}
                                                >
                                                    {ops.map((o) => (
                                                        <option key={o} value={o}>
                                                            {other.type === 'checkbox' ? __('está') : __(showIfOpLabel(o, other.type))}
                                                        </option>
                                                    ))}
                                                </Select>
                                            </div>
                                            {showIfOpNeedsValue(row.op) && (
                                                <div className="imcrm-min-w-[9rem] imcrm-flex-[2]">
                                                    <ShowIfValue other={other} op={row.op} value={row.value} onChange={(value) => setRow(i, { value })} />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {incomplete(row) && other && (
                                        <span className="imcrm-text-xs imcrm-text-amber-600 dark:imcrm-text-amber-400">
                                            {__('Completa el valor de esta regla o quítala: incompleta no se guarda.')}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    {draft.conditions.length < SHOW_IF_MAX_CONDITIONS && (
                        <Button type="button" variant="ghost" size="sm" className="imcrm-self-start" onClick={addRow}>
                            <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Agregar otra regla')}
                        </Button>
                    )}
                </>
            )}

            {dead > 0 && (
                <p className="imcrm-rounded-md imcrm-bg-amber-500/10 imcrm-p-2 imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-300" role="status">
                    {dead === 1
                        ? __('Una regla usa un campo que ya no existe (o está en la papelera): no se aplica y el campo se muestra. Cámbiala o quítala.')
                        : sprintf(__('%d reglas usan campos que ya no existen (o están en la papelera): no se aplican. Cámbialas o quítalas.'), dead)}
                </p>
            )}
            {cycle && (
                <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-p-2 imcrm-text-xs imcrm-text-destructive" role="alert">
                    {sprintf(
                        __('Esta condición se cierra sobre sí misma (%s): un campo no puede depender de uno que depende de él. Así no se puede guardar.'),
                        cycle.map(labelOf).join(' → '),
                    )}
                </p>
            )}
        </div>
    );
}

function ShowIfValue({ other, op, value, onChange }: { other: FieldEntity; op: ShowIfOp; value: unknown; onChange: (v: unknown) => void }): JSX.Element {
    if (other.type === 'checkbox') {
        const on = value === true || value === 'true' || value === 1 || value === '1';
        return (
            <Select value={value === undefined ? '' : on ? '1' : '0'} aria-label={__('Valor')} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === '1')}>
                <option value="">{__('Elige')}</option>
                <option value="1">{__('marcada')}</option>
                <option value="0">{__('desmarcada')}</option>
            </Select>
        );
    }
    if (other.type === 'select' || other.type === 'multi_select') {
        const options = optionsOf(other);
        if (op === 'in' || op === 'nin') {
            const picked = Array.isArray(value) ? value.map(String) : [];
            return (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-3 imcrm-gap-y-1" role="group" aria-label={__('Valores')}>
                    {options.map((o) => (
                        <label key={o.value} className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs">
                            <input
                                type="checkbox"
                                checked={picked.includes(o.value)}
                                onChange={(e) => onChange(e.target.checked ? [...picked, o.value] : picked.filter((x) => x !== o.value))}
                            />
                            {o.label}
                        </label>
                    ))}
                </div>
            );
        }
        return (
            <Select value={typeof value === 'string' ? value : ''} aria-label={__('Valor')} onChange={(e) => onChange(e.target.value || undefined)}>
                <option value="">{__('Elige una opción')}</option>
                {options.map((o) => (
                    <option key={o.value} value={o.value}>
                        {o.label}
                    </option>
                ))}
            </Select>
        );
    }
    if (other.type === 'date') {
        return <Input type="date" value={typeof value === 'string' ? value.slice(0, 10) : ''} aria-label={__('Fecha')} onChange={(e) => onChange(e.target.value || undefined)} />;
    }
    if (NUMERIC.has(other.type as FieldType)) {
        return (
            <Input
                type="number"
                step="any"
                value={value === undefined || value === null ? '' : String(value)}
                aria-label={__('Valor')}
                onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            />
        );
    }
    return <Input value={typeof value === 'string' ? value : ''} aria-label={__('Valor')} placeholder={__('Valor')} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)} />;
}
