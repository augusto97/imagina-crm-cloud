import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional, type OnModuleInit } from '@nestjs/common';
import {
    FALLBACK_TIME_ZONE,
    addDaysYmd,
    dueBucket,
    isDoneOptionLabel,
    listRecordsQuerySchema,
    pickDueField,
    pickStatusField,
    readNotificationPrefs,
    resolveTitleFieldId,
    updateNotificationPrefsSchema,
    zonedNowNaive,
    zonedToday,
    type CreateReminderInput,
    type Field,
    type FilterGroup,
    type FollowStateDto,
    type List,
    type ListNotificationsQuery,
    type MarkNotificationsInput,
    type MyWorkDto,
    type MyWorkItem,
    type NotificationDto,
    type NotificationKind,
    type NotificationPrefs,
    type NotificationsPage,
    type ReminderDto,
    type Role,
    type UpdateNotificationPrefsInput,
    type UpdateReminderInput,
} from '@imagina-base/shared';
import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { lists, memberships, notifications, records, recordFollows, reminders, tenants, users } from '../db/schema';
import { DomainsService } from '../domains/domains.service';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { MailService } from '../mail/mail.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordChangeHub, type RecordChange } from '../records/record-change-hub';
import { RecordsService } from '../records/records.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import {
    changeSummary,
    digestEmail,
    newlyAssigned,
    notificationEmail,
    notificationTitle,
    type DigestItem,
} from './notification-text';
import { NotifyHub, type NotifyEvent } from './notify-hub';

/** Avisos por correo en el momento: tope por persona y hora (una edición masiva no inunda la casilla). */
const MAIL_PER_HOUR = 10;
/** Un «cambió» sin leer del mismo registro se ACTUALIZA en vez de sumar otro, dentro de esta ventana. */
const COALESCE_MS = 30 * 60 * 1000;
/** Destinatarios por evento (un registro con cientos de seguidores es un caso raro; se corta). */
const MAX_RECIPIENTS = 100;
/** «Mi trabajo»: listas que se recorren y registros por grupo. */
const MAX_WORK_LISTS = 40;
const MAX_ITEMS = 200;

interface RecordCtx {
    list: List;
    fields: Field[];
    title: string;
    data: Record<string, unknown>;
}

interface Recipient {
    userId: number;
    role: Role;
    email: string;
    prefs: NotificationPrefs;
}

