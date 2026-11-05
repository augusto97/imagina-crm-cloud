import { createContext, useContext, useMemo } from 'react';
import { managedFieldLocks, type ManagedFieldLock } from '@imagina-base/shared';

import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

/**
 * v0.1.383 — Columnas que escribe una sincronización y nadie edita a mano: el
 * SLA de la mesa de ayuda (E5), los cobros (links de pago), las suscripciones
 * con débito automático, lo que trae la importación de Mercado Pago y el
 * registro de cobros. El backend las rechaza con la MISMA regla
 * (`managedFieldLocks` en shared); este contexto lo dice ANTES, con el candado
 * y el motivo en la celda, la ficha y el kanban. Lo proveen las páginas de
 * registros de una lista; fuera de ellas es null y nada cambia.
 */
export type ManagedLocks = ReadonlyMap<number, ManagedFieldLock>;

export const ManagedFieldsContext = createContext<ManagedLocks | null>(null);

/** Las columnas protegidas de la lista (null si no tiene ninguna). */
export function useManagedFieldLocks(listSettings: unknown): ManagedLocks | null {
    const locks = managedFieldLocks(listSettings);
    const key = locks.map((l) => `${l.field_id}:${l.source}:${l.reason}`).join('|');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => (locks.length > 0 ? new Map(locks.map((l) => [l.field_id, l])) : null), [key]);
}

export function useManagedFields(): ManagedLocks | null {
    return useContext(ManagedFieldsContext);
}

/** El motivo del candado de una celda protegida, o null. */
export function useManagedLock(fieldId: number): string | null {
    const locks = useContext(ManagedFieldsContext);
    const lock = locks?.get(fieldId);
    return lock ? __(lock.reason) : null;
}

/** El motivo del candado de una columna (o null). */
export function managedReason(locks: ManagedLocks | null, fieldId: number): string | null {
    const lock = locks?.get(fieldId);
    return lock ? __(lock.reason) : null;
}

/** slug → motivo de las columnas protegidas (para sumarlas a los candados de un formulario). */
export function managedLockedReasons(locks: ManagedLocks | null, fields: FieldEntity[]): Record<string, string> {
    const out: Record<string, string> = {};
    if (!locks) return out;
    for (const f of fields) {
        const lock = locks.get(f.id);
        if (lock) out[f.slug] = __(lock.reason);
    }
    return out;
}
