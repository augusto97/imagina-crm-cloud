import { createContext, useContext } from 'react';

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
}

export const LayoutContext = createContext<LayoutCtx | null>(null);

export function useLayoutCtx(): LayoutCtx {
    const ctx = useContext(LayoutContext);
    if (!ctx) throw new Error('useLayoutCtx fuera de la ficha');
    return ctx;
}
