import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
    MAX_RECORD_SHARES_PER_GUEST,
    guestLevelOf,
    guestListPermissions,
    jsonbKeyForField,
    resolveTitleFieldId,
    type FieldType,
    type GuestInviteResult,
    type GuestLevel,
    type GuestSummary,
    type RecordShareDto,
    type ShareRecordInput,
    type SharedWithMeDto,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { BillingService } from '../billing/billing.service';
import type { Tx } from '../db/client';
import { fields, lists, memberships, recordShares, records, tenants, users } from '../db/schema';
import { resolvePermissions } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';

/**
 * C3 — Invitados externos. Una persona de afuera (proveedor, freelancer, el
 * contador) entra a la empresa con el rol `guest` y ve SÓLO lo que le
 * compartieron:
 *   - una lista entera → acceso por persona de la lista (`settings.
 *     permissions.users[id]`, con la forma de `guestListPermissions`);
 *   - registros sueltos → `record_shares` (registro, persona, nivel).
 * No ocupa un usuario del plan (tiene su propio tope, `max_guests`). Cuando
 * se le quita el último acceso, su membresía se va sola.
 */
@Injectable()
export class GuestsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly auth: AuthService,
        private readonly billing: BillingService,
        private readonly lists: ListsService,
        private readonly records: RecordsService,
        private readonly realtime: RealtimeService,
        private readonly audit: AuditService,
    ) {}

    // ─────────── Listas enteras ───────────

    /** Comparte una lista entera con alguien de afuera (por email). */
    async shareList(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        input: ShareRecordInput,
    ): Promise<GuestInviteResult> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const invite = await this.ensureGuest(tenantId, actor.userId, input, list.name);
        await this.writeListAccess(tenantId, list.id, invite.user_id, input.level);
        this.realtime.lists(tenantId);
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'guest.share_list',
            targetType: 'list',
            targetId: list.id,
            targetLabel: list.name,
            meta: { guest_id: invite.user_id, email: input.email.trim().toLowerCase(), level: input.level },
        });
        return invite;
    }

    /** Cambia el nivel de un invitado en una lista (o se lo quita con `null`). */
    async setListLevel(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        guestId: number,
        level: GuestLevel | null,
    ): Promise<void> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        await this.assertGuest(tenantId, guestId);
        const doc = resolvePermissions(list.settings);
        if (!doc.users[String(guestId)]) throw guestNotFound();
        await this.writeListAccess(tenantId, list.id, guestId, level);
        if (level === null) await this.cleanupIfNoAccess(tenantId, guestId);
        this.realtime.lists(tenantId);
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: level === null ? 'guest.unshare' : 'guest.level_change',
            targetType: 'list',
            targetId: list.id,
            targetLabel: list.name,
            meta: { guest_id: guestId, ...(level ? { level } : {}) },
        });
    }

    /** Invitados con acceso a una lista (Compartir → Con tu equipo → «Invitados»). */
    async listGuestsOfList(
        tenantId: number,
        listIdOrSlug: string,
    ): Promise<Array<{ user_id: number; name: string; email: string; pending: boolean; level: GuestLevel }>> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const doc = resolvePermissions(list.settings);
        const ids = Object.keys(doc.users)
            .map(Number)
            .filter((n) => Number.isInteger(n) && n > 0);
        if (ids.length === 0) return [];
        const guests = await this.guestRows(tenantId, ids);
        return guests.map((g) => ({
            user_id: g.id,
            name: g.name,
            email: g.email,
            pending: g.invitedAt !== null,
            level: guestLevelOf(doc.users[String(g.id)]) ?? 'view',
        }));
    }

    // ─────────── Registros sueltos ───────────

    async listRecordShares(tenantId: number, actor: Actor, listIdOrSlug: string, recordId: number): Promise<RecordShareDto[]> {
        const record = await this.records.get(tenantId, actor, listIdOrSlug, recordId);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    id: recordShares.id,
                    recordId: recordShares.recordId,
                    listId: recordShares.listId,
                    userId: recordShares.userId,
                    level: recordShares.level,
                    createdAt: recordShares.createdAt,
                    name: users.name,
                    email: users.email,
                    invitedAt: users.invitedAt,
                })
                .from(recordShares)
                .innerJoin(users, eq(users.id, recordShares.userId))
                .where(and(eq(recordShares.tenantId, tenantId), eq(recordShares.recordId, record.id)))
                .orderBy(asc(users.name)),
        );
        return rows.map(toShareDto);
    }

    /**
     * Comparte UN registro con alguien de afuera. Quien comparte tiene que
     * poder EDITAR ese registro (dar acceso a algo es más que mirarlo).
     */
    async shareRecord(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        recordId: number,
        input: ShareRecordInput,
    ): Promise<RecordShareDto> {
        const { list, title } = await this.editableRecord(tenantId, actor, listIdOrSlug, recordId);
        const invite = await this.ensureGuest(tenantId, actor.userId, input, title);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [{ n } = { n: 0 }] = await tx
                .select({ n: sql<number>`count(*)::int` })
                .from(recordShares)
                .where(and(eq(recordShares.tenantId, tenantId), eq(recordShares.userId, invite.user_id)));
            if (n >= MAX_RECORD_SHARES_PER_GUEST) {
                throw new BadRequestException({
                    code: 'record_shares_limit',
                    message: `Una persona invitada puede tener hasta ${MAX_RECORD_SHARES_PER_GUEST} registros compartidos: compártele la lista entera.`,
                    data: { status: 400 },
                });
            }
            await tx
                .insert(recordShares)
                .values({ tenantId, listId: list.id, recordId, userId: invite.user_id, level: input.level, createdBy: actor.userId })
                .onConflictDoUpdate({ target: [recordShares.recordId, recordShares.userId], set: { level: input.level } });
            const [r] = await this.shareRowsQuery(tx, tenantId)
                .where(and(eq(recordShares.tenantId, tenantId), eq(recordShares.recordId, recordId), eq(recordShares.userId, invite.user_id)))
                .limit(1);
            return r!;
        });
        this.realtime.records(tenantId, list.id);
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'guest.share_record',
            targetType: 'record',
            targetId: recordId,
            targetLabel: `${list.name} · ${title}`,
            meta: { guest_id: invite.user_id, email: input.email.trim().toLowerCase(), level: input.level },
        });
        return toShareDto(row);
    }

    async updateRecordShare(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        recordId: number,
        shareId: number,
        level: GuestLevel,
    ): Promise<RecordShareDto> {
        const { list, title } = await this.editableRecord(tenantId, actor, listIdOrSlug, recordId);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const updated = await tx
                .update(recordShares)
                .set({ level })
                .where(and(eq(recordShares.tenantId, tenantId), eq(recordShares.recordId, recordId), eq(recordShares.id, shareId)))
                .returning({ id: recordShares.id });
            if (updated.length === 0) throw guestNotFound();
            const [r] = await this.shareRowsQuery(tx, tenantId).where(eq(recordShares.id, shareId)).limit(1);
            return r!;
        });
        this.realtime.records(tenantId, list.id);
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'guest.level_change',
            targetType: 'record',
            targetId: recordId,
            targetLabel: `${list.name} · ${title}`,
            meta: { guest_id: row.userId, level },
        });
        return toShareDto(row);
    }

    async deleteRecordShare(tenantId: number, actor: Actor, listIdOrSlug: string, recordId: number, shareId: number): Promise<void> {
        const { list, title } = await this.editableRecord(tenantId, actor, listIdOrSlug, recordId);
        const gone = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .delete(recordShares)
                .where(and(eq(recordShares.tenantId, tenantId), eq(recordShares.recordId, recordId), eq(recordShares.id, shareId)))
                .returning({ userId: recordShares.userId }),
        );
        if (gone.length === 0) throw guestNotFound();
        await this.cleanupIfNoAccess(tenantId, gone[0]!.userId);
        this.realtime.records(tenantId, list.id);
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'guest.unshare',
            targetType: 'record',
            targetId: recordId,
            targetLabel: `${list.name} · ${title}`,
            meta: { guest_id: gone[0]!.userId },
        });
    }

    // ─────────── Ajustes → Miembros → «Invitados» (admin) ───────────

    async listGuests(tenantId: number): Promise<GuestSummary[]> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const people = await tx
                .select({ id: users.id, name: users.name, email: users.email, invitedAt: users.invitedAt })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'guest')))
                .orderBy(asc(users.name), asc(users.id));
            if (people.length === 0) return [];
            const ids = people.map((p) => p.id);
            const listRows = await tx
                .select({ id: lists.id, slug: lists.slug, name: lists.name, settings: lists.settings })
                .from(lists)
                .where(eq(lists.tenantId, tenantId))
                .orderBy(asc(lists.position), asc(lists.id));
            const shares = await tx
                .select({
                    id: recordShares.id,
                    recordId: recordShares.recordId,
                    listId: recordShares.listId,
                    userId: recordShares.userId,
                    level: recordShares.level,
                })
                .from(recordShares)
                .innerJoin(records, eq(records.id, recordShares.recordId))
                .where(and(eq(recordShares.tenantId, tenantId), inArray(recordShares.userId, ids)))
                .orderBy(asc(recordShares.id));
            const titles = await this.titles(tx, tenantId, shares.map((s) => ({ listId: s.listId, recordId: s.recordId })), listRows);
            const listById = new Map(listRows.map((l) => [l.id, l]));
            return people.map((p): GuestSummary => ({
                user_id: p.id,
                name: p.name,
                email: p.email,
                pending: p.invitedAt !== null,
                lists: listRows
                    .map((l) => ({ l, perms: resolvePermissions((l.settings ?? {}) as Record<string, unknown>).users[String(p.id)] }))
                    .filter((x) => x.perms !== undefined)
                    .map((x) => ({ list_id: x.l.id, list_slug: x.l.slug, list_name: x.l.name, level: guestLevelOf(x.perms) ?? 'view' })),
                records: shares
                    .filter((s) => s.userId === p.id)
                    .map((s) => ({
                        share_id: s.id,
                        record_id: s.recordId,
                        list_id: s.listId,
                        list_slug: listById.get(s.listId)?.slug ?? '',
                        list_name: listById.get(s.listId)?.name ?? '',
                        title: titles.get(s.recordId) ?? `Registro #${s.recordId}`,
                        level: s.level as GuestLevel,
                    })),
            }));
        });
    }

    /** Quita a un invitado de la empresa con todo lo que tenía compartido. */
    async removeGuest(tenantId: number, actorId: number, guestId: number): Promise<void> {
        const email = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [m] = await tx
                .select({ role: memberships.role, email: users.email })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, guestId)))
                .limit(1);
            if (!m || m.role !== 'guest') throw guestNotFound();
            await tx.delete(recordShares).where(and(eq(recordShares.tenantId, tenantId), eq(recordShares.userId, guestId)));
            await this.dropListAccessInTx(tx, tenantId, guestId);
            await tx.delete(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, guestId)));
            return m.email;
        });
        this.realtime.lists(tenantId);
        await this.audit.log({
            tenantId,
            userId: actorId,
            action: 'guest.remove',
            targetType: 'user',
            targetId: guestId,
            targetLabel: email,
        });
    }

    resendInvite(tenantId: number, guestId: number): Promise<{ email: string }> {
        return this.auth.resendInvite(tenantId, guestId);
    }

    // ─────────── Lo que ve el invitado ───────────

    async sharedWithMe(tenantId: number, userId: number): Promise<SharedWithMeDto> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [t] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
            const listRows = await tx
                .select({ id: lists.id, slug: lists.slug, name: lists.name, icon: lists.icon, color: lists.color, settings: lists.settings })
                .from(lists)
                .where(eq(lists.tenantId, tenantId))
                .orderBy(asc(lists.position), asc(lists.id));
            const shares = await tx
                .select({ recordId: recordShares.recordId, listId: recordShares.listId, level: recordShares.level })
                .from(recordShares)
                .innerJoin(records, eq(records.id, recordShares.recordId))
                .where(and(eq(recordShares.tenantId, tenantId), eq(recordShares.userId, userId)))
                .orderBy(asc(recordShares.id))
                .limit(MAX_RECORD_SHARES_PER_GUEST);
            const titles = await this.titles(tx, tenantId, shares, listRows);
            const listById = new Map(listRows.map((l) => [l.id, l]));
            return {
                tenant_name: t?.name ?? '',
                lists: listRows
                    .map((l) => ({ l, perms: resolvePermissions((l.settings ?? {}) as Record<string, unknown>).users[String(userId)] }))
                    .filter((x) => x.perms !== undefined)
                    .map((x) => ({
                        id: x.l.id,
                        slug: x.l.slug,
                        name: x.l.name,
                        icon: x.l.icon,
                        color: x.l.color,
                        level: guestLevelOf(x.perms) ?? 'view',
                    })),
                records: shares
                    .filter((s) => listById.has(s.listId))
                    .map((s) => ({
                        id: s.recordId,
                        list_id: s.listId,
                        list_slug: listById.get(s.listId)!.slug,
                        list_name: listById.get(s.listId)!.name,
                        title: titles.get(s.recordId) ?? `Registro #${s.recordId}`,
                        level: s.level as GuestLevel,
                    })),
            };
        });
    }

    // ─────────── Internos ───────────

    /**
     * Suma (o reusa) al invitado. Un invitado NUEVO cuenta contra el tope de
     * invitados del plan; compartirle algo más a uno que ya está, no.
     */
    private async ensureGuest(
        tenantId: number,
        actorId: number,
        input: ShareRecordInput,
        label: string,
    ): Promise<GuestInviteResult> {
        const email = input.email.trim().toLowerCase();
        const current = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [m] = await tx
                .select({ role: memberships.role })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(and(eq(memberships.tenantId, tenantId), sql`lower(${users.email}) = ${email}`))
                .limit(1);
            return m?.role ?? null;
        });
        if (current !== 'guest') await this.billing.assertCanAddGuest(tenantId);
        const r = await this.auth.addToTenant(
            tenantId,
            { email, name: input.name, role: 'guest' },
            { invitedById: actorId > 0 ? actorId : null, shared: { label } },
        );
        let notified = r.notified;
        if (r.alreadyGuest) {
            // Ya era invitado: sólo el aviso de lo nuevo (correo + campana).
            const [inviter] = actorId > 0
                ? await this.tenantDb.withTenant(tenantId, (tx) => tx.select({ name: users.name }).from(users).where(eq(users.id, actorId)).limit(1))
                : [];
            const company = await this.tenantName(tenantId);
            notified = await this.auth.notifyGuestShared(r.user, company, inviter?.name ?? null, label);
        }
        return { user_id: r.user.id, invited: r.invited, notified };
    }

    private async tenantName(tenantId: number): Promise<string> {
        const [t] = await this.tenantDb.withTenant(tenantId, (tx) => tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1));
        return t?.name ?? '';
    }

    /** Escribe (o borra con `null`) el acceso por persona de un invitado a una lista. */
    private async writeListAccess(tenantId: number, listId: number, guestId: number, level: GuestLevel | null): Promise<void> {
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .select({ settings: lists.settings })
                .from(lists)
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId)))
                .for('update')
                .limit(1);
            if (!row) throw guestNotFound();
            const settings = (row.settings ?? {}) as Record<string, unknown>;
            const doc = resolvePermissions(settings);
            const users = { ...doc.users };
            if (level === null) delete users[String(guestId)];
            else users[String(guestId)] = guestListPermissions(level);
            await tx
                .update(lists)
                .set({ settings: { ...settings, permissions: { ...doc, users } }, updatedAt: new Date() })
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId)));
        });
    }

    /** Saca al invitado de todas las listas que tenía compartidas (dentro del tx). */
    private async dropListAccessInTx(tx: Tx, tenantId: number, guestId: number): Promise<void> {
        const key = String(guestId);
        const rows = await tx
            .select({ id: lists.id, settings: lists.settings })
            .from(lists)
            .where(and(eq(lists.tenantId, tenantId), sql`${lists.settings} -> 'permissions' -> 'users' ? ${key}`));
        for (const l of rows) {
            const settings = (l.settings ?? {}) as Record<string, unknown>;
            const doc = resolvePermissions(settings);
            const users = { ...doc.users };
            delete users[key];
            await tx
                .update(lists)
                .set({ settings: { ...settings, permissions: { ...doc, users } }, updatedAt: new Date() })
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, l.id)));
        }
    }

    /** Sin ninguna lista ni registro compartido, el invitado sale de la empresa. */
    private async cleanupIfNoAccess(tenantId: number, guestId: number): Promise<void> {
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [m] = await tx
                .select({ role: memberships.role })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, guestId)))
                .limit(1);
            if (m?.role !== 'guest') return;
            const [{ n } = { n: 0 }] = await tx
                .select({ n: sql<number>`count(*)::int` })
                .from(recordShares)
                .where(and(eq(recordShares.tenantId, tenantId), eq(recordShares.userId, guestId)));
            if (n > 0) return;
            const key = String(guestId);
            const [withList] = await tx
                .select({ id: lists.id })
                .from(lists)
                .where(and(eq(lists.tenantId, tenantId), sql`${lists.settings} -> 'permissions' -> 'users' ? ${key}`))
                .limit(1);
            if (withList) return;
            await tx.delete(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, guestId)));
        });
    }

    private async assertGuest(tenantId: number, userId: number): Promise<void> {
        const [m] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ role: memberships.role })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
                .limit(1),
        );
        if (m?.role !== 'guest') throw guestNotFound();
    }

    private async guestRows(tenantId: number, ids: number[]): Promise<Array<{ id: number; name: string; email: string; invitedAt: Date | null }>> {
        return this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: users.id, name: users.name, email: users.email, invitedAt: users.invitedAt })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'guest'), inArray(memberships.userId, ids)))
                .orderBy(asc(users.name)),
        );
    }

    /**
     * El registro, si quien comparte lo puede EDITAR (si no, 404 opaco como
     * cualquier registro fuera de su alcance), con su título para el correo.
     */
    private async editableRecord(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        recordId: number,
    ): Promise<{ list: { id: number; name: string }; title: string }> {
        if (actor.role === 'guest') throw new ForbiddenException({ code: 'guest_forbidden', message: 'Como invitado no puedes compartir', data: { status: 403 } });
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx
                .select({ id: records.id, data: records.data, createdBy: records.createdBy })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, list.id), eq(records.id, recordId)))
                .limit(1);
            return r ?? null;
        });
        if (!row || !this.records.canReach(list, actor, 'edit', row)) {
            throw new NotFoundException({ code: 'record_not_found', message: 'Registro no encontrado', data: { status: 404 } });
        }
        const titles = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.titles(tx, tenantId, [{ listId: list.id, recordId }], [{ id: list.id, settings: list.settings }]),
        );
        return { list: { id: list.id, name: list.name }, title: titles.get(recordId) ?? `Registro #${recordId}` };
    }

    /** Títulos de registros (campo de título de cada lista), en una query por lista. */
    private async titles(
        tx: Tx,
        tenantId: number,
        refs: ReadonlyArray<{ listId: number; recordId: number }>,
        listRows: ReadonlyArray<{ id: number; settings: unknown }>,
    ): Promise<Map<number, string>> {
        const out = new Map<number, string>();
        const byList = new Map<number, number[]>();
        for (const r of refs) byList.set(r.listId, [...(byList.get(r.listId) ?? []), r.recordId]);
        for (const [listId, ids] of byList) {
            const listRow = listRows.find((l) => l.id === listId);
            const fs = await tx
                .select({ id: fields.id, type: fields.type })
                .from(fields)
                .where(and(eq(fields.tenantId, tenantId), eq(fields.listId, listId)))
                .orderBy(asc(fields.position), asc(fields.id));
            const titleId = resolveTitleFieldId(
                fs.map((f) => ({ id: f.id, type: f.type as FieldType })),
                (listRow?.settings ?? {}) as Record<string, unknown>,
            );
            if (titleId === null) continue;
            const key = jsonbKeyForField(titleId);
            const rows = await tx
                .select({ id: records.id, title: sql<string | null>`${records.data} ->> ${key}` })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), inArray(records.id, ids)));
            for (const r of rows) if (r.title && r.title.trim() !== '') out.set(r.id, r.title.trim());
        }
        return out;
    }

    private shareRowsQuery(tx: Tx, tenantId: number) {
        void tenantId;
        return tx
            .select({
                id: recordShares.id,
                recordId: recordShares.recordId,
                listId: recordShares.listId,
                userId: recordShares.userId,
                level: recordShares.level,
                createdAt: recordShares.createdAt,
                name: users.name,
                email: users.email,
                invitedAt: users.invitedAt,
            })
            .from(recordShares)
            .innerJoin(users, eq(users.id, recordShares.userId))
            .$dynamic();
    }
}

function toShareDto(r: {
    id: number;
    recordId: number;
    listId: number;
    userId: number;
    level: string;
    createdAt: Date;
    name: string;
    email: string;
    invitedAt: Date | null;
}): RecordShareDto {
    return {
        id: r.id,
        record_id: r.recordId,
        list_id: r.listId,
        user_id: r.userId,
        name: r.name,
        email: r.email,
        level: r.level as GuestLevel,
        pending: r.invitedAt !== null,
        created_at: r.createdAt.toISOString(),
    };
}

function guestNotFound(): NotFoundException {
    return new NotFoundException({ code: 'guest_not_found', message: 'Esa persona no es invitada aquí', data: { status: 404 } });
}

