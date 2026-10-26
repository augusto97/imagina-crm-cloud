import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
    APPROVAL_FIELD_OPTIONS,
    analyzeUserPattern,
    autonumberSettings,
    defaultKindsFor,
    fieldDefaultOf,
    fieldValidationOf,
    isUserWritableType,
    suggestAutonumberPrefix,
    validationKindsFor,
    fieldSlugSchema,
    formatDuration,
    formatPhone,
    AI_INPUT_TYPES,
    evaluateComputed,
    formatEmailFieldValue,
    formulaDependencies,
    formulaDisplayConfig,
    formulaHealth,
    formulaResultTypeOf,
    formulaToDisplay,
    inferFormulaResultType,
    prepareFormula,
    isDataField,
    isStoreField,
    isThroughField,
    jsonbKeyForField,
    LOOKUP_TARGET_TYPES,
    parseFieldConfig,
    readApprovalFlowId,
    resolveTitleFieldId,
    ROLLUP_MINMAX_TYPES,
    ROLLUP_NUMERIC_TYPES,
    readStoreListMarker,
    slugify,
    storeEditableSlugs,
    storeFieldSlug,
    validateFieldValue,
    type CreateFieldInput,
    type Field,
    type FieldType,
    type StoreListMarker,
    type UpdateFieldInput
} from '@imagina-base/shared';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { approvalFlows, lists, memberships, records, users } from '../db/schema';
import { assignmentKeys, type AclSubject, effectivePermissions, scopeWhere } from '../lists/list-acl';
import type { Tx } from '../db/client';
import { pgErrorCode } from '../common/http-exception.filter';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { ListsService } from '../lists/lists.service';
import { ThroughEngine, type ThroughPlan } from '../records/through-fields';
import { withComputedExprs } from '../records/computed-sql';
import { applyRowFormulas, buildFormulaRuntime } from '../records/formula-runtime';
import type { FilterableField } from '../records/query-builder';
import { FieldsRepository, type FieldRow } from './fields.repository';
import { trashRow } from '../trash/trash-ops';
import { assertButtonConfigRefs } from '../buttons/button-config-refs';

/** Un camino posible para un lookup/rollup de una lista (v0.1.170). El shape vive en shared. */
export type { RelationPath } from '@imagina-base/shared';
import type { RelationPath } from '@imagina-base/shared';

