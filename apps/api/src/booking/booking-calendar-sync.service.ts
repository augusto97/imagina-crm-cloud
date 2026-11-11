import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { createHash } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, notInArray, sql } from 'drizzle-orm';
import { BOOKING_INACTIVE_STATUSES } from '@imagina-base/shared';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { mapLimit } from '../common/map-limit';
import { DRIZZLE, type Db } from '../db/client';
import { bookingAppointments, connections, records, type BookingAppointmentRow } from '../db/schema';
import { IncidentHub } from '../incidents/incident-hub';
import { QUEUE_JOB_RETENTION, guardRedis } from '../redis/redis.util';
import { REDIS } from '../redis/redis.module';
import { BookingCalendarService, type ExternalEventState } from './booking-calendar';
import { BookingPublicService } from './booking-public.service';
import { createWorker, isShuttingDown, registerScheduler } from '../redis/queue-runtime';
import { acquireRedisLock, releaseRedisLock } from '../redis/redis-lock';

const QUEUE = 'booking-calendar-sync';
/** Cada cuánto se revisan los calendarios (un cambio de quien atiende se ve en pocos minutos). */
const EVERY_MS = 3 * 60_000;
/** Calendarios que se revisan por vuelta; los demás, en la siguiente (cursor en Redis). */
const MAX_GROUPS_PER_RUN = 1500;
/** Tope de tiempo de una vuelta (menos que el intervalo, para no pisarse con la siguiente). */
const RUN_BUDGET_MS = 150_000;
const ROTATION_KEY = 'bookcalsync:next';
const CALENDAR_SQL = sql`COALESCE(a.external_event->>'calendar', CASE WHEN a.external_event->>'provider' = 'google_calendar' THEN 'primary' ELSE '' END)`;

