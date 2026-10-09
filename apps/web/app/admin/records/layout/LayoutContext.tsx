import { createContext, useContext } from 'react';

import type { PortalBootData } from '@/portal/types';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';
import type { RecordEntity } from '@/types/record';

import type { ResolvedTheme } from './layoutTheme';

/**
 * v0.1.230 — Lo que comparten todos los bloques de la ficha: el registro,
 * sus campos, los valores vivos (autoguardado), el tema y los datos
 * calculados por el servidor. Evita pasar diez props a cada bloque.
 */
export interface LayoutCtx {
    list: ListSummary;
    record: RecordEntity;
    fields: FieldEntity[];
    fieldsById: Map<number, FieldEntity>;
    values: Record<string, unknown>;
    setValue: (slug: string, value: unknown) => void;
    errors: Record<string, string>;
    lockedReasons: Record<string, string | null>;
    canEdit: boolean;
    theme: ResolvedTheme;
    currentUserId: number;
    isAdmin: boolean;
    data: Record<string, unknown> | undefined;
    dataLoading: boolean;
    /** Modo vista previa del editor: sin guardar ni navegar. */
    preview?: boolean;
    /**
     * v0.1.233 — dónde se dibuja: la ficha del equipo (default) o el portal
     * del cliente (sin enlaces al admin; edita sólo lo marcado editable).
     */
    mode?: 'record' | 'portal';
    /** Reemplaza la regla de edición por campo (el portal usa sus editables). */
    canEditField?: (field: FieldEntity) => boolean;
    /** Portal: lo que necesitan comentarios y actividad para hablar con /portal/*. */
    portalBoot?: PortalBootData;
    /** Portal: de qué lista lee cada bloque de datos (lo dice el servidor). */
    blockLists?: Record<string, number>;
}

export const LayoutContext = createContext<LayoutCtx | null>(null);

export function useLayoutCtx(): LayoutCtx {
    const ctx = useContext(LayoutContext);
    if (!ctx) throw new Error('useLayoutCtx fuera de la ficha');
    return ctx;
}

const DERIVED: ReadonlySet<string> = new Set(['computed', 'lookup', 'rollup']);

/** ¿Este campo se puede editar aquí? Una sola regla para todos los bloques. */
export function fieldEditable(ctx: LayoutCtx, field: FieldEntity): boolean {
    if (ctx.preview) return false;
    if (ctx.canEditField) return ctx.canEditField(field);
    return ctx.canEdit && (ctx.lockedReasons[field.slug] ?? null) === null && !DERIVED.has(field.type);
}
