import { z } from 'zod';

/**
 * Papelera — todo lo que se borra (registros, listas, campos, vistas,
 * automatizaciones y tableros) queda recuperable durante un plazo y después
 * se vacía sola.
 *
 * Mientras algo está en la papelera, para el resto de la app es como si se
 * hubiera borrado de verdad: no aparece en ningún listado, no corre, no se
 * puede abrir por su enlace. Restaurarlo lo deja como estaba (una lista
 * vuelve con sus registros, campos, vistas y automatizaciones; un registro
 * con sus subtareas, vínculos, archivos y comentarios).
 */

/** Días que algo queda en la papelera antes de borrarse para siempre. */
export const TRASH_RETENTION_DAYS_DEFAULT = 30;

export const TRASH_ITEM_TYPES = ['record', 'list', 'field', 'view', 'automation', 'dashboard'] as const;
export const trashItemTypeSchema = z.enum(TRASH_ITEM_TYPES);
export type TrashItemType = z.infer<typeof trashItemTypeSchema>;

export const TRASH_TYPE_LABELS: Record<TrashItemType, string> = {
    record: 'Registro',
    list: 'Lista',
    field: 'Campo',
    view: 'Vista',
    automation: 'Automatización',
    dashboard: 'Tablero',
};

/** Plural, para los filtros y los contadores. */
export const TRASH_TYPE_PLURALS: Record<TrashItemType, string> = {
    record: 'Registros',
    list: 'Listas',
    field: 'Campos',
    view: 'Vistas',
    automation: 'Automatizaciones',
    dashboard: 'Tableros',
};

export interface TrashItem {
    type: TrashItemType;
    id: number;
    /** Nombre al momento de mostrarlo (título del registro, nombre de la lista…). */
    name: string;
    /** Lista a la que pertenece (null en listas y tableros). */
    list_id: number | null;
    list_name: string | null;
    list_slug: string | null;
    /**
     * Para reconocerlo: el tipo del campo (`text`, `select`…), de la vista
     * (`table`, `kanban`…) o el disparador de la automatización. La UI pone
     * el nombre en lenguaje claro.
     */
    subtype: string | null;
    /** Cuántos registros se llevó una lista / cuántas subtareas un registro. */
    children: number | null;
    deleted_at: string;
    deleted_by: number | null;
    deleted_by_name: string | null;
    /** Cuándo se borra para siempre (deleted_at + plazo). */
    purge_at: string;
    /** Quien lo borró y los admin pueden restaurarlo y borrarlo para siempre. */
    can_restore: boolean;
}

export const listTrashQuerySchema = z.object({
    type: trashItemTypeSchema.optional(),
    q: z.string().trim().max(120).optional(),
    list_id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListTrashQuery = z.infer<typeof listTrashQuerySchema>;

export interface TrashPageMeta {
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
    retention_days: number;
    /** Cuántos hay de cada tipo (con el buscador y la lista aplicados). */
    counts: Record<TrashItemType, number>;
    /** Sólo un admin puede vaciar la papelera entera. */
    can_empty: boolean;
}

export const trashTargetSchema = z.object({
    type: trashItemTypeSchema,
    id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type TrashTarget = z.infer<typeof trashTargetSchema>;

export interface TrashRestoreResult {
    type: TrashItemType;
    id: number;
    name: string;
    list_id: number | null;
    list_slug: string | null;
    /**
     * Si el nombre interno (slug) ya lo usaba otra cosa, se restauró con uno
     * nuevo: aquí va cuál.
     */
    renamed_slug: string | null;
    /** Una automatización que no cabe en el plan vuelve pausada. */
    paused: boolean;
    /** Frase lista para mostrar. */
    message: string;
}

export interface TrashPurgeResult {
    purged: number;
}

/** Días que le quedan (0 = se borra hoy). */
export function trashDaysLeft(purgeAt: string | Date, now: Date = new Date()): number {
    const at = typeof purgeAt === 'string' ? Date.parse(purgeAt) : purgeAt.getTime();
    if (!Number.isFinite(at)) return 0;
    return Math.max(0, Math.ceil((at - now.getTime()) / 86_400_000));
}
