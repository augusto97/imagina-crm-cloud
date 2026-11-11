import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
    FALLBACK_TIME_ZONE,
    resolveTimeZone,
    type Field,
    type PublicDashboardAdmin,
    type PublicDashboardBundle,
    type UpdatePublicDashboardInput,
} from '@imagina-base/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DRIZZLE, type Db } from '../db/client';
import { dashboards, publicDashboards, tenants, users } from '../db/schema';
import { DashboardsService, normalizeDashboardPeriod, publicDashboardCacheNs, type DashboardViewer } from '../dashboards/dashboards.service';
import { NO_PUBLIC_CACHE, type PublicCacheLike } from '../public-cache/public-cache';
import { PublicCacheService } from '../public-cache/public-cache.service';
import { DomainsService } from '../domains/domains.service';
import { FilesService } from '../files/files.service';
import { isExpired } from '../public-lists/public-lists.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { publicSurfaceOff } from '../billing/tenant-access';
import { DashboardSnapshotService } from './dashboard-snapshot.service';

type Row = typeof publicDashboards.$inferSelect;

export const PUBLIC_DASHBOARD_PATH = '/api/v1/public/d/';

/** Lo que una celda de tabla pública NO muestra: apunta a otras entidades. */
const NOT_PUBLIC_COLUMN_TYPES = new Set(['file', 'relation']);

/** Config de un campo que sí hace falta para DIBUJARLO (formato, opciones, colores). */
const DISPLAY_CONFIG_KEYS = ['options', 'precision', 'currency', 'format', 'max', 'icon', 'display', 'operation', 'show_bar', 'highlight_overdue'];

function displayConfig(config: Record<string, unknown> | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of DISPLAY_CONFIG_KEYS) if (config && k in config) out[k] = config[k];
    if (Array.isArray(out.options)) {
        out.options = (out.options as Array<Record<string, unknown>>).map((o) => ({ value: o.value, label: o.label, color: o.color ?? null }));
    }
    return out;
}

/**
 * Un campo tal como viaja a la página pública: sólo lo que hace falta para
 * dibujarlo. Nada de instrucciones de un campo con IA, entradas de un
 * calculado ni la relación que hay detrás de un lookup.
 */
export function publicField(f: Field): Record<string, unknown> {
    return {
        id: f.id,
        list_id: f.list_id,
        slug: f.slug,
        label: f.label,
        type: f.type,
        config: displayConfig(f.config),
        is_required: false,
        is_unique: false,
        is_indexed: false,
        is_primary: f.is_primary ?? false,
        position: f.position,
        description: null,
        created_at: f.created_at,
        ...(f.through !== undefined
            ? {
                  through: f.through
                      ? {
                            direction: f.through.direction,
                            relation_label: '',
                            other_list_id: f.through.other_list_id,
                            other_list_name: '',
                            target_field: f.through.target_field
                                ? { ...f.through.target_field, config: displayConfig(f.through.target_field.config) }
                                : null,
                        }
                      : null,
              }
            : {}),
    };
}

/** Tabla de un widget sin las columnas de archivos ni de vínculos (no se pueden abrir sin sesión). */
export function publicWidgetData(data: unknown): unknown {
    if (!data || typeof data !== 'object' || !('columns' in data) || !('rows' in data)) return data;
    const d = data as { columns: Array<{ slug: string; type: string }>; rows: Array<{ fields?: Record<string, unknown>; [k: string]: unknown }> };
    const keep = d.columns.filter((c) => !NOT_PUBLIC_COLUMN_TYPES.has(c.type));
    const drop = new Set(d.columns.filter((c) => NOT_PUBLIC_COLUMN_TYPES.has(c.type)).map((c) => c.slug));
    return {
        ...d,
        columns: keep,
        rows: d.rows.map((r) => {
            const fields = Object.fromEntries(Object.entries(r.fields ?? {}).filter(([k]) => !drop.has(k)));
            return { id: r.id, fields };
        }),
    };
}

const notFound = () => new NotFoundException({ code: 'public_dashboard_not_found', message: 'Este tablero no está disponible.', data: { status: 404 } });

