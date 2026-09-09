import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
    BLUEPRINT_EXCLUDED_SETTINGS,
    BLUEPRINT_EXCLUDED_TRIGGER_KEYS,
    BLUEPRINT_VERSION,
    createAutomationSchema,
    isDataField,
    jsonbKeyForField,
    resolveFieldRefs,
    resolveListRefs,
    tokenizeFieldRefs,
    tokenizeListRefs,
    widgetTypeSchema,
    type BlueprintInclude,
    type BlueprintList,
    type BlueprintRecord,
    type Field,
    type List,
    type ListBlueprint,
    type WidgetSpec,
} from '@imagina-base/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { AutomationsService } from '../automations/automations.service';
import { BillingService } from '../billing/billing.service';
import { DashboardsService } from '../dashboards/dashboards.service';
import { records } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsRepository } from '../records/records.repository';
import { RelationsRepository } from '../records/relations.repository';
import { TenantDb } from '../tenancy/tenant-db.service';
import { ViewsService } from '../views/views.service';

/** Techo de registros de muestra por lista en un blueprint. */
const MAX_BLUEPRINT_RECORDS = 500;

export interface MaterializeOptions {
    /** Nombre para la PRIMERA lista del pack (las demás conservan el suyo). */
    name?: string;
    groupId?: number | null;
    includeRecords: boolean;
}

export interface MaterializeResult {
    lists: List[];
    /** Piezas que no se pudieron reconstruir (se informa, no se aborta). */
    warnings: string[];
}

/**
 * Serializa listas a blueprint y materializa blueprints en listas (v0.1.166).
 *
 * Es el ÚNICO motor detrás de "Duplicar lista" y de las plantillas — ver el
 * comentario de `listBlueprintSchema` en shared para las reglas del formato.
 * Acá vive lo que necesita DB: resolver ids ↔ slugs, crear las piezas en el
 * orden correcto y no copiar lo que no debe copiarse.
 *
 * Orden de materialización (las dependencias mandan): todas las LISTAS
 * primero (una relation puede apuntar a una lista posterior del pack) →
 * campos de cada lista en dos pasadas (los `computed` referencian otros
 * campos) → ajustes (referencian campos) → vistas → automatizaciones →
 * registros (con padres y relaciones al final, cuando ya existen todos).
 */
@Injectable()
export class BlueprintService {
    private readonly logger = new Logger(BlueprintService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly views: ViewsService,
        private readonly automations: AutomationsService,
        private readonly recordsRepo: RecordsRepository,
        private readonly relationsRepo: RelationsRepository,
        private readonly billing: BillingService,
        private readonly realtime: RealtimeService,
        private readonly dashboards: DashboardsService,
    ) {}

    // ── Serializar ───────────────────────────────────────────────────────

