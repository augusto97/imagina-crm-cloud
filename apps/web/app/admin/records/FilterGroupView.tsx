import { ChevronDown, Filter, Plus } from 'lucide-react';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type {
    FilterCondition,
    FilterGroup,
    FilterLogic,
    FilterOperator,
    FilterTree,
} from '@/types/record';

import { DateRangePresetButtons } from './DateRangePresetButtons';
import { FilterRow } from './FilterRow';
import {
    addNode,
    isConditionNode,
    isGroupNode,
    makeCondition,
    makeGroup,
    removeNodeAt,
    replaceNodeAt,
    setGroupLogic,
} from './filterTree';

interface FilterGroupViewProps {
    /** Árbol completo (la raíz). Las acciones lo retornan modificado. */
    root: FilterTree;
    /** Path al grupo que renderea este componente (vacío = raíz). */
    path: number[];
    fields: FieldEntity[];
    listId: number | undefined;
    onRootChange: (next: FilterTree) => void;
    /** Profundidad de anidación (controla la indentación visual). */
    depth?: number;
}

/**
 * Renderiza un grupo de filtros recursivamente. Cada hijo es una
 * `FilterRow` (condición) o un sub-`FilterGroupView` (grupo anidado).
 * Entre hijos consecutivos pinta el conector `Y`/`O` que toggle la
 * lógica del grupo.
 *
 * Si el grupo está vacío y es la raíz, mostramos un empty state con
 * un CTA bien visible para agregar el primer filtro — ClickUp es
 * inutilizable cuando el panel se ve vacío y al usuario le tocaría
 * adivinar dónde clickear.
 */
