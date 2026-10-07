import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
    favoritesSchema,
    type FavoriteView,
    type Favorites,
    type MeUserSummary,
    type UpdateFavoritesInput,
} from '@imagina-base/shared';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/client';
import { lists, memberships, mentions, savedViews } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';
import { MeRepository, type MeUserRow } from './me.repository';

/** Tope duro de resultados del search (anti dump masivo de miembros). */
const MAX_SEARCH_LIMIT = 25;
const DEFAULT_SEARCH_LIMIT = 8;

@Injectable()
export class MeService {
    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly repo: MeRepository,
    ) {}

    /**
     * Búsqueda de miembros del tenant activo por nombre o email (substring,
     * case-insensitive). Query vacío → [] sin tocar la DB: el endpoint no
     * soporta "todos los users" a propósito.
     */
    async searchUsers(tenantId: number, q: string, rawLimit?: number): Promise<MeUserSummary[]> {
        const needle = q.trim();
        if (needle === '') return [];
        const limit = clampLimit(rawLimit);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.searchMembers(tx, tenantId, needle, limit),
        );
        return rows.map(toSummary);
    }

    /**
     * v0.1.252 — Miembros por ids (hasta 100), en UNA query: los gráficos
     * agrupados por un campo persona mostraban el id («1») en vez del
     * nombre. Los ids que no son miembros simplemente no vuelven.
     */
    async getUsers(tenantId: number, ids: number[]): Promise<MeUserSummary[]> {
        const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 100);
        if (clean.length === 0) return [];
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.findMembers(tx, tenantId, clean),
        );
        return rows.map(toSummary);
    }

    /** Lookup de un miembro del tenant activo por id — 404 si no es miembro. */
    async getUser(tenantId: number, userId: number): Promise<MeUserSummary> {
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.findMember(tx, tenantId, userId),
        );
        if (!row) {
            throw new NotFoundException({
                code: 'user_not_found',
                message: `El usuario ${userId} no es miembro de este workspace`,
                data: { status: 404 },
            });
        }
        return toSummary(row);
    }

    getEmailSignature(userId: number): Promise<string> {
        return this.repo.getSignature(this.db, userId);
    }

    /** Últimas menciones del usuario en el tenant (RLS + índice por usuario). */
    async mentions(
        tenantId: number,
        userId: number,
        rawLimit: number,
    ): Promise<Array<Record<string, unknown>>> {
        const limit = Math.min(Math.max(Math.trunc(rawLimit) || 20, 1), 100);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(mentions)
                .where(and(eq(mentions.tenantId, tenantId), eq(mentions.mentionedUserId, userId)))
                .orderBy(desc(mentions.id))
                .limit(limit),
        );
        // Shape estilo activity (lo que consume el NotificationBell).
        return rows.map((m) => ({
            id: m.id,
            list_id: m.listId,
            record_id: m.recordId,
            user_id: m.authorUserId,
            action: 'comment_created',
            changes: { snippet: m.snippet },
            created_at: m.createdAt.toISOString(),
        }));
    }

    async updateEmailSignature(userId: number, signature: string): Promise<string> {
        await this.repo.setSignature(this.db, userId, signature);
        return signature;
    }

    /**
     * v0.1.107 — Favoritos del usuario en el workspace activo (listas y
     * dashboards anclados en el menú). Viven en `memberships.settings`
     * (por usuario+tenant); un PATCH parcial reemplaza cada array presente.
     */
    async getFavorites(tenantId: number, userId: number): Promise<Favorites> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ settings: memberships.settings })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
                .limit(1),
        );
        return parseFavorites(row?.settings);
    }

    async favoriteViews(tenantId: number, userId: number): Promise<FavoriteView[]> {
        const ids = (await this.getFavorites(tenantId, userId)).views;
        if (ids.length === 0) return [];
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    id: savedViews.id,
                    name: savedViews.name,
                    type: savedViews.type,
                    icon: savedViews.icon,
                    color: savedViews.color,
                    listId: lists.id,
                    listSlug: lists.slug,
                    listName: lists.name,
                })
                .from(savedViews)
                .innerJoin(lists, eq(lists.id, savedViews.listId))
                .where(
                    and(
                        eq(savedViews.tenantId, tenantId),
                        inArray(savedViews.id, ids),
                        or(eq(savedViews.isPrivate, false), eq(savedViews.createdBy, userId)),
                    ),
                ),
        );
        // En el orden en que se anclaron (los borrados no vuelven).
        const byId = new Map(rows.map((r) => [r.id, r]));
        return ids.flatMap((id) => {
            const r = byId.get(id);
            return r
                ? [{ id: r.id, name: r.name, type: r.type, icon: r.icon ?? null, color: r.color ?? null, list_id: r.listId, list_slug: r.listSlug, list_name: r.listName }]
                : [];
        });
    }

    async setFavorites(tenantId: number, userId: number, patch: UpdateFavoritesInput): Promise<Favorites> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .select({ settings: memberships.settings })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
                .limit(1);
            const settings = { ...(row?.settings ?? {}) };
            const merged: Favorites = { ...parseFavorites(settings), ...patch };
            settings.favorites = merged;
            await tx
                .update(memberships)
                .set({ settings, updatedAt: new Date() })
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
            return merged;
        });
    }
}

function parseFavorites(settings: Record<string, unknown> | undefined | null): Favorites {
    const parsed = favoritesSchema.safeParse((settings as Record<string, unknown> | undefined)?.favorites ?? {});
    return parsed.success ? parsed.data : favoritesSchema.parse({});
}

/** login = email y display_name = name (shape del picker heredado del plugin). */
function toSummary(row: MeUserRow): MeUserSummary {
    return { id: row.id, login: row.email, display_name: row.name, avatar_url: '' };
}

function clampLimit(raw?: number): number {
    if (raw === undefined || Number.isNaN(raw)) return DEFAULT_SEARCH_LIMIT;
    return Math.min(Math.max(Math.trunc(raw), 1), MAX_SEARCH_LIMIT);
}
