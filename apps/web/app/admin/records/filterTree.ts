import {
    EMPTY_FILTER_TREE,
    type FilterCondition,
    type FilterGroup,
    type FilterLogic,
    type FilterNode,
    type FilterOperator,
    type FilterTree,
} from '@/types/record';

import type { ActiveFilter } from './recordsState';

/**
 * Helpers inmutables para manipular el árbol de filtros. Cada
 * mutación devuelve un árbol nuevo — el estado de React no debe
 * verse mutado in-place.
 *
 * Path = array de índices que describe la posición del nodo dentro
 * del árbol. `[]` apunta al root; `[2]` a `root.children[2]`;
 * `[2, 1]` a `root.children[2].children[1]` (que debe ser un grupo).
 */
export type FilterPath = number[];

export function isConditionNode(node: FilterNode): node is FilterCondition {
    return node.type === 'condition';
}

export function isGroupNode(node: FilterNode): node is FilterGroup {
    return node.type === 'group';
}

export function makeCondition(field_id: number, op: FilterOperator, value: unknown): FilterCondition {
    return { type: 'condition', field_id, op, value };
}

export function makeGroup(logic: FilterLogic = 'and', children: FilterNode[] = []): FilterGroup {
    return { type: 'group', logic, children };
}

export function emptyTree(): FilterTree {
    return { ...EMPTY_FILTER_TREE, children: [] };
}

export function countConditions(node: FilterNode): number {
    if (node.type === 'condition') return 1;
    let n = 0;
    for (const c of node.children) n += countConditions(c);
    return n;
}

export function isEmptyTree(tree: FilterTree): boolean {
    return tree.children.length === 0;
}

/**
 * Devuelve el nodo en `path`, o null si la ruta no existe.
 */
export function getNode(tree: FilterTree, path: FilterPath): FilterNode | null {
    let node: FilterNode = tree;
    for (const idx of path) {
        if (!isGroupNode(node)) return null;
        const child: FilterNode | undefined = node.children[idx];
        if (child === undefined) return null;
        node = child;
    }
    return node;
}

/**
 * Aplica una transformación inmutable a un grupo en `path` y devuelve
 * el árbol nuevo. Si el path no apunta a un grupo, devuelve `tree` sin
 * cambios.
 */
function updateGroupAt(
    tree: FilterTree,
    path: FilterPath,
    updater: (group: FilterGroup) => FilterGroup,
): FilterTree {
    if (path.length === 0) {
        return updater(tree) as FilterTree;
    }
    const head = path[0]!;
    const rest = path.slice(1);
    const child = tree.children[head];
    if (!child || !isGroupNode(child)) return tree;
    const newChild = updateGroupAt(child as FilterTree, rest, updater);
    const nextChildren = [...tree.children];
    nextChildren[head] = newChild;
    return { ...tree, children: nextChildren };
}

/**
 * Añade una condición o un sub-grupo al final de los children del
 * grupo apuntado por `path`.
 */
export function addNode(tree: FilterTree, path: FilterPath, node: FilterNode): FilterTree {
    return updateGroupAt(tree, path, (group) => ({
        ...group,
        children: [...group.children, node],
    }));
}

/**
 * Reemplaza un nodo por uno nuevo. `path` debe terminar en el índice
 * del nodo dentro de su grupo padre.
 */
export function replaceNodeAt(
    tree: FilterTree,
    path: FilterPath,
    next: FilterNode,
): FilterTree {
    if (path.length === 0) {
        // Reemplazar la raíz solo aplica si el reemplazo es un grupo.
        if (isGroupNode(next)) return next as FilterTree;
        return tree;
    }
    const parentPath = path.slice(0, -1);
    const idx        = path[path.length - 1]!;
    return updateGroupAt(tree, parentPath, (group) => {
        const nextChildren = [...group.children];
        nextChildren[idx] = next;
        return { ...group, children: nextChildren };
    });
}

/**
 * Quita el nodo apuntado por `path`. Si era el último hijo de un
 * grupo no-raíz, también se quita ese grupo (limpieza recursiva).
 */
export function removeNodeAt(tree: FilterTree, path: FilterPath): FilterTree {
    if (path.length === 0) {
        return emptyTree();
    }
    const parentPath = path.slice(0, -1);
    const idx        = path[path.length - 1]!;
    return updateGroupAt(tree, parentPath, (group) => ({
        ...group,
        children: group.children.filter((_, i) => i !== idx),
    }));
}

export function setGroupLogic(
    tree: FilterTree,
    path: FilterPath,
    logic: FilterLogic,
): FilterTree {
    return updateGroupAt(tree, path, (group) => ({ ...group, logic }));
}

/**
 * Conversión legacy: `ActiveFilter[]` (forma plana del state viejo)
 * → árbol con un grupo AND raíz.
 */
export function treeFromActiveFilters(filters: ActiveFilter[]): FilterTree {
    return {
        type: 'group',
        logic: 'and',
        children: filters.map((f) => ({
            type: 'condition',
            field_id: f.field_id,
            op: f.op,
            value: f.value,
        })),
    };
}

/**
 * Inverso: extrae las condiciones del árbol "como si fuera plano AND"
 * (ignorando logic y subgroups). Útil para callers que aún razonan
 * en `ActiveFilter[]` (ej. el `/records/groups` actual o algunos
 * widgets sin UI de árbol).
 */
export function flattenToActiveFilters(node: FilterNode): ActiveFilter[] {
    if (isConditionNode(node)) {
        return [{ field_id: node.field_id, op: node.op, value: node.value }];
    }
    const out: ActiveFilter[] = [];
    for (const c of node.children) {
        for (const f of flattenToActiveFilters(c)) out.push(f);
    }
    return out;
}

/**
 * Detecta si el árbol es un AND plano sin subgrupos. Útil para
 * decidir si usar el atajo legacy `filter[...]` o el JSON
 * `filter_tree` en la query string.
 */
export function isFlatAndTree(tree: FilterTree): boolean {
    if (tree.logic !== 'and') return false;
    for (const c of tree.children) {
        if (c.type !== 'condition') return false;
    }
    return true;
}