export function FilterGroupView({
    root,
    path,
    fields,
    listId,
    onRootChange,
    depth = 0,
}: FilterGroupViewProps): JSX.Element {
    const group = resolveGroup(root, path);
    if (group === null) {
        return <div />;
    }

    const isRoot = depth === 0;
    const isEmpty = group.children.length === 0;

    const setLogic = (logic: FilterLogic): void => {
        onRootChange(setGroupLogic(root, path, logic));
    };

    const updateChild = (childIdx: number, next: FilterCondition): void => {
        onRootChange(replaceNodeAt(root, [...path, childIdx], next));
    };

    const removeChild = (childIdx: number): void => {
        onRootChange(removeNodeAt(root, [...path, childIdx]));
    };

    const addCondition = (): void => {
        const firstField = fields.find((f) => f.type !== 'relation');
        const defaultOp = firstField ? defaultOpFor(firstField.type) : 'eq';
        onRootChange(
            addNode(
                root,
                path,
                makeCondition(firstField?.id ?? 0, defaultOp, ''),
            ),
        );
    };

    const addNestedGroupAfter = (afterIdx: number): void => {
        const firstField = fields.find((f) => f.type !== 'relation');
        const defaultOp  = firstField ? defaultOpFor(firstField.type) : 'eq';
        const nested     = makeGroup('and', [makeCondition(firstField?.id ?? 0, defaultOp, '')]);
        const nextChildren = [...group.children];
        nextChildren.splice(afterIdx + 1, 0, nested);
        const newGroup: FilterGroup = { ...group, children: nextChildren };
        if (isRoot) {
            onRootChange(newGroup as FilterTree);
        } else {
            onRootChange(replaceNodeAt(root, path, newGroup));
        }
    };

    const applyDateRangePreset = (
        condition: FilterCondition,
        preset: string,
    ): void => {
        const idx = group.children.findIndex((c) => c === condition);
        if (idx < 0) return;
        // Una sola condición dinámica con `between_relative`. El backend
        // (`QueryBuilder::compileFilter`) la resuelve a `[from, to]`
        // contra `wp_timezone()` en cada query, por eso "Este mes" sigue
        // siendo este mes la próxima vez que se abre el dashboard.
        const next: FilterCondition = {
            type: 'condition',
            field_id: condition.field_id,
            op: 'between_relative',
            value: preset,
        };
        const nextChildren = [...group.children];
        nextChildren.splice(idx, 1, next);
        const newGroup: FilterGroup = { ...group, children: nextChildren };
        if (isRoot) {
            onRootChange(newGroup as FilterTree);
        } else {
            onRootChange(replaceNodeAt(root, path, newGroup));
        }
    };

    // EMPTY STATE — solo aplica al root. Para sub-grupos vacíos, el
    // padre los maneja eliminando el grupo en `removeNodeAt`.
    if (isRoot && isEmpty) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/20 imcrm-px-4 imcrm-py-8 imcrm-text-center">
                <div className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-card imcrm-text-muted-foreground">
                    <Filter className="imcrm-h-5 imcrm-w-5" />
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <p className="imcrm-text-sm imcrm-font-medium imcrm-text-foreground">
                        {__('Sin filtros activos')}
                    </p>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Agrega tu primer filtro para acotar los resultados.')}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={addCondition}
                    className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-primary imcrm-px-3 imcrm-py-1.5 imcrm-text-xs imcrm-font-medium imcrm-text-primary-foreground hover:imcrm-bg-primary/90"
                >
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar filtro')}
                </button>
            </div>
        );
    }

    return (
        <div
            className={cn(
                'imcrm-flex imcrm-flex-col imcrm-gap-2',
                depth > 0 && 'imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/10 imcrm-p-2',
            )}
        >
            {group.children.map((child, idx) => {
                const isFirst = idx === 0;
                return (
                    <div key={idx} className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <div className="imcrm-flex imcrm-items-start imcrm-gap-2">
                            <div className="imcrm-w-14 imcrm-shrink-0 imcrm-pt-1.5 imcrm-text-right imcrm-text-xs imcrm-text-muted-foreground">
                                {isFirst ? (
                                    __('Dónde')
                                ) : (
                                    <LogicToggle logic={group.logic} onChange={setLogic} />
                                )}
                            </div>
                            <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1 imcrm-min-w-0">
                                {isConditionNode(child) ? (
                                    <>
                                        <FilterRow
                                            listId={listId}
                                            fields={fields}
                                            condition={child}
                                            onChange={(next) => updateChild(idx, next)}
                                            onRemove={() => removeChild(idx)}
                                        />
                                        {isDateField(fields, child.field_id) && (
                                            <DateRangePresetButtons
                                                onPick={(preset) =>
                                                    applyDateRangePreset(child, preset)
                                                }
                                            />
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => addNestedGroupAfter(idx)}
                                            className="imcrm-self-start imcrm-text-[11px] imcrm-text-primary hover:imcrm-underline"
                                        >
                                            {__('Agregar filtro anidado')}
                                        </button>
                                    </>
                                ) : isGroupNode(child) ? (
                                    <FilterGroupView
                                        root={root}
                                        path={[...path, idx]}
                                        fields={fields}
                                        listId={listId}
                                        onRootChange={onRootChange}
                                        depth={depth + 1}
                                    />
                                ) : null}
                            </div>
                        </div>
                    </div>
                );
            })}

            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-pl-16">
                <button
                    type="button"
                    onClick={addCondition}
                    className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-card imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-foreground/70 hover:imcrm-border-primary/50 hover:imcrm-text-primary"
                >
                    <Plus className="imcrm-h-3 imcrm-w-3" />
                    {__('Agregar filtro')}
                </button>
            </div>
        </div>
    );
}

function LogicToggle({
    logic,
    onChange,
}: {
    logic: FilterLogic;
    onChange: (l: FilterLogic) => void;
}): JSX.Element {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-1.5 imcrm-py-0.5 imcrm-text-xs imcrm-font-semibold imcrm-text-foreground hover:imcrm-bg-accent"
                >
                    {logic === 'and' ? __('Y') : __('O')}
                    <ChevronDown className="imcrm-h-3 imcrm-w-3" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => onChange('and')}>
                    {__('Y (AND)')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onChange('or')}>
                    {__('O (OR)')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function resolveGroup(root: FilterTree, path: number[]): FilterGroup | null {
    let node: FilterGroup | null = root;
    for (const idx of path) {
        const child: FilterCondition | FilterGroup | undefined = node?.children[idx];
        if (!child || !isGroupNode(child)) return null;
        node = child;
    }
    return node;
}

function defaultOpFor(type: string): FilterOperator {
    switch (type) {
        case 'text':
        case 'long_text':
        case 'email':
        case 'url':
            return 'contains';
        case 'select':
        case 'multi_select':
        case 'checkbox':
        case 'user':
        case 'file':
            return 'eq';
        default:
            return 'eq';
    }
}

function isDateField(fields: FieldEntity[], fieldId: number): boolean {
    const f = fields.find((x) => x.id === fieldId);
    return f?.type === 'date' || f?.type === 'datetime';
}
