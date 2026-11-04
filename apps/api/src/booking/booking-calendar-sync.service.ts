import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { createHash } from 'node:crypto';
import { and, asc, eq, gt, isNotNull, isNull, lte, notInArray } from 'drizzle-orm';
import { BOOKING_INACTIVE_STATUSES } from '@imagina-base/shared';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { bookingAppointments, connections, records, type BookingAppointmentRow } from '../db/schema';
import { IncidentHub } from '../incidents/incident-hub';
import { QUEUE_JOB_RETENTION, guardRedis } from '../redis/redis.util';
import { REDIS } from '../redis/redis.module';
import { BookingCalendarService, type ExternalEventState } from './booking-calendar';
import { BookingPublicService } from './booking-public.service';

const QUEUE = 'booking-calendar-sync';
/** Cada cuánto se revisan los calendarios (un cambio de quien atiende se ve en pocos minutos). */
const EVERY_MS = 3 * 60_000;
/** Citas con evento que se revisan por vuelta (las más cercanas primero). */
const MAX_APPOINTMENTS = 3000;
/** Outlook se pregunta por id: hasta tantas citas por conexión y vuelta (de a 20 por pedido). */
const GRAPH_PER_CONNECTION = 100;
/** Un cambio de menos de esto no es un cambio (redondeos de cada proveedor). */
const TOLERANCE_MS = 60_000;
/** Primera vuelta de una conexión (sin cursor): los cambios de los últimos minutos. */
const FIRST_LOOKBACK_MS = 15 * 60_000;
/** Como mucho se pide una semana hacia atrás (el servidor estuvo apagado). */
const MAX_LOOKBACK_MS = 7 * 24 * 3600_000;

export interface CalendarSyncResult {
    checked: number;
    moved: number;
    cancelled: number;
}

interface Group {
    tenantId: number;
    connectionId: number;
    provider: 'google_calendar' | 'outlook';
    calendar: string;
    appts: BookingAppointmentRow[];
}

/**
 * v0.1.350 — Sincronización de VUELTA: si quien atiende mueve o borra en su
 * Google Calendar u Outlook el evento de una cita, la cita se mueve o se
 * cancela (según `config.calendar_sync` de la página) y al cliente se le avisa
 * como cuando el equipo la cambia desde la app.
 *
 * Un scheduler de BullMQ cada 3 minutos (corre en UN nodo por disparo) junta
 * las citas vivas que tienen evento, por la conexión base (todas las
 * empresas), y por cada calendario:
 *  - Google: «qué cambió desde la última vuelta» (`updatedMin`, con los
 *    borrados) con un cursor en Redis — un pedido por calendario;
 *  - Outlook: los eventos de las citas por id, de a 20 en un `$batch`.
 * Sólo se comparan inicio y fin contra lo que la APP escribió la última vez
 * (`external_event.start/end`): un evento que la propia app movió no se toma
 * por un cambio de quien atiende. Un candado por calendario evita dos vueltas
 * a la vez.
 */
