import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import {
    APPROVAL_STATUSES,
    applyFieldDefaults,
    checkRequiredIf,
    collectMentionedUserIds,
    collectMentionedTeamIds,
    doneRuleFor,
    effectiveEndMs,
    FALLBACK_TIME_ZONE,
    isSystemField,
    isUserWritableType,
    systemFieldBaseType,
    readDependencySettings,
    RESCHEDULE_MAX_DEPTH,
    RESCHEDULE_MAX_RECORDS,
    shiftDateValue,
    type BulkEditTarget,
    evaluateComputed,
    isDataField,
    isValidTimeZone,
    jsonbKeyForField,
    readStoreListMarker,
    richDocToPlainText,
    sameBulkValue,
    sanitizeRichDoc,
    storeCellAccess,
    storeValueError,
    validateFieldValue,
    type BatchCreateRecordsResult,
    type BatchDeleteRecordsResult,
    type BatchUpdateRecordsResult,
    type CreateRecordInput,
    type Field,
    type FilterGroup,
    type FilterNode,
    type List,
    type ListRecordsQuery,
    type RecordDto,
    type RichDoc,
    type Role,
    type UpdateRecordDescriptionInput,
    type UpdateRecordInput,
} from '@imagina-base/shared';
import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { ActivityService, computeDiff } from '../activity/activity.service';
import type { Tx } from '../db/client';
import { disableJitForTx, groupKeyHasSubquery } from '../db/no-jit';
import { memberships, mentions, records, teams } from '../db/schema';
import { AutomationDispatcher, type AutomationChain } from '../automations/automation-dispatcher.service';
import {
    andWhere,
    assignmentKeys,
    effectivePermissions,
    guestExtraHidden,
    hiddenFieldsFor,
    listRowInScope,
    scopeWhere,
    withDependentComputed,
} from '../lists/list-acl';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { assertNotStoreManaged } from '../lists/store-guard';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { compileFilterTree, descriptionSearchFilterable, fieldTypedExpr, type FilterableField, type QueryClock } from './query-builder';
import { RecurrencesService } from '../recurrences/recurrences.service';
import { RecordChangeHub } from './record-change-hub';
import { NotifyHub } from '../notifications/notify-hub';
import { RecordsRepository, type RecordListRow, type RecordRow } from './records.repository';
import { pendingApprovalCounts } from '../approvals/approval-sql';
import { withComputedExprs } from './computed-sql';
import { applyRowFormulas, buildFormulaRuntime, type FormulaRuntime } from './formula-runtime';
import type { ThroughPlan } from './through-fields';
import { RelationsRepository } from './relations.repository';
import { DependenciesRepository } from './dependencies.repository';
import { ChecklistsRepository } from '../checklists/checklists.repository';
import { compileSearch } from './search-sql';
import { relatedScopeSql, type RelatedScope } from './related-scope';
import { BillingService } from '../billing/billing.service';
import { calendarPicksSql, readPicks, type CalendarPick, type CalendarSqlSource } from './calendar-sql';
import type { AclExtras } from '../lists/list-acl';

/** A8 — un registro que corrió la reprogramación en cadena. */
interface ShiftedRecord {
    id: number;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
}

/**
 * C6 — Un alta validada y lista para escribir (ver `prepareCreate`): el
 * registro y las subtareas de una plantilla se preparan antes y se escriben
 * juntos en una transacción.
 */
export interface PreparedCreate {
    list: List;
    fields: Field[];
    data: Record<string, unknown>;
    relValues: Array<{ field: Field; targetListId: number; ids: number[] }>;
    parentId: number | null;
}

/** Quién ejecuta la acción — para el scoping de "own records" (CONTRACT §6). */
export interface Actor extends AclExtras {
    userId: number;
    role: Role;
}

export interface RecordsPage {
    data: RecordDto[];
    meta: {
        next_cursor: string | null;
        /** v0.1.187 — sólo con `page` o `with_total`: total con el mismo where. */
        total?: number;
        page?: number;
        per_page?: number;
        total_pages?: number;
    };
}

/** Contexto de lectura de una lista para quien pide (ver `readContext`). */
interface ReadContext {
    list: List;
    fields: Field[];
    plans: ThroughPlan[];
    hiddenIds: Set<number>;
    fieldsById: Map<number, FilterableField>;
    scopeW: SQL | undefined;
    clock: QueryClock;
    /** Fórmulas (A1): formato, zona y nombres para calcularlas (sólo si hay). */
    formula?: FormulaRuntime;
    /**
     * C3 — quien lee es un INVITADO: la fila no lleva los indicadores de la
     * operación interna (bloqueantes, aprobaciones pendientes, checklists).
     */
    guest?: boolean;
}

/** B2 — Lo que `readScoped` le da a quien arma su propia lectura (ver la carga de trabajo). */
export interface ReadScope {
    list: List;
    fields: Field[];
    /** Campos que quien pide no ve (tampoco se filtran ni se suman). */
    hiddenIds: ReadonlySet<number>;
    /** Campos filtrables y sus expresiones (derivados incluidos), sin los ocultos. */
    fieldsById: Map<number, FilterableField>;
    clock: QueryClock;
    /** Filtros + búsqueda (sobre campos visibles) + alcance de lectura del ACL. */
    where: (q: Pick<ListRecordsQuery, 'filter_tree' | 'search'>) => SQL | undefined;
}

@Injectable()
export class RecordsService {
    private readonly logger = new Logger(RecordsService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: RecordsRepository,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly realtime: RealtimeService,
        private readonly activity: ActivityService,
        private readonly automations: AutomationDispatcher,
        private readonly relationsRepo: RelationsRepository,
        // Optional + al final: los specs que instancian RecordsService a mano
        // (posicional) siguen funcionando sin el módulo de recurrencias.
        @Optional() private readonly recurrences?: RecurrencesService,
        @Optional() private readonly changes?: RecordChangeHub,
        // v0.1.228 (SEC-31) — límite de registros del plan aquí y no sólo en el
        // controller: el asistente IA/MCP, "actualizar desde archivo" y otros
        // caminos internos crean por este método y se salteaban el tope.
        @Optional() private readonly billing?: BillingService,
        // v0.1.263 — "hoy/esta semana" de los filtros en el reloj de la empresa.
        @Optional() private readonly timeZones?: TenantTimeZones,
        // v0.1.276 — avisos de menciones en la descripción.
        @Optional() private readonly notify?: NotifyHub,
        // A8 — dependencias (bloqueantes abiertos del listado y reprogramación
        // en cadena). Sin estado: sin DI (specs posicionales) se crea uno.
        @Optional() depsRepo?: DependenciesRepository,
    ) {
        this.deps = depsRepo ?? new DependenciesRepository();
    }

    private readonly deps: DependenciesRepository;
    /** A9 — progreso de los checklists (el «☑ 3/8» del listado). Sin estado. */
    private readonly checklists = new ChecklistsRepository();

    private async clock(tenantId: number, tx?: Tx): Promise<QueryClock> {
        return { now: new Date(), timeZone: this.timeZones ? await this.timeZones.orUtc(tenantId, tx) : FALLBACK_TIME_ZONE };
    }

    /**
     * Fórmulas (A1): lo necesario para calcularlas en ESTA lectura. Sin campos
     * fórmula no consulta nada.
     */
    private async formulaRuntime(tx: Tx, tenantId: number, listId: number, fields: Field[], plans?: ThroughPlan[]): Promise<FormulaRuntime | undefined> {
        if (!fields.some((f) => f.type === 'formula')) return undefined;
        const resolved = plans ?? (await this.fields.through.plans(tx, tenantId, listId, fields));
        return buildFormulaRuntime(tx, tenantId, fields, resolved);
    }

    async create(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        input: CreateRecordInput,
        /**
         * `planChecked`: quien llama YA verificó el límite del plan para el lote
         * entero (`assertCanCreateRecords(n)`). Sin esto, duplicar 5.000
         * registros contaba la tabla 5.000 veces (O(N²), auditoría v0.1.252).
         *
         * `automationChain`: el alta la hizo una automatización (dispara las de
         * la lista destino con la cadena — tope y sin auto-disparo).
         * `lenientRequired`: una automatización crea aunque falte un campo
         * obligatorio (el motor lo avisa en su log); comportamiento histórico.
         */
        opts: { planChecked?: boolean; automationChain?: AutomationChain; lenientRequired?: boolean; silent?: boolean } = {},
    ): Promise<RecordDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const listId = list.id;
        this.assertCanCreate(list, actor);
        // El tope del plan se verifica DENTRO de la transacción del alta (ver
        // assertRecordRoomInTx): aquí sólo se lee cuál es.
        const planCap = opts.planChecked ? null : ((await this.billing?.recordLimit(tenantId)) ?? null);
        const fields = await this.fields.listByListId(tenantId, listId);
        const prep = await this.prepareCreate(tenantId, actor, list, fields, input, { lenientRequired: opts.lenientRequired === true });

