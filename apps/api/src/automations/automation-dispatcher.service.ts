import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { BookingEventInfo, ChecklistCompletedInfo, EmailEventInfo, SlaEventInfo, SubscriptionEventInfo, WhatsappEventInfo } from '@imagina-base/shared';
import { randomUUID } from 'node:crypto';
import type { JobsOptions, Queue } from 'bullmq';
import { and, eq, isNull } from 'drizzle-orm';
import type Redis from 'ioredis';
import type { ApprovalEventInfo } from '../approvals/approval-hub';
import { DRIZZLE, type Db } from '../db/client';
import { automations, fields as fieldsTable } from '../db/schema';
import { IncidentHub, errorText } from '../incidents/incident-hub';
import { REDIS } from '../redis/redis.module';

/**
 * Qué `trigger_type` reaccionan a cada evento de registro (el mismo mapa que
 * usa el motor al procesarlo). Un evento que no está aquí se encola siempre.
 */
const TRIGGER_TYPES_FOR_EVENT: Record<string, readonly string[]> = {
    record_created: ['record_created'],
    record_updated: ['record_updated', 'field_changed'],
    payment_received: ['payment_received'],
    form_submitted: ['form_submitted'],
    button_pressed: ['button_pressed'],
    // C5 — una solicitud de aprobación del registro se resolvió.
    approval_resolved: ['approval_resolved'],
    // A9 — un checklist del registro quedó completo.
    checklist_completed: ['checklist_completed'],
    // D5 — una cita de la agenda se agendó, se reprogramó o se canceló.
    booking_event: ['booking_event'],
    // D3 — un contacto escribió por WhatsApp (oficial).
    whatsapp_message_received: ['whatsapp_message_received'],
    // D2 — llegó un correo al buzón de la mesa de ayuda (ticket nuevo o respuesta).
    email_received: ['email_received'],
    // E5 — un SLA de la mesa de ayuda entró en riesgo o se venció.
    sla_alert: ['sla_alert'],
    // v0.1.367 — una suscripción del registro se cobró, falló, venció, se canceló…
    subscription_event: ['subscription_event'],
};

/** Cuánto vive en Redis la lista de disparadores activos de una lista (se invalida al guardar). */
const TRIGGERS_CACHE_TTL_S = 300;

/**
 * v0.1.392 — Turnos justos entre empresas en la cola de automatizaciones.
 *
 * Antes la cola era UNA fila para todos: si una empresa encolaba 50.000
 * tareas (una edición masiva, un import que actualiza, una tienda que
 * sincroniza), las automatizaciones de todas las demás esperaban detrás. Ahora
 * cada tarea de una empresa entra con prioridad = cuántas tareas de ESA
 * empresa hay pendientes (1 para la primera, 2 para la segunda…). BullMQ
 * atiende primero la prioridad más baja y, dentro de la misma, por orden de
 * llegada: la primera tarea de cada empresa sale antes que la segunda de
 * cualquiera, o sea, por turnos. El contador sube al encolar y baja al
 * terminar (`release`); vence solo a la hora sin movimiento, así un proceso
 * que se cayó a mitad no deja a nadie castigado para siempre.
 *
 * Los relojes (esperas, recurrencias) y los horarios de cada automatización
 * van sin prioridad: BullMQ los atiende antes que cualquier tarea con
 * prioridad, y son pocos y cortos.
 */
const FAIR_TTL_S = 3600;
const MAX_PRIORITY = 2_097_152;
const fairKey = (tenantId: number): string => `autoq:n:${tenantId}`;
/** Baja el contador y lo borra al llegar a cero (nunca queda negativo). */
const RELEASE_LUA = `local v = redis.call('DECR', KEYS[1]) if v <= 0 then redis.call('DEL', KEYS[1]) end return v`;
const BASE_JOB = { removeOnComplete: 1000, removeOnFail: 1000 } as const;

/**
 * Cadena de automatizaciones: un registro que escribe una automatización
 * vuelve a disparar las de su lista (la receta de facturación depende de eso:
 * «al crear la factura → avisar»), pero con un tope de profundidad y sin que
 * una automatización se re-dispare a sí misma dentro de su propia cadena.
 */
/**
 * v0.1.275 — El formulario público que se acaba de enviar (trigger
 * `form_submitted`). v0.1.386 — con su título y de dónde llegó (la página
 * desde donde se envió, el sitio anterior y la campaña), para `{{formulario.x}}`
 * y el filtro «sólo si la página contiene…».
 */
