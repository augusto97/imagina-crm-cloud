import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    bulkOperationSchema,
    fieldDefaultOf,
    isSystemField,
    type SystemFieldType,
    filterTreeSchema,
    flowBranch,
    flowNodeAt,
    flowPathKey,
    formatEmailFieldValue,
    jsonbKeyForField,
    parseFlowPath,
    readApprovalFlowId,
    readApprovalTriggerResults,
    readStoreListMarker,
    readWaitApprovalConfig,
    readWaitConfig,
    resolveTitleFieldId,
    storeCellAccess,
    storeValueError,
    tenantFormatSchema,
    waitResumeAt,
    zonedToday,
    APPROVAL_RESULT_BY_STATUS,
    APPROVAL_RESULT_LABELS,
    FALLBACK_TIME_ZONE,
    FOR_EACH_MAX_ITEMS,
    RESPONSE_BODY_MAX_BYTES,
    RESPONSE_NAME_RE,
    SCHEDULED_EACH_BATCH,
    SCHEDULED_EACH_MAX,
    type ActionLogEntry,
    type ActionSpec,
    type ApprovalResult,
    type ApprovalStatus,
    type AutomationRunStatus,
    type ConditionCheck,
    type ConditionData,
    type FilterGroup,
    type FlowBranch,
    type FlowPath,
    type ListRecordsQuery,
    type StoreListMarker,
    type TenantFormat,
} from '@imagina-base/shared';
import { and, asc, eq, gt, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { safeWebhookFetch, type SafeFetchResult } from '../common/safe-fetch';
import type { ApprovalEventInfo } from '../approvals/approval-hub';
import { ApprovalsService } from '../approvals/approvals.service';
import { maskHeaders, redactValues, type ConnectionParts } from '../connectors/connection-parts';
import { compileConnectorCall } from '../connectors/connector-actions';
import {
    buildIntegrationRequest,
    checkIntegrationResponse,
    compileIntegrationValues,
} from '../connectors/integration-calls';
import { ConnectorsService } from '../connectors/connectors.service';
import { buildWebhookRequest, type MergeFn } from './webhook-request';
import type { Tx } from '../db/client';
import { BillingService } from '../billing/billing.service';
import { CollectionsService } from '../collections/collections.service';
import { automationRuns, documentTemplates, lists, memberships, records, tenants, users } from '../db/schema';
import { tenantIsReadOnly } from '../tenancy/read-only';
import { FieldsRepository } from '../fields/fields.repository';
import { DocumentsService } from '../documents/documents.service';
import type { StoredFileRef } from '../files/files.service';
import { MAIL_MAX_ATTACHMENT_BYTES, type MailAttachment } from '../mail/mail.types';
import { MailService } from '../mail/mail.service';
import { fieldTypedExpr, type FilterableField } from '../records/query-builder';
import { RecordsRepository } from '../records/records.repository';
import { systemFieldValue } from '../records/through-fields';
import { RecordChangeHub } from '../records/record-change-hub';
import { RecordsService, type Actor } from '../records/records.service';
import { RelationsRepository } from '../records/relations.repository';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { IncidentHub, errorText } from '../incidents/incident-hub';
import { AutomationsRepository, type AutomationRow } from './automations.repository';
import {
    AutomationDispatcher,
    MAX_AUTOMATION_CHAIN_DEPTH,
    nextChain,
    type AutomationChain,
    type EventRunRef,
    type TriggerEvent,
} from './automation-dispatcher.service';
import { evaluateCondition, explainCondition, type ConditionOptions } from './condition-evaluator';
import { EmailComposer } from './email-composer';
import { coerceFieldValue, READ_ONLY_TYPES, type CoercibleField } from './field-coercion';
import {
    applyMergeTags,
    escapeHtml,
    labelResolverFor,
    regionalFormatterFor,
    singleTagToken,
    type LabelFieldLike,
} from './merge-tags';

const SYSTEM_USER = 0;
/** Lo que escribe una automatización lo escribe el sistema, con permisos de admin. */
const SYSTEM_ACTOR: Actor = { userId: SYSTEM_USER, role: 'admin' };
const MAX_IF_ELSE_DEPTH = 5;
const DEFAULT_FORMAT: Pick<TenantFormat, 'number_format' | 'date_format' | 'time_format'> = {
    number_format: 'comma_dot',
    date_format: 'ymd',
    time_format: 'h24',
};

/** Qué trigger_types reaccionan a cada evento de record. */
const TRIGGERS_FOR_EVENT: Record<TriggerEvent['trigger'], string[]> = {
    record_created: ['record_created'],
    record_updated: ['record_updated', 'field_changed'],
    // v0.1.251 — un cliente pagó un link de Mercado Pago o Wompi.
    payment_received: ['payment_received'],
    // v0.1.275 — alguien completó un formulario público de la lista.
    form_submitted: ['form_submitted'],
    // Campo «Botón» — alguien presionó un botón del registro.
    button_pressed: ['button_pressed'],
    // C5 — una solicitud de aprobación del registro se resolvió.
    approval_resolved: ['approval_resolved'],
};

interface PersonInfo {
    name: string;
    email: string;
}

interface RunContext {
    tenantId: number;
    listId: number;
    recordId: number | null;
    data: Record<string, unknown>;
    before?: Record<string, unknown>;
    /** slug → f{id} */
    slugToKey: Map<string, string>;
    /**
     * v0.1.178 — slug → {type, config} de la lista del trigger: lo que el
     * modificador `{{campo|label}}` necesita para traducir el value a la
     * etiqueta de la opción (Sí/No en checkbox).
     */
    fieldsBySlug: Map<string, LabelFieldLike>;
    /** v0.1.110 — payload crudo del webhook entrante ({{payload.x}}). */
    payload?: Record<string, unknown>;
    /** v0.1.221 — la automatización que corre (la edición en lote la nombra). */
    automation?: { id: number; name: string };
    /**
     * v0.1.251 — el cobro en contexto: el que acaba de pagarse (trigger
     * `payment_received`) o el link que creó una acción anterior. `{{pago.x}}`.
     */
    pago?: Record<string, unknown>;
    /** v0.1.275 — el formulario que se acaba de enviar (`{{formulario.nombre}}`). */
    form?: { id: number; name: string };
    /** Campo «Botón» — el botón que se presionó (`{{boton.nombre}}`, `{{boton.persona}}`). */
    button?: { field_id: number; label: string; user_id: number; user_name: string; user_email: string };
    /** v0.1.263 — zona de la empresa: `{{date.today}}` es el "hoy" de su reloj. */
    timeZone?: string;
    /** Formato regional de la empresa (`|fecha`, `|moneda` y los números tipeados). */
    format?: Pick<TenantFormat, 'number_format' | 'date_format' | 'time_format'>;
    /**
     * v0.1.266 — el último PDF generado en este run (`{{pdf.link}}`,
     * `{{pdf.nombre}}`) y los PDF ya armados por plantilla: un «Enviar email»
     * que adjunta la misma plantilla no la vuelve a dibujar.
     */
    pdf?: Record<string, unknown>;
    pdfs?: Map<number, { filename: string; buffer: Buffer; number: string | null }>;
    /**
     * v0.1.290 — Bytes que guardó la acción en curso al CONGELAR un documento
     * emitido: si su transacción revierte, se descartan (un storage no es
     * transaccional) y los PDF armados en ella salen del cache del run.
     */
    docUploads?: StoredFileRef[];
    /** La cadena de automatizaciones de la que viene este evento (tope y anti-loop). */
    chain?: AutomationChain;
    /**
     * C5 — la aprobación en contexto (`{{aprobacion.resultado}}`…): la que se
     * resolvió (disparador), la que pidió una acción anterior o la que terminó
     * de esperar «Esperar aprobación». Viaja en el contexto de una espera.
     */
    approval?: ApprovalEventInfo;
    /** Personas de los campos «Persona» (`{{responsable.email}}`), por id. */
    people?: Map<number, PersonInfo | null>;
    /** Marca de tienda por lista, leída una vez por corrida. */
    storeMarkers?: Map<number, StoreListMarker | null>;
    /**
     * v0.1.288 — la respuesta del ÚLTIMO webhook/conector (`{{webhook.status}}`,
     * `{{webhook.body.x}}`) y las guardadas con nombre
     * (`{{respuestas.<nombre>.body.x}}`). Viajan en el contexto de una espera.
     */
    webhook?: ResponseInfo;
    responses?: Record<string, ResponseInfo>;
    /**
     * v0.1.288 — el registro vinculado en curso dentro de «Repetir por cada
     * registro vinculado» (`{{item.slug}}`, `{{item.record.id}}`).
     */
    item?: ItemContext;
    /** v0.1.288 — «Probar»: simulación sin efectos (ver `simulate`). */
    sim?: SimulationState;
}

/** v0.1.288 — una respuesta HTTP guardada para los pasos siguientes. */
interface ResponseInfo {
    status: number;
    /** JSON ya leído (o el texto, si no era JSON o llegó recortado). */
    body: unknown;
    truncated?: boolean;
    /** «Probar» sin ejecutarla de verdad: no hay respuesta real. */
    simulated?: boolean;
}

/** v0.1.288 — el registro vinculado en curso dentro de un bucle. */
interface ItemContext {
    listId: number;
    listName: string;
    recordId: number;
    data: Record<string, unknown>;
    slugToKey: Map<string, string>;
    fieldsBySlug: Map<string, LabelFieldLike>;
}

/** v0.1.288 — estado de una simulación («Probar»). */
interface SimulationState {
    /** Rutas de los webhooks/conectores que se ejecutan DE VERDAD. */
    realSteps: Set<string>;
    /** Cuerpos de las respuestas reales (por ruta), para sugerir variables. */
    responses: Record<string, unknown>;
    /** Variables de respuestas que quedaron vacías por no ejecutarse de verdad. */
    unknownTokens: Set<string>;
    /** C5 — con qué resultado se simula una aprobación (si la persona lo eligió). */
    approvalResult?: ApprovalResult;
}

/** v0.1.288 — una pausa en un «Esperar»: cuándo y desde dónde se sigue. */
interface Pause {
    at: Date;
    waitPath: FlowPath;
    /** El paso que sigue a la espera (puede apuntar más allá del final de su rama). */
    resumePath: FlowPath;
    /** La config de la espera en el momento de pausar (su condición y su fecha). */
    wait: Record<string, unknown>;
    /** El campo de fecha de un «hasta una fecha» (para recalcular si cambia). */
    waitField: { key: string; label: string } | null;
    /** C5 — «Esperar aprobación»: la solicitud que se espera y el tope (si tiene). */
    approvalWait?: ApprovalWaitState;
}

/** C5 — lo que guarda una corrida en «Esperar aprobación». */
export interface ApprovalWaitState {
    request_id: number;
    /** Instante ISO en que se deja de esperar y sigue como «vencida» (null = sin tope). */
    deadline: string | null;
}

/**
 * C5 — Cada cuánto se revisa una corrida en «Esperar aprobación» aunque nadie
 * avise: la red de seguridad para un aviso perdido (el proceso se cayó entre
 * la decisión y el aviso) y para un registro que se fue a la papelera. Lo
 * normal es que la decisión la despierte en el acto.
 */
export const APPROVAL_WAIT_CHECK_MS = 6 * 60 * 60 * 1000;

/** v0.1.288 — lo que devuelve recorrer pasos: el log y, si hubo, una pausa o un corte. */
interface Flow {
    log: ActionLogEntry[];
    pause?: Pause;
    /** La corrida termina aquí (la espera no se pudo calcular, la condición no se cumple…). */
    stop?: boolean;
}

/**
 * v0.1.288 — lo que se persiste de una corrida en espera (`resume_state`):
 * el puntero, la espera y el contexto acumulado. Los mapas de campos y la
 * zona se vuelven a leer al reanudar (pueden haber cambiado).
 */
export interface ResumeState {
    v: 1;
    wait_path: FlowPath;
    resume_path: FlowPath;
    wait: Record<string, unknown>;
    wait_field: { key: string; label: string } | null;
    /** C5 — «Esperar aprobación» (ver `ApprovalWaitState`). */
    approval_wait?: ApprovalWaitState | null;
    had_fail: boolean;
    ctx: {
        data: Record<string, unknown>;
        before?: Record<string, unknown>;
        payload?: Record<string, unknown>;
        pago?: Record<string, unknown>;
        form?: { id: number; name: string };
        button?: { field_id: number; label: string; user_id: number; user_name: string; user_email: string };
        pdf?: Record<string, unknown>;
        webhook?: ResponseInfo;
        responses?: Record<string, ResponseInfo>;
        chain?: AutomationChain;
        approval?: ApprovalEventInfo;
    };
}

/** v0.1.288 — el resultado de una simulación (lo mapea el servicio). */
export interface SimulationResult {
    record: { id: number; title: string } | null;
    trigger: { matches: boolean; message: string; checks: ConditionCheck[]; notes: string[] };
    log: ActionLogEntry[];
    responses: Record<string, unknown>;
}

/** Lo mínimo de una automatización que el motor necesita (una guardada o la que se está editando). */
export type RunnableAutomation = Pick<
    AutomationRow,
    'id' | 'listId' | 'name' | 'triggerType' | 'triggerConfig' | 'actions' | 'isActive' | 'createdAt'
>;

/**
 * Motor de automatizaciones (paridad plugin). Ejecuta el modelo flexible:
 * trigger_config (field_filters + changed_fields) + actions[] con condición por
 * acción + `if_else` recursivo + merge tags. Corre en el worker BullMQ.
 *
 * Transacciones: cada ACCIÓN corre y se confirma por su cuenta (y la corrida
 * se abre en `running` antes y se cierra después). Antes toda la corrida era
 * UNA transacción: un vencimiento de 25.000 registros con correos y webhooks
 * adentro retenía locks durante minutos, y un reinicio a mitad deshacía las
 * corridas registradas DESPUÉS de que los correos ya habían salido (se
 * reenviaban). Lo que escriben `update_field`/`create_record` pasa por
 * RecordsService: actividad, tiempo real, avisos y las automatizaciones de la
 * lista destino, igual que si lo hubiera escrito una persona.
 */
/** v0.1.285 — intentos por registro de una automatización por vencimiento que falla. */
export const DUE_DATE_MAX_ATTEMPTS = 3;

/** v0.1.285 — nombre legible de cada paso, para el aviso de falla. */
const ACTION_NAMES: Record<string, string> = {
    send_email: 'Enviar email',
    call_webhook: 'Llamar webhook',
    connector_action: 'Acción de una app conectada',
    update_field: 'Actualizar campo',
    create_record: 'Crear registro',
    generate_pdf: 'Generar PDF',
    bulk_edit: 'Editar en lote',
    if_else: 'Condición',
    wait: 'Esperar',
    for_each_linked: 'Repetir por cada vinculado',
    request_approval: 'Pedir aprobación',
    wait_approval: 'Esperar aprobación',
    engine: 'Motor de automatizaciones',
};

/** Cuánto de la respuesta de un webhook fallido se muestra en el historial. */
const RESPONSE_SNIPPET = 200;

@Injectable()
export class AutomationEngine {
    private readonly logger = new Logger(AutomationEngine.name);
    /** v0.1.265 — arma el correo (diseño / texto / HTML + firma). Sin dependencias. */
    private readonly composer = new EmailComposer();
    private recordsSvc: RecordsService | null | undefined;

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly automations: AutomationsRepository,
        private readonly fields: FieldsRepository,
        private readonly recordsRepo: RecordsRepository,
        private readonly relationsRepo: RelationsRepository,
        private readonly mail: MailService,
        private readonly connectors: ConnectorsService,
        // v0.1.207 — Optional + al final: los specs que lo arman a mano siguen andando.
        @Optional() private readonly changes?: RecordChangeHub,
        // v0.1.221 — para encolar la acción «Editar en lote».
        @Optional() private readonly dispatcher?: AutomationDispatcher,
        // v0.1.228 — límite de registros del plan para create_record.
        @Optional() private readonly billing?: BillingService,
        // v0.1.251 — la acción «Crear link de pago» (Mercado Pago / Wompi).
        @Optional() private readonly collections?: CollectionsService,
        // v0.1.263 — zona horaria de la empresa (vencimientos, {{date.today}}).
        @Optional() private readonly timeZones?: TenantTimeZones,
        // v0.1.266 — documentos PDF (acción «Generar PDF» y adjuntos del correo).
        @Optional() private readonly documents?: DocumentsService,
        // v0.1.285 (ADR-S44) — una corrida fallida abre un problema y avisa.
        @Optional() private readonly incidents?: IncidentHub,
        // RecordsService vive en RecordsModule, que ya depende de este módulo
        // (el dispatcher es global): se resuelve al usarlo, sin ciclo de DI.
        @Optional() private readonly moduleRef?: ModuleRef,
    ) {}

    /**
     * El servicio de registros para escribir con todos sus efectos (actividad,
     * tiempo real, avisos, automatizaciones de la lista destino). Sin él (specs
     * que arman el motor a mano) se escribe por el camino mínimo.
     */
    private records(): RecordsService | null {
        if (this.recordsSvc === undefined) {
            try {
                this.recordsSvc = this.moduleRef?.get(RecordsService, { strict: false }) ?? null;
            } catch {
                this.recordsSvc = null;
            }
        }
        return this.recordsSvc;
    }

    /**
     * C5 — Las aprobaciones (pedir y esperar). Vive en su propio módulo, que
     * depende de registros y avisos: se resuelve al usarlo, sin ciclo de DI.
     */
    private approvalsSvc: ApprovalsService | null | undefined;
    private approvals(): ApprovalsService | null {
        if (this.approvalsSvc === undefined) {
            try {
                this.approvalsSvc = this.moduleRef?.get(ApprovalsService, { strict: false }) ?? null;
            } catch {
                this.approvalsSvc = null;
            }
        }
        return this.approvalsSvc;
    }

    /** Marca de lista de tienda (v0.1.213), o null. Una lectura por lista y por corrida. */
    private async storeMarkerOf(ctx: RunContext, listId: number): Promise<StoreListMarker | null> {
        ctx.storeMarkers ??= new Map();
        if (ctx.storeMarkers.has(listId)) return ctx.storeMarkers.get(listId) ?? null;
        const [row] = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
            tx
                .select({ settings: lists.settings })
                .from(lists)
                .where(and(eq(lists.tenantId, ctx.tenantId), eq(lists.id, listId)))
                .limit(1),
        );
        const marker = readStoreListMarker(row?.settings);
        ctx.storeMarkers.set(listId, marker);
        return marker;
    }

    /**
     * Trigger de record (record_created / record_updated). Devuelve las
     * corridas que abrió (el botón las consulta para decir cómo terminaron).
     */
    async process(event: TriggerEvent): Promise<EventRunRef[]> {
        const chain = event.chain;
        // Una cadena de automatizaciones que se pasó del tope no sigue
        // (un A → B → A → … no termina nunca).
        if (chain && chain.depth > MAX_AUTOMATION_CHAIN_DEPTH) {
            this.logger.warn(`Cadena de automatizaciones cortada en la profundidad ${chain.depth} (lista ${event.listId}).`);
            return [];
        }
        const prep = await this.tenantDb.withTenant(event.tenantId, async (tx) => {
            // SEC-34: empresa en solo-lectura (impaga/archivada) → no corre nada.
            if (await tenantIsReadOnly(tx, event.tenantId)) return null;
            const triggerTypes = TRIGGERS_FOR_EVENT[event.trigger];
            const autos = (
                await this.automations.activeByTriggers(tx, event.tenantId, event.listId, triggerTypes)
            )
                .filter((a) => !chain || !chain.automation_ids.includes(a.id)) // nunca se re-dispara a sí misma
                // Un botón que corre UNA automatización puntual.
                .filter((a) => !event.automation_ids || event.automation_ids.includes(a.id));
            if (autos.length === 0) return null;
            return { autos, maps: await this.fieldMaps(tx, event.tenantId, event.listId) };
        });
        if (!prep) return [];
        const runs: EventRunRef[] = [];
        // v0.1.300 — «Creado por», «Fecha de creación»…: las columnas de sistema no
        // viven en `data`; se leen UNA vez para las condiciones y variables.
        const sysData = await this.systemData(event.tenantId, event.recordId, prep.maps);
        for (const auto of prep.autos) {
            const ctx: RunContext = {
                tenantId: event.tenantId,
                listId: event.listId,
                recordId: event.recordId,
                data: { ...event.after, ...sysData },
                before: event.before,
                ...prep.maps,
                ...(event.payment ? { pago: event.payment } : {}),
                ...(event.form ? { form: event.form } : {}),
                ...(event.button ? { button: event.button } : {}),
                ...(event.approval ? { approval: event.approval } : {}),
                ...(chain ? { chain } : {}),
            };
            if (!this.triggerMatches(auto, ctx)) continue;
            const runId = await this.runOne(ctx, auto);
            if (runId !== null) runs.push({ automation_id: auto.id, run_id: runId });
        }
        return runs;
    }

    /** Trigger `scheduled` (cron): corre una automatización sin record. */
    async runScheduled(tenantId: number, automationId: number): Promise<void> {
        const prep = await this.tenantDb.withTenant(tenantId, async (tx) => {
            // SEC-34: empresa en solo-lectura (impaga/archivada) → no corre nada.
            if (await tenantIsReadOnly(tx, tenantId)) return null;
            const auto = await this.automations.findById(tx, tenantId, automationId);
            if (!auto || !auto.isActive) return null;
            return { auto, maps: await this.fieldMaps(tx, tenantId, auto.listId) };
        });
        if (!prep) return;
        // v0.1.288 — «Ejecutar para cada registro que cumpla…»: una corrida
        // por registro, en tandas encoladas.
        if (prep.auto.triggerConfig.for_each_record === true) {
            await this.runScheduledEach(prep.auto);
            return;
        }
        await this.runOne({ tenantId, listId: prep.auto.listId, recordId: null, data: {}, ...prep.maps }, prep.auto);
    }

    /**
     * v0.1.288 — Programado «para cada registro»: busca los registros que
     * cumplen el filtro (con el MISMO motor de filtros de la tabla, fechas
     * relativas en la zona de la empresa), hasta `SCHEDULED_EACH_MAX`, y
     * encola tandas de `SCHEDULED_EACH_BATCH` (cada tanda corre aparte: un
     * disparo de mil registros con correos no retiene un hueco de la cola
     * durante minutos). Lo que pasa del tope queda como problema a la vista.
     */
    private async runScheduledEach(auto: AutomationRow): Promise<void> {
        const svc = this.records();
        if (!svc) {
            this.logger.warn(`Automatización ${auto.id}: «para cada registro» sin servicio de registros.`);
            return;
        }
        let filter: FilterGroup | undefined;
        if (auto.triggerConfig.records_filter) {
            const parsed = filterTreeSchema.safeParse(auto.triggerConfig.records_filter);
            if (!parsed.success) {
                this.incidents?.report({
                    tenantId: auto.tenantId,
                    key: `automation:${auto.id}`,
                    source: 'automation',
                    sourceId: auto.id,
                    listId: auto.listId,
                    title: `Falló la automatización «${auto.name}»`,
                    message: 'El filtro «para cada registro» del horario está mal configurado: revísalo en el editor.',
                });
                return;
            }
            filter = parsed.data;
        }
        const ids: number[] = [];
        let cursor: number | undefined;
        while (ids.length <= SCHEDULED_EACH_MAX) {
            const page = await svc.list(auto.tenantId, SYSTEM_ACTOR, String(auto.listId), {
                limit: 200,
                sort_dir: 'asc',
                ...(cursor !== undefined ? { cursor } : {}),
                ...(filter ? { filter_tree: filter } : {}),
            } as ListRecordsQuery);
            for (const r of page.data) ids.push(r.id);
            const next = page.meta.next_cursor;
            if (!next) break;
            cursor = Number(next);
        }
        const over = ids.length > SCHEDULED_EACH_MAX;
        const picked = ids.slice(0, SCHEDULED_EACH_MAX);
        if (over) {
            this.incidents?.report({
                tenantId: auto.tenantId,
                key: `automation:${auto.id}:each-limit`,
                source: 'automation',
                sourceId: auto.id,
                listId: auto.listId,
                title: `«${auto.name}»: más de ${SCHEDULED_EACH_MAX} registros cumplían el filtro`,
                message: `En este disparo se procesaron los primeros ${SCHEDULED_EACH_MAX} (por antigüedad). Acota el filtro para que entren todos.`,
            });
        } else {
            this.incidents?.resolve(auto.tenantId, `automation:${auto.id}:each-limit`);
        }
        for (let i = 0; i < picked.length; i += SCHEDULED_EACH_BATCH) {
            const batch = picked.slice(i, i + SCHEDULED_EACH_BATCH);
            const queued = this.dispatcher?.dispatchScheduledBatch({ tenantId: auto.tenantId, automationId: auto.id, recordIds: batch }) ?? false;
            if (!queued) await this.runScheduledBatch(auto.tenantId, auto.id, batch);
        }
    }

    /** v0.1.288 — una tanda de «para cada registro»: una corrida por registro. */
    async runScheduledBatch(tenantId: number, automationId: number, recordIds: number[]): Promise<void> {
        const ids = recordIds.filter((n) => Number.isInteger(n) && n > 0).slice(0, SCHEDULED_EACH_BATCH);
        if (ids.length === 0) return;
        const prep = await this.tenantDb.withTenant(tenantId, async (tx) => {
            // SEC-34: empresa en solo-lectura (impaga/archivada) → no corre nada.
            if (await tenantIsReadOnly(tx, tenantId)) return null;
            const auto = await this.automations.findById(tx, tenantId, automationId);
            if (!auto || !auto.isActive || auto.triggerType !== 'scheduled') return null;
            const rows = await tx
                .select({ id: records.id, data: records.data })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, auto.listId), inArray(records.id, ids), isNull(records.deletedAt)))
                .orderBy(asc(records.id));
            return { auto, rows, maps: await this.fieldMaps(tx, tenantId, auto.listId) };
        });
        if (!prep) return;
        for (const rec of prep.rows) {
            await this.runOne({ tenantId, listId: prep.auto.listId, recordId: rec.id, data: rec.data, ...prep.maps }, prep.auto);
        }
    }

    /**
     * v0.1.110 — Trigger `incoming_webhook`: dispara con el PAYLOAD del POST
     * público como contexto. Las claves del payload que coinciden con slugs
     * de la lista se mapean a `data` (así `{{slug}}`, las condiciones del
     * trigger y las de las acciones funcionan igual que siempre); el objeto
     * completo queda accesible como `{{payload.clave}}` (con paths anidados).
     */
    async runWebhook(
        tenantId: number,
        automationId: number,
        payload: Record<string, unknown>,
    ): Promise<void> {
        const prep = await this.tenantDb.withTenant(tenantId, async (tx) => {
            // SEC-34: empresa en solo-lectura (impaga/archivada) → no corre nada.
            if (await tenantIsReadOnly(tx, tenantId)) return null;
            const auto = await this.automations.findById(tx, tenantId, automationId);
            if (!auto || !auto.isActive || auto.triggerType !== 'incoming_webhook') return null;
            return { auto, maps: await this.fieldMaps(tx, tenantId, auto.listId) };
        });
        if (!prep) return;
        const { auto, maps } = prep;
        const data: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(payload)) {
            const key = maps.slugToKey.get(k);
            if (key !== undefined) data[key] = v;
        }
        const ctx: RunContext = { tenantId, listId: auto.listId, recordId: null, data, ...maps, payload };
        if (!evaluateCondition(auto.triggerConfig.field_filters as ConditionData | undefined, this.accessor(ctx), this.condOpts(ctx))) {
            return;
        }
        await this.runOne(ctx, auto);
    }

    /**
     * Trigger `due_date_reached`: por cada record cuyo campo fecha venció
     * (valor + offset ≤ now) y que la automatización todavía no corrió PARA
     * ESA FECHA, ejecuta. Cada registro se confirma por su cuenta.
     *
     * - Una fecha que se corre (reprogramada, o la recurrencia que la rueda
     *   al mes siguiente) vuelve a disparar: cuenta como corrida sólo la que
     *   se registró DESPUÉS del momento de disparo actual.
     * - Una automatización nueva NO dispara por fechas viejas (meses de
     *   facturas vencidas = cientos de correos de golpe): sólo cuentan los
     *   momentos desde que se creó (para una fecha sin hora, desde el inicio
     *   de ese día). `trigger_config.include_past: true` las incluye a
     *   propósito.
     */
    async runDueDate(tenantId: number, automationId: number): Promise<void> {
        const prep = await this.tenantDb.withTenant(tenantId, async (tx) => {
            // SEC-34: empresa en solo-lectura (impaga/archivada) → no corre nada.
            if (await tenantIsReadOnly(tx, tenantId)) return null;
            const auto = await this.automations.findById(tx, tenantId, automationId);
            if (!auto || !auto.isActive || auto.triggerType !== 'due_date_reached') return null;
            const fieldRows = await this.fields.listByList(tx, tenantId, auto.listId);
            return { auto, fieldRows, maps: await this.fieldMaps(tx, tenantId, auto.listId) };
        });
        if (!prep) return;
        const { auto, fieldRows, maps } = prep;
        const fieldId = resolveDateFieldId(auto.triggerConfig, fieldRows);
        if (fieldId === null) return;
        const offset = Number(auto.triggerConfig.offset_minutes ?? 0) || 0;
        const field = fieldRows.find((f) => f.id === fieldId);
        if (!field || (field.type !== 'date' && field.type !== 'datetime')) return;

        // v0.1.263 — una fecha SIN hora («vence el 7») vence a la medianoche
        // del reloj de la empresa, no a la de UTC (que en Colombia es el 6 a
        // las 7 pm). Un datetime ya es un instante y se compara tal cual.
        const tz = maps.timeZone ?? FALLBACK_TIME_ZONE;
        const typed = fieldTypedExpr({ id: field.id, type: field.type as FilterableField['type'] });
        const dueExpr = field.type === 'date' ? sql`((${typed})::timestamp AT TIME ZONE ${tz})` : typed;
        // El momento de disparo de ESTE valor de la fecha.
        const fireAt = sql`(${dueExpr} + make_interval(mins => ${offset}))`;
        const createdAt = auto.createdAt.toISOString();
        const floor =
            auto.triggerConfig.include_past === true
                ? undefined
                : field.type === 'date'
                  ? sql`${fireAt} >= (date_trunc('day', ${createdAt}::timestamptz AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`
                  : sql`${fireAt} >= ${createdAt}::timestamptz`;
        // Ya corrió para este valor si hay una corrida (no fallida) registrada
        // desde su momento de disparo. v0.1.285 — una corrida fallida se
        // reintenta, con tope: antes una automatización rota corría (y
        // fallaba, y volvía a mandar los pasos que sí salían) cada 5 minutos
        // por registro, para siempre.
        const alreadyRan = sql`(exists (select 1 from automation_runs ar
                where ar.tenant_id = ${tenantId} and ar.automation_id = ${auto.id}
                  and ar.record_id = ${records.id} and ar.status <> 'failed'
                  and ar.created_at >= ${fireAt})
                or (select count(*) from automation_runs ar
                where ar.tenant_id = ${tenantId} and ar.automation_id = ${auto.id}
                  and ar.record_id = ${records.id} and ar.status = 'failed'
                  and ar.created_at >= ${fireAt}) >= ${DUE_DATE_MAX_ATTEMPTS})`;

        // v0.1.252 — keyset por id en tandas de 500. Antes era UN `limit 500`
        // sin orden: los vencidos que no pasan los field_filters no
        // registran run (a propósito: si vuelven a cumplir, disparan), así
        // que con más de 500 de esos la consulta devolvía SIEMPRE los
        // mismos y el resto de los vencidos no se procesaba nunca.
        const BATCH = 500;
        const MAX_BATCHES = 50;
        let afterId = 0;
        for (let batch = 0; batch < MAX_BATCHES; batch++) {
            const due = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx
                    .select({ id: records.id, data: records.data })
                    .from(records)
                    .where(
                        and(
                            eq(records.tenantId, tenantId),
                            eq(records.listId, auto.listId),
                            isNull(records.deletedAt),
                            gt(records.id, afterId),
                            lte(fireAt, sql`now()`),
                            floor,
                            sql`not ${alreadyRan}`,
                        ),
                    )
                    .orderBy(asc(records.id))
                    .limit(BATCH),
            );

            for (const rec of due) {
                const ctx: RunContext = { tenantId, listId: auto.listId, recordId: rec.id, data: rec.data, ...maps };
                // Los field_filters del trigger se evalúan AL DISPARAR (no
                // solo en process()): "recordar a los 20 días SI la factura
                // sigue pendiente" depende de esto. Un record filtrado no
                // registra run → si más adelante vuelve a cumplir, dispara.
                if (!evaluateCondition(auto.triggerConfig.field_filters as ConditionData | undefined, this.accessor(ctx), this.condOpts(ctx))) {
                    continue;
                }
                // Cada registro se confirma por su cuenta (ver la nota de la clase).
                await this.runOne(ctx, auto);
            }
            if (due.length < BATCH) break;
            afterId = due[due.length - 1]!.id;
        }
    }

    /**
     * v0.1.288 — Reanuda una corrida que estaba en un «Esperar» (el reloj de
     * las esperas ya la pasó a `running`). Antes de seguir revisa que todo
     * siga en pie: la automatización existe y está activa, la empresa no está
     * en solo-lectura (SEC-34), el paso de espera sigue en su lugar y el
     * registro no se borró — si algo falla, la corrida queda `cancelled` con
     * el motivo. El registro se RELEE (la foto de hace días no sirve) y, en una
     * espera «hasta una fecha», si la fecha se movió más adelante la espera se
     * re-programa. Después, la condición de «continuar sólo si…».
     */
    async resumeRun(tenantId: number, runId: number): Promise<void> {
        const loaded = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [run] = await tx
                .select()
                .from(automationRuns)
                .where(and(eq(automationRuns.tenantId, tenantId), eq(automationRuns.id, runId)))
                .limit(1);
            if (!run || run.status !== 'running' || !run.resumeState) return null;
            const auto = await this.automations.findById(tx, tenantId, run.automationId);
            const readOnly = await tenantIsReadOnly(tx, tenantId);
            const maps = auto ? await this.fieldMaps(tx, tenantId, auto.listId) : null;
            const record = auto && run.recordId !== null ? await this.recordsRepo.findById(tx, tenantId, auto.listId, run.recordId) : null;
            return { run, auto, readOnly, maps, record };
        });
        if (!loaded) return;
        const { run, auto, readOnly, maps, record } = loaded;
        const cancel = (reason: string): Promise<void> => this.cancelResumed(tenantId, runId, run.actionsLog ?? [], reason);
        const state = readResumeState(run.resumeState);
        if (!auto || !maps) return cancel('La automatización ya no existe.');
        if (!auto.isActive) return cancel('La automatización está pausada: la espera no siguió.');
        if (readOnly) return cancel('La empresa estaba en solo-lectura (pago pendiente) cuando tocaba seguir: la espera no siguió.');
        const waitNode = state ? flowNodeAt(auto.actions, state.wait_path)?.type : undefined;
        if (!state || (waitNode !== 'wait' && waitNode !== 'wait_approval')) {
            return cancel('La automatización cambió mientras esperaba: el paso «Esperar» ya no está en el mismo lugar.');
        }
        if (run.recordId !== null && !record) return cancel('El registro se eliminó mientras esperaba.');

        const ctx: RunContext = {
            tenantId,
            listId: auto.listId,
            recordId: run.recordId,
            data: record ? record.data : state.ctx.data,
            ...maps,
            ...(state.ctx.before ? { before: state.ctx.before } : {}),
            ...(state.ctx.payload ? { payload: state.ctx.payload } : {}),
            ...(state.ctx.pago ? { pago: state.ctx.pago } : {}),
            ...(state.ctx.form ? { form: state.ctx.form } : {}),
            ...(state.ctx.button ? { button: state.ctx.button } : {}),
            ...(state.ctx.pdf ? { pdf: state.ctx.pdf } : {}),
            ...(state.ctx.webhook ? { webhook: state.ctx.webhook } : {}),
            ...(state.ctx.responses ? { responses: state.ctx.responses } : {}),
            ...(state.ctx.chain ? { chain: state.ctx.chain } : {}),
            ...(state.ctx.approval ? { approval: state.ctx.approval } : {}),
            automation: { id: auto.id, name: auto.name },
        };
        const prior = run.actionsLog ?? [];
        const now = new Date();
        const waitKey = flowPathKey(state.wait_path);

        // C5 — «Esperar aprobación»: ¿se resolvió, venció el tope o sigue esperando?
        if (waitNode === 'wait_approval') {
            const checked = await this.checkApprovalWait(ctx, state, now);
            if (checked.kind === 'cancel') return cancel(checked.reason);
            if (checked.kind === 'repause') {
                await this.tenantDb.withTenant(tenantId, (tx) =>
                    this.automations.pauseRun(tx, tenantId, runId, {
                        actionsLog: prior,
                        resumeAt: checked.at,
                        resumeState: run.resumeState as Record<string, unknown>,
                        error: run.error ?? null,
                    }),
                );
                return;
            }
            const resumedApproval = ok('wait_approval', checked.message, { path: waitKey, resultado: ctx.approval?.resultado ?? '' });
            let flowA: Flow;
            try {
                flowA = await this.resumeFrom(ctx, auto.actions, state.resume_path, [], 0);
            } catch (err) {
                flowA = { log: [{ action: 'engine', status: 'failed', message: errorText(err, 2000), details: {} }] };
            }
            const logA = [...prior, resumedApproval, ...flowA.log];
            await this.finalize(ctx, auto, runId, logA, flowA.pause ?? null, state.had_fail || flowA.log.some((l) => l.status === 'failed'));
            return;
        }

        // «Hasta una fecha»: con el registro releído, ¿la fecha se movió?
        if (state.wait_field) {
            const target = waitResumeAt(state.wait, {
                now,
                timeZone: ctx.timeZone,
                field: { label: state.wait_field.label, value: ctx.data[state.wait_field.key] },
            });
            if (!target.ok) {
                const entry = skip('wait', `${target.message} La automatización no siguió.`);
                return this.finalize(ctx, auto, runId, [...prior, { ...entry, details: { path: waitKey } }], null, state.had_fail);
            }
            if (target.at.getTime() > now.getTime() + 30_000) {
                await this.tenantDb.withTenant(tenantId, (tx) =>
                    this.automations.pauseRun(tx, tenantId, runId, {
                        actionsLog: prior,
                        resumeAt: target.at,
                        resumeState: run.resumeState as Record<string, unknown>,
                        error: run.error ?? null,
                    }),
                );
                return;
            }
        }
        // «Continuar sólo si…»: sobre el registro de AHORA.
        const cond = state.wait.resume_condition as ConditionData | undefined;
        if (cond && !evaluateCondition(cond, this.accessor(ctx), this.condOpts(ctx))) {
            const entry = skip('wait', 'Al terminar la espera, el registro ya no cumplía la condición: la automatización no siguió.');
            return this.finalize(ctx, auto, runId, [...prior, { ...entry, details: { path: waitKey } }], null, state.had_fail);
        }
        const resumed = ok('wait', 'Terminó la espera: siguió con los pasos siguientes.', { path: waitKey });
        let flow: Flow;
        try {
            flow = await this.resumeFrom(ctx, auto.actions, state.resume_path, [], 0);
        } catch (err) {
            flow = { log: [{ action: 'engine', status: 'failed', message: errorText(err, 2000), details: {} }] };
        }
        const log = [...prior, resumed, ...flow.log];
        await this.finalize(ctx, auto, runId, log, flow.pause ?? null, state.had_fail || flow.log.some((l) => l.status === 'failed'));
    }

    private async cancelResumed(tenantId: number, runId: number, prior: ActionLogEntry[], reason: string): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            this.automations.finishRun(tx, tenantId, runId, {
                status: 'cancelled',
                actionsLog: [...prior, skip('wait', reason)],
                error: reason,
                finishedAt: new Date(),
            }),
        );
    }

    /**
     * v0.1.288 — «Probar» paso a paso. Corre la automatización (tal como se está
     * editando) contra un registro real con el MISMO código que una corrida de
     * verdad, en modo simulación: no escribe, no envía, no llama ni emite
     * números de documento. Lo que sí se ejecuta de verdad es lo que la
     * persona marcó (`realSteps`: webhooks/conectores, para ver la respuesta).
     * No abre corrida ni toca el historial.
     */
    async simulate(input: {
        tenantId: number;
        auto: RunnableAutomation;
        recordId?: number;
        realSteps: string[];
        /** Para un webhook entrante: los datos de la última captura. */
        payload?: Record<string, unknown> | null;
        /** C5 — con qué resultado se simula una aprobación. */
        approvalResult?: ApprovalResult;
    }): Promise<SimulationResult> {
        const { tenantId, auto } = input;
        const prep = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const fieldRows = await this.fields.listByList(tx, tenantId, auto.listId);
            const [list] = await tx
                .select({ settings: lists.settings })
                .from(lists)
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, auto.listId)))
                .limit(1);
            const where = input.recordId
                ? and(eq(records.tenantId, tenantId), eq(records.listId, auto.listId), eq(records.id, input.recordId), isNull(records.deletedAt))
                : and(eq(records.tenantId, tenantId), eq(records.listId, auto.listId), isNull(records.deletedAt));
            const [rec] = await tx.select({ id: records.id, data: records.data }).from(records).where(where).orderBy(sql`${records.id} desc`).limit(1);
            return { fieldRows, settings: (list?.settings ?? {}) as Record<string, unknown>, rec: rec ?? null, maps: await this.fieldMaps(tx, tenantId, auto.listId) };
        });
        // Sin registro: un horario «normal» y un webhook entrante corren así de verdad.
        const usesRecord = !(auto.triggerType === 'incoming_webhook' || (auto.triggerType === 'scheduled' && auto.triggerConfig.for_each_record !== true));
        const rec = usesRecord ? prep.rec : null;
        const data: Record<string, unknown> = rec ? { ...rec.data } : {};
        const payload = auto.triggerType === 'incoming_webhook' ? (input.payload ?? {}) : undefined;
        if (payload) {
            for (const [k, v] of Object.entries(payload)) {
                const key = prep.maps.slugToKey.get(k);
                if (key !== undefined) data[key] = v;
            }
        }
        const sim: SimulationState = {
            realSteps: new Set(input.realSteps),
            responses: {},
            unknownTokens: new Set(),
            ...(input.approvalResult ? { approvalResult: input.approvalResult } : {}),
        };
        const ctx: RunContext = {
            tenantId,
            listId: auto.listId,
            recordId: rec?.id ?? null,
            data,
            ...prep.maps,
            ...(payload ? { payload } : {}),
            automation: { id: auto.id, name: auto.name },
            sim,
        };
        const trigger = await this.explainTrigger(auto, ctx, { hasRecord: rec !== null, usesRecord, hasPayload: Object.keys(payload ?? {}).length > 0 });
        let log: ActionLogEntry[];
        try {
            log = (await this.runSteps(ctx, auto.actions, [], 0, 0)).log;
        } catch (err) {
            log = [{ action: 'engine', status: 'failed', message: errorText(err, 2000), details: {} }];
        }
        if (sim.unknownTokens.size > 0) {
            trigger.notes.push(
                `Estas variables quedarían vacías en la prueba porque su webhook no se ejecutó de verdad: ${[...sim.unknownTokens].map((t) => `{{${t}}}`).join(', ')}. Marca «Ejecutar de verdad» en ese paso para usarlas.`,
            );
        }
        let record: SimulationResult['record'] = null;
        if (rec) {
            const titleId = resolveTitleFieldId(prep.fieldRows.map((f) => ({ id: f.id, type: f.type as never })), prep.settings);
            const raw = titleId !== null ? rec.data[jsonbKeyForField(titleId)] : null;
            record = { id: rec.id, title: typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : `Registro #${rec.id}` };
        }
        return { record, trigger, log, responses: sim.responses };
    }

    /**
     * v0.1.288 — ¿El disparador coincidiría con este registro? Con la MISMA
     * evaluación de las condiciones, regla por regla, y notas de lo que una
     * prueba no puede saber (el valor anterior, la fecha de un horario).
     */
    private async explainTrigger(
        auto: RunnableAutomation,
        ctx: RunContext,
        info: { hasRecord: boolean; usesRecord: boolean; hasPayload: boolean },
    ): Promise<SimulationResult['trigger']> {
        const cfg = auto.triggerConfig ?? {};
        const notes: string[] = [];
        const reasons: string[] = [];
        const fv = this.accessor(ctx);
        const ex = explainCondition(cfg.field_filters as ConditionData | undefined, fv, this.condOpts(ctx));
        const checks = this.labelChecks(ctx, ex.checks);
        if (!ex.matched) reasons.push('el registro no cumple los filtros del disparador');
        if (info.usesRecord && !info.hasRecord) {
            return { matches: false, message: 'La lista no tiene registros para probar.', checks, notes };
        }
        const label = (slug: string): string => ctx.fieldsBySlug.get(slug)?.label ?? slug;
        switch (auto.triggerType) {
            case 'record_updated': {
                const changed = normalizeChangedFields(cfg);
                if (changed.length > 0) notes.push(`En la prueba se asume que cambió ${changed.map((c) => `«${label(c)}»`).join(' o ')}.`);
                break;
            }
            case 'field_changed': {
                const slug = typeof cfg.field === 'string' ? cfg.field : '';
                const key = ctx.slugToKey.get(slug);
                if (key && cfg.to_value !== undefined && cfg.to_value !== null && cfg.to_value !== '') {
                    const okTo = changeEndMatches(ctx.fieldsBySlug.get(slug), ctx.data[key], cfg.to_value);
                    checks.push({ field: slug, label: label(slug), op: 'eq', expected: cfg.to_value, actual: ctx.data[key] ?? null, ok: okTo });
                    if (!okTo) reasons.push(`«${label(slug)}» no tiene el valor «a» del disparador`);
                }
                notes.push(
                    cfg.from_value !== undefined && cfg.from_value !== null && cfg.from_value !== ''
                        ? `En una prueba no hay valor anterior: se asume que «${label(slug)}» venía de «${String(cfg.from_value)}».`
                        : `En la prueba se asume que «${label(slug)}» acaba de cambiar.`,
                );
                break;
            }
            case 'due_date_reached': {
                const slug = typeof cfg.due_field === 'string' ? cfg.due_field : '';
                const key = ctx.slugToKey.get(slug);
                const raw = key ? ctx.data[key] : undefined;
                const offset = Number(cfg.offset_minutes ?? 0) || 0;
                const minutes = Math.abs(offset);
                const target = waitResumeAt(
                    { mode: 'until_field', date_field: slug, offset_amount: minutes, offset_unit: 'minutes', offset_direction: offset < 0 ? 'before' : 'after' },
                    { now: new Date(), timeZone: ctx.timeZone, field: { label: label(slug), value: raw } },
                );
                if (!target.ok) {
                    reasons.push(target.message.replace(/\.$/, ''));
                } else if (target.at.getTime() > Date.now()) {
                    reasons.push(`todavía no llegó: dispararía el ${this.formatInstant(ctx, target.at)}`);
                } else {
                    notes.push(`El momento de disparo de este registro (${this.formatInstant(ctx, target.at)}) ya pasó.`);
                }
                break;
            }
            case 'scheduled': {
                if (cfg.for_each_record === true) {
                    notes.push('Corre una vez por cada registro que cumpla el filtro; la prueba usa uno.');
                    if (cfg.records_filter && ctx.recordId !== null) {
                        const svc = this.records();
                        const parsed = filterTreeSchema.safeParse(cfg.records_filter);
                        if (!parsed.success) {
                            reasons.push('el filtro «para cada registro» está mal configurado');
                        } else if (svc) {
                            const page = await svc.list(ctx.tenantId, SYSTEM_ACTOR, String(ctx.listId), {
                                limit: 1,
                                sort_dir: 'asc',
                                ids: String(ctx.recordId),
                                filter_tree: parsed.data,
                            } as ListRecordsQuery);
                            if (page.data.length === 0) reasons.push('este registro no cumple el filtro «para cada registro»');
                        }
                    }
                } else {
                    notes.push('Corre en su horario, sin un registro: las variables de campos quedan vacías.');
                }
                break;
            }
            case 'incoming_webhook':
                notes.push(
                    info.hasPayload
                        ? 'Se usan los datos del último pedido que llegó al webhook.'
                        : 'Todavía no llegó ningún dato al webhook: las variables {{payload.x}} quedan vacías.',
                );
                break;
            case 'payment_received':
                notes.push('En la prueba no hay un pago real: las variables {{pago.x}} quedan vacías.');
                break;
            case 'form_submitted':
                notes.push('Se asume que este registro llegó por el formulario.');
                break;
            case 'button_pressed':
                notes.push('Se asume que tú presionaste el botón en este registro.');
                break;
            case 'approval_resolved': {
                // C5 — la última solicitud del registro (del flujo filtrado), o un resultado supuesto.
                const svc = this.approvals();
                const flowId = readApprovalFlowId(cfg);
                const latest = svc && ctx.recordId !== null ? await svc.latestFor(ctx.tenantId, ctx.recordId, flowId) : null;
                const assumed: ApprovalResult =
                    ctx.sim?.approvalResult ?? (latest && latest.status !== 'pending' ? APPROVAL_RESULT_BY_STATUS[latest.status as Exclude<ApprovalStatus, 'pending'>] : 'aprobada');
                const status = statusOfResult(assumed);
                const info = latest && svc ? await svc.eventInfo(ctx.tenantId, latest) : null;
                ctx.approval = {
                    request_id: info?.request_id ?? 0,
                    flow_id: info?.flow_id ?? flowId,
                    flow_name: info?.flow_name ?? (flowId && svc ? ((await svc.flowName(ctx.tenantId, flowId)) ?? '') : ''),
                    status,
                    resultado: assumed,
                    motivo: info?.motivo || (assumed === 'rechazada' || assumed === 'devuelta' ? '(el motivo que escriba quien decide)' : ''),
                    decidio: info?.decidio || '(quien decida)',
                    solicito: info?.solicito ?? '',
                    nota: info?.nota ?? '',
                };
                notes.push(`Se asume que la aprobación${ctx.approval.flow_name ? ` «${ctx.approval.flow_name}»` : ''} se resolvió como «${APPROVAL_RESULT_LABELS[assumed]}».`);
                if (!(readApprovalTriggerResults(cfg) as readonly string[]).includes(status)) {
                    reasons.push(`el disparador no escucha el resultado «${APPROVAL_RESULT_LABELS[assumed]}»`);
                }
                break;
            }
            default:
                break;
        }
        const matches = reasons.length === 0;
        return {
            matches,
            message: matches ? 'El disparador coincidiría con este registro.' : `En la realidad no se dispararía: ${reasons.join('; ')}.`,
            checks,
            notes,
        };
    }

    /**
     * v0.1.300 — Valores de las columnas de sistema del registro (claves `f{id}`):
     * una lectura sólo si la lista tiene alguna.
     */
    private async systemData(
        tenantId: number,
        recordId: number | null,
        maps: Pick<RunContext, 'slugToKey' | 'fieldsBySlug'>,
    ): Promise<Record<string, unknown>> {
        const sys = [...maps.fieldsBySlug.entries()].filter(([, f]) => isSystemField(f.type));
        if (sys.length === 0 || recordId === null) return {};
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ createdAt: records.createdAt, updatedAt: records.updatedAt, createdBy: records.createdBy, updatedBy: records.updatedBy })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.id, recordId)))
                .limit(1),
        );
        if (!row) return {};
        const out: Record<string, unknown> = {};
        for (const [slug, f] of sys) {
            const key = maps.slugToKey.get(slug);
            if (key) out[key] = systemFieldValue(f.type as SystemFieldType, row);
        }
        return out;
    }

    /** slug → f{id}, slug → {type, config}, zona y formato regional de la empresa. */
    private async fieldMaps(
        tx: Tx,
        tenantId: number,
        listId: number,
    ): Promise<Pick<RunContext, 'slugToKey' | 'fieldsBySlug' | 'timeZone' | 'format'>> {
        const fieldRows = await this.fields.listByList(tx, tenantId, listId);
        const [tenant] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        const parsed = tenantFormatSchema.safeParse((tenant?.settings as Record<string, unknown> | null | undefined)?.format ?? {});
        return {
            slugToKey: new Map(fieldRows.map((f) => [f.slug, jsonbKeyForField(f.id)])),
            fieldsBySlug: new Map(fieldRows.map((f) => [f.slug, { type: f.type, config: f.config, label: f.label }])),
            timeZone: await this.tenantTimeZone(tx, tenantId),
            format: parsed.success ? parsed.data : DEFAULT_FORMAT,
        };
    }

    /** v0.1.263 — la zona de la empresa (UTC si todavía no eligió). */
    private async tenantTimeZone(tx: Tx, tenantId: number): Promise<string> {
        return this.timeZones ? this.timeZones.orUtc(tenantId, tx) : FALLBACK_TIME_ZONE;
    }

    private condOpts(ctx: RunContext): ConditionOptions {
        return { timeZone: ctx.timeZone ?? FALLBACK_TIME_ZONE };
    }

    /** ¿La automatización matchea el trigger? (field_filters + changed_fields + de/a). */
    private triggerMatches(auto: AutomationRow, ctx: RunContext): boolean {
        const cfg = auto.triggerConfig ?? {};
        // v0.1.275 — «Cuando se envía un formulario»: sin `form_id` vale
        // cualquiera de la lista; con uno, sólo ese.
        if (auto.triggerType === 'form_submitted') {
            const wanted = Number(cfg.form_id);
            if (Number.isInteger(wanted) && wanted > 0 && ctx.form?.id !== wanted) return false;
        }
        // Campo «Botón» — «Al presionar el botón»: sin `button_field_id` vale
        // cualquier botón de la lista; con uno, sólo ese.
        if (auto.triggerType === 'button_pressed') {
            if (!ctx.button) return false;
            const wanted = Number(cfg.button_field_id);
            if (Number.isInteger(wanted) && wanted > 0 && ctx.button.field_id !== wanted) return false;
        }
        // C5 — «Cuando se aprueba o se rechaza»: el flujo (vacío = cualquiera) y
        // los resultados elegidos (vacío = aprobada y rechazada).
        if (auto.triggerType === 'approval_resolved') {
            if (!ctx.approval) return false;
            const flowId = readApprovalFlowId(cfg);
            if (flowId !== null && ctx.approval.flow_id !== flowId) return false;
            if (!(readApprovalTriggerResults(cfg) as readonly string[]).includes(ctx.approval.status)) return false;
        }
        const fv = this.accessor(ctx);
        if (!evaluateCondition(cfg.field_filters as ConditionData | undefined, fv, this.condOpts(ctx))) return false;

        const changed = normalizeChangedFields(cfg);
        if (changed.length > 0) {
            if (!ctx.before) return false; // sin estado previo, fallamos cerrado.
            const someChanged = changed.some((slug) => {
                const key = ctx.slugToKey.get(slug);
                if (!key) return false;
                return JSON.stringify(ctx.before![key] ?? null) !== JSON.stringify(ctx.data[key] ?? null);
            });
            if (!someChanged) return false;
        }
        // «Cuando cambia un campo» DE un valor A otro (los dos opcionales; vacío
        // = cualquiera). La UI los guardaba y el motor los ignoraba: disparaba
        // con cualquier cambio del campo.
        if (auto.triggerType === 'field_changed' && typeof cfg.field === 'string' && cfg.field !== '') {
            const key = ctx.slugToKey.get(cfg.field);
            const field = ctx.fieldsBySlug.get(cfg.field);
            if (!key || !ctx.before) return false;
            if (!changeEndMatches(field, ctx.before[key], cfg.from_value)) return false;
            if (!changeEndMatches(field, ctx.data[key], cfg.to_value)) return false;
        }
        return true;
    }

    /**
     * Accessor de merge tags / condiciones. Además de `{{slug}}` (valor
     * actual) resuelve:
     * - `{{before.slug}}`: valor ANTERIOR al cambio (triggers de update —
     *   ej. la fecha de cobro que acaba de vencer ANTES de que la
     *   recurrencia la ruede al mes siguiente = el período facturado).
     * - `{{date.now}}` / `{{date.today}}`: timestamp/fecha del disparo.
     *   `date.now` es el instante (naive UTC en un texto, ISO con zona al
     *   escribir un campo fecha-hora) y `date.today` la fecha de HOY en el
     *   reloj de la empresa (v0.1.263).
     * - `{{responsable.email}}` / `{{responsable.nombre}}` de un campo Persona.
     */
    private accessor(ctx: RunContext, opts: { isoNow?: boolean } = {}): (slug: string) => unknown {
        return (token: string) => {
            if (token === 'date.now') {
                const now = new Date().toISOString();
                return opts.isoNow ? now : now.slice(0, 19).replace('T', ' ');
            }
            if (token === 'date.today') return zonedToday(ctx.timeZone ?? FALLBACK_TIME_ZONE);
            // v0.1.288 — el registro vinculado en curso de un bucle.
            if (token.startsWith('item.')) return this.itemValue(ctx, token.slice('item.'.length));
            // v0.1.288 — la respuesta del último webhook / conector y las guardadas con nombre.
            if (token === 'webhook' || token.startsWith('webhook.')) {
                return this.responseValue(ctx, token, ctx.webhook, token.slice('webhook.'.length));
            }
            if (token.startsWith('respuestas.')) {
                const [name = '', ...rest] = token.slice('respuestas.'.length).split('.');
                return this.responseValue(ctx, token, ctx.responses?.[name], rest.join('.'));
            }
            // Un campo Persona guarda el id: `.email` y `.nombre` lo hacen útil
            // en un correo («Para: {{responsable.email}}»).
            const person = /^(before\.)?([a-zA-Z0-9_]+)\.(email|nombre)$/.exec(token);
            if (person && isPersonType(ctx.fieldsBySlug.get(person[2]!)?.type)) {
                const key = ctx.slugToKey.get(person[2]!);
                const source = person[1] ? ctx.before : ctx.data;
                const id = Number(key !== undefined ? source?.[key] : undefined);
                const info = Number.isInteger(id) && id > 0 ? ctx.people?.get(id) : undefined;
                if (!info) return '';
                return person[3] === 'email' ? info.email : info.name;
            }
            if (token.startsWith('before.')) {
                const key = ctx.slugToKey.get(token.slice('before.'.length));
                return key !== undefined && ctx.before ? ctx.before[key] : undefined;
            }
            // v0.1.110 — {{payload.clave}} (paths anidados por punto) del
            // webhook entrante.
            if (token.startsWith('payload.')) {
                return getPath(ctx.payload, token.slice('payload.'.length));
            }
            // v0.1.251 — {{pago.link}}, {{pago.monto}}… del cobro en contexto.
            if (token.startsWith('pago.')) {
                const v = ctx.pago?.[token.slice('pago.'.length)];
                return v === null ? '' : v;
            }
            // v0.1.275 — {{formulario.nombre}} del formulario que se envió.
            if (token === 'formulario.nombre') return ctx.form?.name ?? '';
            // C5 — {{aprobacion.resultado}}, {{aprobacion.flujo}}, {{aprobacion.motivo}}…
            if (token.startsWith('aprobacion.')) return approvalValue(ctx.approval, token.slice('aprobacion.'.length));
            // Campo «Botón» — el botón que se presionó y quién lo presionó.
            if (token === 'boton.nombre') return ctx.button?.label ?? '';
            if (token === 'boton.persona') return ctx.button?.user_name ?? '';
            if (token === 'boton.email') return ctx.button?.user_email ?? '';
            // v0.1.266 — {{pdf.link}}, {{pdf.nombre}} del último PDF generado.
            if (token.startsWith('pdf.')) {
                const v = ctx.pdf?.[token.slice('pdf.'.length)];
                return v === null ? '' : v;
            }
            const key = ctx.slugToKey.get(token);
            if (key !== undefined) {
                const v = ctx.data[key];
                // En runs de webhook, un slug sin valor mapeado cae al payload.
                return v !== undefined ? v : ctx.payload?.[token];
            }
            return ctx.payload?.[token];
        };
    }

    /**
     * v0.1.288 — `{{item.slug}}`: el valor del registro vinculado en curso;
     * `{{item.record.id}}` su id; `{{item.responsable.email}}` de una persona.
     */
    private itemValue(ctx: RunContext, rest: string): unknown {
        const item = ctx.item;
        if (!item) return undefined;
        if (rest === 'record.id') return item.recordId;
        const person = /^([a-zA-Z0-9_]+)\.(email|nombre)$/.exec(rest);
        if (person && isPersonType(item.fieldsBySlug.get(person[1]!)?.type)) {
            const key = item.slugToKey.get(person[1]!);
            const id = Number(key !== undefined ? item.data[key] : undefined);
            const info = Number.isInteger(id) && id > 0 ? ctx.people?.get(id) : undefined;
            if (!info) return '';
            return person[2] === 'email' ? info.email : info.name;
        }
        const key = item.slugToKey.get(rest);
        return key !== undefined ? item.data[key] : undefined;
    }

    /**
     * v0.1.288 — `{{webhook.status}}`, `{{webhook.body}}`, `{{webhook.body.a.0.b}}`
     * (rutas anidadas con índices). Un objeto o una lista de objetos sale como
     * JSON (un `[object Object]` no le sirve a nadie); una lista de valores
     * simples, como lista (se une por coma en un texto).
     */
    private responseValue(ctx: RunContext, token: string, info: ResponseInfo | undefined, rest: string): unknown {
        if (!info || info.simulated) {
            if (ctx.sim) ctx.sim.unknownTokens.add(token);
            return undefined;
        }
        if (rest === 'status') return info.status;
        if (rest === '' || rest === 'body') return serializeResponseValue(info.body);
        if (!rest.startsWith('body.')) return undefined;
        const body = info.body;
        if (body === null || typeof body !== 'object') return undefined;
        return serializeResponseValue(getPath(body as Record<string, unknown>, rest.slice('body.'.length)));
    }

    /** `merge` (valores crudos) y `mergeHtml` (valores escapados) con etiquetas y formato regional. */
    private mergers(ctx: RunContext, fv = this.accessor(ctx)): { merge: MergeFn; mergeHtml: (s: unknown) => string } {
        // v0.1.178 — `{{campo|label}}` traduce el value a la etiqueta de la opción.
        // v0.1.288 — dentro de un bucle, `{{item.estado|label}}` usa los campos del vinculado.
        const fieldsBySlug = withItemFields(ctx);
        const labels = labelResolverFor(fieldsBySlug);
        const formatter = regionalFormatterFor(fieldsBySlug, ctx.format ?? DEFAULT_FORMAT, ctx.timeZone ?? FALLBACK_TIME_ZONE);
        const merge: MergeFn = (s, escapeValue) =>
            applyMergeTags(typeof s === 'string' ? s : '', fv, ctx.recordId, escapeValue, labels, formatter);
        // SEC-08: variante que escapa los valores interpolados para contexto HTML.
        const mergeHtml = (s: unknown): string => merge(s, escapeHtml);
        return { merge, mergeHtml };
    }

    /**
     * Carga (una vez por corrida y por persona) nombre y email de las personas
     * de los campos «Persona» del registro: `{{responsable.email}}` y el «Para»
     * que apunta a un campo Persona. Sólo miembros del equipo y activos.
     */
    private async ensurePeople(ctx: RunContext): Promise<void> {
        const userKeys = (fieldsBySlug: Map<string, LabelFieldLike>, slugToKey: Map<string, string>): string[] => {
            const out: string[] = [];
            for (const [slug, f] of fieldsBySlug) {
                // v0.1.300 — también «Creado por» / «Modificado por».
                if (!isPersonType(f.type)) continue;
                const key = slugToKey.get(slug);
                if (key) out.push(key);
            }
            return out;
        };
        // Las personas del registro que disparó y (v0.1.288) las del vinculado en curso.
        const sources: Array<{ keys: string[]; data: Record<string, unknown> }> = [];
        const own = userKeys(ctx.fieldsBySlug, ctx.slugToKey);
        if (own.length > 0) sources.push({ keys: own, data: ctx.data }, { keys: own, data: ctx.before ?? {} });
        if (ctx.item) {
            const itemKeys = userKeys(ctx.item.fieldsBySlug, ctx.item.slugToKey);
            if (itemKeys.length > 0) sources.push({ keys: itemKeys, data: ctx.item.data });
        }
        if (sources.length === 0) return;
        ctx.people ??= new Map();
        const ids = new Set<number>();
        for (const source of sources) {
            for (const key of source.keys) {
                const id = Number(source.data[key]);
                if (Number.isInteger(id) && id > 0 && !ctx.people.has(id)) ids.add(id);
            }
        }
        if (ids.size === 0) return;
        const rows = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
            tx
                .select({ id: users.id, name: users.name, email: users.email })
                .from(users)
                .innerJoin(memberships, eq(memberships.userId, users.id))
                .where(
                    and(
                        eq(memberships.tenantId, ctx.tenantId),
                        ne(memberships.role, 'client'),
                        inArray(users.id, [...ids]),
                        isNull(users.disabledAt),
                    ),
                ),
        );
        for (const id of ids) ctx.people.set(id, null);
        for (const r of rows) ctx.people.set(r.id, { name: r.name ?? '', email: r.email });
    }

    private async runOne(ctx: RunContext, auto: RunnableAutomation): Promise<number | null> {
        ctx.automation = { id: auto.id, name: auto.name };
        // v0.1.300 — las columnas de sistema para las variables (`{{creado_por}}`).
        if (ctx.recordId !== null && [...ctx.fieldsBySlug.entries()].some(([slug, f]) => isSystemField(f.type) && !(ctx.slugToKey.get(slug)! in ctx.data))) {
            ctx.data = { ...ctx.data, ...(await this.systemData(ctx.tenantId, ctx.recordId, ctx)) };
        }
        const startedAt = new Date();
        let runId: number | null = null;
        try {
            runId = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
                this.automations.startRun(tx, { tenantId: ctx.tenantId, automationId: auto.id, recordId: ctx.recordId, startedAt }),
            );
        } catch (err) {
            // La automatización se borró mientras se encolaba el evento.
            this.logger.warn(`No se pudo abrir la corrida de la automatización ${auto.id}: ${errorText(err)}`);
            return null;
        }
        if (runId === null) return null;

        let flow: Flow;
        try {
            flow = await this.runSteps(ctx, auto.actions, [], 0, 0);
        } catch (err) {
            flow = { log: [{ action: 'engine', status: 'failed', message: errorText(err, 2000), details: {} }] };
            this.logger.error(`Automatización ${auto.id} falló: ${String(err)}`);
        }
        await this.finalize(ctx, auto, runId, flow.log, flow.pause ?? null, flow.log.some((l) => l.status === 'failed'));
        return runId;
    }

    /**
     * Cierra una corrida (o la deja en espera). Una pausa guarda el puntero
     * y el contexto en `resume_state`: la reanudación la toma de ahí (Postgres
     * es la fuente de verdad, no un job de Redis que podría perderse).
     */
    private async finalize(
        ctx: RunContext,
        auto: RunnableAutomation,
        runId: number,
        log: ActionLogEntry[],
        pause: Pause | null,
        hadFail: boolean,
    ): Promise<void> {
        const firstFail = log.find((l) => l.status === 'failed')?.message ?? 'Falló una acción';
        try {
            await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
                pause
                    ? this.automations.pauseRun(tx, ctx.tenantId, runId, {
                          actionsLog: capLog(log),
                          resumeAt: pause.at,
                          resumeState: this.resumeStateOf(ctx, pause, hadFail) as unknown as Record<string, unknown>,
                          error: hadFail ? firstFail : null,
                      })
                    : this.automations.finishRun(tx, ctx.tenantId, runId, {
                          status: (hadFail ? 'failed' : 'success') satisfies AutomationRunStatus,
                          actionsLog: capLog(log),
                          error: hadFail ? firstFail : null,
                          finishedAt: new Date(),
                      }),
            );
        } catch (err) {
            this.logger.error(`No se pudo cerrar la corrida ${runId} de la automatización ${auto.id}: ${errorText(err)}`);
        }
        // Una pausa no es éxito ni falla: sólo se avisa si ya falló algo antes.
        if (pause && !hadFail) return;
        this.reportRun(ctx, auto, hadFail ? log : null);
    }

    /** Lo que se persiste de una corrida en espera (ver `ResumeState`). */
    private resumeStateOf(ctx: RunContext, pause: Pause, hadFail: boolean): ResumeState {
        return {
            v: 1,
            wait_path: pause.waitPath,
            resume_path: pause.resumePath,
            wait: pause.wait,
            wait_field: pause.waitField,
            ...(pause.approvalWait ? { approval_wait: pause.approvalWait } : {}),
            had_fail: hadFail,
            ctx: {
                // Con registro, al reanudar se RELEE: la foto sólo hace falta sin él.
                data: ctx.recordId === null ? ctx.data : {},
                ...(ctx.before ? { before: ctx.before } : {}),
                ...(ctx.payload ? { payload: ctx.payload } : {}),
                ...(ctx.pago ? { pago: ctx.pago } : {}),
                ...(ctx.form ? { form: ctx.form } : {}),
                ...(ctx.button ? { button: ctx.button } : {}),
                ...(ctx.pdf ? { pdf: ctx.pdf } : {}),
                ...(ctx.webhook ? { webhook: ctx.webhook } : {}),
                ...(ctx.responses ? { responses: ctx.responses } : {}),
                ...(ctx.chain ? { chain: ctx.chain } : {}),
                ...(ctx.approval ? { approval: ctx.approval } : {}),
            },
        };
    }

    /**
     * v0.1.285 (ADR-S44) — Una corrida fallida abre (o suma) el problema de esa
     * automatización y avisa a los admins; una corrida buena lo cierra.
     */
    private reportRun(ctx: RunContext, auto: RunnableAutomation, failedLog: ActionLogEntry[] | null): void {
        const key = `automation:${auto.id}`;
        if (!failedLog) {
            this.incidents?.resolve(ctx.tenantId, key);
            return;
        }
        const failed = failedLog.find((l) => l.status === 'failed');
        const step = failed ? (ACTION_NAMES[failed.action] ?? failed.action) : 'Acción';
        const where = ctx.recordId !== null ? ` (registro #${ctx.recordId})` : '';
        this.incidents?.report({
            tenantId: ctx.tenantId,
            key,
            source: 'automation',
            sourceId: auto.id,
            listId: auto.listId,
            title: `Falló la automatización «${auto.name}»`,
            message: `${step}: ${failed?.message ?? 'Falló una acción'}${where}`,
        });
    }

    /**
     * v0.1.288 — Recorre una secuencia de pasos desde `from`. Devuelve el log
     * y, si algún paso pausó (un «Esperar») o cortó la corrida, se detiene ahí:
     * la pausa ya trae el puntero al paso que sigue.
     */
    private async runSteps(ctx: RunContext, actions: readonly ActionSpec[], base: FlowPath, from: number, depth: number): Promise<Flow> {
        const log: ActionLogEntry[] = [];
        for (let i = from; i < actions.length; i++) {
            const spec = normalizeSpec(actions[i]);
            if (!spec) continue;
            const flow = await this.runStep(ctx, spec, [...base, i], depth);
            log.push(...flow.log);
            if (flow.pause || flow.stop) return { log, ...(flow.pause ? { pause: flow.pause } : {}), ...(flow.stop ? { stop: true } : {}) };
        }
        return { log };
    }

    /**
     * v0.1.288 — Retoma una corrida en el paso que sigue a una espera. La ruta
     * puede entrar a una rama de un si/sino: se corre lo que falta de la rama
     * (sin volver a evaluar la condición: ya se eligió) y después lo que sigue
     * al si/sino en la secuencia de afuera.
     */
    private async resumeFrom(ctx: RunContext, actions: readonly ActionSpec[], resumePath: FlowPath, base: FlowPath, depth: number): Promise<Flow> {
        if (resumePath.length === 1) return this.runSteps(ctx, actions, base, resumePath[0] as number, depth);
        const idx = resumePath[0] as number;
        const branch = resumePath[1] as FlowBranch;
        const node = actions[idx];
        if (!node || node.type !== 'if_else' || (branch !== 'then' && branch !== 'else')) {
            throw new Error('La automatización cambió mientras esperaba: no se encontró dónde seguir.');
        }
        const inner = await this.resumeFrom(ctx, flowBranch(node, branch) as ActionSpec[], resumePath.slice(2), [...base, idx, branch], depth + 1);
        if (inner.pause || inner.stop) return inner;
        const rest = await this.runSteps(ctx, actions, base, idx + 1, depth);
        return { log: [...inner.log, ...rest.log], ...(rest.pause ? { pause: rest.pause } : {}), ...(rest.stop ? { stop: true } : {}) };
    }

    /**
     * Ejecuta un paso: gate por condición de la acción → contenedores (si/sino,
     * bucle), esperar → acción concreta. Cada entrada del log lleva la ruta del
     * paso (`details.path`): el historial y «Probar» la usan para ubicarlo.
     */
    private async runStep(ctx: RunContext, spec: ActionSpec, path: FlowPath, depth: number): Promise<Flow> {
        const pathKey = flowPathKey(path);
        const tag = (entries: ActionLogEntry[]): ActionLogEntry[] =>
            entries.map((e) => (e.details && 'path' in e.details ? e : { ...e, details: { ...(e.details ?? {}), path: pathKey } }));
        await this.ensurePeople(ctx);
        const fv = this.accessor(ctx);
        if (spec.condition) {
            // La misma evaluación que decide el motor, regla por regla en «Probar».
            const ex = explainCondition(spec.condition, fv, this.condOpts(ctx));
            if (!ex.matched) {
                const entry = skip(spec.type, 'Condición de ejecución no cumplida.');
                if (ctx.sim) entry.details = { checks: this.labelChecks(ctx, ex.checks) };
                return { log: tag([entry]) };
            }
        }

        if (spec.type === 'if_else') return this.executeIfElse(ctx, spec.config ?? {}, path, depth);
        if (spec.type === 'for_each_linked') return this.executeLoop(ctx, spec.config ?? {}, path, depth);
        if (spec.type === 'wait') {
            const flow = this.executeWait(ctx, spec.config ?? {}, path);
            return { ...flow, log: tag(flow.log) };
        }
        // C5 — esperar a que se resuelva una aprobación (pausa durable).
        if (spec.type === 'wait_approval') {
            try {
                const flow = await this.executeWaitApproval(ctx, spec.config ?? {}, path);
                return { ...flow, log: tag(flow.log) };
            } catch (err) {
                return { log: tag([fail('wait_approval', explainError(err))]), stop: true };
            }
        }
        // C5 — pedir una aprobación: escribe por el servicio de aprobaciones
        // (su propia transacción, actividad, avisos y tiempo real).
        if (spec.type === 'request_approval') {
            try {
                return { log: tag([await this.requestApproval(ctx, spec.config ?? {})]) };
            } catch (err) {
                return { log: tag([{ action: spec.type, status: 'failed', message: explainError(err), details: {} }]) };
            }
        }

        // Escribir registros: por RecordsService (abre y confirma su propia
        // transacción, con actividad, tiempo real y automatizaciones).
        if (spec.type === 'update_field' || spec.type === 'create_record') {
            try {
                return {
                    log: tag([
                        spec.type === 'update_field'
                            ? await this.updateField(ctx, spec.config ?? {})
                            : await this.createRecord(ctx, spec.config ?? {}),
                    ]),
                };
            } catch (err) {
                return { log: tag([{ action: spec.type, status: 'failed', message: explainError(err), details: {} }]) };
            }
        }

        // v0.1.285 — cada acción en su propia transacción: un error de base de
        // datos en una acción no arrastra a las demás ni a la corrida.
        let out: ActionLogEntry | null = null;
        const pdfsBefore = new Set(ctx.pdfs?.keys() ?? []);
        ctx.docUploads = [];
        try {
            await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
                out = await this.execAction(tx, ctx, spec, pathKey);
            });
            ctx.docUploads = undefined;
            return { log: tag([out!]) };
        } catch (err) {
            // v0.1.290 — La transacción revirtió: lo que esta acción numeró o
            // congeló no existe. Fuera sus bytes y sus PDF del cache del run.
            const orphans = ctx.docUploads ?? [];
            ctx.docUploads = undefined;
            if (orphans.length > 0) await this.documents?.discardUploads(ctx.tenantId, orphans);
            for (const key of [...(ctx.pdfs?.keys() ?? [])]) if (!pdfsBefore.has(key)) ctx.pdfs?.delete(key);
            const done = out as ActionLogEntry | null;
            if (done?.status === 'failed') return { log: tag([done]) };
            const message = done ? `Se deshizo por un error de la base de datos: ${errorText(err)}` : errorText(err, 2000);
            return { log: tag([{ action: spec.type, status: 'failed', message, details: {} }]) };
        }
    }

    private async executeIfElse(ctx: RunContext, config: Record<string, unknown>, path: FlowPath, depth: number): Promise<Flow> {
        const fv = this.accessor(ctx);
        const ex = explainCondition(config.condition as ConditionData | undefined, fv, this.condOpts(ctx));
        const matched = ex.matched;
        const branch: FlowBranch = matched ? 'then' : 'else';
        const list = flowBranch({ config }, branch) as ActionSpec[];

        const summary: ActionLogEntry = {
            action: 'if_else',
            status: 'success',
            message: matched ? 'Se cumplió la condición → rama «Sí»' : 'No se cumplió la condición → rama «No»',
            details: {
                branch,
                count: list.length,
                path: flowPathKey(path),
                ...(ctx.sim ? { _sim: 'info', checks: this.labelChecks(ctx, ex.checks) } : {}),
            },
        };
        if (depth >= MAX_IF_ELSE_DEPTH) return { log: [summary] };
        const inner = await this.runSteps(ctx, list, [...path, branch], 0, depth + 1);
        return { log: [summary, ...inner.log], ...(inner.pause ? { pause: inner.pause } : {}), ...(inner.stop ? { stop: true } : {}) };
    }

    /**
     * v0.1.288 — «Esperar». Calcula cuándo seguir (la MISMA función que
     * muestra el editor) y devuelve una pausa: la corrida queda en `waiting`
     * con el puntero al paso siguiente. Si la hora ya pasó, sigue sin esperar.
     * Si la fecha del campo está vacía o no se puede leer, la corrida termina
     * aquí: seguir de inmediato mandaría «1 día antes» un aviso de una fecha
     * que no existe.
     */
    private executeWait(ctx: RunContext, config: Record<string, unknown>, path: FlowPath): Flow {
        if (ctx.item) {
            return { log: [skip('wait', 'No se puede esperar dentro de «Repetir por cada registro vinculado»: se saltó la espera.')] };
        }
        const w = readWaitConfig(config);
        let waitField: Pause['waitField'] = null;
        let value: unknown;
        if (w.mode === 'until_field') {
            const key = ctx.slugToKey.get(w.dateField);
            const def = ctx.fieldsBySlug.get(w.dateField);
            if (!key || !def) {
                return { log: [fail('wait', `El campo de fecha «${w.dateField}» ya no existe: revisa la espera en el editor.`)], stop: true };
            }
            if (def.type !== 'date' && def.type !== 'datetime') {
                return { log: [fail('wait', `«${def.label ?? w.dateField}» no es un campo de fecha.`)], stop: true };
            }
            waitField = { key, label: def.label ?? w.dateField };
            value = ctx.data[key];
        }
        const now = new Date();
        const target = waitResumeAt(config, {
            now,
            timeZone: ctx.timeZone,
            ...(waitField ? { field: { label: waitField.label, value } } : {}),
        });
        if (!target.ok) {
            if (target.reason === 'empty' || target.reason === 'invalid') {
                return { log: [skip('wait', `${target.message} La automatización no siguió.`)], stop: true };
            }
            return { log: [fail('wait', target.message)], stop: true };
        }
        const when = this.formatInstant(ctx, target.at);
        const resumeCond = config.resume_condition as ConditionData | undefined;
        if (ctx.sim) {
            const ex = resumeCond ? explainCondition(resumeCond, this.accessor(ctx), this.condOpts(ctx)) : null;
            const past = target.at.getTime() <= now.getTime();
            return {
                log: [
                    ok('wait', past ? `La hora de la espera ya pasó (${when}): seguiría sin esperar.` : `Esperaría hasta ${when}; los pasos siguientes correrían después.`, {
                        _sim: 'would_run',
                        resume_at: target.at.toISOString(),
                        ...(ex ? { checks: this.labelChecks(ctx, ex.checks), resume_condition_now: ex.matched } : {}),
                    }),
                ],
            };
        }
        // Un margen chico: con la hora encima, esperar un tick de reloj no tiene sentido.
        if (target.at.getTime() <= now.getTime() + 5_000) {
            return { log: [ok('wait', `La hora de la espera ya pasó (${when}): siguió sin esperar.`)] };
        }
        const last = path[path.length - 1] as number;
        return {
            log: [ok('wait', `En espera hasta ${when}.`, { resume_at: target.at.toISOString() })],
            pause: {
                at: target.at,
                waitPath: path,
                resumePath: [...path.slice(0, -1), last + 1],
                wait: config,
                waitField,
            },
        };
    }

    /**
     * C5 — «Pedir aprobación»: crea la solicitud (o reutiliza la pendiente del
     * mismo flujo) por el servicio de aprobaciones — que avisa a los
     * aprobadores, deja la actividad y refresca la ficha — y deja
     * `{{aprobacion.x}}` para los pasos siguientes (y para «Esperar aprobación»).
     */
    private async requestApproval(ctx: RunContext, cfg: Record<string, unknown>): Promise<ActionLogEntry> {
        if (ctx.recordId === null) return skip('request_approval', 'Pedir una aprobación necesita un registro (este disparo no tiene uno).');
        const flowId = readApprovalFlowId(cfg);
        if (flowId === null) return fail('request_approval', 'Elige el flujo de aprobación que se pide.');
        const svc = this.approvals();
        if (!svc) return fail('request_approval', 'Las aprobaciones no están disponibles en este servidor.');
        const { merge } = this.mergers(ctx);
        const note = typeof cfg.note === 'string' ? merge(cfg.note).trim().slice(0, 2000) : '';
        if (ctx.sim) {
            const name = (await svc.flowName(ctx.tenantId, flowId)) ?? `#${flowId}`;
            ctx.approval = {
                request_id: 0,
                flow_id: flowId,
                flow_name: name,
                status: 'pending',
                resultado: '',
                motivo: '',
                decidio: '',
                solicito: ctx.automation ? `Automatización «${ctx.automation.name}»` : '',
                nota: note,
            };
            return ok('request_approval', `Pediría la aprobación «${name}»${note ? ` con la nota «${note.slice(0, 120)}»` : ''}. En la prueba no se pide de verdad (nadie recibe el aviso).`, {
                _sim: 'would_run',
                flow: name,
            });
        }
        const res = await svc.requestBySystem(ctx.tenantId, ctx.listId, ctx.recordId, flowId, note, ctx.automation ?? null);
        ctx.approval = res.info;
        return ok(
            'request_approval',
            res.created
                ? `Pidió la aprobación «${res.info.flow_name}» (${res.stepsCount} ${res.stepsCount === 1 ? 'paso' : 'pasos'}; primero: ${res.firstStep}).`
                : `Ya había una solicitud pendiente de «${res.info.flow_name}» para este registro: se usa esa.`,
            { request_id: res.info.request_id, created: res.created },
        );
    }

    /**
     * C5 — «Esperar aprobación». La solicitud que se espera es la que pidió una
     * acción anterior de esta corrida (o la del disparador), y si no hay, la
     * pendiente del registro (del flujo elegido o de cualquiera). La corrida
     * queda en pausa DURABLE (la misma de «Esperar»): sigue en el acto cuando
     * alguien decide (el servicio de aprobaciones la despierta), o al vencer el
     * tope de días con resultado «vencida». Si ya estaba resuelta, sigue sin
     * esperar.
     */
    private async executeWaitApproval(ctx: RunContext, config: Record<string, unknown>, path: FlowPath): Promise<Flow> {
        if (ctx.item) {
            return { log: [skip('wait_approval', 'No se puede esperar una aprobación dentro de «Repetir por cada registro vinculado»: se saltó la espera.')] };
        }
        if (ctx.recordId === null) {
            return { log: [skip('wait_approval', 'Esperar una aprobación necesita un registro (este disparo no tiene uno).')], stop: true };
        }
        const svc = this.approvals();
        if (!svc) return { log: [fail('wait_approval', 'Las aprobaciones no están disponibles en este servidor.')], stop: true };
        const w = readWaitApprovalConfig(config);
        // La de esta corrida (acción anterior o disparador), si es del flujo pedido.
        let req =
            ctx.approval && ctx.approval.request_id > 0 && (w.flowId === null || ctx.approval.flow_id === w.flowId)
                ? await svc.findForEngine(ctx.tenantId, ctx.approval.request_id)
                : null;
        if (!req) req = await svc.findForWait(ctx.tenantId, ctx.recordId, w.flowId);

        if (ctx.sim) {
            const flowName = req?.flowName ?? ctx.approval?.flow_name ?? (w.flowId ? await svc.flowName(ctx.tenantId, w.flowId) : null) ?? 'la aprobación';
            const latest = req ?? (await svc.latestFor(ctx.tenantId, ctx.recordId, w.flowId));
            const assumed: ApprovalResult =
                ctx.sim.approvalResult ?? (latest && latest.status !== 'pending' ? APPROVAL_RESULT_BY_STATUS[latest.status as Exclude<ApprovalStatus, 'pending'>] : 'aprobada');
            ctx.approval = {
                ...(ctx.approval ?? { request_id: latest?.id ?? 0, flow_id: w.flowId, solicito: '', nota: '' }),
                flow_name: flowName,
                status: assumed === 'vencida' ? 'pending' : statusOfResult(assumed),
                resultado: assumed,
                motivo: assumed === 'rechazada' || assumed === 'devuelta' ? '(el motivo que escriba quien decide)' : '',
                decidio: assumed === 'vencida' ? '' : '(quien decida)',
            };
            const tope = w.timeoutDays ? ` (como mucho ${w.timeoutDays} ${w.timeoutDays === 1 ? 'día' : 'días'})` : '';
            return {
                log: [
                    ok(
                        'wait_approval',
                        `Esperaría a que se resuelva «${flowName}»${tope}. En la prueba se sigue como «${APPROVAL_RESULT_LABELS[assumed]}»: elige otro resultado arriba para probar las otras ramas.`,
                        { _sim: 'would_run', resultado: assumed },
                    ),
                ],
            };
        }

        if (!req) {
            return {
                log: [skip('wait_approval', 'No hay ninguna solicitud de aprobación pendiente para este registro: la automatización no siguió. Pon «Pedir aprobación» antes de la espera.')],
                stop: true,
            };
        }
        if (req.status !== 'pending') {
            ctx.approval = await svc.eventInfo(ctx.tenantId, req);
            return { log: [ok('wait_approval', `La aprobación «${req.flowName}» ya estaba resuelta (${ctx.approval.resultado}): siguió sin esperar.`, { resultado: ctx.approval.resultado })] };
        }
        ctx.approval = await svc.eventInfo(ctx.tenantId, req);
        const now = Date.now();
        const deadline = w.timeoutDays ? new Date(now + w.timeoutDays * 86_400_000) : null;
        const check = new Date(now + APPROVAL_WAIT_CHECK_MS);
        const at = deadline && deadline.getTime() < check.getTime() ? deadline : check;
        const last = path[path.length - 1] as number;
        return {
            log: [
                ok(
                    'wait_approval',
                    deadline
                        ? `Esperando la aprobación «${req.flowName}» (como mucho hasta ${this.formatInstant(ctx, deadline)}; si no, sigue como «vencida»).`
                        : `Esperando la aprobación «${req.flowName}».`,
                    { request_id: req.id, ...(deadline ? { deadline: deadline.toISOString() } : {}) },
                ),
            ],
            pause: {
                at,
                waitPath: path,
                resumePath: [...path.slice(0, -1), last + 1],
                wait: config,
                waitField: null,
                approvalWait: { request_id: req.id, deadline: deadline ? deadline.toISOString() : null },
            },
        };
    }

    /**
     * C5 — Al reanudar «Esperar aprobación» (la decisión la despertó, venció el
     * tope o tocó el chequeo periódico): seguir con el resultado, volver a
     * esperar o cancelar.
     */
    private async checkApprovalWait(
        ctx: RunContext,
        state: ResumeState,
        now: Date,
    ): Promise<{ kind: 'continue'; message: string } | { kind: 'repause'; at: Date } | { kind: 'cancel'; reason: string }> {
        const svc = this.approvals();
        const aw = state.approval_wait;
        if (!svc || !aw) return { kind: 'cancel', reason: 'No se pudo leer qué aprobación se esperaba.' };
        const req = await svc.findForEngine(ctx.tenantId, aw.request_id);
        if (!req) return { kind: 'cancel', reason: 'La solicitud de aprobación que se esperaba ya no existe.' };
        if (req.status !== 'pending') {
            ctx.approval = await svc.eventInfo(ctx.tenantId, req);
            return { kind: 'continue', message: `La aprobación «${req.flowName}» quedó ${ctx.approval.resultado}: siguió con los pasos siguientes.` };
        }
        const deadline = aw.deadline ? new Date(aw.deadline) : null;
        if (deadline && deadline.getTime() <= now.getTime() + 30_000) {
            ctx.approval = { ...(await svc.eventInfo(ctx.tenantId, req)), resultado: 'vencida' };
            return { kind: 'continue', message: `La aprobación «${req.flowName}» no se resolvió a tiempo: siguió como «vencida».` };
        }
        const check = new Date(now.getTime() + APPROVAL_WAIT_CHECK_MS);
        return { kind: 'repause', at: deadline && deadline.getTime() < check.getTime() ? deadline : check };
    }

    /**
     * v0.1.288 — «Repetir por cada registro vinculado». Trae los vinculados por
     * la relación (en cualquier sentido), con el filtro de la otra lista, y
     * corre las acciones anidadas una vez por cada uno (tope
     * `FOR_EACH_MAX_ITEMS`). El log NO lleva cada acción de cada ítem —con 200
     * vinculados explotaría—: una entrada resumen con el estado por ítem y el
     * detalle del primero y de hasta 3 que fallaron.
     */
    private async executeLoop(ctx: RunContext, config: Record<string, unknown>, path: FlowPath, depth: number): Promise<Flow> {
        const pathKey = flowPathKey(path);
        const done = (entry: ActionLogEntry): Flow => ({ log: [{ ...entry, details: { ...entry.details, path: pathKey } }] });
        if (ctx.item) return done(skip('for_each_linked', 'No se puede repetir dentro de otra repetición.'));
        if (ctx.recordId === null) return done(skip('for_each_linked', 'Repetir por los vinculados necesita un registro (este disparo no tiene uno).'));
        const inner = Array.isArray(config.actions) ? (config.actions as ActionSpec[]) : [];
        const linked = await this.linkedItems(ctx, Number(config.relation_field_id), config.filter_tree);
        if ('error' in linked) return done(fail('for_each_linked', linked.error));
        const { other, items, total, maps } = linked;
        if (items.length === 0) {
            return done(
                ok('for_each_linked', `Ningún registro vinculado de «${other.name}»${config.filter_tree ? ' cumplía el filtro' : ''}: no repitió nada.`, {
                    total: 0,
                    ...(ctx.sim ? { _sim: 'info' } : {}),
                }),
            );
        }
        const summary = {
            list: other.name,
            total,
            processed: 0,
            ok: 0,
            failed: 0,
            skipped: 0,
            truncated: total > items.length,
            items: [] as Array<{ id: number; status: string; message: string }>,
            samples: {} as Record<string, ActionLogEntry[]>,
        };
        let failSamples = 0;
        let firstLog: ActionLogEntry[] = [];
        const saved = ctx.item;
        try {
            for (const [i, rec] of items.entries()) {
                // «Probar» detalla el primero; el resto sólo se cuenta.
                if (ctx.sim && i > 0) break;
                ctx.item = { listId: other.id, listName: other.name, recordId: rec.id, data: rec.data, ...maps };
                const flow = await this.runSteps(ctx, inner, [...path, 'each'], 0, depth + 1);
                const failedEntry = flow.log.find((l) => l.status === 'failed');
                const status = failedEntry ? 'failed' : flow.log.length > 0 && flow.log.every((l) => l.status === 'skipped') ? 'skipped' : 'success';
                summary.processed++;
                if (status === 'failed') summary.failed++;
                else if (status === 'skipped') summary.skipped++;
                else summary.ok++;
                const message = (failedEntry?.message ?? flow.log.map((l) => l.message).filter(Boolean).join(' · ')).slice(0, 160);
                summary.items.push({ id: rec.id, status, message });
                if (i === 0) firstLog = flow.log;
                if (i === 0 || (status === 'failed' && failSamples < 3)) {
                    if (status === 'failed' && i !== 0) failSamples++;
                    summary.samples[String(rec.id)] = flow.log.map((l) => ({ ...l, message: (l.message ?? '').slice(0, 300) }));
                }
            }
        } finally {
            ctx.item = saved;
        }
        if (ctx.sim) {
            const more = items.length - 1;
            const entry = ok(
                'for_each_linked',
                `Repetiría para ${total} ${total === 1 ? 'registro vinculado' : 'registros vinculados'} de «${other.name}»${summary.truncated ? ` (sólo los primeros ${FOR_EACH_MAX_ITEMS})` : ''}. Abajo, la simulación del primero (#${items[0]!.id})${more > 0 ? `; los otros ${more} correrían igual` : ''}.`,
                { _sim: 'info', total, path: pathKey, items: items.slice(0, 20).map((r) => r.id) },
            );
            return { log: [entry, ...firstLog] };
        }
        const parts = [`Repitió para ${summary.processed} de ${total} ${total === 1 ? 'registro vinculado' : 'registros vinculados'} de «${other.name}»`];
        if (summary.truncated) parts.push(`(tope de ${FOR_EACH_MAX_ITEMS}: ${total - items.length} sin procesar)`);
        const tally = [`${summary.ok} bien`, ...(summary.failed > 0 ? [`${summary.failed} con fallas`] : []), ...(summary.skipped > 0 ? [`${summary.skipped} omitidos`] : [])];
        const message = `${parts.join(' ')}: ${tally.join(', ')}.`;
        const entry = summary.failed > 0 ? fail('for_each_linked', message, summary) : ok('for_each_linked', message, summary);
        return { log: [{ ...entry, details: { ...entry.details, path: pathKey } }] };
    }

    /**
     * v0.1.288 — Los registros vinculados al del run por una relación, en
     * cualquiera de los dos sentidos (la relación vive en esta lista o en la
     * otra y apunta aquí), con el filtro de la otra lista. Pasa por
     * `RecordsService.list`: el mismo whitelist de filtros que la tabla.
     */
    private async linkedItems(
        ctx: RunContext,
        relationFieldId: number,
        rawFilter: unknown,
    ): Promise<
        | { error: string }
        | {
              other: { id: number; name: string };
              items: Array<{ id: number; data: Record<string, unknown> }>;
              total: number;
              maps: Pick<ItemContext, 'slugToKey' | 'fieldsBySlug'>;
          }
    > {
        const svc = this.records();
        if (!svc) return { error: 'El servicio de registros no está disponible en este servidor.' };
        if (!Number.isInteger(relationFieldId) || relationFieldId <= 0) return { error: 'Elige la relación por la que se repite.' };
        const rel = await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const f = await this.fields.findAnyById(tx, ctx.tenantId, relationFieldId);
            if (!f || f.type !== 'relation') return null;
            const target = Number((f.config as { target_list_id?: unknown }).target_list_id ?? 0);
            let direction: 'forward' | 'reverse';
            let otherId: number;
            if (f.listId === ctx.listId) {
                direction = 'forward';
                otherId = target;
            } else if (target === ctx.listId) {
                direction = 'reverse';
                otherId = f.listId;
            } else {
                return null;
            }
            const [other] = await tx
                .select({ id: lists.id, name: lists.name })
                .from(lists)
                .where(and(eq(lists.tenantId, ctx.tenantId), eq(lists.id, otherId)))
                .limit(1);
            if (!other) return null;
            const maps = await this.fieldMaps(tx, ctx.tenantId, other.id);
            return { direction, other, maps: { slugToKey: maps.slugToKey, fieldsBySlug: maps.fieldsBySlug } };
        });
        if (!rel) return { error: 'La relación del bucle ya no existe o no conecta con esta lista: revísala en el editor.' };
        let filter: FilterGroup | undefined;
        if (rawFilter) {
            const parsed = filterTreeSchema.safeParse(rawFilter);
            if (!parsed.success) return { error: 'El filtro de los vinculados está mal configurado: revísalo en el editor.' };
            filter = parsed.data;
        }
        const page = await svc.list(
            ctx.tenantId,
            SYSTEM_ACTOR,
            String(rel.other.id),
            { limit: FOR_EACH_MAX_ITEMS, sort_dir: 'asc', with_total: true, ...(filter ? { filter_tree: filter } : {}) } as ListRecordsQuery,
            { related: { fieldId: relationFieldId, recordId: ctx.recordId!, direction: rel.direction } },
        );
        return {
            other: rel.other,
            items: page.data.map((r) => ({ id: r.id, data: r.data })),
            total: typeof page.meta.total === 'number' ? page.meta.total : page.data.length,
            maps: rel.maps,
        };
    }

    /** Las reglas de una condición con la etiqueta de cada campo (para «Probar»). */
    private labelChecks(ctx: RunContext, checks: Array<{ field: string; op: string; expected: unknown; actual: unknown; ok: boolean }>): ConditionCheck[] {
        const all = withItemFields(ctx);
        return checks.map((c) => ({
            ...c,
            // C5 — el pseudo-campo de las aprobaciones se nombra como en el editor.
            label: c.field === 'aprobacion.resultado' ? 'Resultado de la aprobación' : (all.get(c.field.replace(/^before\./, ''))?.label ?? c.field),
        }));
    }

    /** Un instante en el formato y la zona de la empresa («21/10/2026 14:30»). */
    private formatInstant(ctx: RunContext, at: Date): string {
        return formatEmailFieldValue({ type: 'datetime', config: {} }, at.toISOString(), {
            ...(ctx.format ?? DEFAULT_FORMAT),
            timezone: ctx.timeZone ?? FALLBACK_TIME_ZONE,
        });
    }

    /**
     * El valor que una acción va a escribir en un campo. Una variable SOLA
     * (`{{monto}}`) pasa con su valor CRUDO —número, lista de opciones,
     * booleano— en vez de convertirse en texto; si no, se resuelve la
     * plantilla. Para un campo fecha/fecha-hora, `{{date.now}}` es el
     * instante con zona (no el texto UTC sin zona de los correos).
     */
    private fieldInput(ctx: RunContext, raw: unknown, field: CoercibleField): { value: unknown; fromVariable: boolean } {
        if (typeof raw !== 'string') return { value: raw, fromVariable: false };
        const fv = this.accessor(ctx, { isoNow: field.type === 'date' || field.type === 'datetime' });
        const token = singleTagToken(raw);
        if (token !== null) {
            const v = token === 'record.id' ? ctx.recordId : fv(token);
            return { value: v === undefined ? null : v, fromVariable: true };
        }
        return { value: this.mergers(ctx, fv).merge(raw), fromVariable: false };
    }

    /** Convierte y valida un valor para un campo (ver `field-coercion.ts`). */
    private coerce(ctx: RunContext, field: CoercibleField, raw: unknown) {
        const input = this.fieldInput(ctx, raw, field);
        return coerceFieldValue(field, input.value, {
            timeZone: ctx.timeZone,
            format: ctx.format ?? DEFAULT_FORMAT,
            fromVariable: input.fromVariable,
        });
    }

    /**
     * «Actualizar campo». Escribe SÓLO las claves que cambia (antes armaba el
     * `data` completo desde la foto del evento y pisaba lo que otra persona
     * hubiera cambiado mientras tanto) y cada valor pasa por el validador del
     * campo: lo que no se puede convertir se saltea con el motivo en el log.
     *
     * v0.1.288 — dentro de un bucle, `target: 'item'` escribe en el registro
     * VINCULADO en curso (con los campos de su lista); sin eso, en el que
     * disparó. En «Probar» se calcula todo igual y en vez de escribir se
     * devuelve el antes → después (y se aplica en memoria, para que los pasos
     * siguientes lo vean como en una corrida real).
     */
    private async updateField(ctx: RunContext, cfg: Record<string, unknown>): Promise<ActionLogEntry> {
        const onItem = cfg.target === 'item';
        if (onItem && !ctx.item) return skip('update_field', '«El registro vinculado» sólo existe dentro de «Repetir por cada registro vinculado».');
        const target = onItem
            ? { listId: ctx.item!.listId, recordId: ctx.item!.recordId as number | null, slugToKey: ctx.item!.slugToKey, fieldsBySlug: ctx.item!.fieldsBySlug }
            : { listId: ctx.listId, recordId: ctx.recordId, slugToKey: ctx.slugToKey, fieldsBySlug: ctx.fieldsBySlug };
        if (target.recordId === null) return skip('update_field', 'Sin registro en contexto.');
        const values = (cfg.values as Record<string, unknown>) ?? {};
        const patch: Record<string, unknown> = {};
        const applied: Record<string, unknown> = {};
        const invalid: string[] = [];
        for (const [slug, raw] of Object.entries(values)) {
            const key = target.slugToKey.get(slug);
            const field = target.fieldsBySlug.get(slug);
            if (!key || !field) {
                invalid.push(`${slug} (el campo ya no existe)`);
                continue;
            }
            if (READ_ONLY_TYPES.includes(field.type)) {
                invalid.push(`${slug} (se calcula solo)`);
                continue;
            }
            if (field.type === 'relation') {
                const input = this.fieldInput(ctx, raw, field);
                const ids = parseRelationIds(input.value);
                if (ids.length === 0 && !isBlank(input.value)) {
                    invalid.push(`${slug} («${String(input.value)}» no son ids de registros)`);
                    continue;
                }
                patch[key] = ids;
                applied[slug] = ids;
                continue;
            }
            const res = this.coerce(ctx, field, raw);
            if (!res.ok) {
                invalid.push(`«${field.label ?? slug}» (${res.error})`);
                continue;
            }
            patch[key] = res.value;
            applied[slug] = res.value;
        }

        const current = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
            this.recordsRepo.findById(tx, ctx.tenantId, target.listId, target.recordId!),
        );
        if (!current) return skip('update_field', 'El registro ya no existe.');
        // En «Probar» los pasos anteriores pudieron cambiar el registro EN MEMORIA.
        const currentData = ctx.sim ? (onItem ? ctx.item!.data : ctx.data) : current.data;

        // v0.1.213 — en una lista de tienda, una automatización respeta
        // las MISMAS reglas que una persona: lo que la tienda no
        // aceptaría (o sólo se edita en WooCommerce) se saltea con el
        // motivo en el log, en vez de escribir un valor que la próxima
        // sincronización pisaría en silencio.
        const storeSkipped: string[] = [];
        const marker = await this.storeMarkerOf(ctx, target.listId);
        if (marker) {
            const merged = { ...currentData, ...patch };
            const row = (packSlug: string): unknown => {
                const id = marker.fields[packSlug];
                return id ? merged[`f${id}`] : undefined;
            };
            for (const slug of Object.keys(applied)) {
                const key = target.slugToKey.get(slug)!;
                const fieldId = Number(key.slice(1));
                const access = storeCellAccess(marker, fieldId, row);
                const err =
                    access.access === 'locked'
                        ? access.reason
                        : access.access === 'editable'
                          ? storeValueError(marker, fieldId, merged[key], row)
                          : null;
                if (!err) continue;
                delete patch[key];
                delete applied[slug];
                storeSkipped.push(`${slug} (${err})`);
            }
        }

        // Lo que ya tenía ese valor no se re-escribe (ni dispara nada).
        for (const [slug, value] of Object.entries(applied)) {
            const key = target.slugToKey.get(slug)!;
            if (target.fieldsBySlug.get(slug)?.type === 'relation') continue;
            if (sameValue(currentData[key], value)) {
                delete patch[key];
                delete applied[slug];
            }
        }

        const notes = [...storeSkipped, ...invalid];
        const where = onItem ? ` (registro vinculado #${target.recordId})` : '';
        if (Object.keys(patch).length === 0) {
            // Nada válido que escribir por valores que no convierten: la
            // automatización está mal configurada y se tiene que ver.
            if (invalid.length > 0 && storeSkipped.length === 0) {
                return fail('update_field', `No se pudo escribir ningún valor${where}: ${invalid.join('; ')}.`);
            }
            if (notes.length > 0) return skip('update_field', `Nada que cambiar${where}: ${notes.join('; ')}`);
            return skip('update_field', `Los campos ya tenían esos valores${where}.`);
        }

        const count = Object.keys(applied).length;
        const note = notes.length > 0 ? ` Omitidos: ${notes.join('; ')}.` : '';
        if (ctx.sim) {
            const changes = Object.entries(applied).map(([slug, value]) => {
                const key = target.slugToKey.get(slug)!;
                return { field: slug, label: target.fieldsBySlug.get(slug)?.label ?? slug, before: currentData[key] ?? null, after: value };
            });
            const next = { ...currentData, ...patch };
            if (onItem) ctx.item!.data = next;
            else ctx.data = next;
            return ok('update_field', `Cambiaría ${count} campo(s)${where}.${note}`, {
                _sim: 'would_run',
                changes,
                ...(notes.length > 0 ? { warnings: notes } : {}),
            });
        }

        const after = await this.writeUpdate(ctx, target, patch, current.data);
        if (onItem) ctx.item!.data = after;
        else ctx.data = after; // acciones posteriores ven el valor actualizado.
        return ok('update_field', `Actualizó ${count} campo(s)${where}.${note}`, {
            values: applied,
            ...(onItem ? { record_id: target.recordId } : {}),
            ...(notes.length > 0 ? { warnings: notes } : {}),
        });
    }

    /**
     * «Crear registro». Los slugs de `values` se resuelven contra la lista
     * DESTINO (no la del trigger — pueden ser listas distintas), cada valor
     * pasa por el validador compartido del campo (los inválidos se saltan
     * con nota y quedan como avisos de la corrida), y los campos relation se
     * vinculan con targets verificados vivos en su lista destino.
     */
    private async createRecord(ctx: RunContext, cfg: Record<string, unknown>): Promise<ActionLogEntry> {
        const targetList = Number(cfg.target_list ?? cfg.list_id ?? ctx.listId) || ctx.listId;
        // SEC-31 (v0.1.228): la lista destino tiene que ser DE ESTA
        // empresa. El id viene de la config (editable a mano o por la
        // API) y `records.list_id` referencia la tabla compartida sin
        // mirar el tenant: con el id de una lista ajena se creaba una
        // fila huérfana colgando de ella.
        const pre = await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const [target] = await tx
                .select({ settings: lists.settings })
                .from(lists)
                .where(and(eq(lists.tenantId, ctx.tenantId), eq(lists.id, targetList)))
                .limit(1);
            if (!target) return null;
            return { settings: target.settings, fields: await this.fields.listByList(tx, ctx.tenantId, targetList) };
        });
        if (!pre) return fail('create_record', `La lista destino (#${targetList}) no existe en esta empresa.`);
        // Una lista de tienda no admite altas: sus registros nacen en WooCommerce.
        if (readStoreListMarker(pre.settings)) {
            return skip('create_record', 'La lista destino está sincronizada con una tienda: los registros se crean en WooCommerce.');
        }
        // El límite de registros del plan vale también para lo que crea
        // una automatización (si no, sería la forma de saltearlo). Con
        // RecordsService lo verifica el alta DENTRO de su transacción (sin
        // carrera entre altas simultáneas); sin él, aquí.
        if (this.billing && !this.records()) {
            try {
                await this.billing.assertCanCreateRecords(ctx.tenantId, 1);
            } catch (err) {
                return fail('create_record', explainError(err) || 'Límite de registros del plan alcanzado.');
            }
        }

        const rawValues = (cfg.values as Record<string, unknown>) ?? {};
        const byKey = new Map(pre.fields.map((f) => [jsonbKeyForField(f.id), f]));
        const bySlug = new Map(pre.fields.map((f) => [f.slug, f]));
        const data: Record<string, unknown> = {};
        const relations: Array<{ fieldId: number; label: string; targetListId: number; ids: number[] }> = [];
        const skipped: string[] = [];
        for (const [k, v] of Object.entries(rawValues)) {
            const field = /^f\d+$/.test(k) ? byKey.get(k) : bySlug.get(k);
            if (!field) {
                skipped.push(`${k} (campo inexistente en la lista destino)`);
                continue;
            }
            if (READ_ONLY_TYPES.includes(field.type)) {
                skipped.push(`${k} (${field.type} es solo lectura)`);
                continue;
            }
            if (field.type === 'relation') {
                const targetListId = Number((field.config as { target_list_id?: unknown }).target_list_id ?? 0);
                const ids = parseRelationIds(this.fieldInput(ctx, v, field).value);
                if (targetListId <= 0 || ids.length === 0) {
                    skipped.push(`${k} (relación sin destino o sin IDs)`);
                    continue;
                }
                relations.push({ fieldId: field.id, label: field.label, targetListId, ids });
                continue;
            }
            const res = this.coerce(ctx, field, v);
            if (!res.ok) {
                skipped.push(`«${field.label}» (${res.error})`);
                continue;
            }
            if (res.value !== null) data[jsonbKeyForField(field.id)] = res.value;
        }

        // Vínculos: sólo a registros vivos de la lista destino del campo.
        if (relations.length > 0) {
            await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
                for (const rel of relations) {
                    const alive = await this.relationsRepo.existingInList(tx, ctx.tenantId, rel.targetListId, rel.ids);
                    const missing = rel.ids.filter((id) => !alive.has(id));
                    if (missing.length > 0) skipped.push(`«${rel.label}» (registros inexistentes: ${missing.join(', ')})`);
                    rel.ids = rel.ids.filter((id) => alive.has(id));
                }
            });
        }
        // Obligatorios que quedaron vacíos: el registro se crea igual (como
        // siempre), pero se avisa.
        for (const f of pre.fields) {
            if (!f.isRequired || READ_ONLY_TYPES.includes(f.type) || f.type === 'checkbox') continue;
            // v0.1.300 — con valor por defecto el alta lo completa sola.
            if (fieldDefaultOf(f.config as Record<string, unknown>) !== null) continue;
            const filled = f.type === 'relation'
                ? relations.some((r) => r.fieldId === f.id && r.ids.length > 0)
                : !isBlank(data[jsonbKeyForField(f.id)]);
            if (!filled) skipped.push(`«${f.label}» quedó vacío y es obligatorio`);
        }

        const note = skipped.length > 0 ? ` Omitidos: ${skipped.join('; ')}.` : '';
        if (ctx.sim) {
            // v0.1.288 — «Probar»: los valores ya resueltos y validados, sin crear nada.
            const byId = new Map(pre.fields.map((f) => [jsonbKeyForField(f.id), f]));
            const shown = [
                ...Object.entries(data).map(([k, v]) => ({ field: byId.get(k)?.slug ?? k, label: byId.get(k)?.label ?? k, value: v })),
                ...relations
                    .filter((r) => r.ids.length > 0)
                    .map((r) => ({ field: `f${r.fieldId}`, label: r.label, value: r.ids })),
            ];
            const [tl] = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
                tx.select({ name: lists.name }).from(lists).where(and(eq(lists.tenantId, ctx.tenantId), eq(lists.id, targetList))).limit(1),
            );
            return ok('create_record', `Crearía un registro en «${tl?.name ?? `lista ${targetList}`}» con ${shown.length} valor(es).${note}`, {
                _sim: 'would_run',
                list: tl?.name ?? null,
                values: shown,
                ...(skipped.length > 0 ? { warnings: skipped } : {}),
            });
        }
        const created = await this.writeCreate(ctx, targetList, data, relations.filter((r) => r.ids.length > 0));
        return ok('create_record', `Creó registro #${created.id} en lista ${targetList}.${note}`, {
            record_id: created.id,
            ...(skipped.length > 0 ? { warnings: skipped } : {}),
        });
    }

    /**
     * Escribe `patch` en el registro del run. Con RecordsService (la app real):
     * validación, actividad, tiempo real, avisos y las automatizaciones de la
     * lista, con la cadena para cortar loops. Sin él: escritura atómica
     * (`data || patch`) y el aviso de cambio.
     */
    private async writeUpdate(
        ctx: RunContext,
        target: { listId: number; recordId: number | null; slugToKey: Map<string, string>; fieldsBySlug: Map<string, LabelFieldLike> },
        patch: Record<string, unknown>,
        before: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        const chain = nextChain(ctx.chain, ctx.automation?.id ?? 0);
        const dispatchOpts = chain.depth > MAX_AUTOMATION_CHAIN_DEPTH ? { noAutomations: true } : { automationChain: chain };
        const recordId = target.recordId!;
        const svc = this.records();
        if (svc) {
            const dto = await svc.update(ctx.tenantId, SYSTEM_ACTOR, String(target.listId), recordId, { data: patch }, dispatchOpts);
            return dto.data;
        }
        const slugOfKey = (key: string): string | undefined => {
            for (const [slug, k] of target.slugToKey) if (k === key) return slug;
            return undefined;
        };
        const relationKeys = Object.keys(patch).filter((k) => target.fieldsBySlug.get(slugOfKey(k) ?? '')?.type === 'relation');
        const dataPatch = Object.fromEntries(Object.entries(patch).filter(([k]) => !relationKeys.includes(k)));
        const after = await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const row = await patchRecordData(tx, ctx.tenantId, target.listId, recordId, dataPatch);
            for (const key of relationKeys) {
                await this.relationsRepo.sync(tx, ctx.tenantId, Number(key.slice(1)), recordId, patch[key] as number[]);
            }
            return row;
        });
        if (!after) throw new Error('El registro ya no existe.');
        this.changes?.emit({ tenantId: ctx.tenantId, listId: target.listId, recordId, before, after, actorId: SYSTEM_USER });
        if (!('noAutomations' in dispatchOpts)) {
            this.dispatcher?.dispatch({ tenantId: ctx.tenantId, listId: target.listId, recordId, trigger: 'record_updated', after, before, chain });
        }
        return after;
    }

    /** Crea un registro en `listId` (mismo camino que `writeUpdate`). */
    private async writeCreate(
        ctx: RunContext,
        listId: number,
        data: Record<string, unknown>,
        relations: Array<{ fieldId: number; ids: number[] }>,
    ): Promise<{ id: number; data: Record<string, unknown> }> {
        const chain = nextChain(ctx.chain, ctx.automation?.id ?? 0);
        const svc = this.records();
        if (svc) {
            const input = { data: { ...data } as Record<string, unknown> };
            for (const r of relations) input.data[jsonbKeyForField(r.fieldId)] = r.ids;
            const dto = await svc.create(ctx.tenantId, SYSTEM_ACTOR, String(listId), input, {
                lenientRequired: true,
                ...(chain.depth > MAX_AUTOMATION_CHAIN_DEPTH ? {} : { automationChain: chain }),
            });
            return { id: dto.id, data: dto.data };
        }
        const row = await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const inserted = await this.recordsRepo.insert(tx, { tenantId: ctx.tenantId, listId, data, createdBy: SYSTEM_USER });
            for (const r of relations) await this.relationsRepo.sync(tx, ctx.tenantId, r.fieldId, inserted.id, r.ids);
            return inserted;
        });
        this.changes?.emit({ tenantId: ctx.tenantId, listId, recordId: row.id, before: {}, after: row.data, kind: 'created', actorId: SYSTEM_USER });
        if (chain.depth <= MAX_AUTOMATION_CHAIN_DEPTH) {
            this.dispatcher?.dispatch({ tenantId: ctx.tenantId, listId, recordId: row.id, trigger: 'record_created', after: row.data, chain });
        }
        return { id: row.id, data: row.data };
    }

    /**
     * «Para», «Cc» y «Cco» de un correo: un campo Persona (`responsable` o
     * `{{responsable}}`) se resuelve al EMAIL de esa persona, no a su id.
     */
    private recipients(ctx: RunContext, raw: unknown, merge: MergeFn): string {
        const template = typeof raw === 'string' ? raw : '';
        const isPerson = (slug: string): boolean => isPersonType(ctx.fieldsBySlug.get(slug)?.type);
        const withPeople = template
            .split(',')
            .map((part) => (isPerson(part.trim()) ? `{{${part.trim()}.email}}` : part))
            .join(',')
            .replace(/\{\{\s*(before\.)?([a-zA-Z0-9_]+)\s*\}\}/g, (m, before: string | undefined, slug: string) =>
                isPerson(slug) ? `{{${before ?? ''}${slug}.email}}` : m,
            );
        return limitRecipients(merge(withPeople));
    }

    private async execAction(tx: Tx, ctx: RunContext, spec: ActionSpec, pathKey = ''): Promise<ActionLogEntry> {
        const fv = this.accessor(ctx);
        const { merge, mergeHtml } = this.mergers(ctx, fv);
        const cfg = spec.config ?? {};
        // v0.1.288 — «Probar»: todo se resuelve con el MISMO código; los efectos
        // (enviar, llamar, escribir) se reemplazan por la descripción de lo que
        // harían. Un webhook/conector marcado por la persona se ejecuta de verdad.
        const sim = ctx.sim;
        const realCall = !sim || sim.realSteps.has(pathKey);

        switch (spec.type) {
            case 'bulk_edit': {
                // v0.1.221 — Editar en lote TODO lo que coincide con el filtro de
                // la acción, en la lista de la automatización. Se encola y corre
                // fuera de esta transacción (ver `dispatchBulkEdit`); el
                // resultado queda en el historial de ediciones masivas (con
                // deshacer) y como una corrida propia de esta automatización.
                const ops = Array.isArray(cfg.operations) ? cfg.operations : [];
                const parsed = ops.map((o) => bulkOperationSchema.safeParse(o));
                if (parsed.length === 0) return fail('bulk_edit', 'La acción no tiene cambios configurados.');
                const bad = parsed.find((p) => !p.success);
                if (bad && !bad.success) return fail('bulk_edit', `Un cambio está mal configurado: ${bad.error.issues[0]?.message ?? 'inválido'}`);
                let filter: unknown = null;
                if (cfg.filter_tree) {
                    const f = filterTreeSchema.safeParse(cfg.filter_tree);
                    if (!f.success) return fail('bulk_edit', 'El filtro de la acción está mal configurado.');
                    filter = f.data;
                }
                if (sim) {
                    const svc = this.records();
                    const page = svc
                        ? await svc.list(
                              ctx.tenantId,
                              SYSTEM_ACTOR,
                              String(ctx.listId),
                              {
                                  limit: 1,
                                  sort_dir: 'asc',
                                  with_total: true,
                                  ...(filter ? { filter_tree: filter as FilterGroup } : {}),
                                  ...(typeof cfg.search === 'string' && cfg.search.trim() !== '' ? { search: cfg.search.trim() } : {}),
                              } as ListRecordsQuery,
                              { tx },
                          )
                        : null;
                    const n = typeof page?.meta.total === 'number' ? page.meta.total : null;
                    return ok(
                        'bulk_edit',
                        n === null
                            ? `Editaría en lote ${filter ? 'los registros que cumplen el filtro' : 'toda la lista'} (${parsed.length} ${parsed.length === 1 ? 'cambio' : 'cambios'}).`
                            : `Editaría ${n} ${n === 1 ? 'registro' : 'registros'} (${parsed.length} ${parsed.length === 1 ? 'cambio' : 'cambios'}) si corriera ahora.`,
                        { _sim: 'would_run', count: n, operations: parsed.length },
                    );
                }
                const queued = this.dispatcher?.dispatchBulkEdit({
                    tenantId: ctx.tenantId,
                    automationId: ctx.automation?.id ?? 0,
                    automationName: ctx.automation?.name ?? 'Automatización',
                    listId: ctx.listId,
                    filter_tree: filter,
                    ...(typeof cfg.search === 'string' && cfg.search.trim() !== '' ? { search: cfg.search.trim() } : {}),
                    operations: parsed.map((p) => (p.success ? p.data : null)),
                });
                if (!queued) return fail('bulk_edit', 'No hay cola de tareas disponible (Redis): la edición en lote no se pudo programar.');
                return ok(
                    'bulk_edit',
                    `Edición en lote en curso (${parsed.length} ${parsed.length === 1 ? 'cambio' : 'cambios'}${filter ? ', con filtro' : ', sobre toda la lista'}). El resultado queda en el historial de ediciones masivas.`,
                    {},
                );
            }
            case 'call_webhook': {
                // v0.1.196 — si la acción apunta a una CONEXIÓN, la credencial
                // sale de ahí (cifrada) en vez de estar escrita en el config.
                // Una conexión borrada o ilegible hace FALLAR la acción: mandar
                // la petición sin credencial sería el fallo silencioso que ya
                // costó caro con el SMTP (v0.1.150).
                const connectionId = Number(cfg.connection_id);
                let connection: ConnectionParts | null = null;
                if (Number.isFinite(connectionId) && connectionId > 0) {
                    connection = await this.connectors.resolvePartsInTx(tx, ctx.tenantId, connectionId);
                    if (!connection) {
                        throw new Error(
                            `La conexión #${connectionId} ya no existe: revisa la acción en el editor.`,
                        );
                    }
                }
                // v0.1.155 — la petición la arma `buildWebhookRequest` (puro):
                // el PROBADOR de la UI usa la misma función, así lo que se
                // prueba es literalmente lo que después se ejecuta.
                const req = buildWebhookRequest(
                    cfg,
                    merge,
                    { recordId: ctx.recordId ?? null, listId: ctx.listId },
                    connection,
                );
                if (!req.url) return skip('call_webhook', 'URL vacía.');
                // Guard anti-SSRF (SEC-03): bloquea metadata/loopback/red interna
                // y pinea la IP resuelta (anti DNS-rebinding) + timeout.
                const hide = connection?.redact ?? [];
                const shownUrl = redactValues(req.url, hide);
                const shownRequest = {
                    method: req.method,
                    url: shownUrl,
                    headers: connection ? maskHeaders(req.headers) : req.headers,
                    body: req.body !== undefined ? redactValues(req.body, hide) : null,
                };
                if (!realCall) {
                    this.rememberResponse(ctx, cfg, null, pathKey);
                    return ok('call_webhook', `Llamaría ${req.method} ${shownUrl}.`, { _sim: 'would_run', request: shownRequest });
                }
                // v0.1.288 — se retiene hasta RESPONSE_BODY_MAX_BYTES (64 KB) de
                // la respuesta: los pasos siguientes pueden leerla con
                // {{webhook.body.x}}. Antes se guardaban 2 KB, sólo para el
                // mensaje de error; más de 64 KB inflaría el contexto que viaja
                // en una espera.
                const res = await safeWebhookFetch(req.url, {
                    method: req.method,
                    headers: req.headers,
                    body: req.body,
                    captureBody: true,
                    maxCaptureBytes: RESPONSE_BODY_MAX_BYTES,
                });
                this.rememberResponse(ctx, cfg, res, pathKey, hide);
                const shownResponse = sim ? { status: res.status, body: redactValues(res.body ?? '', hide).slice(0, 4000) } : undefined;
                // Un 4xx/5xx NO es éxito: antes quedaba «→ 500» como corrida
                // exitosa y nadie se enteraba de que el destino rechazaba todo.
                if (res.status < 200 || res.status >= 300) {
                    const failed = httpFail('call_webhook', `${req.method} ${shownUrl}`, res.status, redactValues(res.body ?? '', hide));
                    return sim ? { ...failed, details: { ...failed.details, request: shownRequest, response: shownResponse } } : failed;
                }
                return ok('call_webhook', `${req.method} ${shownUrl} → ${res.status}`, {
                    status: res.status,
                    ...(sim ? { _sim: 'ran', request: shownRequest, response: shownResponse } : {}),
                });
            }
            case 'connector_action': {
                // v0.1.198 — acción con NOMBRE de un conector ("Enviar
                // WhatsApp"). Se compila a la misma config que `call_webhook`
                // y sale por el mismo camino: un solo motor de peticiones
                // salientes, así lo que prueba el editor es lo que se ejecuta.
                const connId = Number(cfg.connection_id);
                if (!Number.isFinite(connId) || connId <= 0) {
                    return skip('connector_action', 'Sin conexión elegida.');
                }
                const resolved = await this.connectors.resolveActionInTx(
                    tx,
                    ctx.tenantId,
                    connId,
                    cfg.action_key,
                );
                if (!resolved) {
                    throw new Error(
                        `La conexión #${connId} ya no existe: revisa la acción en el editor.`,
                    );
                }
                if (!resolved.action) {
                    throw new Error(
                        `«${resolved.name}» ya no tiene la acción «${String(cfg.action_key ?? '')}»: se renombró o se borró.`,
                    );
                }
                const values = (cfg.values ?? {}) as Record<string, unknown>;
                // v0.1.203 — app de la galería («Enviar mensaje a Slack»): la
                // petición la arma el código de esa app y la RESPUESTA se revisa
                // —Slack, Telegram y WAS contestan 200 con el error adentro—, así
                // un mensaje que no salió no queda como «exitoso» en el historial.
                // v0.1.251 — «Crear link de pago» (Mercado Pago / Wompi): no es
                // una petición suelta — el link queda guardado, escrito en el
                // registro y se sigue solo hasta que el cliente paga.
                if (
                    resolved.integration &&
                    (resolved.integration.key === 'mercadopago' || resolved.integration.key === 'wompi') &&
                    resolved.action.key === 'create_payment_link'
                ) {
                    if (ctx.recordId === null) return skip('connector_action', 'Un link de pago necesita un registro.');
                    if (!this.collections) throw new Error('Cobros no disponibles en este servidor.');
                    const compiled = compileIntegrationValues(resolved.integration.key, resolved.action, values, merge, merge);
                    if (compiled.missing.length > 0) {
                        return skip('connector_action', `Falta completar: ${compiled.missing.join(', ')}.`);
                    }
                    const v = compiled.values;
                    const amount = parseAmount(v.amount ?? '');
                    if (amount === null) {
                        throw new Error(`${resolved.action.label}: el monto «${v.amount ?? ''}» no es un número.`);
                    }
                    const days = Number(v.expires_days ?? '');
                    if (sim) {
                        // Nunca de verdad en una prueba: crearía un cobro real a nombre de la empresa.
                        ctx.pago = { link: '(se crea al correr)', monto: amount, titulo: v.title ?? '' };
                        return ok('connector_action', `Crearía un link de pago «${v.title ?? ''}» por ${amount} ${v.currency ?? 'COP'}${v.payer_email ? ` para ${v.payer_email}` : ''}.`, {
                            _sim: 'would_run',
                            action: resolved.action.key,
                            integration: resolved.integration.key,
                        });
                    }
                    const created = await this.collections.createLinkInTx(tx, ctx.tenantId, {
                        connectionId: connId,
                        listId: ctx.listId,
                        recordId: ctx.recordId,
                        title: v.title ?? '',
                        amount,
                        currency: v.currency ?? 'COP',
                        payerEmail: (v.payer_email ?? '').trim() || null,
                        expiresDays: Number.isFinite(days) && days > 0 ? Math.min(365, Math.floor(days)) : null,
                        userId: null,
                    }).catch((err: unknown) => {
                        throw new Error(`${resolved.action!.label}: ${err instanceof Error ? err.message : String(err)}`);
                    });
                    if (created.write) ctx.data = created.write.after;
                    ctx.pago = { ...created.context };
                    return ok('connector_action', `${resolved.name} → link de pago ${created.link.url}`, {
                        action: resolved.action.key,
                        integration: resolved.integration.key,
                        link_id: created.link.id,
                        url: created.link.url,
                    });
                }
                if (resolved.integration) {
                    const integ = resolved.integration;
                    // SEC-33: en el cuerpo HTML de Gmail/Outlook los valores se escapan, igual
                    // que en `send_email` — un registro no inyecta HTML en el correo.
                    const compiled = compileIntegrationValues(integ.key, resolved.action, values, merge, mergeHtml);
                    if (compiled.missing.length > 0) {
                        return skip('connector_action', `Falta completar: ${compiled.missing.join(', ')}.`);
                    }
                    const req = buildIntegrationRequest(integ.key, resolved.action.key, compiled, integ.creds);
                    const hide = [integ.creds.secret, integ.creds.accessToken].filter((x) => typeof x === 'string' && x.length >= 4);
                    const shownRequest = {
                        method: req.method,
                        url: redactValues(req.url, hide),
                        headers: maskHeaders(req.headers),
                        body: req.body !== undefined ? redactValues(req.body, hide) : null,
                    };
                    if (!realCall) {
                        this.rememberResponse(ctx, cfg, null, pathKey);
                        return ok('connector_action', `${resolved.name} → ${resolved.action.label} (sin ejecutar).`, {
                            _sim: 'would_run',
                            action: resolved.action.key,
                            integration: integ.key,
                            request: shownRequest,
                        });
                    }
                    const res = await safeWebhookFetch(req.url, {
                        method: req.method,
                        headers: req.headers,
                        body: req.body,
                        captureBody: true,
                        maxCaptureBytes: RESPONSE_BODY_MAX_BYTES,
                    });
                    this.rememberResponse(ctx, cfg, res, pathKey, hide);
                    const problem = checkIntegrationResponse(integ.key, res.status, res.body ?? '');
                    if (problem) throw new Error(`${resolved.action.label}: ${problem}`);
                    return ok(
                        'connector_action',
                        `${resolved.name} → ${resolved.action.label}: ${res.status}`,
                        {
                            status: res.status,
                            action: resolved.action.key,
                            integration: integ.key,
                            ...(sim ? { _sim: 'ran', request: shownRequest, response: { status: res.status, body: redactValues(res.body ?? '', hide).slice(0, 4000) } } : {}),
                        },
                    );
                }
                const call = compileConnectorCall(resolved.action, values, merge);
                if (call.missing.length > 0) {
                    return skip(
                        'connector_action',
                        `Falta completar: ${call.missing.join(', ')}.`,
                    );
                }
                // `identity`: los valores ya pasaron por merge en el compilador.
                // Volver a expandir aquí re-interpretaría como plantilla el
                // contenido de un registro (un texto con `{{algo}}` adentro).
                const req = buildWebhookRequest(
                    call.cfg,
                    (raw) => String(raw ?? ''),
                    { recordId: ctx.recordId ?? null, listId: ctx.listId },
                    resolved.parts,
                );
                if (!req.url) {
                    return skip('connector_action', 'La acción no tiene URL ni ruta.');
                }
                const hide = resolved.parts.redact;
                const shownRequest = {
                    method: req.method,
                    url: redactValues(req.url, hide),
                    headers: maskHeaders(req.headers),
                    body: req.body !== undefined ? redactValues(req.body, hide) : null,
                };
                if (!realCall) {
                    this.rememberResponse(ctx, cfg, null, pathKey);
                    return ok('connector_action', `${resolved.name} → ${resolved.action.label} (sin ejecutar).`, {
                        _sim: 'would_run',
                        action: resolved.action.key,
                        request: shownRequest,
                    });
                }
                const res = await safeWebhookFetch(req.url, {
                    method: req.method,
                    headers: req.headers,
                    body: req.body,
                    captureBody: true,
                    maxCaptureBytes: RESPONSE_BODY_MAX_BYTES,
                });
                this.rememberResponse(ctx, cfg, res, pathKey, hide);
                const shownResponse = sim ? { status: res.status, body: redactValues(res.body ?? '', hide).slice(0, 4000) } : undefined;
                // Un 4xx/5xx es una falla (abre el problema de la automatización).
                if (res.status < 200 || res.status >= 300) {
                    const failed = httpFail(
                        'connector_action',
                        `${resolved.name} → ${resolved.action.label}`,
                        res.status,
                        redactValues(res.body ?? '', hide),
                    );
                    return sim ? { ...failed, details: { ...failed.details, request: shownRequest, response: shownResponse } } : failed;
                }
                return ok(
                    'connector_action',
                    `${resolved.name} → ${resolved.action.label}: ${res.status}`,
                    { status: res.status, action: resolved.action.key, ...(sim ? { _sim: 'ran', request: shownRequest, response: shownResponse } : {}) },
                );
            }
            case 'generate_pdf': {
                // v0.1.266 (ADR-S35) — arma el PDF de una plantilla de la lista
                // con los datos del registro. Opcionalmente lo guarda en un campo
                // Archivo (cuenta contra el almacenamiento del plan) y deja
                // `{{pdf.link}}` / `{{pdf.nombre}}` para las acciones siguientes.
                if (!this.documents) throw new Error('Los documentos PDF no están disponibles en este servidor.');
                if (ctx.recordId === null) return skip('generate_pdf', 'Un PDF necesita un registro.');
                const templateId = Number(cfg.document_template_id);
                if (!Number.isInteger(templateId) || templateId <= 0) return skip('generate_pdf', 'Elige la plantilla del documento.');
                if (sim) {
                    const name = await this.templateName(tx, ctx.tenantId, templateId);
                    ctx.pdf = { nombre: `${name ?? 'documento'}.pdf`, link: '(se genera al correr)', kb: 0, numero: '(se asigna al generar)' };
                    const save = typeof cfg.save_field === 'string' && cfg.save_field !== '' ? cfg.save_field : '';
                    return ok(
                        'generate_pdf',
                        `Generaría el PDF «${name ?? `plantilla #${templateId}`}»${save ? ` y lo guardaría en «${ctx.fieldsBySlug.get(save)?.label ?? save}»` : ''}. En la prueba no se arma: le asignaría un número de documento.`,
                        { _sim: 'would_run', template: name },
                    );
                }
                const doc = await this.pdfFor(tx, ctx, templateId, typeof cfg.filename === 'string' ? merge(cfg.filename) : '');
                const kb = Math.max(1, Math.round(doc.buffer.length / 1024));
                // v0.1.268 — sin guardarlo, `{{pdf.link}}` es un enlace firmado
                // (30 días) que ARMA el PDF al abrirlo: no ocupa espacio en
                // ningún lado. Muestra los datos del registro de ese momento.
                ctx.pdf = {
                    nombre: doc.filename,
                    link: this.documents.liveLink(ctx.tenantId, templateId, ctx.recordId),
                    kb,
                    numero: doc.number ?? '',
                };
                const saveSlug = typeof cfg.save_field === 'string' ? cfg.save_field : '';
                if (!saveSlug) {
                    return ok('generate_pdf', `Generó «${doc.filename}»${doc.number ? `, N.º ${doc.number}` : ''} (${kb} KB). Enlace sin guardar: se arma al abrirlo.`, { filename: doc.filename, bytes: doc.buffer.length });
                }
                const field = ctx.fieldsBySlug.get(saveSlug);
                const key = ctx.slugToKey.get(saveSlug);
                if (!field || !key || field.type !== 'file') {
                    throw new Error(`«${saveSlug}» no es un campo Archivo de la lista: elige dónde guardar el PDF.`);
                }
                const saved = await this.documents.storePdf(ctx.tenantId, SYSTEM_USER, doc.filename, doc.buffer).catch((err: unknown) => {
                    throw new Error(`No se pudo guardar el PDF: ${err instanceof Error ? err.message : String(err)}`);
                });
                // Sólo la clave del archivo, sobre lo que el registro tiene AHORA
                // (no sobre la foto del evento: no pisa cambios concurrentes).
                const current = await this.recordsRepo.findById(tx, ctx.tenantId, ctx.listId, ctx.recordId);
                const prev = current ? current.data[key] : ctx.data[key];
                const prevIds = (Array.isArray(prev) ? prev : prev === null || prev === undefined ? [] : [prev])
                    .map(Number)
                    .filter((n) => Number.isInteger(n) && n > 0);
                const nextIds = cfg.save_mode === 'replace' ? [saved.id] : [...prevIds, saved.id];
                const merged = (await patchRecordData(tx, ctx.tenantId, ctx.listId, ctx.recordId, { [key]: nextIds })) ?? { ...ctx.data, [key]: nextIds };
                this.changes?.emit({ tenantId: ctx.tenantId, listId: ctx.listId, recordId: ctx.recordId, before: current?.data ?? ctx.data, after: merged, actorId: 0 });
                ctx.data = merged;
                ctx.pdf = { nombre: doc.filename, link: this.documents.fileLink(ctx.tenantId, saved.id), kb, numero: doc.number ?? '' };
                return ok(
                    'generate_pdf',
                    `Generó «${doc.filename}»${doc.number ? `, N.º ${doc.number}` : ''} (${kb} KB) y lo guardó en «${field.label ?? saveSlug}».`,
                    { filename: doc.filename, bytes: doc.buffer.length, file_id: saved.id },
                );
            }
            case 'send_email': {
                // SEC-08: destinatarios saneados y CAPADOS (to/cc/bcc son
                // merge-tag → una lista con comas podría convertir el SMTP en
                // relay / mail-bomb). El `to` debe resolver a ≥1 email válido.
                // Un campo Persona en el «Para» (`responsable` o `{{responsable}}`)
                // es el EMAIL de esa persona, no su id.
                const to = this.recipients(ctx, cfg.to, merge);
                if (!to) {
                    // Sin destinatario la acción no puede hacer su trabajo: es
                    // una falla visible (un «Para» vacío o un campo sin email).
                    return fail('send_email', typeof cfg.to === 'string' && cfg.to.trim() !== ''
                        ? `El destinatario «${cfg.to.trim()}» no resolvió a ningún email válido en este registro.`
                        : 'La acción no tiene destinatario («Para» vacío).');
                }
                const cc = cfg.cc ? this.recipients(ctx, cfg.cc, merge) : undefined;
                const bcc = cfg.bcc ? this.recipients(ctx, cfg.bcc, merge) : undefined;
                // v0.1.265 — diseño por bloques / texto / HTML propio + firma
                // (ADR-S34). Un diseño inválido FALLA la acción con el motivo.
                const composed = await this.composer.compose(tx, {
                    tenantId: ctx.tenantId,
                    cfg,
                    merge,
                    mergeHtml,
                    fieldsBySlug: ctx.fieldsBySlug,
                    fieldValue: (slug) => fv(slug),
                    timeZone: ctx.timeZone,
                });
                const subject = composed.subject;
                // v0.1.150 — se envía EN EL ACTO (no por la cola de correo). El
                // motor ya corre dentro de su propio worker BullMQ, así que no
                // se pierde nada de resiliencia; a cambio, si el SMTP rechaza
                // (credenciales, remitente no permitido, host caído) el error
                // queda escrito en el historial de la automatización, que es
                // donde el usuario lo busca. Antes se encolaba y el run decía
                // "Encolado" aunque el correo nunca saliera.
                // v0.1.266 — PDFs adjuntos (cuenta de cobro, recibo…). Un PDF que
                // no se puede armar FALLA el envío con el motivo: mandar el correo
                // sin el documento que promete sería peor.
                if (sim) {
                    const ids = pdfTemplateIds(cfg);
                    const names: string[] = [];
                    for (const id of ids) names.push(`${(await this.templateName(tx, ctx.tenantId, id)) ?? `plantilla #${id}`}.pdf`);
                    return ok('send_email', `Enviaría un correo a ${to}: «${subject}».`, {
                        _sim: 'would_run',
                        email: {
                            to,
                            cc: cc || null,
                            bcc: bcc || null,
                            subject,
                            html: composed.html ?? null,
                            text: composed.text ?? null,
                            attachments: names,
                            signature_note: composed.signatureNote ?? null,
                        },
                    });
                }
                const attachments = await this.emailAttachments(tx, ctx, cfg);
                await this.mail.sendNow({
                    tenantId: ctx.tenantId,
                    to,
                    subject,
                    ...(composed.html !== undefined ? { html: composed.html } : {}),
                    ...(composed.text !== undefined ? { text: composed.text } : {}),
                    cc: cc || undefined,
                    bcc: bcc || undefined,
                    from: cfg.from_email ? merge(cfg.from_email) : undefined,
                    fromName: cfg.from_name ? merge(cfg.from_name) : undefined,
                    ...(attachments.length > 0 ? { attachments } : {}),
                });
                const files = attachments.length > 0 ? ` con ${attachments.map((a) => `«${a.filename}»`).join(', ')}` : '';
                if (files) {
                    return ok('send_email', `Enviado a ${to}: "${subject}"${files}.${composed.signatureNote ? ` ${composed.signatureNote}` : ''}`, {
                        to,
                        subject,
                        attachments: attachments.map((a) => a.filename),
                    });
                }
                if (composed.signatureNote) {
                    return ok('send_email', `Enviado a ${to}: "${subject}". ${composed.signatureNote}`, { to, subject });
                }
                return ok('send_email', `Enviado a ${to}: "${subject}"`, { to, subject });
            }
            default:
                return skip(spec.type, 'Acción no reconocida.');
        }
    }

    /**
     * v0.1.288 — Guarda la respuesta para los pasos siguientes: la del último
     * webhook (`{{webhook.x}}`) y, si el paso tiene nombre, con su nombre
     * (`{{respuestas.<nombre>.x}}`). `null` = «Probar» sin ejecutarla.
     */
    private rememberResponse(ctx: RunContext, cfg: Record<string, unknown>, res: SafeFetchResult | null, pathKey: string, hide: string[] = []): void {
        const info: ResponseInfo =
            res === null
                ? { status: 0, body: null, simulated: true }
                : {
                      status: res.status,
                      body: parseResponseBody(hide.length > 0 ? redactValues(res.body ?? '', hide) : (res.body ?? ''), res.truncated === true),
                      ...(res.truncated ? { truncated: true } : {}),
                  };
        ctx.webhook = info;
        const name = typeof cfg.response_name === 'string' ? cfg.response_name.trim() : '';
        if (RESPONSE_NAME_RE.test(name)) {
            const next = { ...(ctx.responses ?? {}) };
            delete next[name];
            next[name] = info;
            // Con muchos pasos con nombre, se conservan las 10 más recientes.
            const names = Object.keys(next);
            for (const old of names.slice(0, Math.max(0, names.length - 10))) delete next[old];
            ctx.responses = next;
        }
        if (ctx.sim && res !== null) ctx.sim.responses[pathKey] = info.body;
    }

    private async templateName(tx: Tx, tenantId: number, templateId: number): Promise<string | null> {
        const [row] = await tx
            .select({ name: documentTemplates.name })
            .from(documentTemplates)
            .where(and(eq(documentTemplates.tenantId, tenantId), eq(documentTemplates.id, templateId)))
            .limit(1);
        return row?.name ?? null;
    }

    /**
     * v0.1.266 — El PDF de una plantilla para el registro del run (lo arma una
     * sola vez por run aunque lo pidan «Generar PDF» y «Enviar email»).
     */
    private async pdfFor(
        tx: Tx,
        ctx: RunContext,
        templateId: number,
        filename = '',
    ): Promise<{ filename: string; buffer: Buffer; number: string | null }> {
        if (!this.documents) throw new Error('Los documentos PDF no están disponibles en este servidor.');
        if (ctx.recordId === null) throw new Error('Un PDF necesita un registro.');
        ctx.pdfs ??= new Map();
        const cached = ctx.pdfs.get(templateId);
        if (cached && !filename) return cached;
        const fv = this.accessor(ctx);
        const doc = await this.documents.renderTemplateInTx(tx, {
            tenantId: ctx.tenantId,
            listId: ctx.listId,
            recordId: ctx.recordId,
            templateId,
            actor: { userId: SYSTEM_USER, role: 'admin' },
            filename,
            uploads: ctx.docUploads,
            // Las variables del contexto del run: {{before.x}}, {{pago.link}}, {{payload.x}}.
            extra: (token) =>
                token.startsWith('before.') || token.startsWith('pago.') || token.startsWith('payload.') || token.startsWith('pdf.') || token === 'formulario.nombre'
                    ? fv(token)
                    : undefined,
        });
        // v0.1.267 — el número emitido ya quedó escrito en su campo (mismo tx):
        // se refleja en la copia del run para que otra acción no lo pise.
        if (doc.numberField) ctx.data = { ...ctx.data, [doc.numberField.key]: doc.numberField.value };
        const out = { filename: doc.filename, buffer: doc.buffer, number: doc.number };
        ctx.pdfs.set(templateId, out);
        return out;
    }

    /** Los PDF que `send_email` adjunta (`pdf_templates`: ids de plantillas). */
    private async emailAttachments(tx: Tx, ctx: RunContext, cfg: Record<string, unknown>): Promise<MailAttachment[]> {
        const ids = pdfTemplateIds(cfg);
        if (ids.length === 0) return [];
        if (ctx.recordId === null) throw new Error('Los PDF adjuntos necesitan un registro.');
        const out: MailAttachment[] = [];
        let total = 0;
        for (const id of ids) {
            const doc = await this.pdfFor(tx, ctx, id).catch((err: unknown) => {
                throw new Error(`No se pudo armar el PDF adjunto: ${err instanceof Error ? err.message : String(err)}`);
            });
            total += doc.buffer.length;
            if (total > MAIL_MAX_ATTACHMENT_BYTES) {
                throw new Error(`Los PDF adjuntos superan ${MAIL_MAX_ATTACHMENT_BYTES / 1024 / 1024} MB: achícalos o manda menos.`);
            }
            out.push({ filename: doc.filename, contentType: 'application/pdf', contentBase64: doc.buffer.toString('base64') });
        }
        return out;
    }
}

