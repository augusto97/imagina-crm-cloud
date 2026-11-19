import { createContext, useContext, useMemo } from 'react';

import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';

/**
 * v0.1.457 (C4) — Campos que quien mira VE pero no puede cambiar en esta
 * lista (por su rol, rol propio, equipo o acceso personal). El servidor los
 * rechaza con la MISMA regla (`readonlyFieldIdsOf` en shared, 403
 * `field_readonly`); esto lo dice ANTES, con el candado y el motivo en la
 * celda, la ficha, el kanban y el alta. La lista trae la lista ya resuelta
 * para quien pregunta (`my_access.readonly_field_ids`): los ajustes de
 * permisos no le llegan a quien no administra la lista.
 */
export const READONLY_FIELD_REASON = 'Puedes ver este campo, pero tu acceso a esta lista no te deja cambiarlo.';

export type ReadonlyFieldIds = ReadonlySet<number>;

export const FieldAccessContext = createContext<ReadonlyFieldIds | null>(null);

/** Los campos de sólo lectura de la lista para quien mira (null si ninguno). */
export function useReadonlyFieldIdsOf(list: Pick<ListSummary, 'my_access'> | null | undefined): ReadonlyFieldIds | null {
    const ids = list?.my_access?.readonly_field_ids ?? [];
    const key = ids.join(',');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => (ids.length > 0 ? new Set(ids) : null), [key]);
}

export function useReadonlyFieldIds(): ReadonlyFieldIds | null {
    return useContext(FieldAccessContext);
}

/** El motivo del candado de una celda de sólo lectura, o null. */
export function useReadonlyLock(fieldId: number): string | null {
    const ids = useContext(FieldAccessContext);
    return ids?.has(fieldId) ? __(READONLY_FIELD_REASON) : null;
}

export function readonlyReason(ids: ReadonlyFieldIds | null, fieldId: number): string | null {
    return ids?.has(fieldId) ? __(READONLY_FIELD_REASON) : null;
}

/** slug → motivo de los campos de sólo lectura (para sumarlos a los candados de un formulario). */
export function readonlyLockedReasons(ids: ReadonlyFieldIds | null, fields: readonly FieldEntity[]): Record<string, string> {
    const out: Record<string, string> = {};
    if (!ids || ids.size === 0) return out;
    for (const f of fields) if (ids.has(f.id)) out[f.slug] = __(READONLY_FIELD_REASON);
    return out;
}

/**
 * El alta no manda lo que quien crea sólo puede ver: vale el valor por
 * defecto del campo (lo pone el servidor). Se sacan del borrador antes de
 * enviarlo.
 */
export function withoutReadonlyValues(
    ids: ReadonlyFieldIds | null,
    fields: readonly FieldEntity[],
    valuesBySlug: Record<string, unknown>,
): Record<string, unknown> {
    if (!ids || ids.size === 0) return valuesBySlug;
    const out = { ...valuesBySlug };
    for (const f of fields) if (ids.has(f.id)) delete out[f.slug];
    return out;
}