    async serialize(
        tenantId: number,
        listIds: number[],
        include: BlueprintInclude,
    ): Promise<ListBlueprint> {
        const sources = await Promise.all(listIds.map((id) => this.lists.get(tenantId, String(id))));
        // key del pack = slug de la lista (único en el workspace).
        const listIdToKey = new Map(sources.map((l) => [l.id, l.slug]));

        const out: BlueprintList[] = [];
        for (const list of sources) {
            const fields = await this.fields.listByListId(tenantId, list.id);
            const idToSlug = new Map(fields.map((f) => [f.id, f.slug]));
            const tokenize = (v: unknown, extra: readonly string[] = []): unknown =>
                tokenizeListRefs(tokenizeFieldRefs(v, idToSlug, extra), listIdToKey);

            const settings: Record<string, unknown> = {};
            if (include.settings) {
                for (const [k, v] of Object.entries(list.settings)) {
                    if (!BLUEPRINT_EXCLUDED_SETTINGS.includes(k)) settings[k] = v;
                }
            }

            const bp: BlueprintList = {
                key: list.slug,
                name: list.name,
                icon: list.icon,
                color: list.color,
                settings: tokenize(settings) as Record<string, unknown>,
                fields: fields.map((f) => ({
                    label: f.label,
                    slug: f.slug,
                    type: f.type,
                    config: tokenize(f.config, ['inputs']) as Record<string, unknown>,
                    is_required: f.is_required,
                    is_unique: f.is_unique,
                    is_indexed: f.is_indexed,
                    description: f.description ?? null,
                })),
                views: [],
                automations: [],
                records: [],
            };

            if (include.views) {
                const views = await this.views.list(tenantId, String(list.id));
                bp.views = views.map((v) => ({
                    name: v.name,
                    type: v.type,
                    config: tokenize(v.config) as Record<string, unknown>,
                    is_default: v.is_default,
                }));
            }

            if (include.automations) {
                const autos = await this.automations.list(tenantId, String(list.id));
                bp.automations = autos.map((a) => {
                    const trigger: Record<string, unknown> = {};
                    for (const [k, v] of Object.entries(a.trigger_config)) {
                        if (!BLUEPRINT_EXCLUDED_TRIGGER_KEYS.includes(k)) trigger[k] = v;
                    }
                    return {
                        name: a.name,
                        description: a.description,
                        trigger_type: a.trigger_type,
                        trigger_config: tokenize(trigger) as Record<string, unknown>,
                        actions: tokenize(a.actions) as unknown[],
                        is_active: a.is_active,
                    };
                });
            }

            if (include.records) {
                bp.records = await this.serializeRecords(tenantId, list.id, fields, listIdToKey);
            }

            out.push(bp);
        }
        return { version: BLUEPRINT_VERSION, lists: out, dashboards: [] };
    }

