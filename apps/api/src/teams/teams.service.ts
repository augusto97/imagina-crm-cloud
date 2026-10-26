import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
    MAX_TEAMS,
    type CreateTeamInput,
    type Team,
    type TeamMember,
    type UpdateTeamInput,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { Tx } from '../db/client';
import { memberships, teamMembers, teams, users } from '../db/schema';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';

/** Roles que pueden ser parte de un equipo (nunca clientes del portal ni invitados). */
export const TEAM_ELIGIBLE_ROLES = ['admin', 'manager', 'agent', 'viewer'] as const;

/** Un equipo con lo que hace falta para mostrarlo en otro módulo. */
export interface TeamInfo {
    id: number;
    name: string;
    color: string | null;
    icon: string | null;
}

/**
 * C1 — Equipos de una empresa. Además del CRUD de Ajustes → Equipos, expone
 * helpers PÚBLICOS para el resto de los módulos (ACL, avisos, «Mi trabajo»,
 * import/export, aprobaciones): todos reciben un `tx` ya scopeado a la empresa
 * (RLS) para no abrir otra transacción.
 */
@Injectable()
export class TeamsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly realtime: RealtimeService,
        private readonly audit: AuditService,
    ) {}

    // ─────────────────────────── Helpers públicos ───────────────────────────

    /**
     * Ids de las personas de un equipo (las que SIGUEN siendo del equipo de
     * trabajo de la empresa: quien pasó a cliente o se fue no cuenta).
     * Pensado para los aprobadores por equipo y los avisos a @equipo.
     */
    async memberIds(tx: Tx, teamId: number): Promise<number[]> {
        const rows = await tx
            .select({ userId: teamMembers.userId })
            .from(teamMembers)
            .innerJoin(
                memberships,
                and(eq(memberships.userId, teamMembers.userId), eq(memberships.tenantId, teamMembers.tenantId)),
            )
            .where(and(eq(teamMembers.teamId, teamId), inArray(memberships.role, [...TEAM_ELIGIBLE_ROLES])))
            .orderBy(asc(teamMembers.userId));
        return rows.map((r) => r.userId);
    }

    /** Personas de varios equipos (id de equipo → ids de personas). */
    async membersOf(tx: Tx, tenantId: number, teamIds: readonly number[]): Promise<Map<number, number[]>> {
        const out = new Map<number, number[]>();
        const ids = [...new Set(teamIds)].filter((n) => Number.isInteger(n) && n > 0);
        if (ids.length === 0) return out;
        const rows = await tx
            .select({ teamId: teamMembers.teamId, userId: teamMembers.userId })
            .from(teamMembers)
            .innerJoin(
                memberships,
                and(eq(memberships.userId, teamMembers.userId), eq(memberships.tenantId, teamMembers.tenantId)),
            )
            .where(
                and(
                    eq(teamMembers.tenantId, tenantId),
                    inArray(teamMembers.teamId, ids),
                    inArray(memberships.role, [...TEAM_ELIGIBLE_ROLES]),
                ),
            );
        for (const r of rows) {
            const arr = out.get(r.teamId) ?? [];
            arr.push(r.userId);
            out.set(r.teamId, arr);
        }
        return out;
    }

    /** Equipos de UNA persona en la empresa. */
    async teamIdsOf(tx: Tx, tenantId: number, userId: number): Promise<number[]> {
        return (await this.teamIdsByUser(tx, tenantId, [userId])).get(userId) ?? [];
    }

    /** Equipos de VARIAS personas (id de persona → ids de equipo). */
    async teamIdsByUser(tx: Tx, tenantId: number, userIds: readonly number[]): Promise<Map<number, number[]>> {
        const out = new Map<number, number[]>();
        const ids = [...new Set(userIds)].filter((n) => Number.isInteger(n) && n > 0);
        if (ids.length === 0) return out;
        const rows = await tx
            .select({ teamId: teamMembers.teamId, userId: teamMembers.userId })
            .from(teamMembers)
            .where(and(eq(teamMembers.tenantId, tenantId), inArray(teamMembers.userId, ids)));
        for (const r of rows) {
            const arr = out.get(r.userId) ?? [];
            arr.push(r.teamId);
            out.set(r.userId, arr);
        }
        return out;
    }

    /** Nombre, color e icono de los equipos de la empresa (todos o los pedidos). */
    async infos(tx: Tx, tenantId: number, ids?: readonly number[]): Promise<Map<number, TeamInfo>> {
        const wanted = ids ? [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0) : null;
        if (wanted && wanted.length === 0) return new Map();
        const rows = await tx
            .select({ id: teams.id, name: teams.name, color: teams.color, icon: teams.icon })
            .from(teams)
            .where(and(eq(teams.tenantId, tenantId), wanted ? inArray(teams.id, wanted) : undefined));
        return new Map(rows.map((r) => [r.id, r]));
    }

    /** Saca a una persona de todos los equipos de la empresa (deja de ser del equipo). */
    async removeUserEverywhere(tx: Tx, tenantId: number, userId: number): Promise<void> {
        await tx.delete(teamMembers).where(and(eq(teamMembers.tenantId, tenantId), eq(teamMembers.userId, userId)));
    }

    // ─────────────────────────── CRUD ───────────────────────────

    async list(tenantId: number): Promise<Team[]> {
        return this.tenantDb.withTenant(tenantId, (tx) => this.listInTx(tx, tenantId));
    }

    async listInTx(tx: Tx, tenantId: number): Promise<Team[]> {
        const rows = await tx
            .select()
            .from(teams)
            .where(eq(teams.tenantId, tenantId))
            .orderBy(sql`lower(${teams.name})`, asc(teams.id));
        if (rows.length === 0) return [];
        const mem = await tx
            .select({ teamId: teamMembers.teamId, userId: teamMembers.userId, isLead: teamMembers.isLead, name: users.name, email: users.email })
            .from(teamMembers)
            .innerJoin(users, eq(users.id, teamMembers.userId))
            .innerJoin(
                memberships,
                and(eq(memberships.userId, teamMembers.userId), eq(memberships.tenantId, teamMembers.tenantId)),
            )
            .where(and(eq(teamMembers.tenantId, tenantId), inArray(memberships.role, [...TEAM_ELIGIBLE_ROLES])))
            .orderBy(sql`${teamMembers.isLead} DESC`, asc(users.name));
        const byTeam = new Map<number, Team['members']>();
        for (const m of mem) {
            const arr = byTeam.get(m.teamId) ?? [];
            arr.push({ user_id: m.userId, is_lead: m.isLead, name: (m.name || m.email.split('@')[0] || '').trim() });
            byTeam.set(m.teamId, arr);
        }
        return rows.map((r) => {
            const members = byTeam.get(r.id) ?? [];
            return {
                id: r.id,
                name: r.name,
                description: r.description ?? null,
                icon: r.icon ?? null,
                color: r.color ?? null,
                members,
                member_count: members.length,
                created_at: r.createdAt.toISOString(),
                updated_at: r.updatedAt.toISOString(),
            };
        });
    }

    async get(tenantId: number, id: number): Promise<Team> {
        const all = await this.list(tenantId);
        const hit = all.find((t) => t.id === id);
        if (!hit) throw teamNotFound(id);
        return hit;
    }

    async create(tenantId: number, actorId: number, input: CreateTeamInput): Promise<Team> {
        const id = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [{ n } = { n: 0 }] = await tx
                .select({ n: sql<number>`count(*)::int` })
                .from(teams)
                .where(eq(teams.tenantId, tenantId));
            if (n >= MAX_TEAMS) {
                throw new BadRequestException({
                    code: 'team_limit',
                    message: `Una empresa puede tener hasta ${MAX_TEAMS} equipos.`,
                    data: { status: 400 },
                });
            }
            await this.assertNameFree(tx, tenantId, input.name, null);
            const [row] = await tx
                .insert(teams)
                .values({
                    tenantId,
                    name: input.name.trim(),
                    description: input.description?.trim() || null,
                    icon: input.icon ?? null,
                    color: input.color ?? null,
                    createdBy: actorId > 0 ? actorId : null,
                })
                .returning({ id: teams.id });
            await this.replaceMembers(tx, tenantId, row!.id, input.members ?? []);
            return row!.id;
        });
        this.realtime.invalidate(tenantId, 'teams');
        const team = await this.get(tenantId, id);
        await this.audit.log({
            tenantId,
            userId: actorId > 0 ? actorId : null,
            action: 'team.create',
            targetType: 'team',
            targetId: id,
            targetLabel: team.name,
            meta: { members: team.member_count },
        });
        return team;
    }

    async update(tenantId: number, actorId: number, id: number, input: UpdateTeamInput): Promise<Team> {
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx.select().from(teams).where(and(eq(teams.tenantId, tenantId), eq(teams.id, id))).limit(1);
            if (!row) throw teamNotFound(id);
            if (input.name !== undefined) await this.assertNameFree(tx, tenantId, input.name, id);
            const patch: Partial<typeof teams.$inferInsert> = { updatedAt: new Date() };
            if (input.name !== undefined) patch.name = input.name.trim();
            if (input.description !== undefined) patch.description = input.description?.trim() || null;
            if (input.icon !== undefined) patch.icon = input.icon;
            if (input.color !== undefined) patch.color = input.color;
            await tx.update(teams).set(patch).where(and(eq(teams.tenantId, tenantId), eq(teams.id, id)));
            if (input.members !== undefined) await this.replaceMembers(tx, tenantId, id, input.members);
        });
        this.realtime.invalidate(tenantId, 'teams');
        // El acceso por equipo cambia lo que ven sus personas: que la tabla se refresque.
        if (input.members !== undefined) this.realtime.lists(tenantId);
        const team = await this.get(tenantId, id);
        await this.audit.log({
            tenantId,
            userId: actorId > 0 ? actorId : null,
            action: 'team.update',
            targetType: 'team',
            targetId: id,
            targetLabel: team.name,
            meta: { members: team.member_count, ...(input.members !== undefined ? { members_changed: true } : {}) },
        });
        return team;
    }

    async remove(tenantId: number, actorId: number, id: number): Promise<void> {
        const name = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .delete(teams)
                .where(and(eq(teams.tenantId, tenantId), eq(teams.id, id)))
                .returning({ name: teams.name });
            if (!row) throw teamNotFound(id);
            return row.name;
        });
        this.realtime.invalidate(tenantId, 'teams');
        this.realtime.lists(tenantId);
        await this.audit.log({
            tenantId,
            userId: actorId > 0 ? actorId : null,
            action: 'team.delete',
            targetType: 'team',
            targetId: id,
            targetLabel: name,
        });
    }

    /**
     * Reemplaza las personas del equipo. Sólo personas del EQUIPO de trabajo
     * de esta empresa: un id que no lo es (cliente del portal, de otra
     * empresa, inexistente) se rechaza con 400 en vez de guardarse.
     */
    private async replaceMembers(tx: Tx, tenantId: number, teamId: number, members: readonly TeamMember[]): Promise<void> {
        const byId = new Map<number, boolean>();
        for (const m of members) byId.set(m.user_id, (byId.get(m.user_id) ?? false) || m.is_lead === true);
        const ids = [...byId.keys()];
        if (ids.length > 0) {
            const ok = await tx
                .select({ userId: memberships.userId })
                .from(memberships)
                .where(
                    and(
                        eq(memberships.tenantId, tenantId),
                        inArray(memberships.userId, ids),
                        inArray(memberships.role, [...TEAM_ELIGIBLE_ROLES]),
                    ),
                );
            const valid = new Set(ok.map((r) => r.userId));
            const bad = ids.filter((u) => !valid.has(u));
            if (bad.length > 0) {
                throw new BadRequestException({
                    code: 'not_a_member',
                    message: 'Un equipo sólo puede tener personas del equipo de trabajo de la empresa.',
                    data: { status: 400, user_ids: bad },
                });
            }
        }
        await tx
            .delete(teamMembers)
            .where(
                and(
                    eq(teamMembers.tenantId, tenantId),
                    eq(teamMembers.teamId, teamId),
                    ids.length > 0 ? notInArray(teamMembers.userId, ids) : undefined,
                ),
            );
        if (ids.length === 0) return;
        await tx
            .insert(teamMembers)
            .values(ids.map((u) => ({ tenantId, teamId, userId: u, isLead: byId.get(u) === true })))
            .onConflictDoUpdate({
                target: [teamMembers.teamId, teamMembers.userId],
                set: { isLead: sql`excluded.is_lead` },
            });
    }

    private async assertNameFree(tx: Tx, tenantId: number, name: string, exceptId: number | null): Promise<void> {
        const [hit] = await tx
            .select({ id: teams.id })
            .from(teams)
            .where(
                and(
                    eq(teams.tenantId, tenantId),
                    sql`lower(${teams.name}) = lower(${name.trim()})`,
                    exceptId !== null ? sql`${teams.id} <> ${exceptId}` : undefined,
                ),
            )
            .limit(1);
        if (hit) {
            throw new ConflictException({
                code: 'team_name_taken',
                message: `Ya hay un equipo que se llama «${name.trim()}».`,
                data: { status: 409 },
            });
        }
    }
}

function teamNotFound(id: number): NotFoundException {
    return new NotFoundException({ code: 'team_not_found', message: `Equipo ${id} no encontrado`, data: { status: 404 } });
}
