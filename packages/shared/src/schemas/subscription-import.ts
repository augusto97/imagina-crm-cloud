import { z } from 'zod';
import { idSchema } from './common';

/**
 * v0.1.376 (ADR-S96, addendum) — Traer a la app las suscripciones y los
 * planes que la empresa YA tiene en su cuenta de Mercado Pago (creados en el
 * panel de Mercado Pago, en otra herramienta o antes de usar la app).
 *
 * Dos destinos:
 * - `create`: una lista nueva «Suscriptores · Mercado Pago» (normal y
 *   editable, NO es una lista espejo), un registro por suscripción con sus
 *   columnas ya elegidas.
 * - `match`: una lista que ya existe; cada suscripción se vincula al registro
 *   cuyo correo coincide con el del pagador (y, si se pide, se crea el que
 *   falta).
 *
 * Lo importado se comporta igual que lo creado desde la app: estado, cobros,
 * pausar, cancelar, disparador, portal y registro de cobros. Las suscripciones
 * nuevas que se creen después en Mercado Pago llegan solas (por el aviso y por
 * una búsqueda periódica) si `auto` está encendido.
 */

export const SUBSCRIPTION_IMPORT_MODES = ['create', 'match'] as const;
export type SubscriptionImportMode = (typeof SUBSCRIPTION_IMPORT_MODES)[number];

/** Lo que dice Mercado Pago de cada suscripción (para contar en la vista previa). */
export const MP_PREAPPROVAL_STATUSES = ['authorized', 'paused', 'pending', 'cancelled'] as const;
export type MpPreapprovalStatus = (typeof MP_PREAPPROVAL_STATUSES)[number];

export const MP_PREAPPROVAL_STATUS_LABELS: Record<MpPreapprovalStatus, string> = {
    authorized: 'Activas',
    paused: 'Pausadas',
    pending: 'Por autorizar',
    cancelled: 'Canceladas',
};

/** Lo que se elige en «Importar desde Mercado Pago». */
export const subscriptionImportSchema = z
    .object({
        mode: z.enum(SUBSCRIPTION_IMPORT_MODES),
        /** `match`: la lista donde están los clientes. */
        list_id: idSchema.nullish(),
        /** `match`: la columna de correo con la que se busca a cada pagador. */
        email_field_id: idSchema.nullish(),
        /** `match`: crear un registro para el pagador que no está en la lista. */
        create_missing: z.boolean().default(true),
        /** Traer también las canceladas (el historial). Por defecto, sólo las vivas. */
        include_cancelled: z.boolean().default(false),
        /** `create`: el nombre de la lista nueva (vacío = «Suscriptores · Mercado Pago»). */
        list_name: z.string().trim().max(120).nullish(),
        /** Guardar cada cobro como un registro de «Cobros de suscripciones». */
        charge_log: z.boolean().default(true),
        /** Con el registro de cobros: crear también su tablero. */
        dashboard: z.boolean().default(true),
        /** Traer solas las suscripciones nuevas que se creen después en Mercado Pago. */
        auto: z.boolean().default(true),
    })
    .refine((v) => v.mode !== 'match' || (v.list_id != null && v.email_field_id != null), {
        message: 'Elige la lista y la columna de correo con la que se busca a cada cliente.',
        path: ['email_field_id'],
    });
export type SubscriptionImportInput = z.infer<typeof subscriptionImportSchema>;

/** Qué pasa con cada suscripción al importarla. */
export const SUBSCRIPTION_IMPORT_ACTIONS = ['create_record', 'link', 'no_record', 'known', 'skip'] as const;
export type SubscriptionImportAction = (typeof SUBSCRIPTION_IMPORT_ACTIONS)[number];

export const subscriptionImportPlanSchema = z.object({
    /** Id del plan en Mercado Pago. */
    external_id: z.string(),
    name: z.string(),
    amount: z.number().nullable(),
    currency: z.string(),
    frequency: z.number(),
    frequency_type: z.enum(['months', 'days']),
    cycles: z.number().nullable(),
    trial_days: z.number(),
    active: z.boolean(),
    /** Suscripciones de Mercado Pago que usan este plan. */
    subscribers: z.number(),
    /** Ya está en la app (importado antes). */
    known: z.boolean(),
});
export type SubscriptionImportPlan = z.infer<typeof subscriptionImportPlanSchema>;

