import { Injectable, NotFoundException } from '@nestjs/common';
import {
    brandingSchema,
    buildWidgetReport,
    CONTENT_WIDGET_TYPES,
    reportUserIds,
    tenantFormatSchema,
    type Branding,
    type Dashboard,
    type DashboardBundleRequest,
    type Field,
    type ReportField,
    type Role,
    type TenantFormat,
    type WidgetReport,
} from '@imagina-base/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { AggregateService } from '../aggregate/aggregate.service';
import { lists, memberships, tenants, users } from '../db/schema';
import { DashboardsService, type DashboardViewer } from '../dashboards/dashboards.service';
import { FieldsService } from '../fields/fields.service';
import { TenantDb } from '../tenancy/tenant-db.service';

/** Lo que hace falta para mostrar un tablero FUERA de la app (sin sesión o por correo). */
export interface DashboardSnapshot {
    dashboard: Dashboard;
    /** `{ [widgetId]: data }`, igual que el bundle de la app. */
    data: Record<string, unknown>;
    /** Campos que USAN los widgets y que quien mira puede ver, por lista. */
    fields: Map<number, Field[]>;
    lists: Array<{ id: number; name: string; slug: string }>;
    /** Nombres de las personas que aparecen en los datos. */
    users: Map<number, string>;
    format: TenantFormat;
    tenantName: string;
    branding: Branding;
}

/** Claves de config de un widget que apuntan a un campo. */
const FIELD_KEY = /(^|_)field_id$/;
const FIELD_KEYS = /(^|_)field_ids$/;

/** Ids de campos que referencia la config de un widget (incluye los árboles de filtros). */
export function referencedFieldIds(value: unknown, out = new Set<number>()): Set<number> {
    if (Array.isArray(value)) {
        for (const v of value) referencedFieldIds(v, out);
        return out;
    }
    if (value === null || typeof value !== 'object') return out;
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        if (FIELD_KEY.test(key) && typeof raw === 'number') {
            out.add(raw);
        } else if (FIELD_KEYS.test(key) && Array.isArray(raw)) {
            for (const v of raw) if (typeof v === 'number') out.add(v);
        } else {
            referencedFieldIds(raw, out);
        }
    }
    return out;
}

/**
 * v0.1.292 (ADR-S50) — Un tablero calculado con el acceso de UNA persona:
 * quien publicó el enlace público o quien es dueño del envío programado. Es
 * la única puerta de los datos que salen sin sesión: el motor, el ACL (scope
 * por rol y campos ocultos) y los widgets son los de la app.
 */
@Injectable()
export class DashboardSnapshotService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly dashboards: DashboardsService,
        private readonly fields: FieldsService,
        private readonly aggregate: AggregateService,
    ) {}

    /**
     * El acceso VIGENTE de una persona en la empresa (rol en vivo). `null` si
     * ya no es miembro, su cuenta está desactivada o sólo es cliente del portal:
     * en esos casos lo que publicó deja de mostrarse.
     */
    async viewerFor(tenantId: number, userId: number): Promise<DashboardViewer | null> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ role: memberships.role })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), isNull(users.disabledAt)))
                .limit(1),
        );
        if (!row || row.role === 'client') return null;
        return { userId, role: row.role };
    }

    async snapshot(
        tenantId: number,
        dashboardId: number,
        viewer: DashboardViewer,
        body: DashboardBundleRequest = {},
    ): Promise<DashboardSnapshot> {
        // 404 si quien mira ya no puede ver el tablero (visibilidad, borrado).
        const dashboard = await this.dashboards.get(tenantId, dashboardId, viewer);
        const data = await this.dashboards.evaluateDashboard(tenantId, dashboard, viewer, body);
        const dataWidgets = dashboard.widgets.filter((w) => !CONTENT_WIDGET_TYPES.includes(w.type) && w.list_id > 0);
        const listIds = [...new Set(dataWidgets.map((w) => w.list_id))];

        // Campos: sólo los que usan los widgets (no el esquema entero de la
        // lista) y nunca uno oculto para quien mira.
        const fieldsByList = new Map<number, Field[]>();
        const allById = new Map<number, Field>();
        for (const listId of listIds) {
            let hidden: Set<number>;
            try {
                const ctx = await this.aggregate.listContext(tenantId, String(listId), { userId: viewer.userId, role: viewer.role as Role });
                hidden = ctx.hidden;
            } catch {
                continue; // lista borrada o sin acceso: sus widgets ya traen su error
            }
            const wanted = new Set<number>();
            for (const w of dataWidgets.filter((x) => x.list_id === listId)) {
                referencedFieldIds(w.config, wanted);
                const d = data[w.id] as { columns?: Array<{ id?: number }> } | undefined;
                for (const c of d?.columns ?? []) if (typeof c.id === 'number') wanted.add(c.id);
            }
            const all = await this.fields.list(tenantId, String(listId)).catch(() => [] as Field[]);
            const visible = all.filter((f) => wanted.has(f.id) && !hidden.has(f.id));
            fieldsByList.set(listId, visible);
            for (const f of visible) allById.set(f.id, f);
        }

        const fieldOf = (id: unknown) => allById.get(Number(id));
        const userIds = new Set<number>();
        for (const w of dataWidgets) for (const id of reportUserIds(w, data[w.id], fieldOf)) userIds.add(id);

        const { listRows, tenantRow, userRows } = await this.tenantDb.withTenant(tenantId, async (tx) => ({
            listRows: listIds.length
                ? await tx.select({ id: lists.id, name: lists.name, slug: lists.slug }).from(lists).where(inArray(lists.id, listIds))
                : [],
            tenantRow: (await tx.select({ name: tenants.name, settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0],
            userRows: userIds.size
                ? await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...userIds].slice(0, 500)))
                : [],
        }));
        if (!tenantRow) throw new NotFoundException({ code: 'dashboard_not_found', data: { status: 404 } });
        const settings = (tenantRow.settings ?? {}) as Record<string, unknown>;
        const fmt = tenantFormatSchema.safeParse(settings.format ?? {});
        const brand = brandingSchema.safeParse(settings.branding ?? {});
        return {
            dashboard,
            data,
            fields: fieldsByList,
            lists: listRows,
            users: new Map(userRows.map((u) => [u.id, u.name])),
            format: fmt.success ? fmt.data : tenantFormatSchema.parse({}),
            tenantName: tenantRow.name,
            branding: brand.success ? brand.data : brandingSchema.parse({}),
        };
    }

    /** Los widgets con datos como reportes legibles, en el orden en que se ven (fila, columna). */
    reports(snap: DashboardSnapshot): WidgetReport[] {
        const byId = new Map<number, Field>();
        for (const fs of snap.fields.values()) for (const f of fs) byId.set(f.id, f);
        const listName = new Map(snap.lists.map((l) => [l.id, l.name]));
        const ctx = {
            field: (id: unknown) => byId.get(Number(id)) as unknown as ReportField | undefined,
            userName: (id: number) => snap.users.get(id) ?? null,
            format: snap.format,
            listName: (id: number) => listName.get(id) ?? null,
        };
        return [...snap.dashboard.widgets]
            .filter((w) => !CONTENT_WIDGET_TYPES.includes(w.type))
            .sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)
            .map((w) => buildWidgetReport(w, snap.data[w.id], ctx))
            .filter((r): r is WidgetReport => r !== null);
    }
}
