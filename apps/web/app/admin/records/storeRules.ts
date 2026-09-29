import { createContext, useContext } from 'react';
import {
    isStoreField,
    STORE_EDITABLE_SLUGS,
    storeCellAccess,
    storeFieldSlug,
    type StoreCellAccess,
    type StoreListMarker,
} from '@imagina-base/shared';

import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

/**
 * Reglas de una lista sincronizada con una tienda (v0.1.213), para la UI.
 *
 * Son las MISMAS funciones que usa el backend para rechazar una edición
 * (`@imagina-base/shared` → `store-rules.ts`): la celda se bloquea y dice
 * por qué ANTES de que alguien intente un cambio que la tienda no aceptaría.
 * Lo proveen las páginas que muestran registros de una lista (tabla, ficha,
 * página del registro); fuera de una lista de tienda el contexto es null y
 * nada cambia.
 */
export interface StoreRules {
    marker: StoreListMarker;
    fields: FieldEntity[];
}

export const StoreRulesContext = createContext<StoreRules | null>(null);

export function useStoreRules(): StoreRules | null {
    return useContext(StoreRulesContext);
}

/** Qué se puede hacer con esta celda, o null si la lista no es de una tienda. */
export function storeAccessFor(
    rules: StoreRules | null,
    field: FieldEntity,
    record: Pick<RecordEntity, 'fields'> | null | undefined,
): StoreCellAccess | null {
    if (!rules) return null;
    const bySlug = new Map(rules.fields.map((f) => [f.id, f.slug]));
    const row = (packSlug: string): unknown => {
        const id = rules.marker.fields[packSlug];
        const slug = id ? bySlug.get(id) : undefined;
        return slug && record ? record.fields[slug] : undefined;
    };
    return storeCellAccess(rules.marker, field.id, row);
}

export function useStoreAccess(
    field: FieldEntity,
    record: Pick<RecordEntity, 'fields'> | null | undefined,
): StoreCellAccess | null {
    return storeAccessFor(useStoreRules(), field, record);
}

/**
 * Cómo se presenta una COLUMNA de una lista de tienda en su encabezado:
 *  - `store_locked`: viene de la tienda y no se edita acá;
 *  - `store_sync`: se puede editar (en las filas que corresponda) y viaja a la tienda;
 *  - `own`: columna propia de la empresa, nunca viaja.
 */
export function storeColumnKind(rules: StoreRules | null, fieldId: number): 'store_locked' | 'store_sync' | 'own' | null {
    if (!rules) return null;
    if (!isStoreField(rules.marker, fieldId)) return 'own';
    const slug = storeFieldSlug(rules.marker, fieldId);
    const editable = rules.marker.write_back && slug !== null && STORE_EDITABLE_SLUGS[rules.marker.role].includes(slug);
    return editable ? 'store_sync' : 'store_locked';
}

/** slug → motivo, de los campos que NO se pueden cambiar en esta fila (formularios). */
export function lockedReasonsFor(
    rules: StoreRules | null,
    fields: FieldEntity[],
    values: Record<string, unknown>,
): Record<string, string> {
    const out: Record<string, string> = {};
    if (!rules) return out;
    for (const f of fields) {
        const access = storeAccessFor(rules, f, { fields: values });
        if (access?.access === 'locked') out[f.slug] = access.reason;
    }
    return out;
}
