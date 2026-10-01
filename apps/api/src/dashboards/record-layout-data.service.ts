import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import {
    CHART_KIND_WIDGET,
    layoutChartConfigSchema,
    layoutRelatedConfigSchema,
    type Field,
    type FilterGroup,
    type FilterNode,
    type LayoutDataRequest,
    type RecordDto,
    type LayoutDataSource,
    type Role,
    type WidgetSpec,
} from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { fields as fieldsTable } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { hiddenFieldsFor } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import type { RelatedScope } from '../records/related-scope';
import { RecordsService } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { DashboardsService, type DashboardViewer } from './dashboards.service';

interface ResolvedSource {
    listId: number;
    related?: RelatedScope;
    /** Condición extra (el campo persona = el cliente, en el portal). */
    extraFilter?: FilterNode;
}

interface PortalMode {
    userId: number;
    signFile: (fileId: number) => string;
    /** Campos que usan los bloques, por lista (se devuelven sus definiciones). */
    used: Map<number, Set<number>>;
    /** De qué lista lee cada bloque (el portal no puede preguntárselo al admin). */
    blockLists: Record<string, number>;
}

export interface PortalLayoutData {
    data: Record<string, unknown>;
    lists: Record<string, { id: number; slug: string; name: string; icon: string | null; color: string | null }>;
    fields: Record<string, Field[]>;
    block_lists: Record<string, number>;
}

/** Ids de campo que nombra la config de un bloque (`*_field_id`, `*_field_ids`). */
export function referencedFieldIds(config: Record<string, unknown>): number[] {
    const out: number[] = [];
    for (const [k, v] of Object.entries(config)) {
        if (/(^|_)field_id$/.test(k) && typeof v === 'number') out.push(v);
        if (/(^|_)field_ids$/.test(k) && Array.isArray(v)) for (const x of v) if (typeof x === 'number') out.push(x);
    }
    return out;
}

function noteFields(used: Map<number, Set<number>>, listId: number, config: Record<string, unknown>): void {
    const set = used.get(listId) ?? new Set<number>();
    for (const id of referencedFieldIds(config)) set.add(id);
    used.set(listId, set);
}

function andFilter(tree: FilterNode | undefined, extra: FilterNode): FilterGroup {
    return tree ? { type: 'group', logic: 'and', children: [tree, extra] } : { type: 'group', logic: 'and', children: [extra] };
}

/** Una fila para el cliente: sólo las columnas visibles y los archivos firmados. */
function portalRow(row: RecordDto, visible: Field[], signFile: (id: number) => string): RecordDto {
    const data: Record<string, unknown> = {};
    const relations: Record<string, number[]> = {};
    for (const f of visible) {
        const key = `f${f.id}`;
        if (f.type === 'relation') {
            const rel = row.relations?.[key];
            if (rel) relations[key] = rel;
            continue;
        }
        let v = row.data[key];
        if (f.type === 'file' && v !== undefined && v !== null) {
            const one = (x: unknown): unknown => (typeof x === 'number' && x > 0 ? signFile(x) : x);
            v = Array.isArray(v) ? v.map(one) : one(v);
        }
        if (v !== undefined) data[key] = v;
    }
    return { ...row, data, relations, created_by: 0 };
}

/**
 * v0.1.230 — Datos de los bloques de la ficha del registro (plantillas v3).
 *
 * Una ficha tiene gráficos y tablas sobre los registros VINCULADOS a ese
 * registro (las facturas de este cliente por estado, la suma de lo que
 * compró). En UN request se calculan todos, cada uno AISLADO: un bloque mal
 * configurado devuelve su propio `{ __error }` y el resto se dibuja (mismo
 * criterio que el bundle de los tableros, v0.1.229).
 *
 * Seguridad: el registro base tiene que ser visible para quien mira (si no,
 * 404 — igual que abrir la ficha) y cada bloque se calcula con el ACL de esa
 * persona sobre la lista que consulta (scope del rol + campos ocultos), con
 * el MISMO motor de los tableros. La relación tiene que tocar la lista del
 * registro: no se puede usar este endpoint para leer vínculos ajenos.
 */
@Injectable()
export class RecordLayoutDataService {
    private readonly logger = new Logger(RecordLayoutDataService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly dashboards: DashboardsService,
    ) {}