export interface FormEventInfo {
    id: number;
    name: string;
    title?: string;
    /** Lo que se sabe del origen (`page_url`, `referrer`, `utm_*`), ya limpio. */
    origin?: Record<string, string>;
}

export interface AutomationChain {
    /** 1 = el cambio lo hizo una automatización disparada por una persona. */
    depth: number;
    /** Las automatizaciones que ya corrieron en esta cadena. */
    automation_ids: number[];
}

/**
 * Profundidad máxima de una cadena de automatizaciones (A → B → C). v0.1.399 —
 * configurable por el operador con `AUTOMATIONS_MAX_CHAIN_DEPTH` (1 a 10; por
 * defecto 3). Además de la profundidad, una automatización nunca corre dos
 * veces en la misma cadena (en ningún registro), así un A → B → A no existe.
 */
export function chainDepthFromEnv(raw: string | undefined): number {
    const n = Number(raw);
    return raw !== undefined && raw.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 10 ? n : 3;
}
export const MAX_AUTOMATION_CHAIN_DEPTH = chainDepthFromEnv(process.env.AUTOMATIONS_MAX_CHAIN_DEPTH);

/** La cadena del cambio que hace `automationId` corriendo dentro de `parent`. */
export function nextChain(parent: AutomationChain | undefined, automationId: number): AutomationChain {
    const ids = parent?.automation_ids ?? [];
    return {
        depth: (parent?.depth ?? 0) + 1,
        automation_ids: ids.includes(automationId) ? ids : [...ids, automationId],
    };
}

/** Evento de trigger que se encola para el worker de automatizaciones. */
export interface TriggerEvent {
    tenantId: number;
    listId: number;
    recordId: number;
    trigger:
        | 'record_created'
        | 'record_updated'
        | 'payment_received'
        | 'form_submitted'
        | 'button_pressed'
        | 'approval_resolved'
        | 'checklist_completed'
        | 'booking_event'
        | 'whatsapp_message_received'
        | 'email_received'
        | 'sla_alert'
        | 'subscription_event';
    /** Snapshot de `data` tras la mutación (para merge tags / condición). */
    after: Record<string, unknown>;
    /** Snapshot previo (para field_changed). */
    before?: Record<string, unknown>;
    /**
     * v0.1.251 — el cobro que se acaba de pagar (trigger `payment_received`):
     * lo que la automatización usa como `{{pago.*}}`.
     */
    payment?: Record<string, unknown>;
    /**
     * v0.1.275 — el formulario público que se acaba de enviar (trigger
     * `form_submitted`): `{{formulario.nombre}}` y el filtro por formulario.
     */
    form?: FormEventInfo;
    /**
     * Campo «Botón» — el botón que se presionó (trigger `button_pressed`):
     * el filtro por botón y `{{boton.nombre}}`, `{{boton.persona}}`.
     */
    button?: { field_id: number; label: string; user_id: number; user_name: string; user_email: string };
    /**
     * C5 — la solicitud de aprobación que se resolvió (trigger
     * `approval_resolved`): el filtro por flujo y resultado y `{{aprobacion.x}}`.
     */
    approval?: ApprovalEventInfo;
    /**
     * A9 — el checklist que quedó completo (trigger `checklist_completed`): el
     * filtro por nombre o «todos», y `{{checklist.nombre}}`.
     */
    checklist?: ChecklistCompletedInfo;
    /**
     * D5 — la cita de la agenda (trigger `booking_event`): el filtro por página
     * y por evento, y `{{cita.x}}`.
     */
    booking?: BookingEventInfo;
    /**
     * D3 — el mensaje de WhatsApp que acaba de llegar (trigger
     * `whatsapp_message_received`): `{{whatsapp.texto}}`, el filtro por conexión.
     * Viaja sólo en el evento (la cola), nunca en la base.
     */
    whatsapp?: WhatsappEventInfo;
    /**
     * D2 — el correo que acaba de llegar (trigger `email_received`): el filtro
     * por ticket nuevo o respuesta y `{{correo.de}}`, `{{correo.asunto}}`…
     */
    email?: EmailEventInfo;
    /**
     * E5 — la alerta de SLA (trigger `sla_alert`): el filtro por alerta y
     * objetivo, y `{{sla.alerta}}`, `{{sla.vence}}`…
     */
    sla?: SlaEventInfo;
    /**
     * v0.1.367 — lo que pasó con la suscripción del registro (trigger
     * `subscription_event`): el filtro por evento y plan, y `{{suscripcion.x}}`.
     */
    subscription?: SubscriptionEventInfo;
    /** Sólo estas automatizaciones (un botón que corre una puntual). */
    automation_ids?: number[];
    /** El cambio lo hizo una automatización (ver `AutomationChain`). */
    chain?: AutomationChain;
}

