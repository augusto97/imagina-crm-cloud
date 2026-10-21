import type { ActionSpec } from '@/types/automation';

/**
 * Helpers para navegar y mutar (inmutablemente) el ÁRBOL de acciones de
 * una automatización. El array raíz es una secuencia; una acción
 * `if_else` contiene dos sub-secuencias (`config.then_actions` /
 * `config.else_actions`) que pueden anidar más `if_else` (el backend
 * limita a 4 niveles). v0.1.289: una acción `for_each_linked` contiene UNA
 * sub-secuencia (`config.actions`, rama `'each'`): lo que se repite por cada
 * registro vinculado.
 *
 * Direccionamiento:
 *  - `SeqPath` apunta a una SECUENCIA: `[]` = raíz; `[2, 'then']` =
 *    la rama Sí del if_else en la posición 2 de la raíz; se encadena
 *    (`[2, 'then', 0, 'else']`…).
 *  - `NodePath` apunta a un NODO: una SeqPath + el índice final,
 *    p. ej. `[2, 'then', 0]`.
 */
export type BranchKey = 'then' | 'else' | 'each';
export type SeqPath = Array<number | BranchKey>;
export type NodePath = Array<number | BranchKey>;

function isBranch(v: unknown): v is BranchKey {
    return v === 'then' || v === 'else' || v === 'each';
}

function branchConfigKey(branch: BranchKey): 'then_actions' | 'else_actions' | 'actions' {
    if (branch === 'each') return 'actions';
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
    if (typeof idx !== 'number' || !isBranch(branch)) {
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
        if (!isBranch(branch)) return undefined;
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

/** Profundidad de anidado de una seqPath (para el límite de 4 niveles). */
export function ifElseDepth(seqPath: SeqPath): number {
    return seqPath.filter((s) => isBranch(s)).length;
}

/** ¿La secuencia está DENTRO de un «Repetir por cada registro vinculado»? */
export function insideLoop(seqPath: SeqPath): boolean {
    return seqPath.includes('each');
}

/** Un paso del árbol con su ruta. */
export interface StepAt {
    spec: ActionSpec;
    path: NodePath;
}

/** Todos los nodos de una secuencia, ramas y bucles incluidos (en orden). */
function flatten(seq: ActionSpec[], seqPath: SeqPath): StepAt[] {
    const out: StepAt[] = [];
    seq.forEach((node, i) => {
        const path: NodePath = [...seqPath, i];
        out.push({ spec: node, path });
        if (node.type === 'if_else') {
            out.push(...flatten(branchOf(node, 'then'), [...path, 'then']), ...flatten(branchOf(node, 'else'), [...path, 'else']));
        }
        if (node.type === 'for_each_linked') out.push(...flatten(branchOf(node, 'each'), [...path, 'each']));
    });
    return out;
}

/**
 * Los pasos que corren ANTES de `path` (en orden de ejecución): los
 * anteriores de cada secuencia que lo contiene, recorriendo hacia arriba.
 * Sirve para ofrecer las respuestas de webhooks previos como variables.
 * Incluye las ramas de un si/sino previo: pueden haber corrido (si no
 * corrieron, la variable queda vacía).
 */
export function stepsBefore(actions: ActionSpec[], path: NodePath): StepAt[] {
    const out: StepAt[] = [];
    let seq = actions;
    let seqPath: SeqPath = [];
    for (let i = 0; i < path.length; i += 2) {
        const idx = path[i];
        if (typeof idx !== 'number') break;
        out.push(...flatten(seq.slice(0, Math.max(0, idx)), seqPath));
        const node = seq[idx];
        const branch = path[i + 1];
        if (!node || !isBranch(branch)) break;
        seqPath = [...seqPath, idx, branch];
        seq = branchOf(node, branch);
    }
    return out;
}