        const { row, enriched, rt } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            if (planCap && this.billing) await this.billing.assertRecordRoomInTx(tx, tenantId, planCap);
            const inserted = await this.insertPreparedInTx(tx, tenantId, actor, prep);
            // v0.1.170 — lookup/rollup sólo para el DTO (la actividad y las
            // automatizaciones ven los datos persistidos).
            return {
                row: inserted,
                enriched: await this.withThrough(tx, tenantId, listId, fields, [inserted]),
                rt: await this.formulaRuntime(tx, tenantId, listId, fields),
            };
        });
        // `silent` (v0.1.294): el alta en lote avisa UNA vez al final.
        if (!opts.silent) this.realtime.records(tenantId, listId);
        this.afterCreate(tenantId, actor, prep, row, opts.automationChain ? { automationChain: opts.automationChain } : {});
        const relFieldIds = fields.filter((f) => f.type === 'relation').map((f) => f.id);
        return toRecord(withComputed(fields, enriched[0] ?? row, rt), {
            ...byFieldToKeys(relFieldIds, undefined),
            ...relationsToMap(prep.relValues),
        });
    }

    /**
     * C6 — El chequeo del tope de registros del plan para `additional` altas
     * DENTRO de la transacción que las escribe (con las altas de la empresa en
     * fila, ver `assertRecordRoomInTx`). null = sin tope. El tope se lee aquí,
     * ANTES de abrir la transacción (leerlo adentro tomaría otra conexión).
     */
    async planRoomChecker(tenantId: number, additional: number): Promise<((tx: Tx) => Promise<void>) | null> {
        const cap = (await this.billing?.recordLimit(tenantId)) ?? null;
        const billing = this.billing;
        if (!cap || !billing) return null;
        return (tx) => billing.assertRecordRoomInTx(tx, tenantId, cap, additional);
    }

    /**
     * Lista de una tienda (sus registros nacen en WooCommerce) o rol sin
     * permiso de crear en ESTA lista → error. Lo comparten el alta normal y la
     * de una plantilla (C6).
     */
    assertCanCreate(list: List, actor: Actor): void {
        assertNotStoreManaged(list, 'create');
        // ACL por lista: el rol debe tener create habilitado para esta lista.
        if (!effectivePermissions(list.settings, actor).create) {
            throw new ForbiddenException({
                code: 'forbidden_create',
                message: 'Tu rol no puede crear registros en esta lista',
                data: { status: 403 },
            });
        }
    }

    /**
     * C6 — Prepara un alta SIN escribir: valores por defecto, validación y
     * «obligatorio si». El alta desde una plantilla prepara el registro y sus
     * subtareas primero (un dato inválido corta antes de escribir nada) y
     * después las escribe todas en UNA transacción con `insertPreparedInTx`.
     */
    async prepareCreate(
        tenantId: number,
        actor: Actor,
        list: List,
        fields: Field[],
        input: CreateRecordInput,
        opts: { lenientRequired?: boolean } = {},
    ): Promise<PreparedCreate> {
        // C3 — un invitado no escribe en lo que no ve.
        assertGuestWritable(list.settings, fields, actor, input.data);
        // Los campos `relation` NO viven en el JSONB: se separan del payload
        // y se sincronizan a la tabla `relations` dentro del mismo tx.
        const rel = splitRelationValues(fields, input.data);
        // v0.1.300 — valores por defecto: lo que NO viene en el alta (fijo, hoy en
        // el reloj de la empresa, quien lo crea, una opción).
        const clock = await this.clock(tenantId);
        const withDefaults = applyFieldDefaults(fields, rel.data, { now: clock.now, timeZone: clock.timeZone, userId: actor.userId });
        const data = this.validateData(fields, withDefaults, { partial: opts.lenientRequired === true });
        // v0.1.300 — "obligatorio si otro campo vale X" mira el registro entero.
        if (opts.lenientRequired !== true) assertRequiredIf(fields, data);
        return { list, fields, data, relValues: rel.values, parentId: input.parent_id ?? null };
    }

    /**
     * Escribe un alta ya preparada dentro de una transacción abierta: unicidad,
     * padre (subtareas de un nivel), fila, vínculos y actividad. Sin efectos
     * fuera de la base: el llamador avisa con `afterCreate` tras el commit.
     * `parentId` pisa el de la preparación (la subtarea de una plantilla nace
     * colgando del registro que se creó en la misma transacción).
     */
    async insertPreparedInTx(tx: Tx, tenantId: number, actor: Actor, prep: PreparedCreate, parentIdOverride?: number | null): Promise<RecordRow> {
        const listId = prep.list.id;
        await this.assertUniqueInTx(tx, tenantId, listId, prep.fields, prep.data, null);
        // Subtareas (v0.1.132): el padre tiene que existir, ser de ESTA
        // lista y ser de primer nivel — un solo nivel de anidado.
        const parentId = parentIdOverride !== undefined ? parentIdOverride : prep.parentId;
        if (parentId !== null) {
            const parent = await this.repo.findById(tx, tenantId, listId, parentId);
            if (!parent) throw recordNotFound(parentId);
            if (parent.parentId !== null) {
                throw new BadRequestException({
                    code: 'subtask_depth',
                    message: 'Una subtarea no puede tener subtareas',
                    data: { status: 400 },
                });
            }
        }
        const inserted = await this.repo.insert(tx, {
            tenantId,
            listId,
            data: prep.data,
            parentId,
            createdBy: actor.userId,
        });
        await this.syncRelations(tx, tenantId, inserted.id, prep.relValues);
        await this.activity.logInTx(tx, {
            tenantId,
            listId,
            recordId: inserted.id,
            // v0.1.275 — el sistema (0: formulario público, motor) no es
            // una persona: la actividad queda sin autor, no "usuario #0".
            userId: actor.userId > 0 ? actor.userId : null,
            action: 'record_created',
            diff: computeDiff({}, inserted.data),
        });
        return inserted;
    }

    /**
     * Lo que pasa DESPUÉS del commit de un alta: las automatizaciones de
     * «Cuando se crea un registro» y el aviso en proceso (avisos, tiendas).
     * El realtime lo decide el llamador (un lote avisa una vez).
     */
    afterCreate(
        tenantId: number,
        actor: Actor,
        prep: Pick<PreparedCreate, 'list' | 'fields'>,
        row: Pick<RecordRow, 'id' | 'data'>,
        opts: { automationChain?: AutomationChain } = {},
    ): void {
        const listId = prep.list.id;
        this.automations.dispatch({
            tenantId,
            listId,
            recordId: row.id,
            trigger: 'record_created',
            after: row.data,
            ...(opts.automationChain ? { chain: opts.automationChain } : {}),
        });
        // v0.1.209 — también las altas (las compras completan una línea nueva).
        this.changes?.emit({ tenantId, listId, recordId: row.id, before: {}, after: row.data, kind: 'created', actorId: actor.userId, list: prep.list, fields: prep.fields });
    }

    /**
     * `outerTx` (v0.1.266): leer DENTRO de una transacción ya abierta — el motor
     * de automatizaciones arma un PDF en medio de un run y tiene que ver lo que
     * escribieron las acciones anteriores del mismo run (todavía sin commit).
     */
    async get(tenantId: number, actor: Actor, listIdOrSlug: string, id: number, outerTx?: Tx): Promise<RecordDto> {
        const list = outerTx
            ? await this.lists.getWithinTx(outerTx, tenantId, listIdOrSlug)
            : await this.lists.get(tenantId, listIdOrSlug);
        const run = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
            outerTx ? fn(outerTx) : this.tenantDb.withTenant(tenantId, fn);
        const guest = actor.role === 'guest';
        const { row, fields, hiddenKeys, relMap, relFieldIds, subtaskCount, blockedOpen, approvalPending, checklist, rt } = await run(async (tx) => {
            const found = await this.repo.findById(tx, tenantId, list.id, id);
            const fields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
            const r = found ? (await this.withThrough(tx, tenantId, list.id, fields, [found]))[0] ?? found : null;
            // Igual que el listado: la ficha sabe cuántas subtareas tiene (el
            // aviso de borrado y la sección «Subtareas» lo leen de aquí).
            const counts = r && (r.parentId ?? null) === null
                ? await this.repo.subtaskCounts(tx, tenantId, [r.id])
                : new Map<number, number>();
            const rels = r
                ? await this.relationsRepo.batchTargets(
                      tx,
                      tenantId,
                      [r.id],
                      fields.filter((f) => f.type === 'relation').map((f) => f.id),
                  )
                : new Map<number, Map<number, number[]>>();
            const plans = await this.fields.through.plans(tx, tenantId, list.id, fields);
            const restricted = await this.fields.through.restrictedFor(tx, tenantId, plans, actor);
            const hiddenKeys = hiddenKeysWithDerived(fields, list.settings, actor, restricted);
            const hiddenIds = new Set([...hiddenKeys].map((k) => Number(k.slice(1))));
            return {
                row: r,
                fields,
                hiddenKeys,
                relMap: rels,
                relFieldIds: fields.filter((f) => f.type === 'relation').map((f) => f.id),
                subtaskCount: r ? counts.get(r.id) ?? 0 : 0,
                // C3 — un invitado no ve los indicadores de la operación interna.
                blockedOpen: r && !guest ? (await this.openBlockers(tx, tenantId, fields, hiddenIds, [r.id])).get(r.id) ?? 0 : 0,
                approvalPending: r && !guest ? (await pendingApprovalCounts(tx, [r.id])).get(r.id) ?? 0 : 0,
                checklist: r && !guest ? (await this.checklists.progressOf(tx, tenantId, [r.id])).get(r.id) : undefined,
                rt: r ? await this.formulaRuntime(tx, tenantId, list.id, fields, plans) : undefined,
            };
        });
        // ACL: si el scope no alcanza esta fila, 404 (no filtramos info).
        if (!row || !this.aclCanReach(list, actor, 'view', row)) throw recordNotFound(id);
        return stripHidden(
            {
                ...toRecord(withComputed(fields, row, rt), byFieldToKeys(relFieldIds, relMap.get(row.id)), subtaskCount),
                blocked_by_open: blockedOpen,
                approval_pending: approvalPending,
                ...withChecklist(checklist),
            },
            hiddenKeys,
        );
    }

    /**
     * De estas personas, ¿quiénes pueden VER el registro? El mismo criterio que
     * `get` (la fila existe y el alcance del rol la alcanza), pero leyendo la
     * lista y la fila UNA vez para todos — los avisos antes hacían un `get`
     * completo por destinatario.
     */
    async viewersOf(tenantId: number, listId: number, recordId: number, actors: readonly Actor[]): Promise<Set<number>> {
        if (actors.length === 0) return new Set();
        const found = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const list = await this.lists.getWithinTx(tx, tenantId, String(listId)).catch(() => null);
            if (!list) return null;
            const row = await this.repo.findById(tx, tenantId, list.id, recordId);
            return row ? { list, row } : null;
        });
        if (!found) return new Set();
        return new Set(actors.filter((a) => this.aclCanReach(found.list, a, 'view', found.row)).map((a) => a.userId));
    }

    async list(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        query: ListRecordsQuery,
        /**
         * v0.1.230 — sólo los vinculados a un registro por una relación, en
         * cualquiera de los dos sentidos (bloques de la ficha). Interno: no
         * viaja como query param.
         */
        opts: { related?: RelatedScope; tx?: Tx } = {},
    ): Promise<RecordsPage> {
        const run = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
            opts.tx ? fn(opts.tx) : this.tenantDb.withTenant(tenantId, fn);
        // PERF-02: lista + fields + records se resuelven en UNA sola
        // transacción con scope (antes eran 3 → 3× BEGIN/COMMIT + entrada de
        // scope por request).
        // v0.1.187 — paginación por PÁGINA: `page` fija el offset y pide el
        // total (lo que necesita la tabla: "1–200 de 2.500"). El cursor
        // keyset sigue siendo el camino de los clientes que recorren todo.
        const byPage = query.page !== undefined;
        const pageOffset = byPage ? (query.page! - 1) * query.limit : undefined;
        const wantTotal = byPage || query.with_total === true;
        const { page, hasMore, lastId, total } = await run(async (tx) => {
            const ctx = await this.readContext(tx, tenantId, actor, listIdOrSlug);
            // v0.1.209 — una selección de filas y los vinculados a un registro.
            const pickW = andWhere(
                pickWhere(tenantId, ctx.fields, query),
                opts.related ? relatedScopeSql(tenantId, opts.related) : undefined,
            );
            const where = andWhere(this.readWhere(ctx, query), pickW);

            // Orden por CAMPO (`sort=field_{id}:{dir},...`): expresiones
            // tipadas whitelisted (regla de oro nº 4) con NULLS LAST. Los
            // tipos sin orden útil (relation/file/computed) se descartan.
            const orderBy = parseFieldSort(query.sort, ctx.fieldsById, ctx.fields);
            const sorted = orderBy.length > 0;
            // Subtareas: por defecto sólo primer nivel. `parent` trae las de
            // un registro; `include_subtasks` devuelve todo plano (export).
            // Una selección por ids o los vinculados a un registro son filas
            // CONCRETAS: pueden ser subtareas, no se filtran por nivel.
            const parent =
                query.parent !== undefined
                    ? query.parent
                    : query.include_subtasks === true || query.ids !== undefined || query.related_to !== undefined || opts.related !== undefined
                        ? ('any' as const)
                        : ('roots' as const);
            const listed = await this.repo.list(tx, tenantId, ctx.list.id, {
                parent,
                where,
                // Con sort por campo el keyset por id no aplica: el cursor
                // se reinterpreta como OFFSET (opaco para el cliente).
                cursor: sorted || byPage ? undefined : query.cursor,
                offset: byPage ? pageOffset : sorted ? (query.cursor ?? 0) : undefined,
                orderBy: sorted ? orderBy : undefined,
                limit: query.limit,
                dir: query.sort_dir,
            });
            const total = wantTotal ? await this.repo.count(tx, tenantId, ctx.list.id, { parent, where }) : undefined;
            // Pedimos limit+1 para detectar página siguiente sin contar todo;
            // la fila de más no se hidrata.
            const pageRows = listed.slice(0, query.limit);
            return {
                page: await this.hydrate(tx, tenantId, ctx, pageRows),
                hasMore: listed.length > query.limit,
                lastId: pageRows[pageRows.length - 1]?.id,
                total,
            };
        });

        const nextCursor = hasMore
            ? byPage
                ? String((pageOffset ?? 0) + page.length)
                : query.sort !== undefined && query.sort !== ''
                    ? String((query.cursor ?? 0) + page.length)
                    : String(lastId)
            : null;
        const pageMeta =
            total === undefined
                ? {}
                : {
                      total,
                      page: query.page ?? 1,
                      per_page: query.limit,
                      total_pages: Math.max(1, Math.ceil(total / query.limit)),
                  };
        return { data: page, meta: { next_cursor: nextCursor, ...pageMeta } };
    }

    /**
     * v0.1.286 — filas de VARIOS grupos de la vista agrupada en UNA consulta
     * (`row_number() over (partition by <grupo>)`), con el mismo filtro,
     * búsqueda, ACL, orden y regla de subtareas (sólo primer nivel) que el
     * listado plano. Antes la vista corría un listado completo POR GRUPO
     * abierto (agrupar por fecha sobre 100k registros: ~950 sentencias, 1,3 s).
     *
     * `groupKeyExpr` arma la clave de grupo de una fila —la MISMA expresión con
     * la que el motor de agregados arma los buckets— y `keys` son las claves
     * pedidas (`null` = el grupo «(sin valor)»).
     */
    async listGroupRows(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        opts: {
            groupFieldId: number;
            groupKeyExpr: (field: Field, fieldsById: Map<number, FilterableField>) => SQL;
            keys: Array<string | null>;
            perGroup: number;
            filter_tree?: ListRecordsQuery['filter_tree'];
            search?: string;
            sort?: string;
            /** v0.1.297 — tope propio de algunos grupos (kanban: «Mostrar más»). */
            limits?: Array<{ key: string | null; limit: number }>;
            /** v0.1.297 — sin orden por campo: lo actualizado hace poco primero (kanban). */
            recentFirst?: boolean;
        },
    ): Promise<Map<string | null, RecordDto[]>> {
        const out = new Map<string | null, RecordDto[]>();
        if (opts.keys.length === 0) return out;
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const ctx = await this.readContext(tx, tenantId, actor, listIdOrSlug);
            const groupField = ctx.fields.find((f) => f.id === opts.groupFieldId);
            if (!groupField || ctx.hiddenIds.has(groupField.id)) return out;
            if (groupKeyHasSubquery(groupField.type)) await disableJitForTx(tx);
            const picked = await this.repo.listPerGroup(tx, tenantId, ctx.list.id, {
                where: this.readWhere(ctx, { filter_tree: opts.filter_tree, search: opts.search }),
                groupExpr: opts.groupKeyExpr(groupField, ctx.fieldsById),
                keys: opts.keys,
                orderBy: parseFieldSort(opts.sort, ctx.fieldsById, ctx.fields),
                perGroup: opts.perGroup,
                limits: opts.limits,
                fallbackOrder: opts.recentFirst ? [sql`${records.updatedAt} DESC`] : undefined,
            });
            const dtos = await this.hydrate(tx, tenantId, ctx, picked.map((p) => p.row));
            picked.forEach((p, i) => {
                const list = out.get(p.group) ?? [];
                list.push(dtos[i]!);
                out.set(p.group, list);
            });
            return out;
        });
    }

    /**
     * v0.1.287 — Filas de VARIOS subgrupos (pares grupo/subgrupo) de la vista
     * agrupada en dos niveles, en UNA consulta, con el mismo filtro, búsqueda,
     * ACL, orden y regla de subtareas que el listado. Las claves de los dos
     * niveles las arma `groupKeyExpr` (las mismas del motor de agregados).
     */
    async listSubGroupRows(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        opts: {
            groupFieldId: number;
            subGroupFieldId: number;
            groupKeyExpr: (field: Field, fieldsById: Map<number, FilterableField>) => SQL;
            pairs: Array<[string | null, string | null]>;
            perGroup: number;
            filter_tree?: ListRecordsQuery['filter_tree'];
            search?: string;
            sort?: string;
            limits?: Array<{ pair: [string | null, string | null]; limit: number }>;
            recentFirst?: boolean;
        },
    ): Promise<Map<string, RecordDto[]>> {
        const out = new Map<string, RecordDto[]>();
        if (opts.pairs.length === 0) return out;
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const ctx = await this.readContext(tx, tenantId, actor, listIdOrSlug);
            const groupField = ctx.fields.find((f) => f.id === opts.groupFieldId);
            const subField = ctx.fields.find((f) => f.id === opts.subGroupFieldId);
            if (!groupField || !subField || ctx.hiddenIds.has(groupField.id) || ctx.hiddenIds.has(subField.id)) return out;
            if (groupKeyHasSubquery(groupField.type) || groupKeyHasSubquery(subField.type)) await disableJitForTx(tx);
            const picked = await this.repo.listPerGroupPair(tx, tenantId, ctx.list.id, {
                where: this.readWhere(ctx, { filter_tree: opts.filter_tree, search: opts.search }),
                groupExpr: opts.groupKeyExpr(groupField, ctx.fieldsById),
                subExpr: opts.groupKeyExpr(subField, ctx.fieldsById),
                pairs: opts.pairs,
                orderBy: parseFieldSort(opts.sort, ctx.fieldsById, ctx.fields),
                perGroup: opts.perGroup,
                limits: opts.limits,
                fallbackOrder: opts.recentFirst ? [sql`${records.updatedAt} DESC`] : undefined,
            });
            const dtos = await this.hydrate(tx, tenantId, ctx, picked.map((p) => p.row));
            picked.forEach((p, i) => {
                const k = subGroupPairKey(p.group, p.sub);
                const list = out.get(k) ?? [];
                list.push(dtos[i]!);
                out.set(k, list);
            });
            return out;
        });
    }

    /**
     * B4 — Calendario completo: los eventos del RANGO visible (ver
     * `calendar-sql.ts`) con el mismo filtro, búsqueda, ACL y regla de
     * subtareas que el listado. Una fuente cuyo campo no existe, no es de
     * fecha o está oculto para quien mira se informa y no se pide.
     */
    async listCalendarRange(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        opts: {
            sources: Array<{ key: string; startFieldId: number; endFieldId: number | null; durationFieldId?: number | null }>;
            from: string;
            to: string;
            /** Zona del navegador, para una empresa que no eligió la suya. */
            clientTimeZone?: string;
            perDay: number;
            dayLimits: Record<string, number>;
            maxRows: number;
            filter_tree?: ListRecordsQuery['filter_tree'];
            search?: string;
        },
    ): Promise<{
        timeZone: string;
        fields: Field[];
        sources: Array<{ key: string; start_field_id: number; end_field_id: number | null; duration_field_id: number | null; ok: boolean; reason?: string }>;
        picks: CalendarPick[];
        total: number;
        /** Eventos del rango por fuente (las que se pidieron). */
        perSource: Record<string, number>;
        rows: RecordDto[];
    }> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const ctx = await this.readContext(tx, tenantId, actor, listIdOrSlug);
            const own = this.timeZones ? await this.timeZones.get(tenantId, tx) : null;
            const timeZone = own ?? (opts.clientTimeZone && isValidTimeZone(opts.clientTimeZone) ? opts.clientTimeZone : FALLBACK_TIME_ZONE);
            const byId = new Map(ctx.fields.map((f) => [f.id, f]));
            const dateField = (id: number | null): { id: number; type: 'date' | 'datetime' } | null | 'hidden' | 'invalid' => {
                if (id === null) return null;
                const f = byId.get(id);
                if (!f || (f.type !== 'date' && f.type !== 'datetime')) return 'invalid';
                if (ctx.hiddenIds.has(f.id)) return 'hidden';
                return { id: f.id, type: f.type };
            };
            const sqlSources: CalendarSqlSource[] = [];
            const durationField = (id: number | null | undefined): { id: number } | null | 'hidden' | 'invalid' => {
                if (id === null || id === undefined) return null;
                const f = byId.get(id);
                if (!f || f.type !== 'duration') return 'invalid';
                return ctx.hiddenIds.has(f.id) ? 'hidden' : { id: f.id };
            };
            const sources = opts.sources.map((s) => {
                const start = dateField(s.startFieldId);
                const end = dateField(s.endFieldId);
                // Un fin explícito gana sobre la duración.
                const dur = end === null ? durationField(s.durationFieldId) : null;
                const reason =
                    start === 'hidden' || end === 'hidden' || dur === 'hidden'
                        ? 'hidden'
                        : start === 'invalid' || start === null || end === 'invalid' || dur === 'invalid'
                          ? 'invalid_field'
                          : (end !== null && end.type !== start.type) || (dur !== null && start.type !== 'datetime')
                            ? 'type_mismatch'
                            : undefined;
                if (reason === undefined && start !== null && typeof start === 'object') {
                    sqlSources.push({
                        key: s.key,
                        start,
                        end: end !== null && typeof end === 'object' ? end : null,
                        duration: dur !== null && typeof dur === 'object' ? dur : null,
                    });
                }
                return {
                    key: s.key,
                    start_field_id: s.startFieldId,
                    end_field_id: s.endFieldId,
                    duration_field_id: s.durationFieldId ?? null,
                    ok: reason === undefined,
                    ...(reason ? { reason } : {}),
                };
            });
            if (sqlSources.length === 0) return { timeZone, fields: ctx.fields, sources, picks: [], total: 0, perSource: {}, rows: [] };
            const result = await tx.execute(
                calendarPicksSql({
                    tenantId,
                    listId: ctx.list.id,
                    where: this.readWhere(ctx, { filter_tree: opts.filter_tree, search: opts.search }),
                    sources: sqlSources,
                    from: opts.from,
                    to: opts.to,
                    timeZone,
                    perDay: opts.perDay,
                    dayLimits: opts.dayLimits,
                    maxRows: opts.maxRows,
                }),
            );
            const { picks, total, perSource } = readPicks(result.rows as Array<Record<string, unknown>>);
            const ids = [...new Set(picks.map((p) => p.id))];
            const listed =
                ids.length === 0
                    ? []
                    : await this.repo.list(tx, tenantId, ctx.list.id, {
                          parent: 'any',
                          where: inArray(records.id, ids),
                          limit: ids.length,
                          dir: 'asc',
                      });
            const order = new Map(ids.map((id, i) => [id, i]));
            const sorted = listed.slice(0, ids.length).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
            return { timeZone, fields: ctx.fields, sources, picks, total, perSource, rows: await this.hydrate(tx, tenantId, ctx, sorted) };
        });
    }

    /**
     * B1 — Registros de una LÍNEA DE TIEMPO (Gantt): los que tienen alguna
     * fecha dentro de `[from, to]` (inicio, fin, o la barra que cruza el
     * rango), con el mismo filtro, búsqueda, ACL y campos ocultos que el
     * listado; además los padres de las subtareas que entraron (para
     * anidarlas) y una tanda de «Sin programar» (sin ninguna de las dos
     * fechas). Todo en una transacción, una consulta por pieza.
     */
    async listTimeline(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        opts: {
            startFieldId: number;
            endFieldId: number | null;
            from: string;
            to: string;
            filter_tree?: ListRecordsQuery['filter_tree'];
            search?: string;
            sort?: string;
            limit: number;
            subtasks: boolean;
            unscheduledLimit: number;
        },
    ): Promise<{
        list: List;
        fields: Field[];
        rows: RecordDto[];
        parents: RecordDto[];
        truncated: boolean;
        unscheduled: RecordDto[];
        unscheduledTotal: number;
    }> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const ctx = await this.readContext(tx, tenantId, actor, listIdOrSlug);
            const dateOk = (id: number | null): boolean => {
                if (id === null) return true;
                const f = ctx.fields.find((x) => x.id === id);
                return !!f && (f.type === 'date' || f.type === 'datetime') && !ctx.hiddenIds.has(f.id);
            };
            if (!dateOk(opts.startFieldId) || !dateOk(opts.endFieldId)) {
                throw new BadRequestException({
                    code: 'invalid_gantt_field',
                    message: 'El inicio y el fin del Gantt tienen que ser campos de fecha visibles de esta lista.',
                    data: { status: 400 },
                });
            }
            const s = opts.startFieldId;
            const e = opts.endFieldId;
            const cond = (field_id: number, op: 'gte' | 'lte' | 'is_null' | 'is_not_null', value?: string) =>
                ({ type: 'condition' as const, field_id, op, ...(value !== undefined ? { value } : {}) });
            const group = (logic: 'and' | 'or', children: FilterNode[]): FilterGroup => ({ type: 'group', logic, children });
            const inRange: FilterGroup =
                e === null
                    ? group('and', [cond(s, 'gte', opts.from), cond(s, 'lte', opts.to)])
                    : group('or', [
                          group('and', [
                              cond(s, 'is_not_null'),
                              cond(s, 'lte', opts.to),
                              group('or', [cond(e, 'gte', opts.from), group('and', [cond(e, 'is_null'), cond(s, 'gte', opts.from)])]),
                          ]),
                          group('and', [cond(s, 'is_null'), cond(e, 'gte', opts.from), cond(e, 'lte', opts.to)]),
                      ]);
            const noDates: FilterGroup =
                e === null ? group('and', [cond(s, 'is_null')]) : group('and', [cond(s, 'is_null'), cond(e, 'is_null')]);
            // El rango se compila APARTE del filtro de la vista (y se une por
            // AND en SQL): así no le suma profundidad al árbol de la persona.
            const base = this.readWhere(ctx, { filter_tree: opts.filter_tree, search: opts.search });
            const where = andWhere(base, compileFilterTree(ctx.fieldsById, inRange, ctx.clock));
            const orderBy = parseFieldSort(opts.sort ?? `field_${s}:asc`, ctx.fieldsById, ctx.fields);
            const parent = opts.subtasks ? ('any' as const) : ('roots' as const);
            const listed = await this.repo.list(tx, tenantId, ctx.list.id, { parent, where, orderBy, limit: opts.limit, dir: 'asc', offset: 0 });
            const pageRows = listed.slice(0, opts.limit);
            const ids = new Set(pageRows.map((r) => r.id));
            // Padres de las subtareas que entraron sin su padre: se agregan
            // (con el mismo ACL) para poder anidarlas.
            const missingParents = [...new Set(pageRows.map((r) => r.parentId).filter((p): p is number => p !== null && !ids.has(p)))];
            const parentRows = missingParents.length
                ? await this.repo.list(tx, tenantId, ctx.list.id, {
                      parent: 'any',
                      where: andWhere(ctx.scopeW, inArray(records.id, missingParents.slice(0, opts.limit))),
                      limit: opts.limit,
                      dir: 'asc',
                  })
                : [];
            const unWhere = andWhere(base, compileFilterTree(ctx.fieldsById, noDates, ctx.clock));
            const unRows = opts.unscheduledLimit > 0
                ? await this.repo.list(tx, tenantId, ctx.list.id, {
                      parent,
                      where: unWhere,
                      orderBy: [sql`${records.updatedAt} DESC`],
                      limit: opts.unscheduledLimit,
                      dir: 'desc',
                      offset: 0,
                  })
                : [];
            const unscheduledTotal = opts.unscheduledLimit > 0 ? await this.repo.count(tx, tenantId, ctx.list.id, { parent, where: unWhere }) : 0;
            const [rows, parents, unscheduled] = [
                await this.hydrate(tx, tenantId, ctx, pageRows),
                await this.hydrate(tx, tenantId, ctx, parentRows.slice(0, opts.limit)),
                await this.hydrate(tx, tenantId, ctx, unRows.slice(0, opts.unscheduledLimit)),
            ];
            return {
                list: ctx.list,
                fields: ctx.fields,
                rows,
                parents,
                truncated: listed.length > opts.limit,
                unscheduled,
                unscheduledTotal,
            };
        });
    }

    /**
     * B1 — Las fechas CRUDAS de inicio y fin de los registros con alguna
     * fecha (línea base del Gantt), con el alcance de lectura de quien pide y
     * hasta `cap` filas. Una consulta.
     */
    async datedRows(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        startFieldId: number,
        endFieldId: number | null,
        cap: number,
    ): Promise<{ list: List; rows: Array<{ id: number; start: string | null; end: string | null }> }> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const ctx = await this.readContext(tx, tenantId, actor, listIdOrSlug);
            const sk = jsonbKeyForField(startFieldId);
            const ek = endFieldId !== null ? jsonbKeyForField(endFieldId) : null;
            const startText = sql`(${records.data} ->> ${sk})`;
            const endText = ek ? sql`(${records.data} ->> ${ek})` : sql`NULL::text`;
            const rows = await tx
                .select({ id: records.id, start: sql<string | null>`left(${startText}, 40)`, end: sql<string | null>`left(${endText}, 40)` })
                .from(records)
                .where(
                    and(
                        eq(records.tenantId, tenantId),
                        eq(records.listId, ctx.list.id),
                        isNull(records.deletedAt),
                        ctx.scopeW,
                        sql`(${startText} IS NOT NULL OR ${endText} IS NOT NULL)`,
                    ),
                )
                .orderBy(records.id)
                .limit(cap);
            return { list: ctx.list, rows };
        });
    }

    /**
     * B2 — Carga de trabajo: corre `fn` en UNA transacción con el contexto de
     * LECTURA de la lista para quien pide (campos, ocultos, expresiones
     * filtrables, reloj de la empresa) y el `where` del listado (filtros +
     * búsqueda + alcance del ACL). Así el bundle de la carga arma su SQL sin
     * duplicar las reglas del ACL ni de los campos ocultos.
     */
    async readScoped<T>(tenantId: number, actor: Actor, listIdOrSlug: string, fn: (tx: Tx, scope: ReadScope) => Promise<T>): Promise<T> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const ctx = await this.readContext(tx, tenantId, actor, listIdOrSlug);
            return fn(tx, {
                list: ctx.list,
                fields: ctx.fields,
                hiddenIds: ctx.hiddenIds,
                fieldsById: ctx.fieldsById,
                clock: ctx.clock,
                where: (q) => this.readWhere(ctx, q),
            });
        });
    }

    /**
     * Lo que necesita una LECTURA de la lista para quien pide (v0.1.286, antes
     * vivía dentro de `list`): campos, ACL (scope + ocultos), campos filtrables
     * con las expresiones de los derivados y el reloj de la empresa.
     */
    private async readContext(tx: Tx, tenantId: number, actor: Actor, listIdOrSlug: string): Promise<ReadContext> {
        const list = await this.lists.getWithinTx(tx, tenantId, listIdOrSlug);
        const fields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
        // v0.1.170 — los rollups filtran y ordenan por su subconsulta
        // correlacionada (el motor la arma; sin plan, se descartan).
        const plans = await this.fields.through.plans(tx, tenantId, list.id, fields);
        // ACL por lista (permisos por rol): scope de lectura + campos ocultos.
        const perms = effectivePermissions(list.settings, actor);
        // SEC-25 (v0.1.226): un campo oculto para este rol tampoco se
        // FILTRA, se BUSCA ni se ORDENA — cualquiera de las tres es un
        // oráculo ("¿qué registros tienen salario > X?" repetido hasta dar
        // con el valor), aunque después la respuesta lo quite de `data`.
        const hiddenIds = new Set(fields.filter((f) => perms.fields_hidden.includes(f.slug)).map((f) => f.id));
        // C3 — un invitado tampoco ve las relaciones (registros de otras listas).
        for (const id of guestExtraHidden(fields, actor)) hiddenIds.add(id);
        // SEC-36 (v0.1.239): lookup/rollup hacia una lista que esta persona
        // no ve completa — ocultos igual que un campo oculto.
        for (const id of await this.fields.through.restrictedFor(tx, tenantId, plans, actor)) hiddenIds.add(id);
        for (const id of withDependentComputed(fields, hiddenIds)) hiddenIds.add(id);
        // C1 — «es uno de mis equipos» en los filtros: los equipos de quien pide.
        const clock: QueryClock = { ...(await this.clock(tenantId, tx)), myTeamIds: actor.teamIds ?? [] };
        const fieldsById = withComputedExprs(
            new Map<number, FilterableField>(
                [
                    ...fields.map((f): [number, FilterableField] => [f.id, { id: f.id, type: f.type }]),
                    ...this.fields.through.filterableFor(plans, tenantId),
                    // v0.1.188 — búsquedas compuestas como filter tree pueden
                    // apuntar al pseudo-campo de la descripción.
                    descriptionSearchFilterable(),
                ].filter(([id]) => !hiddenIds.has(id)),
            ),
            fields,
            clock.timeZone,
            clock.now,
        );
        return {
            list,
            fields,
            plans,
            hiddenIds,
            fieldsById,
            scopeW: scopeWhere(perms.view, actor, assignmentKeys(list.settings)),
            clock,
            formula: await this.formulaRuntime(tx, tenantId, list.id, fields, plans),
            guest: actor.role === 'guest',
        };
    }

    /** Filtro + búsqueda (sólo sobre campos visibles) + scope de lectura. */
    private readWhere(ctx: ReadContext, query: Pick<ListRecordsQuery, 'filter_tree' | 'search'>): SQL | undefined {
        const filterWhere = compileFilterTree(ctx.fieldsById, query.filter_tree, ctx.clock);
        // Búsqueda de texto: palabras en AND, sin acentos (ver search-sql.ts).
        const searchWhere = compileSearch(ctx.fields.filter((f) => !ctx.hiddenIds.has(f.id)), query.search);
        return andWhere(andWhere(filterWhere, searchWhere), ctx.scopeW);
    }

    /**
     * Filas del listado → DTO: lookups/rollups, relaciones y conteo de
     * subtareas de la tanda ENTERA en batch (regla de oro nº 8); computed
     * evaluados y campos ocultos fuera.
     */
    private async hydrate(tx: Tx, tenantId: number, ctx: ReadContext, rows: RecordListRow[]): Promise<RecordDto[]> {
        const result = await this.fields.through.attach(tx, tenantId, ctx.plans, rows, ctx.fields);
        const relFieldIds = ctx.fields.filter((f) => f.type === 'relation').map((f) => f.id);
        const ids = result.map((r) => r.id);
        const rels = await this.relationsRepo.batchTargets(tx, tenantId, ids, relFieldIds);
        const subtaskCounts = await this.repo.subtaskCounts(tx, tenantId, ids);
        // C3 — a un invitado no se le cuentan ni muestran (ver `ReadContext.guest`).
        const internal = !ctx.guest;
        // A8 — bloqueantes abiertos de la tanda (icono «bloqueado»), una consulta.
        const blocked = internal ? await this.openBlockers(tx, tenantId, ctx.fields, ctx.hiddenIds, ids) : new Map<number, number>();
        // C5 — aprobaciones pendientes de la tanda (indicador de la fila), una consulta.
        const pendingApprovals = internal ? await pendingApprovalCounts(tx, ids) : new Map<number, number>();
        // A9 — progreso de los checklists de la tanda («☑ 3/8»), una consulta.
        const progress = internal ? await this.checklists.progressOf(tx, tenantId, ids) : new Map<number, { done: number; total: number }>();
        const hiddenKeys = new Set([...ctx.hiddenIds].map((id) => jsonbKeyForField(id)));
        return result.map((r) =>
            stripHidden(
                {
                    ...toRecord(withComputed(ctx.fields, r, ctx.formula), byFieldToKeys(relFieldIds, rels.get(r.id)), subtaskCounts.get(r.id) ?? 0),
                    blocked_by_open: blocked.get(r.id) ?? 0,
                    approval_pending: pendingApprovals.get(r.id) ?? 0,
                    ...withChecklist(progress.get(r.id)),
                },
                hiddenKeys,
            ),
        );
    }

    /**
     * A8 — Cuántos bloqueantes ABIERTOS tiene cada registro (vivos y no
     * terminados según la regla de «Mi trabajo»). Si el campo de estado está
     * oculto para quien mira, todo bloqueante vivo cuenta: «terminado» se
     * deduciría de un campo que no puede ver.
     */
    private async openBlockers(
        tx: Tx,
        tenantId: number,
        fields: Field[],
        hiddenIds: ReadonlySet<number>,
        ids: number[],
    ): Promise<Map<number, number>> {
        const rule = doneRuleFor(fields);
        return this.deps.openBlockerCounts(tx, tenantId, ids, rule && !hiddenIds.has(rule.fieldId) ? rule : null);
    }

    async update(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        id: number,
        input: UpdateRecordInput,
        /**
         * v0.1.115 — `silent` suprime el evento de realtime de ESTA fila. Lo
         * usa `bulk`, que antes emitía uno POR REGISTRO: una acción masiva de
         * 500 filas mandaba 500 broadcasts al workspace entero y cada pestaña
         * abierta refetcheaba 500 veces. Ahora emite UNA sola vez al final.
         *
         * v0.1.221 — `noAutomations`: el cambio no dispara automatizaciones
         * (lo usa la edición masiva que corre DESDE una automatización: si no,
         * una regla «al actualizar → editar en lote» se re-dispararía por cada
         * fila que toca).
         *
         * `automationChain`: el cambio lo hizo una automatización (el evento
         * lleva la cadena — tope de profundidad y sin auto-disparo).
         */
        opts: {
            silent?: boolean;
            noAutomations?: boolean;
            automationChain?: AutomationChain;
            /**
             * v0.1.287 — Deshacer/rehacer de la tabla: los valores (por `f{id}`)
             * que el cliente cree vigentes. Si alguno cambió desde entonces, la
             * fila NO se toca (409 `record_changed`): deshacer no pisa el
             * cambio de otra persona.
             */
            expect?: Record<string, unknown>;
            /** v0.1.287 — lista y campos ya resueltos (edición en lote: no se re-resuelven por fila). */
            prepared?: { list: List; fields: Field[] };
            /** D5 — el cambio lo hizo la agenda (ver `RecordChange.origin`). */
            origin?: 'booking';
        } = {},
    ): Promise<RecordDto> {
        const list = opts.prepared?.list ?? (await this.lists.get(tenantId, listIdOrSlug));
        const listId = list.id;
        const fields = opts.prepared?.fields ?? (await this.fields.listByListId(tenantId, listId));

        // C3 — un invitado no escribe en lo que no ve.
        assertGuestWritable(list.settings, fields, actor, input.data);
        // Los campos `relation` presentes en el patch se sincronizan aparte
        // (semántica parcial: los ausentes no se tocan).
        const rel = splitRelationValues(fields, input.data);
        const result = await this.tenantDb.withTenant(tenantId, async (tx) => {
            // Con lock: dos ediciones simultáneas se encolan en vez de pisarse.
            const current = await this.repo.findByIdForUpdate(tx, tenantId, listId, id);
            if (!current || !this.aclCanReach(list, actor, 'edit', current)) throw recordNotFound(id);
            if (opts.expect) await this.assertUnchanged(tx, tenantId, fields, current, opts.expect);

            // Merge parcial: validamos SOLO los campos presentes en el patch.
            const patch = this.validateData(fields, rel.data, { partial: true });
            await this.assertUniqueInTx(tx, tenantId, listId, fields, patch, id);
            const merged = mergeData(current.data, patch);
            // v0.1.300 — obligatorio-si: sólo las reglas que tocan algo que cambió
            // (un registro viejo que no cumplía una regla nueva no bloquea la
            // edición de otro campo).
            if (!opts.automationChain) assertRequiredIf(fields, merged, new Set(Object.keys(patch)));
            // v0.1.213 — lista de una tienda: sólo lo que WooCommerce acepta.
            this.assertStoreEdit(list, fields, current.data, merged, [
                ...Object.keys(patch).map((k) => Number(k.slice(1))),
                ...rel.values.map((v) => v.field.id),
            ]);
            const updated = await this.repo.updateData(tx, tenantId, listId, id, merged, actor.userId);
            // A8 — si cambió el fin y la lista reprograma, lo que depende de
            // este registro se corre lo mismo, en ESTA transacción.
            let rescheduled: ShiftedRecord[] = [];
            if (updated) {
                await this.syncRelations(tx, tenantId, id, rel.values);
                await this.activity.logInTx(tx, {
                    tenantId,
                    listId,
                    recordId: id,
                    // El sistema (0: una automatización) no es una persona.
                    userId: actor.userId > 0 ? actor.userId : null,
                    action: 'record_updated',
                    diff: computeDiff(current.data, merged),
                });
                rescheduled = await this.rescheduleDependentsInTx(tx, tenantId, list, fields, actor, id, current.data, updated.data);
            }
            const relFieldIds = fields.filter((f) => f.type === 'relation').map((f) => f.id);
            const rels = updated
                ? await this.relationsRepo.batchTargets(tx, tenantId, [id], relFieldIds)
                : new Map<number, Map<number, number[]>>();
            const enriched = updated
                ? (await this.withThrough(tx, tenantId, listId, fields, [updated]))[0] ?? updated
                : null;
            // La respuesta reemplaza al registro en los caches del front: sin
            // esto volvía con 0 subtareas aunque las tuviera.
            const subtasks = updated && (updated.parentId ?? null) === null
                ? (await this.repo.subtaskCounts(tx, tenantId, [id])).get(id) ?? 0
                : 0;
            // C3 — un invitado no ve los indicadores de la operación interna.
            const internal = updated && actor.role !== 'guest';
            const blockedOpen = internal ? (await this.openBlockers(tx, tenantId, fields, new Set(), [id])).get(id) ?? 0 : 0;
            const approvalPending = internal ? (await pendingApprovalCounts(tx, [id])).get(id) ?? 0 : 0;
            const checklist = internal ? (await this.checklists.progressOf(tx, tenantId, [id])).get(id) : undefined;
            const rt = updated ? await this.formulaRuntime(tx, tenantId, listId, fields) : undefined;
            return { updated, enriched, before: current.data, rels, subtasks, rescheduled, blockedOpen, approvalPending, checklist, rt };
        });
        if (!result.updated) throw recordNotFound(id);
        const row = result.updated;
        if (!opts.silent) this.realtime.records(tenantId, listId);
        // Lo corrido por la reprogramación es un cambio más: automatizaciones,
        // avisos y la tienda se enteran igual que de una edición a mano.
        for (const changed of [{ id: row.id, before: result.before, after: row.data }, ...result.rescheduled]) {
            if (!opts.noAutomations) this.automations.dispatch({
                tenantId,
                listId,
                recordId: changed.id,
                trigger: 'record_updated',
                after: changed.after,
                before: changed.before, // para changed_fields
                ...(opts.automationChain ? { chain: opts.automationChain } : {}),
            });
            // v0.1.207 — aviso en proceso (edición en los dos sentidos de las tiendas).
            this.changes?.emit({
                tenantId,
                listId,
                recordId: changed.id,
                before: changed.before,
                after: changed.after,
                actorId: actor.userId,
                list,
                fields,
                ...(opts.origin && changed.id === row.id ? { origin: opts.origin } : {}),
            });
            // Recurrencias con trigger status_change: fire-and-forget (no bloquea
            // la respuesta del update; un fallo se loguea y no rompe la mutación).
            void this.recurrences
                ?.onRecordUpdated(tenantId, listId, changed.id, changed.before, changed.after)
                .catch((err) =>
                    this.logger.error(`Recurrencias post-update de record ${changed.id}: ${String(err)}`),
                );
        }
        return {
            ...toRecord(
                withComputed(fields, result.enriched ?? row, result.rt),
                byFieldToKeys(
                    fields.filter((f) => f.type === 'relation').map((f) => f.id),
                    result.rels.get(row.id),
                ),
                result.subtasks,
            ),
            blocked_by_open: result.blockedOpen,
            approval_pending: result.approvalPending,
            ...withChecklist(result.checklist),
            ...(result.rescheduled.length > 0 ? { rescheduled: result.rescheduled.map((r) => r.id) } : {}),
        };
    }

    /**
     * A8 — Reprogramación en cadena. Si la lista lo tiene encendido
     * (`settings.dependencies`) y cambió el FIN efectivo del registro (su fin,
     * o su inicio si es un hito), cada registro que depende de él corre su
     * inicio y su fin lo mismo; y lo que depende de ESE, también. Todo en la
     * transacción de la edición, con tope de registros y de eslabones, cada
     * registro con su actividad. Lo que quien edita no puede editar (ACL) o lo
     * que la tienda no deja cambiar no se mueve —y la cadena no sigue por ahí.
     */
    private async rescheduleDependentsInTx(
        tx: Tx,
        tenantId: number,
        list: List,
        fields: Field[],
        actor: Actor,
        rootId: number,
        before: Record<string, unknown>,
        after: Record<string, unknown>,
    ): Promise<ShiftedRecord[]> {
        const settings = readDependencySettings(list.settings);
        if (!settings.reschedule) return [];
        const dateField = (fid: number | null): Field | null =>
            fid === null ? null : fields.find((f) => f.id === fid && (f.type === 'date' || f.type === 'datetime')) ?? null;
        const startF = dateField(settings.start_field_id);
        const endF = dateField(settings.end_field_id);
        if (!startF && !endF) return [];
        const sk = startF ? jsonbKeyForField(startF.id) : null;
        const ek = endF ? jsonbKeyForField(endF.id) : null;
        const e0 = effectiveEndMs(before, sk, ek);
        const e1 = effectiveEndMs(after, sk, ek);
        if (e0 === null || e1 === null || e0 === e1) return [];
        const delta = e1 - e0;

        const shifted: ShiftedRecord[] = [];
        const visited = new Set<number>([rootId]);
        let frontier = [rootId];
        for (let depth = 0; frontier.length > 0 && depth < RESCHEDULE_MAX_DEPTH; depth++) {
            const next: number[] = [];
            // Orden estable por id: dos reprogramaciones simultáneas toman los
            // candados de fila en el mismo orden (menos riesgo de deadlock).
            const level = (await this.deps.dependentsOf(tx, tenantId, frontier)).sort((a, b) => a.blocked - b.blocked);
            for (const edge of level) {
                if (visited.has(edge.blocked) || edge.listId !== list.id) continue;
                visited.add(edge.blocked);
                if (shifted.length >= RESCHEDULE_MAX_RECORDS) break;
                const cur = await this.repo.findByIdForUpdate(tx, tenantId, list.id, edge.blocked);
                if (!cur || !this.aclCanReach(list, actor, 'edit', cur)) continue;
                const data = cur.data as Record<string, unknown>;
                const patch: Record<string, unknown> = {};
                for (const [f, key] of [[startF, sk], [endF, ek]] as const) {
                    if (!f || !key) continue;
                    const moved = shiftDateValue(f.type, data[key], delta);
                    if (moved !== null && moved !== data[key]) patch[key] = moved;
                }
                if (Object.keys(patch).length === 0) continue;
                let merged: Record<string, unknown>;
                try {
                    const valid = this.validateData(fields, patch, { partial: true });
                    merged = mergeData(data, valid);
                    this.assertStoreEdit(list, fields, data, merged, Object.keys(valid).map((k) => Number(k.slice(1))));
                    await this.assertUniqueInTx(tx, tenantId, list.id, fields, valid, cur.id);
                } catch {
                    continue;
                }
                const upd = await this.repo.updateData(tx, tenantId, list.id, cur.id, merged, actor.userId);
                if (!upd) continue;
                await this.activity.logInTx(tx, {
                    tenantId,
                    listId: list.id,
                    recordId: cur.id,
                    userId: actor.userId > 0 ? actor.userId : null,
                    action: 'record_updated',
                    diff: computeDiff(data, merged),
                });
                shifted.push({ id: cur.id, before: data, after: upd.data as Record<string, unknown> });
                next.push(cur.id);
            }
            if (shifted.length >= RESCHEDULE_MAX_RECORDS) break;
            frontier = next;
        }
        if (shifted.length >= RESCHEDULE_MAX_RECORDS) {
            this.logger.warn(`Reprogramación de ${rootId}: se alcanzó el tope de ${RESCHEDULE_MAX_RECORDS} registros`);
        }
        return shifted;
    }

    /**
     * ¿El actor alcanza esta fila para la acción? (dependencias: quien agrega
     * o quita una dependencia tiene que poder editar el registro bloqueado).
     */
    canReach(list: List, actor: Actor, action: 'view' | 'edit' | 'delete', row: Pick<RecordRow, 'data' | 'createdBy'>): boolean {
        return this.aclCanReach(list, actor, action, row);
    }

    /**
     * v0.1.216 — Las filas que abarca una edición masiva: las elegidas por id
     * o TODAS las que coinciden con los filtros y la búsqueda de la vista.
     * Mismo whitelist de filtros y búsqueda que el listado, pero con el alcance
     * de EDICIÓN del rol (lo que la persona puede cambiar, no sólo lo que ve).
     * Trae los datos con calculados, lookups y rollups ya evaluados (sirven de
     * operandos) y los vínculos de cada relación.
     */
    async bulkRows(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        target: BulkEditTarget,
        cap: number,
        /** v0.1.220 — con qué alcance del rol: editar (default) o borrar. */
        scope: 'edit' | 'delete' = 'edit',
    ): Promise<{
        list: List;
        fields: Field[];
        total: number;
        rows: Array<{
            id: number;
            data: Record<string, unknown>;
            relations: Record<number, number[]>;
            parentId: number | null;
            updatedAt: string;
        }>;
    }> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const list = await this.lists.getWithinTx(tx, tenantId, listIdOrSlug);
            const fields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
            const plans = await this.fields.through.plans(tx, tenantId, list.id, fields);
            const perms = effectivePermissions(list.settings, actor);
            const scopeW = scopeWhere(perms[scope], actor, assignmentKeys(list.settings));
            let where: SQL | undefined;
            let parent: 'roots' | 'any';
            if ('ids' in target) {
                where = inArray(records.id, [...new Set(target.ids)]);
                parent = 'any';
            } else {
                // SEC-25: tampoco se apunta una edición en lote por un campo oculto.
                const hiddenIds = new Set(fields.filter((f) => perms.fields_hidden.includes(f.slug)).map((f) => f.id));
                const bulkClock: QueryClock = { ...(await this.clock(tenantId)), myTeamIds: actor.teamIds ?? [] };
                const fieldsById = withComputedExprs(
                    new Map<number, FilterableField>(
                        [
                            ...fields.map((f): [number, FilterableField] => [f.id, { id: f.id, type: f.type }]),
                            ...this.fields.through.filterableFor(plans, tenantId),
                            descriptionSearchFilterable(),
                        ].filter(([id]) => !hiddenIds.has(id)),
                    ),
                    fields,
                    bulkClock.timeZone,
                    bulkClock.now,
                );
                where = andWhere(
                    compileFilterTree(fieldsById, target.filter_tree, bulkClock),
                    compileSearch(fields.filter((f) => !hiddenIds.has(f.id)), target.search),
                );
                parent = target.include_subtasks ? 'any' : 'roots';
            }
            where = andWhere(where, scopeW);
            const total = await this.repo.count(tx, tenantId, list.id, { parent, where });
            if (total > cap) {
                throw new BadRequestException({
                    code: 'bulk_too_many',
                    message: `Son ${total} registros y una edición masiva abarca hasta ${cap}. Acota con filtros y hazlo en partes.`,
                    data: { status: 400, total, cap },
                });
            }
            if (total === 0) return { list, fields, total, rows: [] };
            const listed = await this.repo.list(tx, tenantId, list.id, { parent, where, limit: cap, dir: 'asc' });
            const enriched = await this.fields.through.attach(tx, tenantId, plans, listed.slice(0, cap), fields);
            const rt = await this.formulaRuntime(tx, tenantId, list.id, fields, plans);
            const relFieldIds = fields.filter((f) => f.type === 'relation').map((f) => f.id);
            const rels = await this.relationsRepo.batchTargets(
                tx,
                tenantId,
                enriched.map((r) => r.id),
                relFieldIds,
            );
            const rows = enriched.map((r) => {
                const byField = rels.get(r.id);
                const relations: Record<number, number[]> = {};
                for (const id of relFieldIds) relations[id] = byField?.get(id) ?? [];
                return {
                    id: r.id,
                    data: withComputed(fields, r, rt).data as Record<string, unknown>,
                    relations,
                    parentId: r.parentId ?? null,
                    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
                };
            });
            return { list, fields, total, rows };
        });
    }

    /**
     * v0.1.170 — adjunta lookups/rollups a las filas (dentro del tx de la
     * lectura). Camino rápido: sin campos through no consulta nada.
     */
    private async withThrough<T extends { id: number; data: Record<string, unknown> }>(
        tx: Tx,
        tenantId: number,
        listId: number,
        fields: Field[],
        rows: T[],
    ): Promise<T[]> {
        const plans = await this.fields.through.plans(tx, tenantId, listId, fields);
        return this.fields.through.attach(tx, tenantId, plans, rows, fields);
    }

    /**
     * Descripción rica del registro (v0.1.133). Va por su propio endpoint —
     * no viaja en el listado — así que la lectura repite el chequeo de ACL:
     * si el scope del rol no alcanza la fila, 404 (mismo criterio que `get`).
     */
    async getDescription(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        id: number,
    ): Promise<RichDoc | null> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const result = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.repo.findById(tx, tenantId, list.id, id);
            if (!row || !this.aclCanReach(list, actor, 'view', row)) return null;
            return this.repo.findDescription(tx, tenantId, list.id, id);
        });
        if (!result) throw recordNotFound(id);
        return result.description;
    }

    /**
     * Guarda la descripción. Exige permiso de EDICIÓN sobre la fila (la misma
     * puerta que cambiar un campo) y sanea el documento contra la whitelist
     * compartida antes de persistir — nunca se guarda lo que mandó el cliente
     * tal cual.
     */
    async updateDescription(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        id: number,
        input: UpdateRecordDescriptionInput,
    ): Promise<RichDoc | null> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const clean = sanitizeRichDoc(input.description);

        let newlyMentioned: number[] = [];
        let newTeams: number[] = [];
        const ok = await this.tenantDb.withTenant(tenantId, async (tx) => {
            // Fila bloqueada (igual que `update`): dos autoguardados seguidos
            // no leen el mismo "antes" ni juntan la actividad a la vez.
            const row = await this.repo.findByIdForUpdate(tx, tenantId, list.id, id);
            if (!row || !this.aclCanReach(list, actor, 'edit', row)) return false;
            const before = row.hasDescription ? (await this.repo.findDescription(tx, tenantId, list.id, id))?.description ?? null : null;
            await this.repo.updateDescription(tx, tenantId, list.id, id, clean, actor.userId);
            newlyMentioned = await this.storeDescriptionMentions(tx, tenantId, list.id, id, actor.userId, clean);
            // C1 — @equipo: sólo los equipos que se SUMARON en este guardado
            // (el autoguardado reescribe el documento a cada rato) y que
            // existen en esta empresa.
            const beforeTeams = new Set(collectMentionedTeamIds(before));
            const added = collectMentionedTeamIds(clean).filter((t) => !beforeTeams.has(t));
            if (added.length > 0) {
                const live = await tx
                    .select({ id: teams.id })
                    .from(teams)
                    .where(and(eq(teams.tenantId, tenantId), inArray(teams.id, added)));
                newTeams = live.map((t) => t.id);
            }
            // La bitácora registra QUE cambió (con un resumen corto, nunca el
            // documento entero) y junta el autoguardado de una misma persona
            // en una sola entrada — si no, cada segundo escribiendo era un
            // "actualizó este registro" vacío.
            const from = before === null ? '' : richDocToPlainText(before, 120);
            const to = clean === null ? '' : richDocToPlainText(clean, 120);
            await this.activity.logDescriptionEdit(tx, { tenantId, listId: list.id, recordId: id, userId: actor.userId, from, to });
            return true;
        });
        if (!ok) throw recordNotFound(id);

        this.realtime.records(tenantId, list.id);
        // v0.1.276 — avisa SÓLO a quien se sumó en este guardado: el autoguardado
        // re-escribe las menciones a cada rato y no puede re-avisar cada vez.
        if (newlyMentioned.length > 0 || newTeams.length > 0) {
            this.notify?.emit({
                type: 'description_mention',
                tenantId,
                listId: list.id,
                recordId: id,
                actorId: actor.userId,
                userIds: newlyMentioned,
                ...(newTeams.length > 0 ? { teamIds: newTeams } : {}),
                snippet: richDocToPlainText(clean, 180),
            });
        }
        return clean;
    }

    /**
     * Menciones escritas EN la descripción (v0.1.134).
     *
     * A diferencia de los comentarios (que buscan tokens `@email` en el
     * texto), aquí la mención es un NODO con el id de la persona: renombrarla
     * no rompe el vínculo. Igual se valida contra los miembros del workspace
     * — un id ajeno no notifica a nadie.
     *
     * Se re-escriben en cada guardado: primero se borran las de esta
     * descripción y se vuelven a insertar. Es lo que hace que sacar una
     * mención del documento la saque también de la campana.
     */
    private async storeDescriptionMentions(
        tx: Tx,
        tenantId: number,
        listId: number,
        recordId: number,
        authorId: number,
        doc: RichDoc | null,
    ): Promise<number[]> {
        const previous = await tx
            .select({ userId: mentions.mentionedUserId })
            .from(mentions)
            .where(and(eq(mentions.tenantId, tenantId), eq(mentions.recordId, recordId), eq(mentions.source, 'description')));
        const before = new Set(previous.map((p) => p.userId));
        await tx
            .delete(mentions)
            .where(
                and(
                    eq(mentions.tenantId, tenantId),
                    eq(mentions.recordId, recordId),
                    eq(mentions.source, 'description'),
                ),
            );
        const ids = collectMentionedUserIds(doc).filter((id) => id !== authorId);
        if (ids.length === 0) return [];

        const members = await tx
            .select({ userId: memberships.userId })
            .from(memberships)
            .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, ids)));
        if (members.length === 0) return [];

        const snippet = richDocToPlainText(doc, 180);
        await tx.insert(mentions).values(
            members.map((m) => ({
                tenantId,
                commentId: null,
                listId,
                recordId,
                mentionedUserId: m.userId,
                authorUserId: authorId,
                source: 'description',
                snippet,
            })),
        );
        return members.map((m) => m.userId).filter((u) => !before.has(u));
    }

    /**
     * v0.1.220 — Mover un registro bajo otro padre (o sacarlo al primer
     * nivel con `null`). Mismas reglas que el alta de una subtarea: un solo
     * nivel — el padre tiene que ser de primer nivel, y un registro que YA
     * tiene subtareas no puede pasar a ser subtarea.
     */
    async setParent(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        id: number,
        parentId: number | null,
        opts: { silent?: boolean } = {},
    ): Promise<void> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        assertNotStoreManaged(list, 'move');
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, list.id, id);
            if (!current || !this.aclCanReach(list, actor, 'edit', current)) throw recordNotFound(id);
            if (parentId !== null) {
                if (parentId === id) throw subtaskError('subtask_self', 'Un registro no puede ser subtarea de sí mismo.');
                const parent = await this.repo.findById(tx, tenantId, list.id, parentId);
                if (!parent) throw recordNotFound(parentId);
                if (parent.parentId !== null) throw subtaskError('subtask_depth', 'Una subtarea no puede tener subtareas.');
                const [kids] = await tx
                    .select({ n: sql<number>`count(*)::int` })
                    .from(records)
                    .where(and(eq(records.tenantId, tenantId), eq(records.parentId, id), isNull(records.deletedAt)));
                if ((kids?.n ?? 0) > 0) {
                    throw subtaskError('subtask_has_children', 'Tiene subtareas propias: una subtarea no puede tener subtareas.');
                }
            }
            await tx
                .update(records)
                .set({ parentId, updatedAt: sql`now()`, updatedBy: actor.userId })
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, list.id), eq(records.id, id)));
        });
        if (!opts.silent) this.realtime.records(tenantId, list.id);
    }

    /**
     * v0.1.220 — Volver a la vida un registro borrado (deshacer un borrado
     * masivo): el registro, las subtareas que se fueron con él y sus vínculos
     * salientes (los que el borrado limpió), sólo hacia registros que sigan
     * vivos.
     */
    async restoreDeleted(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        id: number,
        snapshot: { children: number[]; relations: Record<string, number[]> },
        opts: { silent?: boolean } = {},
    ): Promise<void> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const rel = splitRelationValues(fields, snapshot.relations);
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .select()
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, list.id), eq(records.id, id), isNotNull(records.deletedAt)))
                .limit(1);
            if (!row || !this.aclCanReach(list, actor, 'delete', row)) throw recordNotFound(id);
            const ids = [id, ...snapshot.children];
            await tx
                .update(records)
                .set({ deletedAt: null, deletedBy: null, updatedAt: sql`now()`, updatedBy: actor.userId })
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, list.id), inArray(records.id, ids)));
            for (const { field, targetListId, ids: targets } of rel.values) {
                const alive = targets.length > 0 ? await this.relationsRepo.existingInList(tx, tenantId, targetListId, targets) : new Set<number>();
                await this.relationsRepo.sync(tx, tenantId, field.id, id, targets.filter((t) => alive.has(t)));
            }
            await this.activity.logInTx(tx, { tenantId, listId: list.id, recordId: id, userId: actor.userId, action: 'record_created' });
        });
        if (!opts.silent) this.realtime.records(tenantId, list.id);
    }

    async remove(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        id: number,
        opts: { silent?: boolean } = {},
    ): Promise<void> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const listId = list.id;
        assertNotStoreManaged(list, 'delete');
        const deleted = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, listId, id);
            if (!current || !this.aclCanReach(list, actor, 'delete', current)) return false;
            const ok = await this.repo.softDelete(tx, tenantId, listId, id, actor.userId);
            if (ok) {
                // Las subtareas se van con el padre: si no, quedarían vivas
                // colgando de un registro que ya nadie ve.
                await this.repo.softDeleteChildren(tx, tenantId, id, actor.userId);
                // Papelera: los vínculos NO se borran (restaurar los trae de
                // vuelta). Mientras está en la papelera no cuentan: toda
                // lectura de `relations` cruza con `records.deleted_at` del
                // otro lado (lookups, rollups, filtros, "Vinculados"). Se van
                // de verdad al purgar (ON DELETE CASCADE).
                await this.activity.logInTx(tx, {
                    tenantId,
                    listId,
                    recordId: id,
                    userId: actor.userId,
                    action: 'record_deleted',
                });
            }
            return ok;
        });
        if (!deleted) throw recordNotFound(id);
        if (!opts.silent) this.realtime.records(tenantId, listId);
    }

    /**
     * Acción masiva (borrar / actualizar campos) sobre varios records. Se aplica
     * por fila reutilizando update/remove (respeta capabilities, own-scoping,
     * validación, activity y realtime); junta éxitos y fallos individuales.
     */
    async bulk(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        action: 'delete' | 'update',
        ids: number[],
        values: Record<string, unknown>,
    ): Promise<{ succeeded: number[]; failed: Array<{ id: number; message: string }> }> {
        const data: Record<string, unknown> = {};
        if (action === 'update') {
            // `values` puede venir por slug o por f{id}; normalizamos a f{id}.
            const list = await this.lists.get(tenantId, listIdOrSlug);
            const fields = await this.fields.list(tenantId, String(list.id));
            const bySlug = new Map(fields.map((f) => [f.slug, `f${f.id}`]));
            for (const [k, v] of Object.entries(values)) {
                data[/^f\d+$/.test(k) ? k : (bySlug.get(k) ?? k)] = v;
            }
        }

        const succeeded: number[] = [];
        const failed: Array<{ id: number; message: string }> = [];
        for (const id of ids) {
            try {
                if (action === 'delete') {
                    await this.remove(tenantId, actor, listIdOrSlug, id, { silent: true });
                } else {
                    await this.update(tenantId, actor, listIdOrSlug, id, { data }, { silent: true });
                }
                succeeded.push(id);
            } catch (err) {
                failed.push({ id, message: err instanceof Error ? err.message : 'Error' });
            }
        }
        // UN solo evento para toda la acción masiva (v0.1.115): antes se emitía
        // por fila y cada pestaña del workspace refetcheaba N veces.
        if (succeeded.length > 0) {
            const list = await this.lists.get(tenantId, listIdOrSlug);
            this.realtime.records(tenantId, list.id);
        }
        return { succeeded, failed };
    }

    /**
     * v0.1.287 — Varias filas con valores DISTINTOS por fila (pegar un bloque,
     * rellenar hacia abajo, deshacer/rehacer desde la tabla). Cada ítem pasa
     * por `update` —ACL, validación, reglas de la tienda, actividad,
     * automatizaciones— con la lista y los campos resueltos UNA vez, y el
     * realtime avisa UNA sola vez al final (como `bulk`).
     *
     * Errores por CELDA sin abortar el resto: si una fila trae un valor que el
     * campo no acepta (o una columna que la tienda no deja tocar), esa celda
     * se reporta y el resto de la fila se escribe igual. Una fila que no se
     * puede tocar (sin permiso, borrada, conflicto de deshacer) se reporta
     * entera.
     */
    async batchUpdate(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        items: Array<{ id: number; data: Record<string, unknown>; expect?: Record<string, unknown> }>,
    ): Promise<BatchUpdateRecordsResult> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const keyBySlug = new Map(fields.map((f) => [f.slug, jsonbKeyForField(f.id)]));
        const slugByKey = new Map(fields.map((f) => [jsonbKeyForField(f.id), f.slug]));
        const updated: RecordDto[] = [];
        const failed: BatchUpdateRecordsResult['failed'] = [];
        const cellErrors: BatchUpdateRecordsResult['cell_errors'] = [];
        // Un id repetido en el pedido se escribe UNA vez (con lo último).
        const merged = new Map<number, { data: Record<string, unknown>; expect?: Record<string, unknown> }>();
        for (const item of items) {
            const prev = merged.get(item.id);
            merged.set(item.id, {
                data: { ...(prev?.data ?? {}), ...item.data },
                expect: item.expect || prev?.expect ? { ...(prev?.expect ?? {}), ...(item.expect ?? {}) } : undefined,
            });
        }
        for (const [id, item] of merged) {
            const data = { ...item.data };
            // Cada vuelta saca las celdas que fallaron; a lo sumo una por clave.
            for (let attempt = 0; attempt <= Object.keys(item.data).length; attempt++) {
                if (Object.keys(data).length === 0) break;
                try {
                    updated.push(
                        await this.update(tenantId, actor, String(list.id), id, { data }, {
                            silent: true,
                            expect: item.expect,
                            prepared: { list, fields },
                        }),
                    );
                    break;
                } catch (err) {
                    const info = describeError(err);
                    const badKeys = info.fieldErrors
                        ? Object.keys(info.fieldErrors)
                              .map((k) => (/^f\d+$/.test(k) ? k : keyBySlug.get(k)))
                              .filter((k): k is string => k !== undefined && k in data)
                        : [];
                    if (badKeys.length > 0) {
                        for (const key of badKeys) {
                            const slug = slugByKey.get(key);
                            cellErrors.push({
                                id,
                                key,
                                message: info.fieldErrors![key] ?? (slug ? info.fieldErrors![slug] : undefined) ?? info.message,
                            });
                            delete data[key];
                        }
                        continue;
                    }
                    failed.push({ id, code: info.code, message: info.message, ...(info.changed ? { changed: info.changed } : {}) });
                    break;
                }
            }
        }
        if (updated.length > 0) this.realtime.records(tenantId, list.id);
        return { updated, failed, cell_errors: cellErrors };
    }

    /**
     * v0.1.294 — Alta de varias filas (pegar desde Excel más filas de las que
     * hay en la tabla; rehacer ese pegado). Cada una pasa por `create` (ACL,
     * validación, actividad, automatizaciones); el límite del plan se verifica
     * para el lote entero ANTES de crear nada (entra todo o nada, SEC-09) y el
     * realtime avisa una vez. Los errores vuelven por fila sin abortar el resto.
     */
    async batchCreate(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        items: Array<{ data: Record<string, unknown> }>,
    ): Promise<BatchCreateRecordsResult> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        assertNotStoreManaged(list, 'create');
        if (!effectivePermissions(list.settings, actor).create) {
            throw new ForbiddenException({
                code: 'forbidden_create',
                message: 'Tu rol no puede crear registros en esta lista',
                data: { status: 403 },
            });
        }
        if (this.billing) await this.billing.assertCanCreateRecords(tenantId, items.length);
        const created: BatchCreateRecordsResult['created'] = [];
        const failed: BatchCreateRecordsResult['failed'] = [];
        for (const [index, item] of items.entries()) {
            try {
                const record = await this.create(tenantId, actor, String(list.id), { data: item.data }, { planChecked: true, silent: true });
                created.push({ index, record });
            } catch (err) {
                const info = describeError(err);
                failed.push({ index, code: info.code, message: info.message, ...(info.fieldErrors ? { errors: info.fieldErrors } : {}) });
            }
        }
        if (created.length > 0) this.realtime.records(tenantId, list.id);
        return { created, failed };
    }

    /**
     * v0.1.294 — Borrado de varias filas con `expect` por fila: deshacer un
     * pegado que creó registros los quita, salvo los que alguien cambió
     * después (conflicto `record_changed`, la fila no se toca). Cada borrado
     * pasa por `remove` (ACL de borrar, subtareas, vínculos, actividad).
     */
    async batchRemove(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        items: Array<{ id: number; expect?: Record<string, unknown> }>,
    ): Promise<BatchDeleteRecordsResult> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        assertNotStoreManaged(list, 'delete');
        const fields = await this.fields.listByListId(tenantId, list.id);
        const deleted: number[] = [];
        const failed: BatchDeleteRecordsResult['failed'] = [];
        for (const item of items) {
            try {
                if (item.expect && Object.keys(item.expect).length > 0) {
                    await this.tenantDb.withTenant(tenantId, async (tx) => {
                        const current = await this.repo.findById(tx, tenantId, list.id, item.id);
                        if (!current) throw recordNotFound(item.id);
                        await this.assertUnchanged(tx, tenantId, fields, current, item.expect!);
                    });
                }
                await this.remove(tenantId, actor, String(list.id), item.id, { silent: true });
                deleted.push(item.id);
            } catch (err) {
                const info = describeError(err);
                failed.push({ id: item.id, code: info.code, message: info.message, ...(info.changed ? { changed: info.changed } : {}) });
            }
        }
        if (deleted.length > 0) this.realtime.records(tenantId, list.id);
        return { deleted, failed };
    }

    /**
     * v0.1.287 — ¿Los valores que el cliente cree vigentes (`expect`, por
     * `f{id}`) siguen siendo los de la fila? Si no, 409 con las claves que
     * cambiaron. Las relaciones se comparan como conjunto de vínculos; una
     * casilla vacía vale lo mismo que desmarcada.
     */
    private async assertUnchanged(
        tx: Tx,
        tenantId: number,
        fields: Field[],
        current: Pick<RecordListRow, 'id' | 'data'>,
        expect: Record<string, unknown>,
    ): Promise<void> {
        const byKey = new Map(fields.map((f) => [jsonbKeyForField(f.id), f]));
        const relationIds = Object.keys(expect)
            .map((k) => byKey.get(k))
            .filter((f): f is Field => f?.type === 'relation')
            .map((f) => f.id);
        const rels = relationIds.length > 0
            ? (await this.relationsRepo.batchTargets(tx, tenantId, [current.id], relationIds)).get(current.id)
            : undefined;
        const data = current.data as Record<string, unknown>;
        const changed: string[] = [];
        for (const [key, expected] of Object.entries(expect)) {
            const field = byKey.get(key);
            if (!field) continue;
            if (field.type === 'relation') {
                if (!sameBulkValue(rels?.get(field.id) ?? [], expected, true)) changed.push(key);
            } else if (field.type === 'checkbox') {
                if (isTruthyCheckbox(data[key]) !== isTruthyCheckbox(expected)) changed.push(key);
            } else if (!sameBulkValue(data[key], expected, field.type === 'multi_select')) {
                changed.push(key);
            }
        }
        if (changed.length > 0) {
            const labels = changed.map((k) => byKey.get(k)?.label ?? k);
            throw new ConflictException({
                code: 'record_changed',
                message: `Alguien cambió ${labels.map((l) => `«${l}»`).join(', ')} después: no se pisó.`,
                data: { status: 409, changed },
            });
        }
    }

    /**
     * v0.1.213 — En una lista sincronizada con una tienda, cada columna que
     * cambia tiene que ser editable EN ESA FILA (precios, stock y estados, con
     * las reglas de `store-rules.ts`) y el valor tiene que ser uno que la
     * tienda acepte. Las columnas propias de la empresa quedan libres. Se
     * evalúa sobre la fila YA mezclada: activar «Controla stock» y poner el
     * stock en el mismo cambio es válido.
     */
    private assertStoreEdit(
        list: List,
        fields: Field[],
        before: Record<string, unknown>,
        merged: Record<string, unknown>,
        fieldIds: number[],
    ): void {
        const marker = readStoreListMarker(list.settings);
        if (!marker) return;
        const row = (slug: string): unknown => {
            const id = marker.fields[slug];
            return id ? merged[`f${id}`] : undefined;
        };
        for (const fieldId of new Set(fieldIds)) {
            const key = `f${fieldId}`;
            if (JSON.stringify(before[key] ?? null) === JSON.stringify(merged[key] ?? null) && !fields.some((f) => f.id === fieldId && f.type === 'relation')) continue;
            const label = fields.find((f) => f.id === fieldId)?.label ?? 'Esa columna';
            const access = storeCellAccess(marker, fieldId, row);
            if (access.access === 'locked') {
                throw new ForbiddenException({
                    code: 'store_field_locked',
                    message: `${label}: ${access.reason}`,
                    data: { status: 403, field_id: fieldId },
                });
            }
            if (access.access === 'editable') {
                const err = storeValueError(marker, fieldId, merged[key], row);
                if (err) {
                    throw new BadRequestException({
                        code: 'store_invalid_value',
                        message: `${label}: ${err}`,
                        data: { status: 400, field_id: fieldId },
                    });
                }
            }
        }
    }

    /**
     * ¿El actor alcanza esta fila para la acción, según el ACL de la lista?
     * Resuelve el scope efectivo del rol (all/assigned/own/none) y evalúa la
     * fila (created_by / valor del campo de asignación).
     */
    private aclCanReach(
        list: List,
        actor: Actor,
        action: 'view' | 'edit' | 'delete',
        row: Pick<RecordRow, 'data' | 'createdBy'> & { id?: number },
    ): boolean {
        // C3 — el id cuenta para los registros sueltos compartidos con un invitado.
        return listRowInScope(list.settings, actor, action, { id: row.id, createdBy: row.createdBy, data: row.data });
    }

    /**
     * Sincroniza los campos `relation` presentes en el payload dentro del tx
     * de la mutación. Valida que CADA target exista vivo en la lista destino
     * del campo (mismo tenant — RLS + tenant_id explícito); un ID ajeno o
     * inexistente rechaza la mutación completa (400).
     */
    private async syncRelations(
        tx: Parameters<RelationsRepository['sync']>[0],
        tenantId: number,
        recordId: number,
        values: Array<{ field: Field; targetListId: number; ids: number[] }>,
    ): Promise<void> {
        for (const { field, targetListId, ids } of values) {
            if (ids.length > 0) {
                const alive = await this.relationsRepo.existingInList(tx, tenantId, targetListId, ids);
                const missing = ids.filter((id) => !alive.has(id));
                if (missing.length > 0) {
                    throw new BadRequestException({
                        code: 'validation_failed',
                        message: 'Datos del registro inválidos',
                        data: {
                            status: 400,
                            errors: {
                                [field.slug]: `Registros inexistentes en la lista destino: ${missing.join(', ')}`,
                            },
                        },
                    });
                }
            }
            await this.relationsRepo.sync(tx, tenantId, field.id, recordId, ids);
        }
    }

    private async resolveListId(tenantId: number, listIdOrSlug: string): Promise<number> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        return list.id;
    }

    /**
     * Valida y normaliza `data` contra los fields de la lista (usando el
     * validador compartido). Rechaza claves desconocidas y tipos no-data
     * (relation/computed). En modo `partial` solo procesa las claves dadas;
     * en modo completo aplica los `is_required` de todos los campos de datos.
     */
    /**
     * v0.1.294 — «Sin repetidos» (`is_unique`): se ofrecía al configurar el
     * campo pero el servidor jamás lo verificaba (cualquier alta, pegado o
     * import dejaba valores repetidos). Se verifica en la MISMA transacción de
     * la escritura, sólo para los campos que vienen en el cambio, con un lock
     * por (lista, campo, valor) para que dos altas simultáneas del mismo valor
     * no pasen las dos. El texto se compara sin mayúsculas ni espacios en los
     * bordes («C-1» y « c-1 » son el mismo código); los números, por valor.
     */
    private async assertUniqueInTx(
        tx: Tx,
        tenantId: number,
        listId: number,
        fields: Field[],
        data: Record<string, unknown>,
        excludeId: number | null,
    ): Promise<void> {
        const errors: Record<string, string> = {};
        // C1 — los equipos de un campo «Equipo» tienen que existir en ESTA
        // empresa (el validador compartido no conoce los equipos). Una sola
        // consulta para todos los campos «Equipo» del payload.
        const teamFields = fields.filter((f) => f.type === 'team' && Array.isArray(data[jsonbKeyForField(f.id)]));
        if (teamFields.length > 0) {
            const wanted = [...new Set(teamFields.flatMap((f) => (data[jsonbKeyForField(f.id)] as unknown[]).map(Number)))].filter(
                (n) => Number.isInteger(n) && n > 0,
            );
            const found = wanted.length > 0
                ? new Set(
                      (
                          await tx
                              .select({ id: teams.id })
                              .from(teams)
                              .where(and(eq(teams.tenantId, tenantId), inArray(teams.id, wanted)))
                      ).map((r) => r.id),
                  )
                : new Set<number>();
            for (const f of teamFields) {
                const ids = (data[jsonbKeyForField(f.id)] as unknown[]).map(Number);
                if (ids.some((id) => !found.has(id))) errors[f.slug] = 'Ese equipo no existe en esta empresa.';
            }
        }
        for (const field of fields) {
            if (!field.is_unique) continue;
            const key = jsonbKeyForField(field.id);
            if (!(key in data)) continue;
            const value = data[key];
            if (typeof value !== 'string' && typeof value !== 'number') continue;
            if (typeof value === 'string' && value.trim() === '') continue;
            const norm = typeof value === 'string' ? value.trim().toLowerCase() : String(value);
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`uniq:${listId}:${field.id}:${norm}`}, 0))`);
            const same = typeof value === 'string'
                ? sql`lower(btrim(${records.data}->>${key})) = ${norm}`
                : sql`${records.data}->${key} = ${JSON.stringify(value)}::jsonb`;
            const hit = await tx
                .select({ id: records.id })
                .from(records)
                .where(
                    and(
                        eq(records.tenantId, tenantId),
                        eq(records.listId, listId),
                        isNull(records.deletedAt),
                        excludeId !== null ? sql`${records.id} <> ${excludeId}` : undefined,
                        same,
                    ),
                )
                .limit(1);
            if (hit.length > 0) {
                errors[field.slug] = `«${String(value).trim()}» ya está en otro registro: «${field.label}» no admite valores repetidos.`;
            }
        }
        if (Object.keys(errors).length > 0) {
            throw new BadRequestException({
                code: 'validation_failed',
                message: 'Datos del registro inválidos',
                data: { status: 400, errors },
            });
        }
    }

    private validateData(
        fields: Field[],
        rawData: Record<string, unknown>,
        opts: { partial: boolean },
    ): Record<string, unknown> {
        const byKey = new Map(fields.map((f) => [jsonbKeyForField(f.id), f]));
        const errors: Record<string, string> = {};
        const out: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(rawData)) {
            const field = byKey.get(key);
            if (!field) {
                errors[key] = 'Campo desconocido en esta lista';
                continue;
            }
            // v0.1.277 — el campo con IA lo escribe el servidor: un formulario
            // que reenvía su valor (sin cambiarlo) no rompe el guardado.
            // v0.1.300 — igual el ID automático y las columnas de sistema.
            // Campo «Botón»: no tiene valor; un formulario que lo reenvía no rompe.
            if (field.type === 'ai' || field.type === 'autonumber' || field.type === 'button' || isSystemField(field.type)) continue;
            if (!isDataField(field.type)) {
                errors[key] = `El tipo '${field.type}' no se escribe en los datos`;
                continue;
            }
            const result = validateFieldValue(
                { type: field.type, config: field.config, is_required: field.is_required },
                value,
            );
            if (!result.ok) {
                errors[field.slug] = result.error;
            } else if (result.value === null) {
                out[key] = null;
            } else {
                out[key] = result.value;
            }
        }

        if (!opts.partial) {
            // Alta: los campos de datos requeridos ausentes deben fallar.
            for (const field of fields) {
                if (!isUserWritableType(field.type)) continue;
                const key = jsonbKeyForField(field.id);
                if (!(key in rawData)) {
                    const result = validateFieldValue(
                        { type: field.type, config: field.config, is_required: field.is_required },
                        undefined,
                    );
                    if (!result.ok) errors[field.slug] = result.error;
                    else if (result.value !== null) out[key] = result.value; // ej. checkbox → false
                }
            }
        }

        if (Object.keys(errors).length > 0) {
            throw new BadRequestException({
                code: 'validation_failed',
                message: 'Datos del registro inválidos',
                data: { status: 400, errors },
            });
        }
        return out;
    }
}

function toRecord(
    row: (RecordRow | RecordListRow) & { formulaErrors?: Record<string, string> },
    relations: Record<string, number[]> = {},
    subtaskCount = 0,
): RecordDto {
    return {
        id: row.id,
        list_id: row.listId,
        data: row.data,
        relations,
        parent_id: row.parentId ?? null,
        subtask_count: subtaskCount,
        // El listado trae el booleano calculado en SQL; las lecturas de una
        // fila completa traen el documento y se deriva de él (v0.1.133).
        has_description:
            'hasDescription' in row ? row.hasDescription : (row.description ?? null) !== null,
        created_by: row.createdBy,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
        updated_by: effectiveUpdatedBy(row),
        // Fórmulas (A1): las que dieron error en esta fila, con el motivo.
        ...(row.formulaErrors ? { formula_errors: row.formulaErrors } : {}),
    };
}

/** A9 — el progreso del checklist sólo viaja si el registro tiene ítems. */
function withChecklist(p: { done: number; total: number } | undefined): { checklist?: { done: number; total: number } } {
    return p && p.total > 0 ? { checklist: p } : {};
}

/**
 * v0.1.300 — "Obligatorio si otro campo vale X" (field-rules.ts). Con `touched`,
 * sólo las reglas que involucran un campo que cambió. Mismo error que la
 * validación por campo (errores por slug).
 */
function assertRequiredIf(fields: Field[], data: Record<string, unknown>, touched?: ReadonlySet<string>): void {
    const failed = checkRequiredIf(fields, data, touched ? { touched } : {});
    if (failed.length === 0) return;
    throw new BadRequestException({
        code: 'validation_failed',
        message: 'Datos del registro inválidos',
        data: { status: 400, errors: Object.fromEntries(failed.map((e) => [e.field.slug ?? `f${e.field.id}`, e.message])) },
    });
}

/**
 * v0.1.300 — «Modificado por»: lo guardado, o —si el registro nunca se modificó—
 * quien lo creó. NULL si se modificó antes de que existiera la columna. La
 * misma regla que la expresión SQL (`systemFieldExpr`).
 */
function effectiveUpdatedBy(row: { updatedBy?: number | null; createdBy: number; createdAt: Date; updatedAt: Date }): number | null {
    if (row.updatedBy !== null && row.updatedBy !== undefined) return row.updatedBy;
    return row.updatedAt.getTime() === row.createdAt.getTime() ? row.createdBy : null;
}

/**
 * Separa del payload los campos tipo `relation` (van a la tabla `relations`,
 * no al JSONB). Acepta `null` (vaciar), un ID o un array de IDs; cualquier
 * otro shape rechaza con error por campo. Devuelve el `data` restante y los
 * sets a sincronizar.
 */
/**
 * C3 — Un INVITADO no escribe en los campos que no ve: los ocultos para su
 * acceso (los del lector incluidos) ni las relaciones. 403 con el campo.
 */
function assertGuestWritable(
    settings: Record<string, unknown>,
    fields: Field[],
    actor: Actor,
    rawData: Record<string, unknown>,
): void {
    if (actor.role !== 'guest') return;
    const hidden = hiddenFieldsFor(settings, actor);
    const blocked = new Set(guestExtraHidden(fields, actor));
    const byKey = new Map(fields.map((f) => [jsonbKeyForField(f.id), f]));
    for (const key of Object.keys(rawData)) {
        const f = byKey.get(key);
        if (f && (hidden.has(f.slug) || blocked.has(f.id))) {
            throw new ForbiddenException({
                code: 'field_hidden',
                message: `No tienes acceso al campo «${f.label}»`,
                data: { status: 403, errors: { [f.slug]: 'Sin acceso' } },
            });
        }
    }
}

function splitRelationValues(
    fields: Field[],
    rawData: Record<string, unknown>,
): {
    data: Record<string, unknown>;
    values: Array<{ field: Field; targetListId: number; ids: number[] }>;
} {
    const byKey = new Map(fields.filter((f) => f.type === 'relation').map((f) => [jsonbKeyForField(f.id), f]));
    const data: Record<string, unknown> = {};
    const values: Array<{ field: Field; targetListId: number; ids: number[] }> = [];
    const errors: Record<string, string> = {};

    for (const [key, value] of Object.entries(rawData)) {
        const field = byKey.get(key);
        if (!field) {
            data[key] = value;
            continue;
        }
        const targetListId = Number((field.config as { target_list_id?: unknown }).target_list_id ?? 0);
        if (!Number.isInteger(targetListId) || targetListId <= 0) {
            errors[field.slug] = 'El campo relation no tiene lista destino configurada';
            continue;
        }
        const raw = value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];
        const ids: number[] = [];
        let ok = true;
        for (const v of raw) {
            const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
            if (!Number.isInteger(n) || n <= 0) {
                ok = false;
                break;
            }
            if (!ids.includes(n)) ids.push(n);
        }
        if (!ok) {
            errors[field.slug] = 'La relación debe ser un ID o un array de IDs de registros';
            continue;
        }
        if (ids.length > 200) {
            errors[field.slug] = 'Una relación admite hasta 200 registros vinculados';
            continue;
        }
        values.push({ field, targetListId, ids });
    }

    if (Object.keys(errors).length > 0) {
        throw new BadRequestException({
            code: 'validation_failed',
            message: 'Datos del registro inválidos',
            data: { status: 400, errors },
        });
    }
    return { data, values };
}

/** `values` de splitRelationValues → mapa `f{id} → ids` para el DTO. */
function relationsToMap(
    values: Array<{ field: Field; targetListId: number; ids: number[] }>,
): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const { field, ids } of values) out[jsonbKeyForField(field.id)] = ids;
    return out;
}

/**
 * `fieldId → ids` (batchTargets) → mapa `f{id} → ids` para el DTO. Prefill:
 * TODO campo relation aparece con `[]` aunque no tenga vínculos (paridad con
 * el plugin — la UI lee `record.relations[slug]` sin chequear presencia).
 */
function byFieldToKeys(
    relFieldIds: number[],
    byField: Map<number, number[]> | undefined,
): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const id of relFieldIds) out[jsonbKeyForField(id)] = [];
    if (!byField) return out;
    for (const [fieldId, ids] of byField) out[jsonbKeyForField(fieldId)] = ids;
    return out;
}

/**
 * Claves ocultas para el rol + SEC-36: lookup/rollup restringidos y los
 * computed que dependen de cualquiera de ellos.
 */
function hiddenKeysWithDerived(
    fields: Field[],
    settings: Record<string, unknown>,
    actor: Actor,
    restricted: ReadonlySet<number>,
): Set<string> {
    const slugs = hiddenFieldsFor(settings, actor);
    const ids = new Set([
        ...fields.filter((f) => slugs.has(f.slug)).map((f) => f.id),
        ...restricted,
        // C3 — un invitado no ve las relaciones.
        ...guestExtraHidden(fields, actor),
    ]);
    return new Set([...withDependentComputed(fields, ids)].map((id) => jsonbKeyForField(id)));
}

/** Devuelve el record sin las claves de datos ocultas para el rol. */
function stripHidden(record: RecordDto, hiddenKeys: Set<string>): RecordDto {
    if (hiddenKeys.size === 0) return record;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record.data)) {
        if (!hiddenKeys.has(k)) data[k] = v;
    }
    const relations: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(record.relations ?? {})) {
        if (!hiddenKeys.has(k)) relations[k] = v;
    }
    if (record.formula_errors) {
        const errors: Record<string, string> = {};
        for (const [k, v] of Object.entries(record.formula_errors)) {
            if (!hiddenKeys.has(k)) errors[k] = v;
        }
        return { ...record, data, relations, formula_errors: errors };
    }
    return { ...record, data, relations };
}

/** Merge parcial: null borra la clave; el resto sobrescribe. */
function mergeData(
    current: Record<string, unknown>,
    patch: Record<string, unknown>,
): Record<string, unknown> {
    const merged = { ...current };
    for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete merged[key];
        else merged[key] = value;
    }
    return merged;
}

function subtaskError(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400 } });
}

function recordNotFound(id: number): NotFoundException {
    return new NotFoundException({
        code: 'record_not_found',
        message: `Registro ${id} no encontrado`,
        data: { status: 404 },
    });
}

/**
 * v0.1.209 — Restricciones de "filas concretas" del listado:
 *  - `ids`: sólo esos registros (una acción sobre una selección);
 *  - `related_to=<campo>:<registro>`: los que apuntan a ese registro por ese
 *    campo relation (las líneas de una orden de compra). El campo tiene que
 *    ser un relation DE ESTA LISTA: un id de otro campo o de otra lista se
 *    rechaza, como cualquier filtro fuera del whitelist.
 */
function pickWhere(tenantId: number, fields: Field[], query: ListRecordsQuery): SQL | undefined {
    let out: SQL | undefined;
    if (query.ids !== undefined) {
        const ids = [...new Set(query.ids.split(',').map(Number))].filter((n) => Number.isSafeInteger(n) && n > 0);
        out = ids.length > 0 ? inArray(records.id, ids) : sql`false`;
    }
    if (query.related_to !== undefined) {
        const [fieldId, targetId] = query.related_to.split(':').map(Number) as [number, number];
        const field = fields.find((f) => f.id === fieldId);
        if (!field || field.type !== 'relation') {
            throw new BadRequestException({
                code: 'invalid_related_to',
                message: 'El campo de «vinculados a» tiene que ser una relación de esta lista',
                data: { status: 400 },
            });
        }
        const rel = sql`EXISTS (SELECT 1 FROM relations r WHERE r.tenant_id = ${tenantId} AND r.field_id = ${fieldId} AND r.source_record_id = ${records.id} AND r.target_record_id = ${targetId})`;
        out = out ? and(out, rel) : rel;
    }
    return out;
}

/**
 * Inyecta los valores de los campos `computed` en `data` del row (evaluación
 * lazy en cada lectura — paridad con el hydrate del plugin; jamás se
 * persisten). Devuelve un row con `data` clonado; sin computeds es no-op.
 */
function withComputed<T extends { data: Record<string, unknown> }>(
    fields: Field[],
    row: T,
    /** Fórmulas (A1): sin runtime (la lista no tiene fórmulas) no se calculan. */
    rt?: FormulaRuntime,
): T & { formulaErrors?: Record<string, string> } {
    const computed = fields.filter((f) => f.type === 'computed');
    let out: T = row;
    if (computed.length > 0) {
        const data = { ...(row.data as Record<string, unknown>) };
        const getValue = (fieldId: number): unknown => data[jsonbKeyForField(fieldId)] ?? null;
        for (const field of computed) {
            data[jsonbKeyForField(field.id)] = evaluateComputed(field, fields, getValue);
        }
        out = { ...row, data };
    }
    // Las fórmulas van DESPUÉS: pueden usar calculados, lookups, rollups y
    // columnas de sistema (todos ya en `data`).
    return applyRowFormulas(fields, out, rt);
}

/**
 * `sort=field_{id}:{asc|desc},...` → expresiones ORDER BY tipadas. Whitelist
 * estricta: solo campos existentes de la lista con tipo ordenable; lo demás
 * se descarta en silencio (mismo criterio que el filter tree). NULLS LAST en
 * ambas direcciones — las celdas vacías siempre al final, estilo hoja.
 */
const NON_SORTABLE: readonly string[] = ['relation', 'file', 'computed', 'lookup', 'button', 'formula'];
/** Tipos cuyo orden es alfabético (expresión de texto). */
const TEXT_SORT_TYPES = new Set<string>(['text', 'long_text', 'email', 'url', 'phone', 'select', 'lookup', 'ai']);

export function parseFieldSort(
    raw: string | undefined,
    fieldsById: Map<number, FilterableField>,
    fields: readonly Field[] = [],
): SQL[] {
    if (raw === undefined || raw === '') return [];
    const byId = new Map(fields.map((f) => [f.id, f]));
    const out: SQL[] = [];
    for (const part of raw.split(',')) {
        const m = /^field_(\d+):(asc|desc)$/.exec(part.trim());
        if (!m) continue;
        const field = fieldsById.get(Number(m[1]));
        if (!field) continue;
        // Un campo con expresión SQL inyectada ordena aunque su tipo no
        // viva en `data`: computed numérico (v0.1.229) y, desde v0.1.252,
        // también el LOOKUP (el menú de la columna lo ofrecía y no hacía nada).
        const hasExpr = field.expr !== undefined;
        if (NON_SORTABLE.includes(field.type) && !hasExpr) continue;
        // Un rollup sin subconsulta (config sin resolver) no ordena.
        if (field.type === 'rollup' && !hasExpr) continue;
        const dir = m[2] === 'desc' ? sql`DESC` : sql`ASC`;
        // Fórmulas (A1): por su expresión; un texto como lo lee una persona.
        if (field.type === 'formula' && field.expr) {
            const e = field.formulaKind === 'text' ? sql`(${field.expr}) COLLATE "und-x-icu"` : sql`(${field.expr})`;
            out.push(sql`${e} ${dir} NULLS LAST`);
            continue;
        }
        // v0.1.286 — una selección se ordena como su CATÁLOGO de opciones
        // (Pendiente → En curso → Hecho, como el kanban), no por el valor
        // interno; lo que no está en el catálogo va después, por texto.
        const full = byId.get(field.id);
        if (field.type === 'select' && !hasExpr && full) {
            const values = selectOptionValues(full);
            const text = fieldTypedExpr(field);
            if (values.length > 0) {
                out.push(sql`array_position(ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[], ${text}) ${dir} NULLS LAST`);
            }
            out.push(sql`${text} COLLATE "und-x-icu" ${dir} NULLS LAST`);
            continue;
        }
        // C5 — «Aprobación»: en el orden del catálogo de estados (pendiente →
        // aprobada → rechazada → devuelta → cancelada); «sin pedir» al final.
        if (field.type === 'approval' && field.expr) {
            out.push(sql`array_position(ARRAY[${sql.join(APPROVAL_STATUSES.map((v) => sql`${v}`), sql`, `)}]::text[], ${field.expr}) ${dir} NULLS LAST`);
            continue;
        }
        // v0.1.286 — una persona se ordena por su NOMBRE (antes, como texto
        // de su id: «10» antes que «9»). El id se lee sólo si es un número.
        // v0.1.300 — «Creado por» / «Modificado por»: por el nombre de la persona.
        if (isSystemField(field.type) && systemFieldBaseType(field.type) === 'user' && field.expr) {
            out.push(sql`(SELECT u.name FROM users u WHERE u.id = (${field.expr})) COLLATE "und-x-icu" ${dir} NULLS LAST`);
            continue;
        }
        // v0.1.300 — el ID automático se ordena "natural": primero lo que va antes
        // del número (prefijo y año) y después el NÚMERO como número — por
        // texto «TCK-10000» quedaría antes que «TCK-9999». No sirve ordenar por
        // el id del registro: con altas en paralelo el id sale de la secuencia
        // antes de que el trigger tome el contador.
        if (field.type === 'autonumber') {
            const text = fieldTypedExpr(field);
            out.push(sql`regexp_replace(${text}, '[0-9]+$', '') COLLATE "und-x-icu" ${dir} NULLS LAST`);
            out.push(sql`(substring(${text} from '([0-9]+)$'))::numeric ${dir} NULLS LAST`);
            continue;
        }
        // C1 — un equipo se ordena por su NOMBRE (con varios, el primero por nombre).
        if (field.type === 'team' && !hasExpr) {
            const col = sql`(${records.data} -> ${sql.raw(`'f${field.id}'`)})`;
            out.push(
                sql`(SELECT min(t.name) FROM teams t WHERE jsonb_typeof(${col}) = 'array' AND ${col} @> jsonb_build_array(t.id)) COLLATE "und-x-icu" ${dir} NULLS LAST`,
            );
            continue;
        }
        if (field.type === 'user' && !hasExpr) {
            const raw = fieldTypedExpr(field);
            out.push(
                sql`(SELECT u.name FROM users u WHERE u.id = CASE WHEN ${raw} ~ '^[0-9]{1,18}$' THEN (${raw})::bigint END) COLLATE "und-x-icu" ${dir} NULLS LAST`,
            );
            continue;
        }
        const typed = fieldTypedExpr(field);
        // v0.1.252 — el texto se ordena como lo lee una persona: sin
        // distinguir mayúsculas y con «Épsilon» junto a «epsilon». La imagen
        // de Postgres (Alpine/musl) ordena `en_US.utf8` como C — mayúsculas
        // primero y los acentos al final. ICU viene en la imagen oficial.
        const expr = TEXT_SORT_TYPES.has(field.type) ? sql`${typed} COLLATE "und-x-icu"` : typed;
        out.push(sql`${expr} ${dir} NULLS LAST`);
    }
    return out;
}

/** Valores de las opciones de un select/multi_select, en el orden del catálogo. */
function selectOptionValues(field: Field): string[] {
    const options = (field.config as { options?: unknown }).options;
    if (!Array.isArray(options)) return [];
    return options
        .map((o) => (o && typeof o === 'object' ? (o as { value?: unknown }).value : undefined))
        .filter((v): v is string => typeof v === 'string');
}

/** Una casilla marcada (tolera los textos «0»/«false» que guardaban automatizaciones viejas). */
function isTruthyCheckbox(v: unknown): boolean {
    if (typeof v === 'string') return !['', '0', 'false', 'no'].includes(v.trim().toLowerCase());
    return v === true || (typeof v === 'number' && v !== 0);
}

/**
 * v0.1.287 — Lo que la edición en lote necesita saber de un error de `update`:
 * su código y mensaje, los errores por campo (validación, reglas de la tienda)
 * y, en un conflicto de deshacer, qué claves cambiaron.
 */
function describeError(err: unknown): {
    code: string;
    message: string;
    fieldErrors?: Record<string, string>;
    changed?: string[];
} {
    const res = (err as { getResponse?: () => unknown }).getResponse?.();
    const body = res && typeof res === 'object' ? (res as { code?: unknown; message?: unknown; data?: Record<string, unknown> }) : {};
    const code = typeof body.code === 'string' ? body.code : 'error';
    const message = typeof body.message === 'string' ? body.message : err instanceof Error ? err.message : 'Error';
    const data = body.data ?? {};
    let fieldErrors: Record<string, string> | undefined;
    if (code === 'validation_failed' && data.errors && typeof data.errors === 'object') {
        fieldErrors = data.errors as Record<string, string>;
    } else if ((code === 'store_field_locked' || code === 'store_invalid_value') && typeof data.field_id === 'number') {
        fieldErrors = { [`f${data.field_id}`]: message };
    }
    const changed = Array.isArray(data.changed) ? (data.changed as unknown[]).map(String) : undefined;
    return { code, message, ...(fieldErrors ? { fieldErrors } : {}), ...(changed ? { changed } : {}) };
}

/**
 * v0.1.287 — Clave de un par (grupo, subgrupo) de la vista agrupada en dos
 * niveles: el JSON de las dos claves crudas («(sin valor)» = `__null__`). El
 * front la arma igual para buscar las filas de cada subgrupo en el bundle.
 */
export function subGroupPairKey(group: string | null, sub: string | null): string {
    return JSON.stringify([group ?? '__null__', sub ?? '__null__']);
}