/**
 * Sanea y CAPA una lista de destinatarios (SEC-08). Divide por coma, deja solo
 * los que parecen email, deduplica y limita a MAX_EMAIL_RECIPIENTS. Devuelve
 * una lista separada por coma, o '' si no queda ninguno válido.
 */
const MAX_EMAIL_RECIPIENTS = 25;
function limitRecipients(raw: string): string {
    const seen = new Set<string>();
    for (const part of raw.split(',')) {
        const addr = part.trim();
        // Validación pragmática: algo@algo.algo, sin espacios ni comas.
        if (/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(addr)) seen.add(addr);
        if (seen.size >= MAX_EMAIL_RECIPIENTS) break;
    }
    return [...seen].join(', ');
}

function ok(action: string, message: string, details: Record<string, unknown> = {}): ActionLogEntry {
    return { action, status: 'success', message, details };
}
function fail(action: string, message: string, details: Record<string, unknown> = {}): ActionLogEntry {
    return { action, status: 'failed', message, details };
}

function skip(action: string, message: string): ActionLogEntry {
    return { action, status: 'skipped', message, details: {} };
}

/** Respuesta HTTP no exitosa: falla con el código y un pedacito de lo que contestaron. */
function httpFail(action: string, what: string, status: number, body: string | undefined): ActionLogEntry {
    const snippet = (body ?? '').replace(/\s+/g, ' ').trim();
    const shown = snippet.length > RESPONSE_SNIPPET ? `${snippet.slice(0, RESPONSE_SNIPPET - 1)}…` : snippet;
    return fail(action, `${what} → respondió ${status}${shown ? `: ${shown}` : ''}`, { status });
}