export const subscriptionImportSampleSchema = z.object({
    external_id: z.string(),
    email: z.string().nullable(),
    title: z.string(),
    plan: z.string().nullable(),
    amount: z.number(),
    currency: z.string(),
    frequency: z.number(),
    frequency_type: z.enum(['months', 'days']),
    status: z.enum(MP_PREAPPROVAL_STATUSES),
    action: z.enum(SUBSCRIPTION_IMPORT_ACTIONS),
    /** El registro con el que se vincula (match). */
    record_title: z.string().nullable(),
    /** Por qué no se vincula o no se trae. */
    reason: z.string().nullable(),
});
export type SubscriptionImportSample = z.infer<typeof subscriptionImportSampleSchema>;

export const subscriptionImportPreviewSchema = z.object({
    /** Suscripciones encontradas en Mercado Pago (todas). */
    total: z.number(),
    by_status: z.record(z.enum(MP_PREAPPROVAL_STATUSES), z.number()),
    /** Las que ya están en la app (se crearon desde aquí o se importaron antes). */
    known: z.number(),
    /** Las que se van a traer con lo elegido. */
    to_import: z.number(),
    /** Canceladas que se dejan afuera (sin «Traer también las canceladas»). */
    skipped_cancelled: z.number(),
    /** Sin correo del pagador (Mercado Pago no siempre lo da): se busca en su último pago. */
    without_email: z.number(),
    plans: z.array(subscriptionImportPlanSchema),
    /** `match`: cuántas se vinculan, cuántas no encontraron cliente y cuántas chocan. */
    match: z
        .object({
            list_id: idSchema,
            list_name: z.string(),
            matched: z.number(),
            unmatched: z.number(),
            /** El registro ya tiene una suscripción viva: la importada queda sin registro. */
            conflicts: z.number(),
        })
        .nullable(),
    sample: z.array(subscriptionImportSampleSchema),
    currencies: z.array(z.string()),
    /** Se leyeron las primeras 5.000 (hay más en Mercado Pago). */
    truncated: z.boolean(),
});
export type SubscriptionImportPreview = z.infer<typeof subscriptionImportPreviewSchema>;

/** Lo que quedó configurado en la conexión (lo que trae las nuevas solas). */
export const subscriptionImportConfigSchema = z.object({
    mode: z.enum(SUBSCRIPTION_IMPORT_MODES),
    list_id: idSchema.nullable(),
    email_field_id: idSchema.nullable(),
    create_missing: z.boolean(),
    auto: z.boolean(),
    /** Desde cuándo: lo cancelado antes de esto no se trae solo. */
    since: z.string(),
    last_scan_at: z.string().nullable(),
});
export type SubscriptionImportConfig = z.infer<typeof subscriptionImportConfigSchema>;