/**
 * v0.1.292 (ADR-S50) — Enlace público de sólo lectura de un tablero.
 *
 * El token es la credencial (como las listas públicas, ADR-S14): desconocido,
 * despublicado, vencido, de una empresa archivada o de alguien que ya no
 * puede ver el tablero → el MISMO 404. Los datos salen con el acceso de quien
 * publicó (`published_by`): un campo oculto para esa persona nunca viaja.
 */
@Injectable()
export class PublicDashboardsService {
    private readonly logger = new Logger(PublicDashboardsService.name);

    private readonly pcache: PublicCacheLike;

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly dashboards: DashboardsService,
        private readonly snapshots: DashboardSnapshotService,
        private readonly files: FilesService,
        private readonly audit: AuditService,
        @Optional() private readonly domains?: DomainsService,
        @Optional() private readonly timeZones?: TenantTimeZones,
        @Optional() cache?: PublicCacheService,
    ) {
        this.pcache = cache ?? NO_PUBLIC_CACHE;
    }

    // ─────────────────────────── Admin ───────────────────────────

    private async rowFor(tenantId: number, dashboardId: number): Promise<Row | undefined> {
        const [row] = await this.db
            .select()
            .from(publicDashboards)
            .where(and(eq(publicDashboards.tenantId, tenantId), eq(publicDashboards.dashboardId, dashboardId)))
            .limit(1);
        return row;
    }

    private async toAdmin(tenantId: number, dashboardId: number, row: Row | undefined, viewer: DashboardViewer): Promise<PublicDashboardAdmin> {
        const dash = await this.dashboards.get(tenantId, dashboardId, viewer);
        const hasTables = dash.widgets.some((w) => w.type === 'table');
        if (!row) {
            return { enabled: false, path: null, url: null, expires_at: null, allowed_domains: [], allow_period: false, published_by: null, published_at: null, has_tables: hasTables };
        }
        const [pub] = await this.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, row.publishedBy)).limit(1);
        const path = `${PUBLIC_DASHBOARD_PATH}${row.token}`;
        const base = this.domains ? await this.domains.baseUrlFor(tenantId, 'app').catch(() => '') : '';
        return {
            enabled: true,
            path,
            url: base ? `${base.replace(/\/+$/, '')}${path}` : null,
            expires_at: row.expiresAt,
            allowed_domains: row.allowedDomains ?? [],
            allow_period: row.allowPeriod,
            published_by: pub ? { id: pub.id, name: pub.name } : null,
            published_at: row.createdAt.toISOString(),
            has_tables: hasTables,
        };
    }

    async getAdmin(tenantId: number, dashboardId: number, viewer: DashboardViewer): Promise<PublicDashboardAdmin> {
        await this.dashboards.assertManageable(tenantId, dashboardId, viewer);
        return this.toAdmin(tenantId, dashboardId, await this.rowFor(tenantId, dashboardId), viewer);
    }

    async update(tenantId: number, dashboardId: number, viewer: DashboardViewer, input: UpdatePublicDashboardInput): Promise<PublicDashboardAdmin> {
        await this.dashboards.assertManageable(tenantId, dashboardId, viewer);
        const dash = await this.dashboards.get(tenantId, dashboardId, viewer);
        const current = await this.rowFor(tenantId, dashboardId);
        const domains = input.allowed_domains ? [...new Set(input.allowed_domains.map((d) => d.trim().toLowerCase()))] : undefined;

        if (input.enabled === false) {
            if (current) {
                await this.db.delete(publicDashboards).where(eq(publicDashboards.token, current.token));
                this.forget(current.token, dashboardId);
                await this.audit.log({ tenantId, userId: viewer.userId, action: 'dashboard.public_disable', targetType: 'dashboard', targetId: dashboardId, targetLabel: dash.name });
            }
            return this.toAdmin(tenantId, dashboardId, undefined, viewer);
        }

        if (!current) {
            if (input.enabled !== true) return this.toAdmin(tenantId, dashboardId, undefined, viewer);
            const [row] = await this.db
                .insert(publicDashboards)
                .values({
                    token: newToken(),
                    tenantId,
                    dashboardId,
                    publishedBy: viewer.userId,
                    expiresAt: input.expires_at ?? null,
                    allowedDomains: domains ?? [],
                    allowPeriod: input.allow_period ?? false,
                })
                .returning();
            await this.audit.log({
                tenantId,
                userId: viewer.userId,
                action: 'dashboard.public_enable',
                targetType: 'dashboard',
                targetId: dashboardId,
                targetLabel: dash.name,
                meta: { domains: row!.allowedDomains, expires_at: row!.expiresAt, has_tables: dash.widgets.some((w) => w.type === 'table') },
            });
            return this.toAdmin(tenantId, dashboardId, row, viewer);
        }

        const [row] = await this.db
            .update(publicDashboards)
            .set({
                ...(input.expires_at !== undefined ? { expiresAt: input.expires_at } : {}),
                ...(domains !== undefined ? { allowedDomains: domains } : {}),
                ...(input.allow_period !== undefined ? { allowPeriod: input.allow_period } : {}),
                updatedAt: new Date(),
            })
            .where(eq(publicDashboards.token, current.token))
            .returning();
        this.forget(current.token, dashboardId);
        return this.toAdmin(tenantId, dashboardId, row, viewer);
    }

    /** Dirección nueva: la anterior deja de funcionar al instante. */
    async regenerate(tenantId: number, dashboardId: number, viewer: DashboardViewer): Promise<PublicDashboardAdmin> {
        await this.dashboards.assertManageable(tenantId, dashboardId, viewer);
        const current = await this.rowFor(tenantId, dashboardId);
        if (!current) throw notFound();
        const dash = await this.dashboards.get(tenantId, dashboardId, viewer);
        const [row] = await this.db
            .update(publicDashboards)
            .set({ token: newToken(), updatedAt: new Date() })
            .where(eq(publicDashboards.token, current.token))
            .returning();
        this.forget(current.token, dashboardId);
        await this.audit.log({ tenantId, userId: viewer.userId, action: 'dashboard.public_regenerate', targetType: 'dashboard', targetId: dashboardId, targetLabel: dash.name });
        return this.toAdmin(tenantId, dashboardId, row, viewer);
    }

    /** El enlace público vigente de un tablero (lo usa el correo programado). */
    async publicUrlFor(tenantId: number, dashboardId: number): Promise<string | null> {
        const row = await this.rowFor(tenantId, dashboardId);
        if (!row || !this.domains) return null;
        if (row.expiresAt && isExpired(row.expiresAt, await this.zoneOf(tenantId))) return null;
        const base = await this.domains.baseUrlFor(tenantId, 'app').catch(() => '');
        return base ? `${base.replace(/\/+$/, '')}${PUBLIC_DASHBOARD_PATH}${row.token}` : null;
    }

    // ─────────────────────────── Público ───────────────────────────

    private async zoneOf(tenantId: number): Promise<string> {
        return resolveTimeZone(this.timeZones ? await this.timeZones.orUtc(tenantId) : FALLBACK_TIME_ZONE);
    }

    /** Token → fila vigente (o 404 opaco). */
    async resolve(token: string): Promise<Row> {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw notFound();
        const [hit] = await this.db
            .select({ row: publicDashboards, archivedAt: tenants.archivedAt })
            .from(publicDashboards)
            .innerJoin(tenants, eq(tenants.id, publicDashboards.tenantId))
            // Papelera: el enlace de un tablero borrado responde 404 (y vuelve
            // al restaurarlo). Conexión base: el filtro va a mano.
            .innerJoin(dashboards, and(eq(dashboards.id, publicDashboards.dashboardId), isNull(dashboards.deletedAt)))
            .where(eq(publicDashboards.token, token))
            .limit(1);
        if (!hit || hit.archivedAt !== null) throw notFound();
        // v0.1.338 (ADR-S87) — empresa pausada o plan sin «Enlaces públicos».
        if (await publicSurfaceOff(this.db, hit.row.tenantId, 'public_sharing')) throw notFound();
        if (hit.row.expiresAt && isExpired(hit.row.expiresAt, await this.zoneOf(hit.row.tenantId))) throw notFound();
        return hit.row;
    }

    /** El enlace cambió (o dejó de existir): lo guardado en la caché pública no vale más. */
    private forget(token: string, dashboardId: number): void {
        this.pcache.invalidate(rowCacheKey(token));
        this.pcache.bump(publicDashboardCacheNs(dashboardId));
    }

    /**
     * La fila del enlace, por la caché pública (30 s; lo que no existe, 15 s):
     * mil visitas a la vez hacen UNA consulta, dentro del tope de armados.
     */
    private async cachedRow(token: string): Promise<Row> {
        if (!TOKEN_RE.test(token)) throw notFound();
        const row = await this.pcache.get(
            rowCacheKey(token),
            ROW_TTL_MS,
            async () => {
                try {
                    return await this.resolve(token);
                } catch (err) {
                    if (err instanceof NotFoundException) return null;
                    throw err;
                }
            },
            MISSING_TTL_MS,
        );
        if (!row) throw notFound();
        return row;
    }

    /** Los dominios que pueden insertarlo (para la cabecera `frame-ancestors`). */
    async pageConfig(token: string): Promise<{ allowed_domains: string[] }> {
        const row = await this.cachedRow(token);
        return { allowed_domains: row.allowedDomains ?? [] };
    }

    /**
     * Los datos de la página pública. Se calculan como mucho una vez cada
     * 30 s por enlace y período (visitas simultáneas esperan ese mismo
     * cálculo), dentro del tope de armados públicos: un tablero pesado
     * abierto por muchos a la vez no ocupa las conexiones de la app.
     * `PublicBusyError` si la fila de armados está llena (→ 503).
     */
    async bundle(token: string, period: string | undefined): Promise<PublicDashboardBundle> {
        const row = await this.cachedRow(token);
        // Sólo un período conocido (o un rango bien formado): cualquier otro
        // valor NO crea otra entrada de caché ni otro cálculo.
        const applied = row.allowPeriod ? normalizeDashboardPeriod(period) : '';
        const key = `pdash:data:${row.token}:${this.pcache.version(publicDashboardCacheNs(row.dashboardId))}:${applied}`;
        const bundle = await this.pcache.get(key, DATA_TTL_MS, () => this.compute(row, applied), MISSING_TTL_MS);
        if (!bundle) throw notFound();
        return bundle;
    }

    private async compute(row: Row, applied: string): Promise<PublicDashboardBundle | null> {
        const viewer = await this.snapshots.viewerFor(row.tenantId, row.publishedBy);
        // Quien publicó ya no es parte de la empresa (o fue desactivado): el
        // enlace deja de mostrar datos — igual que uno desconocido.
        if (!viewer) return null;
        let snap;
        try {
            snap = await this.snapshots.snapshot(row.tenantId, row.dashboardId, viewer, applied ? { period_preset: applied } : {});
        } catch (err) {
            if (err instanceof NotFoundException) return null;
            throw err;
        }
        const b = snap.branding;
        const fields: Record<string, unknown[]> = {};
        for (const [listId, fs] of snap.fields) fields[String(listId)] = fs.map(publicField);
        const data: Record<string, unknown> = {};
        for (const [id, value] of Object.entries(snap.data)) data[id] = publicWidgetData(value);
        return {
            name: snap.dashboard.name,
            description: snap.dashboard.description,
            settings: { page: (snap.dashboard.settings as Record<string, unknown>).page ?? null },
            // Una imagen subida se descarga con sesión: en la página pública va
            // por URL FIRMADA (como el logo y las imágenes del portal).
            widgets: snap.dashboard.widgets.map((w) => {
                const fileId = (w.config as Record<string, unknown>).image_file_id;
                if (w.type !== 'image' || typeof fileId !== 'number' || fileId <= 0) return w;
                const { image_file_id: _drop, ...rest } = w.config as Record<string, unknown>;
                return { ...w, config: { ...rest, url: this.files.signedUrl(row.tenantId, fileId, 6 * 3600) } };
            }),
            data,
            fields,
            lists: snap.lists,
            users: Object.fromEntries([...snap.users].map(([id, name]) => [String(id), name])),
            branding: {
                primary_color: b.primary_color,
                app_name: b.app_name ?? snap.tenantName,
                logo_url: b.logo_file_id !== null ? this.files.signedUrl(row.tenantId, b.logo_file_id, 3600) : null,
            },
            format: snap.format,
            allow_period: row.allowPeriod,
            period: applied,
            generated_at: new Date().toISOString(),
        };
    }
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const ROW_TTL_MS = 30_000;
const DATA_TTL_MS = 30_000;
const MISSING_TTL_MS = 15_000;
const rowCacheKey = (token: string): string => `pdash:row:${token}`;

function newToken(): string {
    return randomBytes(24).toString('base64url');
}
