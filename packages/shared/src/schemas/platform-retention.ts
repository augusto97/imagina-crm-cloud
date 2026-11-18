import { z } from 'zod';

/**
 * v0.1.439 — Cuánto se guarda lo que crece con el uso y nadie mira de nuevo.
 *
 * - **Historial de corridas de automatizaciones** (`automation_runs`): cada
 *   corrida guarda su registro de pasos. Con miles de empresas es la tabla
 *   que más crece. Por defecto se conservan 90 días; nunca se borra una
 *   corrida que espera o está corriendo, la última de cada automatización ni
 *   lo que necesitan las automatizaciones «por fecha de vencimiento» para no
 *   volver a dispararse.
 * - **Actividad de los registros** (`activity`): es la historia de los datos
 *   del cliente (se ve en la ficha y se restaura desde ahí). Por defecto NO se
 *   borra; el operador puede ponerle un plazo si la base crece de más.
 *
 * Vive en Redis `platform:retention` (viaja en las copias del servidor).
 */
export const RUNS_RETENTION_OPTIONS = [30, 60, 90, 180, 365] as const;
export const ACTIVITY_RETENTION_OPTIONS = [365, 730, 1095, 1825] as const;
export const DEFAULT_RUNS_RETENTION_DAYS = 90;

const runsDays = z
    .number()
    .int()
    .refine((n) => (RUNS_RETENTION_OPTIONS as readonly number[]).includes(n), 'Elige una de las opciones.');
const activityDays = z
    .number()
    .int()
    .refine((n) => (ACTIVITY_RETENTION_OPTIONS as readonly number[]).includes(n), 'Elige una de las opciones.');

export const platformRetentionSchema = z.object({
    /** Días que se conserva una corrida terminada. null = siempre. */
    automation_runs_days: runsDays.nullable(),
    /** Días que se conserva la actividad de un registro. null = siempre (lo de fábrica). */
    activity_days: activityDays.nullable(),
});
export type PlatformRetention = z.infer<typeof platformRetentionSchema>;

export const DEFAULT_PLATFORM_RETENTION: PlatformRetention = {
    automation_runs_days: DEFAULT_RUNS_RETENTION_DAYS,
    activity_days: null,
};

export const updatePlatformRetentionSchema = platformRetentionSchema.partial();
export type UpdatePlatformRetentionInput = z.infer<typeof updatePlatformRetentionSchema>;

/**
 * Lo guardado → los ajustes, campo por campo: un valor roto o fuera de las
 * opciones vuelve a lo de fábrica sin tirar el otro.
 */
export function readPlatformRetention(raw: unknown): PlatformRetention {
    const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const runs = obj.automation_runs_days;
    const act = obj.activity_days;
    return {
        automation_runs_days:
            runs === null
                ? null
                : (RUNS_RETENTION_OPTIONS as readonly unknown[]).includes(runs)
                  ? (runs as number)
                  : DEFAULT_PLATFORM_RETENTION.automation_runs_days,
        activity_days:
            act === null || act === undefined
                ? null
                : (ACTIVITY_RETENTION_OPTIONS as readonly unknown[]).includes(act)
                  ? (act as number)
                  : DEFAULT_PLATFORM_RETENTION.activity_days,
    };
}

/** Una tabla de la base con lo que ocupa (datos + índices + TOAST). */
export interface DbTableSize {
    table: string;
    /** Nombre para mostrar (o null: se muestra el de la tabla). */
    label: string | null;
    bytes: number;
    /** Filas estimadas por Postgres (puede ir atrasado hasta el próximo ANALYZE). */
    rows: number;
    /** Si la app la poda sola (y cómo). */
    pruned: 'auto' | 'setting' | 'never';
}

export interface RetentionRunResult {
    at: string;
    /** Filas borradas por tabla. */
    deleted: Record<string, number>;
    /** Si quedó trabajo para la próxima vuelta (se borra por tandas). */
    more: boolean;
    error: string | null;
}

export interface PlatformRetentionStatus {
    settings: PlatformRetention;
    db_bytes: number | null;
    tables: DbTableSize[];
    last: RetentionRunResult | null;
    /** Una limpieza pedida a mano que todavía corre. */
    running: boolean;
}
