import { z } from 'zod';

import { idSchema } from './common';
import { isValidTimeZone } from './timezone';

/**
 * v0.1.292 — Compartir un tablero hacia afuera (ADR-S50):
 *
 *  - **Enlace público**: una dirección de sólo lectura, sin sesión, que se
 *    puede insertar por `<iframe>` en los dominios permitidos. Los datos se
 *    calculan con el ACL de quien PUBLICÓ (si pierde el acceso o se va, el
 *    enlace responde 404 como uno desconocido).
 *  - **Envío programado**: un resumen del tablero por correo (KPIs y los
 *    valores principales de cada gráfico, con un PDF opcional), con el ACL de
 *    quien es dueño de la suscripción.
 */

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa una fecha AAAA-MM-DD.');

/** Un dominio para `frame-ancestors`: `ejemplo.com`, `*.ejemplo.com` o un origen `https://…`. */
export const embedDomainSchema = z
    .string()
    .trim()
    .min(1)
    .max(253)
    .refine(
        (d) =>
            /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/i.test(d) ||
            /^localhost(:\d{1,5})?$/i.test(d) ||
            /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?\/?$/i.test(d),
        'Escribe un dominio (ejemplo.com, *.ejemplo.com) o una dirección https://…',
    );

/** PATCH de la publicación (parcial). */
export const updatePublicDashboardSchema = z.object({
    enabled: z.boolean().optional(),
    /** Último día en que el enlace funciona (en la zona de la empresa); null = sin vencimiento. */
    expires_at: ymd.nullable().optional(),
    /** Sitios que pueden insertarlo; vacío = cualquiera. */
    allowed_domains: z.array(embedDomainSchema).max(20).optional(),
    /** Quien mira puede cambiar el período del tablero (los datos se recalculan). */
    allow_period: z.boolean().optional(),
});
export type UpdatePublicDashboardInput = z.infer<typeof updatePublicDashboardSchema>;

/** Lo que ve el panel «Compartir → Enlace público». */
export interface PublicDashboardAdmin {
    enabled: boolean;
    /** `/api/v1/public/d/<token>` (relativa al dominio de la app) o null. */
    path: string | null;
    /** Dirección absoluta lista para copiar. */
    url: string | null;
    expires_at: string | null;
    allowed_domains: string[];
    allow_period: boolean;
    published_by: { id: number; name: string } | null;
    published_at: string | null;
    /** Tiene widgets de tabla: muestran filas (registros) a cualquiera con el enlace. */
    has_tables: boolean;
}

/** El paquete que consume la página pública (sin sesión). */
export interface PublicDashboardBundle {
    name: string;
    description: string | null;
    settings: Record<string, unknown>;
    widgets: unknown[];
    /** `{ [widgetId]: data }`, igual que el bundle de la app. */
    data: Record<string, unknown>;
    /** Definiciones de los campos que usan los widgets, por lista. */
    fields: Record<string, unknown[]>;
    lists: Array<{ id: number; name: string; slug: string }>;
    /** Nombres de las personas que aparecen en los datos (id → nombre). */
    users: Record<string, string>;
    branding: { primary_color: string | null; app_name: string | null; logo_url: string | null };
    format: Record<string, unknown>;
    allow_period: boolean;
    /** Período aplicado (`''` = el de cada widget). */
    period: string;
    generated_at: string;
}

// ───────────────────────── Envío programado ─────────────────────────

export const SUBSCRIPTION_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type SubscriptionFrequency = (typeof SUBSCRIPTION_FREQUENCIES)[number];

/** Tope de destinatarios por envío (personas + correos externos). */
export const SUBSCRIPTION_MAX_RECIPIENTS = 25;

/** Día del mes «último» (cron `L`). */
export const SUBSCRIPTION_LAST_DAY = -1;

