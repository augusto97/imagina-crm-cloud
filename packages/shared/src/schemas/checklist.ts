import { z } from 'zod';
import { idSchema, isoDateSchema, isoDateTimeSchema } from './common';

/**
 * A9 — Checklist dentro del registro.
 *
 * Un registro puede tener VARIOS checklists con nombre (como ClickUp); cada uno
 * es una lista ordenada de ítems con casilla, responsable (una persona) y
 * fecha (sin hora o con hora). Viven en tablas propias con RLS
 * (`record_checklists` + `record_checklist_items`), no en `records.data`:
 * tienen su propio orden, quién y cuándo marcó cada ítem, y «Mi trabajo»
 * los lee por responsable sin abrir cada registro.
 *
 * Permisos: VER el registro es ver sus checklists; marcar o editar exige
 * poder EDITAR el registro (el ACL de la lista, lo valida el servidor).
 *
 * Lo que vive aquí es PURO: lo usan el servidor (progreso del listado, el
 * disparador «Cuando se completa un checklist»), la ficha y «Mi trabajo».
 */

/** Checklists por registro. */
export const CHECKLIST_MAX_PER_RECORD = 20;
/** Ítems por checklist. */
export const CHECKLIST_MAX_ITEMS = 200;
export const CHECKLIST_NAME_MAX = 120;
export const CHECKLIST_ITEM_TEXT_MAX = 500;
/** Nombre de un checklist nuevo cuando no se elige otro. */
export const DEFAULT_CHECKLIST_NAME = 'Checklist';

/**
 * Fecha de un ítem: `AAAA-MM-DD` (sin hora: un día del calendario, nunca se le
 * aplica una zona) o un instante ISO con zona (con hora; se muestra en la zona
 * de quien mira y «Mi trabajo» lo agrupa en la de la empresa).
 */
export const checklistDueSchema = z.union([isoDateSchema, isoDateTimeSchema]);

/** ¿La fecha de un ítem lleva hora? */
export function checklistDueHasTime(due: string | null | undefined): boolean {
    return typeof due === 'string' && due.includes('T');
}

const itemText = z.string().trim().min(1, 'Escribe el texto del ítem').max(CHECKLIST_ITEM_TEXT_MAX);
const checklistName = z.string().trim().min(1, 'Ponle un nombre').max(CHECKLIST_NAME_MAX);

