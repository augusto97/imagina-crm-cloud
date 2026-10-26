import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ChecklistCompletedInfo } from '@imagina-base/shared';
import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { and, eq, isNull } from 'drizzle-orm';
import type Redis from 'ioredis';
import type { ApprovalEventInfo } from '../approvals/approval-hub';
import { DRIZZLE, type Db } from '../db/client';
import { automations } from '../db/schema';
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
};

/** Cuánto vive en Redis la lista de disparadores activos de una lista (se invalida al guardar). */
const TRIGGERS_CACHE_TTL_S = 300;

/**
 * Cadena de automatizaciones: un registro que escribe una automatización
 * vuelve a disparar las de su lista (la receta de facturación depende de eso:
 * «al crear la factura → avisar»), pero con un tope de profundidad y sin que
 * una automatización se re-dispare a sí misma dentro de su propia cadena.
 */
export interface AutomationChain {
    /** 1 = el cambio lo hizo una automatización disparada por una persona. */
    depth: number;
    /** Las automatizaciones que ya corrieron en esta cadena. */
    automation_ids: number[];
}

/** Profundidad máxima de una cadena de automatizaciones (A → B → C). */
export const MAX_AUTOMATION_CHAIN_DEPTH = 3;

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
    trigger: 'record_created' | 'record_updated' | 'payment_received' | 'form_submitted' | 'button_pressed' | 'approval_resolved' | 'checklist_completed';
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
    form?: { id: number; name: string };
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
    async listensTo(tenantId: number, listId: number, trigger: string): Promise<boolean> {
        const wanted = TRIGGER_TYPES_FOR_EVENT[trigger];
        if (!wanted || !this.db || !this.redis) return true;
        try {
            const [version, cached] = await this.redis.mget(versionKey(tenantId, listId), cacheKey(tenantId, listId));
            const ver = version ?? '0';
            let types: string[] | null = null;
            if (cached) {
                const parsed = JSON.parse(cached) as { v: string; types: string[] };
                if (parsed.v === ver) types = parsed.types;
            }
            if (types === null) {
                const rows = await this.db
                    .select({ type: automations.triggerType })
                    .from(automations)
                    .where(and(eq(automations.tenantId, tenantId), eq(automations.listId, listId), eq(automations.isActive, true), isNull(automations.deletedAt)));
                types = [...new Set(rows.map((r) => r.type))];
                await this.redis.set(cacheKey(tenantId, listId), JSON.stringify({ v: ver, types }), 'EX', TRIGGERS_CACHE_TTL_S);
            }
            return types.some((t) => wanted.includes(t));
        } catch (err) {
            this.logger.warn(`No se pudo consultar los disparadores de la lista ${listId}: ${String(err)}`);
            return true;
        }
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

    /** v0.1.110 — encola un disparo de webhook entrante (job 'webhook'). */
    dispatchWebhook(data: { tenantId: number; automationId: number; payload: Record<string, unknown> }): void {
        if (!this.queue) return;
        this.queue.add('webhook', data, { removeOnComplete: 1000, removeOnFail: 1000 }).catch((err) => {
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
        this.queue.add('bulk-edit', data, { removeOnComplete: 1000, removeOnFail: 1000 }).catch((err) => {
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
        this.queue.add('scheduled-batch', data, { removeOnComplete: 1000, removeOnFail: 1000 }).catch((err) => {
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
        await this.queue.add('resume', data, { removeOnComplete: 1000, removeOnFail: 1000 });
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
            await this.queue.add('event', event, { jobId, removeOnComplete: 1000, removeOnFail: 1000 });
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
            queue.add('event', event, { removeOnComplete: 1000, removeOnFail: 1000 }).catch((err) => {
                this.lost(event.tenantId, event.listId, null, 'la automatización', err);
            });
        };
        if (!this.db || !this.redis) return enqueue();
        void this.listensTo(event.tenantId, event.listId, event.trigger).then((yes) => yes && enqueue());
    }
}

const versionKey = (tenantId: number, listId: number): string => `autotrig:v:${tenantId}:${listId}`;
const cacheKey = (tenantId: number, listId: number): string => `autotrig:${tenantId}:${listId}`;