    /**
     * Registros de muestra por slug. Se saltan los valores que no viajan:
     * `file` (el adjunto pertenece al registro original), `computed` (se
     * recalcula) y `relation` (va aparte, por keys del pack o ids).
     */
    private async serializeRecords(
        tenantId: number,
        listId: number,
        fields: Field[],
        listIdToKey: ReadonlyMap<number, string>,
    ): Promise<BlueprintRecord[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: records.id, data: records.data, parentId: records.parentId })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), isNull(records.deletedAt)))
                .orderBy(asc(records.id))
                .limit(MAX_BLUEPRINT_RECORDS),
        );
        const ids = new Set(rows.map((r) => r.id));
        const relationFields = fields.filter((f) => f.type === 'relation');
        const targets =
            relationFields.length > 0 && rows.length > 0
                ? await this.tenantDb.withTenant(tenantId, (tx) =>
                      this.relationsRepo.batchTargets(
                          tx,
                          tenantId,
                          rows.map((r) => r.id),
                          relationFields.map((f) => f.id),
                      ),
                  )
                : new Map<number, Map<number, number[]>>();

        const keyOf = (id: number): string => `r${id}`;
        return rows.map((r) => {
            const data: Record<string, unknown> = {};
            for (const f of fields) {
                if (!isDataField(f.type) || f.type === 'file') continue;
                const v = (r.data as Record<string, unknown>)[jsonbKeyForField(f.id)];
                if (v !== undefined && v !== null && v !== '') data[f.slug] = v;
            }
            const rec: BlueprintRecord = { key: keyOf(r.id), data };
            if (r.parentId !== null && ids.has(r.parentId)) rec.parent_key = keyOf(r.parentId);
            const byField = targets.get(r.id);
            if (byField) {
                const rel: Record<string, Array<string | number>> = {};
                for (const f of relationFields) {
                    const tIds = byField.get(f.id) ?? [];
                    if (tIds.length === 0) continue;
                    const targetListId = Number((f.config as { target_list_id?: unknown }).target_list_id);
                    // Destino dentro del pack → key (portable); fuera → id
                    // numérico (sólo vale en el mismo workspace).
                    rel[f.slug] = listIdToKey.has(targetListId)
                        ? tIds.map((id) => keyOf(id))
                        : tIds;
                }
                if (Object.keys(rel).length > 0) rec.relations = rel;
            }
            return rec;
        });
    }

    // ── Materializar ─────────────────────────────────────────────────────

    async materialize(
        tenantId: number,
        actorId: number,
        blueprint: ListBlueprint,
        opts: MaterializeOptions,
    ): Promise<MaterializeResult> {
        const warnings: string[] = [];

        // A) Todas las listas primero: una relation puede apuntar a una lista
        //    posterior del pack.
        const created: List[] = [];
        const keyToListId = new Map<string, number>();
        for (const [i, bl] of blueprint.lists.entries()) {
            const list = await this.lists.create(tenantId, {
                name: i === 0 && opts.name !== undefined ? opts.name : bl.name,
                icon: bl.icon ?? undefined,
                color: bl.color ?? undefined,
            });
            if (opts.groupId !== undefined && opts.groupId !== null) {
                await this.lists.update(tenantId, String(list.id), { group_id: opts.groupId });
            }
            created.push(list);
            keyToListId.set(bl.key, list.id);
        }
        const resolveLists = (v: unknown): unknown => resolveListRefs(v, keyToListId);

        // B) Campos, en dos pasadas: primero todos (los `computed` sin
        //    `inputs`, porque referencian campos que quizá no existen aún),
        //    después la config completa de los que referencian otros.
        const slugMaps = new Map<string, Map<string, number>>();
        for (const [i, bl] of blueprint.lists.entries()) {
            const list = created[i]!;
            const slugToId = new Map<string, number>();
            const pending: Array<{ id: number; config: unknown }> = [];
            for (const f of bl.fields) {
                const hasFieldRefs = JSON.stringify(f.config).includes('"$field"');
                const config = resolveLists(hasFieldRefs ? {} : f.config) as Record<string, unknown>;
                try {
                    const field = await this.fields.create(tenantId, String(list.id), {
                        label: f.label,
                        slug: f.slug,
                        type: f.type,
                        config: this.dropDeadListRefs(config),
                        is_required: f.is_required,
                        is_unique: f.is_unique,
                        is_indexed: f.is_indexed,
                        description: f.description,
                    });
                    slugToId.set(f.slug, field.id);
                    if (hasFieldRefs) pending.push({ id: field.id, config: f.config });
                } catch (err) {
                    warnings.push(`Campo «${f.label}» de «${bl.name}»: ${message(err)}`);
                }
            }
            for (const p of pending) {
                const config = this.dropDeadListRefs(
                    resolveLists(resolveFieldRefs(p.config, slugToId)) as Record<string, unknown>,
                );
                try {
                    await this.fields.update(tenantId, String(list.id), String(p.id), { config });
                } catch (err) {
                    warnings.push(`Configuración de un campo calculado de «${bl.name}»: ${message(err)}`);
                }
            }
            slugMaps.set(bl.key, slugToId);
        }

        // C) Ajustes, D) vistas, E) automatizaciones.
        for (const [i, bl] of blueprint.lists.entries()) {
            const list = created[i]!;
            const slugToId = slugMaps.get(bl.key)!;
            const resolve = (v: unknown): unknown => resolveLists(resolveFieldRefs(v, slugToId));

            if (Object.keys(bl.settings).length > 0) {
                const settings = resolve(bl.settings) as Record<string, unknown>;
                // Un título que no se pudo resolver queda en null: mejor el
                // fallback al primer texto que un 400 por id inválido.
                if (settings.title_field_id === null) delete settings.title_field_id;
                try {
                    await this.lists.update(tenantId, String(list.id), { settings });
                } catch (err) {
                    warnings.push(`Ajustes de «${bl.name}»: ${message(err)}`);
                }
            }

            for (const v of bl.views) {
                try {
                    await this.views.create(tenantId, String(list.id), {
                        name: v.name,
                        type: v.type,
                        config: resolve(v.config) as Record<string, unknown>,
                        is_default: v.is_default,
                    });
                } catch (err) {
                    warnings.push(`Vista «${v.name}» de «${bl.name}»: ${message(err)}`);
                }
            }

            for (const a of bl.automations) {
                const parsed = createAutomationSchema.safeParse({
                    name: a.name,
                    description: a.description,
                    trigger_type: a.trigger_type,
                    trigger_config: resolve(a.trigger_config),
                    actions: resolve(a.actions),
                    is_active: a.is_active,
                });
                if (!parsed.success) {
                    warnings.push(`Automatización «${a.name}» de «${bl.name}»: datos inválidos`);
                    continue;
                }
                try {
                    await this.automations.create(tenantId, String(list.id), parsed.data);
                } catch (err) {
                    warnings.push(`Automatización «${a.name}» de «${bl.name}»: ${message(err)}`);
                }
            }
        }

        // F) Registros de muestra.
        if (opts.includeRecords) {
            await this.materializeRecords(tenantId, actorId, blueprint, created, slugMaps, keyToListId, warnings);
        }

        // G) Tableros del pack (v0.1.167): cada widget apunta a una lista del
        //    pack y sus campos se resuelven contra ESA lista.
        for (const d of blueprint.dashboards) {
            const widgets: WidgetSpec[] = [];
            for (const wd of d.widgets) {
                const type = widgetTypeSchema.safeParse(wd.type);
                if (!type.success) continue;
                if (wd.list === 0) {
                    widgets.push({ id: newWidgetId(), type: type.data, list_id: 0, title: wd.title, config: wd.config, layout: wd.layout });
                    continue;
                }
                const listId = keyToListId.get(wd.list.$list);
                const slugToId = slugMaps.get(wd.list.$list);
                if (listId === undefined || !slugToId) {
                    warnings.push(`Widget «${wd.title}» de «${d.name}»: lista «${wd.list.$list}» fuera del pack`);
                    continue;
                }
                widgets.push({
                    id: newWidgetId(),
                    type: type.data,
                    list_id: listId,
                    title: wd.title,
                    config: resolveLists(resolveFieldRefs(wd.config, slugToId)) as Record<string, unknown>,
                    layout: wd.layout,
                });
            }
            try {
                await this.dashboards.create(tenantId, actorId, {
                    name: d.name,
                    description: d.description,
                    widgets,
                    settings: d.settings,
                });
            } catch (err) {
                warnings.push(`Tablero «${d.name}»: ${message(err)}`);
            }
        }

        this.realtime.lists(tenantId);
        return { lists: created, warnings };
    }

    /**
     * Una relation cuyo `$list` no se pudo resolver (lista fuera del pack y
     * de otro workspace) queda SIN destino: el campo existe, el usuario elige
     * la lista después. Idem `list_id` de un create_record.
     */
    private dropDeadListRefs(config: Record<string, unknown>): Record<string, unknown> {
        const out = { ...config };
        if (out.target_list_id === null) delete out.target_list_id;
        return out;
    }

    private async materializeRecords(
        tenantId: number,
        actorId: number,
        blueprint: ListBlueprint,
        created: List[],
        slugMaps: ReadonlyMap<string, ReadonlyMap<string, number>>,
        keyToListId: ReadonlyMap<string, number>,
        warnings: string[],
    ): Promise<void> {
        const total = blueprint.lists.reduce((n, l) => n + l.records.length, 0);
        if (total === 0) return;
        await this.billing.assertCanCreateRecords(tenantId, total);

        // key de registro → id creado (global al pack: las relaciones cruzan listas).
        const recordIds = new Map<string, number>();
        const deferred: Array<{
            listId: number;
            id: number;
            parentKey?: string;
            relations: Array<{ fieldId: number; targets: Array<string | number> }>;
        }> = [];

        for (const [i, bl] of blueprint.lists.entries()) {
            const list = created[i]!;
            const slugToId = slugMaps.get(bl.key)!;
            const fieldsById = new Map(
                (await this.fields.listByListId(tenantId, list.id)).map((f) => [f.id, f]),
            );
            await this.tenantDb.withTenant(tenantId, async (tx) => {
                for (const rec of bl.records) {
                    const data: Record<string, unknown> = {};
                    for (const [slug, value] of Object.entries(rec.data)) {
                        const fid = slugToId.get(slug);
                        if (fid === undefined) continue;
                        const f = fieldsById.get(fid);
                        if (!f || !isDataField(f.type)) continue;
                        data[jsonbKeyForField(fid)] = value;
                    }
                    const row = await this.recordsRepo.insert(tx, {
                        tenantId,
                        listId: list.id,
                        data,
                        createdBy: actorId,
                    });
                    if (rec.key !== undefined) recordIds.set(`${bl.key}:${rec.key}`, row.id);
                    const relations: Array<{ fieldId: number; targets: Array<string | number> }> = [];
                    for (const [slug, targets] of Object.entries(rec.relations ?? {})) {
                        const fid = slugToId.get(slug);
                        const f = fid !== undefined ? fieldsById.get(fid) : undefined;
                        if (!f || f.type !== 'relation') continue;
                        relations.push({ fieldId: f.id, targets });
                    }
                    if (rec.parent_key !== undefined || relations.length > 0) {
                        deferred.push({ listId: list.id, id: row.id, parentKey: rec.parent_key, relations });
                    }
                }
            });
            this.realtime.records(tenantId, list.id);
        }

        // Padres y relaciones cuando ya existen TODOS los registros del pack.
        const listKeyOf = new Map<number, string>();
        for (const [k, id] of keyToListId) listKeyOf.set(id, k);
        const targetListKey = (fieldId: number, listId: number): string | undefined => {
            void fieldId;
            return listKeyOf.get(listId);
        };
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            for (const d of deferred) {
                const ownKey = listKeyOf.get(d.listId)!;
                if (d.parentKey !== undefined) {
                    const parentId = recordIds.get(`${ownKey}:${d.parentKey}`);
                    if (parentId !== undefined) {
                        await tx
                            .update(records)
                            .set({ parentId })
                            .where(and(eq(records.tenantId, tenantId), eq(records.id, d.id)));
                    } else {
                        warnings.push(`Un registro de muestra quedó sin su padre (clave «${d.parentKey}»)`);
                    }
                }
                for (const r of d.relations) {
                    const ids: number[] = [];
                    for (const t of r.targets) {
                        if (typeof t === 'number') {
                            ids.push(t);
                            continue;
                        }
                        // La key es del pack: buscamos en la lista destino de la relation.
                        const field = (await this.fields.listByListIdWithinTx(tx, tenantId, d.listId)).find(
                            (f) => f.id === r.fieldId,
                        );
                        const targetListId = Number((field?.config as { target_list_id?: unknown })?.target_list_id);
                        const tKey = targetListKey(r.fieldId, targetListId);
                        const id = tKey !== undefined ? recordIds.get(`${tKey}:${t}`) : undefined;
                        if (id !== undefined) ids.push(id);
                    }
                    if (ids.length === 0) continue;
                    const existing = await this.relationsRepo.existingInList(
                        tx,
                        tenantId,
                        await this.relationTargetList(tx, tenantId, d.listId, r.fieldId),
                        ids,
                    );
                    const alive = ids.filter((id) => existing.has(id));
                    if (alive.length > 0) await this.relationsRepo.sync(tx, tenantId, r.fieldId, d.id, alive);
                }
            }
        });
    }

    private async relationTargetList(
        tx: Parameters<FieldsService['listByListIdWithinTx']>[0],
        tenantId: number,
        listId: number,
        fieldId: number,
    ): Promise<number> {
        const field = (await this.fields.listByListIdWithinTx(tx, tenantId, listId)).find((f) => f.id === fieldId);
        const target = Number((field?.config as { target_list_id?: unknown })?.target_list_id);
        if (!Number.isInteger(target) || target <= 0) {
            throw new BadRequestException({
                code: 'relation_without_target',
                message: 'La relación no tiene lista destino',
                data: { status: 400 },
            });
        }
        return target;
    }
}

function newWidgetId(): string {
    return `w-${Math.random().toString(36).slice(2, 10)}`;
}

function message(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
    return String(err);
}