    async data(
        tenantId: number,
        viewer: DashboardViewer,
        listIdOrSlug: string,
        recordId: number,
        req: LayoutDataRequest,
    ): Promise<Record<string, unknown>> {
        const actor = { userId: viewer.userId, role: viewer.role as Role };
        // El registro base tiene que ser visible (404 si no — no filtramos info).
        await this.records.get(tenantId, actor, listIdOrSlug, recordId);
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const baseFields = await this.fields.list(tenantId, String(list.id));
        const fieldsCache = new Map<number, Promise<Field[]>>();
        const fieldsOf = (listId: number): Promise<Field[]> => {
            let hit = fieldsCache.get(listId);
            if (!hit) {
                hit = this.fields.list(tenantId, String(listId));
                fieldsCache.set(listId, hit);
            }
            return hit;
        };

        return this.computeBlocks(tenantId, viewer, list.id, baseFields, recordId, req.blocks, fieldsOf, null);
    }

    /**
     * v0.1.233 — Datos de los bloques del PORTAL del cliente (ADR-S26 fase C).
     *
     * Mismo motor que la ficha, con tres diferencias de seguridad:
     *  - el alcance NO es el ACL de un rol (el cliente no tiene permisos de
     *    lista): cada fuente se acota al cliente. Una relación lleva a los
     *    vinculados a SU registro; una lista entera, a lo que el scope del
     *    portal le asigna (vinculado a su registro o con un campo persona que
     *    es él) — sin vínculo, el bloque falla cerrado;
     *  - a una tabla de vinculados sólo viajan las columnas del bloque (más el
     *    título): las demás columnas de esa lista no salen del servidor;
     *  - los archivos de las filas viajan como URLs firmadas.
     *
     * `blocks` sale de la plantilla GUARDADA (portal) o del editor (vista
     * previa del admin, `manage_lists`). Devuelve también las definiciones
     * de los campos que usan los bloques, para que el portal pinte colores y
     * etiquetas sin pedir nada al admin.
     */
    async portal(
        tenantId: number,
        scope: { listId: number; recordId: number; userId: number },
        blocks: LayoutDataRequest['blocks'],
        signFile: (fileId: number) => string,
    ): Promise<PortalLayoutData> {
        const baseFields = await this.fields.list(tenantId, String(scope.listId));
        const fieldsCache = new Map<number, Promise<Field[]>>();
        const fieldsOf = (listId: number): Promise<Field[]> => {
            let hit = fieldsCache.get(listId);
            if (!hit) {
                hit = this.fields.list(tenantId, String(listId));
                fieldsCache.set(listId, hit);
            }
            return hit;
        };
        // El portal no tiene permisos de rol: el alcance lo pone la fuente.
        const viewer: DashboardViewer = { userId: scope.userId, role: 'admin' };
        const used = new Map<number, Set<number>>();
        const blockLists: Record<string, number> = {};
        const data = await this.computeBlocks(tenantId, viewer, scope.listId, baseFields, scope.recordId, blocks, fieldsOf, {
            userId: scope.userId,
            signFile,
            used,
            blockLists,
        });
        const lists: PortalLayoutData['lists'] = {};
        const fields: PortalLayoutData['fields'] = {};
        for (const [listId, ids] of used) {
            const l = await this.lists.get(tenantId, String(listId));
            lists[String(listId)] = { id: l.id, slug: l.slug, name: l.name, icon: l.icon ?? null, color: l.color ?? null };
            fields[String(listId)] = (await fieldsOf(listId)).filter((f) => ids.has(f.id));
        }
        return { data, lists, fields, block_lists: blockLists };
    }

