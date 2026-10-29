import { createContext, useContext } from 'react';
import {
    mirrorCellAccess,
    mirrorColumnKind,
    mirrorFieldMap,
    mirrorRecordGone,
    mirrorSourceName,
    readMirrorListMarker,
    type MirrorListMarker,
    type StoreCellAccess,
} from '@imagina-base/shared';

import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

/**
 * Reglas de una lista ESPEJO para la UI: sincronizada con una tienda
 * (v0.1.213) o con un sitio WordPress (v0.1.333, ADR-S83).
 *
 * Son las MISMAS funciones que usa el backend para rechazar una edición
 * (`@imagina-base/shared` → `mirror-list.ts`): la celda se bloquea y dice
 * por qué ANTES de que alguien intente un cambio que la fuente no aceptaría.
 * Lo proveen las páginas que muestran registros de una lista (tabla, ficha,
 * página del registro); fuera de una lista espejo el contexto es null y nada
 * cambia.
 */
export interface StoreRules {
    marker: MirrorListMarker;
    fields: FieldEntity[];
}

export const StoreRulesContext = createContext<StoreRules | null>(null);

export function useStoreRules(): StoreRules | null {
    return useContext(StoreRulesContext);
}

/** Las reglas de una lista a partir de sus ajustes (null = lista común). */
export function mirrorRulesOf(settings: unknown, fields: FieldEntity[] | undefined): StoreRules | null {
    const marker = readMirrorListMarker(settings);
    return marker && fields ? { marker, fields } : null;
}

/** «WooCommerce» o «WordPress» (o null fuera de una lista espejo). */
export function mirrorSourceOf(rules: StoreRules | null): string | null {
    return rules ? mirrorSourceName(rules.marker) : null;
}

/** Qué se puede hacer con esta celda, o null si la lista no es espejo. */
export function storeAccessFor(
    rules: StoreRules | null,
    field: FieldEntity,
    record: Pick<RecordEntity, 'fields'> | null | undefined,
): StoreCellAccess | null {
    if (!rules) return null;
    const bySlug = new Map(rules.fields.map((f) => [f.id, f.slug]));
    const map = mirrorFieldMap(rules.marker);
    const row = (key: string): unknown => {
        const id = map[key];
        const slug = id ? bySlug.get(id) : undefined;
        return slug && record ? record.fields[slug] : undefined;
    };
    return mirrorCellAccess(rules.marker, field.id, row);
}

export function useStoreAccess(
    field: FieldEntity,
    record: Pick<RecordEntity, 'fields'> | null | undefined,
): StoreCellAccess | null {
    return storeAccessFor(useStoreRules(), field, record);
}

/**
 * Cómo se presenta una COLUMNA de una lista espejo en su encabezado:
 *  - `store_locked`: viene de la tienda (o del sitio) y no se edita aquí;
 *  - `store_sync`: se puede editar (en las filas que corresponda) y viaja;
 *  - `own`: columna propia de la empresa, nunca viaja.
 */
export function storeColumnKind(rules: StoreRules | null, fieldId: number): 'store_locked' | 'store_sync' | 'own' | null {
    if (!rules) return null;
    const kind = mirrorColumnKind(rules.marker, fieldId);
    return kind === 'own' ? 'own' : kind === 'sync' ? 'store_sync' : 'store_locked';
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

/**
 * v0.1.336 — ¿La fuente (WordPress o la tienda) ya borró este registro? Sólo
 * así se puede QUITAR de la app (si sigue vivo allá, volvería solo). La misma
 * regla que aplica el servidor (`mirrorRecordGone`); aquí se mira la propia
 * fila (una línea de un pedido borrado se va cuando se quita el pedido).
 */
export function recordGoneInSource(rules: StoreRules | null, record: Pick<RecordEntity, 'fields'> | null | undefined): boolean {
    if (!rules || !record) return false;
    const bySlug = new Map(rules.fields.map((f) => [f.id, f.slug]));
    const map = mirrorFieldMap(rules.marker);
    const row = (key: string): unknown => {
        const id = map[key];
        const slug = id ? bySlug.get(id) : undefined;
        return slug ? record.fields[slug] : undefined;
    };
    return mirrorRecordGone(rules.marker, row);
}
