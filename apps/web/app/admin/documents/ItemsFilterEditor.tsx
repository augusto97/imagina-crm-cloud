import { useMemo } from 'react';
import { AlertTriangle, Filter } from 'lucide-react';
import { cleanDocItemsFilter, docItemsFilterCount, type DocFilterField } from '@imagina-base/shared';
import { FilterGroupView } from '@/admin/records/FilterGroupView';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { FilterTree } from '@/types/record';

/** Los campos como los lee el limpiador del filtro (compartido con el servidor). */
export function docFilterFields(fields: FieldEntity[]): DocFilterField[] {
    return fields.map((f) => ({
        id: f.id,
        type: f.type,
        slug: f.slug,
        label: f.label,
        config: f.config,
        ...(f.type === 'formula' ? { formula: { result_type: f.formula?.result_type ?? null } } : {}),
    }));
}

/**
 * v0.1.468 — «Mostrar sólo los ítems que…» de la tabla de ítems de un
 * documento: el MISMO editor de condiciones de los filtros de la tabla, sobre
 * los campos de la lista de los ítems. Las reglas que no se pueden aplicar
 * (campo borrado, opción que ya no existe) se avisan acá y el PDF las ignora.
 */
export function ItemsFilterEditor({
    value,
    onChange,
    fields,
    listId,
}: {
    value: unknown;
    onChange: (tree: FilterTree | null) => void;
    fields: FieldEntity[];
    listId: number;
}): JSX.Element {
    const tree = value && typeof value === 'object' && (value as FilterTree).type === 'group' ? (value as FilterTree) : null;
    const issues = useMemo(() => (tree && fields.length > 0 ? cleanDocItemsFilter(tree, docFilterFields(fields)).issues : []), [tree, fields]);
    const count = docItemsFilterCount(tree);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2" data-tour="doc-items-filter">
            <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-xs">
                <input
                    type="checkbox"
                    className="imcrm-mt-0.5"
                    checked={tree !== null}
                    onChange={(e) => onChange(e.target.checked ? { type: 'group', logic: 'and', children: [] } : null)}
                    data-testid="doc-items-filter-toggle"
                />
                <span className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium">
                        <Filter className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary" aria-hidden />
                        {__('Mostrar sólo los ítems que…')}
                        {count > 0 && (
                            <span className="imcrm-rounded imcrm-bg-primary/10 imcrm-px-1.5 imcrm-text-[10px] imcrm-font-semibold imcrm-text-primary">
                                {count === 1 ? __('1 regla') : `${count} ${__('reglas')}`}
                            </span>
                        )}
                    </span>
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Por ejemplo, sólo las facturas pendientes. Los totales de la tabla suman sólo las filas que quedan.')}
                    </span>
                </span>
            </label>
            {tree && listId > 0 && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="doc-items-filter">
                    <FilterGroupView root={tree} path={[]} fields={fields} listId={listId} onRootChange={(next) => onChange(next)} />
                </div>
            )}
            {issues.length > 0 && (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid="doc-items-filter-issues">
                    {issues.map((i, k) => (
                        <li key={k} className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11px] imcrm-text-amber-700 dark:imcrm-text-amber-300">
                            <AlertTriangle className="imcrm-mt-px imcrm-h-3 imcrm-w-3 imcrm-shrink-0" aria-hidden />
                            {i.message}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