@Injectable()
export class FieldsService {
    /** Motor de lookup/rollup (v0.1.170): plain class, sin DI, así los specs
     *  que instancian este service a mano no cambian. */
    readonly through = new ThroughEngine(this);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: FieldsRepository,
        private readonly lists: ListsService,
        private readonly realtime: RealtimeService,
    ) {}

    /** Campo por id en cualquier lista del tenant (para resolver relaciones cruzadas). */
    async findAnyByIdWithinTx(tx: Tx, tenantId: number, fieldId: number): Promise<Field | null> {
        const row = await this.repo.findAnyById(tx, tenantId, fieldId);
        return row ? toField(row) : null;
    }

    /**
     * Planes de los lookup/rollup de una lista (v0.1.170). Camino rápido sin
     * transacción cuando la lista no tiene ninguno — el caso del 99% de las
     * listas no paga nada.
     */
    async throughPlansFor(tenantId: number, listId: number, fields: Field[]): Promise<ThroughPlan[]> {
        if (!ThroughEngine.hasThrough(fields)) return [];
        return this.tenantDb.withTenant(tenantId, (tx) => this.through.plans(tx, tenantId, listId, fields));
    }

    /**
     * Caminos disponibles para un lookup/rollup de la lista: sus propias
     * relaciones (hacia afuera) y las relaciones de otras listas que apuntan
     * a ella (hacia adentro). Es lo que ofrece el editor de config.
     */
    async relationPaths(tenantId: number, listIdOrSlug: string): Promise<RelationPath[]> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const [rows, lists] = await Promise.all([
            this.tenantDb.withTenant(tenantId, (tx) => this.repo.relationFieldsTouching(tx, tenantId, list.id)),
            this.lists.list(tenantId),
        ]);
        const names = new Map(lists.map((l) => [l.id, l.name]));
        const out: RelationPath[] = [];
        for (const r of rows) {
            const targetListId = Number((r.config as { target_list_id?: unknown }).target_list_id ?? 0);
            if (!Number.isInteger(targetListId) || targetListId <= 0) continue;
            const direction = r.listId === list.id ? 'forward' : 'reverse';
            const otherListId = direction === 'forward' ? targetListId : r.listId;
            out.push({
                relation_field_id: r.id,
                relation_label: r.label,
                direction,
                list_id: r.listId,
                list_name: names.get(r.listId) ?? `#${r.listId}`,
                other_list_id: otherListId,
                other_list_name: names.get(otherListId) ?? `#${otherListId}`,
            });
        }
        return out;
    }

    /**
     * Valida la config de un lookup/rollup contra el estado real (v0.1.170):
     * la relación existe, es `relation` y toca esta lista; el campo destino
     * es de la lista del otro lado y de un tipo compatible con la operación.
     * Sólo se valida lo PRESENTE: una config a medias (sin relación todavía)
     * se acepta y el campo sale vacío — igual que un relation sin destino.
     */
    private async assertThroughConfig(
        tx: Tx,
        tenantId: number,
        listId: number,
        type: FieldType,
        config: Record<string, unknown>,
    ): Promise<void> {
        if (type === 'ai') {
            // v0.1.277 — las fuentes de un campo con IA: de ESTA lista y legibles.
            for (const id of (config.inputs as unknown[] | undefined) ?? []) {
                const f = await this.repo.findAnyById(tx, tenantId, Number(id));
                if (!f || f.listId !== listId) {
                    throw new BadRequestException({ code: 'invalid_field_config', message: 'Una de las fuentes no es un campo de esta lista', data: { status: 400, errors: { inputs: 'Inválido' } } });
                }
                if (!AI_INPUT_TYPES.includes(f.type)) {
                    throw new BadRequestException({ code: 'invalid_field_config', message: `«${f.label}» no se puede usar como fuente de la IA`, data: { status: 400, errors: { inputs: 'Inválido' } } });
                }
            }
            return;
        }
        if (!isThroughField(type)) return;
        const fail = (field: string, message: string): never => {
            throw new BadRequestException({
                code: 'invalid_field_config',
                message,
                data: { status: 400, errors: { [field]: message } },
            });
        };
        const relId = Number(config.relation_field_id ?? 0);
        if (!(Number.isInteger(relId) && relId > 0)) return;
        const rel = await this.repo.findAnyById(tx, tenantId, relId);
        if (!rel || rel.type !== 'relation') {
            return fail('relation_field_id', 'La relación elegida no existe o no es un campo de tipo relación');
        }
        const targetListId = Number((rel.config as { target_list_id?: unknown }).target_list_id ?? 0);
        let otherListId: number;
        if (rel.listId === listId && targetListId > 0) otherListId = targetListId;
        else if (targetListId === listId) otherListId = rel.listId;
        else return fail('relation_field_id', 'La relación elegida no conecta con esta lista');

        const targetId = Number(config.target_field_id ?? 0);
        const operation = typeof config.operation === 'string' ? config.operation : '';
        if (type === 'rollup' && operation === 'count') return;
        if (!(Number.isInteger(targetId) && targetId > 0)) return;
        const target = await this.repo.findAnyById(tx, tenantId, targetId);
        if (!target || target.listId !== otherListId) {
            return fail('target_field_id', 'El campo elegido no pertenece a la lista del otro lado de la relación');
        }
        const tType = target.type as FieldType;
        if (type === 'lookup' && !LOOKUP_TARGET_TYPES.includes(tType)) {
            return fail('target_field_id', `Un lookup no puede traer un campo de tipo '${tType}'`);
        }
        if (type === 'rollup') {
            if ((operation === 'sum' || operation === 'avg') && !ROLLUP_NUMERIC_TYPES.includes(tType)) {
                return fail('target_field_id', 'Sumar o promediar requiere un campo numérico');
            }
            if ((operation === 'min' || operation === 'max') && !ROLLUP_MINMAX_TYPES.includes(tType)) {
                return fail('target_field_id', 'Mínimo y máximo requieren un campo numérico o de fecha');
            }
        }
    }

    /**
     * Fórmulas (A1) — la fórmula llega como la escribió la persona (por NOMBRE,
     * o mezclando `{#id}`) y se GUARDA por id. Se revisa entera: sintaxis
     * (con la columna del error), campos que existen y se pueden usar, que no
     * se use a sí misma y que no forme un ciclo con otras fórmulas. También
     * recuerda el nombre de cada campo usado (`labels`): si uno va a la
     * papelera, el error lo nombra. Una fórmula vacía se acepta (el campo
     * sale vacío, como un lookup a medio configurar).
     */
    private async normalizeFormula(
        tx: Tx,
        tenantId: number,
        listId: number,
        selfId: number | null,
        config: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        const text = typeof config.formula === 'string' ? config.formula : '';
        if (text.trim() === '') {
            const out: Record<string, unknown> = { ...config, formula: '' };
            delete out.labels;
            return out;
        }
        const fields = (await this.repo.listByList(tx, tenantId, listId)).map(toField);
        const res = prepareFormula(text, fields, selfId);
        if (!res.ok) {
            throw new BadRequestException({
                code: 'invalid_formula',
                message: res.error.message,
                data: {
                    status: 400,
                    errors: { formula: res.error.message },
                    formula_error: { start: res.error.start, end: res.error.end },
                },
            });
        }
        return { ...config, formula: res.stored, labels: res.labels };
    }

    /**
     * Fórmulas (A1) — lo que la interfaz necesita de cada fórmula de la lista
     * (texto por nombre, tipo de resultado, si compila a SQL y por qué no, si
     * algún campo que usa ya no existe). Derivado en cada lectura.
     */
    private formulaInfos(fields: Field[], plans: ThroughPlan[], tenantId: number): Map<number, NonNullable<Field['formula']>> {
        const out = new Map<number, NonNullable<Field['formula']>>();
        const formulas = fields.filter((f) => f.type === 'formula');
        if (formulas.length === 0) return out;
        const byId = new Map(fields.map((f) => [f.id, f]));
        const targets = new Map(plans.map((p) => [p.field.id, p.targetField]));
        const throughTarget = (id: number) => {
            const t = targets.get(id);
            return t ? { type: t.type, config: t.config } : null;
        };
        const available = withComputedExprs(
            new Map<number, FilterableField>([
                ...fields.map((f): [number, FilterableField] => [f.id, { id: f.id, type: f.type }]),
                ...this.through.filterableFor(plans, tenantId),
            ]),
            fields,
        );
        for (const f of formulas) {
            const cfg = (f.config ?? {}) as Record<string, unknown>;
            const stored = typeof cfg.formula === 'string' ? cfg.formula : '';
            const labels = (cfg.labels && typeof cfg.labels === 'object' ? cfg.labels : {}) as Record<string, string>;
            const ff = available.get(f.id);
            const display = formulaDisplayConfig(f, { fields: byId, throughTarget });
            out.set(f.id, {
                display: formulaToDisplay(stored, fields, labels),
                result_type: formulaResultTypeOf(f, { fields: byId, throughTarget }),
                inferred_type: inferFormulaResultType(stored, { fields: byId, throughTarget }).type,
                display_config: display.config,
                sql: ff?.expr !== undefined,
                sql_reason: ff?.expr !== undefined ? null : (ff?.formulaReason ?? 'la fórmula no se puede llevar a la base'),
                error: formulaHealth(f, fields),
                dependencies: formulaDependencies(cfg),
            });
        }
        return out;
    }

    /**
     * v0.1.300 — Valida y normaliza las reglas comunes de la config
     * (`default_value`, `validation`) contra el campo y su lista:
     *  - el valor por defecto tiene que ser de un tipo que el campo admite y,
     *    si es fijo, un valor válido (se guarda ya normalizado);
     *  - una expresión regular propia pasa el análisis anti-ReDoS
     *    (`analyzeUserPattern`) — un patrón peligroso nunca se guarda;
     *  - mínimo/máximo del tipo correcto y en orden;
     *  - "obligatorio si" apunta a OTRO campo de la misma lista.
     * Lo que no aplica al tipo se descarta (cambiar el tipo no deja reglas
     * huérfanas).
     */
    private async normalizeRules(
        tx: Tx,
        tenantId: number,
        listId: number,
        selfId: number | null,
        type: FieldType,
        config: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        if (!isUserWritableType(type)) return config;
        const fail = (key: string, message: string): never => {
            throw new BadRequestException({
                code: 'invalid_field_config',
                message,
                data: { status: 400, errors: { [key]: message } },
            });
        };
        const out: Record<string, unknown> = { ...config };
        const base = { ...config };
        delete base.validation;
        delete base.default_value;

        const def = fieldDefaultOf(config);
        if (def) {
            if (!defaultKindsFor(type).includes(def.kind)) {
                delete out.default_value;
            } else if (def.kind === 'value') {
                const res = validateFieldValue({ type, config: base, is_required: false }, def.value);
                if (!res.ok) return fail('default_value', `El valor por defecto no es válido: ${res.error}`);
                if (res.value === null) delete out.default_value;
                else out.default_value = { kind: 'value', value: res.value };
            } else {
                out.default_value = { kind: def.kind };
            }
        } else if (config.default_value === null) {
            delete out.default_value;
        }

        const v = fieldValidationOf(config);
        if (v) {
            const kinds = validationKindsFor(type);
            const rule: Record<string, unknown> = {};
            const msg = (k: 'range_message' | 'length_message' | 'format_message'): void => {
                if (typeof v[k] === 'string' && v[k]!.trim() !== '') rule[k] = v[k]!.trim();
            };
            if (kinds.range !== null) {
                const want = kinds.range === 'number' ? 'number' : 'string';
                for (const k of ['min', 'max'] as const) {
                    const val = v[k];
                    if (val === null || val === undefined) continue;
                    if (typeof val !== want) fail(`validation.${k}`, kinds.range === 'number' ? 'El mínimo y el máximo tienen que ser números.' : 'El mínimo y el máximo tienen que ser fechas.');
                    rule[k] = val;
                }
                if (rule.min !== undefined && rule.max !== undefined && (rule.min as number | string) > (rule.max as number | string)) {
                    fail('validation.min', 'El mínimo no puede ser mayor que el máximo.');
                }
                msg('range_message');
            }
            if (kinds.length) {
                if (typeof v.min_length === 'number') rule.min_length = v.min_length;
                if (typeof v.max_length === 'number') rule.max_length = v.max_length;
                if (typeof rule.min_length === 'number' && typeof rule.max_length === 'number' && rule.min_length > rule.max_length) {
                    fail('validation.min_length', 'El largo mínimo no puede ser mayor que el máximo.');
                }
                msg('length_message');
            }
            if (kinds.format && v.format) {
                rule.format = v.format;
                if (v.format === 'regex') {
                    const pattern = typeof v.pattern === 'string' ? v.pattern : '';
                    const check = analyzeUserPattern(pattern);
                    if (!check.ok) fail('validation.pattern', check.reason);
                    rule.pattern = pattern;
                    if (v.pattern_ignore_case === true) rule.pattern_ignore_case = true;
                }
                msg('format_message');
            }
            const ri = v.required_if;
            if (kinds.requiredIf && ri && ri.field_id !== null && ri.field_id !== undefined) {
                if (ri.field_id === selfId) fail('validation.required_if', 'Un campo no puede depender de sí mismo.');
                const other = await this.repo.findById(tx, tenantId, listId, ri.field_id);
                if (!other) fail('validation.required_if', 'El campo de la condición no es de esta lista.');
                rule.required_if = {
                    field_id: ri.field_id,
                    op: ri.op,
                    ...(ri.op !== 'not_empty' && ri.value !== undefined ? { value: ri.value } : {}),
                    ...(typeof ri.message === 'string' && ri.message.trim() !== '' ? { message: ri.message.trim() } : {}),
                };
            }
            if (Object.keys(rule).length > 0) out.validation = rule;
            else delete out.validation;
        } else if (config.validation === null) {
            delete out.validation;
        }
        return out;
    }

    async list(tenantId: number, listIdOrSlug: string): Promise<Field[]> {
        // Este es el listado que consume la UI: aquí sí se marca cuál es el
        // campo TÍTULO (v0.1.136), derivado de `settings.title_field_id` de la
        // lista con fallback al primer texto.
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.listByListId(tenantId, list.id);
        const titleId = resolveTitleFieldId(fields, list.settings);
        // v0.1.170 — los lookup/rollup viajan con su relación RESUELTA
        // (`through`): la UI formatea el valor con el campo del otro lado
        // (moneda, opciones con color, fecha) sin otra request. Derivado en
        // cada lectura, nunca persistido — no puede quedar viejo.
        let throughById = new Map<number, Field['through']>();
        let plans: ThroughPlan[] = [];
        if (ThroughEngine.hasThrough(fields)) {
            const [resolved, lists] = await Promise.all([
                this.throughPlansFor(tenantId, list.id, fields),
                this.lists.list(tenantId),
            ]);
            plans = resolved;
            const names = new Map(lists.map((l) => [l.id, l.name]));
            throughById = new Map(plans.map((p) => [p.field.id, ThroughEngine.info(p, names)]));
        }
        // Fórmulas (A1): el texto por nombre, el tipo de resultado y si filtra.
        const formulaById = this.formulaInfos(fields, plans, tenantId);
        return fields.map((f) => ({
            ...f,
            ...(f.id === titleId ? { is_primary: true } : {}),
            ...(isThroughField(f.type) ? { through: throughById.get(f.id) ?? null } : {}),
            ...(f.type === 'formula' ? { formula: formulaById.get(f.id) ?? null } : {}),
        }));
    }

    /**
     * Igual que `list()` pero con el `list_id` numérico YA resuelto: evita el
     * `lists.get` redundante cuando el caller (p.ej. RecordsService) ya resolvió
     * la lista. Ahorra una transacción con scope por request (perf).
     */
    async listByListId(tenantId: number, listId: number): Promise<Field[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listByList(tx, tenantId, listId),
        );
        return rows.map(toField);
    }

    /**
     * Los campos de TODAS las listas de la empresa, agrupados por lista, en
     * una sola consulta (quien recorre muchas listas a la vez — «Mi trabajo» —
     * no hace una lectura por lista).
     */
    async listByTenantGrouped(tenantId: number): Promise<Map<number, Field[]>> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) => this.repo.listByTenant(tx, tenantId));
        const out = new Map<number, Field[]>();
        for (const row of rows) {
            const f = toField(row);
            const arr = out.get(f.list_id);
            if (arr) arr.push(f);
            else out.set(f.list_id, [f]);
        }
        return out;
    }

    /** Igual que listByListId pero DENTRO de un tx ya abierto (PERF-02). */
    async listByListIdWithinTx(tx: Tx, tenantId: number, listId: number): Promise<Field[]> {
        const rows = await this.repo.listByList(tx, tenantId, listId);
        return rows.map(toField);
    }

    async get(tenantId: number, listIdOrSlug: string, fieldIdOrSlug: string): Promise<Field> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.resolveField(tx, tenantId, listId, fieldIdOrSlug),
        );
        return toField(row);
    }

    /**
     * Valores distintos de un campo, ordenados por frecuencia desc — para el
     * autocomplete de filtros y conditions de automatizaciones. Tipos con
     * valor opaco/enumerado (select, checkbox, fechas, user, file, relation)
     * devuelven `[]`: sus pickers ya conocen las opciones por otra vía.
     * La clave JSONB se deriva del `field.id` numérico (whitelist implícita);
     * el `search` viaja SIEMPRE como parámetro bindeado (regla de oro nº 4).
     */
    async distinctValues(
        tenantId: number,
        listIdOrSlug: string,
        fieldIdOrSlug: string,
        search: string,
        limit: number,
        viewer?: AclSubject,
    ): Promise<Array<{ value: string; count: number }>> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const { row, settings } = await this.tenantDb.withTenant(tenantId, async (tx) => ({
            row: await this.resolveField(tx, tenantId, listId, fieldIdOrSlug),
            settings: ((await tx.select({ settings: lists.settings }).from(lists).where(eq(lists.id, listId)).limit(1))[0]
                ?.settings ?? {}) as Record<string, unknown>,
        }));
        const field = toField(row);
        if (NO_AUTOCOMPLETE_TYPES.has(field.type)) return [];

        // SEC-25 (v0.1.226): el autocompletado es una LECTURA de los valores de
        // la columna. Sin el ACL, alguien que no ve el campo (o sólo ve sus
        // registros) obtenía todos los valores distintos con su frecuencia.
        let scope: SQL | undefined;
        if (viewer) {
            const perms = effectivePermissions(settings, viewer);
            if (perms.fields_hidden.includes(field.slug)) return [];
            scope = scopeWhere(perms.view, viewer, assignmentKeys(settings));
        }

        const key = jsonbKeyForField(field.id);
        const value = sql<string>`${records.data} ->> ${key}`;
        const cap = Math.min(Math.max(Math.trunc(limit) || 50, 1), 100);
        const needle = search.trim() === '' ? null : `%${escapeLike(search.trim())}%`;

        return this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ value, count: sql<number>`count(*)::int` })
                .from(records)
                .where(
                    and(
                        eq(records.tenantId, tenantId),
                        eq(records.listId, listId),
                        isNull(records.deletedAt),
                        scope,
                        sql`${records.data} ->> ${key} is not null`,
                        sql`${records.data} ->> ${key} <> ''`,
                        needle === null ? undefined : sql`${records.data} ->> ${key} ilike ${needle}`,
                    ),
                )
                // Ordinales (`GROUP BY 1`): la clave llega como parámetro
                // bindeado y Postgres no unifica dos placeholders idénticos.
                .groupBy(sql`1`)
                .orderBy(sql`2 desc, 1`)
                .limit(cap),
        );
    }

    async create(tenantId: number, listIdOrSlug: string, input: CreateFieldInput): Promise<Field> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const listId = list.id;
        let config = safeConfig(input.type, input.config);
        // v0.1.300 — ID automático: sin prefijo elegido, el de la lista («TIC»).
        if (input.type === 'autonumber' && config.prefix === undefined) {
            config = { ...config, prefix: suggestAutonumberPrefix(list.name) };
        }

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            await this.assertThroughConfig(tx, tenantId, listId, input.type, config);
            if (input.type === 'button') await assertButtonConfigRefs(tx, tenantId, listId, null, config);
            if (input.type === 'approval') config = await normalizeApprovalFieldConfig(tx, tenantId, listId, config);
            config = await this.normalizeRules(tx, tenantId, listId, null, input.type, config);
            if (input.type === 'formula') config = await this.normalizeFormula(tx, tenantId, listId, null, config);
            const slug = await this.resolveNewSlug(tx, tenantId, listId, input.label, input.slug);
            const position = await this.repo.nextPosition(tx, tenantId, listId);
            return this.repo
                .insert(tx, {
                    tenantId,
                    listId,
                    slug,
                    label: input.label,
                    type: input.type,
                    config,
                    isRequired: input.is_required ?? false,
                    isUnique: input.is_unique ?? false,
                    isIndexed: input.is_indexed ?? false,
                    description: input.description ?? null,
                    position,
                })
                .catch((err: unknown) => {
                    // Doble envío: dos altas simultáneas con el mismo slug pasan
                    // el chequeo previo y la segunda choca con el índice único.
                    throw pgErrorCode(err) === '23505' ? slugConflict(slug) : err;
                })
                .then(async (inserted) => {
                    // v0.1.300 — los registros que YA existían se numeran en el orden
                    // en que se crearon (los nuevos los numera el trigger).
                    if (input.type === 'autonumber') await numberExistingRecords(tx, tenantId, listId, inserted.id, config);
                    return inserted;
                });
        });
        this.realtime.fields(tenantId, listId);
        // v0.1.170 — un campo DERIVADO nuevo (computed/lookup/rollup) cambia
        // cómo se leen los records: sin esto la tabla mostraba "—" en la
        // columna nueva hasta recargar. v0.1.300 — y el ID automático numera los
        // registros que ya existían.
        if (!isDataField(input.type) || input.type === 'autonumber') this.realtime.records(tenantId, listId);
        return toField(row);
    }

    async update(
        tenantId: number,
        listIdOrSlug: string,
        fieldIdOrSlug: string,
        patch: UpdateFieldInput,
        /** `internal`: la sincronización con la tienda (puede tocar sus propias columnas). */
        opts: { internal?: boolean } = {},
    ): Promise<Field> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        if (!opts.internal) await this.assertStoreFieldPatch(tenantId, listId, fieldIdOrSlug, patch);

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.resolveField(tx, tenantId, listId, fieldIdOrSlug);

            const changes: Partial<typeof import('../db/schema').fields.$inferInsert> = {};
            if (patch.label !== undefined) changes.label = patch.label;
            if (patch.is_required !== undefined) changes.isRequired = patch.is_required;
            if (patch.is_unique !== undefined) changes.isUnique = patch.is_unique;
            if (patch.position !== undefined) changes.position = patch.position;

            // Conversión de tipo: valida compatibilidad, arma la config del
            // tipo NUEVO y migra los datos existentes en la misma tx.
            const toType = patch.type as FieldType | undefined;
            if (toType !== undefined && toType !== current.type) {
                assertConvertible(current.type as FieldType, toType);
                let newConfig = safeConfig(toType, patch.config ?? {});
                // A select/multi_select sin opciones: se generan de los
                // valores DISTINTOS existentes (mismo espíritu que la
                // auto-expansión del import) — así nada se pierde.
                const fromType = current.type as FieldType;
                const bridge: BridgeContext = {
                    fromConfig: current.config,
                    userNames: fromType === 'user' ? await memberNames(tx, tenantId) : new Map(),
                };
                if (
                    (toType === 'select' || toType === 'multi_select')
                    && !(Array.isArray((newConfig as { options?: unknown[] }).options) && (newConfig as { options: unknown[] }).options.length > 0)
                ) {
                    const oldOptions = (current.config as { options?: unknown }).options;
                    if ((fromType === 'select' || fromType === 'multi_select') && Array.isArray(oldOptions)) {
                        // Entre selects las opciones (con sus etiquetas y
                        // colores) son las mismas: generarlas de los valores
                        // perdería las etiquetas.
                        newConfig = { ...newConfig, options: oldOptions };
                    } else {
                        // Las opciones nacen del TEXTO que la persona leía
                        // (una casilla da Sí/No, una persona su nombre), no
                        // del valor crudo guardado.
                        const distinct = await collectDistinctValues(tx, tenantId, listId, current.id, fromType);
                        const texts = [...new Set(distinct.map((v) => bridgeValue(fromType, 'text', v, bridge)).filter(
                            (v): v is string => typeof v === 'string' && v !== '',
                        ))];
                        newConfig = { ...newConfig, options: texts.map((v) => ({ value: v, label: v })) };
                    }
                }
                newConfig = await this.normalizeRules(tx, tenantId, listId, current.id, toType, newConfig);
                if (toType === 'formula') newConfig = await this.normalizeFormula(tx, tenantId, listId, current.id, newConfig);
                changes.type = toType;
                changes.config = newConfig;
                // Fórmulas (A1): de fórmula a un tipo con datos se ESCRIBE el valor
                // calculado de cada registro (lo que se veía); de calculado a
                // fórmula no hay datos que mover.
                if (fromType === 'formula') await this.materializeFormula(tx, tenantId, listId, current.id, toType, newConfig);
                else if (toType !== 'formula') await migrateFieldData(tx, tenantId, listId, current.id, fromType, toType, newConfig, bridge);
            } else if (patch.config !== undefined) {
                changes.config = safeConfig(current.type as FieldType, patch.config);
                await this.assertThroughConfig(tx, tenantId, listId, current.type as FieldType, changes.config);
                if (current.type === 'button') await assertButtonConfigRefs(tx, tenantId, listId, current.id, changes.config);
                if (current.type === 'approval') changes.config = await normalizeApprovalFieldConfig(tx, tenantId, listId, changes.config);
                changes.config = await this.normalizeRules(tx, tenantId, listId, current.id, current.type as FieldType, changes.config);
                if (current.type === 'formula') changes.config = await this.normalizeFormula(tx, tenantId, listId, current.id, changes.config);
            }
            if (patch.is_indexed !== undefined) {
                changes.isIndexed = patch.is_indexed;
            }
            if (patch.description !== undefined) {
                changes.description = patch.description;
            }
            if (patch.slug !== undefined && patch.slug !== current.slug) {
                if (await this.repo.slugExists(tx, tenantId, listId, patch.slug, current.id)) {
                    throw slugConflict(patch.slug);
                }
                changes.slug = patch.slug;
            }

            const updated = await this.repo.update(tx, tenantId, listId, current.id, changes);
            if (!updated) throw fieldNotFound(fieldIdOrSlug);
            return updated;
        });
        // Un cambio de schema (config/slug/required) afecta cómo se leen los
        // records → invalidamos fields Y records de la lista.
        this.realtime.fields(tenantId, listId);
        this.realtime.records(tenantId, listId);
        return toField(row);
    }

    async remove(
        tenantId: number,
        listIdOrSlug: string,
        fieldIdOrSlug: string,
        /**
         * `internal`: lo borra el sistema (migraciones del pack de la tienda) —
         * de verdad, sin pasar por la papelera. Si no, va a la papelera con
         * sus valores intactos en los registros (las claves `f{id}` quedan).
         */
        opts: { internal?: boolean; userId?: number | null } = {},
    ): Promise<{ id: number; label: string }> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const marker = opts.internal ? null : await this.storeMarker(tenantId, listId);
        const current = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.resolveField(tx, tenantId, listId, fieldIdOrSlug);
            if (marker && isStoreField(marker, current.id)) {
                throw new BadRequestException({
                    code: 'store_field_locked',
                    message: `«${current.label}» viene de ${marker.store_name ? `la tienda ${marker.store_name}` : 'la tienda'}: no se puede borrar mientras se sincronice.`,
                    data: { status: 400 },
                });
            }
            if (opts.internal) await this.repo.remove(tx, tenantId, listId, current.id);
            else await trashRow(tx, 'fields', tenantId, current.id, opts.userId ?? null);
            return current;
        });
        this.realtime.fields(tenantId, listId);
        this.realtime.records(tenantId, listId);
        return { id: current.id, label: current.label };
    }

    async reorder(tenantId: number, listIdOrSlug: string, fieldIds: number[]): Promise<Field[]> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const rows = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const existing = await this.repo.existingIds(tx, tenantId, listId, fieldIds);
            if (existing.length !== fieldIds.length || new Set(fieldIds).size !== fieldIds.length) {
                throw new BadRequestException({
                    code: 'invalid_reorder',
                    message: 'field_ids debe contener ids únicos que pertenezcan a la lista',
                    data: { status: 400 },
                });
            }
            await this.repo.applyOrder(tx, tenantId, listId, fieldIds);
            return this.repo.listByList(tx, tenantId, listId);
        });
        this.realtime.fields(tenantId, listId);
        return rows.map(toField);
    }

    /**
     * Agrega UNA opción a un select/multi_select (v0.1.214). Es lo que usa el
     * «Crear "x"» del selector de opciones de la tabla y la ficha: el plugin lo
     * tenía (`POST …/options`) y la nube nunca lo implementó, así que crear
     * una opción al vuelo fallaba. Una opción que ya existe no se duplica.
     *
     * En una lista de la tienda sólo las categorías y etiquetas aceptan una
     * opción nueva, y sólo si la empresa habilitó editarlas: la opción nueva se
     * CREA en WooCommerce al guardar el producto.
     */
    async appendOption(
        tenantId: number,
        listIdOrSlug: string,
        fieldIdOrSlug: string,
        input: { value: string; label?: string; color?: string },
    ): Promise<Field> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const current = await this.tenantDb.withTenant(tenantId, (tx) => this.resolveField(tx, tenantId, listId, fieldIdOrSlug));
        if (current.type !== 'select' && current.type !== 'multi_select') {
            throw new BadRequestException({
                code: 'invalid_field_type',
                message: 'Sólo los campos de selección tienen opciones.',
                data: { status: 400 },
            });
        }
        const typed = input.value.trim().slice(0, 190);
        let value = typed;
        if (value === '') {
            throw new BadRequestException({ code: 'invalid_option', message: 'La opción no puede estar vacía.', data: { status: 400 } });
        }
        const marker = await this.storeMarker(tenantId, listId);
        if (marker) {
            const slug = storeFieldSlug(marker, current.id);
            const open = slug !== null && ['categorias', 'etiquetas'].includes(slug) && marker.write_back && storeEditableSlugs(marker).includes(slug);
            if (slug !== null && !open) {
                throw new BadRequestException({
                    code: 'store_field_locked',
                    message: `«${current.label}» viene de la tienda: sus opciones las define WooCommerce.`,
                    data: { status: 400 },
                });
            }
            // El valor de una categoría/etiqueta de la tienda es su SLUG: la nueva
            // nace con el que le va a dar WordPress, así al volver de la tienda
            // es la misma opción (y no una copia con otro valor).
            if (slug !== null) value = wpTermSlug(value) || value;
        }
        const config = (current.config ?? {}) as Record<string, unknown>;
        const options = Array.isArray(config.options) ? (config.options as Array<Record<string, unknown>>) : [];
        if (options.some((o) => String(o.value) === value)) return this.get(tenantId, String(listId), String(current.id));
        const label = (input.label ?? '').trim().slice(0, 190) || typed;
        const color = typeof input.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color : undefined;
        return this.update(
            tenantId,
            String(listId),
            String(current.id),
            { config: { ...config, options: [...options, { value, label, ...(color ? { color } : {}) }] } },
            { internal: true },
        );
    }

    /** El marcador de lista de tienda (v0.1.213), o null si es una lista común. */
    private async storeMarker(tenantId: number, listId: number): Promise<StoreListMarker | null> {
        const list = await this.lists.get(tenantId, String(listId));
        return readStoreListMarker(list.settings);
    }

    /**
     * Una columna que viene de la tienda (v0.1.213) sólo cambia de NOMBRE,
     * descripción, posición o índice: cambiarle el tipo, las opciones o el
     * nombre interno haría que la próxima sincronización no la reconozca (o
     * escriba valores que el campo ya no acepta).
     */
    private async assertStoreFieldPatch(
        tenantId: number,
        listId: number,
        fieldIdOrSlug: string,
        patch: UpdateFieldInput,
    ): Promise<void> {
        const marker = await this.storeMarker(tenantId, listId);
        if (!marker) return;
        const current = await this.tenantDb.withTenant(tenantId, (tx) => this.resolveField(tx, tenantId, listId, fieldIdOrSlug));
        if (!isStoreField(marker, current.id)) return;
        const allowed = new Set(['label', 'description', 'position', 'is_indexed']);
        const touched = Object.entries(patch).filter(([k, v]) => v !== undefined && !allowed.has(k));
        // Reenviar el MISMO valor (un form que manda todo) no es un cambio.
        const same: Record<string, unknown> = {
            type: current.type,
            slug: current.slug,
            is_required: current.isRequired,
            is_unique: current.isUnique,
        };
        const real = touched.filter(([k, v]) => {
            if (k in same) return v !== same[k];
            if (k === 'config') return canonicalJson(v) !== canonicalJson(current.config ?? {});
            return true;
        });
        if (real.length === 0) return;
        throw new BadRequestException({
            code: 'store_field_locked',
            message: `«${current.label}» viene de la tienda: sólo se le puede cambiar el nombre y la descripción.`,
            data: { status: 400 },
        });
    }

    /**
     * Fórmulas (A1) — al convertir una fórmula en un campo con datos (texto,
     * número, fecha…), cada registro guarda el valor que la fórmula calculaba:
     * un número como número, en un texto lo que se LEÍA (con el formato de la
     * empresa). Por lotes, dentro de la misma transacción del cambio de tipo.
     */
    private async materializeFormula(
        tx: Tx,
        tenantId: number,
        listId: number,
        fieldId: number,
        toType: FieldType,
        config: Record<string, unknown>,
    ): Promise<void> {
        const fields = (await this.repo.listByList(tx, tenantId, listId)).map(toField);
        const self = fields.find((f) => f.id === fieldId);
        if (!self) return;
        const plans = await this.through.plans(tx, tenantId, listId, fields);
        const rt = await buildFormulaRuntime(tx, tenantId, fields, plans);
        if (!rt) return;
        const byId = new Map(fields.map((f) => [f.id, f]));
        const targets = new Map(plans.map((p) => [p.field.id, p.targetField]));
        const display = formulaDisplayConfig(self, {
            fields: byId,
            throughTarget: (id) => {
                const t = targets.get(id);
                return t ? { type: t.type, config: t.config } : null;
            },
        });
        const format = {
            number_format: rt.env.numberFormat ?? 'comma_dot',
            date_format: rt.env.dateFormat ?? 'ymd',
            time_format: rt.env.timeFormat ?? 'h24',
            timezone: rt.env.timeZone,
        } as const;
        const displayField = { type: display.type === 'checkbox' ? 'checkbox' : display.type, config: display.config };
        const key = jsonbKeyForField(fieldId);
        const spec = { type: toType, config: { ...config, validation: undefined }, is_required: false };
        const computed = fields.filter((f) => f.type === 'computed');
        let cursor = 0;
        for (;;) {
            const batch = await tx
                .select({
                    id: records.id,
                    data: records.data,
                    createdAt: records.createdAt,
                    updatedAt: records.updatedAt,
                    createdBy: records.createdBy,
                    updatedBy: records.updatedBy,
                })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), isNull(records.deletedAt), sql`${records.id} > ${cursor}`))
                .orderBy(records.id)
                .limit(CONVERT_BATCH);
            if (batch.length === 0) break;
            cursor = batch[batch.length - 1]!.id;
            const rows = await this.through.attach(tx, tenantId, plans, batch.map((r) => ({ ...r, data: r.data as Record<string, unknown> })), fields);
            const changes: Array<{ id: number; val: unknown }> = [];
            for (const r of rows) {
                const data = { ...r.data };
                for (const c of computed) data[jsonbKeyForField(c.id)] = evaluateComputed(c, fields, (id) => data[jsonbKeyForField(id)] ?? null);
                const value = applyRowFormulas(fields, { data }, rt).data[key];
                if (value === null || value === undefined) continue;
                const textual = toType === 'text' || toType === 'long_text';
                const bridged = textual ? formatEmailFieldValue(displayField as never, value, format) : value;
                const res = validateFieldValue(spec, bridged);
                if (res.ok && res.value !== null) changes.push({ id: r.id, val: res.value });
            }
            if (changes.length > 0) {
                await tx.execute(sql`
                    UPDATE records AS r
                    SET data = jsonb_set(r.data, ARRAY[${key}::text], v.val)
                    FROM jsonb_to_recordset(${JSON.stringify(changes)}::jsonb) AS v(id bigint, val jsonb)
                    WHERE r.tenant_id = ${tenantId} AND r.list_id = ${listId} AND r.id = v.id`);
            }
            if (batch.length < CONVERT_BATCH) break;
        }
    }

    /** Resuelve el list_id validando pertenencia al tenant (404 si no existe). */
    private async resolveListId(tenantId: number, listIdOrSlug: string): Promise<number> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        return list.id;
    }

    private async resolveField(
        tx: Tx,
        tenantId: number,
        listId: number,
        fieldIdOrSlug: string,
    ): Promise<FieldRow> {
        const row = /^\d+$/.test(fieldIdOrSlug)
            ? await this.repo.findById(tx, tenantId, listId, Number(fieldIdOrSlug))
            : await this.repo.findBySlug(tx, tenantId, listId, fieldIdOrSlug);
        if (!row) throw fieldNotFound(fieldIdOrSlug);
        return row;
    }

    private async resolveNewSlug(
        tx: Tx,
        tenantId: number,
        listId: number,
        label: string,
        provided?: string,
    ): Promise<string> {
        if (provided !== undefined) {
            if (await this.repo.slugExists(tx, tenantId, listId, provided)) {
                throw slugConflict(provided);
            }
            return provided;
        }
        const base = ensureFieldSlug(slugify(label));
        for (let i = 0; i < 1000; i++) {
            const candidate = i === 0 ? base : ensureFieldSlug(`${base.slice(0, 60)}_${i + 1}`);
            if (!(await this.repo.slugExists(tx, tenantId, listId, candidate))) {
                return candidate;
            }
        }
        throw new ConflictException('No se pudo generar un slug de campo disponible');
    }
}