export const checklistItemSchema = z.object({
    id: idSchema,
    checklist_id: idSchema,
    text: z.string(),
    done: z.boolean(),
    /** Quién lo marcó (null si no está hecho, o si lo marcó el sistema). */
    done_by: idSchema.nullable(),
    done_at: isoDateTimeSchema.nullable(),
    assignee_id: idSchema.nullable(),
    due: z.string().nullable(),
    position: z.number().int(),
    created_at: isoDateTimeSchema,
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const checklistSchema = z.object({
    id: idSchema,
    list_id: idSchema,
    record_id: idSchema,
    name: z.string(),
    position: z.number().int(),
    items: z.array(checklistItemSchema),
    created_at: isoDateTimeSchema,
});
export type Checklist = z.infer<typeof checklistSchema>;

/** Los checklists de un registro (sección de la ficha y bundle). */
export const recordChecklistsSchema = z.object({
    checklists: z.array(checklistSchema),
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
});
export type RecordChecklists = z.infer<typeof recordChecklistsSchema>;

/** Progreso que viaja en el listado (el «☑ 3/8» junto al título). */
export const checklistProgressSchema = z.object({
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
});
export type ChecklistProgress = z.infer<typeof checklistProgressSchema>;

// ─────────────────────────── Entradas ───────────────────────────

export const checklistItemInputSchema = z.object({
    text: itemText,
    assignee_id: idSchema.nullable().optional(),
    due: checklistDueSchema.nullable().optional(),
    done: z.boolean().optional(),
});
export type ChecklistItemInput = z.infer<typeof checklistItemInputSchema>;

/**
 * Alta de un checklist en un registro: vacío, con ítems, o desde una
 * plantilla de checklist de la lista (`template_id`).
 */
export const createChecklistSchema = z.object({
    name: checklistName.optional(),
    items: z.array(checklistItemInputSchema).max(CHECKLIST_MAX_ITEMS).optional(),
    template_id: idSchema.optional(),
});
export type CreateChecklistInput = z.infer<typeof createChecklistSchema>;

export const updateChecklistSchema = z
    .object({ name: checklistName })
    .partial()
    .refine((p) => Object.keys(p).length > 0, { message: 'El cambio no puede estar vacío' });
export type UpdateChecklistInput = z.infer<typeof updateChecklistSchema>;

/**
 * Agregar ítems (Enter agrega el siguiente; pegar varias líneas agrega
 * varios). `after_id` = insertarlos debajo de ese ítem (si no, al final).
 */
export const createChecklistItemsSchema = z.object({
    items: z.array(checklistItemInputSchema).min(1).max(CHECKLIST_MAX_ITEMS),
    after_id: idSchema.nullable().optional(),
});
export type CreateChecklistItemsInput = z.infer<typeof createChecklistItemsSchema>;

export const updateChecklistItemSchema = z
    .object({
        text: itemText,
        done: z.boolean(),
        assignee_id: idSchema.nullable(),
        due: checklistDueSchema.nullable(),
        /** Mover el ítem a otro checklist del MISMO registro (va al final). */
        checklist_id: idSchema,
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, { message: 'El cambio no puede estar vacío' });
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;

/** Nuevo orden (ids en el orden deseado). Ítems de un checklist, o los checklists de un registro. */
export const reorderChecklistIdsSchema = z.object({
    ids: z.array(idSchema).min(1).max(CHECKLIST_MAX_ITEMS),
});
export type ReorderChecklistIdsInput = z.infer<typeof reorderChecklistIdsSchema>;

// ─────────────────────────── Puro ───────────────────────────

/** Hechos y total de una tanda de ítems. */
export function checklistProgressOf(items: ReadonlyArray<{ done: boolean }>): ChecklistProgress {
    let done = 0;
    for (const i of items) if (i.done) done++;
    return { done, total: items.length };
}

/** Un checklist está COMPLETO si tiene ítems y todos están hechos. */
export function isChecklistComplete(items: ReadonlyArray<{ done: boolean }>): boolean {
    return items.length > 0 && items.every((i) => i.done);
}

/** Porcentaje 0-100 (redondeado); null sin ítems. */
export function checklistPercent(p: ChecklistProgress): number | null {
    return p.total === 0 ? null : Math.round((p.done * 100) / p.total);
}

/**
 * Pegar varias líneas en el campo de un ítem agrega UNA por línea: se quitan
 * las viñetas y numeraciones que traen las notas («- », «* », «• », «1. »,
 * «[ ] », «[x] » — este último marca el ítem como hecho). Líneas vacías fuera.
 */
export function parseChecklistLines(text: string): Array<{ text: string; done: boolean }> {
    const out: Array<{ text: string; done: boolean }> = [];
    for (const raw of text.split(/\r?\n/)) {
        let line = raw.trim();
        if (line === '') continue;
        line = line.replace(/^(?:[-*•▪◦]|\d{1,3}[.)])\s+/, '');
        let done = false;
        const box = /^\[( |x|X)\]\s*/.exec(line);
        if (box) {
            done = box[1] !== ' ';
            line = line.slice(box[0].length);
        }
        line = line.trim().slice(0, CHECKLIST_ITEM_TEXT_MAX);
        if (line !== '') out.push({ text: line, done });
    }
    return out.slice(0, CHECKLIST_MAX_ITEMS);
}

// ─────────────────────────── Disparador ───────────────────────────

/**
 * «Cuando se completa un checklist» (`checklist_completed`):
 *  - `any` (default): cualquiera de los checklists del registro pasa a estar
 *    completo;
 *  - `named`: el checklist con ese nombre (sin distinguir mayúsculas);
 *  - `all`: el registro queda con TODOS sus checklists completos (se dispara
 *    al completarse el último).
 */
export const CHECKLIST_TRIGGER_MODES = ['any', 'named', 'all'] as const;
export type ChecklistTriggerMode = (typeof CHECKLIST_TRIGGER_MODES)[number];

/** El evento que encola el servidor al completarse un checklist. */
export interface ChecklistCompletedInfo {
    id: number;
    name: string;
    /** ¿Quedaron completos TODOS los checklists del registro? */
    all_done: boolean;
    total: number;
}

/** ¿Este disparador (config guardada) reacciona a este checklist que se completó? */
export function checklistTriggerMatches(cfg: Record<string, unknown> | null | undefined, info: ChecklistCompletedInfo): boolean {
    const mode = (CHECKLIST_TRIGGER_MODES as readonly string[]).includes(String(cfg?.checklist_mode ?? 'any'))
        ? (String(cfg?.checklist_mode ?? 'any') as ChecklistTriggerMode)
        : 'any';
    if (mode === 'all') return info.all_done;
    if (mode === 'named') {
        const wanted = typeof cfg?.checklist_name === 'string' ? normalizeName(cfg.checklist_name) : '';
        return wanted !== '' && normalizeName(info.name) === wanted;
    }
    return true;
}

function normalizeName(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim()
        .toLowerCase();
}
