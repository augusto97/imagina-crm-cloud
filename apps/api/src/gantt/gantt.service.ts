import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
    buildGanttRows,
    evaluateFilterCondition,
    FALLBACK_TIME_ZONE,
    formatEmailFieldValue,
    GANTT_DEFAULT_BAR_COLOR,
    GANTT_MAX_BASELINE_ITEMS,
    GANTT_MAX_RANGE_DAYS,
    GANTT_MAX_ROWS,
    GANTT_MAX_UNSCHEDULED,
    GANTT_NULL_GROUP,
    GANTT_RULE_COLOR_HEX,
    ganttBarOf,
    ganttGroupKey,
    ganttGroupOrder,
    jsonbKeyForField,
    OPTION_COLOR_HEX,
    readDependencySettings,
    readGanttSettings,
    resolveTitleFieldId,
    tenantFormatSchema,
    viewColorRuleSchema,
    ymdToDay,
    dayToYmd,
    type Field,
    type FilterGroup,
    type GanttBar,
    type GanttBaseline,
    type GanttBundle,
    type GanttBundleRow,
    type GanttPdfRequest,
    type RecordDto,
    type SaveGanttBaselineInput,
    type TenantFormat,
    type View,
    type ViewColorRule,
} from '@imagina-base/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { Tx } from '../db/client';
import { memberships, tenants, users } from '../db/schema';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { DependenciesRepository } from '../records/dependencies.repository';
import { toBundleRow } from '../records/records-grouped.service';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { ViewsService } from '../views/views.service';
import { GanttBaselinesRepository } from './gantt-baselines.repository';
import { renderGanttPdf, type GanttPdfRow } from './gantt-pdf';

export interface GanttBundleQuery {
    startFieldId: number;
    endFieldId: number | null;
    from: string;
    to: string;
    viewId?: number;
    filterTree?: FilterGroup;
    search?: string;
    sort?: string;
    subtasks: boolean;
    unscheduled: boolean;
}

/**
 * B1 — Vista Gantt / línea de tiempo.
 *
 *  - `bundle`: en UNA request (regla de oro nº 8) los registros con alguna
 *    fecha dentro de la ventana pedida (la que se ve más un margen), los
 *    padres de las subtareas que entraron, una tanda de «Sin programar», las
 *    dependencias entre lo que se muestra y la línea base de esos registros.
 *    Filtros, búsqueda, ACL y campos ocultos son los del listado.
 *  - Línea base: congela las fechas de inicio y fin de la vista (una por
 *    vista; guardar otra la reemplaza).
 *  - PDF vectorial de lo que se ve (mismas filas, grupos y barras).
 */