/** Lo que devuelve el worker al procesar un evento: las corridas que abrió. */
export interface EventRunRef {
    automation_id: number;
    run_id: number;
}

/** Estado de un trabajo encolado por un botón (ver `buttonJob`). */
export interface ButtonJobState {
    state: 'queued' | 'running' | 'done' | 'unknown';
    runs: EventRunRef[];
    error: string | null;
}

/** v0.1.221 — la acción «Editar en lote» de una automatización, lista para el worker. */
export interface BulkEditJob {
    tenantId: number;
    automationId: number;
    automationName: string;
    listId: number;
    filter_tree: unknown;
    search?: string;
    operations: unknown[];
}

/**
 * Encola eventos de trigger para el motor de automatizaciones. Igual patrón
 * que RealtimeService: si la cola no está seteada (tests unitarios), es no-op.
 * Lo que escriben `update_field`/`create_record` pasa por RecordsService y
 * SÍ dispara las automatizaciones de la lista destino, con la cadena en el
 * evento (`chain`): tope de profundidad y sin auto-disparo (evita loops).
 */
@Injectable()
export class AutomationDispatcher {
    private readonly logger = new Logger(AutomationDispatcher.name);
    private queue: Queue | null = null;

    // v0.1.285 (ADR-S44) — un evento que no se pudo encolar se pierde: avisar.
    constructor(
        @Optional() private readonly incidents?: IncidentHub,
        @Optional() @Inject(DRIZZLE) private readonly db?: Db,
        @Optional() @Inject(REDIS) private readonly redis?: Redis,
    ) {}

    /**
     * ¿Hay alguna automatización ACTIVA de la lista que reaccione a este
     * evento? Antes cada alta/edición encolaba un job aunque la lista no tuviera
     * ninguna (y el worker abría una transacción para descubrirlo). Se cachea en
     * Redis por lista con un número de versión que `invalidate` sube al guardar
     * una automatización — el que calculó el caché con una versión vieja no lo
     * deja vigente. Ante cualquier duda (sin Redis, sin base, un error), true.
     */
    async listensTo(tenantId: number, listId: number, trigger: string, change?: { before?: Record<string, unknown>; after?: Record<string, unknown> }): Promise<boolean> {
        const wanted = TRIGGER_TYPES_FOR_EVENT[trigger];
        if (!wanted || !this.db || !this.redis) return true;
        try {
            const [version, cached] = await this.redis.mget(versionKey(tenantId, listId), cacheKey(tenantId, listId));
            const ver = version ?? '0';
            let entry: TriggerCache | null = null;
            if (cached) {
                const parsed = JSON.parse(cached) as Partial<TriggerCache> & { v?: string };
                // `watch` llegó en v0.1.392: un caché de antes se recalcula.
                if (parsed.v === ver && Array.isArray(parsed.types) && parsed.watch !== undefined) entry = parsed as TriggerCache;
            }
            if (entry === null) {
                entry = await this.computeTriggers(tenantId, listId, ver);
                await this.redis.set(cacheKey(tenantId, listId), JSON.stringify(entry), 'EX', TRIGGERS_CACHE_TTL_S);
            }
            if (!entry.types.some((t) => wanted.includes(t))) return false;
            // v0.1.392 — una edición que no toca NINGÚN campo que las
            // automatizaciones «al actualizar» esperan no encola nada (antes
            // encolaba siempre y el worker descubría que no coincidía).
            if (trigger === 'record_updated' && entry.watch !== null && change?.before && change.after) {
                return changedKeys(change.before, change.after).some((k) => entry!.watch!.includes(k));
            }
            return true;
        } catch (err) {
            this.logger.warn(`No se pudo consultar los disparadores de la lista ${listId}: ${String(err)}`);
            return true;
        }
    }

