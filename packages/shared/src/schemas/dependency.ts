import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';
import { isDoneOptionLabel, pickStatusField } from './notifications';

/**
 * Dependencias entre registros (A8): «bloquea» / «bloqueado por».
 *
 * Una dependencia es una FILA propia (`record_dependencies`, con RLS), no un
 * campo relation: tiene dirección (quién bloquea a quién), desfase en días y
 * reglas propias (sin ciclos). Hoy las dos puntas son de la MISMA lista; la
 * fila guarda la lista de cada punta para que permitir otra lista después sea
 * sólo levantar esa validación.
 *
 * Lo que vive aquí es PURO: lo usan el servidor (reprogramar, contar
 * bloqueantes abiertos), la tabla, el kanban, la ficha y el Gantt.
 */

/** Tope de dependencias por registro (cada lado). */
export const DEPENDENCY_MAX_PER_RECORD = 100;
/** Desfase máximo (días) entre el fin del que bloquea y el inicio del que espera. */
export const DEPENDENCY_MAX_LAG_DAYS = 365;
/** Tope de registros que corre una reprogramación en cadena. */
export const RESCHEDULE_MAX_RECORDS = 200;
/** Tope de eslabones de una cadena de reprogramación. */
export const RESCHEDULE_MAX_DEPTH = 50;

/** Desde el registro de la ficha: lo que lo bloquea o lo que él bloquea. */
export const DEPENDENCY_KINDS = ['blocked_by', 'blocks'] as const;
export const dependencyKindSchema = z.enum(DEPENDENCY_KINDS);
export type DependencyKind = z.infer<typeof dependencyKindSchema>;

const lagSchema = z.number().int().min(-DEPENDENCY_MAX_LAG_DAYS).max(DEPENDENCY_MAX_LAG_DAYS);

/**
 * Alta de una dependencia desde un registro (`POST …/records/:id/dependencies`).
 * `list_id` es la lista del OTRO registro: hoy tiene que ser la misma (se
 * acepta para que la API no cambie el día que se permita otra lista).
 */
export const createDependencySchema = z.object({
    kind: dependencyKindSchema,
    record_id: idSchema,
    list_id: idSchema.optional(),
    lag_days: lagSchema.optional(),
});
export type CreateDependencyInput = z.infer<typeof createDependencySchema>;

/** Alta directa por las dos puntas (Gantt: arrastrar de una barra a otra; asistente). */
export const createDependencyPairSchema = z.object({
    blocker_id: idSchema,
    blocked_id: idSchema,
    lag_days: lagSchema.optional(),
});
export type CreateDependencyPairInput = z.infer<typeof createDependencyPairSchema>;

export const updateDependencySchema = z.object({ lag_days: lagSchema });
export type UpdateDependencyInput = z.infer<typeof updateDependencySchema>;

/** Una dependencia cruda (las dos puntas por id). */
export const dependencyEdgeSchema = z.object({
    id: idSchema,
    blocker_id: idSchema,
    blocked_id: idSchema,
    lag_days: z.number().int(),
});
export type DependencyEdge = z.infer<typeof dependencyEdgeSchema>;

/** El estado del otro registro, como lo pinta un chip. */
export const dependencyStatusSchema = z.object({
    value: z.string(),
    label: z.string(),
    color: z.string().nullable(),
});

/**
 * Una punta vista desde la ficha. `title` es null si quien mira no alcanza
 * ese registro (otro dueño con «sólo lo suyo»): se sabe que hay un
 * bloqueante, no qué es.
 */
export const dependencyLinkSchema = z.object({
    id: idSchema,
    record_id: idSchema,
    list_id: idSchema,
    title: z.string().nullable(),
    status: dependencyStatusSchema.nullable(),
    done: z.boolean(),
    lag_days: z.number().int(),
    created_at: isoDateTimeSchema,
});
export type DependencyLink = z.infer<typeof dependencyLinkSchema>;

export const recordDependenciesSchema = z.object({
    blocked_by: z.array(dependencyLinkSchema),
    blocks: z.array(dependencyLinkSchema),
});
export type RecordDependencies = z.infer<typeof recordDependenciesSchema>;

// ─────────────────────────── Ajustes por lista ───────────────────────────

/**
 * Reprogramación (por LISTA, en `settings.dependencies`): si cambia el fin de
 * un registro que bloquea a otros, los que dependen de él se corren lo mismo.
 * Vive en la lista y no en una vista porque es una regla de los DATOS: vale
 * para una edición desde la tabla, el kanban, la ficha, el Gantt, una
 * automatización o el asistente, y dos vistas no pueden contradecirse.
 */
export const dependencySettingsSchema = z.object({
    reschedule: z.boolean(),
    start_field_id: idSchema.nullable(),
    end_field_id: idSchema.nullable(),
});
export type DependencySettings = z.infer<typeof dependencySettingsSchema>;

export const updateDependencySettingsSchema = dependencySettingsSchema.partial().refine(
    (p) => Object.keys(p).length > 0,
    { message: 'El patch no puede estar vacío' },
);
export type UpdateDependencySettingsInput = z.infer<typeof updateDependencySettingsSchema>;

