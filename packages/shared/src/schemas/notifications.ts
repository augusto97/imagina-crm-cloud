import { z } from 'zod';
import { idSchema } from './common';

/**
 * v0.1.276 — «Mi trabajo» + bandeja de avisos (ADR-S40).
 *
 * Un AVISO es una fila por destinatario (`notifications`, RLS): quién hizo
 * qué sobre qué registro. Los genera el servidor —menciones, asignaciones,
 * comentarios y cambios en registros que la persona SIGUE, recordatorios— y
 * la persona los lee en la campana del topbar. Las preferencias (qué llega
 * también por correo y el resumen diario) viven en
 * `memberships.settings.notifications`: son por persona Y por empresa.
 */

export const NOTIFICATION_KINDS = ['mention', 'assigned', 'comment', 'update', 'reminder'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
    mention: 'Te mencionan',
    assigned: 'Te asignan un registro',
    comment: 'Comentan un registro que seguís',
    update: 'Cambia un registro que seguís',
    reminder: 'Tus recordatorios',
};

export interface NotificationDto {
    id: number;
    kind: NotificationKind;
    list_id: number | null;
    list_slug: string | null;
    list_name: string | null;
    record_id: number | null;
    actor_id: number | null;
    actor_name: string | null;
    /** Frase ya armada en el servidor («Ana te asignó «Acme»»). */
    title: string;
    /** Extracto (el comentario, los campos que cambiaron, la nota). */
    body: string;
    read_at: string | null;
    created_at: string;
}

export interface NotificationsPage {
    items: NotificationDto[];
    unread: number;
    next_cursor: number | null;
}

export const listNotificationsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    before: z.coerce.number().int().positive().optional(),
    unread: z
        .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
        .optional()
        .transform((v) => v === '1' || v === 'true'),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

/** Marcar leídos: ids puntuales o todos. */
export const markNotificationsSchema = z.union([
    z.object({ ids: z.array(idSchema).min(1).max(200) }),
    z.object({ all: z.literal(true) }),
]);
export type MarkNotificationsInput = z.infer<typeof markNotificationsSchema>;

// ─────────────────────────── Preferencias ───────────────────────────

export const notificationPrefsSchema = z.object({
    /** Qué tipos llegan TAMBIÉN por correo, en el momento. */
    email: z
        .object({
            mention: z.boolean().default(true),
            assigned: z.boolean().default(true),
            comment: z.boolean().default(false),
            update: z.boolean().default(false),
            reminder: z.boolean().default(true),
        })
        .default({}),
    /**
     * Resumen diario por correo (avisos sin leer + lo vencido y lo que vence
     * hoy). Apagado por defecto: un correo nuevo para todos al actualizar
     * sería una sorpresa (y gasta la cuota de correo de la empresa).
     */
    digest: z.enum(['off', 'daily']).default('off'),
    /** Hora LOCAL (zona de la empresa) del resumen. */
    digest_hour: z.number().int().min(0).max(23).default(8),
    /** Días del resumen (0 = domingo). Por defecto lunes a viernes. */
    digest_days: z.array(z.number().int().min(0).max(6)).max(7).default([1, 2, 3, 4, 5]),
});
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const updateNotificationPrefsSchema = z
    .object({
        email: z
            .object({
                mention: z.boolean(),
                assigned: z.boolean(),
                comment: z.boolean(),
                update: z.boolean(),
                reminder: z.boolean(),
            })
            .partial(),
        digest: z.enum(['off', 'daily']),
        digest_hour: z.number().int().min(0).max(23),
        digest_days: z.array(z.number().int().min(0).max(6)).max(7),
    })
    .partial();
export type UpdateNotificationPrefsInput = z.infer<typeof updateNotificationPrefsSchema>;

/** Lee las preferencias guardadas tolerando basura (nunca lanza). */
export function readNotificationPrefs(raw: unknown): NotificationPrefs {
    const parsed = notificationPrefsSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : notificationPrefsSchema.parse({});
}