export const dashboardSubscriptionInputSchema = z
    .object({
        enabled: z.boolean().default(true),
        frequency: z.enum(SUBSCRIPTION_FREQUENCIES).default('weekly'),
        /** Días de la semana (1 = lunes … 7 = domingo) para `weekly`. */
        weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([1]),
        /** Día del mes (1-28) o -1 = el último, para `monthly`. */
        month_day: z.number().int().min(-1).max(28).refine((n) => n !== 0, 'Elige un día del mes.').default(1),
        hour: z.number().int().min(0).max(23).default(8),
        minute: z.number().int().min(0).max(59).default(0),
        /** Zona propia; null = la de la empresa. */
        time_zone: z
            .string()
            .max(64)
            .nullable()
            .default(null)
            .refine((tz) => tz === null || isValidTimeZone(tz), 'Esa zona horaria no existe.'),
        /** Miembros de la empresa que pueden ver el tablero. */
        recipient_user_ids: z.array(idSchema).max(SUBSCRIPTION_MAX_RECIPIENTS).default([]),
        /** Correos externos (opcional). */
        recipient_emails: z.array(z.string().trim().toLowerCase().email('Hay un correo con formato inválido.').max(254)).max(SUBSCRIPTION_MAX_RECIPIENTS).default([]),
        subject: z.string().trim().max(200).default(''),
        message: z.string().trim().max(2000).default(''),
        /** Adjuntar el tablero en PDF (gráficos vectoriales). */
        attach_pdf: z.boolean().default(false),
    })
    .superRefine((v, ctx) => {
        const total = new Set(v.recipient_user_ids).size + new Set(v.recipient_emails).size;
        if (total === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recipient_user_ids'], message: 'Elige al menos un destinatario.' });
        if (total > SUBSCRIPTION_MAX_RECIPIENTS) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recipient_emails'], message: `Son ${total} destinatarios: el máximo es ${SUBSCRIPTION_MAX_RECIPIENTS}.` });
        }
        if (v.frequency === 'weekly' && v.weekdays.length === 0) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['weekdays'], message: 'Elige al menos un día de la semana.' });
        }
    });
export type DashboardSubscriptionInput = z.infer<typeof dashboardSubscriptionInputSchema>;
export type DashboardSubscriptionInputRaw = z.input<typeof dashboardSubscriptionInputSchema>;

export interface DashboardSubscription extends DashboardSubscriptionInput {
    id: number;
    dashboard_id: number;
    owner: { id: number; name: string };
    /** Zona en la que corre de verdad (la propia o la de la empresa). */
    effective_time_zone: string;
    last_sent_at: string | null;
    last_status: 'sent' | 'failed' | 'skipped' | null;
    last_error: string | null;
    created_at: string;
    /** Quien mira puede cambiarla (su dueño o un admin). */
    can_edit: boolean;
}

/** El horario como cron (en la zona de la suscripción). */
export function subscriptionCron(s: Pick<DashboardSubscriptionInput, 'frequency' | 'weekdays' | 'month_day' | 'hour' | 'minute'>): string {
    const m = Math.min(59, Math.max(0, Math.trunc(s.minute)));
    const h = Math.min(23, Math.max(0, Math.trunc(s.hour)));
    if (s.frequency === 'daily') return `${m} ${h} * * *`;
    if (s.frequency === 'monthly') return `${m} ${h} ${s.month_day === SUBSCRIPTION_LAST_DAY ? 'L' : Math.min(28, Math.max(1, s.month_day))} * *`;
    // weekly: cron usa 0 = domingo.
    const days = [...new Set(s.weekdays)]
        .filter((d) => d >= 1 && d <= 7)
        .map((d) => (d === 7 ? 0 : d))
        .sort((a, b) => a - b);
    return `${m} ${h} * * ${days.length > 0 ? days.join(',') : 1}`;
}

const WEEKDAY_NAMES = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** «Cada lunes y jueves a las 08:00» — para personas. */
export function describeSubscription(s: Pick<DashboardSubscriptionInput, 'frequency' | 'weekdays' | 'month_day' | 'hour' | 'minute'>): string {
    const time = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
    if (s.frequency === 'daily') return `Todos los días a las ${time}`;
    if (s.frequency === 'monthly') {
        return s.month_day === SUBSCRIPTION_LAST_DAY ? `El último día de cada mes a las ${time}` : `El día ${s.month_day} de cada mes a las ${time}`;
    }
    const days = [...new Set(s.weekdays)].sort((a, b) => a - b);
    if (days.length === 7) return `Todos los días a las ${time}`;
    if (days.length === 5 && days.every((d, i) => d === i + 1)) return `De lunes a viernes a las ${time}`;
    const names = days.map((d) => WEEKDAY_NAMES[d] ?? '').filter(Boolean);
    const list = names.length <= 1 ? (names[0] ?? 'lunes') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
    return `Cada ${list} a las ${time}`;
}
