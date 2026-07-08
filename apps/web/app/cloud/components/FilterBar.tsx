import { type Field, type FilterCondition, type FilterOperator } from '@imagina-base/shared';
import { fieldOptions } from '@/cloud/lib/fieldValue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Operadores expuestos en la UI (subconjunto legible del QueryBuilder). */
const OPS: Array<{ op: FilterOperator; label: string; nullary?: boolean }> = [
    { op: 'eq', label: '=' },
    { op: 'neq', label: '≠' },
    { op: 'gt', label: '>' },
    { op: 'gte', label: '≥' },
    { op: 'lt', label: '<' },
    { op: 'lte', label: '≤' },
    { op: 'contains', label: 'contiene' },
    { op: 'is_null', label: 'vacío', nullary: true },
    { op: 'is_not_null', label: 'no vacío', nullary: true },
];

/**
 * Barra de filtros AND sobre la lista. Cada condición referencia un field_id
 * (regla de oro nº 1) y compila server-side vía el QueryBuilder (whitelist).
 */
export function FilterBar({
    fields,
    conditions,
    onChange,
}: {
    fields: Field[];
    conditions: FilterCondition[];
    onChange: (next: FilterCondition[]) => void;
}): JSX.Element {
    const set = (i: number, patch: Partial<FilterCondition>) =>
        onChange(conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
    const add = () =>
        onChange([
            ...conditions,
            { type: 'condition', field_id: fields[0]?.id ?? 0, op: 'eq', value: '' },
        ]);
    const remove = (i: number) => onChange(conditions.filter((_c, idx) => idx !== i));

    return (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
            {conditions.map((c, i) => {
                const field = fields.find((f) => f.id === c.field_id);
                const nullary = OPS.find((o) => o.op === c.op)?.nullary;
                return (
                    <div
                        key={i}
                        className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-1.5 imcrm-py-1"
                    >
                        <select
                            aria-label="Campo del filtro"
                            value={c.field_id}
                            onChange={(e) => set(i, { field_id: Number(e.target.value) })}
                            className="imcrm-h-7 imcrm-rounded imcrm-bg-transparent imcrm-text-sm"
                        >
                            {fields.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.label}
                                </option>
                            ))}
                        </select>
                        <select
                            aria-label="Operador"
                            value={c.op}
                            onChange={(e) => set(i, { op: e.target.value as FilterOperator })}
                            className="imcrm-h-7 imcrm-rounded imcrm-bg-transparent imcrm-text-sm"
                        >
                            {OPS.map((o) => (
                                <option key={o.op} value={o.op}>
                                    {o.label}
                                </option>
                            ))}
                        </select>
                        {!nullary &&
                            (field?.type === 'select' ? (
                                <select
                                    aria-label="Valor"
                                    value={String(c.value ?? '')}
                                    onChange={(e) => set(i, { value: e.target.value })}
                                    className="imcrm-h-7 imcrm-rounded imcrm-bg-transparent imcrm-text-sm"
                                >
                                    <option value="">—</option>
                                    {fieldOptions(field).map((o) => (
                                        <option key={o.value} value={o.value}>
                                            {o.label}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <Input
                                    aria-label="Valor"
                                    value={String(c.value ?? '')}
                                    onChange={(e) => set(i, { value: e.target.value })}
                                    placeholder="valor"
                                    className="imcrm-h-7 imcrm-w-24"
                                />
                            ))}
                        <button
                            onClick={() => remove(i)}
                            aria-label="Quitar filtro"
                            className="imcrm-px-1 imcrm-text-muted-foreground hover:imcrm-text-destructive"
                        >
                            ✕
                        </button>
                    </div>
                );
            })}
            <Button variant="ghost" size="sm" onClick={add} disabled={fields.length === 0}>
                + Filtro
            </Button>
            {conditions.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => onChange([])}>
                    Limpiar
                </Button>
            )}
        </div>
    );
}