@Injectable()
export class GanttService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly records: RecordsService,
        private readonly views: ViewsService,
        private readonly deps: DependenciesRepository,
        private readonly repo: GanttBaselinesRepository,
        private readonly realtime: RealtimeService,
        @Optional() private readonly timeZones?: TenantTimeZones,
        @Optional() private readonly audit?: AuditService,
    ) {}

    async bundle(tenantId: number, actor: Actor, listKey: string, q: GanttBundleQuery): Promise<GanttBundle> {
        assertRange(q.from, q.to);
        // La vista (si viene) tiene que ser de ESTA lista y visible para quien pide.
        const view = q.viewId ? await this.views.get(tenantId, listKey, q.viewId, viewer(actor)) : null;
        const tl = await this.records.listTimeline(tenantId, actor, listKey, {
            startFieldId: q.startFieldId,
            endFieldId: q.endFieldId,
            from: q.from,
            to: q.to,
            filter_tree: q.filterTree,
            search: q.search,
            sort: q.sort,
            limit: GANTT_MAX_ROWS,
            subtasks: q.subtasks,
            unscheduledLimit: q.unscheduled ? GANTT_MAX_UNSCHEDULED : 0,
        });
        const toSlug = new Map(tl.fields.map((f) => [jsonbKeyForField(f.id), f.slug]));
        const shown = [...tl.rows, ...tl.parents];
        const ids = shown.map((r) => r.id);
        const { edges, baseline } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const edges = await this.deps.edgesAmong(tx, tenantId, ids);
            const baseline = view ? await this.baselineWithItems(tx, tenantId, view.id, ids) : null;
            return { edges, baseline };
        });
        const settings = readDependencySettings(tl.list.settings);
        return {
            meta: {
                start_field_id: q.startFieldId,
                end_field_id: q.endFieldId,
                from: q.from,
                to: q.to,
                total: tl.rows.length,
                truncated: tl.truncated,
                unscheduled_total: tl.unscheduledTotal,
            },
            records: shown.map((r) => toBundleRow(r, toSlug) as unknown as GanttBundleRow),
            unscheduled: tl.unscheduled.map((r) => toBundleRow(r, toSlug) as unknown as GanttBundleRow),
            dependencies: edges,
            baseline,
            reschedule: { enabled: settings.reschedule, start_field_id: settings.start_field_id, end_field_id: settings.end_field_id },
        };
    }

    // ─────────────────────────── Línea base ───────────────────────────

    async getBaseline(tenantId: number, actor: Actor, listKey: string, viewId: number): Promise<GanttBaseline | null> {
        const view = await this.views.get(tenantId, listKey, viewId, viewer(actor));
        const row = await this.tenantDb.withTenant(tenantId, (tx) => this.repo.forView(tx, tenantId, view.id));
        return row ? toBaseline(row) : null;
    }

    /**
     * «Guardar línea base»: congela las fechas ACTUALES de inicio y fin (las
     * de la vista) de los registros con alguna fecha. Una por vista: guardar
     * otra reemplaza a la anterior. Pide poder cambiar la vista (una vista
     * protegida, sólo quien la creó o un admin).
     */
    async saveBaseline(tenantId: number, actor: Actor, listKey: string, viewId: number, input: SaveGanttBaselineInput): Promise<GanttBaseline> {
        const view = await this.ganttView(tenantId, actor, listKey, viewId, true);
        const s = readGanttSettings(view.config);
        if (s.startFieldId === null) throw invalidView();
        const { list, rows } = await this.records.datedRows(tenantId, actor, listKey, s.startFieldId, s.endFieldId, GANTT_MAX_BASELINE_ITEMS);
        const saved = await this.tenantDb.withTenant(tenantId, async (tx) => {
            await this.repo.replace(
                tx,
                {
                    tenantId,
                    listId: list.id,
                    viewId: view.id,
                    name: input.name?.trim() || defaultBaselineName(),
                    startFieldId: s.startFieldId!,
                    endFieldId: s.endFieldId,
                    createdBy: actor.userId > 0 ? actor.userId : null,
                },
                rows.map((r) => ({ recordId: r.id, start: r.start, end: r.end })),
            );
            return this.repo.forView(tx, tenantId, view.id);
        });
        if (!saved) throw new Error('La línea base no quedó guardada');
        void this.audit?.log({
            tenantId,
            userId: actor.userId > 0 ? actor.userId : null,
            action: 'gantt.baseline_save',
            targetType: 'view',
            targetId: view.id,
            targetLabel: view.name,
            meta: { list_id: list.id, items: rows.length },
        });
        this.realtime.records(tenantId, list.id);
        return toBaseline(saved);
    }

    async deleteBaseline(tenantId: number, actor: Actor, listKey: string, viewId: number): Promise<void> {
        const view = await this.ganttView(tenantId, actor, listKey, viewId, true);
        const list = await this.lists.get(tenantId, listKey);
        const deleted = await this.tenantDb.withTenant(tenantId, (tx) => this.repo.deleteForView(tx, tenantId, view.id));
        if (!deleted) {
            throw new NotFoundException({ code: 'baseline_not_found', message: 'Esta vista no tiene línea base.', data: { status: 404 } });
        }
        void this.audit?.log({
            tenantId,
            userId: actor.userId > 0 ? actor.userId : null,
            action: 'gantt.baseline_delete',
            targetType: 'view',
            targetId: view.id,
            targetLabel: view.name,
            meta: { list_id: list.id },
        });
        this.realtime.records(tenantId, list.id);
    }

    // ─────────────────────────── PDF ───────────────────────────

    /**
     * El Gantt en PDF vectorial: las MISMAS filas que la pantalla (grupos en
     * el mismo orden, subtareas bajo su padre, grupos plegados fuera), con las
     * barras, hitos, línea base, flechas y la línea de hoy del rango visible.
     */
    async pdf(tenantId: number, actor: Actor, listKey: string, req: GanttPdfRequest): Promise<{ buffer: Buffer; filename: string }> {
        assertRange(req.from, req.to);
        const view = req.view_id ? await this.views.get(tenantId, listKey, req.view_id, viewer(actor)) : null;
        const tl = await this.records.listTimeline(tenantId, actor, listKey, {
            startFieldId: req.start_field_id,
            endFieldId: req.end_field_id ?? null,
            from: req.from,
            to: req.to,
            filter_tree: req.filter_tree,
            search: req.search,
            sort: req.sort,
            limit: GANTT_MAX_ROWS,
            subtasks: req.show_subtasks !== false,
            unscheduledLimit: 0,
        });
        const fields = tl.fields;
        const byId = new Map(fields.map((f) => [f.id, f]));
        const zone = this.timeZones ? await this.timeZones.orUtc(tenantId) : FALLBACK_TIME_ZONE;
        const { format, edges, baseline, userNames } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const all = [...tl.rows, ...tl.parents];
            const ids = all.map((r) => r.id);
            const edges = req.show_dependencies === false ? [] : await this.deps.edgesAmong(tx, tenantId, ids);
            const baseline = view && req.show_baseline !== false ? await this.baselineWithItems(tx, tenantId, view.id, ids) : null;
            const userIds = new Set<number>();
            for (const f of fields.filter((x) => x.type === 'user')) {
                for (const r of all) {
                    const v = Number((r.data as Record<string, unknown>)[jsonbKeyForField(f.id)]);
                    if (Number.isInteger(v) && v > 0) userIds.add(v);
                }
            }
            return { format: await tenantFormat(tx, tenantId), edges, baseline, userNames: await namesOf(tx, tenantId, [...userIds]) };
        });
        const userName = (id: number): string | null => userNames.get(id) ?? null;
        const fmt = { ...format, timezone: zone };

        const startF = byId.get(req.start_field_id);
        if (!startF) throw invalidView();
        const endF = req.end_field_id ? byId.get(req.end_field_id) ?? null : null;
        const startRef = { key: jsonbKeyForField(startF.id), type: startF.type };
        const endRef = endF ? { key: jsonbKeyForField(endF.id), type: endF.type } : null;
        const groupF = req.group_by_field_id ? byId.get(req.group_by_field_id) ?? null : null;
        const colorF = req.color_field_id ? byId.get(req.color_field_id) ?? null : null;
        const colorBy = req.color_by ?? 'field';
        const rules = colorBy === 'rules' && view ? readRules(view.config) : [];
        const columns = (req.column_field_ids ?? []).map((id) => byId.get(id)).filter((f): f is Field => f !== undefined).slice(0, 3);
        const titleId = resolveTitleFieldId(fields, tl.list.settings as Record<string, unknown>);

        const all = [...tl.rows, ...tl.parents];
        const dataOf = (r: RecordDto) => r.data as Record<string, unknown>;
        const groupKeyOf = (r: RecordDto): string | null =>
            groupF ? ganttGroupKey(dataOf(r)[jsonbKeyForField(groupF.id)]) : null;
        const groupLabel = (key: string): string => {
            if (key === GANTT_NULL_GROUP) return 'Sin valor';
            if (!groupF) return key;
            if (groupF.type === 'checkbox') return key === 'true' ? 'Sí' : 'No';
            if (groupF.type === 'user') return userName(Number(key)) ?? `Persona #${key}`;
            return optionOf(groupF, key)?.label ?? key;
        };
        const keys = all.map((r) => groupKeyOf(r) ?? GANTT_NULL_GROUP);
        const order = ganttGroupOrder(groupF, keys, groupLabel);
        const items = buildGanttRows(
            all,
            { id: (r) => r.id, parent: (r) => r.parent_id ?? null, group: groupF ? groupKeyOf : undefined },
            {
                grouped: groupF !== null,
                groupOrder: order,
                collapsedGroups: new Set(req.collapsed_groups ?? []),
                showSubtasks: req.show_subtasks !== false,
            },
        );
        const recById = new Map(all.map((r) => [r.id, r]));
        const barColor = (r: RecordDto): string => {
            if (colorBy === 'rules') {
                for (const rule of rules) {
                    const f = byId.get(rule.condition.field_id);
                    if (!f || !rule.enabled || rule.target === 'cell') continue;
                    const hit = evaluateFilterCondition(rule.condition, { type: f.type, value: dataOf(r)[jsonbKeyForField(f.id)] }, { timeZone: zone });
                    if (hit === true) return GANTT_RULE_COLOR_HEX[rule.color] ?? GANTT_DEFAULT_BAR_COLOR;
                }
                return GANTT_DEFAULT_BAR_COLOR;
            }
            if (colorBy === 'field' && colorF) {
                const opt = optionOf(colorF, ganttGroupKey(dataOf(r)[jsonbKeyForField(colorF.id)]) ?? '');
                return hexOf(opt?.color) ?? GANTT_DEFAULT_BAR_COLOR;
            }
            return GANTT_DEFAULT_BAR_COLOR;
        };
        const baseBar = (id: number): GanttBar | null => {
            const it = baseline?.items[String(id)];
            if (!it) return null;
            return ganttBarOf({ s: it.start, e: it.end }, { key: 's', type: startRef.type }, endRef ? { key: 'e', type: endRef.type } : null, zone);
        };
        const rows: GanttPdfRow[] = items.map((it) => {
            if (it.kind === 'group') {
                const opt = groupF?.type === 'select' ? optionOf(groupF, it.key) : null;
                return {
                    kind: 'group',
                    label: groupLabel(it.key),
                    depth: 0,
                    cells: [],
                    bar: null,
                    color: hexOf(opt?.color) ?? '#9aa1ad',
                    baseline: null,
                    count: it.count,
                };
            }
            const r = recById.get(it.id)!;
            const data = dataOf(r);
            const rawTitle = titleId !== null ? data[jsonbKeyForField(titleId)] : null;
            return {
                kind: 'record',
                id: r.id,
                label: typeof rawTitle === 'string' && rawTitle.trim() !== '' ? rawTitle.trim() : `Registro #${r.id}`,
                depth: it.depth,
                cells: columns.map((f) => formatEmailFieldValue(f, data[jsonbKeyForField(f.id)], fmt, userName)),
                bar: ganttBarOf(data, startRef, endRef, zone),
                color: barColor(r),
                baseline: baseBar(r.id),
            };
        });
        const from = ymdToDay(req.from)!;
        const to = ymdToDay(req.to)!;
        const today = todayIn(zone);
        const buffer = await renderGanttPdf({
            title: req.title?.trim() || view?.name || tl.list.name,
            subtitle: `${tl.list.name} · del ${formatEmailFieldValue({ type: 'date' }, dayToYmd(from), fmt)} al ${formatEmailFieldValue({ type: 'date' }, dayToYmd(to), fmt)}${
                tl.truncated ? ` · se muestran los primeros ${GANTT_MAX_ROWS}` : ''
            }`,
            columns: columns.map((f) => f.label),
            rows,
            deps: edges.map((e) => ({ blocker: e.blocker_id, blocked: e.blocked_id })),
            from,
            to,
            today,
            preferredZoom: req.zoom,
        });
        return { buffer, filename: `${safeName(req.title?.trim() || view?.name || tl.list.name)}-gantt.pdf` };
    }

    // ─────────────────────────── Internos ───────────────────────────

    private async baselineWithItems(tx: Tx, tenantId: number, viewId: number, ids: number[]): Promise<GanttBundle['baseline']> {
        const row = await this.repo.forView(tx, tenantId, viewId);
        if (!row) return null;
        return { ...toBaseline(row), items: await this.repo.itemsFor(tx, tenantId, row.id, ids) };
    }

    /** La vista Gantt de esta lista; `write` = la persona tiene que poder cambiarla. */
    private async ganttView(tenantId: number, actor: Actor, listKey: string, viewId: number, write: boolean): Promise<View> {
        const view = await this.views.get(tenantId, listKey, viewId, viewer(actor));
        if (view.type !== 'gantt') throw invalidView();
        if (write && view.is_locked && view.created_by !== actor.userId && actor.role !== 'admin') {
            throw new ForbiddenException({
                code: 'view_locked',
                message: 'Esta vista está protegida: sólo quien la creó o un admin puede cambiar su línea base.',
                data: { status: 403 },
            });
        }
        return view;
    }
}

