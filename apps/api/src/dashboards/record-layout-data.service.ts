import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import {
    CHART_KIND_WIDGET,
    layoutChartConfigSchema,
    layoutRelatedConfigSchema,
    type Field,
    type LayoutDataRequest,
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

        const entries = await Promise.all(
            req.blocks.map(async (block) => {
                try {
                    if (block.type === 'chart') {
                        const cfg = layoutChartConfigSchema.parse(block.config);
                        const src = await this.resolveSource(tenantId, list.id, baseFields, recordId, cfg.source);
                        const config: Record<string, unknown> = { ...cfg };
                        // Plantillas convertidas de la v2: el campo de agrupación
                        // de la OTRA lista venía por slug.
                        if (config.group_by_field_id === undefined && typeof config.group_by_field_slug === 'string') {
                            const f = (await fieldsOf(src.listId)).find((x) => x.slug === config.group_by_field_slug);
                            if (f) config.group_by_field_id = f.id;
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
                    const src = await this.resolveSource(tenantId, list.id, baseFields, recordId, cfg.source);
                    return [block.id, await this.related(tenantId, viewer, src, cfg, fieldsOf)] as const;
                } catch (err) {
                    return [block.id, { __error: blockErrorMessage(err, this.logger) }] as const;
                }
            }),
        );
        return Object.fromEntries(entries);
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
    ): Promise<unknown> {
        const list = await this.lists.get(tenantId, String(src.listId));
        const hidden = hiddenFieldsFor(list.settings, viewer.role as Role, viewer.userId);
        const visible = (await fieldsOf(src.listId)).filter((f) => !hidden.has(f.slug));
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
        return {
            list: { id: list.id, slug: list.slug, name: list.name, icon: list.icon ?? null, color: list.color ?? null },
            fields: visible,
            rows: page.data,
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
