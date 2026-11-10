import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { and, eq, gt, lte, inArray, sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { bookingAppointments, bookingPages } from '../db/schema';
import { QUEUE_JOB_RETENTION, guardRedis } from '../redis/redis.util';
import { readBookingConfig } from './booking-config';
import { BookingPublicService } from './booking-public.service';

const QUEUE = 'booking-reminders';
/** Recordatorios hasta dos semanas antes (el máximo que deja configurar la página). */
const LOOKAHEAD_MS = 14 * 24 * 3600 * 1000 + 3600 * 1000;
const BATCH = 200;
/** Tandas por barrido: hasta 2.000 recordatorios por minuto (lo que quede, al minuto siguiente). */
const MAX_ROUNDS = 10;

interface ReminderSpec {
    pageId: number;
    id: string;
    minutes: number;
    needsEmail: boolean;
}
/** v0.1.353 — Sólo las citas confirmadas reciben recordatorios (una por confirmar, todavía no). */
const LIVE_STATUSES = ['confirmed', 'rescheduled'];

/**
 * D5 — Recordatorios de las citas al cliente («24 h antes», «1 h antes»). Un
 * scheduler de BullMQ cada minuto (vive en Redis: sobrevive reinicios y corre
 * en UN nodo por disparo) recorre las citas vivas que empiezan pronto, por la
 * conexión base (todas las empresas), y por cada recordatorio vencido lo
 * RECLAMA con un UPDATE condicional — `reminders_sent` suma el id sólo si no
 * estaba — antes de mandarlo: aunque dos nodos corran el barrido a la vez,
 * cada recordatorio sale UNA vez.
 */
@Injectable()
export class BookingRemindersService implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(BookingRemindersService.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];

    constructor(
        @Inject(ENV) private readonly env: Env,
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly publicSvc: BookingPublicService,
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
            this.queue.on('error', (err) => this.logger.warn(`Cola de recordatorios de citas con error: ${err.message}`));
            // v0.1.353 — en el mismo barrido vencen las citas por confirmar que nadie decidió.
            this.worker = new Worker(
                QUEUE,
                async () => {
                    await this.tick();
                    await this.publicSvc.expirePending();
                    // v0.1.387 — y se liberan las que esperaban el pago y no pagaron a tiempo.
                    await this.publicSvc.expireUnpaid();
                },
                { connection: conn() },
            );
            this.worker.on('failed', (_job, err) => this.logger.error(`Recordatorios de citas fallaron: ${err.message}`));
            this.worker.on('error', (err) => this.logger.warn(`Worker de recordatorios de citas con error: ${err.message}`));
            await this.queue.upsertJobScheduler('booking-reminders', { every: 60_000 }, { name: 'tick', data: {} });
        } catch (err) {
            this.logger.warn(`Recordatorios de citas deshabilitados (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }

    /**
     * Un barrido: devuelve cuántos recordatorios salieron.
     *
     * v0.1.393 — Antes se traían las primeras 200 citas vivas de las próximas
     * dos semanas (de TODAS las empresas, por fecha) y recién después se
     * descartaban las que ya tenían su recordatorio. Con más de 200 citas en la
     * ventana, las primeras 200 —casi siempre ya avisadas— tapaban a las demás:
     * el «24 horas antes» de una cita de mañana podía salir tarde o no salir.
     * Ahora el filtro va en la consulta: sólo vuelven las citas con un
     * recordatorio VENCIDO y no enviado (según la configuración de su página),
     * y se repiten tandas hasta vaciar lo pendiente (tope por barrido).
     */
    async tick(now = new Date()): Promise<number> {
        const specs = await this.reminderSpecs(now);
        if (specs.length === 0) return 0;
        let sent = 0;
        for (let round = 0; round < MAX_ROUNDS; round++) {
            const ids = await this.dueAppointmentIds(specs, now);
            if (ids.length === 0) break;
            const r = await this.sendRound(ids, now);
            sent += r.sent;
            // Nada se pudo reclamar (cambió la cita o su página entre medio):
            // volver a pedir traería lo mismo.
            if (r.claimed === 0 || ids.length < BATCH) break;
        }
        return sent;
    }

    /**
     * Los recordatorios de cada página que tiene citas vivas en la ventana
     * (pocas filas: una por agenda en uso, no por cita).
     */
    private async reminderSpecs(now: Date): Promise<ReminderSpec[]> {
        const live = this.db
            .selectDistinct({ id: bookingAppointments.pageId })
            .from(bookingAppointments)
            .where(
                and(
                    inArray(bookingAppointments.status, LIVE_STATUSES),
                    gt(bookingAppointments.startAt, now),
                    lte(bookingAppointments.startAt, new Date(now.getTime() + LOOKAHEAD_MS)),
                ),
            );
        const pages = await this.db.select({ id: bookingPages.id, config: bookingPages.config }).from(bookingPages).where(inArray(bookingPages.id, live));
        const out: ReminderSpec[] = [];
        for (const p of pages) {
            const cfg = readBookingConfig(p.config);
            // Sin SMS, una cita sin correo no tiene a quién avisar: ni se trae.
            const needsEmail = !this.publicSvc.smsRemindersOn(cfg);
            for (const r of cfg.notifications.reminders) out.push({ pageId: p.id, id: r.id, minutes: r.minutes_before, needsEmail });
        }
        return out;
    }

    /** Las citas con al menos un recordatorio vencido y sin enviar, las más próximas primero. */
    private async dueAppointmentIds(specs: ReminderSpec[], now: Date): Promise<number[]> {
        const values = sql.join(
            specs.map((r) => sql`(${r.pageId}::bigint, ${r.id}::text, ${r.minutes}::int, ${r.needsEmail}::boolean)`),
            sql`, `,
        );
        const res = await this.db.execute<{ id: number }>(sql`
            SELECT a.id, MIN(a.start_at) AS start_at
            FROM booking_appointments a
            JOIN (VALUES ${values}) AS v(page_id, rem_id, minutes, needs_email) ON v.page_id = a.page_id
            WHERE a.status IN (${sql.join(LIVE_STATUSES.map((st) => sql`${st}`), sql`, `)})
              AND a.start_at > ${now}
              AND a.start_at <= ${now}::timestamptz + make_interval(mins => v.minutes)
              AND NOT (coalesce(a.reminders_sent, '[]'::jsonb) ? v.rem_id)
              AND (NOT v.needs_email OR coalesce(a.client_email, '') <> '')
              AND EXISTS (SELECT 1 FROM records r WHERE r.id = a.record_id AND r.deleted_at IS NULL)
            GROUP BY a.id
            ORDER BY MIN(a.start_at), a.id
            LIMIT ${BATCH}
        `);
        const rows = (res as unknown as { rows?: Array<{ id: number }> }).rows ?? (res as unknown as Array<{ id: number }>);
        return rows.map((r) => Number(r.id));
    }

    private async sendRound(ids: number[], now: Date): Promise<{ sent: number; claimed: number }> {
        const rows = await this.db
            .select({ appt: bookingAppointments, config: bookingPages.config })
            .from(bookingAppointments)
            .innerJoin(bookingPages, eq(bookingPages.id, bookingAppointments.pageId))
            .where(inArray(bookingAppointments.id, ids))
            .orderBy(bookingAppointments.startAt);
        let sent = 0;
        let claimedCount = 0;
        for (const { appt, config } of rows) {
            const cfg = readBookingConfig(config);
            // SMS (ADR-S82): sin correo igual sale el SMS (el cliente pudo dejar sólo el teléfono).
            const bySms = this.publicSvc.smsRemindersOn(cfg);
            if (!appt.clientEmail && !bySms) continue;
            const done = new Set(appt.remindersSent ?? []);
            const due = cfg.notifications.reminders.filter(
                (r) => !done.has(r.id) && appt.startAt.getTime() - r.minutes_before * 60_000 <= now.getTime(),
            );
            if (due.length === 0) continue;
            const ids = due.map((r) => r.id);
            // Reclamo atómico: sólo quien suma los ids lo manda. Si se juntaron
            // varios (el servidor estuvo apagado) sale sólo el más cercano.
            const claimed = await this.db
                .update(bookingAppointments)
                .set({ remindersSent: sql`${bookingAppointments.remindersSent} || ${JSON.stringify(ids)}::jsonb` })
                .where(
                    and(
                        eq(bookingAppointments.id, appt.id),
                        inArray(bookingAppointments.status, LIVE_STATUSES),
                        sql`not (${bookingAppointments.remindersSent} ?| ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::text[])`,
                    ),
                )
                .returning({ id: bookingAppointments.id });
            if (claimed.length === 0) continue;
            claimedCount++;
            const closest = due.reduce((a, b) => (b.minutes_before < a.minutes_before ? b : a));
            if (appt.clientEmail) {
                try {
                    if (await this.publicSvc.sendReminder(appt, closest.minutes_before)) sent++;
                } catch (err) {
                    this.logger.warn(`Recordatorio de la cita ${appt.id}: ${String(err)}`);
                }
            }
            if (bySms) {
                try {
                    if (await this.publicSvc.sendSmsReminder(appt)) sent++;
                } catch (err) {
                    this.logger.warn(`Recordatorio por SMS de la cita ${appt.id}: ${String(err)}`);
                }
            }
        }
        return { sent, claimed: claimedCount };
    }
}
