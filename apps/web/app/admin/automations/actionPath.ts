import type { ActionSpec } from '@/types/automation';

/**
 * Path para localizar una acción dentro del árbol recursivo de
 * `actions` (que puede contener `if_else` con sub-branches `then` y
 * `else`, anidados hasta MAX_IF_ELSE_DEPTH=4 niveles en backend).
 *
 * Ejemplos:
 *   [0]                   → action raíz índice 0
 *   [1, 'then', 0]        → primer action del then-branch del action 1
 *   [0, 'else', 2, 'then', 0]
 *                         → nested: then-branch del action 2 que vive
 *                           en el else-branch del action 0
 *
 * Por construcción siempre alterna `number` (índice en un array) con
 * `'then' | 'else'` (selector de branch).
 */
export type ActionPath = Array<number | 'then' | 'else'>;

/** Llave string estable para usar como key/id de DOM. */
export function pathKey(path: ActionPath): string {
    return path.length === 0 ? 'root' : path.join('.');
}

export function thenOf(action: ActionSpec): ActionSpec[] {
    return Array.isArray(action.config.then_actions)
        ? (action.config.then_actions as ActionSpec[])
        : [];
}

export function elseOf(action: ActionSpec): ActionSpec[] {
    return Array.isArray(action.config.else_actions)
        ? (action.config.else_actions as ActionSpec[])
        : [];
}

export function getActionAt(
    actions: ActionSpec[],
    path: ActionPath,
): ActionSpec | undefined {
    if (path.length === 0) return undefined;
    const [head, ...rest] = path;
    if (typeof head !== 'number') return undefined;
    const here = actions[head];
    if (!here) return undefined;
    if (rest.length === 0) return here;
    const [branch, ...rest2] = rest;
    if (branch !== 'then' && branch !== 'else') return undefined;
    const branchActions = branch === 'then' ? thenOf(here) : elseOf(here);
    return getActionAt(branchActions, rest2);
}

export function setActionAt(
    actions: ActionSpec[],
    path: ActionPath,
    value: ActionSpec,
): ActionSpec[] {
    if (path.length === 0) return actions;
    const [head, ...rest] = path;
    if (typeof head !== 'number') return actions;
    const next = [...actions];
    if (rest.length === 0) {
        next[head] = value;
        return next;
    }
    const [branch, ...rest2] = rest;
    if (branch !== 'then' && branch !== 'else') return actions;
    const here = next[head];
    if (!here) return actions;
    const branchKey = branch === 'then' ? 'then_actions' : 'else_actions';
    const branchActions = branch === 'then' ? thenOf(here) : elseOf(here);
    next[head] = {
        ...here,
        config: {
            ...here.config,
            [branchKey]: setActionAt(branchActions, rest2, value),
        },
    };
    return next;
}

export function removeActionAt(
    actions: ActionSpec[],
    path: ActionPath,
): ActionSpec[] {
    if (path.length === 0) return actions;
    const [head, ...rest] = path;
    if (typeof head !== 'number') return actions;
    if (rest.length === 0) {
        return actions.filter((_, i) => i !== head);
    }
    const [branch, ...rest2] = rest;
    if (branch !== 'then' && branch !== 'else') return actions;
    const here = actions[head];
    if (!here) return actions;
    const branchKey = branch === 'then' ? 'then_actions' : 'else_actions';
    const branchActions = branch === 'then' ? thenOf(here) : elseOf(here);
    const next = [...actions];
    next[head] = {
        ...here,
        config: {
            ...here.config,
            [branchKey]: removeActionAt(branchActions, rest2),
        },
    };
    return next;
}

/**
 * Inserta `value` en el slot apuntado por `path`. El path identifica
 * un "slot" entre acciones de una chain (igual shape que `ActionPath`):
 *   - `[i]`              → slot i del root (antes del action i; si
 *                            i === actions.length, al final).
 *   - `[i, 'then', j]`   → slot j del then-branch del action i.
 *   - `[i, 'else', j]`   → idem, else-branch.
 *
 * El visual builder emite estos slots como nodos `slot-*` (uno antes
 * de cada acción + uno al final de cada chain). Click en el slot abre
 * el type-picker; al elegir un tipo, llamamos a `insertActionAt` con
 * el path del slot.
 */
export function insertActionAt(
    actions: ActionSpec[],
    path: ActionPath,
    value: ActionSpec,
): ActionSpec[] {
    if (path.length === 0) {
        // Path vacío no es un slot válido — fallback: prepend.
        return [value, ...actions];
    }
    const [head, ...rest] = path;
    if (typeof head !== 'number') return actions;

    if (rest.length === 0) {
        // Insert at index `head` en la chain actual. Si head >=
        // actions.length, splice añade al final igualmente.
        const next = [...actions];
        next.splice(head, 0, value);
        return next;
    }

    const [branch, ...rest2] = rest;
    if (branch !== 'then' && branch !== 'else') return actions;
    const here = actions[head];
    if (!here) return actions;
    const branchKey = branch === 'then' ? 'then_actions' : 'else_actions';
    const branchActions = branch === 'then' ? thenOf(here) : elseOf(here);
    const next = [...actions];
    next[head] = {
        ...here,
        config: {
            ...here.config,
            [branchKey]: insertActionAt(branchActions, rest2, value),
        },
    };
    return next;
}

/**
 * Llave string estable para slots. Distinta de `pathKey` para evitar
 * colisiones con un nodo de acción que tenga ese mismo path.
 */
export function slotKey(path: ActionPath): string {
    return path.length === 0 ? 'slot-root' : 'slot-' + path.join('.');
}