/**
 * Mensaje legible de un error al escribir un registro: los 400 de validación
 * traen el motivo por campo; un 403/404 trae su `message`.
 */
function explainError(err: unknown): string {
    if (err && typeof err === 'object' && 'getResponse' in err && typeof (err as { getResponse: unknown }).getResponse === 'function') {
        const body = (err as { getResponse: () => unknown }).getResponse() as {
            message?: unknown;
            data?: { errors?: Record<string, unknown> };
        };
        const errors = body?.data?.errors;
        if (errors && typeof errors === 'object' && Object.keys(errors).length > 0) {
            return `Datos inválidos: ${Object.entries(errors)
                .map(([k, v]) => `${k} (${String(v)})`)
                .join('; ')}`;
        }
        if (typeof body?.message === 'string') return body.message;
    }
    return errorText(err, 2000);
}

/** changed_fields puede venir como array de slugs o (field_changed) como `field`. */
function normalizeChangedFields(cfg: Record<string, unknown>): string[] {
    const cf = cfg.changed_fields;
    if (Array.isArray(cf)) return cf.map((x) => String(x)).filter(Boolean);
    if (typeof cfg.field === 'string' && cfg.field !== '') return [cfg.field];
    return [];
}

const fold = (s: string): string =>
    s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim()
        .toLowerCase();

