import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
    MarkWhatsNewSeenInput,
    WhatsNewAction,
    WhatsNewEvent,
    WhatsNewFeed,
    WhatsNewFeedQuery,
    WhatsNewItem,
    WhatsNewKind,
} from '@imagina-base/shared';
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { tenants, users, whatsNewEntries, whatsNewViews } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';

/** Una destacada sale en el diálogo sólo durante su primer mes en el servidor. */
export const FEATURED_WINDOW_DAYS = 30;
/** Avisos que puede mostrar la franja de arriba a la vez. */
const MAX_NOTICES = 3;

/** Quién mira: la persona y su rol/plan en la empresa activa. */
export interface WhatsNewViewer {
    userId: number;
    tenantId: number;
    /**
     * Rol BASE en la empresa activa: el público de una novedad se elige por rol
     * base (un rol propio cuenta como su base). `guest` sólo ve avisos.
     */
    baseRole: string;
    /** El operador mirando como otra persona: no se marca nada. */
    impersonating?: boolean;
}

interface ViewerContext extends WhatsNewViewer {
    plan: string;
    /** Alta de la persona: lo anterior queda como historial, no como «sin ver». */
    baseline: Date;
    now: Date;
}

const E = whatsNewEntries;
const V = whatsNewViews;

/** Las condiciones de «la ve esta persona» (estado, fecha, vencimiento y público). */
export function visibleWhere(ctx: { baseRole: string; plan: string; now: Date }): SQL {
    const conds: SQL[] = [
        eq(E.status, 'published'),
        isNotNull(E.publishedAt),
        lte(E.publishedAt, ctx.now),
        or(isNull(E.expiresAt), gt(E.expiresAt, ctx.now))!,
        sql`(cardinality(${E.audienceRoles}) = 0 OR ${ctx.baseRole}::text = ANY(${E.audienceRoles}))`,
        sql`(cardinality(${E.audiencePlans}) = 0 OR ${ctx.plan}::text = ANY(${E.audiencePlans}))`,
    ];
    // Un invitado sólo ve avisos: no puede usar las funciones nuevas.
    if (ctx.baseRole === 'guest') conds.push(eq(E.kind, 'notice'));
    return and(...conds)!;
}

/**
 * «Nueva para esta persona»: llegó después de su alta, no la vio y no la
 * escribió ella (el operador no recibe como novedad lo que acaba de publicar).
 */
function isNewExpr(ctx: ViewerContext): SQL<boolean> {
    return sql<boolean>`(${E.announceFrom} IS NOT NULL AND ${E.announceFrom} > ${ctx.baseline.toISOString()}::timestamptz AND ${E.announceFrom} <= ${ctx.now.toISOString()}::timestamptz AND ${V.seenAt} IS NULL AND (${E.createdBy} IS NULL OR ${E.createdBy} <> ${ctx.userId}::bigint))`;
}

const itemColumns = {
    id: E.id,
    key: E.key,
    origin: E.origin,
    kind: E.kind,
    title: E.title,
    summary: E.summary,
    body: E.body,
    imageUrl: E.imageUrl,
    videoUrl: E.videoUrl,
    action: E.action,
    version: E.version,
    publishedAt: E.publishedAt,
    expiresAt: E.expiresAt,
    featured: E.featured,
};

type ItemRow = {
    id: number;
    key: string;
    origin: string;
    kind: string;
    title: string;
    summary: string;
    body: string;
    imageUrl: string | null;
    videoUrl: string | null;
    action: unknown;
    version: string | null;
    publishedAt: Date | null;
    expiresAt: Date | null;
    featured: boolean;
    isNew: boolean;
};

