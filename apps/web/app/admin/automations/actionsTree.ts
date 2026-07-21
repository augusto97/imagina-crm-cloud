import type { ActionSpec } from '@/types/automation';

/**
 * Helpers para navegar y mutar (inmutablemente) el ÁRBOL de acciones de
 * una automatización. El array raíz es una secuencia; una acción
 * `if_else` contiene dos sub-secuencias (`config.then_actions` /
 * `config.else_actions`) que pueden anidar más `if_else` (el backend
 * limita a 4 niveles).
 *
 * Direccionamiento:
 *  - `SeqPath` apunta a una SECUENCIA: `[]` = raíz; `[2, 'then']` =
 *    la rama Sí del if_else en la posición 2 de la raíz; se encadena
 *    (`[2, 'then', 0, 'else']`…).
 *  - `NodePath` apunta a un NODO: una SeqPath + el índice final,
 *    p. ej. `[2, 'then', 0]`.
 */
export type BranchKey = 'then' | 'else';
export type SeqPath = Array<number | BranchKey>;
export type NodePath = Array<number | BranchKey>;

function branchConfigKey(branch: BranchKey): 'then_actions' | 'else_actions' {
    return branch === 'then' ? 'then_actions' : 'else_actions';
}

export function branchOf(spec: ActionSpec, branch: BranchKey): ActionSpec[] {
    const raw = spec.config[branchConfigKey(branch)];
    return Array.isArray(raw) ? (raw as ActionSpec[]) : [];
}

/** Aplica `fn` a la secuencia direccionada por `seqPath` (inmutable). */
function mapSequence(
    actions: ActionSpec[],
    seqPath: SeqPath,
    fn: (seq: ActionSpec[]) => ActionSpec[],
): ActionSpec[] {
    if (seqPath.length === 0) {
        return fn(actions);
    }
    const idx = seqPath[0];
    const branch = seqPath[1];
    if (typeof idx !== 'number' || (branch !== 'then' && branch !== 'else')) {
        return actions;
    }
    const node = actions[idx];
    if (!node) return actions;
    const key = branchConfigKey(branch);
    const child = branchOf(node, branch);
    const nextChild = mapSequence(child, seqPath.slice(2), fn);
    const out = [...actions];
    out[idx] = { ...node, config: { ...node.config, [key]: nextChild } };
    return out;
}

export function getNode(actions: ActionSpec[], path: NodePath): ActionSpec | undefined {
    if (path.length === 0) return undefined;
    let seq = actions;
    for (let i = 0; i < path.length; i += 2) {
        const idx = path[i];
        if (typeof idx !== 'number') return undefined;
        const node = seq[idx];
        if (!node) return undefined;
        if (i === path.length - 1) return node;
        const branch = path[i + 1];
        if (branch !== 'then' && branch !== 'else') return undefined;
        seq = branchOf(node, branch);
    }
    return undefined;
}

export function updateNode(
    actions: ActionSpec[],
    path: NodePath,
    next: ActionSpec,
): ActionSpec[] {
    const idx = path[path.length - 1];
    if (typeof idx !== 'number') return actions;
    return mapSequence(actions, path.slice(0, -1), (seq) => {
        if (!seq[idx]) return seq;
        const out = [...seq];
        out[idx] = next;
        return out;
    });
}

export function insertAt(
    actions: ActionSpec[],
    seqPath: SeqPath,
    index: number,
    spec: ActionSpec,
): ActionSpec[] {
    return mapSequence(actions, seqPath, (seq) => {
        const out = [...seq];
        out.splice(Math.max(0, Math.min(index, out.length)), 0, spec);
        return out;
    });
}

export function removeAt(actions: ActionSpec[], path: NodePath): ActionSpec[] {
    const idx = path[path.length - 1];
    if (typeof idx !== 'number') return actions;
    return mapSequence(actions, path.slice(0, -1), (seq) =>
        seq.filter((_, i) => i !== idx),
    );
}

export function duplicateAt(actions: ActionSpec[], path: NodePath): ActionSpec[] {
    const idx = path[path.length - 1];
    if (typeof idx !== 'number') return actions;
    return mapSequence(actions, path.slice(0, -1), (seq) => {
        const src = seq[idx];
        if (!src) return seq;
        const clone = JSON.parse(JSON.stringify(src)) as ActionSpec;
        const out = [...seq];
        out.splice(idx + 1, 0, clone);
        return out;
    });
}

export function pathKey(path: SeqPath | NodePath): string {
    return path.join('.');
}

/** Profundidad de if_else de una seqPath (para el límite de anidado). */
export function ifElseDepth(seqPath: SeqPath): number {
    return seqPath.filter((s) => s === 'then' || s === 'else').length;
}