export const DEFAULT_DEPENDENCY_SETTINGS: DependencySettings = {
    reschedule: false,
    start_field_id: null,
    end_field_id: null,
};

const posInt = (v: unknown): number | null =>
    typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;

/** Lee `settings.dependencies` de una lista sin romperse (lo que no tiene forma, al default). */
export function readDependencySettings(listSettings: unknown): DependencySettings {
    const s = listSettings !== null && typeof listSettings === 'object' ? (listSettings as Record<string, unknown>) : {};
    const d = s.dependencies !== null && typeof s.dependencies === 'object' ? (s.dependencies as Record<string, unknown>) : {};
    return {
        reschedule: d.reschedule === true,
        start_field_id: posInt(d.start_field_id),
        end_field_id: posInt(d.end_field_id),
    };
}

// ─────────────────────────── «Terminado» ───────────────────────────

interface FieldLike {
    id: number;
    slug: string;
    label: string;
    type: string;
    config?: unknown;
}

/**
 * Cómo se reconoce un registro TERMINADO en una lista: el mismo criterio de
 * «Mi trabajo» (v0.1.276) — el select que hace de estado y sus opciones cuya
 * ETIQUETA dice «completado / hecho / cerrado / …». null = la lista no tiene
 * un estado reconocible (nada cuenta como terminado).
 */
export interface DoneRule {
    fieldId: number;
    slug: string;
    values: string[];
}

export function doneRuleFor(fields: readonly FieldLike[]): DoneRule | null {
    const status = pickStatusField(fields);
    if (!status) return null;
    const options = ((status.config as { options?: Array<{ value: string; label?: string }> } | undefined)?.options ?? []);
    const values = options.filter((o) => isDoneOptionLabel(o.label || o.value)).map((o) => String(o.value));
    return values.length > 0 ? { fieldId: status.id, slug: status.slug, values } : null;
}

/** ¿Este valor del campo de estado significa «terminado»? */
export function isDoneValue(rule: DoneRule | null, value: unknown): boolean {
    if (!rule || value === null || value === undefined) return false;
    return rule.values.includes(String(value));
}

// ─────────────────────────── Fechas ───────────────────────────

const DAY_MS = 86_400_000;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Una fecha `YYYY-MM-DD` o un instante ISO → milisegundos UTC (null si no se lee). */
export function dateValueMs(value: unknown): number | null {
    if (typeof value !== 'string' || value === '') return null;
    const m = YMD.exec(value);
    if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
}

/**
 * Corre una fecha `delta` milisegundos. En un campo de FECHA se corre por
 * días enteros (redondeado; 0 = sin cambio) y conserva el formato; en uno de
 * fecha y hora, el instante exacto.
 */
export function shiftDateValue(type: string, value: unknown, deltaMs: number): string | null {
    if (typeof value !== 'string' || value === '') return null;
    if (type === 'date') {
        const m = YMD.exec(value.slice(0, 10));
        if (!m) return null;
        const days = Math.round(deltaMs / DAY_MS);
        const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
        return d.toISOString().slice(0, 10);
    }
    const t = Date.parse(value);
    if (!Number.isFinite(t)) return null;
    return new Date(t + deltaMs).toISOString();
}

/** El fin efectivo de un registro: su fin, o su inicio si no tiene fin (hito). */
export function effectiveEndMs(data: Record<string, unknown>, startKey: string | null, endKey: string | null): number | null {
    const end = endKey ? dateValueMs(data[endKey]) : null;
    if (end !== null) return end;
    return startKey ? dateValueMs(data[startKey]) : null;
}

/** El inicio efectivo: su inicio, o su fin si no tiene inicio. */
export function effectiveStartMs(data: Record<string, unknown>, startKey: string | null, endKey: string | null): number | null {
    const start = startKey ? dateValueMs(data[startKey]) : null;
    if (start !== null) return start;
    return endKey ? dateValueMs(data[endKey]) : null;
}

/**
 * Ciclo: ¿agregar «`blocker` bloquea a `blocked`» cerraría un círculo? Hay
 * ciclo si desde `blocked` ya se llega a `blocker` siguiendo «bloquea a».
 * Devuelve el camino (de `blocked` a `blocker`) o null. `next(id)` da los que
 * `id` bloquea. Lo usa el servidor con las aristas reales y la interfaz para
 * avisar antes de pedir.
 */
export function findDependencyCycle(
    blocker: number,
    blocked: number,
    next: (id: number) => readonly number[],
    maxNodes = 10_000,
): number[] | null {
    if (blocker === blocked) return [blocker];
    const prev = new Map<number, number>();
    const queue: number[] = [blocked];
    const seen = new Set<number>([blocked]);
    while (queue.length > 0 && seen.size <= maxNodes) {
        const id = queue.shift()!;
        for (const n of next(id)) {
            if (seen.has(n)) continue;
            seen.add(n);
            prev.set(n, id);
            if (n === blocker) {
                const path: number[] = [n];
                let cur = n;
                while (prev.has(cur)) {
                    cur = prev.get(cur)!;
                    path.unshift(cur);
                }
                return path;
            }
            queue.push(n);
        }
    }
    return null;
}