// ─────────────────────────── Seguir y recordatorios ───────────────────────────

export interface FollowStateDto {
    following: boolean;
    followers: number;
}

export const createReminderSchema = z.object({
    list_id: idSchema.optional(),
    record_id: idSchema.optional(),
    /** Instante ISO con zona (el navegador lo arma en la hora de la persona). */
    remind_at: z.string().datetime({ offset: true }),
    note: z.string().trim().max(500).default(''),
});
export type CreateReminderInput = z.infer<typeof createReminderSchema>;

export const updateReminderSchema = z
    .object({
        remind_at: z.string().datetime({ offset: true }),
        note: z.string().trim().max(500),
        done: z.boolean(),
    })
    .partial();
export type UpdateReminderInput = z.infer<typeof updateReminderSchema>;

export interface ReminderDto {
    id: number;
    list_id: number | null;
    list_slug: string | null;
    list_name: string | null;
    record_id: number | null;
    record_title: string | null;
    remind_at: string;
    note: string;
    fired_at: string | null;
    done_at: string | null;
    created_at: string;
}

// ─────────────────────────── Mi trabajo ───────────────────────────

export interface MyWorkItem {
    list_id: number;
    list_slug: string;
    list_name: string;
    list_icon: string | null;
    list_color: string | null;
    record_id: number;
    title: string;
    /** Valor del campo de fecha elegido como vencimiento (fecha o fecha-hora). */
    due: string | null;
    due_label: string | null;
    due_is_datetime: boolean;
    status_label: string | null;
    status_color: string | null;
}

export interface MyWorkDto {
    assigned: MyWorkItem[];
    following: MyWorkItem[];
    reminders: ReminderDto[];
    /** Listas donde la persona puede tener registros asignados (tienen un campo persona). */
    lists_with_assignee: number;
    /** Se cortó algún grupo por el tope. */
    truncated: boolean;
}

// ─────────────────────────── Heurísticas puras ───────────────────────────

interface FieldLike {
    id: number;
    slug: string;
    label: string;
    type: string;
    config?: unknown;
}

const DUE_HINT = /(venc|entrega|l[ií]mite|deadline|due|plazo|cierre|fecha_?fin|hasta|pr[oó]xim)/i;
const STATUS_HINT = /(estado|status|etapa|fase|stage)/i;
const DONE_HINT =
    /(complet|terminad|terminó|hech[oa]|cerrad|resuelt|pagad|finaliz|cancelad|descartad|entregad|ganad|perdid|archivad|\bdone\b|closed|finished|resolved|cancel|won\b|lost\b)/i;

/** El campo de fecha que hace de vencimiento: el que lo dice en el nombre, o el primero. */
export function pickDueField<F extends FieldLike>(fields: readonly F[]): F | null {
    const dates = fields.filter((f) => f.type === 'date' || f.type === 'datetime');
    return dates.find((f) => DUE_HINT.test(f.slug) || DUE_HINT.test(f.label)) ?? dates[0] ?? null;
}

/** El select que hace de estado: el que lo dice en el nombre, o el primero. */
export function pickStatusField<F extends FieldLike>(fields: readonly F[]): F | null {
    const selects = fields.filter((f) => f.type === 'select');
    return selects.find((f) => STATUS_HINT.test(f.slug) || STATUS_HINT.test(f.label)) ?? selects[0] ?? null;
}

/** ¿Esta opción de estado significa "ya no hay nada que hacer"? */
export function isDoneOptionLabel(label: string): boolean {
    return DONE_HINT.test(label);
}

/** Agrupa por vencimiento respecto de HOY (fecha local `YYYY-MM-DD`). */
export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none';

export function dueBucket(due: string | null, todayYmd: string, weekEndYmd: string): DueBucket {
    if (!due) return 'none';
    const ymd = due.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return 'none';
    if (ymd < todayYmd) return 'overdue';
    if (ymd === todayYmd) return 'today';
    if (ymd <= weekEndYmd) return 'week';
    return 'later';
}