function viewer(actor: Actor): { userId: number; role: string; teamIds?: readonly number[] } {
    return { userId: actor.userId, role: actor.role, teamIds: actor.teamIds };
}

function assertRange(from: string, to: string): void {
    const a = ymdToDay(from);
    const b = ymdToDay(to);
    if (a === null || b === null || b < a || b - a + 1 > GANTT_MAX_RANGE_DAYS) {
        throw new BadRequestException({
            code: 'invalid_range',
            message: `El rango del Gantt no es válido (de ${from} a ${to}, máximo ${GANTT_MAX_RANGE_DAYS} días).`,
            data: { status: 400 },
        });
    }
}

function invalidView(): BadRequestException {
    return new BadRequestException({
        code: 'invalid_gantt_view',
        message: 'Esta vista no es un Gantt con un campo de inicio.',
        data: { status: 400 },
    });
}

function toBaseline(row: {
    id: number;
    viewId: number;
    name: string;
    startFieldId: number;
    endFieldId: number | null;
    itemCount: number;
    createdBy: number | null;
    createdByName: string | null;
    createdAt: Date;
}): GanttBaseline {
    return {
        id: row.id,
        view_id: row.viewId,
        name: row.name,
        start_field_id: row.startFieldId,
        end_field_id: row.endFieldId,
        item_count: row.itemCount,
        created_by: row.createdBy,
        created_by_name: row.createdByName,
        created_at: row.createdAt.toISOString(),
    };
}