@Injectable()
export class BookingCalendarSyncService implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(BookingCalendarSyncService.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];

    constructor(
        @Inject(ENV) private readonly env: Env,
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(REDIS) private readonly redis: Redis,
        private readonly calendar: BookingCalendarService,
        private readonly publicSvc: BookingPublicService,
        @Optional() private readonly incidents?: IncidentHub,
    ) {}

    async onModuleInit(): Promise<void> {
        if (this.env.NODE_ENV === 'test') return;
        try {
            const conn = () => {
                const c = guardRedis(new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }), this.logger, QUEUE);
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue(QUEUE, { connection: conn(), defaultJobOptions: QUEUE_JOB_RETENTION });
            this.queue.on('error', (err) => this.logger.warn(`Cola de sincronización de calendarios con error: ${err.message}`));
            this.worker = new Worker(QUEUE, async () => this.tick(), { connection: conn() });
            this.worker.on('failed', (_job, err) => this.logger.error(`Sincronización de calendarios falló: ${err.message}`));
            this.worker.on('error', (err) => this.logger.warn(`Worker de sincronización de calendarios con error: ${err.message}`));
            await this.queue.upsertJobScheduler('booking-calendar-sync', { every: EVERY_MS }, { name: 'tick', data: {} });
        } catch (err) {
            this.logger.warn(`Sincronización de calendarios deshabilitada (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }

    /** Una vuelta: cuántas citas se revisaron, se movieron y se cancelaron. */
    async tick(now = new Date()): Promise<CalendarSyncResult> {
        const rows = await this.db
            .select({ appt: bookingAppointments })
            .from(bookingAppointments)
            .innerJoin(records, and(eq(records.id, bookingAppointments.recordId), isNull(records.deletedAt)))
            .where(
                and(
                    isNotNull(bookingAppointments.externalEvent),
                    notInArray(bookingAppointments.status, [...BOOKING_INACTIVE_STATUSES]),
                    gt(bookingAppointments.endAt, new Date(now.getTime() - 3600_000)),
                    lte(bookingAppointments.startAt, new Date(now.getTime() + 400 * 86_400_000)),
                ),
            )
            .orderBy(asc(bookingAppointments.startAt))
            .limit(MAX_APPOINTMENTS);
        const groups = new Map<string, Group>();
        for (const { appt } of rows) {
            const ext = appt.externalEvent;
            if (!ext?.event_id) continue;
            const calendar = ext.calendar ?? (ext.provider === 'google_calendar' ? 'primary' : '');
            const key = `${appt.tenantId}:${ext.connection_id}:${calendar}`;
            let g = groups.get(key);
            if (!g) {
                g = { tenantId: appt.tenantId, connectionId: ext.connection_id, provider: ext.provider, calendar, appts: [] };
                groups.set(key, g);
            }
            g.appts.push(appt);
        }
        const out: CalendarSyncResult = { checked: 0, moved: 0, cancelled: 0 };
        for (const g of groups.values()) {
            const r = await this.syncGroup(g, now);
            out.checked += r.checked;
            out.moved += r.moved;
            out.cancelled += r.cancelled;
        }
        return out;
    }

    private calKey(g: Group): string {
        return `${g.tenantId}:${g.connectionId}:${createHash('sha1').update(g.calendar).digest('hex').slice(0, 16)}`;
    }

    private async syncGroup(g: Group, now: Date): Promise<CalendarSyncResult> {
        const res: CalendarSyncResult = { checked: 0, moved: 0, cancelled: 0 };
        const key = this.calKey(g);
        const lock = `bookcalsync:lock:${key}`;
        const got = await this.redis.set(lock, '1', 'EX', 120, 'NX').catch(() => 'OK');
        if (got !== 'OK') return res;
        const incident = `booking-sync:${g.connectionId}`;
        try {
            let states: ExternalEventState[];
            if (g.provider === 'google_calendar') {
                const cursorKey = `bookcalsync:cursor:${key}`;
                const raw = await this.redis.get(cursorKey).catch(() => null);
                const saved = raw ? Number(raw) : NaN;
                const since = Number.isFinite(saved) ? Math.max(saved, now.getTime() - MAX_LOOKBACK_MS) : now.getTime() - FIRST_LOOKBACK_MS;
                // Un poco de solape: lo que cambió justo en el borde no se pierde (aplicar dos veces da lo mismo).
                states = await this.calendar.googleChanges(g.tenantId, g.connectionId, g.calendar, new Date(since - TOLERANCE_MS));
                await this.redis.set(cursorKey, String(now.getTime()), 'EX', 30 * 86_400).catch(() => undefined);
            } else {
                const ids = g.appts.slice(0, GRAPH_PER_CONNECTION).map((a) => a.externalEvent!.event_id);
                states = await this.calendar.graphEvents(g.tenantId, g.connectionId, ids);
            }
            const byId = new Map(states.map((s) => [s.id, s]));
            for (const appt of g.appts) {
                const ext = appt.externalEvent!;
                const st = byId.get(ext.event_id);
                if (!st) continue;
                res.checked++;
                if (st.gone) {
                    if ((await this.publicSvc.applyCalendarChange(appt, { kind: 'gone' })) === 'cancelled') res.cancelled++;
                    continue;
                }
                if (st.start === null || st.end === null) continue; // pasó a «todo el día»: se ignora
                const knownStart = Date.parse(ext.start ?? appt.startAt.toISOString());
                const knownEnd = Date.parse(ext.end ?? appt.endAt.toISOString());
                if (Math.abs(st.start - knownStart) < TOLERANCE_MS && Math.abs(st.end - knownEnd) < TOLERANCE_MS) continue;
                if (st.end <= st.start) continue;
                const done = await this.publicSvc.applyCalendarChange(appt, { kind: 'moved', start: new Date(st.start), end: new Date(st.end) });
                if (done === 'moved') res.moved++;
            }
            this.incidents?.resolve(g.tenantId, incident);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Calendario ${g.connectionId}: no se pudieron leer los cambios: ${reason}`);
            const [conn] = await this.db
                .select({ name: connections.name, owner: connections.ownerUserId })
                .from(connections)
                .where(eq(connections.id, g.connectionId))
                .limit(1)
                .catch(() => []);
            const first = g.appts[0]!;
            this.incidents?.report({
                tenantId: g.tenantId,
                key: incident,
                source: 'booking',
                sourceId: first.pageId,
                listId: first.listId,
                ownerId: conn?.owner ?? null,
                title: `La agenda no puede leer los cambios del calendario «${conn?.name ?? 'de quien atiende'}»`,
                message: `${reason} Mientras tanto, si se mueve o se borra una cita en ese calendario, la agenda no se entera: cámbiala también en la lista.`,
            });
        } finally {
            await this.redis.del(lock).catch(() => undefined);
        }
        return res;
    }
}