/**
 * ¿El valor de un extremo del cambio («de» / «a») es el esperado? Vacío =
 * cualquiera. Opciones por value o por etiqueta; en un multi_select, «incluye»;
 * en una casilla, sí/no.
 */
function changeEndMatches(field: LabelFieldLike | undefined, actual: unknown, expected: unknown): boolean {
    if (expected === null || expected === undefined || expected === '' || (Array.isArray(expected) && expected.length === 0)) {
        return true;
    }
    const wanted = (Array.isArray(expected) ? expected : [expected]).map((e) => String(e));
    if (field?.type === 'checkbox') {
        const want = ['1', 'true', 'sí', 'si', 'yes'].includes(fold(wanted[0] ?? ''));
        const has = actual === true || actual === 1 || actual === '1' || actual === 'true';
        return want === has;
    }
    const options = Array.isArray((field?.config as { options?: unknown } | undefined)?.options)
        ? ((field!.config as { options: Array<{ value?: unknown; label?: unknown }> }).options)
        : [];
    const toValue = (s: string): string => {
        const f = fold(s);
        const opt = options.find((o) => fold(String(o.value ?? '')) === f) ?? options.find((o) => fold(String(o.label ?? '')) === f);
        return opt && typeof opt.value === 'string' ? opt.value : s.trim();
    };
    const targets = wanted.map(toValue);
    const values = (Array.isArray(actual) ? actual : [actual]).filter((v) => v !== null && v !== undefined).map((v) => String(v));
    return targets.some((t) => values.some((v) => v === t || fold(v) === fold(t) || (isNumericString(v) && isNumericString(t) && Number(v) === Number(t))));
}