/**
 * Tipos SIN autocomplete de valores (paridad con el plugin): el valor es
 * opaco (file, relation, user), booleano o enumerado por config (select).
 */
const NO_AUTOCOMPLETE_TYPES: ReadonlySet<string> = new Set([
    'select',
    'multi_select',
    'checkbox',
    'date',
    'datetime',
    'file',
    'relation',
    'user',
    'computed',
    'lookup',
    'rollup',
    'time_tracked',
    'formula',
    'checklist_progress',
    // v0.1.158 — numéricos puros: sugerir "90" no ayuda a nadie (el
    // teléfono SÍ queda con autocomplete: buscar por prefijo es útil).
    'rating',
    'percent',
    'duration',
    'button',
    // C5 — el estado de una aprobación (catálogo fijo).
    'approval',
]);

/**
 * C5 — Config de un campo «Aprobación»: el flujo tiene que ser de ESTA lista
 * (o ninguno = la última solicitud de cualquier flujo) y las opciones son
 * SIEMPRE el catálogo de estados (etiqueta y color), así la tabla, los filtros
 * y el agrupado lo pintan como una selección sin depender de lo que mande el
 * navegador.
 */
async function normalizeApprovalFieldConfig(
    tx: Tx,
    tenantId: number,
    listId: number,
    config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const flowId = readApprovalFlowId(config);
    if (flowId !== null) {
        const [row] = await tx
            .select({ id: approvalFlows.id })
            .from(approvalFlows)
            .where(and(eq(approvalFlows.tenantId, tenantId), eq(approvalFlows.listId, listId), eq(approvalFlows.id, flowId)))
            .limit(1);
        if (!row) {
            throw new BadRequestException({
                code: 'invalid_approval_flow_ref',
                message: 'El flujo de aprobación elegido no existe en esta lista.',
                data: { status: 400, errors: { approval_flow_id: 'No es de esta lista' } },
            });
        }
    }
    return { approval_flow_id: flowId, options: APPROVAL_FIELD_OPTIONS.map((o) => ({ ...o })) };
}

