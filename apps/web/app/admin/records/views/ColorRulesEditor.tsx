import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { MAX_VIEW_COLOR_RULES, VIEW_ROW_COLORS, type ViewColorRule, type ViewRowColor } from '@imagina-base/shared';

import { Select } from '@/components/ui/select';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { FilterCondition } from '@/types/record';

import { FilterRow } from '../FilterRow';
import { newColorRuleId, ROW_COLOR_HEX, ROW_COLOR_LABEL } from '../grid/colorRules';
import { operatorsForType } from '../operators';

/**
 * v0.1.287 — «Colorear filas» del panel Personalizar vista: reglas en orden
 * de prioridad (la de arriba gana), cada una con su condición (el MISMO
 * editor de los filtros), su color, y si pinta la fila entera o la celda de
 * una columna. Se guardan en la vista como cualquier otra preferencia.
 */
export function ColorRulesEditor({
    listId,
    fields,
    rules,
    onChange,
}: {
    listId: number;
    fields: FieldEntity[];
    rules: ViewColorRule[];
    onChange: (next: ViewColorRule[]) => void;
}): JSX.Element {
    const colorable = fields.filter((f) => operatorsForType(f.type, f).length > 0);
    const update = (i: number, patch: Partial<ViewColorRule>): void =>
        onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const move = (i: number, dir: -1 | 1): void => {
        const j = i + dir;
        if (j < 0 || j >= rules.length) return;
        const next = [...rules];
        [next[i], next[j]] = [next[j]!, next[i]!];
        onChange(next);
    };
    const add = (): void => {
        const first = colorable[0];
        if (!first) return;
        onChange([
            ...rules,
            {
                id: newColorRuleId(),
                enabled: true,
                condition: { type: 'condition', field_id: first.id, op: operatorsForType(first.type, first)[0]?.op ?? 'eq', value: '' },
                color: VIEW_ROW_COLORS[rules.length % VIEW_ROW_COLORS.length]!,
                target: 'row',
            },
        ]);
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="imcrm-color-rules">
            {rules.length === 0 && (
                <p className="imcrm-px-1 imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Pinta las filas (o una celda) que cumplen una condición: lo vencido en rojo, lo pagado en verde. Si varias reglas se cumplen, gana la de arriba.')}
                </p>
            )}
            {rules.map((rule, i) => (
                <div
                    key={rule.id}
                    data-testid="imcrm-color-rule"
                    className={cn(
                        'imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2',
                        !rule.enabled && 'imcrm-opacity-60',
                    )}
                    style={{ borderLeft: `4px solid ${ROW_COLOR_HEX[rule.color]}` }}
                >
                    <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                        <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-font-medium">
                            <input
                                type="checkbox"
                                checked={rule.enabled}
                                onChange={(e) => update(i, { enabled: e.target.checked })}
                                className="imcrm-h-3.5 imcrm-w-3.5"
                                aria-label={sprintf(__('Activar la regla %d'), i + 1)}
                            />
                            {sprintf(__('Regla %d'), i + 1)}
                        </label>
                        <span className="imcrm-flex imcrm-items-center imcrm-gap-0.5">
                            <button
                                type="button"
                                disabled={i === 0}
                                onClick={() => move(i, -1)}
                                className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent disabled:imcrm-opacity-30"
                                aria-label={__('Subir la regla (más prioridad)')}
                            >
                                <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
                            </button>
                            <button
                                type="button"
                                disabled={i === rules.length - 1}
                                onClick={() => move(i, 1)}
                                className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent disabled:imcrm-opacity-30"
                                aria-label={__('Bajar la regla (menos prioridad)')}
                            >
                                <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
                            </button>
                        </span>
                    </div>
                    <FilterRow
                        listId={listId}
                        fields={colorable}
                        condition={rule.condition as FilterCondition}
                        onChange={(next) => update(i, { condition: next as ViewColorRule['condition'] })}
                        onRemove={() => onChange(rules.filter((_, j) => j !== i))}
                        removeLabel={__('Quitar la regla')}
                    />
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1" role="radiogroup" aria-label={__('Color')}>
                        {VIEW_ROW_COLORS.map((c: ViewRowColor) => (
                            <button
                                key={c}
                                type="button"
                                role="radio"
                                aria-checked={rule.color === c}
                                aria-label={ROW_COLOR_LABEL[c]}
                                title={ROW_COLOR_LABEL[c]}
                                onClick={() => update(i, { color: c })}
                                className={cn(
                                    'imcrm-h-5 imcrm-w-5 imcrm-rounded-full imcrm-border imcrm-border-black/10 imcrm-transition-transform',
                                    rule.color === c && 'imcrm-scale-110 imcrm-ring-2 imcrm-ring-offset-1 imcrm-ring-foreground/60',
                                )}
                                style={{ backgroundColor: ROW_COLOR_HEX[c] }}
                            />
                        ))}
                    </div>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <Select
                            aria-label={__('Qué se pinta')}
                            className="imcrm-h-8 imcrm-w-[150px]"
                            value={rule.target}
                            onChange={(e) =>
                                update(i, e.target.value === 'cell'
                                    ? { target: 'cell', cell_field_id: rule.cell_field_id ?? rule.condition.field_id }
                                    : { target: 'row', cell_field_id: undefined })
                            }
                        >
                            <option value="row">{__('La fila entera')}</option>
                            <option value="cell">{__('Una celda')}</option>
                        </Select>
                        {rule.target === 'cell' && (
                            <Select
                                aria-label={__('Columna que se pinta')}
                                className="imcrm-h-8 imcrm-min-w-[140px] imcrm-flex-1"
                                value={rule.cell_field_id ?? rule.condition.field_id}
                                onChange={(e) => update(i, { cell_field_id: Number(e.target.value) })}
                            >
                                {fields.map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {f.label}
                                    </option>
                                ))}
                            </Select>
                        )}
                    </div>
                </div>
            ))}
            {rules.length < MAX_VIEW_COLOR_RULES && colorable.length > 0 && (
                <button
                    type="button"
                    onClick={add}
                    className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-self-start imcrm-rounded-md imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-bg-primary/10"
                >
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar regla de color')}
                </button>
            )}
        </div>
    );
}
