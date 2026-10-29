import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { and, eq, gt, isNull, lte, ne, sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { bookingAppointments, bookingPages, records } from '../db/schema';
import { QUEUE_JOB_RETENTION, guardRedis } from '../redis/redis.util';
import { readBookingConfig } from './booking-config';
import { BookingPublicService } from './booking-public.service';

const QUEUE = 'booking-reminders';
/** Recordatorios hasta dos semanas antes (el máximo que deja configurar la página). */
const LOOKAHEAD_MS = 14 * 24 * 3600 * 1000 + 3600 * 1000;
const BATCH = 200;

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
            this.worker = new Worker(QUEUE, async () => this.tick(), { connection: conn() });
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

    /** Un barrido: devuelve cuántos recordatorios salieron. */
    async tick(now = new Date()): Promise<number> {
        const rows = await this.db
            .select({ appt: bookingAppointments, config: bookingPages.config })
            .from(bookingAppointments)
            .innerJoin(bookingPages, eq(bookingPages.id, bookingAppointments.pageId))
            .innerJoin(records, and(eq(records.id, bookingAppointments.recordId), isNull(records.deletedAt)))
            .where(
                and(
                    ne(bookingAppointments.status, 'cancelled'),
                    gt(bookingAppointments.startAt, now),
                    lte(bookingAppointments.startAt, new Date(now.getTime() + LOOKAHEAD_MS)),
                ),
            )
            .orderBy(bookingAppointments.startAt)
            .limit(BATCH);
        let sent = 0;
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
                        ne(bookingAppointments.status, 'cancelled'),
                        sql`not (${bookingAppointments.remindersSent} ?| ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::text[])`,
                    ),
                )
                .returning({ id: bookingAppointments.id });
            if (claimed.length === 0) continue;
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
        return sent;
    }
}
