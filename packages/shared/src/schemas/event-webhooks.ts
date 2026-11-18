import { z } from 'zod';

/**
 * v0.1.442 (G1, ADR-S105) — Webhooks de eventos: la app le AVISA a otro
 * programa (n8n, Make, Zapier, un ERP) cuando pasa algo, con un POST firmado a
 * su dirección. Es el camino inverso de la API: en vez de preguntar cada rato
 * «¿hay registros nuevos?», el otro sistema se entera en el momento.
 *
 * Una suscripción es de la EMPRESA pero actúa como la persona que la creó
 * (igual que un token de la API): sólo manda lo que esa persona puede ver.
 */

export const WEBHOOK_EVENTS = ['record.created', 'record.updated', 'record.deleted', 'form.submitted', 'payment.received'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, { label: string; description: string }> = {
    'record.created': { label: 'Se crea un registro', description: 'Desde la pantalla, un formulario, una automatización, la API o una importación.' },
    'record.updated': { label: 'Cambia un registro', description: 'Trae qué campos cambiaron, con el valor de antes y el de ahora.' },
    'record.deleted': { label: 'Se borra un registro', description: 'Va a la papelera. Trae el id y la lista.' },
    'form.submitted': { label: 'Se envía un formulario', description: 'Con el formulario y el registro que creó.' },
    'payment.received': { label: 'Se recibe un pago', description: 'Un link de pago se pagó: con el monto, el medio y el registro.' },
};

/** Cuántas suscripciones puede tener una empresa. */
export const MAX_WEBHOOK_SUBSCRIPTIONS = 25;

/**
 * Espera antes de cada reintento, en segundos (1 min, 5 min, 30 min, 2 h,
 * 6 h, 12 h): siete intentos en ~21 horas. Después la entrega queda «Falló».
 */
export const WEBHOOK_RETRY_DELAYS_S = [60, 300, 1800, 7200, 21_600, 43_200] as const;

/** Intentos de entrega fallidos SEGUIDOS (de cualquier aviso) que pausan la suscripción. */
export const WEBHOOK_DISABLE_AFTER_FAILURES = 20;

export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'success', 'failed', 'skipped'] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

const webhookUrl = z
    .string()
    .trim()
    .min(1, 'Escribe la dirección')
    .max(2000, 'La dirección es demasiado larga')
    .refine((v) => /^https?:\/\/[^\s/?#]+[^\s]*$/i.test(v), 'Escribe una dirección completa, que empiece con https://');

const listIds = z.array(z.number().int().positive()).min(1).max(50).nullable();

export const createWebhookSubscriptionSchema = z.object({
    name: z.string().trim().max(80).optional(),
    url: webhookUrl,
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'Elige al menos un evento').max(WEBHOOK_EVENTS.length),
    /** `null` (o sin el campo) = todas las listas que ve quien la crea. */
    list_ids: listIds.optional(),
});
export type CreateWebhookSubscriptionInput = z.infer<typeof createWebhookSubscriptionSchema>;

export const updateWebhookSubscriptionSchema = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    url: webhookUrl.optional(),
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'Elige al menos un evento').max(WEBHOOK_EVENTS.length).optional(),
    list_ids: listIds.optional(),
    /** Encender o pausar. Encender de nuevo una suscripción pausada por fallas reinicia la cuenta. */
    active: z.boolean().optional(),
});
export type UpdateWebhookSubscriptionInput = z.infer<typeof updateWebhookSubscriptionSchema>;

export interface WebhookSubscriptionDto {
    id: number;
    name: string;
    url: string;
    events: WebhookEvent[];
    list_ids: number[] | null;
    active: boolean;
    /** Por qué se pausó sola (fallas seguidas, la dirección respondió 410, quien la creó perdió el acceso). */
    disabled_reason: string | null;
    /** Los últimos 4 caracteres del secreto de firma. */
    secret_hint: string;
    created_by: number;
    created_by_name: string | null;
    /** `app` = Ajustes → API; `api` = la registró un programa (n8n) con un token. */
    source: 'app' | 'api';
    consecutive_failures: number;
    last_delivery_at: string | null;
    last_status: WebhookDeliveryStatus | null;
    created_at: string;
    updated_at: string;
}

/** Al crear o rotar el secreto: el secreto completo, una sola vez. */
export interface CreatedWebhookSubscriptionDto extends WebhookSubscriptionDto {
    secret: string;
}

export interface WebhookDeliveryDto {
    id: number;
    event_id: string;
    event: WebhookEvent | 'ping';
    record_id: number | null;
    list_id: number | null;
    status: WebhookDeliveryStatus;
    attempts: number;
    response_status: number | null;
    /** Lo primero que contestó el otro sistema (hasta 2 KB). */
    response_body: string | null;
    error: string | null;
    created_at: string;
    delivered_at: string | null;
    next_attempt_at: string | null;
}

/** El resultado de «Enviar una prueba». */
export interface WebhookTestResultDto {
    ok: boolean;
    status: number | null;
    body: string | null;
    error: string | null;
    duration_ms: number;
}

/**
 * La espera del reintento número `attempt` (1 = el primero que falló). `null`
 * = no hay más reintentos.
 */
export function webhookRetryDelay(attempt: number): number | null {
    return WEBHOOK_RETRY_DELAYS_S[attempt - 1] ?? null;
}

/**
 * ¿Se reintenta una respuesta? La red caída, un timeout, un 408, un 429 y los
 * 5xx sí; un 4xx es un «no» del otro sistema y repetirlo no lo cambia. Un 410
 * además pausa la suscripción (así se desuscribe n8n o Zapier).
 */
export function webhookShouldRetry(status: number | null): boolean {
    if (status === null || status === 0) return true;
    if (status === 408 || status === 429) return true;
    return status >= 500;
}
