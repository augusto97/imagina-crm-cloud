import type { QueryClient } from '@tanstack/react-query';

import { listsKeys } from '@/hooks/useLists';
import type { ListSummary } from '@/types/list';

/**
 * v0.1.436 — Regla de oro nº 7, medida en vivo: ninguna clave de caché de
 * TanStack lleva el SLUG de una lista; el id numérico es el único
 * identificador. Una lista guardada dos veces (bajo su slug y bajo su id) se
 * pide dos veces y, peor, una mutación que refresca una de las dos deja la
 * otra vieja (la clase de bug de v0.1.81, v0.1.83, v0.1.85 y v0.1.105).
 *
 * Las pruebas de pantallas del CI (`scripts/e2e/smoke.mjs`) recorren la app y
 * piden la lista de claves que rompen la regla: tiene que estar vacía. En la
 * app de todos los días esto no hace nada: sólo se instala con
 * `localStorage['imcrm:e2e'] = '1'`.
 */

/** El índice de listas resuelve slug → lista: es el único que puede llevarlo. */
const ALLOWED_NAMESPACES = new Set(['lists']);

export function slugKeyViolations(qc: QueryClient): string[] {
    const all = qc.getQueryData<ListSummary[]>(listsKeys.list());
    if (!Array.isArray(all)) return [];
    const slugs = new Set(all.map((l) => l.slug).filter((s) => typeof s === 'string' && !/^\d+$/.test(s)));
    if (slugs.size === 0) return [];
    const out: string[] = [];
    for (const q of qc.getQueryCache().getAll()) {
        const key = q.queryKey;
        if (!Array.isArray(key) || key.length < 2) continue;
        if (ALLOWED_NAMESPACES.has(String(key[0]))) continue;
        if (key.slice(1).some((seg) => typeof seg === 'string' && slugs.has(seg))) out.push(JSON.stringify(key));
    }
    return out;
}

export function installQueryKeyAudit(qc: QueryClient): void {
    try {
        if (typeof window === 'undefined' || window.localStorage.getItem('imcrm:e2e') !== '1') return;
        (window as unknown as { __imcrmQueryKeyAudit?: () => string[] }).__imcrmQueryKeyAudit = () => slugKeyViolations(qc);
    } catch {
        /* sin localStorage: nada */
    }
}
