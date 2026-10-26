import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import {
    addDaysYmd,
    BLUEPRINT_EXCLUDED_SETTINGS,
    BLUEPRINT_EXCLUDED_TRIGGER_KEYS,
    BLUEPRINT_VERSION,
    createAutomationSchema,
    findDependencyCycle,
    isDataField,
    jsonbKeyForField,
    portableTemplateContent,
    readTemplateContent,
    templateContentFromPortable,
    templateRefs,
    formulaRefsToSlugs,
    resolveFieldRefs,
    resolveListRefs,
    tokenizeFieldRefs,
    tokenizeListRefs,
    widgetTypeSchema,
    type BlueprintInclude,
    type BlueprintList,
    type BlueprintRecord,
    type CrossListFieldRef,
    type Field,
    type List,
    type ListBlueprint,
    type WidgetSpec,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { withoutApprovalFlowRefs } from '../approvals/approval-refs';
import { AutomationsService } from '../automations/automations.service';
import { BillingService } from '../billing/billing.service';
import { DashboardsService } from '../dashboards/dashboards.service';
import { memberships, recordDependencies, records, recordTemplates, users } from '../db/schema';
import { ChecklistsRepository } from '../checklists/checklists.repository';
import { RecordTemplatesService } from '../record-templates/record-templates.service';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsRepository } from '../records/records.repository';
import { DependenciesRepository } from '../records/dependencies.repository';
import { RelationsRepository } from '../records/relations.repository';
import { TenantDb } from '../tenancy/tenant-db.service';
import { ViewsService } from '../views/views.service';
import {
    applyButtonAutomationRefs,
    buttonLostTemplate,
    cleanResolvedButtonConfig,
    extractButtonAutomationRefs,
    portableButtonConfig,
} from '../buttons/button-portable';

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
    /** v0.1.206 — key de la lista del pack → (slug → id del campo creado). */
    fieldIds: Record<string, Record<string, number>>;
    /** v0.1.206 — tableros creados, en el orden del blueprint. */
    dashboardIds: number[];
    /** Piezas que no se pudieron reconstruir (se informa, no se aborta). */
    warnings: string[];
}

