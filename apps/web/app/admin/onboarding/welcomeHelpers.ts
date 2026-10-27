import type { ListTemplateSummary } from '@imagina-base/shared';

/**
 * Los nombres que van a tener las listas: el mismo criterio de
 * `combineBlueprints` (un nombre repetido lleva el de su plantilla).
 */
export function combinedListNames(chosen: readonly ListTemplateSummary[]): string[] {
    const used = new Set<string>();
    const out: string[] = [];
    for (const t of chosen) {
        for (const l of t.lists) {
            const norm = l.name.trim().toLowerCase();
            const name = used.has(norm) ? `${l.name} · ${t.name}` : l.name;
            used.add(name.trim().toLowerCase());
            out.push(name);
        }
    }
    return out;
}