function rowsOf<T>(res: unknown): T[] {
    return (res as { rows?: T[] }).rows ?? (res as T[]) ?? [];
}
/** Outlook se pregunta por id: hasta tantas citas por conexión y vuelta (de a 20 por pedido). */
const GRAPH_PER_CONNECTION = 100;
/** v0.1.393 — calendarios que se revisan a la vez. */
const GROUP_CONCURRENCY = 6;
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
            this.worker = createWorker(QUEUE, async () => this.tick(), { connection: conn() });
            this.worker?.on('failed', (_job, err) => this.logger.error(`Sincronización de calendarios falló: ${err.message}`));
            this.worker?.on('error', (err) => this.logger.warn(`Worker de sincronización de calendarios con error: ${err.message}`));
            registerScheduler(this.queue, 'booking-calendar-sync', { every: EVERY_MS }, { name: 'tick', data: {} }, this.logger);
        } catch (err) {
            this.logger.warn(`Sincronización de calendarios deshabilitada (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }

    /**
     * Una vuelta: cuántas citas se revisaron, se movieron y se cancelaron.
     *
     * Antes se traían las primeras 3000 citas con evento de TODA la plataforma
     * (por fecha) y se agrupaban en memoria: pasado ese número, las citas más
     * lejanas no se comparaban nunca y —peor— el cursor de «qué cambió» de su
     * calendario avanzaba igual, así que un cambio hecho a una cita fuera de
     * las 3000 se perdía. Ahora la unidad es el CALENDARIO: se listan los
     * calendarios con citas vivas (una fila por calendario, no por cita), se
     * recorren en orden con un tope por vuelta y un cursor en Redis (la vuelta
     * siguiente sigue donde quedó ésta), y las citas de cada uno se buscan por
     * el id de los eventos que cambiaron.
     */
    async tick(now = new Date(), opts: { maxGroups?: number; budgetMs?: number } = {}): Promise<CalendarSyncResult> {
        const res = await this.db.execute<{ tenant_id: number; connection_id: number; provider: string; calendar: string }>(sql`
            SELECT a.tenant_id, (a.external_event->>'connection_id')::bigint AS connection_id,
                   a.external_event->>'provider' AS provider, ${CALENDAR_SQL} AS calendar
            FROM booking_appointments a
            JOIN records r ON r.id = a.record_id AND r.deleted_at IS NULL
            WHERE ${this.liveSql(now)}
            GROUP BY 1, 2, 3, 4
            ORDER BY 1, 2, 4
        `);
        const all: Group[] = rowsOf<{ tenant_id: number; connection_id: number; provider: string; calendar: string }>(res).map((r) => ({
            tenantId: Number(r.tenant_id),
            connectionId: Number(r.connection_id),
            provider: r.provider === 'google_calendar' ? 'google_calendar' : 'outlook',
            calendar: r.calendar ?? '',
        }));
        const out: CalendarSyncResult = { checked: 0, moved: 0, cancelled: 0 };
        if (all.length === 0) return out;
        // Mismo orden que el cursor (por su clave).
        all.sort((x, y) => (this.calKey(x) < this.calKey(y) ? -1 : 1));
        // Sigue después del último calendario de la vuelta anterior.
        const last = await this.redis.get(ROTATION_KEY).catch(() => null);
        const startAt = last ? all.findIndex((g) => this.calKey(g) > last) : 0;
        const ordered = startAt > 0 ? [...all.slice(startAt), ...all.slice(0, startAt)] : all;
        const maxGroups = Math.max(1, opts.maxGroups ?? MAX_GROUPS_PER_RUN);
        const deadline = Date.now() + (opts.budgetMs ?? RUN_BUDGET_MS);
        let done = 0;
        while (done < ordered.length && done < maxGroups && Date.now() < deadline && !isShuttingDown()) {
            // v0.1.393 — varios calendarios a la vez (cada uno es esperar a Google
            // o a Microsoft con la cuenta de SU empresa).
            const slice = ordered.slice(done, Math.min(ordered.length, maxGroups, done + GROUP_CONCURRENCY * 4));
            await mapLimit(slice, GROUP_CONCURRENCY, async (g) => {
                const r = await this.syncGroup(g, now);
                out.checked += r.checked;
                out.moved += r.moved;
                out.cancelled += r.cancelled;
            });
            done += slice.length;
        }
        if (done >= ordered.length) await this.redis.del(ROTATION_KEY).catch(() => undefined);
        else await this.redis.set(ROTATION_KEY, this.calKey(ordered[done - 1]!), 'EX', 86_400).catch(() => undefined);
        return out;
    }

    /** Citas vivas con evento en un calendario (alias `a`). */
    private liveSql(now: Date) {
        return sql`a.external_event IS NOT NULL AND a.external_event->>'event_id' IS NOT NULL
            AND a.status NOT IN (${sql.join([...BOOKING_INACTIVE_STATUSES].map((st) => sql`${st}`), sql`, `)})
            AND a.end_at > ${new Date(now.getTime() - 3600_000).toISOString()}::timestamptz
            AND a.start_at <= ${new Date(now.getTime() + 400 * 86_400_000).toISOString()}::timestamptz`;
    }

    private groupWhere(g: Group, now: Date) {
        return and(
            eq(bookingAppointments.tenantId, g.tenantId),
            isNotNull(bookingAppointments.externalEvent),
            notInArray(bookingAppointments.status, [...BOOKING_INACTIVE_STATUSES]),
            gt(bookingAppointments.endAt, new Date(now.getTime() - 3600_000)),
            lte(bookingAppointments.startAt, new Date(now.getTime() + 400 * 86_400_000)),
            sql`(${bookingAppointments.externalEvent}->>'connection_id')::bigint = ${g.connectionId}`,
            sql`COALESCE(${bookingAppointments.externalEvent}->>'calendar', CASE WHEN ${bookingAppointments.externalEvent}->>'provider' = 'google_calendar' THEN 'primary' ELSE '' END) = ${g.calendar}`,
        );
    }

    /** Las citas de un calendario cuyo evento está entre `eventIds`. */
    private async apptsByEvent(g: Group, now: Date, eventIds: string[]): Promise<BookingAppointmentRow[]> {
        const out: BookingAppointmentRow[] = [];
        for (let i = 0; i < eventIds.length; i += 500) {
            const chunk = eventIds.slice(i, i + 500);
            const rows = await this.db
                .select({ appt: bookingAppointments })
                .from(bookingAppointments)
                .innerJoin(records, and(eq(records.id, bookingAppointments.recordId), isNull(records.deletedAt)))
                .where(and(this.groupWhere(g, now), inArray(sql<string>`${bookingAppointments.externalEvent}->>'event_id'`, chunk)));
            out.push(...rows.map((r) => r.appt));
        }
        return out;
    }

    /**
     * Outlook se pregunta por id: hasta `GRAPH_PER_CONNECTION` citas por vuelta,
     * siguiendo desde la última (cursor por calendario) para que un calendario
     * con más citas que el tope las recorra todas en vueltas sucesivas.
     */
    private async graphAppts(g: Group, now: Date, key: string): Promise<BookingAppointmentRow[]> {
        const cursorKey = `bookcalsync:gcur:${key}`;
        const after = Number(await this.redis.get(cursorKey).catch(() => null)) || 0;
        const page = async (afterId: number) =>
            (
                await this.db
                    .select({ appt: bookingAppointments })
                    .from(bookingAppointments)
                    .innerJoin(records, and(eq(records.id, bookingAppointments.recordId), isNull(records.deletedAt)))
                    .where(and(this.groupWhere(g, now), gt(bookingAppointments.id, afterId)))
                    .orderBy(asc(bookingAppointments.id))
                    .limit(GRAPH_PER_CONNECTION)
            ).map((r) => r.appt);
        let rows = await page(after);
        if (rows.length === 0 && after > 0) rows = await page(0);
        if (rows.length < GRAPH_PER_CONNECTION) await this.redis.del(cursorKey).catch(() => undefined);
        else await this.redis.set(cursorKey, String(rows[rows.length - 1]!.id), 'EX', 7 * 86_400).catch(() => undefined);
        return rows;
    }

    private calKey(g: Group): string {
        return `${g.tenantId}:${g.connectionId}:${createHash('sha1').update(g.calendar).digest('hex').slice(0, 16)}`;
    }

    private async syncGroup(g: Group, now: Date): Promise<CalendarSyncResult> {
        const res: CalendarSyncResult = { checked: 0, moved: 0, cancelled: 0 };
        const key = this.calKey(g);
        const lock = `bookcalsync:lock:${key}`;
        // Candado con dueño: un error de Redis NO cuenta como tomado, y al
        // terminar sólo se suelta si sigue siendo de esta vuelta.
        const token = await acquireRedisLock(this.redis, lock, 120);
        if (!token) return res;
        const incident = `booking-sync:${g.connectionId}`;
        let appts: BookingAppointmentRow[] = [];
        try {
            let states: ExternalEventState[];
            if (g.provider === 'google_calendar') {
                const cursorKey = `bookcalsync:cursor:${key}`;
                const raw = await this.redis.get(cursorKey).catch(() => null);
                const saved = raw ? Number(raw) : NaN;
                const since = Number.isFinite(saved) ? Math.max(saved, now.getTime() - MAX_LOOKBACK_MS) : now.getTime() - FIRST_LOOKBACK_MS;
                // Un poco de solape: lo que cambió justo en el borde no se pierde (aplicar dos veces da lo mismo).
                states = await this.calendar.googleChanges(g.tenantId, g.connectionId, g.calendar, new Date(since - TOLERANCE_MS));
                // Las citas se buscan por los eventos que cambiaron: TODAS las de
                // este calendario quedan cubiertas, sean cuantas sean. El cursor
                // avanza recién después de leerlas.
                appts = states.length ? await this.apptsByEvent(g, now, states.map((st) => st.id)) : [];
                await this.redis.set(cursorKey, String(now.getTime()), 'EX', 30 * 86_400).catch(() => undefined);
            } else {
                appts = await this.graphAppts(g, now, key);
                states = await this.calendar.graphEvents(g.tenantId, g.connectionId, appts.map((a) => a.externalEvent!.event_id));
            }
            const byId = new Map(states.map((s) => [s.id, s]));
            for (const appt of appts) {
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
            const [first] = appts.length
                ? appts
                : await this.db
                      .select({ pageId: bookingAppointments.pageId, listId: bookingAppointments.listId })
                      .from(bookingAppointments)
                      .where(this.groupWhere(g, now))
                      .limit(1)
                      .catch(() => []);
            if (!first) return res;
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
            await releaseRedisLock(this.redis, lock, token);
        }
        return res;
    }
}