    private async computeBlocks(
        tenantId: number,
        viewer: DashboardViewer,
        baseListId: number,
        baseFields: Field[],
        recordId: number,
        blocks: LayoutDataRequest['blocks'],
        fieldsOf: (listId: number) => Promise<Field[]>,
        portal: PortalMode | null,
    ): Promise<Record<string, unknown>> {
        const entries = await Promise.all(
            blocks.map(async (block) => {
                try {
                    if (block.type === 'chart') {
                        const cfg = layoutChartConfigSchema.parse(block.config);
                        const src = portal
                            ? await this.portalSource(tenantId, baseListId, baseFields, recordId, cfg.source, portal, fieldsOf)
                            : await this.resolveSource(tenantId, baseListId, baseFields, recordId, cfg.source);
                        const config: Record<string, unknown> = { ...cfg };
                        // Plantillas convertidas de la v2: el campo de agrupación
                        // de la OTRA lista venía por slug.
                        if (config.group_by_field_id === undefined && typeof config.group_by_field_slug === 'string') {
                            const f = (await fieldsOf(src.listId)).find((x) => x.slug === config.group_by_field_slug);
                            if (f) config.group_by_field_id = f.id;
                        }
                        if (src.extraFilter) config.filter_tree = andFilter(cfg.filter_tree, src.extraFilter);
                        if (portal) {
                            noteFields(portal.used, src.listId, config);
                            portal.blockLists[block.id] = src.listId;
                        }
                        const widget = {
                            id: block.id,
                            type: CHART_KIND_WIDGET[cfg.kind],
                            list_id: src.listId,
                            title: block.title ?? '',
                            config,
                            layout: { x: 0, y: 0, w: 12, h: 4 },
                        } as WidgetSpec;
                        return [block.id, await this.dashboards.computeLooseWidget(tenantId, viewer, widget, src.related)] as const;
                    }
                    const cfg = layoutRelatedConfigSchema.parse(block.config);
                    const src = portal
                        ? await this.portalSource(tenantId, baseListId, baseFields, recordId, cfg.source, portal, fieldsOf)
                        : await this.resolveSource(tenantId, baseListId, baseFields, recordId, cfg.source);
                    if (src.extraFilter) cfg.filter_tree = andFilter(cfg.filter_tree, src.extraFilter);
                    if (portal) portal.blockLists[block.id] = src.listId;
                    return [block.id, await this.related(tenantId, viewer, src, cfg, fieldsOf, portal)] as const;
                } catch (err) {
                    return [block.id, { __error: blockErrorMessage(err, this.logger) }] as const;
                }
            }),
        );
        return Object.fromEntries(entries);
    }

    /**
     * Fuente de un bloque del portal, acotada al cliente (fail-closed):
     *  - una relación (en cualquier sentido) que toque la lista del portal →
     *    los vinculados a SU registro;
     *  - otra lista entera → la relación de esa lista que apunta al portal o,
     *    si no hay, su campo persona igual al cliente; sin vínculo, error.
     */
    private async portalSource(
        tenantId: number,
        baseListId: number,
        baseFields: Field[],
        recordId: number,
        source: LayoutDataSource,
        portal: PortalMode,
        fieldsOf: (listId: number) => Promise<Field[]>,
    ): Promise<ResolvedSource> {
        if (source.kind !== 'list') return this.resolveSource(tenantId, baseListId, baseFields, recordId, source);
        if (source.list_id === baseListId) throw badBlock('Para mostrar datos del propio cliente usá un bloque de campo');
        const other = await fieldsOf(source.list_id);
        const byPosition = [...other].sort((a, b) => a.position - b.position);
        const rel = byPosition.find(
            (f) => f.type === 'relation' && Number((f.config as { target_list_id?: unknown }).target_list_id ?? 0) === baseListId,
        );
        if (rel) return { listId: source.list_id, related: { fieldId: rel.id, recordId, direction: 'reverse' } };
        const userField = byPosition.find((f) => f.type === 'user');
        if (userField) {
            return {
                listId: source.list_id,
                extraFilter: { type: 'condition', field_id: userField.id, op: 'eq', value: portal.userId },
            };
        }
        throw badBlock('Esa lista no está vinculada al cliente: no hay nada suyo para mostrar');
    }