/** Cómo se lee `connections.config.subscription_import` (tolerante: nunca lanza). */
export function readSubscriptionImportConfig(config: unknown): SubscriptionImportConfig | null {
    const raw = (config as { subscription_import?: unknown } | null | undefined)?.subscription_import;
    if (!raw || typeof raw !== 'object') return null;
    const parsed = subscriptionImportConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

export const SUBSCRIPTION_IMPORT_STATES = ['idle', 'running', 'done', 'failed'] as const;
export type SubscriptionImportState = (typeof SUBSCRIPTION_IMPORT_STATES)[number];

export const subscriptionImportStatusSchema = z.object({
    state: z.enum(SUBSCRIPTION_IMPORT_STATES),
    /** Suscripciones por traer en esta corrida y las que ya pasaron. */
    total: z.number(),
    done: z.number(),
    imported: z.number(),
    /** `match`: vinculadas a un registro que ya existía. */
    linked: z.number(),
    /** Registros nuevos creados para los pagadores. */
    records_created: z.number(),
    /** Sin registro (no se encontró el cliente o ya tenía una viva). */
    without_record: z.number(),
    failed: z.number(),
    plans_imported: z.number(),
    list_id: idSchema.nullable(),
    list_slug: z.string().nullable(),
    list_name: z.string().nullable(),
    charge_log_list_id: idSchema.nullable(),
    dashboard_id: idSchema.nullable(),
    error: z.string().nullable(),
    warnings: z.array(z.string()),
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
    /** Lo que trae las nuevas solas (null = nunca se importó). */
    config: subscriptionImportConfigSchema.nullable(),
    /** Suscripciones de Mercado Pago que entraron solas después de importar. */
    auto_imported: z.number(),
});
export type SubscriptionImportStatus = z.infer<typeof subscriptionImportStatusSchema>;

export const IDLE_SUBSCRIPTION_IMPORT: Omit<SubscriptionImportStatus, 'config' | 'auto_imported'> = {
    state: 'idle',
    total: 0,
    done: 0,
    imported: 0,
    linked: 0,
    records_created: 0,
    without_record: 0,
    failed: 0,
    plans_imported: 0,
    list_id: null,
    list_slug: null,
    list_name: null,
    charge_log_list_id: null,
    dashboard_id: null,
    error: null,
    warnings: [],
    started_at: null,
    finished_at: null,
};

export const DEFAULT_IMPORT_LIST_NAME = 'Suscriptores · Mercado Pago';

/** El correo como se compara (sin espacios ni mayúsculas). */
export function normalizeImportEmail(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const v = value.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

/**
 * Los días gratis de un plan de Mercado Pago (`free_trial`): viene en días o
 * en meses; un mes cuenta 30 días (es la prueba, no el cobro).
 */
export function mpTrialDays(frequency: unknown, type: unknown): number {
    const n = typeof frequency === 'number' ? frequency : Number(frequency);
    if (!Number.isFinite(n) || n <= 0) return 0;
    const days = type === 'months' ? n * 30 : n;
    return Math.min(365, Math.round(days));
}

/**
 * Cada cuánto cobra una suscripción de Mercado Pago, dentro de lo que la app
 * acepta (hasta 12 meses o 365 días): lo que no entra se acota.
 */
export function mpFrequency(frequency: unknown, type: unknown): { frequency: number; frequency_type: 'months' | 'days' } {
    const t: 'months' | 'days' = type === 'days' ? 'days' : 'months';
    const raw = typeof frequency === 'number' ? frequency : Number(frequency);
    const n = Number.isFinite(raw) && raw >= 1 ? Math.round(raw) : 1;
    return { frequency: Math.min(n, t === 'days' ? 365 : 12), frequency_type: t };
}

/**
 * ¿Qué hacer con una suscripción de Mercado Pago? Puro (la vista previa y la
 * importación deciden con lo mismo).
 */
export function decideImport(input: {
    known: boolean;
    status: MpPreapprovalStatus;
    includeCancelled: boolean;
    /** Lo que trae esta app (`ibs_…`): ya debería estar; si no, es de otra instalación o un intento que se deshizo. */
    ours: boolean;
    mode: SubscriptionImportMode;
    email: string | null;
    match: { recordId: number; hasLive: boolean } | null;
    createMissing: boolean;
}): { action: SubscriptionImportAction; reason: string | null } {
    if (input.known) return { action: 'known', reason: 'Ya está en la app.' };
    if (input.ours) return { action: 'skip', reason: 'La creó esta app y quedó a medias (nunca se guardó).' };
    if (input.status === 'cancelled' && !input.includeCancelled) return { action: 'skip', reason: 'Está cancelada.' };
    if (input.mode === 'create') return { action: 'create_record', reason: null };
    if (input.match) {
        if (input.match.hasLive) return { action: 'no_record', reason: 'Ese cliente ya tiene una suscripción en la app: queda sin vincular.' };
        return { action: 'link', reason: null };
    }
    if (!input.email) {
        return input.createMissing
            ? { action: 'create_record', reason: 'Mercado Pago no dio el correo: se crea un registro nuevo.' }
            : { action: 'no_record', reason: 'Mercado Pago no dio el correo del pagador.' };
    }
    return input.createMissing
        ? { action: 'create_record', reason: 'No está en la lista: se crea.' }
        : { action: 'no_record', reason: 'No está en la lista.' };
}

export const subscriptionImportAutoSchema = z.object({ auto: z.boolean() });
export type SubscriptionImportAutoInput = z.infer<typeof subscriptionImportAutoSchema>;