    /**
     * Los disparadores activos de la lista y, para «al actualizar», qué campos
     * esperan (`watch`, por clave `f{id}`). `watch = null` = alguna reacciona a
     * cualquier cambio, o un campo que espera no existe hoy (por las dudas, se
     * encola siempre: el motor decide).
     */
    private async computeTriggers(tenantId: number, listId: number, v: string): Promise<TriggerCache> {
        const db = this.db!;
        const rows = await db
            .select({ type: automations.triggerType, config: automations.triggerConfig })
            .from(automations)
            .where(and(eq(automations.tenantId, tenantId), eq(automations.listId, listId), eq(automations.isActive, true), isNull(automations.deletedAt)));
        const types = [...new Set(rows.map((r) => r.type))];
        const onUpdate = rows.filter((r) => UPDATE_TRIGGER_TYPES.includes(r.type));
        let watch: string[] | null = null;
        if (onUpdate.length > 0) {
            const wantedSlugs = onUpdate.map((r) => watchedSlugs((r.config ?? {}) as Record<string, unknown>));
            if (wantedSlugs.every((w) => w.length > 0)) {
                const fieldRows = await db
                    .select({ id: fieldsTable.id, slug: fieldsTable.slug })
                    .from(fieldsTable)
                    .where(and(eq(fieldsTable.tenantId, tenantId), eq(fieldsTable.listId, listId), isNull(fieldsTable.deletedAt)));
                const keyOf = new Map(fieldRows.map((f) => [f.slug, `f${f.id}`]));
                const slugs = [...new Set(wantedSlugs.flat())];
                if (slugs.every((sl) => keyOf.has(sl))) watch = slugs.map((sl) => keyOf.get(sl)!);
            }
        }
        return { v, types, watch };
    }

    /** Las automatizaciones de la lista cambiaron (alta, edición, pausa, baja). */
    async invalidate(tenantId: number, listId: number): Promise<void> {
        if (!this.redis) return;
        await this.redis
            .incr(versionKey(tenantId, listId))
            .catch((err: unknown) => this.logger.warn(`No se pudo invalidar el caché de disparadores: ${String(err)}`));
    }

    private lost(tenantId: number, listId: number | null, automationId: number | null, what: string, err: unknown): void {
        this.logger.error(`No se pudo encolar ${what}: ${String(err)}`);
        this.incidents?.report({
            tenantId,
            key: automationId ? `automation:${automationId}` : `automations:list:${listId ?? 0}`,
            source: 'automation',
            sourceId: automationId,
            listId,
            title: automationId ? 'Una automatización no se pudo poner en marcha' : 'Las automatizaciones de una lista no se pudieron poner en marcha',
            message: `No se pudo encolar ${what} (la cola de tareas del servidor no responde): ${errorText(err)}`,
        });
    }

    setQueue(queue: Queue): void {
        this.queue = queue;
    }

    /** v0.1.392 — encola con el turno de la empresa (ver `FAIR_TTL_S`). */
    private async addFair(name: string, data: { tenantId: number }, opts: JobsOptions = {}): Promise<void> {
        const queue = this.queue;
        if (!queue) return;
        const priority = await this.takeTurn(data.tenantId);
        try {
            await queue.add(name, data, { ...BASE_JOB, ...opts, ...(priority ? { priority } : {}) });
        } catch (err) {
            if (priority) await this.release(data.tenantId);
            throw err;
        }
    }

    /** El turno de la próxima tarea de la empresa (null sin Redis: sin prioridad). */
    private async takeTurn(tenantId: number): Promise<number | null> {
        if (!this.redis) return null;
        try {
            const res = await this.redis.multi().incr(fairKey(tenantId)).expire(fairKey(tenantId), FAIR_TTL_S).exec();
            const n = Number(res?.[0]?.[1]);
            return Number.isFinite(n) && n > 0 ? Math.min(MAX_PRIORITY, n) : null;
        } catch {
            return null;
        }
    }

    /** Una tarea de la empresa terminó (bien o mal): su turno se libera. */
    async release(tenantId: number): Promise<void> {
        if (!this.redis) return;
        await this.redis.eval(RELEASE_LUA, 1, fairKey(tenantId)).catch(() => undefined);
    }

    /** v0.1.110 — encola un disparo de webhook entrante (job 'webhook'). */
    dispatchWebhook(data: { tenantId: number; automationId: number; payload: Record<string, unknown> }): void {
        if (!this.queue) return;
        this.addFair('webhook', data).catch((err) => {
            this.lost(data.tenantId, null, data.automationId, 'el webhook entrante', err);
        });
    }