/**
 * v0.1.276 (ADR-S40) — «Mi trabajo» + bandeja de avisos.
 *
 * Escucha lo que pasa (comentarios y menciones por `NotifyHub`, cambios de
 * campos por `RecordChangeHub`) y escribe un aviso por destinatario. Cada
 * destinatario se filtra con el MISMO ACL del registro: nadie se entera de un
 * registro que no puede ver. Nunca se le avisa a alguien de lo que hizo él.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly realtime: RealtimeService,
        private readonly mail: MailService,
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
        @Optional() private readonly hub?: NotifyHub,
        @Optional() private readonly changes?: RecordChangeHub,
        @Optional() private readonly timeZones?: TenantTimeZones,
        @Optional() private readonly domains?: DomainsService,
    ) {}

    onModuleInit(): void {
        this.hub?.subscribe((e) => this.onNotify(e));
        this.changes?.subscribe((c) => this.onRecordChange(c));
    }

    // ─────────────────────────── Eventos ───────────────────────────

    async onNotify(e: NotifyEvent): Promise<void> {
        const ctx = await this.recordCtx(e.tenantId, e.listId, e.recordId);
        if (!ctx) return;
        const actorName = await this.userName(e.actorId);
        if (e.type === 'comment') {
            await this.follow(e.tenantId, e.listId, e.recordId, [e.actorId]);
            const snippet = e.body.replace(/\s+/g, ' ').trim().slice(0, 240);
            await this.deliver(e.tenantId, 'mention', e.mentioned, {
                listId: e.listId,
                recordId: e.recordId,
                actorId: e.actorId,
                title: notificationTitle('mention', { actorName, recordTitle: ctx.title, source: 'comment' }),
                body: snippet,
            });
            const followers = await this.followerIds(e.tenantId, e.recordId);
            await this.deliver(
                e.tenantId,
                'comment',
                followers.filter((u) => !e.mentioned.includes(u)),
                {
                    listId: e.listId,
                    recordId: e.recordId,
                    actorId: e.actorId,
                    title: notificationTitle('comment', { actorName, recordTitle: ctx.title }),
                    body: snippet,
                },
            );
            return;
        }
        await this.deliver(e.tenantId, 'mention', e.userIds, {
            listId: e.listId,
            recordId: e.recordId,
            actorId: e.actorId,
            title: notificationTitle('mention', { actorName, recordTitle: ctx.title, source: 'description' }),
            body: e.snippet,
        });
    }

    async onRecordChange(c: RecordChange): Promise<void> {
        const actorId = c.actorId ?? 0;
        const ctx = await this.recordCtx(c.tenantId, c.listId, c.recordId);
        if (!ctx) return;
        const userFieldIds = ctx.fields.filter((f) => f.type === 'user').map((f) => f.id);
        const assigned = newlyAssigned(userFieldIds, c.before, c.after).filter((u) => u !== actorId);
        const actorName = actorId > 0 ? await this.userName(actorId) : null;

        if (c.kind === 'created' && actorId > 0) await this.follow(c.tenantId, c.listId, c.recordId, [actorId]);
        if (assigned.length > 0) {
            await this.follow(c.tenantId, c.listId, c.recordId, assigned);
            await this.deliver(c.tenantId, 'assigned', assigned, {
                listId: c.listId,
                recordId: c.recordId,
                actorId: actorId > 0 ? actorId : null,
                title: notificationTitle('assigned', { actorName, recordTitle: ctx.title }),
                body: `En «${ctx.list.name}»`,
            });
        }
        if (c.kind === 'created') return;

        const names = await this.userNames(this.userValues(ctx.fields, c.before, c.after));
        const summary = changeSummary(ctx.fields, c.before, c.after, names);
        if (summary.fieldIds.length === 0) return;
        const followers = (await this.followerIds(c.tenantId, c.recordId)).filter((u) => !assigned.includes(u));
        await this.deliver(c.tenantId, 'update', followers, {
            listId: c.listId,
            recordId: c.recordId,
            actorId: actorId > 0 ? actorId : null,
            title: notificationTitle('update', { actorName, recordTitle: ctx.title }),
            body: summary.text,
            coalesce: true,
        });
    }

    // ─────────────────────────── Entrega ───────────────────────────

    /**
     * Escribe un aviso por destinatario (miembro de la empresa, no cliente, no
     * desactivado, que PUEDE ver el registro, que no es quien lo hizo), avisa
     * por realtime a su bandeja y, si sus preferencias lo piden, manda el
     * correo. Devuelve cuántos avisos quedaron.
     */
    async deliver(
        tenantId: number,
        kind: NotificationKind,
        rawRecipients: readonly number[],
        n: {
            listId: number | null;
            recordId: number | null;
            actorId: number | null;
            title: string;
            body: string;
            coalesce?: boolean;
        },
    ): Promise<number> {
        const ids = [...new Set(rawRecipients)].filter((u) => Number.isInteger(u) && u > 0 && u !== n.actorId).slice(0, MAX_RECIPIENTS);
        if (ids.length === 0) return 0;
        const recipients = await this.recipients(tenantId, ids);
        const allowed: Recipient[] = [];
        for (const r of recipients) {
            if (n.listId !== null && n.recordId !== null) {
                const sees = await this.records
                    .get(tenantId, { userId: r.userId, role: r.role }, String(n.listId), n.recordId)
                    .then(() => true)
                    .catch(() => false);
                if (!sees) continue;
            }
            allowed.push(r);
        }
        if (allowed.length === 0) return 0;

        const body = n.body.slice(0, 2000);
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            for (const r of allowed) {
                if (n.coalesce && n.recordId !== null) {
                    const [prev] = await tx
                        .select({ id: notifications.id })
                        .from(notifications)
                        .where(
                            and(
                                eq(notifications.tenantId, tenantId),
                                eq(notifications.userId, r.userId),
                                eq(notifications.recordId, n.recordId),
                                eq(notifications.kind, kind),
                                isNull(notifications.readAt),
                                sql`${notifications.createdAt} > ${new Date(Date.now() - COALESCE_MS)}`,
                            ),
                        )
                        .orderBy(desc(notifications.id))
                        .limit(1);
                    if (prev) {
                        await tx
                            .update(notifications)
                            .set({ title: n.title, body, actorId: n.actorId, createdAt: new Date() })
                            .where(eq(notifications.id, prev.id));
                        continue;
                    }
                }
                await tx.insert(notifications).values({
                    tenantId,
                    userId: r.userId,
                    kind,
                    listId: n.listId,
                    recordId: n.recordId,
                    actorId: n.actorId,
                    title: n.title,
                    body,
                });
            }
        });
        for (const r of allowed) this.realtime.notifications(tenantId, r.userId);

        const mailTo = allowed.filter((r) => r.prefs.email[kind]);
        if (mailTo.length > 0) {
            const links = await this.links(tenantId, n.listId);
            const company = await this.tenantName(tenantId);
            for (const r of mailTo) {
                if (!(await this.underMailCap(tenantId, r.userId))) continue;
                const content = notificationEmail({
                    company,
                    title: n.title,
                    body,
                    link: n.recordId !== null && links.listSlug ? `${links.base}/#/lists/${links.listSlug}/records/${n.recordId}` : `${links.base}/#/my-work`,
                    settingsLink: links.settings,
                });
                await this.mail
                    .enqueue({ tenantId, to: r.email, ...content })
                    .catch((err) => this.logger.warn(`Correo de aviso a ${r.userId}: ${String(err)}`));
            }
        }
        return allowed.length;
    }

    private async underMailCap(tenantId: number, userId: number): Promise<boolean> {
        const key = `notifmail:${tenantId}:${userId}:${Math.floor(Date.now() / 3_600_000)}`;
        try {
            const n = await this.redis.incr(key);
            if (n === 1) await this.redis.expire(key, 3700);
            return n <= MAIL_PER_HOUR;
        } catch {
            return true;
        }
    }

    private async recipients(tenantId: number, ids: number[]): Promise<Recipient[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ userId: memberships.userId, role: memberships.role, settings: memberships.settings, email: users.email, disabledAt: users.disabledAt })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, ids))),
        );
        return rows
            .filter((r) => r.role !== 'client' && !r.disabledAt)
            .map((r) => ({
                userId: r.userId,
                role: r.role as Role,
                email: r.email,
                prefs: readNotificationPrefs((r.settings as Record<string, unknown> | null)?.notifications),
            }));
    }

    // ─────────────────────────── Bandeja ───────────────────────────

    async list(tenantId: number, userId: number, q: ListNotificationsQuery): Promise<NotificationsPage> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    id: notifications.id,
                    kind: notifications.kind,
                    listId: notifications.listId,
                    listSlug: lists.slug,
                    listName: lists.name,
                    recordId: notifications.recordId,
                    actorId: notifications.actorId,
                    actorName: users.name,
                    title: notifications.title,
                    body: notifications.body,
                    readAt: notifications.readAt,
                    createdAt: notifications.createdAt,
                })
                .from(notifications)
                .leftJoin(lists, eq(lists.id, notifications.listId))
                .leftJoin(users, eq(users.id, notifications.actorId))
                .where(
                    and(
                        eq(notifications.tenantId, tenantId),
                        eq(notifications.userId, userId),
                        q.before ? lt(notifications.id, q.before) : undefined,
                        q.unread ? isNull(notifications.readAt) : undefined,
                    ),
                )
                .orderBy(desc(notifications.id))
                .limit(q.limit + 1),
        );
        const unread = await this.unreadCount(tenantId, userId);
        const page = rows.slice(0, q.limit);
        return {
            items: page.map(
                (r): NotificationDto => ({
                    id: r.id,
                    kind: r.kind as NotificationKind,
                    list_id: r.listId,
                    list_slug: r.listSlug ?? null,
                    list_name: r.listName ?? null,
                    record_id: r.recordId,
                    actor_id: r.actorId,
                    actor_name: r.actorName ?? null,
                    title: r.title,
                    body: r.body,
                    read_at: r.readAt?.toISOString() ?? null,
                    created_at: r.createdAt.toISOString(),
                }),
            ),
            unread,
            next_cursor: rows.length > q.limit ? (page[page.length - 1]?.id ?? null) : null,
        };
    }

    async unreadCount(tenantId: number, userId: number): Promise<number> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ n: sql<number>`count(*)::int` })
                .from(notifications)
                .where(and(eq(notifications.tenantId, tenantId), eq(notifications.userId, userId), isNull(notifications.readAt))),
        );
        return row?.n ?? 0;
    }

    async markRead(tenantId: number, userId: number, input: MarkNotificationsInput): Promise<{ unread: number }> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(notifications)
                .set({ readAt: new Date() })
                .where(
                    and(
                        eq(notifications.tenantId, tenantId),
                        eq(notifications.userId, userId),
                        isNull(notifications.readAt),
                        'ids' in input ? inArray(notifications.id, input.ids) : undefined,
                    ),
                ),
        );
        this.realtime.notifications(tenantId, userId);
        return { unread: await this.unreadCount(tenantId, userId) };
    }

    // ─────────────────────────── Preferencias ───────────────────────────

    async getPrefs(tenantId: number, userId: number): Promise<NotificationPrefs> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ settings: memberships.settings })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
                .limit(1),
        );
        return readNotificationPrefs((row?.settings as Record<string, unknown> | undefined)?.notifications);
    }

    async setPrefs(tenantId: number, userId: number, raw: UpdateNotificationPrefsInput): Promise<NotificationPrefs> {
        const input = updateNotificationPrefsSchema.parse(raw);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .select({ settings: memberships.settings })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
                .limit(1);
            if (!row) throw new NotFoundException({ code: 'not_member', message: 'No sos miembro de esta empresa', data: { status: 404 } });
            const settings = { ...((row.settings as Record<string, unknown>) ?? {}) };
            const current = readNotificationPrefs(settings.notifications);
            const next = readNotificationPrefs({
                ...current,
                ...input,
                email: { ...current.email, ...(input.email ?? {}) },
                digest_days: input.digest_days ? [...new Set(input.digest_days)].sort() : current.digest_days,
            });
            settings.notifications = next;
            await tx
                .update(memberships)
                .set({ settings, updatedAt: new Date() })
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
            return next;
        });
    }

    // ─────────────────────────── Seguir ───────────────────────────

    async followState(tenantId: number, userId: number, recordId: number): Promise<FollowStateDto> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ userId: recordFollows.userId })
                .from(recordFollows)
                .where(and(eq(recordFollows.tenantId, tenantId), eq(recordFollows.recordId, recordId))),
        );
        return { following: rows.some((r) => r.userId === userId), followers: rows.length };
    }

    async setFollowing(
        tenantId: number,
        actor: { userId: number; role: Role },
        listIdOrSlug: string,
        recordId: number,
        following: boolean,
    ): Promise<FollowStateDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        // Sólo se sigue lo que se puede ver (404 si no).
        await this.records.get(tenantId, actor, String(list.id), recordId);
        if (following) await this.follow(tenantId, list.id, recordId, [actor.userId]);
        else
            await this.tenantDb.withTenant(tenantId, (tx) =>
                tx
                    .delete(recordFollows)
                    .where(and(eq(recordFollows.tenantId, tenantId), eq(recordFollows.userId, actor.userId), eq(recordFollows.recordId, recordId))),
            );
        return this.followState(tenantId, actor.userId, recordId);
    }

    private async follow(tenantId: number, listId: number, recordId: number, userIds: number[]): Promise<void> {
        const ids = [...new Set(userIds)].filter((u) => u > 0);
        if (ids.length === 0) return;
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const members = await tx
                .select({ userId: memberships.userId, role: memberships.role })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, ids)));
            const ok = members.filter((m) => m.role !== 'client').map((m) => m.userId);
            if (ok.length === 0) return;
            await tx
                .insert(recordFollows)
                .values(ok.map((userId) => ({ tenantId, userId, listId, recordId })))
                .onConflictDoNothing();
        });
    }

    private async followerIds(tenantId: number, recordId: number): Promise<number[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ userId: recordFollows.userId })
                .from(recordFollows)
                .where(and(eq(recordFollows.tenantId, tenantId), eq(recordFollows.recordId, recordId))),
        );
        return rows.map((r) => r.userId);
    }

    // ─────────────────────────── Recordatorios ───────────────────────────

    async createReminder(tenantId: number, actor: { userId: number; role: Role }, input: CreateReminderInput): Promise<ReminderDto> {
        let listId: number | null = null;
        if (input.record_id !== undefined) {
            if (input.list_id === undefined) {
                throw new BadRequestException({ code: 'list_required', message: 'Falta la lista del registro', data: { status: 400 } });
            }
            const list = await this.lists.get(tenantId, String(input.list_id));
            await this.records.get(tenantId, actor, String(list.id), input.record_id);
            listId = list.id;
        }
        const at = new Date(input.remind_at);
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .insert(reminders)
                .values({ tenantId, userId: actor.userId, listId, recordId: input.record_id ?? null, remindAt: at, note: input.note })
                .returning({ id: reminders.id }),
        );
        const all = await this.listReminders(tenantId, actor, { includeDone: true });
        return all.find((r) => r.id === row!.id)!;
    }

    async updateReminder(
        tenantId: number,
        actor: { userId: number; role: Role },
        id: number,
        input: UpdateReminderInput,
    ): Promise<ReminderDto> {
        const patch: Partial<typeof reminders.$inferInsert> = {};
        if (input.note !== undefined) patch.note = input.note;
        if (input.remind_at !== undefined) {
            patch.remindAt = new Date(input.remind_at);
            // Reprogramar = vuelve a sonar.
            patch.firedAt = null;
        }
        if (input.done !== undefined) patch.doneAt = input.done ? new Date() : null;
        const updated = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(reminders)
                .set(patch)
                .where(and(eq(reminders.tenantId, tenantId), eq(reminders.userId, actor.userId), eq(reminders.id, id)))
                .returning({ id: reminders.id }),
        );
        if (updated.length === 0) throw new NotFoundException({ code: 'reminder_not_found', message: 'Recordatorio no encontrado', data: { status: 404 } });
        const all = await this.listReminders(tenantId, actor, { includeDone: true });
        return all.find((r) => r.id === id)!;
    }

    async removeReminder(tenantId: number, userId: number, id: number): Promise<void> {
        const out = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .delete(reminders)
                .where(and(eq(reminders.tenantId, tenantId), eq(reminders.userId, userId), eq(reminders.id, id)))
                .returning({ id: reminders.id }),
        );
        if (out.length === 0) throw new NotFoundException({ code: 'reminder_not_found', message: 'Recordatorio no encontrado', data: { status: 404 } });
    }

    async listReminders(
        tenantId: number,
        actor: { userId: number; role: Role },
        opts: { includeDone?: boolean; recordId?: number } = {},
    ): Promise<ReminderDto[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    id: reminders.id,
                    listId: reminders.listId,
                    listSlug: lists.slug,
                    listName: lists.name,
                    recordId: reminders.recordId,
                    remindAt: reminders.remindAt,
                    note: reminders.note,
                    firedAt: reminders.firedAt,
                    doneAt: reminders.doneAt,
                    createdAt: reminders.createdAt,
                })
                .from(reminders)
                .leftJoin(lists, eq(lists.id, reminders.listId))
                .where(
                    and(
                        eq(reminders.tenantId, tenantId),
                        eq(reminders.userId, actor.userId),
                        opts.includeDone ? undefined : isNull(reminders.doneAt),
                        opts.recordId !== undefined ? eq(reminders.recordId, opts.recordId) : undefined,
                    ),
                )
                .orderBy(asc(reminders.remindAt))
                .limit(MAX_ITEMS),
        );
        const titles = await this.titlesFor(
            tenantId,
            actor,
            rows.flatMap((r) => (r.listId !== null && r.recordId !== null ? [{ listId: r.listId, recordId: r.recordId }] : [])),
        );
        return rows.map((r) => ({
            id: r.id,
            list_id: r.listId,
            list_slug: r.listSlug ?? null,
            list_name: r.listName ?? null,
            record_id: r.recordId,
            record_title: r.recordId !== null ? (titles.get(r.recordId) ?? null) : null,
            remind_at: r.remindAt.toISOString(),
            note: r.note,
            fired_at: r.firedAt?.toISOString() ?? null,
            done_at: r.doneAt?.toISOString() ?? null,
            created_at: r.createdAt.toISOString(),
        }));
    }

    /**
     * Dispara los recordatorios vencidos (todas las empresas). El `UPDATE …
     * RETURNING` sobre filas sin disparar es lo que hace que con dos nodos
     * cada recordatorio suene una sola vez.
     */
    async reminderTick(now: Date = new Date()): Promise<number> {
        const due = await this.db.execute<{ id: number; tenant_id: number; user_id: number; list_id: number | null; record_id: number | null; note: string }>(sql`
            UPDATE reminders r SET fired_at = ${now}
            FROM tenants t
            WHERE r.id IN (
                SELECT id FROM reminders
                WHERE fired_at IS NULL AND done_at IS NULL AND remind_at <= ${now}
                ORDER BY remind_at
                LIMIT 200
                FOR UPDATE SKIP LOCKED
            )
            AND r.fired_at IS NULL
            AND t.id = r.tenant_id AND t.archived_at IS NULL
            RETURNING r.id, r.tenant_id, r.user_id, r.list_id, r.record_id, r.note
        `);
        const rows = (due as unknown as { rows?: unknown[] }).rows ?? (due as unknown as unknown[]);
        let n = 0;
        for (const raw of rows as Array<{ id: number; tenant_id: number; user_id: number; list_id: number | null; record_id: number | null; note: string }>) {
            const tenantId = Number(raw.tenant_id);
            const listId = raw.list_id === null ? null : Number(raw.list_id);
            const recordId = raw.record_id === null ? null : Number(raw.record_id);
            let title = raw.note ? `Recordatorio: ${raw.note.slice(0, 120)}` : 'Recordatorio';
            let body = '';
            if (listId !== null && recordId !== null) {
                const ctx = await this.recordCtx(tenantId, listId, recordId).catch(() => null);
                if (!ctx) continue;
                title = notificationTitle('reminder', { actorName: null, recordTitle: ctx.title });
                body = raw.note;
            }
            n += await this.deliver(tenantId, 'reminder', [Number(raw.user_id)], { listId, recordId, actorId: null, title, body }).catch((err) => {
                this.logger.warn(`Recordatorio ${raw.id}: ${String(err)}`);
                return 0;
            });
        }
        return n;
    }

    // ─────────────────────────── Mi trabajo ───────────────────────────

    async myWork(tenantId: number, actor: { userId: number; role: Role }): Promise<MyWorkDto> {
        const all = (await this.lists.list(tenantId)).slice(0, 500);
        const assigned: MyWorkItem[] = [];
        let withAssignee = 0;
        let truncated = false;
        const fieldsByList = new Map<number, Field[]>();
        for (const list of all) {
            const fields = await this.fields.listByListId(tenantId, list.id);
            fieldsByList.set(list.id, fields);
            const userFields = fields.filter((f) => f.type === 'user');
            if (userFields.length === 0) continue;
            withAssignee++;
            if (withAssignee > MAX_WORK_LISTS) {
                truncated = true;
                continue;
            }
            const filter: FilterGroup = {
                type: 'group',
                logic: 'or',
                children: userFields.map((f) => ({ type: 'condition' as const, field_id: f.id, op: 'eq' as const, value: actor.userId })),
            };
            const page = await this.records
                .list(tenantId, actor, String(list.id), listRecordsQuerySchema.parse({ limit: 100, filter_tree: filter, include_subtasks: true }))
                .catch(() => null);
            if (!page) continue;
            if (page.meta.next_cursor) truncated = true;
            const status = pickStatusField(fields);
            for (const r of page.data) {
                const item = this.toWorkItem(list, fields, r.id, r.data as Record<string, unknown>);
                if (status && item.status_label && isDoneOptionLabel(item.status_label)) continue;
                assigned.push(item);
            }
        }
        assigned.sort(byDue);

        // Lo que sigue (los más recientes primero), resuelto por lista con el ACL.
        const follows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ listId: recordFollows.listId, recordId: recordFollows.recordId })
                .from(recordFollows)
                .where(and(eq(recordFollows.tenantId, tenantId), eq(recordFollows.userId, actor.userId)))
                .orderBy(desc(recordFollows.createdAt))
                .limit(MAX_ITEMS),
        );
        const following: MyWorkItem[] = [];
        const byList = groupBy(follows, (f) => f.listId);
        for (const [listId, items] of byList) {
            const list = all.find((l) => l.id === listId);
            if (!list) continue;
            const fields = fieldsByList.get(listId) ?? (await this.fields.listByListId(tenantId, listId));
            const page = await this.records
                .list(tenantId, actor, String(listId), listRecordsQuerySchema.parse({ limit: 200, ids: items.map((i) => i.recordId).join(','), include_subtasks: true }))
                .catch(() => null);
            for (const r of page?.data ?? []) following.push(this.toWorkItem(list, fields, r.id, r.data as Record<string, unknown>));
        }
        const order = new Map(follows.map((f, i) => [f.recordId, i]));
        following.sort((a, b) => (order.get(a.record_id) ?? 0) - (order.get(b.record_id) ?? 0));

        const reminderList = await this.listReminders(tenantId, actor);
        return {
            assigned: assigned.slice(0, MAX_ITEMS),
            following,
            reminders: reminderList,
            lists_with_assignee: withAssignee,
            truncated: truncated || assigned.length > MAX_ITEMS,
        };
    }

    private toWorkItem(list: List, fields: Field[], recordId: number, data: Record<string, unknown>): MyWorkItem {
        const titleId = resolveTitleFieldId(fields, list.settings as Record<string, unknown>);
        const due = pickDueField(fields);
        const status = pickStatusField(fields);
        const rawTitle = titleId !== null ? data[`f${titleId}`] : null;
        const statusVal = status ? data[`f${status.id}`] : null;
        const opt = status
            ? ((status.config as { options?: Array<{ value: string; label?: string; color?: string }> } | undefined)?.options ?? []).find(
                  (o) => o.value === statusVal,
              )
            : undefined;
        const dueVal = due ? data[`f${due.id}`] : null;
        return {
            list_id: list.id,
            list_slug: list.slug,
            list_name: list.name,
            list_icon: list.icon ?? null,
            list_color: list.color ?? null,
            record_id: recordId,
            title: typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle : `Registro #${recordId}`,
            due: typeof dueVal === 'string' && dueVal ? dueVal : null,
            due_label: due?.label ?? null,
            due_is_datetime: due?.type === 'datetime',
            status_label: opt ? opt.label || opt.value : null,
            status_color: opt?.color ?? null,
        };
    }

    // ─────────────────────────── Resumen diario ───────────────────────────

    /**
     * Corre cada hora: a cada persona con el resumen encendido le llega a SU
     * hora en la zona de la empresa, los días elegidos. Redis evita repetir el
     * mismo día (dos nodos, o un reinicio a mitad de la hora).
     */
    async digestTick(now: Date = new Date()): Promise<number> {
        const tenantRows = await this.db
            .select({ id: tenants.id, name: tenants.name })
            .from(tenants)
            .where(isNull(tenants.archivedAt));
        let sent = 0;
        for (const t of tenantRows) {
            const tz = (await this.timeZones?.orUtc(t.id).catch(() => FALLBACK_TIME_ZONE)) ?? FALLBACK_TIME_ZONE;
            const local = zonedNowNaive(tz, now);
            const hour = Number(local.slice(11, 13));
            const ymd = local.slice(0, 10);
            const weekday = new Date(`${ymd}T00:00:00Z`).getUTCDay();
            const members = await this.tenantDb.withTenant(t.id, (tx) =>
                tx
                    .select({ userId: memberships.userId, role: memberships.role, settings: memberships.settings, email: users.email, name: users.name, disabledAt: users.disabledAt })
                    .from(memberships)
                    .innerJoin(users, eq(users.id, memberships.userId))
                    .where(and(eq(memberships.tenantId, t.id), sql`${memberships.settings}->'notifications'->>'digest' = 'daily'`)),
            );
            for (const m of members) {
                if (m.role === 'client' || m.disabledAt) continue;
                const prefs = readNotificationPrefs((m.settings as Record<string, unknown> | null)?.notifications);
                if (prefs.digest !== 'daily' || prefs.digest_hour !== hour || !prefs.digest_days.includes(weekday)) continue;
                const fresh = await this.redis.set(`digest:${t.id}:${m.userId}:${ymd}`, '1', 'EX', 2 * 86_400, 'NX').catch(() => 'OK');
                if (fresh !== 'OK') continue;
                if (await this.sendDigest(t.id, t.name, { userId: m.userId, role: m.role as Role, email: m.email }, tz, now)) sent++;
            }
        }
        return sent;
    }

    async sendDigest(
        tenantId: number,
        company: string,
        who: { userId: number; role: Role; email: string },
        tz: string,
        now: Date,
    ): Promise<boolean> {
        const work = await this.myWork(tenantId, who);
        const today = zonedToday(tz, now);
        const weekEnd = addDaysYmd(today, 6);
        const localDue = (i: MyWorkItem): string | null => (i.due && i.due_is_datetime ? zonedToday(tz, new Date(i.due)) : i.due);
        const line = (i: MyWorkItem): DigestItem => ({ title: i.title, detail: [i.list_name, i.status_label].filter(Boolean).join(' · ') });
        const overdue = work.assigned.filter((i) => dueBucket(localDue(i), today, weekEnd) === 'overdue').slice(0, 10).map(line);
        const dueToday = work.assigned.filter((i) => dueBucket(localDue(i), today, weekEnd) === 'today').slice(0, 10).map(line);
        const page = await this.list(tenantId, who.userId, { limit: 8, unread: true });
        if (overdue.length === 0 && dueToday.length === 0 && page.unread === 0) return false;
        const links = await this.links(tenantId, null);
        const content = digestEmail({
            company,
            dateLabel: new Date(`${today}T12:00:00Z`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
            overdue,
            today: dueToday,
            unread: page.items.map((n) => ({ title: n.title, detail: n.body.slice(0, 120) })),
            unreadTotal: page.unread,
            link: `${links.base}/#/my-work`,
            settingsLink: links.settings,
        });
        await this.mail.enqueue({ tenantId, to: who.email, ...content });
        return true;
    }

    // ─────────────────────────── Helpers ───────────────────────────

    private async recordCtx(tenantId: number, listId: number, recordId: number): Promise<RecordCtx | null> {
        const list = await this.lists.get(tenantId, String(listId)).catch(() => null);
        if (!list) return null;
        const fields = await this.fields.listByListId(tenantId, listId);
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ data: records.data })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), eq(records.id, recordId), isNull(records.deletedAt)))
                .limit(1),
        );
        if (!row) return null;
        const data = (row.data ?? {}) as Record<string, unknown>;
        const titleId = resolveTitleFieldId(fields, list.settings as Record<string, unknown>);
        const raw = titleId !== null ? data[`f${titleId}`] : null;
        return { list, fields, data, title: typeof raw === 'string' && raw.trim() ? raw.trim() : `Registro #${recordId}` };
    }

    /** Títulos de varios registros, por lista y con el ACL de la persona. */
    private async titlesFor(
        tenantId: number,
        actor: { userId: number; role: Role },
        refs: Array<{ listId: number; recordId: number }>,
    ): Promise<Map<number, string>> {
        const out = new Map<number, string>();
        for (const [listId, items] of groupBy(refs, (r) => r.listId)) {
            const list = await this.lists.get(tenantId, String(listId)).catch(() => null);
            if (!list) continue;
            const fields = await this.fields.listByListId(tenantId, listId);
            const page = await this.records
                .list(tenantId, actor, String(listId), listRecordsQuerySchema.parse({ limit: 200, ids: [...new Set(items.map((i) => i.recordId))].slice(0, 200).join(','), include_subtasks: true }))
                .catch(() => null);
            for (const r of page?.data ?? []) out.set(r.id, this.toWorkItem(list, fields, r.id, r.data as Record<string, unknown>).title);
        }
        return out;
    }

    private userValues(fields: Field[], before: Record<string, unknown>, after: Record<string, unknown>): number[] {
        const ids: number[] = [];
        for (const f of fields) {
            if (f.type !== 'user') continue;
            for (const v of [before[`f${f.id}`], after[`f${f.id}`]]) if (Number.isInteger(Number(v)) && Number(v) > 0) ids.push(Number(v));
        }
        return ids;
    }

    private async userName(id: number): Promise<string | null> {
        if (!id) return null;
        return (await this.userNames([id])).get(id) ?? null;
    }

    private async userNames(ids: number[]): Promise<Map<number, string>> {
        const unique = [...new Set(ids)].filter((i) => i > 0);
        if (unique.length === 0) return new Map();
        const rows = await this.db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, unique));
        return new Map(rows.map((r) => [r.id, r.name?.trim() || r.email]));
    }

    private async tenantName(tenantId: number): Promise<string> {
        const [row] = await this.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        return row?.name ?? 'Imagina Base';
    }

    private async links(tenantId: number, listId: number | null): Promise<{ base: string; settings: string; listSlug: string | null }> {
        const base = ((await this.domains?.baseUrlFor(tenantId).catch(() => null)) ?? this.env.APP_BASE_URL).replace(/\/+$/, '');
        let listSlug: string | null = null;
        if (listId !== null) listSlug = (await this.lists.get(tenantId, String(listId)).catch(() => null))?.slug ?? null;
        return { base, settings: `${base}/#/settings?s=avisos`, listSlug };
    }
}

function groupBy<T, K>(items: readonly T[], key: (t: T) => K): Map<K, T[]> {
    const out = new Map<K, T[]>();
    for (const i of items) {
        const k = key(i);
        const arr = out.get(k);
        if (arr) arr.push(i);
        else out.set(k, [i]);
    }
    return out;
}

function byDue(a: MyWorkItem, b: MyWorkItem): number {
    if (a.due === b.due) return a.record_id - b.record_id;
    if (a.due === null) return 1;
    if (b.due === null) return -1;
    return a.due < b.due ? -1 : 1;
}