/** Escapa los metacaracteres de LIKE/ILIKE (`%`, `_`, `\`). */
function escapeLike(s: string): string {
    return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function toField(row: FieldRow): Field {
    return {
        id: row.id,
        list_id: row.listId,
        slug: row.slug,
        label: row.label,
        type: row.type as FieldType,
        config: row.config,
        is_required: row.isRequired,
        is_unique: row.isUnique,
        is_indexed: row.isIndexed,
        // El título se DERIVA de los settings de la lista (ver `list()`); en
        // las lecturas internas no hace falta y queda en false.
        is_primary: false,
        position: row.position,
        created_at: row.createdAt.toISOString(),
        description: row.description ?? null,
    };
}

/** Valida la config contra el schema del tipo; 400 legible si no cuadra. */
function safeConfig(type: FieldType, config: unknown): Record<string, unknown> {
    try {
        return parseFieldConfig(type, config);
    } catch {
        throw new BadRequestException({
            code: 'invalid_field_config',
            message: `Config inválida para un campo de tipo '${type}'`,
            data: { status: 400, errors: { config: 'No cumple el schema del tipo' } },
        });
    }
}

function ensureFieldSlug(slug: string): string {
    return fieldSlugSchema.safeParse(slug).success ? slug : `campo_${slug}`.slice(0, 63);
}

function slugConflict(slug: string): ConflictException {
    return new ConflictException({
        code: 'slug_taken',
        message: `El slug '${slug}' ya existe en esta lista`,
        data: { status: 409, errors: { slug: 'Ya está en uso' } },
    });
}

function fieldNotFound(idOrSlug: string): NotFoundException {
    return new NotFoundException({
        code: 'field_not_found',
        message: `Campo '${idOrSlug}' no encontrado`,
        data: { status: 404 },
    });
}

// ─── Conversión de tipo (v0.1.85) ────────────────────────────────────────

/**
 * Tipos NO convertibles: su almacenamiento/semántica difiere del JSONB plano
 * (relation vive en la tabla `relations`, computed jamás se persiste, file
 * son IDs de attachments que dejarían huérfanos silenciosos).
 */
const NON_CONVERTIBLE: readonly FieldType[] = [
    'computed', 'relation', 'file', 'lookup', 'rollup', 'ai', 'time_tracked',
    // A9 — progreso del checklist (se calcula de los ítems).
    'checklist_progress',
    // v0.1.300 — columnas de sistema (no tienen datos propios).
    'created_at', 'updated_at', 'created_by', 'updated_by',
    // Campo «Botón»: no guarda valor (sólo su config).
    'button',
    // C5 — «Aprobación»: su valor sale de las solicitudes, no de `data`.
    'approval',
];

/** Fórmulas (A1): a qué tipos se convierte una fórmula (guardando el valor calculado). */
const FORMULA_TARGETS: readonly FieldType[] = [
    'text', 'long_text', 'number', 'currency', 'percent', 'duration', 'rating', 'date', 'datetime', 'checkbox', 'email', 'url', 'phone',
];

function assertConvertible(from: FieldType, to: FieldType): void {
    // Fórmulas (A1): un CALCULADO se puede pasar a fórmula (la interfaz arma la
    // fórmula equivalente; los dos se calculan al leer, no hay datos que
    // mover). Una fórmula pasa a un tipo con datos guardando lo calculado.
    // Cualquier otro tipo NO se vuelve fórmula: se perderían sus datos.
    if (to === 'formula') {
        if (from === 'computed') return;
        throw new BadRequestException({
            code: 'type_not_convertible',
            message: 'Un campo con datos no se puede convertir en fórmula (se perderían los valores guardados): crea un campo «Fórmula» nuevo. Sólo un campo «Calculado» se convierte en fórmula.',
            data: { status: 400 },
        });
    }
    if (from === 'formula') {
        if (FORMULA_TARGETS.includes(to)) return;
        throw new BadRequestException({
            code: 'type_not_convertible',
            message: 'Una fórmula se puede convertir en texto, número, moneda, porcentaje, duración, calificación, fecha, fecha y hora, casilla, email, enlace o teléfono (conserva el valor calculado).',
            data: { status: 400 },
        });
    }
    if (NON_CONVERTIBLE.includes(from) || NON_CONVERTIBLE.includes(to)) {
        throw new BadRequestException({
            code: 'type_not_convertible',
            message: `No se puede convertir entre '${from}' y '${to}' — los tipos relación, archivo, calculado, lookup, rollup, con IA, botón, aprobación y las columnas de sistema no admiten conversión.`,
            data: { status: 400 },
        });
    }
    // v0.1.300 — a «ID automático» no se convierte: numerar los registros pisaría
    // los valores que el campo ya tiene. Se crea un campo nuevo y numera solo.
    if (to === 'autonumber') {
        throw new BadRequestException({
            code: 'type_not_convertible',
            message: 'Un campo no se puede convertir en «ID automático»: crea un campo «ID automático» nuevo y numerará solo los registros que ya existen.',
            data: { status: 400 },
        });
    }
    // Desde el ID automático, sólo a texto: el número se conserva tal cual
    // (y a partir de ahí se puede editar a mano).
    if (from === 'autonumber' && to !== 'text' && to !== 'long_text') {
        throw new BadRequestException({
            code: 'type_not_convertible',
            message: 'Un «ID automático» sólo se puede convertir en texto (conserva los números ya dados).',
            data: { status: 400 },
        });
    }
}

const CONVERT_BATCH = 1000;

/** Destinos donde el valor se guarda como el TEXTO que el usuario leía. */
const TEXTUAL_TARGETS: readonly FieldType[] = ['text', 'long_text', 'select', 'multi_select'];

/**
 * Valores DISTINTOS no vacíos del campo (hasta 50) — para auto-generar las
 * options al convertir a select/multi_select sin perder datos. Fuente
 * multi_select: se desanidan los elementos del array.
 */
async function collectDistinctValues(
    tx: Tx,
    tenantId: number,
    listId: number,
    fieldId: number,
    fromType: FieldType,
): Promise<string[]> {
    const key = jsonbKeyForField(fieldId);
    const valueExpr =
        fromType === 'multi_select'
            ? sql<string | null>`jsonb_array_elements_text(${records.data} -> ${key})`
            : sql<string | null>`${records.data} ->> ${key}`;
    const rows = await tx
        .selectDistinct({ v: valueExpr })
        .from(records)
        .where(
            and(
                eq(records.tenantId, tenantId),
                eq(records.listId, listId),
                isNull(records.deletedAt),
                // Forma función de `data ? key` — el operador `?` choca con
                // los placeholders de algunos drivers.
                sql`jsonb_exists(${records.data}, ${key})`,
            ),
        )
        .limit(50);
    return rows
        .map((r) => r.v)
        .filter((v): v is string => typeof v === 'string' && v !== '');
}

/**
 * Migra los valores existentes al tipo nuevo, por lotes keyset dentro de la
 * MISMA tx del cambio de schema: cada valor pasa por un puente de coerción
 * (fechas recortadas/extendidas, arrays↔escalares, números↔strings) y por
 * `validateFieldValue` del tipo destino; lo inválido se LIMPIA (la celda
 * queda vacía — jamás datos corruptos con el tipo equivocado).
 */
async function migrateFieldData(
    tx: Tx,
    tenantId: number,
    listId: number,
    fieldId: number,
    fromType: FieldType,
    toType: FieldType,
    config: Record<string, unknown>,
    bridge: BridgeContext,
): Promise<void> {
    const key = jsonbKeyForField(fieldId);
    // v0.1.300 — sin las reglas: convertir conserva lo que se puede convertir; una
    // validación nueva no vacía datos viejos (se exige al editarlos).
    const spec = { type: toType, config: { ...config, validation: undefined }, is_required: false };
    let cursor = 0;
    for (;;) {
        // Sólo el valor de ESTE campo (no el `data` entero de cada fila).
        const batch = await tx
            .select({ id: records.id, raw: sql<unknown>`${records.data} -> ${key}` })
            .from(records)
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.listId, listId),
                    isNull(records.deletedAt),
                    sql`${records.id} > ${cursor}`,
                    sql`jsonb_exists(${records.data}, ${key})`,
                ),
            )
            .orderBy(records.id)
            .limit(CONVERT_BATCH);
        if (batch.length === 0) break;
        const changes: Array<{ id: number; del: boolean; val?: unknown }> = [];
        for (const row of batch) {
            cursor = row.id;
            const raw = row.raw;
            if (raw === null || raw === undefined) continue;
            const bridged = bridgeValue(fromType, toType, raw, bridge);
            const result = validateFieldValue(spec, bridged);
            const next = result.ok ? result.value : null;
            // Solo escribimos si el valor CAMBIA (la mayoría de conversiones
            // compatibles —ej. text→select con options de los valores— no
            // tocan ninguna fila).
            if (JSON.stringify(next) === JSON.stringify(raw)) continue;
            changes.push(next === null ? { id: row.id, del: true } : { id: row.id, del: false, val: next });
        }
        // UNA sentencia por lote (antes, un UPDATE por fila: 100k registros
        // eran 100k idas a la base y la conversión tardaba minutos).
        if (changes.length > 0) {
            await tx.execute(sql`
                UPDATE records AS r
                SET data = CASE WHEN v.del THEN r.data - ${key}::text ELSE jsonb_set(r.data, ARRAY[${key}::text], v.val) END,
                    updated_at = now()
                FROM jsonb_to_recordset(${JSON.stringify(changes)}::jsonb) AS v(id bigint, del boolean, val jsonb)
                WHERE r.tenant_id = ${tenantId} AND r.list_id = ${listId} AND r.id = v.id`);
        }
        if (batch.length < CONVERT_BATCH) break;
    }
}

