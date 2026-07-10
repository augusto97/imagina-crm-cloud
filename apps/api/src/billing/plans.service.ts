import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
    PLAN_LIMITS,
    type CreatePlanInput,
    type PlanLimits,
    type PlatformPlan,
    type UpdatePlanInput,
} from '@imagina-base/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/client';
import { plans, tenants } from '../db/schema';

const UNLIMITED: PlanLimits = { max_records: null, max_users: null, max_automations: null };

/**
 * Planes de suscripción (ADR-S15 F3). La fuente viva de los límites es la tabla
 * `plans` (editable por el operador); `PLAN_LIMITS` queda como fallback de los
 * built-in. Corre sobre la conexión base (config global, sin scope de tenant).
 * Cachea 30s para no pegarle a la DB en el hot path (`assertCanCreateRecord`).
 */
@Injectable()
export class PlansService {
    private cache: { at: number; map: Map<string, PlanLimits>; list: PlatformPlan[] } | null = null;
    private readonly ttlMs = 30_000;

    constructor(@Inject(DRIZZLE) private readonly db: Db) {}

    private async load(): Promise<{ map: Map<string, PlanLimits>; list: PlatformPlan[] }> {
        if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache;
        const rows = await this.db.select().from(plans).orderBy(asc(plans.position), asc(plans.slug));
        const list: PlatformPlan[] = rows.map((r) => ({
            slug: r.slug,
            name: r.name,
            max_records: r.maxRecords,
            max_users: r.maxUsers,
            max_automations: r.maxAutomations,
            is_active: r.isActive,
            position: r.position,
        }));
        const map = new Map<string, PlanLimits>(
            list.map((p) => [p.slug, { max_records: p.max_records, max_users: p.max_users, max_automations: p.max_automations }]),
        );
        this.cache = { at: Date.now(), map, list };
        return this.cache;
    }

    private invalidate(): void {
        this.cache = null;
    }

    async list(): Promise<PlatformPlan[]> {
        return (await this.load()).list;
    }

    async exists(slug: string): Promise<boolean> {
        return (await this.load()).map.has(slug);
    }

    /** Límites de un plan: DB → fallback built-in → ilimitado si es desconocido. */
    async limits(slug: string): Promise<PlanLimits> {
        const fromDb = (await this.load()).map.get(slug);
        if (fromDb) return fromDb;
        return (PLAN_LIMITS as Record<string, PlanLimits>)[slug] ?? UNLIMITED;
    }

    async create(input: CreatePlanInput): Promise<PlatformPlan> {
        const [dup] = await this.db.select({ slug: plans.slug }).from(plans).where(eq(plans.slug, input.slug)).limit(1);
        if (dup) {
            throw new ConflictException({ code: 'plan_exists', message: `Ya existe un plan '${input.slug}'`, data: { status: 409, errors: { slug: 'Ya existe' } } });
        }
        const posRows = await this.db.select({ n: sql<number>`coalesce(max(${plans.position}), -1)::int` }).from(plans);
        await this.db.insert(plans).values({
            slug: input.slug,
            name: input.name,
            maxRecords: input.max_records,
            maxUsers: input.max_users,
            maxAutomations: input.max_automations,
            isActive: input.is_active,
            position: (posRows[0]?.n ?? -1) + 1,
        });
        this.invalidate();
        return this.get(input.slug);
    }

    async update(slug: string, input: UpdatePlanInput): Promise<PlatformPlan> {
        const changes: Partial<typeof plans.$inferInsert> = { updatedAt: sql`now()` as unknown as Date };
        if (input.name !== undefined) changes.name = input.name;
        if (input.max_records !== undefined) changes.maxRecords = input.max_records;
        if (input.max_users !== undefined) changes.maxUsers = input.max_users;
        if (input.max_automations !== undefined) changes.maxAutomations = input.max_automations;
        if (input.is_active !== undefined) changes.isActive = input.is_active;
        const res = await this.db.update(plans).set(changes).where(eq(plans.slug, slug)).returning();
        if (res.length === 0) {
            throw new NotFoundException({ code: 'plan_not_found', message: `Plan '${slug}' no existe`, data: { status: 404 } });
        }
        this.invalidate();
        return this.get(slug);
    }

    /** Borra un plan. Rechaza si alguna empresa lo usa (evita huérfanos). */
    async remove(slug: string): Promise<void> {
        const useRows = await this.db.select({ n: sql<number>`count(*)::int` }).from(tenants).where(eq(tenants.plan, slug));
        const inUse = useRows[0]?.n ?? 0;
        if (inUse > 0) {
            throw new ConflictException({ code: 'plan_in_use', message: `El plan '${slug}' lo usan ${inUse} empresas; reasignálas antes de borrarlo`, data: { status: 409 } });
        }
        const res = await this.db.delete(plans).where(eq(plans.slug, slug)).returning();
        if (res.length === 0) {
            throw new NotFoundException({ code: 'plan_not_found', message: `Plan '${slug}' no existe`, data: { status: 404 } });
        }
        this.invalidate();
    }

    private async get(slug: string): Promise<PlatformPlan> {
        const found = (await this.load()).list.find((p) => p.slug === slug);
        if (!found) throw new NotFoundException({ code: 'plan_not_found', message: `Plan '${slug}' no existe`, data: { status: 404 } });
        return found;
    }
}