function toItem(r: ItemRow): WhatsNewItem {
    return {
        id: r.id,
        key: r.key,
        origin: r.origin === 'release' ? 'release' : 'operator',
        kind: r.kind as WhatsNewKind,
        title: r.title,
        summary: r.summary,
        body: r.body,
        image_url: r.imageUrl,
        video_url: r.videoUrl,
        action: (r.action as WhatsNewAction | null) ?? null,
        version: r.version,
        published_at: (r.publishedAt ?? new Date(0)).toISOString(),
        expires_at: r.expiresAt ? r.expiresAt.toISOString() : null,
        featured: r.featured,
        is_new: r.isNew === true,
    };
}

/** Qué marca cada evento (sin pisar la primera vez que pasó). */
const EVENT_SET: Record<WhatsNewEvent, Record<string, SQL>> = {
    opened: { openedAt: sql`coalesce(${V.openedAt}, excluded.opened_at)` },
    clicked: { clickedAt: sql`coalesce(${V.clickedAt}, excluded.clicked_at)` },
    dismissed: { dismissedAt: sql`coalesce(${V.dismissedAt}, excluded.dismissed_at)` },
    presented: { presentedAt: sql`coalesce(${V.presentedAt}, excluded.presented_at)` },
};
const EVENT_COLUMN: Record<WhatsNewEvent, 'openedAt' | 'clickedAt' | 'dismissedAt' | 'presentedAt'> = {
    opened: 'openedAt',
    clicked: 'clickedAt',
    dismissed: 'dismissedAt',
    presented: 'presentedAt',
};

/**
 * Las novedades de UNA persona: qué ve (según su rol y el plan de la empresa
 * activa), qué es nuevo para ella y qué ya vio. Lo visto vive por persona en
 * `whats_new_views` (RLS por `app.user_id`): todo lo de la persona corre en
 * `withUser`, así una persona no puede leer ni marcar lo de otra aunque un bug
 * olvide el filtro.
 */
