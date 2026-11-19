import { caseBranchIndex, flowChildLists, isFlowBranch, type FlowBranch } from '@imagina-base/shared';
import type { ActionSpec } from '@/types/automation';

/**
 * Helpers para navegar y mutar (inmutablemente) el ÁRBOL de acciones de
 * una automatización. El array raíz es una secuencia; un paso puede tener
 * sub-secuencias («ramas»):
 *  - `if_else`: `then` / `else` (`config.then_actions` / `config.else_actions`);
 *  - `for_each_linked` (v0.1.288): `each` (`config.actions`), lo que se
 *    repite por cada registro vinculado;
 *  - v0.1.460 — `switch` («Según el valor de…»): `case0`, `case1`… (una por
 *    rama, `config.cases[N].actions`) y `default` («En otro caso»,
 *    `config.default_actions`);
 *  - v0.1.460 — CUALQUIER paso: `fail`, los pasos de «Si este paso falla»
 *    (`on_error.actions`).
 * El backend limita el anidado a 4 niveles.
 *
 * Direccionamiento:
 *  - `SeqPath` apunta a una SECUENCIA: `[]` = raíz; `[2, 'then']` =
 *    la rama Sí del si/sino en la posición 2 de la raíz; se encadena
 *    (`[2, 'then', 0, 'case1']`…).
 *  - `NodePath` apunta a un NODO: una SeqPath + el índice final,
 *    p. ej. `[2, 'then', 0]`.
 */
export type BranchKey = FlowBranch;
export type SeqPath = Array<number | BranchKey>;
export type NodePath = Array<number | BranchKey>;

function isBranch(v: unknown): v is BranchKey {
    return isFlowBranch(v);
}

export function branchOf(spec: ActionSpec, branch: BranchKey): ActionSpec[] {
    const kid = flowChildLists(spec).find((k) => k.branch === branch);
    return kid ? (kid.actions as ActionSpec[]) : [];
}

/** Una copia del paso con la rama `branch` reemplazada por `next` (la crea si no estaba). */
export function withBranch(spec: ActionSpec, branch: BranchKey, next: ActionSpec[]): ActionSpec {
    if (branch === 'fail') return { ...spec, on_error: { ...(spec.on_error ?? {}), actions: next } };
    if (branch === 'then') return { ...spec, config: { ...spec.config, then_actions: next } };
    if (branch === 'else') return { ...spec, config: { ...spec.config, else_actions: next } };
    if (branch === 'each') return { ...spec, config: { ...spec.config, actions: next } };
    if (branch === 'default') return { ...spec, config: { ...spec.config, default_actions: next } };
    const i = caseBranchIndex(branch);
    if (i === null) return spec;
    const cases = Array.isArray(spec.config.cases) ? [...(spec.config.cases as Array<Record<string, unknown>>)] : [];
    if (!cases[i]) return spec;
    cases[i] = { ...cases[i], actions: next };
    return { ...spec, config: { ...spec.config, cases } };
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
    const child = branchOf(node, branch);
    const nextChild = mapSequence(child, seqPath.slice(2), fn);
    const out = [...actions];
    out[idx] = withBranch(node, branch, nextChild);
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

/** v0.1.460 — ¿La secuencia son los pasos de «Si este paso falla» (de algún paso)? */
export function insideFail(seqPath: SeqPath): boolean {
    return seqPath.includes('fail');
}

/** Un paso del árbol con su ruta. */
export interface StepAt {
    spec: ActionSpec;
    path: NodePath;
}

/** Todos los nodos de una secuencia, ramas, bucles y «Si falla» incluidos (en orden). */
function flatten(seq: ActionSpec[], seqPath: SeqPath): StepAt[] {
    const out: StepAt[] = [];
    seq.forEach((node, i) => {
        const path: NodePath = [...seqPath, i];
        out.push({ spec: node, path });
        for (const kid of flowChildLists(node)) out.push(...flatten(kid.actions as ActionSpec[], [...path, kid.branch]));
    });
    return out;
}

/**
 * Los pasos que corren ANTES de `path` (en orden de ejecución): los
 * anteriores de cada secuencia que lo contiene, recorriendo hacia arriba.
 * Sirve para ofrecer las respuestas de webhooks previos como variables.
 * Incluye las ramas de un si/sino previo: pueden haber corrido (si no
 * corrieron, la variable queda vacía). Dentro de «Si falla», el paso que
 * falló también cuenta (pudo dejar algo antes de fallar).
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
        if (branch === 'fail') out.push({ spec: node, path: [...seqPath, idx] });
        seqPath = [...seqPath, idx, branch];
        seq = branchOf(node, branch);
    }
    return out;
}
