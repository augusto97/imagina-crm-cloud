import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional, type OnModuleInit } from '@nestjs/common';
import {
    buildWidgetReport,
    buildXlsxWorkbook,
    FALLBACK_TIME_ZONE,
    formatEmailFieldValue,
    readReportBlocks,
    readReportSettings,
    reportBlockWidgetSpec,
    reportCompareText,
    reportDataBlocks,
    reportFileName,
    reportPeriodText,
    reportWorkbookSheets,
    resolveTimeZone,
    zonedToday,
    type CreateReportInput,
    type DashboardVisibility,
    type Report,
    type ReportBlock,
    type ReportBundle,
    type ReportBundleRequest,
    type ReportExportFormat,
    type ReportSettings,
    type ReportWidgetBlock,
    type Role,
    type UpdateReportInput,
    type WidgetReport,
    type WidgetSpec,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { lists, reports } from '../db/schema';
import { DashboardSnapshotService, type WidgetsSnapshot } from '../dashboard-sharing/dashboard-snapshot.service';
import { DashboardSubscriptionsService, type SubscriptionContent, type SubscriptionSubject } from '../dashboard-sharing/dashboard-subscriptions.service';
import {
    DashboardsService,
    dashboardVisibleTo,
    normalizeDashboardCompare,
    normalizeDashboardPeriod,
    type DashboardViewer,
} from '../dashboards/dashboards.service';
import { aclExtras, effectivePermissions } from '../lists/list-acl';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { renderReportPdf, type ReportPdfData, type ReportPdfItem } from './report-pdf';

type Row = typeof reports.$inferSelect;

/** Un archivo listo para bajar. */
export interface ReportFile {
    buffer: Buffer;
    filename: string;
    contentType: string;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * v0.1.464 (J1) — Informes: un documento armado con bloques donde cada bloque
 * de datos sale de su propia lista. Los datos se calculan con el MISMO motor
 * de los tableros (`DashboardsService.evaluateWidgets`): mismo ACL de quien
 * mira (scope por rol, campos ocultos, listas sin acceso), misma zona horaria
 * de la empresa, y cada bloque aislado — uno roto dice por qué y el resto se
 * dibuja. Ver: quien ve tableros (`view_dashboards`) y la visibilidad del
 * informe; crear y cambiar: `manage_dashboards` (y ser el creador o admin).
 */
@Injectable()
export class ReportsService implements OnModuleInit {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly dashboards: DashboardsService,
        private readonly snapshots: DashboardSnapshotService,
        private readonly audit: AuditService,
        @Optional() private readonly subscriptions?: DashboardSubscriptionsService,
        @Optional() private readonly timeZones?: TenantTimeZones,
    ) {}

    onModuleInit(): void {
        // Los envíos programados de informes usan el mecanismo de los tableros.
        this.subscriptions?.registerReportSource({
            get: (tenantId, reportId, viewer) => this.subject(tenantId, reportId, viewer),
            content: (tenantId, reportId, viewer) => this.subscriptionContent(tenantId, reportId, viewer),
        });
    }

    // ─────────────────────────── CRUD ───────────────────────────

    async list(tenantId: number, viewer: DashboardViewer): Promise<Report[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(reports).where(eq(reports.tenantId, tenantId)).orderBy(asc(reports.position), asc(reports.id)),
        );
        return rows.map(toReport).filter((r) => dashboardVisibleTo(r, viewer));
    }

    async get(tenantId: number, id: number, viewer: DashboardViewer): Promise<Report> {
        const row = await this.row(tenantId, id);
        const dto = row ? toReport(row) : null;
        // 404 también cuando existe pero no es visible (no se filtra la existencia).
        if (!dto || !dashboardVisibleTo(dto, viewer)) throw notFound();
        return dto;
    }

    async create(tenantId: number, viewer: DashboardViewer, input: CreateReportInput): Promise<Report> {
        await this.assertLists(tenantId, input.blocks ?? []);
        const [row] = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [{ next }] = (await tx
                .select({ next: sql<number>`coalesce(max(${reports.position}), -1) + 1` })
                .from(reports)
                .where(eq(reports.tenantId, tenantId))) as [{ next: number }];
            return tx
                .insert(reports)
                .values({
                    tenantId,
                    name: input.name,
                    description: input.description ?? null,
                    blocks: input.blocks ?? [],
                    settings: readReportSettings(input.settings ?? {}),
                    visibility: input.visibility ?? 'workspace',
                    allowedRoles: input.allowed_roles ?? [],
                    position: Number(next) || 0,
                    createdBy: viewer.userId,
                })
                .returning();
        });
        await this.audit.log({ tenantId, userId: viewer.userId, action: 'report.create', targetType: 'report', targetId: row!.id, targetLabel: row!.name });
        return toReport(row!);
    }

    async update(tenantId: number, id: number, viewer: DashboardViewer, patch: UpdateReportInput): Promise<Report> {
        const current = await this.assertCanManage(tenantId, id, viewer);
        if (patch.blocks !== undefined) await this.assertLists(tenantId, patch.blocks);
        const set: Partial<typeof reports.$inferInsert> = { updatedAt: new Date() };
        if (patch.name !== undefined) set.name = patch.name;
        if (patch.description !== undefined) set.description = patch.description ?? null;
        if (patch.blocks !== undefined) set.blocks = patch.blocks;
        if (patch.settings !== undefined) set.settings = readReportSettings({ ...current.settings, ...patch.settings });
        if (patch.visibility !== undefined) set.visibility = patch.visibility;
        if (patch.allowed_roles !== undefined) set.allowedRoles = patch.allowed_roles;
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.update(reports).set(set).where(and(eq(reports.tenantId, tenantId), eq(reports.id, id))).returning(),
        );
        if (!row) throw notFound();
        await this.audit.log({ tenantId, userId: viewer.userId, action: 'report.update', targetType: 'report', targetId: id, targetLabel: row.name });
        return toReport(row);
    }

    /** Borra el informe (y sus envíos programados, en cascada). */
    async remove(tenantId: number, id: number, viewer: DashboardViewer): Promise<void> {
        const current = await this.assertCanManage(tenantId, id, viewer);
        // Los horarios de sus envíos salen de la cola antes de que la cascada borre las filas.
        await this.subscriptions?.forgetTarget(tenantId, { kind: 'report', id });
        await this.tenantDb.withTenant(tenantId, (tx) => tx.delete(reports).where(and(eq(reports.tenantId, tenantId), eq(reports.id, id))));
        await this.audit.log({ tenantId, userId: viewer.userId, action: 'report.delete', targetType: 'report', targetId: id, targetLabel: current.name });
    }

    /** Una copia con otro nombre (sin sus envíos programados), de quien la pide. */
    async duplicate(tenantId: number, id: number, viewer: DashboardViewer): Promise<Report> {
        const src = await this.get(tenantId, id, viewer);
        const copy = await this.create(tenantId, viewer, {
            name: `${src.name} (copia)`.slice(0, 190),
            description: src.description,
            blocks: src.blocks,
            settings: src.settings,
            visibility: src.visibility,
            allowed_roles: src.allowed_roles,
        });
        await this.audit.log({ tenantId, userId: viewer.userId, action: 'report.duplicate', targetType: 'report', targetId: copy.id, targetLabel: copy.name, meta: { from: id } });
        return copy;
    }

    // ─────────────────────────── Datos ───────────────────────────

    /** El informe calculado en UN pedido: `{ [blockId]: datos }` (o `{ __error }` por bloque). */
    async bundle(tenantId: number, id: number, viewer: DashboardViewer, req: ReportBundleRequest = {}): Promise<ReportBundle> {
        const report = await this.get(tenantId, id, viewer);
        return this.compute(tenantId, viewer, report.blocks, report.settings, req);
    }

    /** Vista previa del editor: los bloques SIN guardar, con el mismo motor y el mismo ACL. */
    async preview(tenantId: number, viewer: DashboardViewer, blocks: ReportBlock[], req: ReportBundleRequest = {}): Promise<ReportBundle> {
        return this.compute(tenantId, viewer, blocks, readReportSettings({}), { period: req.period ?? '', compare: req.compare ?? '' });
    }

    /** El informe en PDF (portada + bloques) o en Excel (una hoja por bloque de datos). */
    async export(tenantId: number, id: number, viewer: DashboardViewer, format: ReportExportFormat, req: ReportBundleRequest = {}): Promise<ReportFile> {
        const report = await this.get(tenantId, id, viewer);
        const { period, compare } = effective(report.settings, req);
        const built = await this.build(tenantId, viewer, report.blocks, period, compare);
        const zone = await this.zone(tenantId);
        const base = reportFileName(report.name, zonedToday(zone));
        if (format === 'xlsx') {
            const bytes = buildXlsxWorkbook(
                reportWorkbookSheets({
                    name: report.name,
                    periodText: reportPeriodText(period),
                    compareText: reportCompareText(compare),
                    dateText: built.dateText,
                    entries: built.data.map((d) => ({ title: d.title, subtitle: d.report?.subtitle ?? undefined, report: d.report, error: d.error ?? null })),
                }),
            );
            return { buffer: Buffer.from(bytes), filename: `${base}.xlsx`, contentType: XLSX_MIME };
        }
        const buffer = await this.pdf(report, built, period, compare);
        return { buffer, filename: `${base}.pdf`, contentType: 'application/pdf' };
    }

    // ─────────────────────────── Internos ───────────────────────────

    private async compute(tenantId: number, viewer: DashboardViewer, blocks: ReportBlock[], settings: ReportSettings, req: ReportBundleRequest): Promise<ReportBundle> {
        const { period, compare } = effective(settings, req);
        const specs = reportDataBlocks(blocks).map(reportBlockWidgetSpec);
        const { data } = await this.evaluate(tenantId, viewer, specs, period, compare);
        return { data, period, compare };
    }

    /**
     * Los datos de los bloques con el motor de los tableros. Un bloque de una
     * lista que quien mira NO ve (acceso «Sin acceso» para su rol, persona o
     * equipos) no se calcula: dice por qué — en un tablero un widget así da
     * cero, pero en un informe que junta varias listas conviene decirlo.
     */
    private async evaluate(
        tenantId: number,
        viewer: DashboardViewer,
        specs: WidgetSpec[],
        period: string,
        compare: string,
    ): Promise<{ data: Record<string, unknown>; allowed: WidgetSpec[] }> {
        if (specs.length === 0) return { data: {}, allowed: [] };
        const blocked = await this.blockedLists(tenantId, viewer, specs);
        const allowed = specs.filter((s) => !blocked.has(s.list_id));
        const computed = allowed.length ? await this.dashboards.evaluateWidgets(tenantId, viewer, allowed, bodyOf(period, compare)) : {};
        const data: Record<string, unknown> = {};
        for (const s of specs) data[s.id] = blocked.has(s.list_id) ? { __error: NO_LIST_ACCESS } : computed[s.id];
        return { data, allowed };
    }

    private async blockedLists(tenantId: number, viewer: DashboardViewer, specs: WidgetSpec[]): Promise<Set<number>> {
        const out = new Set<number>();
        if (viewer.role === 'admin') return out;
        const ids = [...new Set(specs.map((s) => s.list_id).filter((id) => id > 0))];
        if (ids.length === 0) return out;
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ id: lists.id, settings: lists.settings }).from(lists).where(and(eq(lists.tenantId, tenantId), inArray(lists.id, ids))),
        );
        const subject = { ...aclExtras(viewer), userId: viewer.userId, role: viewer.role as Role };
        for (const r of rows) {
            if (effectivePermissions((r.settings ?? {}) as Record<string, unknown>, subject).view === 'none') out.add(r.id);
        }
        return out;
    }

    /** Los bloques de datos como reportes legibles (para el PDF, el Excel y el correo). */
    private async build(tenantId: number, viewer: DashboardViewer, blocks: ReportBlock[], period: string, compare: string): Promise<BuiltReport> {
        const dataBlocks = reportDataBlocks(blocks);
        const specs = dataBlocks.map(reportBlockWidgetSpec);
        const { data, allowed } = await this.evaluate(tenantId, viewer, specs, period, compare);
        // Lo que acompaña a los datos (campos, nombres, formato) sólo de lo que SÍ ve.
        const snap = await this.snapshots.describe(tenantId, allowed, data, viewer);
        const ctx = this.snapshots.reportContext(snap);
        const byId = new Map<string, ReportPdfData>();
        for (const b of dataBlocks) byId.set(b.id, toPdfData(b, snap, ctx));
        const zone = await this.zone(tenantId);
        const dateText = formatEmailFieldValue({ type: 'datetime' }, new Date().toISOString(), { ...snap.format, timezone: zone });
        return { blocks, byId, data: dataBlocks.map((b) => byId.get(b.id)!), snap, dateText };
    }

    private pdf(report: Report, built: BuiltReport, period: string, compare: string): Promise<Buffer> {
        const company = built.snap.branding.app_name ?? built.snap.tenantName;
        const accent = built.snap.branding.primary_color ?? '#0e7490';
        const items: ReportPdfItem[] = built.blocks.map((b): ReportPdfItem => {
            switch (b.type) {
                case 'heading':
                    return { type: 'heading', text: b.text, ...(b.subtitle ? { subtitle: b.subtitle } : {}) };
                case 'text':
                    return { type: 'text', text: b.text };
                case 'widget':
                    return { type: 'widget', data: built.byId.get(b.id)! };
                case 'columns':
                    return { type: 'columns', children: b.children.map((c) => built.byId.get(c.id)!) };
                case 'divider':
                    return { type: 'divider' };
                case 'page_break':
                    return { type: 'page_break' };
            }
        });
        return renderReportPdf({
            title: report.name,
            description: report.description,
            periodText: `Período: ${reportPeriodText(period)}`,
            compareText: reportCompareText(compare),
            subtitle: `${company} · ${built.dateText}`,
            accent,
            items,
        });
    }

    /** Para los envíos programados: lo que el correo necesita saber del informe. */
    private async subject(tenantId: number, reportId: number, viewer: DashboardViewer): Promise<SubscriptionSubject> {
        const r = await this.get(tenantId, reportId, viewer);
        return { id: r.id, name: r.name, visibility: r.visibility, allowed_roles: r.allowed_roles, created_by: r.created_by };
    }

    /** Para los envíos programados: el informe calculado con el acceso del dueño del envío. */
    private async subscriptionContent(tenantId: number, reportId: number, viewer: DashboardViewer): Promise<SubscriptionContent> {
        const report = await this.get(tenantId, reportId, viewer);
        const { period, compare } = effective(report.settings, {});
        const built = await this.build(tenantId, viewer, report.blocks, period, compare);
        return {
            reports: built.data.map((d) => d.report).filter((r): r is WidgetReport => r !== null),
            format: built.snap.format,
            branding: built.snap.branding,
            tenantName: built.snap.tenantName,
            pdf: () => this.pdf(report, built, period, compare),
        };
    }

    private async zone(tenantId: number): Promise<string> {
        return resolveTimeZone(this.timeZones ? await this.timeZones.orUtc(tenantId) : FALLBACK_TIME_ZONE);
    }

    private async row(tenantId: number, id: number): Promise<Row | null> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(reports).where(and(eq(reports.tenantId, tenantId), eq(reports.id, id))).limit(1),
        );
        return row ?? null;
    }

    /** Cambiar un informe: `manage_dashboards` (lo valida el guard) y ser el creador o admin. */
    private async assertCanManage(tenantId: number, id: number, viewer: DashboardViewer): Promise<Report> {
        const row = await this.row(tenantId, id);
        if (!row) throw notFound();
        const dto = toReport(row);
        if (viewer.role === 'admin' || row.createdBy === viewer.userId) return dto;
        if (!dashboardVisibleTo(dto, viewer)) throw notFound(); // invisible → existencia opaca
        throw new ForbiddenException({ code: 'report_not_owner', message: 'Sólo quien creó el informe o un admin pueden cambiarlo.', data: { status: 403 } });
    }

    /** Cada bloque apunta a una lista de ESTA empresa (la RLS oculta las ajenas y las de la papelera). */
    private async assertLists(tenantId: number, blocks: ReportBlock[]): Promise<void> {
        const ids = [...new Set(reportDataBlocks(blocks).map((b) => b.widget.list_id))];
        if (ids.length === 0) return;
        const found = await this.tenantDb.withTenant(tenantId, (tx) => tx.select({ id: lists.id }).from(lists).where(and(eq(lists.tenantId, tenantId), inArray(lists.id, ids))));
        if (found.length !== ids.length) {
            throw new BadRequestException({ code: 'report_list_not_found', message: 'Uno de los bloques usa una lista que no existe.', data: { status: 400 } });
        }
    }
}