@Injectable()
export class WhatsNewService {
    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
    ) {}

    private async context(viewer: WhatsNewViewer): Promise<ViewerContext> {
        const [row] = await this.db
            .select({ createdAt: users.createdAt, plan: tenants.plan })
            .from(users)
            .innerJoin(tenants, eq(tenants.id, viewer.tenantId))
            .where(eq(users.id, viewer.userId))
            .limit(1);
        if (!row) throw new NotFoundException({ code: 'user_not_found', message: 'Cuenta no encontrada', data: { status: 404 } });
        return { ...viewer, plan: row.plan, baseline: row.createdAt, now: new Date() };
    }

    private joinViews(ctx: ViewerContext): SQL {
        return and(eq(V.entryId, E.id), eq(V.userId, ctx.userId))!;
    }

    private async unseenCount(tx: Tx, ctx: ViewerContext): Promise<number> {
        const [row] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(E)
            .leftJoin(V, this.joinViews(ctx))
            .where(and(visibleWhere(ctx), isNewExpr(ctx)));
        return row?.n ?? 0;
    }

    async feed(viewer: WhatsNewViewer, q: WhatsNewFeedQuery): Promise<WhatsNewFeed> {
        const ctx = await this.context(viewer);
        return this.tenantDb.withUser(ctx.userId, async (tx) => {
            const isNew = isNewExpr(ctx);
            const filters: SQL[] = [visibleWhere(ctx)];
            if (q.kind) filters.push(eq(E.kind, q.kind));
            if (q.before) {
                const [iso, id] = q.before.split('|') as [string, string];
                filters.push(sql`(${E.publishedAt}, ${E.id}) < (${iso}::timestamptz, ${Number(id)}::bigint)`);
            }
            const rows = await tx
                .select({ ...itemColumns, isNew })
                .from(E)
                .leftJoin(V, this.joinViews(ctx))
                .where(and(...filters))
                .orderBy(desc(E.publishedAt), desc(E.id))
                .limit(q.limit + 1);
            const hasMore = rows.length > q.limit;
            const page = rows.slice(0, q.limit);
            const last = page[page.length - 1];

            const notices = await tx
                .select({ ...itemColumns, isNew })
                .from(E)
                .leftJoin(V, this.joinViews(ctx))
                .where(and(visibleWhere(ctx), eq(E.kind, 'notice'), isNull(V.dismissedAt)))
                .orderBy(desc(E.publishedAt), desc(E.id))
                .limit(MAX_NOTICES);

            // La destacada: nueva para la persona, de su primer mes en el
            // servidor, nunca presentada ni descartada. Ni a invitados (sólo
            // ven avisos) ni mientras el operador mira como otra persona.
            let featured: ItemRow | undefined;
            if (!ctx.impersonating && ctx.baseRole !== 'guest') {
                const since = new Date(ctx.now.getTime() - FEATURED_WINDOW_DAYS * 86_400_000);
                [featured] = await tx
                    .select({ ...itemColumns, isNew })
                    .from(E)
                    .leftJoin(V, this.joinViews(ctx))
                    .where(
                        and(
                            visibleWhere(ctx),
                            eq(E.featured, true),
                            sql`${E.kind} <> 'notice'`,
                            isNew,
                            gt(E.announceFrom, since),
                            isNull(V.presentedAt),
                            isNull(V.dismissedAt),
                        ),
                    )
                    .orderBy(desc(E.announceFrom), desc(E.publishedAt), desc(E.id))
                    .limit(1);
            }

            return {
                unseen_count: await this.unseenCount(tx, ctx),
                items: page.map(toItem),
                has_more: hasMore,
                next_before: hasMore && last?.publishedAt ? `${last.publishedAt.toISOString()}|${last.id}` : null,
                notices: notices.map(toItem),
                featured: featured ? toItem(featured) : null,
            };
        });
    }

    /** Marca como vistas las indicadas (o todas las que ve). Devuelve el «sin ver» nuevo. */
    async markSeen(viewer: WhatsNewViewer, input: MarkWhatsNewSeenInput): Promise<{ unseen_count: number }> {
        const ctx = await this.context(viewer);
        return this.tenantDb.withUser(ctx.userId, async (tx) => {
            if (!ctx.impersonating) {
                const targets = await tx
                    .select({ id: E.id })
                    .from(E)
                    .where(and(visibleWhere(ctx), input.all ? undefined : inArray(E.id, input.ids ?? [])));
                if (targets.length > 0) {
                    await tx
                        .insert(V)
                        .values(targets.map((t) => ({ userId: ctx.userId, entryId: t.id, seenAt: ctx.now })))
                        .onConflictDoUpdate({
                            target: [V.userId, V.entryId],
                            set: { seenAt: sql`coalesce(${V.seenAt}, excluded.seen_at)` },
                        });
                }
            }
            return { unseen_count: await this.unseenCount(tx, ctx) };
        });
    }

    /**
     * Registra lo que hizo la persona con una novedad: la abrió (vio el
     * detalle), tocó el botón, la descartó (franja de avisos, diálogo) o se le
     * presentó como destacada. Cualquiera de estas también la marca como vista.
     */
    async event(viewer: WhatsNewViewer, entryId: number, event: WhatsNewEvent): Promise<void> {
        const ctx = await this.context(viewer);
        await this.tenantDb.withUser(ctx.userId, async (tx) => {
            const [visible] = await tx.select({ id: E.id }).from(E).where(and(eq(E.id, entryId), visibleWhere(ctx))).limit(1);
            if (!visible) {
                throw new NotFoundException({ code: 'whats_new_not_found', message: 'Esa novedad no existe', data: { status: 404 } });
            }
            if (ctx.impersonating) return;
            await tx
                .insert(V)
                .values({ userId: ctx.userId, entryId, seenAt: ctx.now, [EVENT_COLUMN[event]]: ctx.now })
                .onConflictDoUpdate({
                    target: [V.userId, V.entryId],
                    set: { seenAt: sql`coalesce(${V.seenAt}, excluded.seen_at)`, ...EVENT_SET[event] },
                });
        });
    }
}