    /**
     * v0.1.221 — encola la acción «Editar en lote» de una automatización
     * (job 'bulk-edit'). Corre FUERA de la transacción del motor: si no, las
     * escrituras de la edición esperarían locks que esa misma transacción
     * tiene tomados (p. ej. un «Actualizar campo» previo sobre el registro).
     * Devuelve false si no hay cola (sin Redis): la acción falla con motivo.
     */
    dispatchBulkEdit(data: BulkEditJob): boolean {
        if (!this.queue) return false;
        this.addFair('bulk-edit', data).catch((err) => {
            this.lost(data.tenantId, data.listId, data.automationId, 'la edición en lote', err);
        });
        return true;
    }

    /**
     * v0.1.288 — una tanda de un horario «para cada registro» (job
     * 'scheduled-batch'). false si no hay cola: el motor la corre en el acto.
     */
    dispatchScheduledBatch(data: { tenantId: number; automationId: number; recordIds: number[] }): boolean {
        if (!this.queue) return false;
        this.addFair('scheduled-batch', data).catch((err) => {
            this.lost(data.tenantId, null, data.automationId, 'una tanda del horario «para cada registro»', err);
        });
        return true;
    }

    /**
     * v0.1.288 — reanudar una corrida que terminó su espera (job 'resume').
     * El reloj de las esperas ya la pasó a `running`; si no se puede encolar,
     * el llamador la devuelve a `waiting`.
     */
    async dispatchResume(data: { tenantId: number; runId: number }): Promise<boolean> {
        if (!this.queue) return false;
        await this.addFair('resume', data);
        return true;
    }

    /**
     * Campo «Botón» — encola el evento `button_pressed` con un id propio, para
     * que la interfaz pueda preguntar cómo terminaron las automatizaciones
     * (`buttonJob`). Sin el atajo de `listensTo`: quien presiona ya eligió
     * qué automatizaciones corren. null = no hay cola (sin Redis).
     */
    async dispatchButton(event: TriggerEvent): Promise<string | null> {
        if (!this.queue) return null;
        const jobId = `btn-${event.tenantId}-${randomUUID()}`;
        try {
            await this.addFair('event', event, { jobId });
            return jobId;
        } catch (err) {
            this.lost(event.tenantId, event.listId, null, 'la automatización del botón', err);
            throw err;
        }
    }

    /** Estado del trabajo de un botón (sólo los de esta empresa: el id la lleva). */
    async buttonJob(tenantId: number, jobId: string): Promise<ButtonJobState> {
        if (!this.queue || !jobId.startsWith(`btn-${tenantId}-`)) return { state: 'unknown', runs: [], error: null };
        const job = await this.queue.getJob(jobId);
        if (!job) return { state: 'unknown', runs: [], error: null };
        const st = await job.getState();
        if (st === 'completed') {
            const value = job.returnvalue as unknown;
            const runs = Array.isArray(value) ? (value as EventRunRef[]).filter((r) => typeof r?.run_id === 'number') : [];
            return { state: 'done', runs, error: null };
        }
        if (st === 'failed') return { state: 'done', runs: [], error: job.failedReason ?? 'Falló' };
        if (st === 'active') return { state: 'running', runs: [], error: null };
        return { state: 'queued', runs: [], error: null };
    }

    dispatch(event: TriggerEvent): void {
        const queue = this.queue;
        if (!queue) return;
        const enqueue = (): void => {
            this.addFair('event', event).catch((err) => {
                this.lost(event.tenantId, event.listId, null, 'la automatización', err);
            });
        };
        if (!this.db || !this.redis) return enqueue();
        void this.listensTo(event.tenantId, event.listId, event.trigger, { before: event.before, after: event.after }).then((yes) => yes && enqueue());
    }
}

interface TriggerCache {
    v: string;
    types: string[];
    watch: string[] | null;
}

/** Los disparadores que reaccionan a un `record_updated`. */
const UPDATE_TRIGGER_TYPES: readonly string[] = TRIGGER_TYPES_FOR_EVENT.record_updated ?? [];

/** Los campos (slugs) que espera una automatización «al actualizar» (vacío = cualquier cambio). Igual que el motor. */
export function watchedSlugs(cfg: Record<string, unknown>): string[] {
    const cf = cfg.changed_fields;
    if (Array.isArray(cf)) return cf.map((x) => String(x)).filter(Boolean);
    if (typeof cfg.field === 'string' && cfg.field !== '') return [cfg.field];
    return [];
}

/** Las claves `f{id}` cuyo valor cambió. */
export function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}

const versionKey = (tenantId: number, listId: number): string => `autotrig:v:${tenantId}:${listId}`;
const cacheKey = (tenantId: number, listId: number): string => `autotrig:${tenantId}:${listId}`;