/**
 * Serializa listas a blueprint y materializa blueprints en listas (v0.1.166).
 *
 * Es el ÚNICO motor detrás de "Duplicar lista" y de las plantillas — ver el
 * comentario de `listBlueprintSchema` en shared para las reglas del formato.
 * Aquí vive lo que necesita DB: resolver ids ↔ slugs, crear las piezas en el
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
        // C6 — plantillas de registro de la lista (Optional + al final: los
        // specs que arman el servicio a mano siguen andando).
        @Optional() private readonly recordTemplates?: RecordTemplatesService,
    ) {}

    // ── Serializar ───────────────────────────────────────────────────────

    /** C3 — Saca de `permissions.users` a las personas invitadas de afuera. */
    private async dropGuestAccess(tenantId: number, settings: Record<string, unknown>): Promise<void> {
        const perms = settings.permissions as { users?: Record<string, unknown> } | undefined;
        const users = perms?.users;
        if (!users || typeof users !== 'object') return;
        const ids = Object.keys(users).map(Number).filter((n) => Number.isInteger(n) && n > 0);
        if (ids.length === 0) return;
        const guests = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: memberships.userId })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'guest'), inArray(memberships.userId, ids))),
        );
        if (guests.length === 0) return;
        const next = { ...users };
        for (const g of guests) delete next[String(g.id)];
        settings.permissions = { ...perms, users: next };
    }

    async serialize(
        tenantId: number,
        listIds: number[],
        include: BlueprintInclude,
    ): Promise<ListBlueprint> {
        const sources = await Promise.all(listIds.map((id) => this.lists.get(tenantId, String(id))));
        // key del pack = slug de la lista (único en el workspace).
        const listIdToKey = new Map(sources.map((l) => [l.id, l.slug]));
        // Campos de TODAS las listas del pack (v0.1.171): un lookup/rollup
        // referencia campos de la otra lista → token calificado `{$field,$list}`.
        const fieldsByList = new Map<number, Field[]>();
        const crossList = new Map<number, CrossListFieldRef>();
        for (const list of sources) {
            const fields = await this.fields.listByListId(tenantId, list.id);
            fieldsByList.set(list.id, fields);
            for (const f of fields) crossList.set(f.id, { slug: f.slug, list: list.slug });
        }

        const out: BlueprintList[] = [];
        for (const list of sources) {
            const fields = fieldsByList.get(list.id) ?? [];
            const idToSlug = new Map(fields.map((f) => [f.id, f.slug]));
            const tokenize = (v: unknown, extra: readonly string[] = []): unknown =>
                tokenizeListRefs(tokenizeFieldRefs(v, idToSlug, extra, crossList), listIdToKey);

            // Campo «Botón»: su automatización viaja como índice del blueprint.
            const autos = include.automations ? await this.automations.list(tenantId, String(list.id)) : [];
            const autoIndexById = new Map(autos.map((a, i) => [a.id, i]));
            const fieldConfig = (f: Field): Record<string, unknown> =>
                f.type === 'button'
                    ? portableButtonConfig(f.config, autoIndexById)
                    : f.type === 'approval'
                      ? withoutApprovalFlowRefs(f.config) // C5 — los flujos no viajan.
                      : f.config;

            const settings: Record<string, unknown> = {};
            if (include.settings) {
                for (const [k, v] of Object.entries(list.settings)) {
                    if (!BLUEPRINT_EXCLUDED_SETTINGS.includes(k)) settings[k] = v;
                }
                // C3 — lo compartido con un INVITADO no viaja a la copia: se le
                // compartió ESA lista, no las que se armen a partir de ella.
                await this.dropGuestAccess(tenantId, settings);
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
                    // Fórmulas (A1): las referencias `{#id}` viajan por nombre
                    // interno (`{@slug}`); al guardar la copia vuelven a ser ids.
                    config:
                        f.type === 'formula'
                            ? formulaBlueprintConfig(f.config, (id) => idToSlug.get(id))
                            : (tokenize(fieldConfig(f), ['inputs']) as Record<string, unknown>),
                    is_required: f.is_required,
                    is_unique: f.is_unique,
                    is_indexed: f.is_indexed,
                    description: f.description ?? null,
                })),
                views: [],
                automations: [],
                records: [],
                record_templates: [],
            };

            if (include.views) {
                const views = await this.views.list(tenantId, String(list.id));
                bp.views = views.map((v) => ({
                    name: v.name,
                    type: v.type,
                    config: tokenize(v.config) as Record<string, unknown>,
                    is_default: v.is_default,
                    ...(v.icon ? { icon: v.icon } : {}),
                    ...(v.color ? { color: v.color } : {}),
                }));
            }

            if (include.automations) {
                bp.automations = autos.map((a) => {
                    const trigger: Record<string, unknown> = {};
                    for (const [k, v] of Object.entries(a.trigger_config)) {
                        if (!BLUEPRINT_EXCLUDED_TRIGGER_KEYS.includes(k)) trigger[k] = v;
                    }
                    return {
                        name: a.name,
                        description: a.description,
                        trigger_type: a.trigger_type,
                        // C5 — los flujos de aprobación no viajan (ver withoutApprovalFlowRefs).
                        trigger_config: tokenize(withoutApprovalFlowRefs(trigger)) as Record<string, unknown>,
                        // C6 — la plantilla de registro de una acción viaja por key.
                        actions: tokenize(tokenizeRecordTemplateRefs(withoutApprovalFlowRefs(a.actions))) as unknown[],
                        is_active: a.is_active,
                    };
                });
            }

            // C6 — plantillas de registro y de checklist (van con los ajustes).
            if (include.settings) {
                const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
                    tx
                        .select()
                        .from(recordTemplates)
                        .where(and(eq(recordTemplates.tenantId, tenantId), eq(recordTemplates.listId, list.id)))
                        .orderBy(asc(recordTemplates.position), asc(recordTemplates.id)),
                );
                bp.record_templates = rows.map((r) => ({
                    key: recordTemplateKey(r.id),
                    kind: r.kind === 'checklist' ? 'checklist' : 'record',
                    name: r.name,
                    description: r.description ?? null,
                    icon: r.icon ?? null,
                    color: r.color ?? null,
                    content: portableTemplateContent(readTemplateContent(r.content), (id) => idToSlug.get(id)),
                }));
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
        // A8 — las dependencias entre los registros que viajan (las dos puntas
        // en la tanda): se re-mapean por `key` al materializar.
        const blockedBy = new Map<number, Array<{ key: string; lag_days?: number }>>();
        if (rows.length > 0) {
            const edges = await this.tenantDb.withTenant(tenantId, (tx) =>
                new DependenciesRepository().edgesAmong(
                    tx,
                    tenantId,
                    rows.map((r) => r.id),
                ),
            );
            for (const e of edges) {
                const list = blockedBy.get(e.blocked_id) ?? [];
                list.push(e.lag_days !== 0 ? { key: keyOf(e.blocker_id), lag_days: e.lag_days } : { key: keyOf(e.blocker_id) });
                blockedBy.set(e.blocked_id, list);
            }
        }
        // A9 — los checklists de los registros que viajan (nombre, ítems y casilla).
        const checklistsByRecord =
            rows.length > 0
                ? await this.tenantDb.withTenant(tenantId, (tx) =>
                      new ChecklistsRepository().forRecords(
                          tx,
                          tenantId,
                          rows.map((r) => r.id),
                      ),
                  )
                : new Map();
        return rows.map((r) => {
            const data: Record<string, unknown> = {};
            for (const f of fields) {
                if (!isDataField(f.type) || f.type === 'file') continue;
                const v = (r.data as Record<string, unknown>)[jsonbKeyForField(f.id)];
                if (v !== undefined && v !== null && v !== '') data[f.slug] = v;
            }
            const rec: BlueprintRecord = { key: keyOf(r.id), data };
            if (r.parentId !== null && ids.has(r.parentId)) rec.parent_key = keyOf(r.parentId);
            const deps = blockedBy.get(r.id);
            if (deps && deps.length > 0) rec.blocked_by = deps;
            const cls = checklistsByRecord.get(r.id) ?? [];
            if (cls.length > 0) {
                rec.checklists = cls.slice(0, 20).map((c: { name: string; items: Array<{ text: string; done: boolean }> }) => ({
                    name: c.name,
                    items: c.items.slice(0, 200).map((i) => ({ text: i.text, done: i.done })),
                }));
            }
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

        // B) Campos, en dos pasadas: primero todos los de TODAS las listas
        //    (los `computed`/`lookup`/`rollup` sin su config, porque
        //    referencian campos que quizá no existen aún — incluso de otra
        //    lista del pack, v0.1.171), después la config completa de los
        //    que referencian otros.
        const slugMaps = new Map<string, Map<string, number>>();
        const pendingByList: Array<{ list: List; bl: BlueprintList; pending: Array<{ id: number; config: unknown }> }> = [];
        // Campo «Botón»: las automatizaciones que referencia se re-apuntan al final.
        const buttonAutoRefs: Array<{ list: List; key: string; fieldId: number; refs: Array<{ action: number; auto: number }> }> = [];
        for (const [i, bl] of blueprint.lists.entries()) {
            const list = created[i]!;
            const slugToId = new Map<string, number>();
            const pending: Array<{ id: number; config: unknown }> = [];
            for (const raw of bl.fields) {
                let f = raw;
                let autoRefs: Array<{ action: number; auto: number }> = [];
                if (raw.type === 'button') {
                    const ex = extractButtonAutomationRefs(raw.config);
                    f = { ...raw, config: ex.config };
                    autoRefs = ex.refs;
                    if (buttonLostTemplate(ex.config)) {
                        warnings.push(`El botón «${raw.label}» de «${bl.name}» genera un PDF: elige la plantilla de nuevo (las plantillas de documentos no viajan con la lista).`);
                    }
                }
                // Una fórmula va siempre a la segunda pasada: nombra campos que
                // quizá todavía no existen.
                const hasFieldRefs = f.type === 'formula' || JSON.stringify(f.config).includes('"$field"');
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
                    if (autoRefs.length > 0) buttonAutoRefs.push({ list, key: bl.key, fieldId: field.id, refs: autoRefs });
                } catch (err) {
                    warnings.push(`Campo «${f.label}» de «${bl.name}»: ${message(err)}`);
                }
            }
            slugMaps.set(bl.key, slugToId);
            pendingByList.push({ list, bl, pending });
        }
        for (const { list, bl, pending } of pendingByList) {
            const slugToId = slugMaps.get(bl.key)!;
            for (const p of pending) {
                let config = this.dropDeadListRefs(
                    resolveLists(resolveFieldRefs(p.config, slugToId, slugMaps)) as Record<string, unknown>,
                );
                if (bl.fields.some((x) => x.type === 'button' && slugToId.get(x.slug) === p.id)) config = cleanResolvedButtonConfig(config);
                try {
                    await this.fields.update(tenantId, String(list.id), String(p.id), { config });
                } catch (err) {
                    warnings.push(`Configuración de un campo derivado de «${bl.name}»: ${message(err)}`);
                }
            }
        }

        // B2) C6 — plantillas de registro y de checklist de cada lista (antes de
        //     las automatizaciones: «Crear subtareas desde una plantilla» las
        //     nombra por key).
        const recordTemplateIds = await this.materializeRecordTemplates(tenantId, actorId, blueprint, created, slugMaps, warnings);

        // C) Ajustes, D) vistas, E) automatizaciones.
        const autoIdsByKey = new Map<string, Array<number | null>>();
        for (const [i, bl] of blueprint.lists.entries()) {
            const autoIds: Array<number | null> = [];
            autoIdsByKey.set(bl.key, autoIds);
            const list = created[i]!;
            const slugToId = slugMaps.get(bl.key)!;
            const resolve = (v: unknown): unknown => resolveLists(resolveFieldRefs(v, slugToId, slugMaps));

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
                        icon: v.icon ?? null,
                        color: v.color ?? null,
                    });
                } catch (err) {
                    warnings.push(`Vista «${v.name}» de «${bl.name}»: ${message(err)}`);
                }
            }

            for (const a of bl.automations) {
                autoIds.push(null);
                const slot = autoIds.length - 1;
                const lostTemplate = { value: false };
                const parsed = createAutomationSchema.safeParse({
                    name: a.name,
                    description: a.description,
                    trigger_type: a.trigger_type,
                    trigger_config: resolve(a.trigger_config),
                    actions: resolveRecordTemplateRefs(resolve(a.actions), recordTemplateIds, lostTemplate),
                    is_active: a.is_active,
                });
                if (lostTemplate.value) {
                    warnings.push(`Automatización «${a.name}» de «${bl.name}»: usa una plantilla de registro que no viajó; elígela de nuevo.`);
                }
                if (!parsed.success) {
                    warnings.push(`Automatización «${a.name}» de «${bl.name}»: datos inválidos`);
                    continue;
                }
                try {
                    autoIds[slot] = (await this.automations.create(tenantId, String(list.id), parsed.data)).id;
                } catch (err) {
                    // Incompleta (p. ej. un correo sin «Para») o sobre el límite
                    // de automatizaciones del plan: se crea PAUSADA y se avisa,
                    // en vez de perderla.
                    const code = (err as { getResponse?: () => { code?: unknown } }).getResponse?.()?.code;
                    if (parsed.data.is_active !== false && (code === 'automation_incomplete' || code === 'plan_limit_reached')) {
                        try {
                            autoIds[slot] = (await this.automations.create(tenantId, String(list.id), { ...parsed.data, is_active: false })).id;
                            warnings.push(`Automatización «${a.name}» de «${bl.name}» quedó pausada: ${message(err)}`);
                            continue;
                        } catch {
                            // cae al aviso de abajo
                        }
                    }
                    warnings.push(`Automatización «${a.name}» de «${bl.name}»: ${message(err)}`);
                }
            }
        }

        // E2) Botones que corren una automatización puntual: ahora que la copia
        //     existe, se re-apuntan a ella.
        for (const b of buttonAutoRefs) {
            const ids = autoIdsByKey.get(b.key) ?? [];
            try {
                const current = (await this.fields.listByListId(tenantId, b.list.id)).find((x) => x.id === b.fieldId);
                if (current) {
                    await this.fields.update(tenantId, String(b.list.id), String(b.fieldId), {
                        config: applyButtonAutomationRefs(current.config, b.refs, ids),
                    });
                }
            } catch (err) {
                warnings.push(`Botón de «${b.list.name}»: ${message(err)}`);
            }
        }

        // F) Registros de muestra.
        if (opts.includeRecords) {
            await this.materializeRecords(tenantId, actorId, blueprint, created, slugMaps, keyToListId, warnings);
        }

        // G) Tableros del pack (v0.1.167): cada widget apunta a una lista del
        //    pack y sus campos se resuelven contra ESA lista.
        const dashboardIds: number[] = [];
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
                const created = await this.dashboards.create(tenantId, actorId, {
                    name: d.name,
                    description: d.description,
                    widgets,
                    settings: d.settings,
                });
                dashboardIds.push(created.id);
            } catch (err) {
                warnings.push(`Tablero «${d.name}»: ${message(err)}`);
            }
        }

        this.realtime.lists(tenantId);
        const fieldIds: Record<string, Record<string, number>> = {};
        for (const [key, map] of slugMaps) fieldIds[key] = Object.fromEntries(map);
        return { lists: created, warnings, fieldIds, dashboardIds };
    }

    /**
     * v0.1.208 — Agrega a listas que YA existen lo que falta de un blueprint:
     * campos (por slug: lo que ya está no se toca), vistas y tableros. Lo usa
     * la actualización del pack de una tienda sincronizada (el inventario
     * llegó después de que muchas empresas ya habían conectado su tienda).
     * Mismas dos pasadas que `materialize` para los campos derivados.
     */
    async extend(
        tenantId: number,
        actorId: number,
        addition: ListBlueprint,
        keyToListIdIn: Map<string, number>,
        existing: Map<string, Map<string, number>>,
        /** v0.1.209 — carpeta donde nacen las listas NUEVAS del blueprint. */
        opts: { groupId?: number | null } = {},
    ): Promise<{
        fieldIds: Record<string, Record<string, number>>;
        dashboardIds: number[];
        warnings: string[];
        /** v0.1.209 — key → id de las listas que se crearon (las que no existían). */
        createdLists: Record<string, number>;
    }> {
        const warnings: string[] = [];
        const slugMaps = new Map<string, Map<string, number>>();
        for (const [k, m] of existing) slugMaps.set(k, new Map(m));
        const keyToListId = new Map(keyToListIdIn);
        // v0.1.209 — Las listas que el blueprint trae y todavía no existen se
        // crean PRIMERO (como en `materialize`): un campo de una lista vieja
        // puede apuntar a una nueva (el «En camino» de Productos suma las
        // líneas de compra).
        const createdLists: Record<string, number> = {};
        for (const bl of addition.lists) {
            if (keyToListId.has(bl.key)) continue;
            try {
                const list = await this.lists.create(tenantId, { name: bl.name, icon: bl.icon ?? undefined, color: bl.color ?? undefined });
                if (opts.groupId) await this.lists.update(tenantId, String(list.id), { group_id: opts.groupId });
                keyToListId.set(bl.key, list.id);
                createdLists[bl.key] = list.id;
            } catch (err) {
                warnings.push(`Lista «${bl.name}»: ${message(err)}`);
            }
        }
        const resolveLists = (v: unknown): unknown => resolveListRefs(v, keyToListId);

        const pending: Array<{ listId: number; key: string; name: string; id: number; config: unknown }> = [];
        for (const bl of addition.lists) {
            const listId = keyToListId.get(bl.key);
            if (listId === undefined) continue;
            const slugToId = slugMaps.get(bl.key) ?? new Map<string, number>();
            slugMaps.set(bl.key, slugToId);
            for (const f of bl.fields) {
                if (slugToId.has(f.slug)) continue;
                // Una fórmula va siempre a la segunda pasada: nombra campos que
                // quizá todavía no existen.
                const hasFieldRefs = f.type === 'formula' || JSON.stringify(f.config).includes('"$field"');
                try {
                    const field = await this.fields.create(tenantId, String(listId), {
                        label: f.label,
                        slug: f.slug,
                        type: f.type,
                        config: this.dropDeadListRefs(resolveLists(hasFieldRefs ? {} : f.config) as Record<string, unknown>),
                        is_required: f.is_required,
                        is_unique: f.is_unique,
                        is_indexed: f.is_indexed,
                        description: f.description,
                    });
                    slugToId.set(f.slug, field.id);
                    if (hasFieldRefs) pending.push({ listId, key: bl.key, name: bl.name, id: field.id, config: f.config });
                } catch (err) {
                    warnings.push(`Campo «${f.label}» de «${bl.name}»: ${message(err)}`);
                }
            }
        }
        for (const p of pending) {
            const config = this.dropDeadListRefs(
                resolveLists(resolveFieldRefs(p.config, slugMaps.get(p.key)!, slugMaps)) as Record<string, unknown>,
            );
            try {
                await this.fields.update(tenantId, String(p.listId), String(p.id), { config });
            } catch (err) {
                warnings.push(`Configuración de un campo derivado de «${p.name}»: ${message(err)}`);
            }
        }
        for (const bl of addition.lists) {
            const listId = keyToListId.get(bl.key);
            if (listId === undefined) continue;
            const slugToId = slugMaps.get(bl.key)!;
            // Los ajustes (el campo de título) sólo en las listas que nacieron
            // aquí: una lista existente conserva los suyos.
            if (createdLists[bl.key] !== undefined && Object.keys(bl.settings).length > 0) {
                const settings = resolveLists(resolveFieldRefs(bl.settings, slugToId, slugMaps)) as Record<string, unknown>;
                if (settings.title_field_id === null) delete settings.title_field_id;
                try {
                    await this.lists.update(tenantId, String(listId), { settings });
                } catch (err) {
                    warnings.push(`Ajustes de «${bl.name}»: ${message(err)}`);
                }
            }
            for (const v of bl.views) {
                try {
                    await this.views.create(tenantId, String(listId), {
                        name: v.name,
                        type: v.type,
                        config: resolveLists(resolveFieldRefs(v.config, slugToId, slugMaps)) as Record<string, unknown>,
                        is_default: v.is_default,
                        icon: v.icon ?? null,
                        color: v.color ?? null,
                    });
                } catch (err) {
                    warnings.push(`Vista «${v.name}» de «${bl.name}»: ${message(err)}`);
                }
            }
        }
        const dashboardIds: number[] = [];
        for (const d of addition.dashboards) {
            const widgets: WidgetSpec[] = [];
            for (const wd of d.widgets) {
                const type = widgetTypeSchema.safeParse(wd.type);
                if (!type.success || wd.list === 0) continue;
                const listId = keyToListId.get(wd.list.$list);
                const slugToId = slugMaps.get(wd.list.$list);
                if (listId === undefined || !slugToId) continue;
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
                const created = await this.dashboards.create(tenantId, actorId, {
                    name: d.name,
                    description: d.description,
                    widgets,
                    settings: d.settings,
                });
                dashboardIds.push(created.id);
            } catch (err) {
                warnings.push(`Tablero «${d.name}»: ${message(err)}`);
            }
        }
        this.realtime.lists(tenantId);
        const fieldIds: Record<string, Record<string, number>> = {};
        for (const [key, map] of slugMaps) fieldIds[key] = Object.fromEntries(map);
        return { fieldIds, dashboardIds, warnings, createdLists };
    }

    /**
     * Una relation cuyo `$list` no se pudo resolver (lista fuera del pack y
     * de otro workspace) queda SIN destino: el campo existe, el usuario elige
     * la lista después. Idem `list_id` de un create_record.
     *
     * v0.1.171 — lo mismo con las referencias a CAMPOS de un lookup/rollup
     * (`relation_field_id`/`target_field_id`): una referencia que no resolvió
     * llega como `null` y el schema del tipo la rechazaría con un 400; se
     * quita, así el campo nace a medias (sale vacío) en vez de perderse.
     */
    private dropDeadListRefs(config: Record<string, unknown>): Record<string, unknown> {
        const out = { ...config };
        if (out.target_list_id === null) delete out.target_list_id;
        for (const k of Object.keys(out)) {
            if (out[k] === null && /(^|_)field_id$/.test(k)) delete out[k];
        }
        return out;
    }

    /**
     * C6 — Las plantillas de registro y de checklist del pack, con sus campos
     * re-apuntados a las listas nuevas. Una persona fija que no es del equipo
     * de ESTA empresa (otra empresa, alguien que se fue) se descarta. Devuelve
     * key → id nuevo (para las automatizaciones del pack).
     */
    private async materializeRecordTemplates(
        tenantId: number,
        actorId: number,
        blueprint: ListBlueprint,
        created: List[],
        slugMaps: ReadonlyMap<string, ReadonlyMap<string, number>>,
        warnings: string[],
    ): Promise<Map<string, number>> {
        const out = new Map<string, number>();
        const all = blueprint.lists.flatMap((bl) => bl.record_templates ?? []);
        if (all.length === 0) return out;
        if (!this.recordTemplates) {
            warnings.push('Las plantillas de registro no se copiaron (no están disponibles en este servidor).');
            return out;
        }
        for (const [i, bl] of blueprint.lists.entries()) {
            const list = created[i]!;
            const slugToId = slugMaps.get(bl.key);
            for (const rt of bl.record_templates ?? []) {
                let content = templateContentFromPortable(rt.content, (slug) => slugToId?.get(slug));
                const userIds = [...templateRefs(content).userIds];
                if (userIds.length > 0) {
                    const ok = await this.memberIds(tenantId, userIds);
                    content = dropTemplateUsers(content, ok);
                }
                try {
                    const t = await this.recordTemplates.create(tenantId, actorId, String(list.id), {
                        kind: rt.kind,
                        name: rt.name,
                        description: rt.description,
                        icon: rt.icon,
                        color: rt.color,
                        content,
                    });
                    out.set(rt.key, t.id);
                } catch (err) {
                    warnings.push(`Plantilla de registro «${rt.name}» de «${bl.name}»: ${message(err)}`);
                }
            }
        }
        return out;
    }

    private async memberIds(tenantId: number, ids: number[]): Promise<Set<number>> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: memberships.userId, role: memberships.role })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, ids), isNull(users.disabledAt))),
        );
        return new Set(rows.filter((r) => r.role !== 'client').map((r) => r.id));
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
                        data[jsonbKeyForField(fid)] = sampleValue(value, f.type, actorId);
                    }
                    const row = await this.recordsRepo.insert(tx, {
                        tenantId,
                        listId: list.id,
                        data,
                        createdBy: actorId,
                    });
                    if (rec.key !== undefined) recordIds.set(`${bl.key}:${rec.key}`, row.id);
                    // A9 — los checklists de muestra (sin responsables ni fechas).
                    for (const c of rec.checklists ?? []) {
                        const repo = new ChecklistsRepository();
                        const cl = await repo.insertChecklist(tx, { tenantId, listId: list.id, recordId: row.id, name: c.name, createdBy: actorId > 0 ? actorId : null });
                        await repo.insertItems(
                            tx,
                            cl,
                            c.items.map((i) => ({ text: i.text, assigneeId: null, due: null, done: i.done })),
                            actorId > 0 ? actorId : null,
                        );
                    }
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

            // A8 — dependencias entre los registros de cada lista (por key). Una
            // plantilla escrita a mano podría traer un círculo: se salta con aviso.
            for (const bl of blueprint.lists) {
                const listId = keyToListId.get(bl.key);
                if (listId === undefined) continue;
                const out = new Map<number, number[]>();
                for (const rec of bl.records) {
                    if (!rec.key || !rec.blocked_by?.length) continue;
                    const blocked = recordIds.get(`${bl.key}:${rec.key}`);
                    if (blocked === undefined) continue;
                    for (const dep of rec.blocked_by) {
                        const blocker = recordIds.get(`${bl.key}:${dep.key}`);
                        if (blocker === undefined || blocker === blocked) continue;
                        if (findDependencyCycle(blocker, blocked, (id) => out.get(id) ?? [])) {
                            warnings.push(`Una dependencia de muestra de «${bl.name}» cerraba un círculo y no se creó`);
                            continue;
                        }
                        await tx
                            .insert(recordDependencies)
                            .values({
                                tenantId,
                                blockerListId: listId,
                                blockerRecordId: blocker,
                                blockedListId: listId,
                                blockedRecordId: blocked,
                                lagDays: dep.lag_days ?? 0,
                                createdBy: actorId > 0 ? actorId : null,
                            })
                            .onConflictDoNothing();
                        out.set(blocker, [...(out.get(blocker) ?? []), blocked]);
                    }
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

/**
 * v0.1.286 — Valores RELATIVOS de los registros de muestra de una plantilla:
 * `{ $days: N }` en una fecha es hoy + N días (así "Entregas" y "Próximas
 * entregas" no arrancan vacías con fechas de cuando se escribió la
 * plantilla) y `{ $me: true }` en un campo persona es quien la aplica.
 */
export function sampleValue(value: unknown, type: Field['type'], actorId: number): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const v = value as { $days?: unknown; $me?: unknown };
    if (typeof v.$days === 'number' && (type === 'date' || type === 'datetime')) {
        const ymd = addDaysYmd(new Date().toISOString().slice(0, 10), Math.trunc(v.$days));
        return type === 'date' ? ymd : `${ymd}T15:00:00.000Z`;
    }
    if (v.$me === true && type === 'user') return actorId;
    return value;
}

function newWidgetId(): string {
    return `w-${Math.random().toString(36).slice(2, 10)}`;
}

function message(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
    return String(err);
}

/** Fórmulas (A1): la config de una fórmula para una plantilla (sin ids). */
function formulaBlueprintConfig(config: Record<string, unknown>, slugOf: (id: number) => string | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = { ...config };
    delete out.labels;
    if (typeof config.formula === 'string') out.formula = formulaRefsToSlugs(config.formula, slugOf);
    return out;
}

// ── C6 — plantillas de registro en el blueprint ───────────────────────────

/** Key portable de una plantilla de registro (`rt{id}`). */
export function recordTemplateKey(id: number): string {
    return `rt${id}`;
}

const TEMPLATE_ACTIONS = new Set(['create_subtasks_from_template', 'create_record']);

/**
 * Acciones → la `template_id` de «Crear subtareas desde una plantilla» y de
 * «Crear un registro» pasa a `{ $record_template: key }` (también dentro de
 * si/sino y de un bucle).
 */
export function tokenizeRecordTemplateRefs(actions: unknown): unknown {
    if (!Array.isArray(actions)) return actions;
    return actions.map((a) => {
        if (!a || typeof a !== 'object') return a;
        const spec = a as { type?: unknown; config?: Record<string, unknown> };
        const cfg = { ...(spec.config ?? {}) };
        if (TEMPLATE_ACTIONS.has(String(spec.type)) && Number.isInteger(Number(cfg.template_id)) && Number(cfg.template_id) > 0) {
            cfg.template_id = { $record_template: recordTemplateKey(Number(cfg.template_id)) };
        }
        for (const branch of ['then', 'else', 'actions'] as const) {
            if (Array.isArray(cfg[branch])) cfg[branch] = tokenizeRecordTemplateRefs(cfg[branch]);
        }
        return { ...spec, config: cfg };
    });
}

/** Lo inverso al materializar: key → id nuevo; si no viajó, se quita (y se avisa). */
export function resolveRecordTemplateRefs(actions: unknown, ids: ReadonlyMap<string, number>, lost: { value: boolean }): unknown {
    if (!Array.isArray(actions)) return actions;
    return actions.map((a) => {
        if (!a || typeof a !== 'object') return a;
        const spec = a as { type?: unknown; config?: Record<string, unknown> };
        const cfg = { ...(spec.config ?? {}) };
        const ref = cfg.template_id as { $record_template?: unknown } | undefined;
        if (ref && typeof ref === 'object' && typeof ref.$record_template === 'string') {
            const id = ids.get(ref.$record_template);
            if (id !== undefined) cfg.template_id = id;
            else {
                delete cfg.template_id;
                lost.value = true;
            }
        }
        for (const branch of ['then', 'else', 'actions'] as const) {
            if (Array.isArray(cfg[branch])) cfg[branch] = resolveRecordTemplateRefs(cfg[branch], ids, lost);
        }
        return { ...spec, config: cfg };
    });
}

/** Saca de una plantilla las personas fijas que no están en `ok`. */
function dropTemplateUsers(content: ReturnType<typeof templateContentFromPortable>, ok: ReadonlySet<number>): ReturnType<typeof templateContentFromPortable> {
    const keep = (p: { kind: string; user_id?: number } | null): boolean => !p || p.kind !== 'user' || ok.has(p.user_id ?? 0);
    const values = (vals: typeof content.values): typeof content.values =>
        Object.fromEntries(Object.entries(vals).filter(([, v]) => v.mode !== 'person' || keep(v.person)));
    return {
        ...content,
        values: values(content.values),
        subtasks: content.subtasks.map((s) => ({ ...s, values: values(s.values) })),
        checklists: content.checklists.map((c) => ({
            ...c,
            items: c.items.map((i) => (keep(i.assignee) ? i : { ...i, assignee: null })),
        })),
    };
}
