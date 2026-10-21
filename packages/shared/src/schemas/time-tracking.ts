import { z } from 'zod';
import { parseDuration } from '../field-types/duration';
import { idSchema, isoDateSchema, isoDateTimeSchema } from './common';

/**
 * v0.1.288 — Registro de tiempo por registro.
 *
 * Una ENTRADA es tiempo que una persona dedicó a un registro: o un cronómetro
 * (`timer`: se inicia y se detiene; mientras corre `ended_at` es null) o una
 * carga a mano (`manual`: fecha + duración). Cada persona tiene a lo sumo UN
 * cronómetro en curso en toda la empresa: iniciar otro detiene el anterior y
 * lo guarda. El total del registro es el campo derivado «Tiempo registrado»
 * (`time_tracked`, en minutos).
 */

export const TIME_ENTRY_SOURCES = ['timer', 'manual'] as const;
export type TimeEntrySource = (typeof TIME_ENTRY_SOURCES)[number];

/** Una entrada como la ve la ficha. `seconds` de un cronómetro en curso es 0 (corre desde `started_at`). */
export const timeEntrySchema = z.object({
    id: idSchema,
    list_id: idSchema,
    record_id: idSchema,
    user_id: idSchema.nullable(),
    /** Nombre visible de quien la cargó (null si la cuenta ya no existe). */
    user_name: z.string().nullable(),
    source: z.enum(TIME_ENTRY_SOURCES),
    work_date: isoDateSchema,
    started_at: isoDateTimeSchema.nullable(),
    ended_at: isoDateTimeSchema.nullable(),
    seconds: z.number().int().nonnegative(),
    note: z.string(),
    /** Cronómetro en curso. */
    running: z.boolean(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
});
export type TimeEntryDto = z.infer<typeof timeEntrySchema>;

/** El tiempo de UN registro: total, por persona y las últimas entradas. */
export const recordTimeSchema = z.object({
    /** Segundos de las entradas cerradas (lo que suma el campo «Tiempo registrado»). */
    total_seconds: z.number().int().nonnegative(),
    by_user: z.array(
        z.object({
            user_id: idSchema.nullable(),
            user_name: z.string().nullable(),
            seconds: z.number().int().nonnegative(),
        }),
    ),
    /** Las más nuevas primero (hasta `RECORD_TIME_ENTRIES`). */
    entries: z.array(timeEntrySchema),
    /** Cuántas entradas hay en total (puede ser más que las que viajan). */
    entries_count: z.number().int().nonnegative(),
    /** El cronómetro en curso de QUIEN MIRA en este registro (o null). */
    my_running: timeEntrySchema.nullable(),
    /** Quien mira puede editar/borrar las entradas de otros (admin/manager). */
    can_manage_all: z.boolean(),
});
export type RecordTimeDto = z.infer<typeof recordTimeSchema>;

/** Cuántas entradas viajan en la ficha (el resto, en el CSV). */
export const RECORD_TIME_ENTRIES = 50;

/** El cronómetro en curso de una persona, en cualquier registro de la empresa. */
export const activeTimerSchema = z.object({
    entry: timeEntrySchema,
    list_slug: z.string(),
    list_name: z.string(),
    /** Título del registro tal como se lee en la ficha. */
    record_title: z.string(),
});
export type ActiveTimerDto = z.infer<typeof activeTimerSchema>;

/**
 * Duración que escribe una persona: minutos (`90`) o el texto del campo
 * Duración (`1h 30m`, `1:30`, `2h`). Se valida con el MISMO parser que el
 * campo Duración; al menos un minuto y hasta mil horas por entrada.
 */
export const MAX_TIME_ENTRY_MINUTES = 1000 * 60;
export const timeDurationInputSchema = z.union([z.number(), z.string()]).transform((raw, ctx) => {
    const parsed = parseDuration(raw);
    if (!parsed.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Escribe una duración como «1h 30m», «45m» o «1:30».' });
        return z.NEVER;
    }
    if (parsed.value < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La duración tiene que ser de al menos un minuto.' });
        return z.NEVER;
    }
    if (parsed.value > MAX_TIME_ENTRY_MINUTES) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Una entrada puede ser de hasta 1000 horas.' });
        return z.NEVER;
    }
    return parsed.value;
});

/** Alta manual (`POST /lists/:l/records/:id/time`). `duration` en minutos tras el parseo. */
export const createTimeEntrySchema = z.object({
    work_date: isoDateSchema,
    duration: timeDurationInputSchema,
    note: z.string().trim().max(500).optional(),
});
export type CreateTimeEntryInput = z.infer<typeof createTimeEntrySchema>;

/** Edición de una entrada (la duración no se cambia mientras el cronómetro corre). */
export const updateTimeEntrySchema = z
    .object({
        work_date: isoDateSchema,
        duration: timeDurationInputSchema,
        note: z.string().trim().max(500),
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, { message: 'El cambio no puede estar vacío' });
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>;

/** Iniciar el cronómetro (con una nota opcional de qué se está haciendo). */
export const startTimerSchema = z.object({ note: z.string().trim().max(500).optional() });
export type StartTimerInput = z.infer<typeof startTimerSchema>;

/** Segundos → texto corto: `3725` → `1h 2m`; menos de un minuto → `0m`. */
export function formatTrackedSeconds(seconds: number): string {
    const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

/** Segundos → reloj del cronómetro en curso: `3725` → `1:02:05`. */
export function formatTimerClock(seconds: number): string {
    const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