/**
 * Puente de coerción entre tipos ANTES del validador destino: cubre los
 * saltos razonables que el validador (estricto por diseño) rechazaría.
 */
export interface BridgeContext {
    /** Config del campo ANTES de convertir (las etiquetas de sus opciones). */
    fromConfig: Record<string, unknown>;
    /** id → nombre de los miembros (sólo al convertir un campo persona). */
    userNames: Map<number, string>;
}

/** Nombre (o email) de cada miembro de la empresa, por id. */
async function memberNames(tx: Tx, tenantId: number): Promise<Map<number, string>> {
    const rows = await tx
        .select({ id: users.id, name: users.name, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.tenantId, tenantId));
    return new Map(rows.map((u) => [u.id, (u.name ?? '').trim() || u.email]));
}

function optionLabel(config: Record<string, unknown>, value: unknown): string {
    const options = (config as { options?: unknown }).options;
    if (Array.isArray(options)) {
        for (const o of options) {
            if (o && typeof o === 'object' && String((o as { value?: unknown }).value) === String(value)) {
                const label = (o as { label?: unknown }).label;
                if (typeof label === 'string' && label !== '') return label;
            }
        }
    }
    return String(value);
}

export function bridgeValue(from: FieldType, to: FieldType, raw: unknown, ctx?: BridgeContext): unknown {
    const toText = to === 'text' || to === 'long_text';
    // v0.1.255 — a texto se escribe lo que la persona LEÍA, no el valor
    // guardado: la etiqueta de la opción (no `pendiente_pago`), el nombre de
    // la persona (no `3`) y Sí/No (no `true`/`false`).
    if (from === 'checkbox' && TEXTUAL_TARGETS.includes(to)) {
        const on = raw === true || raw === 1 || raw === 'true' || raw === '1';
        const text = on ? 'Sí' : 'No';
        return to === 'multi_select' ? [text] : text;
    }
    if (from === 'user' && TEXTUAL_TARGETS.includes(to)) {
        const id = Number(raw);
        const text = (Number.isInteger(id) && ctx?.userNames.get(id)) || String(raw);
        return to === 'multi_select' ? [text] : text;
    }
    if ((from === 'select' || from === 'multi_select') && toText && ctx) {
        const items = Array.isArray(raw) ? raw : [raw];
        return items.map((v) => optionLabel(ctx.fromConfig, v)).join(', ');
    }
    // multi_select destino: un escalar se envuelve en lista.
    if (to === 'multi_select' && !Array.isArray(raw)) {
        return raw === '' ? null : [String(raw)];
    }
    // multi_select origen → escalar: texto largo une con coma; select/resto
    // toman la primera opción.
    if (from === 'multi_select' && Array.isArray(raw) && to !== 'multi_select') {
        if (to === 'text' || to === 'long_text') return raw.map((x) => String(x)).join(', ');
        return raw.length > 0 ? String(raw[0]) : null;
    }
    // v0.1.158 — los tipos nuevos guardan valores DERIVADOS del texto que
    // ve el usuario: un `phone` mostrado como `+57 300 111 2233` es la
    // cadena canónica, y una `duration` mostrada como `1h 30m` son 90.
    // Al convertir a texto hay que escribir lo que la persona LEÍA, no el
    // valor crudo (90 no le dice nada a nadie).
    if (from === 'phone' && TEXTUAL_TARGETS.includes(to) && typeof raw === 'string') {
        return formatPhone(raw);
    }
    if (from === 'duration' && TEXTUAL_TARGETS.includes(to)) {
        return formatDuration(raw);
    }
    if (from === 'percent' && TEXTUAL_TARGETS.includes(to) && typeof raw === 'number') {
        return `${raw}%`;
    }
    if (to === 'date' && typeof raw === 'string' && raw.length > 10) return raw.slice(0, 10);
    if (to === 'datetime' && typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return `${raw} 00:00:00`;
    }
    // Destinos string-like: cualquier escalar se vuelve texto (5000 → "5000").
    if (
        (to === 'text' || to === 'long_text' || to === 'select' || to === 'email' || to === 'url')
        && typeof raw !== 'string'
        && (typeof raw === 'number' || typeof raw === 'boolean')
    ) {
        return String(raw);
    }
    return raw;
}

