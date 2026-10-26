import { createContext, useContext, useMemo } from 'react';
import { HELPDESK_MANAGED_REASON, helpdeskManagedFieldIds } from '@imagina-base/shared';

import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

/**
 * E5 — Las columnas que mantiene el SLA (vence la primera respuesta, vence la
 * resolución, estado del SLA) no se editan a mano: el backend las rechaza con
 * la MISMA lista (`helpdeskManagedFieldIds`). Este contexto lo dice ANTES, con
 * el candado y el motivo en la celda y en la ficha. Lo proveen las páginas de
 * registros de una lista; fuera de ellas es null y nada cambia.
 */
export const HelpdeskManagedContext = createContext<ReadonlySet<number> | null>(null);

/** Las columnas del SLA de la lista (vacío si la lista no tiene SLA). */
export function useHelpdeskManagedIds(listSettings: unknown): ReadonlySet<number> | null {
    const ids = helpdeskManagedFieldIds(listSettings);
    const key = ids.join(',');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => (ids.length > 0 ? new Set(ids) : null), [key]);
}

/** El motivo del candado de una celda manejada por el SLA, o null. */
export function useHelpdeskLock(fieldId: number): string | null {
    const managed = useContext(HelpdeskManagedContext);
    return managed?.has(fieldId) ? __(HELPDESK_MANAGED_REASON) : null;
}

/** slug → motivo de los campos del SLA (para sumarlos a los candados de un formulario). */
export function helpdeskLockedReasons(managed: ReadonlySet<number> | null, fields: FieldEntity[]): Record<string, string> {
    const out: Record<string, string> = {};
    if (!managed) return out;
    for (const f of fields) if (managed.has(f.id)) out[f.slug] = __(HELPDESK_MANAGED_REASON);
    return out;
}

export function useHelpdeskManaged(): ReadonlySet<number> | null {
    return useContext(HelpdeskManagedContext);
}