function isNumericString(s: string): boolean {
    return s.trim() !== '' && Number.isFinite(Number(s));
}

function isBlank(v: unknown): boolean {
    return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

/** ¿Mismo valor guardado? (null/ausente iguales; listas sin importar el orden). */
function sameValue(a: unknown, b: unknown): boolean {
    if (isBlank(a) && isBlank(b)) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && [...a].map(String).sort().join('\u0000') === [...b].map(String).sort().join('\u0000');
    }
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Escritura ATÓMICA de sólo las claves que cambian: `data || patch` (y las
 * que se vacían, fuera). Lo que otra persona cambió entre el evento y esta
 * acción no se pisa.
 */
async function patchRecordData(
    tx: Tx,
    tenantId: number,
    listId: number,
    recordId: number,
    patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
    const set: Record<string, unknown> = {};
    const remove: string[] = [];
    for (const [k, v] of Object.entries(patch)) {
        if (!/^f\d+$/.test(k)) continue;
        if (v === null || v === undefined) remove.push(k);
        else set[k] = v;
    }
    let expr = sql`(${records.data} || ${JSON.stringify(set)}::jsonb)`;
    if (remove.length > 0) expr = sql`(${expr} - ARRAY[${sql.join(remove.map((k) => sql`${k}`), sql`, `)}]::text[])`;
    const [row] = await tx
        .update(records)
        .set({ data: expr as unknown as Record<string, unknown>, updatedAt: sql`now()` as unknown as Date, updatedBy: SYSTEM_USER })
        .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), eq(records.id, recordId), isNull(records.deletedAt)))
        .returning({ data: records.data });
    return row?.data ?? null;
}