/** JSON con claves ordenadas: JSONB reordena las claves, así que el orden no es un cambio. */
function canonicalJson(v: unknown): string {
    return JSON.stringify(v, (_k, val: unknown) =>
        val && typeof val === 'object' && !Array.isArray(val)
            ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
            : val,
    );
}

/** El slug que WordPress le da a un término (`sanitize_title`, lo esencial). */
export function wpTermSlug(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 190);
}

/**
 * v0.1.300 — Numera los registros VIVOS de la lista que todavía no tienen ID, en el
 * orden en que se crearon (con el reinicio por año en el reloj de la
 * empresa), y deja el contador de cada período en el siguiente número. UNA
 * sentencia: un `UPDATE … FROM` con `row_number()` y el upsert de los
 * contadores sobre lo que devolvió (los registros nuevos los numera el
 * trigger `imcrm_records_autonumber`, que toma la misma fila del contador).
 */
export async function numberExistingRecords(
    tx: Tx,
    tenantId: number,
    listId: number,
    fieldId: number,
    config: Record<string, unknown>,
): Promise<void> {
    const key = jsonbKeyForField(fieldId);
    const settings = autonumberSettings(config);
    const cfg = JSON.stringify(config);
    // La zona sólo hace falta si reinicia por año (y se valida contra el
    // catálogo de Postgres: una zona inválida no puede tirar el alta).
    const tz = settings.yearly
        ? sql`(SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = z.v) THEN z.v ELSE 'UTC' END
               FROM (SELECT coalesce(nullif(t.settings #>> '{format,timezone}', ''), 'UTC') AS v FROM tenants t WHERE t.id = ${tenantId}) z)`
        : sql`'UTC'`;
    const period = settings.yearly ? sql`extract(year FROM (r.created_at AT TIME ZONE ${tz}))::integer` : sql`0`;
    // El trigger descarta los números que no puso él; acá los pone esta
    // sentencia (en orden de creación), así que se le pide que los respete.
    await tx.execute(sql`select set_config('app.keep_autonumber', 'on', true)`);
    await tx.execute(sql`
        WITH ranked AS (
            SELECT r.id, ${period} AS period,
                   row_number() OVER (PARTITION BY ${period} ORDER BY r.created_at, r.id) AS rn
            FROM records r
            WHERE r.tenant_id = ${tenantId} AND r.list_id = ${listId} AND r.deleted_at IS NULL
              AND coalesce(r.data ->> ${key}, '') = ''
        ),
        upd AS (
            UPDATE records r
            SET data = jsonb_set(r.data, ARRAY[${key}::text], to_jsonb(imcrm_autonumber_text(${cfg}::jsonb, ${settings.start}::bigint + ranked.rn - 1, ranked.period)))
            FROM ranked
            WHERE r.id = ranked.id
            RETURNING ranked.period
        )
        INSERT INTO autonumber_counters (tenant_id, field_id, period, next_value)
        SELECT ${tenantId}, ${fieldId}, upd.period, ${settings.start}::bigint + count(*)
        FROM upd
        GROUP BY upd.period
        ON CONFLICT (field_id, period) DO UPDATE SET next_value = GREATEST(autonumber_counters.next_value, EXCLUDED.next_value)`);
    await tx.execute(sql`select set_config('app.keep_autonumber', 'off', true)`);
}
