import type { QueryClient } from '@tanstack/react-query';
import type { PublicDashboardBundle } from '@imagina-base/shared';

import { fieldsKeys } from '@/hooks/useFields';
import { listsKeys } from '@/hooks/useLists';
import { disableTeamsApi } from '@/hooks/useTeams';

/**
 * v0.1.292 (ADR-S50) — Piezas puras de la página pública de un tablero.
 */

/** El token de `/api/v1/public/d/<token>` (o `null` si la dirección no es esa). */
export function tokenFromPath(pathname: string): string | null {
    const m = /\/public\/d\/([A-Za-z0-9_-]{16,64})\/?$/.exec(pathname);
    return m ? m[1]! : null;
}

/** `?theme=dark|light` manda; si no, el del sistema. */
export function publicThemeFromQuery(search: string, prefersDark: boolean): 'light' | 'dark' {
    const t = new URLSearchParams(search).get('theme');
    if (t === 'dark' || t === 'light') return t;
    return prefersDark ? 'dark' : 'light';
}

/** Período inicial: `?period=` de la dirección (sólo si quien publicó lo permite). */
export function periodFromQuery(search: string): string {
    const p = new URLSearchParams(search).get('period');
    return p && /^[a-z0-9_:-]{1,64}$/i.test(p) ? p : '';
}

/**
 * Siembra en el cache lo que los widgets leen de la API del equipo (campos y
 * listas): la página no tiene sesión, así que esas definiciones llegan en el
 * paquete del enlace y NO se piden (mismo truco que el portal del cliente).
 */
export function seedPublicCaches(qc: QueryClient, bundle: PublicDashboardBundle): void {
    // C1 — los equipos no viajan en el paquete: sin sesión no se piden.
    disableTeamsApi();
    qc.setQueryDefaults(fieldsKeys.all, { staleTime: Infinity, retry: false, enabled: false });
    qc.setQueryDefaults(listsKeys.all, { staleTime: Infinity, retry: false, enabled: false });
    for (const [listId, fields] of Object.entries(bundle.fields)) qc.setQueryData(fieldsKeys.forList(listId), fields);
    qc.setQueryData(listsKeys.list(), bundle.lists);
}