function defaultBaselineName(): string {
    return `Línea base del ${new Date().toISOString().slice(0, 10)}`;
}

function optionOf(field: Field, value: string): { value: string; label: string; color?: string } | null {
    const opts = ((field.config as { options?: Array<{ value: string; label?: string; color?: string }> } | undefined)?.options ?? []);
    const o = opts.find((x) => String(x.value) === value);
    return o ? { value: String(o.value), label: o.label ?? String(o.value), color: o.color } : null;
}

function hexOf(color: string | undefined): string | null {
    if (!color) return null;
    if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
    return OPTION_COLOR_HEX[color] ?? null;
}

function readRules(config: unknown): ViewColorRule[] {
    const raw = (config as { color_rules?: unknown } | null)?.color_rules;
    if (!Array.isArray(raw)) return [];
    const out: ViewColorRule[] = [];
    for (const r of raw) {
        const parsed = viewColorRuleSchema.safeParse(r);
        if (parsed.success) out.push(parsed.data);
    }
    return out;
}

function todayIn(timeZone: string): number {
    try {
        const ymd = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        return ymdToDay(ymd) ?? Math.floor(Date.now() / 86_400_000);
    } catch {
        return Math.floor(Date.now() / 86_400_000);
    }
}

function safeName(name: string): string {
    return (
        name
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase()
            .slice(0, 60) || 'gantt'
    );
}

async function tenantFormat(tx: Tx, tenantId: number): Promise<TenantFormat> {
    const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const parsed = tenantFormatSchema.safeParse(((row?.settings ?? {}) as Record<string, unknown>).format ?? {});
    return parsed.success ? parsed.data : tenantFormatSchema.parse({});
}

async function namesOf(tx: Tx, tenantId: number, ids: number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .innerJoin(memberships, eq(memberships.userId, users.id))
        .where(and(eq(memberships.tenantId, tenantId), inArray(users.id, ids)));
    return new Map(rows.map((r) => [r.id, r.name]));
}