interface BuiltReport {
    blocks: ReportBlock[];
    byId: Map<string, ReportPdfData>;
    /** Los bloques de datos en orden de lectura. */
    data: ReportPdfData[];
    snap: WidgetsSnapshot;
    dateText: string;
}

/** El período y la comparación que se aplican: lo que pide quien mira, si no lo guardado. */
function effective(settings: ReportSettings, req: ReportBundleRequest): { period: string; compare: string } {
    return {
        period: normalizeDashboardPeriod(req.period !== undefined ? req.period : settings.period),
        compare: normalizeDashboardCompare(req.compare !== undefined ? req.compare : settings.compare),
    };
}

function bodyOf(period: string, compare: string): { period_preset?: string; compare?: string } {
    return { ...(period ? { period_preset: period } : {}), ...(compare ? { compare } : {}) };
}

function toPdfData(b: ReportWidgetBlock, snap: WidgetsSnapshot, ctx: ReturnType<DashboardSnapshotService['reportContext']>): ReportPdfData {
    const data = snap.data[b.id] as { __error?: unknown } | undefined;
    const fallbackTitle = b.widget.title || 'Bloque de datos';
    if (data && typeof data.__error === 'string') return { title: fallbackTitle, report: null, error: data.__error };
    const report = buildWidgetReport(reportBlockWidgetSpec(b), data, ctx);
    return { title: report?.title || fallbackTitle, report };
}

function toReport(row: Row): Report {
    const { blocks, dropped } = readReportBlocks(row.blocks);
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        blocks,
        settings: readReportSettings(row.settings),
        visibility: (['workspace', 'private', 'roles'].includes(row.visibility) ? row.visibility : 'private') as DashboardVisibility,
        allowed_roles: Array.isArray(row.allowedRoles) ? row.allowedRoles.filter((r): r is string => typeof r === 'string') : [],
        created_by: row.createdBy,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
        dropped_blocks: dropped,
    };
}

const NO_LIST_ACCESS = 'No tienes acceso a esta lista.';

function notFound(): NotFoundException {
    return new NotFoundException({ code: 'report_not_found', message: 'Ese informe no existe.', data: { status: 404 } });
}