    /** Lista + scope de vínculo de una fuente de datos. */
    private async resolveSource(
        tenantId: number,
        baseListId: number,
        baseFields: Field[],
        recordId: number,
        source: LayoutDataSource,
    ): Promise<ResolvedSource> {
        if (source.kind === 'record') throw badBlock('Este bloque necesita una relación o una lista como fuente');
        if (source.kind === 'list') {
            const l = await this.lists.get(tenantId, String(source.list_id));
            return { listId: l.id };
        }
        const own = baseFields.find((f) => f.id === source.field_id);
        if (own) {
            if (own.type !== 'relation') throw badBlock('La fuente tiene que ser un campo de relación');
            const target = Number((own.config as { target_list_id?: unknown }).target_list_id ?? 0);
            // En una relación de la lista consigo misma los dos sentidos son
            // posibles; si no, un campo propio es siempre "hacia afuera".
            const direction = source.direction === 'reverse' && target === baseListId ? 'reverse' : 'forward';
            if (direction === 'forward' && !(target > 0)) throw badBlock('La relación no tiene lista de destino');
            return {
                listId: direction === 'forward' ? target : baseListId,
                related: { fieldId: own.id, recordId, direction },
            };
        }
        // Hacia adentro: una relación de OTRA lista que apunta a ésta.
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: fieldsTable.id, listId: fieldsTable.listId, type: fieldsTable.type, config: fieldsTable.config })
                .from(fieldsTable)
                .where(and(eq(fieldsTable.id, source.field_id), eq(fieldsTable.tenantId, tenantId)))
                .limit(1),
        );
        const target = Number((row?.config as { target_list_id?: unknown } | undefined)?.target_list_id ?? 0);
        if (!row || row.type !== 'relation' || target !== baseListId) {
            throw badBlock('La relación elegida no está vinculada a esta lista');
        }
        return { listId: row.listId, related: { fieldId: row.id, recordId, direction: 'reverse' } };
    }

    /** Registros vinculados para un bloque `related` (tabla, tarjetas, tablero…). */
    private async related(
        tenantId: number,
        viewer: DashboardViewer,
        src: ResolvedSource,
        cfg: ReturnType<typeof layoutRelatedConfigSchema.parse>,
        fieldsOf: (listId: number) => Promise<Field[]>,
        portal: PortalMode | null,
    ): Promise<unknown> {
        const list = await this.lists.get(tenantId, String(src.listId));
        const hidden = hiddenFieldsFor(list.settings, viewer.role as Role, viewer.userId);
        let visible = (await fieldsOf(src.listId)).filter((f) => !hidden.has(f.slug));
        if (portal) {
            // Al cliente sólo le llegan las columnas del bloque (+ el título y
            // los campos que la vista necesita para agrupar/ubicar).
            const wanted = new Set<number>(referencedFieldIds(cfg as Record<string, unknown>));
            const title = visible.find((f) => f.is_primary) ?? visible.find((f) => f.type === 'text');
            if (title) wanted.add(title.id);
            if (wanted.size === 1 && cfg.field_ids === undefined) {
                for (const f of visible.filter((x) => !['long_text', 'relation', 'file'].includes(x.type)).slice(0, 6)) wanted.add(f.id);
            }
            // Las relaciones y las personas se resuelven con datos del admin
            // (títulos de otros registros, nombres del equipo): no viajan.
            visible = visible.filter((f) => wanted.has(f.id) && f.type !== 'relation' && f.type !== 'user');
            noteFields(portal.used, src.listId, { field_ids: visible.map((f) => f.id) });
        }
        const limit = cfg.limit ?? 25;
        const sortOk = cfg.sort_field_id !== undefined && visible.some((f) => f.id === cfg.sort_field_id);
        const page = await this.records.list(
            tenantId,
            { userId: viewer.userId, role: viewer.role as Role },
            String(src.listId),
            {
                limit,
                sort_dir: sortOk ? 'asc' : 'desc',
                sort: sortOk ? `field_${cfg.sort_field_id}:${cfg.sort_dir ?? 'asc'}` : undefined,
                filter_tree: cfg.filter_tree,
                with_total: true,
            },
            { related: src.related },
        );
        const rows = portal ? page.data.map((r) => portalRow(r, visible, portal.signFile)) : page.data;
        return {
            list: { id: list.id, slug: list.slug, name: list.name, icon: list.icon ?? null, color: list.color ?? null },
            fields: visible,
            rows,
            total: page.meta?.total ?? page.data.length,
        };
    }
}

function badBlock(message: string): BadRequestException {
    return new BadRequestException({ code: 'invalid_layout_block', message, data: { status: 400 } });
}

/** Mensaje presentable para un bloque que falló (los internos, genéricos). */
function blockErrorMessage(err: unknown, logger: Logger): string {
    if (err instanceof HttpException) {
        const res = err.getResponse();
        const msg = typeof res === 'object' && res !== null ? (res as { message?: unknown }).message : res;
        if (typeof msg === 'string' && msg !== '') return msg;
    }
    if (err && typeof err === 'object' && 'issues' in err) return 'La configuración del bloque no es válida.';
    logger.warn(`Bloque de ficha: ${err instanceof Error ? err.message : String(err)}`);
    return 'No se pudo calcular este bloque.';
}