/** v0.1.300 — un campo Persona o «Creado por» / «Modificado por» (guardan el id de la persona). */
function isPersonType(type: string | undefined): boolean {
    return type === 'user' || type === 'created_by' || type === 'updated_by';
}

/**
 * Normaliza el valor de un campo relation a IDs de record: acepta número,
 * string numérico (típico de un merge tag `{{record.id}}`), lista separada
 * por comas y arrays mixtos. IDs inválidos se descartan.
 */
function parseRelationIds(raw: unknown): number[] {
    const candidates: unknown[] = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? raw.split(',')
          : [raw];
    const out: number[] = [];
    for (const c of candidates) {
        const n = typeof c === 'number' ? c : Number(String(c).trim());
        if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    }
    return out;
}

/** Path anidado por punto sobre un objeto (`payload.cliente.email`). */
function getPath(obj: Record<string, unknown> | undefined, path: string): unknown {
    if (!obj) return undefined;
    let cur: unknown = obj;
    for (const part of path.split('.')) {
        if (cur === null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
}

/**
 * Resuelve el field_id del campo fecha del due_date_reached (por id o slug).
 * Acepta `due_field` — la clave que escribe el DueDateConfig de la UI; sin
 * este alias, una automatización configurada desde la interfaz jamás
 * resolvía el campo y el trigger no disparaba nunca.
 */
function resolveDateFieldId(
    cfg: Record<string, unknown>,
    fieldRows: Array<{ id: number; slug: string }>,
): number | null {
    if (typeof cfg.field_id === 'number') return cfg.field_id;
    const bySlug =
        typeof cfg.due_field === 'string' && cfg.due_field !== ''
            ? cfg.due_field
            : typeof cfg.field === 'string'
              ? cfg.field
              : typeof cfg.date_field === 'string'
                ? cfg.date_field
                : null;
    if (bySlug) {
        const f = fieldRows.find((x) => x.slug === bySlug);
        return f ? f.id : null;
    }
    return null;
}

/**
 * v0.1.251 — un monto escrito por una persona o un merge tag: «150000»,
 * «150.000» (punto de miles), «1.234,56», «$ 99.90». `null` si no es número.
 */
export function parseAmount(raw: string): number | null {
    let t = raw.replace(/[^\d.,-]/g, '');
    if (t === '' || t === '-') return null;
    const lastDot = t.lastIndexOf('.');
    const lastComma = t.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
        // El último separador es el decimal.
        t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    } else if (lastComma >= 0) {
        // «1,5» decimal; «150,000» miles.
        t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
    } else if (lastDot >= 0) {
        // «150.000» / «1.500.000» = miles (grupos de a tres); «99.90» decimal.
        if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    }
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

/** Los ids de las plantillas PDF que adjunta un «Enviar email» (hasta 5). */
function pdfTemplateIds(cfg: Record<string, unknown>): number[] {
    return Array.isArray(cfg.pdf_templates)
        ? [...new Set(cfg.pdf_templates.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 5)
        : [];
}

/** v0.1.288 — un paso del árbol con su forma normal (o null si no es un paso). */
function normalizeSpec(raw: unknown): ActionSpec | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as { type?: unknown; config?: unknown; condition?: unknown };
    if (typeof r.type !== 'string' || r.type === '') return null;
    return {
        type: r.type,
        config: r.config && typeof r.config === 'object' ? (r.config as Record<string, unknown>) : {},
        condition: (r.condition as ConditionData | null | undefined) ?? null,
    };
}

/** v0.1.288 — los campos del run + los del vinculado en curso como `item.<slug>`. */
function withItemFields(ctx: RunContext): Map<string, LabelFieldLike> {
    if (!ctx.item) return ctx.fieldsBySlug;
    const out = new Map(ctx.fieldsBySlug);
    for (const [slug, f] of ctx.item.fieldsBySlug) out.set(`item.${slug}`, f);
    return out;
}

/** v0.1.288 — el cuerpo de una respuesta: JSON si se puede leer, si no el texto. */
function parseResponseBody(text: string, truncated: boolean): unknown {
    const t = text.trim();
    if (t === '') return '';
    if (!truncated && (t.startsWith('{') || t.startsWith('['))) {
        try {
            return JSON.parse(t) as unknown;
        } catch {
            return text;
        }
    }
    return text;
}

/** Un valor de una respuesta para un texto: objetos como JSON, listas simples como lista. */
function serializeResponseValue(v: unknown): unknown {
    if (v === null || v === undefined) return v;
    if (Array.isArray(v)) return v.every((x) => x === null || typeof x !== 'object') ? v : JSON.stringify(v);
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
}

/**
 * v0.1.288 — el log de una corrida con un tope de entradas: una corrida larga
 * (muchas esperas y pasos) no infla la fila del historial sin límite.
 */
function capLog(log: ActionLogEntry[]): ActionLogEntry[] {
    const MAX = 300;
    if (log.length <= MAX) return log;
    return [
        ...log.slice(0, MAX - 21),
        { action: 'engine', status: 'skipped', message: `(${log.length - MAX + 1} pasos intermedios no se muestran)`, details: {} },
        ...log.slice(-20),
    ];
}

/** C5 — `{{aprobacion.x}}` de la aprobación en contexto (vacío si no hay). */
function approvalValue(info: ApprovalEventInfo | undefined, key: string): unknown {
    if (!info) return '';
    switch (key) {
        case 'resultado':
            return info.resultado;
        case 'flujo':
            return info.flow_name;
        case 'motivo':
            return info.motivo;
        case 'decidio':
            return info.decidio;
        case 'solicito':
            return info.solicito;
        case 'nota':
            return info.nota;
        case 'estado':
            return info.status;
        case 'id':
            return info.request_id > 0 ? info.request_id : '';
        default:
            return '';
    }
}

/** C5 — el estado de la solicitud que corresponde a un resultado simulado. */
function statusOfResult(r: ApprovalResult): string {
    switch (r) {
        case 'aprobada':
            return 'approved';
        case 'rechazada':
            return 'rejected';
        case 'devuelta':
            return 'returned';
        case 'cancelada':
            return 'cancelled';
        default:
            return 'pending';
    }
}

/** C5 — lee el estado de «Esperar aprobación» de un `resume_state`. */
function readApprovalWait(raw: unknown): ApprovalWaitState | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as { request_id?: unknown; deadline?: unknown };
    const id = Number(r.request_id);
    if (!Number.isInteger(id) || id <= 0) return null;
    return { request_id: id, deadline: typeof r.deadline === 'string' ? r.deadline : null };
}

/** v0.1.288 — lee el `resume_state` de una corrida en espera (null si no se entiende). */
function readResumeState(raw: unknown): ResumeState | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const waitPath = parseFlowPath(r.wait_path);
    const resumePath = parseFlowPath(r.resume_path);
    if (!waitPath || !resumePath || waitPath.length !== resumePath.length) return null;
    const ctx = r.ctx && typeof r.ctx === 'object' ? (r.ctx as ResumeState['ctx']) : { data: {} };
    const wf = r.wait_field as { key?: unknown; label?: unknown } | null | undefined;
    return {
        v: 1,
        wait_path: waitPath,
        resume_path: resumePath,
        wait: r.wait && typeof r.wait === 'object' ? (r.wait as Record<string, unknown>) : {},
        wait_field: wf && typeof wf.key === 'string' ? { key: wf.key, label: typeof wf.label === 'string' ? wf.label : wf.key } : null,
        approval_wait: readApprovalWait(r.approval_wait),
        had_fail: r.had_fail === true,
        ctx: { ...ctx, data: ctx.data && typeof ctx.data === 'object' ? ctx.data : {} },
    };
}
