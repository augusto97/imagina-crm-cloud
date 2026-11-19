import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { ModuleRef } from '@nestjs/core';
import {
    MEETING_SAVE_FIELD_TYPES,
    MEETING_SAVE_KEYS,
    meetingActionKind,
    missingActionScopes,
    type MeetingActionKind,
    bulkOperationSchema,
    checklistTriggerMatches,
    pageMatchesAny,
    bookingMergeValue,
    bookingTriggerMatches,
    sampleBookingEvent,
    BOOKING_EVENTS,
    BOOKING_EVENT_LABELS,
    type BookingEventInfo,
    emailTriggerMatches,
    COMMENT_ADDED_TRIGGER,
    FIND_RECORDS_ACTION,
    isFindableFieldType,
    UPSERT_RECORD_ACTION,
    readFindRecordsConfig,
    readUpsertRecordConfig,
    findOperatorIsNullary,
    type FindOperator,
    foldSearchText,
    webhookMatchFieldError,
    parseRecordIdValue,
    type FieldType,
    type FilterOperator,
    commentEventValue,
    commentTriggerMatches,
    // v0.1.455 — «empieza a cumplir una condición», «se sube un archivo» y tres acciones.
    RECORD_MATCHES_TRIGGER,
    FILE_ADDED_TRIGGER,
    NOTIFY_IN_APP_ACTION,
    ASSIGN_ROUND_ROBIN_ACTION,
    COPY_RECORD_ACTION,
    RECORD_MATCHES_SWEEP_MAX,
    readRecordMatchesConfig,
    countFilterConditions,
    readFileAddedConfig,
    fileKindMatches,
    addedFileIds,
    fileEventValue,
    humanFileSize,
    type FileEventInfo,
    readNotifyInAppConfig,
    NOTIFY_IN_APP_MAX_RECIPIENTS,
    readAssignRoundRobinConfig,
    pickRoundRobin,
    pickLeastOpen,
    readCopyRecordConfig,
    autoMapCopyFields,
    doneRuleFor,
    readCommentTriggerConfig,
    type CommentEventInfo,
    managedFieldLockMap,
    type ManagedFieldLock,
    slaTriggerMatches,
    type ChecklistCompletedInfo,
    type EmailEventInfo,
    type SlaEventInfo,
    type SubscriptionEventInfo,
    type SignatureEventInfo,
    REQUEST_SIGNATURE_ACTION,
    SIGNATURE_EVENT_LABELS,
    SIGNATURE_EVENT_TRIGGER,
    readRequestSignatureConfig,
    createSignatureRequestSchema,
    SIGNATURE_STATUS_LABELS,
    readSignatureTriggerEvents,
    signatureEventValue,
    signatureTriggerMatches,
    SUBSCRIPTION_EVENT_LABELS,
    subscriptionTriggerMatches,
    SLA_ALERT_LABELS,
    SLA_STATUS_LABELS,
    SLA_TARGET_LABELS,
    type FromTemplateResult,
    fieldDefaultOf,
    isSystemField,
    type SystemFieldType,
    filterTreeSchema,
    flowBranch,
    flowNodeAt,
    flowPathKey,
    formatEmailFieldValue,
    isSmsProvider,
    jsonbKeyForField,
    parseFlowPath,
    readApprovalFlowId,
    readApprovalTriggerResults,
    readAskAgentConfig,
    readMirrorListMarker,
    readWaitApprovalConfig,
    readWaitConfig,
    resolveTitleFieldId,
    readWebhookRecordConfig,
    WHATS_EVENT_TRIGGER,
    readWhatsTriggerConfig,
    describeWhatsTrigger,
    type WebhookRecordConfig,
    mirrorCellAccess,
    mirrorFieldMap,
    mirrorValueError,
    teamIdsOf,
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
    type MirrorListMarker,
    type TenantFormat,
    type WhatsappEventInfo,
} from '@imagina-base/shared';
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { safeWebhookFetch, type SafeFetchResult } from '../common/safe-fetch';
import type { ApprovalEventInfo } from '../approvals/approval-hub';
import { ApprovalsService } from '../approvals/approvals.service';
import { maskHeaders, redactValues, type ConnectionParts } from '../connectors/connection-parts';
import { compileConnectorCall } from '../connectors/connector-actions';
import {
    cancelAlreadyGone,
    checkIntegrationResponse,
    compileIntegrationValues,
    meetingResult,
    videoCallNote,
    wantsVideoCall,
    type MeetingResult,
} from '../connectors/integration-calls';
import { settleGoogleMeet } from '../connectors/meeting-settle';
import { ConnectorsService } from '../connectors/connectors.service';
import { buildWebhookRequest, type MergeFn } from './webhook-request';
import { hiddenFieldsFor, listRowInScope, listScopeWhere } from '../lists/list-acl';
import type { Tx } from '../db/client';
import { BillingService } from '../billing/billing.service';
import { CollectionsService } from '../collections/collections.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SignaturesService } from '../signatures/signatures.service';
import { subscriptionPlans, subscriptions as subscriptionsTable } from '../db/schema/subscriptions';
import { attachments, automationRuns, comments, documentTemplates, forms, lists, memberships, records, teamMembers, teams, tenants, users } from '../db/schema';
import { enterMatch, leaveMatch, matchesNow, seedBaseline, sweepMatches } from './automation-matches';
import { NotificationsService } from '../notifications/notifications.service';
import { editLinkFormId, editLinkMaker, readEditLinks, type EditLinkForm } from '../forms/form-edit-links';
import { connectionModuleStepError, moduleForIntegration, planModuleOff, planModuleStepError } from '../billing/plan-module-gate';
import { tenantIsReadOnly } from '../tenancy/read-only';
import { FieldsRepository } from '../fields/fields.repository';
import { DocumentsService } from '../documents/documents.service';
import { RecordTemplatesService } from '../record-templates/record-templates.service';
import { BOOKING_SIMULATOR, type BookingSimulator } from '../booking/booking-simulator';
import { WhatsappService, type WhatsappAutomationResult } from '../whatsapp/whatsapp.service';
import { SmsService, type SmsAutomationResult } from '../sms/sms.service';
import { HelpdeskReplyService } from '../helpdesk/helpdesk-reply.service';
import type { StoredFileRef } from '../files/files.service';
import { MAIL_MAX_ATTACHMENT_BYTES, type MailAttachment } from '../mail/mail.types';
import { MailService } from '../mail/mail.service';
import { compileFilterTree, fieldTypedExpr, type FilterableField } from '../records/query-builder';
import { keyExpr, normalizeKey } from '../records/record-key';
import type { FieldRow } from '../fields/fields.repository';
import { RecordsRepository } from '../records/records.repository';
import { systemFieldValue } from '../records/through-fields';
import { RecordChangeHub } from '../records/record-change-hub';
import { RecordsService, type Actor } from '../records/records.service';
import { RelationsRepository } from '../records/relations.repository';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { IncidentHub, errorText } from '../incidents/incident-hub';
import { AgentHub } from '../ai-agents/agent-hub';
import { wrapMergedValue } from '../ai-agents/agent-prompt';
import { AutomationsRepository, type AutomationRow } from './automations.repository';
import {
    AutomationDispatcher,
    MAX_AUTOMATION_CHAIN_DEPTH,
    nextChain,
    type AutomationChain,
    type EventRunRef,
    type FormEventInfo,
    type TriggerEvent,
    type WhatsEventJob,
    watchedSlugs,
} from './automation-dispatcher.service';
import { evaluateCondition, explainCondition, type ConditionOptions } from './condition-evaluator';
import { EmailComposer } from './email-composer';
import { coerceFieldValue, READ_ONLY_TYPES, type CoercibleField } from './field-coercion';
import {
    applyMergeTags,
    escapeHtml,
    labelForFieldValue,
    labelResolverFor,
    regionalFormatterFor,
    singleTagToken,
    type LabelFieldLike,
} from './merge-tags';
import { recordLinkPrefix, recordTokenValue } from '../qr/qr-runtime';
import { lookupWebhookRecord, matchKeysFor, type WebhookLookup } from './webhook-record-lookup';
import { claimJobUnit, noteJobUnit } from '../redis/queue-runtime';

/** Lo que dice el historial de una corrida que un reinicio cortó a mitad. */
export const INTERRUPTED_MESSAGE =
    'El servidor se reinició mientras esta automatización corría. No se volvió a ejecutar para no repetir pasos ya hechos (correos, mensajes, registros): revisa hasta dónde llegó.';

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
    // v0.1.455 — «empieza a cumplir una condición» y «se sube un archivo» miran altas y cambios.
    record_created: ['record_created', RECORD_MATCHES_TRIGGER, FILE_ADDED_TRIGGER],
    record_updated: ['record_updated', 'field_changed', RECORD_MATCHES_TRIGGER, FILE_ADDED_TRIGGER],
    // v0.1.251 — un cliente pagó un link de Mercado Pago o Wompi.
    payment_received: ['payment_received'],
    // v0.1.275 — alguien completó un formulario público de la lista.
    form_submitted: ['form_submitted'],
    // Campo «Botón» — alguien presionó un botón del registro.
    button_pressed: ['button_pressed'],
    // C5 — una solicitud de aprobación del registro se resolvió.
    approval_resolved: ['approval_resolved'],
    // A9 — un checklist del registro quedó completo.
    checklist_completed: ['checklist_completed'],
    // D5 — una cita de la agenda se agendó, se reprogramó o se canceló.
    booking_event: ['booking_event'],
    // D3 — un contacto escribió por WhatsApp (oficial).
    whatsapp_message_received: ['whatsapp_message_received'],
    // D2 — llegó un correo al buzón de soporte (ticket nuevo o respuesta).
    email_received: ['email_received'],
    // E5 — un SLA de la mesa de ayuda entró en riesgo o se venció.
    sla_alert: ['sla_alert'],
    // v0.1.367 — una suscripción del registro se cobró, falló, venció, se canceló…
    subscription_event: ['subscription_event'],
    // v0.1.444 — alguien (del equipo o el cliente) agregó un comentario.
    comment_added: ['comment_added'],
    // v0.1.447 — una firma electrónica del registro cambió.
    signature_event: ['signature_event'],
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
    automation?: { id: number; name: string; trigger?: string };
    /**
     * v0.1.251 — el cobro en contexto: el que acaba de pagarse (trigger
     * `payment_received`) o el link que creó una acción anterior. `{{pago.x}}`.
     */
    pago?: Record<string, unknown>;
    /** v0.1.275 — el formulario que se acaba de enviar (`{{formulario.nombre}}`, v0.1.386 `{{formulario.pagina}}`…). */
    form?: FormEventInfo;
    /** Campo «Botón» — el botón que se presionó (`{{boton.nombre}}`, `{{boton.persona}}`). */
    button?: { field_id: number; label: string; user_id: number; user_name: string; user_email: string };
    /** A9 — el checklist que quedó completo (`{{checklist.nombre}}`). */
    checklist?: ChecklistCompletedInfo;
    /** D5 — la cita de la agenda (`{{cita.servicio}}`, `{{cita.inicio}}`…). */
    booking?: BookingEventInfo;
    /** D3 — el mensaje de WhatsApp que llegó (`{{whatsapp.texto}}`, `{{whatsapp.de}}`…). */
    whatsapp?: WhatsappEventInfo;
    /** D2 — el correo que llegó (`{{correo.de}}`, `{{correo.asunto}}`, `{{correo.texto}}`). */
    email?: EmailEventInfo;
    /** v0.1.444 — el comentario que se agregó (`{{comentario.texto}}`, `{{comentario.autor}}`…). */
    comment?: CommentEventInfo;
    /** E5 — la alerta de SLA (`{{sla.alerta}}`, `{{sla.vence}}`…). */
    sla?: SlaEventInfo;
    /**
     * v0.1.367 — la suscripción del registro: lo que pasó (trigger
     * `subscription_event`) o la que creó una acción anterior. `{{suscripcion.x}}`.
     */
    suscripcion?: SubscriptionEventInfo;
    /**
     * v0.1.447 — la firma electrónica: lo que pasó (trigger `signature_event`)
     * o la que pidió una acción anterior. `{{firma.x}}`.
     */
    firma?: SignatureEventInfo;
    /** v0.1.263 — zona de la empresa: `{{date.today}}` es el "hoy" de su reloj. */
    timeZone?: string;
    /**
     * v0.1.344 — `https://…/lists/<slug>/records/` de la lista del run:
     * `{{registro.enlace}}` le suma el id y `{{registro.qr}}` es la imagen de
     * su QR (por el dominio de la empresa si responde).
     */
    recordLinkPrefix?: string;
    /**
     * v0.1.360 — `{{formulario.<id>.enlace}}`: el enlace firmado para que
     * alguien actualice ESTE registro con ese formulario ('' si el formulario
     * no es de la lista, no está publicado o no acepta enlaces).
     */
    formEditLink?: (formId: number, recordId: number) => string;
    /** Formato regional de la empresa (`|fecha`, `|moneda` y los números tipeados). */
    format?: Pick<TenantFormat, 'number_format' | 'date_format' | 'time_format'>;
    /**
     * v0.1.266 — el último PDF generado en este run (`{{pdf.link}}`,
     * `{{pdf.nombre}}`) y los PDF ya armados por plantilla: un «Enviar email»
     * que adjunta la misma plantilla no la vuelve a dibujar.
     */
    pdf?: Record<string, unknown>;
    pdfs?: Map<number, { filename: string; buffer: Buffer; number: string | null; issued: boolean }>;
    /**
     * v0.1.366 — la última reunión o evento que creó o cambió una acción de
     * calendario (`{{reunion.enlace}}`, `{{reunion.id}}`…): para mandar el
     * enlace al cliente por WhatsApp en el paso siguiente.
     */
    reunion?: Record<string, string>;
    /**
     * v0.1.401 — lo que dejó la última acción de Whats (`{{whats.contacto_id}}`,
     * `{{whats.ejecucion_id}}`…): se acumula entre pasos.
     */
    whats?: Record<string, string>;
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
    /** C1 — nombres de los equipos de los campos «Equipo» (`{{equipo.nombre}}`), por id. */
    teamNames?: Map<number, string>;
    /** Marca de tienda o de sitio WordPress por lista, leída una vez por corrida. */
    storeMarkers?: Map<number, MirrorListMarker | null>;
    /** E5 — columnas que mantiene el SLA de la mesa de ayuda, por lista (nadie las escribe). */
    /** E5 + v0.1.383 — columnas protegidas por lista (SLA, cobros, suscripciones). */
    helpdeskManaged?: Map<number, Map<number, ManagedFieldLock>>;
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
    /** v0.1.455 — quién hizo el cambio que disparó (alta o edición de una persona). */
    actorId?: number;
    /** v0.1.455 — el archivo que se subió (`{{archivo.nombre}}`, `{{archivo.enlace}}`…). */
    file?: FileEventInfo;
    /** v0.1.455 — la persona que asignó «Asignar por turno» (`{{asignado.nombre}}`…). */
    asignado?: Record<string, string>;
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
    /**
     * Quien prueba, cuando su acceso a la lista es parcial (no admin): los
     * vinculados se leen con SU acceso y lo que se ejecuta de verdad sólo usa
     * conexiones que esa persona puede elegir.
     */
    viewer?: Actor;
    /** Quien prueba (cualquier rol): id para revisar las conexiones que se ejecutan de verdad. */
    tester?: number;
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

/**
 * v0.1.392 — El resto de una acción que espera a OTRO servicio (un webhook, un
 * correo, WhatsApp, SMS, una app conectada). La acción lee lo que necesita de
 * la base en su transacción, la CONFIRMA, suelta la conexión y recién entonces
 * espera la respuesta. Antes esperaba con la transacción abierta: el servidor
 * tiene ~20 conexiones para todo, y unos pocos webhooks lentos (8–20 s cada
 * uno) dejaban a la app entera esperando una conexión libre.
 */
interface AfterCommit {
    readonly afterCommit: () => Promise<ActionLogEntry>;
}
const afterCommit = (fn: () => Promise<ActionLogEntry>): AfterCommit => ({ afterCommit: fn });
const isAfterCommit = (v: ActionLogEntry | AfterCommit): v is AfterCommit => typeof (v as AfterCommit).afterCommit === 'function';

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
        form?: FormEventInfo;
        button?: { field_id: number; label: string; user_id: number; user_name: string; user_email: string };
        checklist?: ChecklistCompletedInfo;
        booking?: BookingEventInfo;
        email?: EmailEventInfo;
        comment?: CommentEventInfo;
        sla?: SlaEventInfo;
        suscripcion?: SubscriptionEventInfo;
        firma?: SignatureEventInfo;
        pdf?: Record<string, unknown>;
        reunion?: Record<string, string>;
        whats?: Record<string, string>;
        webhook?: ResponseInfo;
        responses?: Record<string, ResponseInfo>;
        chain?: AutomationChain;
        approval?: ApprovalEventInfo;
        actor_id?: number;
        file?: FileEventInfo;
        asignado?: Record<string, string>;
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

/** v0.1.392 — cada cuánto el escaneo de vencimientos vuelve a mirar la lista entera. */
export const DUE_FULL_SCAN_MS = 6 * 60 * 60 * 1000;
/** Margen de la ventana del escaneo (relojes distintos, lo escrito durante la vuelta). */
const DUE_WINDOW_MARGIN_MS = 5 * 60 * 1000;
/** Cuánto se recuerda hasta dónde llegó (sin recuerdo, la vuelta es completa). */
const DUE_SCAN_STATE_TTL_S = 2 * 24 * 60 * 60;

/** v0.1.285 — nombre legible de cada paso, para el aviso de falla. */
const ACTION_NAMES: Record<string, string> = {
    send_email: 'Enviar email',
    call_webhook: 'Llamar webhook',
    connector_action: 'Acción de una app conectada',
    update_field: 'Actualizar campo',
    webhook_record: 'Webhook entrante',
    create_record: 'Crear registro',
    generate_pdf: 'Generar PDF',
    bulk_edit: 'Editar en lote',
    if_else: 'Condición',
    wait: 'Esperar',
    for_each_linked: 'Repetir por cada vinculado',
    request_approval: 'Pedir aprobación',
    wait_approval: 'Esperar aprobación',
    reply_email: 'Responder por correo',
    ask_agent: 'Pedirle a un agente',
    notify_in_app: 'Avisar en la app',
    assign_round_robin: 'Asignar por turno',
    copy_record: 'Copiar a otra lista',
    engine: 'Motor de automatizaciones',
};

/** Cuánto de la respuesta de un webhook fallido se muestra en el historial. */
const RESPONSE_SNIPPET = 200;

/** Tipos que no viven en `data` y se calculan al leer (v0.1.322). */
const DERIVED_TYPES = new Set(['lookup', 'rollup', 'computed', 'formula', 'time_tracked']);
function isDerivedForVariables(type: string): boolean {
    return DERIVED_TYPES.has(type) || isSystemField(type as never);
}

@Injectable()
export class AutomationEngine {
    private readonly logger = new Logger(AutomationEngine.name);
    /** v0.1.265 — arma el correo (diseño / texto / HTML + firma). Sin dependencias. */
    private readonly composer = new EmailComposer();
    private recordsSvc: RecordsService | null | undefined;
    private recordTemplatesSvc: RecordTemplatesService | null | undefined;

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
        // E6 — «Pedirle a un agente»: el módulo de agentes atiende por este hub.
        @Optional() private readonly agents?: AgentHub,
        // v0.1.392 — hasta dónde llegó el último escaneo de cada vencimiento.
        @Optional() @Inject(REDIS) private readonly redis?: Redis,
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

    /** v0.1.367 — las suscripciones (viven en el módulo de cobros, global). */
    private subsSvc: SubscriptionsService | null | undefined;
    private subscriptionsSvc(): SubscriptionsService | null {
        if (this.subsSvc === undefined) {
            try {
                this.subsSvc = this.moduleRef?.get(SubscriptionsService, { strict: false }) ?? null;
            } catch {
                this.subsSvc = null;
            }
        }
        return this.subsSvc;
    }

    /** Para los specs que arman el motor a mano. */
    setSubscriptions(svc: SubscriptionsService | null): void {
        this.subsSvc = svc;
    }

    /** v0.1.447 — la firma electrónica (su módulo depende de registros, documentos y archivos). */
    private signSvc: SignaturesService | null | undefined;
    private signaturesSvc(): SignaturesService | null {
        if (this.signSvc === undefined) {
            try {
                this.signSvc = this.moduleRef?.get(SignaturesService, { strict: false }) ?? null;
            } catch {
                this.signSvc = null;
            }
        }
        return this.signSvc;
    }

    /** Para los specs que arman el motor a mano. */
    setSignatures(svc: SignaturesService | null): void {
        this.signSvc = svc;
    }

    /** D3 — WhatsApp oficial (se resuelve al usarlo: su módulo depende de registros y campos). */
    private whatsappSvc: WhatsappService | null | undefined;
    private whatsapp(): WhatsappService | null {
        if (this.whatsappSvc === undefined) {
            try {
                this.whatsappSvc = this.moduleRef?.get(WhatsappService, { strict: false }) ?? null;
            } catch {
                this.whatsappSvc = null;
            }
        }
        return this.whatsappSvc;
    }

    /** Para los specs que arman el motor a mano. */
    setWhatsapp(svc: WhatsappService | null): void {
        this.whatsappSvc = svc;
    }

    /** SMS (ADR-S82) — mismo criterio que WhatsApp: se resuelve al usarlo. */
    private smsSvc: SmsService | null | undefined;
    private sms(): SmsService | null {
        if (this.smsSvc === undefined) {
            try {
                this.smsSvc = this.moduleRef?.get(SmsService, { strict: false }) ?? null;
            } catch {
                this.smsSvc = null;
            }
        }
        return this.smsSvc;
    }

    /** Para los specs que arman el motor a mano. */
    setSms(svc: SmsService | null): void {
        this.smsSvc = svc;
    }

    /** C6 — plantillas de registro (se resuelve al usarlo, igual que RecordsService). */
    /**
     * D2 — La mesa de ayuda («Responder por correo al hilo del registro»).
     * Vive en su propio módulo, que depende de este: se resuelve al usarla.
     */
    private helpdeskSvc: HelpdeskReplyService | null | undefined;
    private helpdesk(): HelpdeskReplyService | null {
        if (this.helpdeskSvc === undefined) {
            try {
                this.helpdeskSvc = this.moduleRef?.get(HelpdeskReplyService, { strict: false }) ?? null;
            } catch {
                this.helpdeskSvc = null;
            }
        }
        return this.helpdeskSvc;
    }

    private recordTemplates(): RecordTemplatesService | null {
        if (this.recordTemplatesSvc === undefined) {
            try {
                this.recordTemplatesSvc = this.moduleRef?.get(RecordTemplatesService, { strict: false }) ?? null;
            } catch {
                this.recordTemplatesSvc = null;
            }
        }
        return this.recordTemplatesSvc;
    }

    /** D5 — la agenda («Probar» arma la cita de ejemplo); se resuelve al usarla. */
    private bookingSim: BookingSimulator | null | undefined;
    private booking(): BookingSimulator | null {
        if (this.bookingSim === undefined) {
            try {
                this.bookingSim = this.moduleRef?.get<BookingSimulator>(BOOKING_SIMULATOR, { strict: false }) ?? null;
            } catch {
                this.bookingSim = null;
            }
        }
        return this.bookingSim;
    }

    /** Marca de lista de tienda (v0.1.213) o de sitio (v0.1.333), o null. Una lectura por lista y por corrida. */
    private async storeMarkerOf(ctx: RunContext, listId: number): Promise<MirrorListMarker | null> {
        ctx.storeMarkers ??= new Map();
        if (ctx.storeMarkers.has(listId)) return ctx.storeMarkers.get(listId) ?? null;
        const [row] = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
            tx
                .select({ settings: lists.settings })
                .from(lists)
                .where(and(eq(lists.tenantId, ctx.tenantId), eq(lists.id, listId)))
                .limit(1),
        );
        const marker = readMirrorListMarker(row?.settings);
        ctx.storeMarkers.set(listId, marker);
        (ctx.helpdeskManaged ??= new Map()).set(listId, managedFieldLockMap(row?.settings));
        return marker;
    }

    /**
     * v0.1.383 — El candado de una columna que escribe una sincronización (cobros, suscripciones,
     * SLA), o null. Las acciones que guardan algo en una columna elegida (un PDF, el enlace de una
     * reunión) no la pisan.
     */
    private async managedLockOf(ctx: RunContext, listId: number, fieldId: number): Promise<ManagedFieldLock | null> {
        if (!ctx.helpdeskManaged?.has(listId)) await this.storeMarkerOf(ctx, listId);
        return ctx.helpdeskManaged?.get(listId)?.get(fieldId) ?? null;
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
            if ((await tenantIsReadOnly(tx, event.tenantId)) || (await planModuleOff(tx, event.tenantId, 'automations'))) return null;
            const triggerTypes = TRIGGERS_FOR_EVENT[event.trigger];
            const all = (await this.automations.activeByTriggers(tx, event.tenantId, event.listId, triggerTypes))
                // Un botón que corre UNA automatización puntual.
                .filter((a) => !event.automation_ids || event.automation_ids.includes(a.id));
            const autos = all.filter((a) => !chain || !chain.automation_ids.includes(a.id)); // nunca se re-dispara a sí misma
            // v0.1.455 — las «empieza a cumplir» de la cadena no disparan, pero su
            // estado sí se actualiza (si no, una que el propio paso sacó de la
            // condición seguiría anotada como adentro).
            const tracked = all.filter((a) => a.triggerType === RECORD_MATCHES_TRIGGER && !autos.includes(a));
            if (autos.length === 0 && tracked.length === 0) return null;
            return { autos, tracked, maps: await this.fieldMaps(tx, event.tenantId, event.listId) };
        });
        if (!prep) return [];
        for (const auto of prep.tracked) await this.matchTransition(auto, event.recordId, false).catch(() => undefined);
        if (prep.autos.length === 0) return [];
        const runs: EventRunRef[] = [];
        // v0.1.300 — «Creado por», «Fecha de creación»…: las columnas de sistema no
        // viven en `data`; se leen UNA vez para las condiciones y variables.
        const sysData = await this.derivedData(event.tenantId, event.listId, event.recordId, prep.maps);
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
                ...(event.checklist ? { checklist: event.checklist } : {}),
                ...(event.booking ? { booking: event.booking } : {}),
                ...(event.whatsapp ? { whatsapp: event.whatsapp } : {}),
                ...(event.email ? { email: event.email } : {}),
                ...(event.comment ? { comment: event.comment } : {}),
                ...(event.sla ? { sla: event.sla } : {}),
                ...(event.subscription ? { suscripcion: event.subscription } : {}),
                ...(event.signature ? { firma: event.signature } : {}),
                ...(event.actor_id ? { actorId: event.actor_id } : {}),
                ...(chain ? { chain } : {}),
            };
            // v0.1.455 — «empieza a cumplir una condición»: sólo la ENTRADA dispara
            // (lo decide el estado guardado, con la condición evaluada sobre el
            // registro tal como está AHORA en la base).
            if (auto.triggerType === RECORD_MATCHES_TRIGGER) {
                const fire = event.trigger !== 'record_created' || readRecordMatchesConfig(auto.triggerConfig).onCreate;
                const t = await this.matchTransition(auto, event.recordId, fire).catch((err: unknown) => {
                    this.logger.warn(`Automatización ${auto.id}: no se pudo evaluar la condición: ${String(err)}`);
                    return null;
                });
                if (!t?.fire) continue;
                ctx.data = { ...t.data, ...sysData };
            }
            // v0.1.455 — «Cuando se sube un archivo»: sólo si llegó uno del tipo elegido.
            if (auto.triggerType === FILE_ADDED_TRIGGER) {
                const file = await this.addedFile(auto, ctx, event.before, event.after);
                if (!file) continue;
                ctx.file = file;
            }
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
            if ((await tenantIsReadOnly(tx, tenantId)) || (await planModuleOff(tx, tenantId, 'automations'))) return null;
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
            if ((await tenantIsReadOnly(tx, tenantId)) || (await planModuleOff(tx, tenantId, 'automations'))) return null;
            const auto = await this.automations.findById(tx, tenantId, automationId);
            // v0.1.455 — también las tandas de la revisión de «empieza a cumplir una condición».
            if (!auto || !auto.isActive || (auto.triggerType !== 'scheduled' && auto.triggerType !== RECORD_MATCHES_TRIGGER)) return null;
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

    // ─────────── v0.1.455 — «Cuando un registro empieza a cumplir una condición» ───────────

    /**
     * Corre `fn` con la condición del disparador compilada por el MISMO motor de
     * filtros de la tabla (para el sistema: sin alcance de rol ni campos
     * ocultos). null = no hay con qué evaluar (sin servicio de registros, la
     * lista ya no existe, o la condición quedó sin ninguna regla válida — un
     * campo borrado —: en ese caso NO se dispara por todos).
     */
    private async withMatchWhere<T>(auto: Pick<AutomationRow, 'tenantId' | 'listId' | 'triggerConfig'>, fn: (tx: Tx, where: SQL) => Promise<T>): Promise<T | null> {
        const svc = this.records();
        if (!svc) return null;
        const cfg = readRecordMatchesConfig(auto.triggerConfig);
        if (countFilterConditions(cfg.filter) === 0) return null;
        const parsed = filterTreeSchema.safeParse(cfg.filter);
        if (!parsed.success) return null;
        try {
            return await svc.readScoped(auto.tenantId, SYSTEM_ACTOR, String(auto.listId), async (tx, scope) => {
                const where = scope.where({ filter_tree: parsed.data });
                return where ? fn(tx, where) : null;
            });
        } catch (err) {
            // La lista ya no existe (o se fue a la papelera): no hay con qué evaluar.
            if (err instanceof NotFoundException) return null;
            throw err;
        }
    }

    /**
     * Un evento del registro: ¿entró ahora en la condición? Anota o borra su
     * estado y dice si dispara (`fire` = false: sólo se actualiza el estado —
     * un alta con «también al crear» apagado, una automatización de la cadena).
     */
    private async matchTransition(
        auto: Pick<AutomationRow, 'id' | 'tenantId' | 'listId' | 'triggerConfig'>,
        recordId: number,
        fire: boolean,
    ): Promise<{ fire: boolean; data: Record<string, unknown> } | null> {
        return this.withMatchWhere(auto, async (tx, where) => {
            const now = await matchesNow(tx, auto.tenantId, auto.listId, recordId, where);
            // En la papelera (o ya no existe): no entra ni sale.
            if (!now) return { fire: false, data: {} };
            if (!now.matches) {
                await leaveMatch(tx, auto.tenantId, auto.id, recordId);
                return { fire: false, data: now.data };
            }
            const entered = await enterMatch(tx, auto.tenantId, auto.id, recordId);
            return { fire: fire && entered, data: now.data };
        });
    }

    /** La línea de base (al activarla o cambiar la condición): los que YA la cumplen, sin disparar. */
    async seedMatches(tenantId: number, automationId: number): Promise<number> {
        const auto = await this.tenantDb.withTenant(tenantId, (tx) => this.automations.findById(tx, tenantId, automationId));
        if (!auto || auto.triggerType !== RECORD_MATCHES_TRIGGER) return 0;
        return (await this.withMatchWhere(auto, (tx, where) => seedBaseline(tx, tenantId, automationId, auto.listId, where))) ?? 0;
    }

    /**
     * La revisión periódica (cada 15 minutos): quién ENTRÓ por el paso del
     * tiempo («vence en 3 días») o por un campo calculado, y quién salió.
     * Los que entraron disparan en tandas, como un horario «para cada
     * registro»; si son más que el tope, el resto entra en la revisión
     * siguiente (nada se pierde).
     */
    async runMatchScan(tenantId: number, automationId: number): Promise<void> {
        const auto = await this.tenantDb.withTenant(tenantId, async (tx) => {
            // SEC-34: empresa en solo-lectura (impaga/archivada) → no corre nada.
            if ((await tenantIsReadOnly(tx, tenantId)) || (await planModuleOff(tx, tenantId, 'automations'))) return null;
            const a = await this.automations.findById(tx, tenantId, automationId);
            return a && a.isActive && a.triggerType === RECORD_MATCHES_TRIGGER ? a : null;
        });
        if (!auto) return;
        const swept = await this.withMatchWhere(auto, (tx, where) => sweepMatches(tx, tenantId, auto.id, auto.listId, where, RECORD_MATCHES_SWEEP_MAX));
        if (swept === null) {
            this.incidents?.report({
                tenantId,
                key: `automation:${auto.id}`,
                source: 'automation',
                sourceId: auto.id,
                listId: auto.listId,
                title: `Falló la automatización «${auto.name}»`,
                message: 'La condición de «Cuando un registro empieza a cumplir una condición» quedó sin reglas válidas (¿se borró un campo?). Revísala en el editor.',
            });
            return;
        }
        if (swept.more) this.logger.log(`Automatización ${auto.id}: más de ${RECORD_MATCHES_SWEEP_MAX} registros entraron; el resto, en la próxima revisión.`);
        for (let i = 0; i < swept.entered.length; i += SCHEDULED_EACH_BATCH) {
            const batch = swept.entered.slice(i, i + SCHEDULED_EACH_BATCH);
            const queued = this.dispatcher?.dispatchScheduledBatch({ tenantId, automationId: auto.id, recordIds: batch }) ?? false;
            if (!queued) await this.runScheduledBatch(tenantId, auto.id, batch);
        }
    }

    // ─────────── v0.1.455 — «Cuando se sube un archivo» ───────────

    /**
     * El primer archivo que llegó en el cambio (en el campo elegido o en
     * cualquiera de archivos), del tipo elegido. null = no llegó ninguno.
     */
    private async addedFile(
        auto: Pick<AutomationRow, 'triggerConfig'>,
        ctx: RunContext,
        before: Record<string, unknown> | undefined,
        after: Record<string, unknown>,
    ): Promise<FileEventInfo | null> {
        const cfg = readFileAddedConfig(auto.triggerConfig);
        const candidates: Array<{ key: string; fieldId: number; label: string }> = [];
        for (const [slug, f] of ctx.fieldsBySlug) {
            if (f.type !== 'file') continue;
            const key = ctx.slugToKey.get(slug);
            if (!key) continue;
            const fieldId = Number(key.slice(1));
            if (cfg.fieldId !== null && fieldId !== cfg.fieldId) continue;
            candidates.push({ key, fieldId, label: f.label ?? slug });
        }
        const added: Array<{ id: number; fieldId: number; label: string }> = [];
        for (const c of candidates) for (const id of addedFileIds(before?.[c.key], after[c.key])) added.push({ id, fieldId: c.fieldId, label: c.label });
        if (added.length === 0) return null;
        const rows = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
            tx
                .select({ id: attachments.id, filename: attachments.filename, mime: attachments.mime, size: attachments.sizeBytes })
                .from(attachments)
                .where(and(eq(attachments.tenantId, ctx.tenantId), inArray(attachments.id, added.map((a) => a.id)))),
        );
        const byId = new Map(rows.map((r) => [r.id, r]));
        const matching = added.filter((a) => {
            const r = byId.get(a.id);
            return r !== undefined && fileKindMatches(cfg.kind, r.mime, r.filename);
        });
        const first = matching[0];
        if (!first) return null;
        const r = byId.get(first.id)!;
        return {
            id: r.id,
            name: r.filename,
            mime: r.mime,
            size: Number(r.size) || 0,
            field_id: first.fieldId,
            field_label: first.label,
            link: this.documents?.fileLink(ctx.tenantId, r.id) ?? '',
            count: matching.length,
        };
    }

    /**
     * v0.1.110 — Trigger `incoming_webhook`: dispara con el PAYLOAD del POST
     * público como contexto. Las claves del payload que coinciden con slugs
     * de la lista se mapean a `data` (así `{{slug}}`, las condiciones del
     * trigger y las de las acciones funcionan igual que siempre); el objeto
     * completo queda accesible como `{{payload.clave}}` (con paths anidados).
     *
     * v0.1.399 — con `record_mode` el disparador trae un REGISTRO: lo busca
     * (por su id o por un campo «Sin repetidos»), lo crea, o las dos cosas
     * (ver `lookupWebhookRecord`). Con registro, las acciones corren sobre él
     * como con cualquier otro disparador y lo que cambian dispara las demás
     * automatizaciones de la lista (en cadena, con el tope de siempre).
     */
    async runWebhook(
        tenantId: number,
        automationId: number,
        payload: Record<string, unknown>,
    ): Promise<void> {
        const prep = await this.tenantDb.withTenant(tenantId, async (tx) => {
            // SEC-34: empresa en solo-lectura (impaga/archivada) → no corre nada.
            if ((await tenantIsReadOnly(tx, tenantId)) || (await planModuleOff(tx, tenantId, 'automations'))) return null;
            const auto = await this.automations.findById(tx, tenantId, automationId);
            if (!auto || !auto.isActive || auto.triggerType !== 'incoming_webhook') return null;
            const maps = await this.fieldMaps(tx, tenantId, auto.listId);
            const rc = readWebhookRecordConfig(auto.triggerConfig);
            const lookup = rc.mode === 'none' ? null : await this.lookupWebhook(tx, tenantId, auto.listId, rc, payload);
            return { auto, maps, rc, lookup };
        });
        if (!prep) return;
        const { auto, maps, rc, lookup } = prep;
        const mapped = payloadToData(payload, maps.slugToKey);
        const ctx: RunContext = { tenantId, listId: auto.listId, recordId: null, data: mapped, ...maps, payload };
        if (lookup?.kind === 'found') {
            // Las condiciones del disparador miran el registro tal como QUEDARÍA.
            ctx.recordId = lookup.record.id;
            ctx.data = rc.applyPayloadFields ? { ...lookup.record.data, ...mapped } : { ...lookup.record.data };
        }
        if (!evaluateCondition(auto.triggerConfig.field_filters as ConditionData | undefined, this.accessor(ctx), this.condOpts(ctx))) {
            return;
        }
        if (!lookup) {
            await this.runOne(ctx, auto);
            return;
        }
        ctx.automation = { id: auto.id, name: auto.name, trigger: auto.triggerType };
        const step = (status: ActionLogEntry['status'], message: string, details: Record<string, unknown> = {}): ActionLogEntry => ({
            action: 'webhook_record',
            status,
            message,
            details,
        });
        if (lookup.kind === 'not_found') {
            await this.runOne(ctx, auto, { stop: { status: 'cancelled', log: [step('skipped', lookup.message)] } });
            return;
        }
        if (lookup.kind === 'error') {
            await this.runOne(ctx, auto, { stop: { status: 'failed', log: [step('failed', lookup.message)] } });
            return;
        }
        const preLog: ActionLogEntry[] = [];
        try {
            if (lookup.kind === 'found') {
                ctx.data = { ...lookup.record.data };
                preLog.push(step('success', lookup.message, { record_id: lookup.record.id }));
                if (rc.applyPayloadFields) {
                    const values = webhookPayloadValues(payload, maps.slugToKey, rc, 'update');
                    if (Object.keys(values).length > 0) {
                        const entry = await this.updateField(ctx, { values });
                        preLog.push({ ...entry, message: `Datos del JSON: ${entry.message}` });
                    }
                }
            } else {
                const entry = await this.createRecord(ctx, { target_list: auto.listId, values: webhookPayloadValues(payload, maps.slugToKey, rc, 'create') });
                const newId = Number(entry.details?.record_id);
                if (entry.status !== 'success' || !Number.isInteger(newId) || newId <= 0) {
                    await this.runOne(ctx, auto, { stop: { status: 'failed', log: [step('success', lookup.message), entry.status === 'success' ? fail('create_record', 'No se pudo crear el registro.') : entry] } });
                    return;
                }
                const created = await this.tenantDb.withTenant(tenantId, (tx) => this.recordsRepo.findById(tx, tenantId, auto.listId, newId));
                ctx.recordId = newId;
                ctx.data = { ...(created?.data ?? {}) };
                preLog.push(step('success', lookup.message, { record_id: newId }), entry);
            }
        } catch (err) {
            await this.runOne(ctx, auto, { stop: { status: 'failed', log: [...preLog, step('failed', explainError(err) || errorText(err, 500))] } });
            return;
        }
        await this.runOne(ctx, auto, { preLog });
    }

    /**
     * v0.1.402 — «Cuando pasa algo en Whats»: el servicio de WhatsApp ya
     * encontró (o creó) el registro por teléfono en la lista de la
     * automatización. Corre sobre él con `{{whatsapp.x}}` y `{{payload.x}}`;
     * con `stop` (no hay registro, o hay varios y no se puede elegir) la corrida
     * queda con el motivo, sin acciones.
     */
    async runWhatsEvent(job: WhatsEventJob): Promise<number | null> {
        const prep = await this.tenantDb.withTenant(job.tenantId, async (tx) => {
            // SEC-34: empresa en solo-lectura (impaga/archivada) → no corre nada.
            if ((await tenantIsReadOnly(tx, job.tenantId)) || (await planModuleOff(tx, job.tenantId, 'automations'))) return null;
            const auto = await this.automations.findById(tx, job.tenantId, job.automationId);
            if (!auto || !auto.isActive || auto.triggerType !== WHATS_EVENT_TRIGGER || auto.listId !== job.listId) return null;
            const maps = await this.fieldMaps(tx, job.tenantId, auto.listId);
            const row = job.recordId !== null ? await this.recordsRepo.findById(tx, job.tenantId, auto.listId, job.recordId) : null;
            return { auto, maps, row };
        });
        if (!prep) return null;
        const { auto, maps, row } = prep;
        const ctx: RunContext = {
            tenantId: job.tenantId,
            listId: auto.listId,
            recordId: row ? row.id : null,
            data: row ? { ...(row.data as Record<string, unknown>) } : {},
            ...maps,
            whatsapp: job.whatsapp,
            payload: job.payload,
        };
        const step = (status: ActionLogEntry['status'], message: string): ActionLogEntry => ({ action: 'whats_event', status, message, details: {} });
        if (job.stop) {
            return this.runOne(ctx, auto, { stop: { status: job.stop.status, log: [step(job.stop.status === 'cancelled' ? 'skipped' : 'failed', job.stop.message)] } });
        }
        if (job.recordId !== null && !row) {
            return this.runOne(ctx, auto, { stop: { status: 'cancelled', log: [step('skipped', 'El registro se borró antes de que corriera la automatización.')] } });
        }
        if (ctx.recordId !== null) ctx.data = { ...ctx.data, ...(await this.derivedData(job.tenantId, auto.listId, ctx.recordId, maps)) };
        if (!evaluateCondition(auto.triggerConfig.field_filters as ConditionData | undefined, this.accessor(ctx), this.condOpts(ctx))) return null;
        return this.runOne(ctx, auto, job.note ? { preLog: [step('success', job.note)] } : {});
    }

    /** v0.1.399 — busca el registro del webhook (ver `lookupWebhookRecord`). */
    private async lookupWebhook(tx: Tx, tenantId: number, listId: number, rc: WebhookRecordConfig, payload: Record<string, unknown>): Promise<WebhookLookup> {
        const fieldRows = await this.fields.listByList(tx, tenantId, listId);
        const [list] = await tx
            .select({ name: lists.name })
            .from(lists)
            .where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId)))
            .limit(1);
        return lookupWebhookRecord(tx, { tenantId, listId, listName: list?.name ?? 'la lista', rc, payload, fields: fieldRows });
    }

    /**
     * v0.1.399 — Qué haría el webhook con cada dato recibido (para «Escuchar
     * datos de prueba»): la MISMA búsqueda que la corrida, sin escribir nada.
     */
    async previewWebhookRecords(
        tenantId: number,
        listId: number,
        rc: WebhookRecordConfig,
        payloads: ReadonlyArray<Record<string, unknown>>,
    ): Promise<WebhookMatchPreview[]> {
        if (rc.mode === 'none') {
            return payloads.map(() => ({ kind: 'none' as const, message: 'Sólo usa los datos: no busca ni crea registros.' }));
        }
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const fieldRows = await this.fields.listByList(tx, tenantId, listId);
            const [list] = await tx
                .select({ name: lists.name, settings: lists.settings })
                .from(lists)
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId)))
                .limit(1);
            const titleId = resolveTitleFieldId(fieldRows.map((f) => ({ id: f.id, type: f.type as never })), (list?.settings ?? {}) as Record<string, unknown>);
            const out: WebhookMatchPreview[] = [];
            for (const payload of payloads) {
                const res = await lookupWebhookRecord(tx, { tenantId, listId, listName: list?.name ?? 'la lista', rc, payload, fields: fieldRows });
                if (res.kind === 'found') {
                    const raw = titleId !== null ? res.record.data[jsonbKeyForField(titleId)] : null;
                    const title = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : `Registro #${res.record.id}`;
                    out.push({ kind: 'found', message: `Encontraría «${title}» (#${res.record.id}).`, record_id: res.record.id, title });
                } else if (res.kind === 'create') {
                    out.push({ kind: 'create', message: res.message.replace(/crea (un registro nuevo|uno nuevo)/, 'crearía $1').replace(/^Crea un registro nuevo/, 'Crearía un registro nuevo') });
                } else {
                    out.push({ kind: res.kind, message: res.message });
                }
            }
            return out;
        });
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
            if ((await tenantIsReadOnly(tx, tenantId)) || (await planModuleOff(tx, tenantId, 'automations'))) return null;
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

        // v0.1.392 — Escaneo por VENTANA. Antes cada vuelta (cada 5 minutos)
        // recorría TODOS los registros de la lista y, para cada vencido —con
        // los meses, casi todos—, consultaba sus corridas: miles de
        // automatizaciones × miles de registros, cada 5 minutos, aunque no
        // hubiera vencido nada nuevo. Ahora sólo son candidatos los que
        // vencieron desde la vuelta anterior, los que CAMBIARON desde entonces
        // (una fecha corrida, un estado que ahora cumple el filtro) y los que
        // tienen una corrida fallida reciente (sus reintentos). Cada 6 horas,
        // o si cambió la automatización o la zona de la empresa, una vuelta
        // completa como antes cubre lo que la ventana no ve (un filtro sobre
        // un campo calculado que cambió por otro registro).
        const scanKey = `due:scan:${auto.id}`;
        const version = `${auto.updatedAt.getTime()}:${tz}`;
        const scanStart = Date.now();
        let prev: { at: number; v: string; full: number } | null = null;
        try {
            const raw = this.redis ? await this.redis.get(scanKey) : null;
            const parsed = raw ? (JSON.parse(raw) as { at?: unknown; v?: unknown; full?: unknown }) : null;
            if (parsed && typeof parsed.at === 'number' && typeof parsed.full === 'number' && parsed.v === version) {
                prev = { at: parsed.at, v: version, full: parsed.full };
            }
        } catch {
            prev = null;
        }
        const full = prev === null || scanStart - prev.full >= DUE_FULL_SCAN_MS;
        let windowCond: SQL | undefined;
        if (!full && prev) {
            // 5 minutos de margen: relojes de servidores distintos y lo que se
            // escribió mientras corría la vuelta anterior.
            const since = new Date(prev.at - DUE_WINDOW_MARGIN_MS);
            const retry = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx
                    .selectDistinct({ id: automationRuns.recordId })
                    .from(automationRuns)
                    .where(and(eq(automationRuns.automationId, auto.id), eq(automationRuns.status, 'failed'), gt(automationRuns.createdAt, since)))
                    .limit(5000),
            );
            const retryIds = retry.map((r) => r.id).filter((id): id is number => typeof id === 'number');
            windowCond = or(
                sql`${fireAt} > ${since.toISOString()}::timestamptz`,
                gt(records.updatedAt, since),
                ...(retryIds.length > 0 ? [inArray(records.id, retryIds)] : []),
            );
        }

        // v0.1.252 — keyset por id en tandas de 500. Antes era UN `limit 500`
        // sin orden: los vencidos que no pasan los field_filters no
        // registran run (a propósito: si vuelven a cumplir, disparan), así
        // que con más de 500 de esos la consulta devolvía SIEMPRE los
        // mismos y el resto de los vencidos no se procesaba nunca.
        const BATCH = 500;
        const MAX_BATCHES = 50;
        let afterId = 0;
        let complete = false;
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
                            windowCond,
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
            if (due.length < BATCH) {
                complete = true;
                break;
            }
            afterId = due[due.length - 1]!.id;
        }
        // Sólo una vuelta que llegó al final mueve la ventana: si quedó corta
        // (más de 25.000 candidatos), la próxima vuelve a mirar lo mismo.
        if (complete && this.redis) {
            const state = { at: scanStart, v: version, full: full ? scanStart : prev!.full };
            await this.redis.set(scanKey, JSON.stringify(state), 'EX', DUE_SCAN_STATE_TTL_S).catch(() => undefined);
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
        // Reanudación repetida tras un corte: los pasos que siguen a la espera
        // ya habían empezado; no se repiten.
        if (!(await this.firstTimeInJob(`resume:${runId}`))) {
            this.logger.warn(`Corrida ${runId}: la reanudación se repitió tras un corte; no se vuelve a ejecutar.`);
            return this.markInterrupted(tenantId, runId);
        }
        const loaded = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [run] = await tx
                .select()
                .from(automationRuns)
                .where(and(eq(automationRuns.tenantId, tenantId), eq(automationRuns.id, runId)))
                .limit(1);
            if (!run || run.status !== 'running' || !run.resumeState) return null;
            const auto = await this.automations.findById(tx, tenantId, run.automationId);
            const readOnly = await tenantIsReadOnly(tx, tenantId);
            // v0.1.338 (ADR-S87) — el plan dejó de incluir «Automatizaciones».
            const moduleOff = await planModuleOff(tx, tenantId, 'automations');
            const maps = auto ? await this.fieldMaps(tx, tenantId, auto.listId) : null;
            const record = auto && run.recordId !== null ? await this.recordsRepo.findById(tx, tenantId, auto.listId, run.recordId) : null;
            return { run, auto, readOnly, moduleOff, maps, record };
        });
        if (!loaded) return;
        const { run, auto, readOnly, moduleOff, maps, record } = loaded;
        const cancel = (reason: string): Promise<void> => this.cancelResumed(tenantId, runId, run.actionsLog ?? [], reason);
        const state = readResumeState(run.resumeState);
        if (!auto || !maps) return cancel('La automatización ya no existe.');
        if (!auto.isActive) return cancel('La automatización está pausada: la espera no siguió.');
        if (readOnly) return cancel('La empresa estaba en solo-lectura (pago pendiente) cuando tocaba seguir: la espera no siguió.');
        if (moduleOff) return cancel('El plan de la empresa ya no incluía «Automatizaciones» cuando tocaba seguir: la espera no siguió.');
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
            ...(state.ctx.checklist ? { checklist: state.ctx.checklist } : {}),
            ...(state.ctx.booking ? { booking: state.ctx.booking } : {}),
            ...(state.ctx.email ? { email: state.ctx.email } : {}),
            ...(state.ctx.comment ? { comment: state.ctx.comment } : {}),
            ...(state.ctx.sla ? { sla: state.ctx.sla } : {}),
            ...(state.ctx.suscripcion ? { suscripcion: state.ctx.suscripcion } : {}),
            ...(state.ctx.firma ? { firma: state.ctx.firma } : {}),
            ...(state.ctx.pdf ? { pdf: state.ctx.pdf } : {}),
            ...(state.ctx.reunion ? { reunion: state.ctx.reunion } : {}),
            ...(state.ctx.whats ? { whats: state.ctx.whats } : {}),
            ...(state.ctx.webhook ? { webhook: state.ctx.webhook } : {}),
            ...(state.ctx.responses ? { responses: state.ctx.responses } : {}),
            ...(state.ctx.chain ? { chain: state.ctx.chain } : {}),
            ...(state.ctx.approval ? { approval: state.ctx.approval } : {}),
            ...(state.ctx.actor_id ? { actorId: state.ctx.actor_id } : {}),
            ...(state.ctx.file ? { file: state.ctx.file } : {}),
            ...(state.ctx.asignado ? { asignado: state.ctx.asignado } : {}),
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
        /** Quien prueba: el registro de muestra se lee con SU acceso a la lista. */
        viewer?: Actor;
    }): Promise<SimulationResult> {
        const { tenantId, auto } = input;
        const viewer = input.viewer && input.viewer.role !== 'admin' ? input.viewer : null;
        const prep = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const fieldRows = await this.fields.listByList(tx, tenantId, auto.listId);
            const [list] = await tx
                .select({ settings: lists.settings })
                .from(lists)
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, auto.listId)))
                .limit(1);
            const settings = (list?.settings ?? {}) as Record<string, unknown>;
            // Con acceso parcial a la lista, la muestra es un registro que esa
            // persona alcanza (el último, o el elegido si lo ve).
            const scope = viewer ? listScopeWhere(settings, viewer, 'view') : undefined;
            const where = and(
                eq(records.tenantId, tenantId),
                eq(records.listId, auto.listId),
                isNull(records.deletedAt),
                ...(input.recordId ? [eq(records.id, input.recordId)] : []),
                ...(scope ? [scope] : []),
            );
            const [rec] = await tx.select({ id: records.id, data: records.data, createdBy: records.createdBy }).from(records).where(where).orderBy(sql`${records.id} desc`).limit(1);
            return { fieldRows, settings, rec: rec ?? null, maps: await this.fieldMaps(tx, tenantId, auto.listId) };
        });
        // …y sin los campos que tiene ocultos en esta lista.
        const hiddenSlugs = viewer ? hiddenFieldsFor(prep.settings, viewer) : new Set<string>();
        const hiddenKeys = new Set(prep.fieldRows.filter((f) => hiddenSlugs.has(f.slug)).map((f) => jsonbKeyForField(f.id)));
        const visibleData = (row: { id: number; data: unknown; createdBy?: number }): { id: number; data: Record<string, unknown> } | null => {
            if (viewer && !listRowInScope(prep.settings, viewer, 'view', { id: row.id, createdBy: row.createdBy ?? 0, data: row.data })) return null;
            const data = { ...((row.data ?? {}) as Record<string, unknown>) };
            for (const k of hiddenKeys) delete data[k];
            return { id: row.id, data };
        };
        // Sin registro: un horario «normal» y un webhook entrante corren así de verdad.
        const usesRecord = !(auto.triggerType === 'incoming_webhook' || (auto.triggerType === 'scheduled' && auto.triggerConfig.for_each_record !== true));
        const payload = auto.triggerType === 'incoming_webhook' ? (input.payload ?? {}) : undefined;
        // v0.1.399 — un webhook con registro lo busca con el último dato que llegó
        // (la MISMA búsqueda que la corrida real).
        const hookRc = payload ? readWebhookRecordConfig(auto.triggerConfig) : null;
        const hookLookup =
            payload && hookRc && hookRc.mode !== 'none'
                ? await this.tenantDb.withTenant(tenantId, (tx) => this.lookupWebhook(tx, tenantId, auto.listId, hookRc, payload))
                : null;
        const found = usesRecord ? prep.rec : hookLookup?.kind === 'found' ? hookLookup.record : null;
        const rec = found ? visibleData(found) : null;
        const data: Record<string, unknown> = rec ? { ...rec.data } : {};
        if (payload && (!hookLookup || hookLookup.kind !== 'found' || hookRc?.applyPayloadFields)) {
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
            ...(viewer ? { viewer } : {}),
            ...(input.viewer ? { tester: input.viewer.userId } : {}),
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
        const preLog: ActionLogEntry[] = [];
        if (hookLookup && hookRc && payload) {
            if (Object.keys(payload).length > 0) trigger.notes.unshift(hookLookup.message);
            if (hookLookup.kind === 'not_found' || hookLookup.kind === 'error') {
                trigger.matches = false;
                trigger.message = Object.keys(payload).length > 0 ? hookLookup.message : 'Todavía no llegó ningún dato al webhook: no hay con qué buscar el registro.';
            } else {
                ctx.automation = { id: auto.id, name: auto.name, trigger: auto.triggerType };
                try {
                    if (hookLookup.kind === 'create') {
                        preLog.push(await this.createRecord(ctx, { target_list: auto.listId, values: webhookPayloadValues(payload, prep.maps.slugToKey, hookRc, 'create') }));
                    } else if (hookRc.applyPayloadFields) {
                        const values = webhookPayloadValues(payload, prep.maps.slugToKey, hookRc, 'update');
                        ctx.data = { ...(rec ? rec.data : viewer ? {} : hookLookup.record.data) };
                        if (Object.keys(values).length > 0) preLog.push(await this.updateField(ctx, { values }));
                    }
                } catch (err) {
                    preLog.push({ action: 'webhook_record', status: 'failed', message: explainError(err) || errorText(err, 500), details: {} });
                }
            }
        }
        let log: ActionLogEntry[];
        try {
            log = [...preLog, ...(await this.runSteps(ctx, auto.actions, [], 0, 0)).log];
        } catch (err) {
            log = [...preLog, { action: 'engine', status: 'failed', message: errorText(err, 2000), details: {} }];
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
            case 'whatsapp_message_received':
                notes.push('En la prueba no llegó un mensaje real: las variables {{whatsapp.x}} quedan vacías.');
                break;
            case WHATS_EVENT_TRIGGER: {
                // v0.1.402 — «Cuando pasa algo en Whats».
                const wc = readWhatsTriggerConfig(cfg);
                if (!wc) reasons.push('falta elegir qué evento de Whats la dispara');
                else notes.push(`${describeWhatsTrigger(wc)}: en la prueba no llegó un aviso real, así que {{whatsapp.x}} y {{payload.x}} quedan vacías.`);
                break;
            }
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
            case 'checklist_completed':
                notes.push('Se asume que se completó un checklist de este registro; {{checklist.nombre}} queda vacío en la prueba.');
                break;
            case 'booking_event': {
                // D5 — la cita de este registro (si llegó por una página de agenda)
                // con el primer evento que escucha el disparador.
                const events = Array.isArray(cfg.events) ? cfg.events.filter((e): e is BookingEventInfo['event'] => (BOOKING_EVENTS as readonly string[]).includes(String(e))) : [];
                const assumed = events[0] ?? 'booked';
                const info = ctx.recordId !== null ? await this.booking()?.simulatedEvent(ctx.tenantId, ctx.recordId, assumed) : null;
                ctx.booking = info ?? sampleBookingEvent(assumed);
                notes.push(`Se asume que la cita ${BOOKING_EVENT_LABELS[assumed].toLowerCase()}${info ? ` («${info.page_name}»)` : ''}.`);
                if (!info) {
                    notes.push('Este registro no llegó por una página de agenda: las variables {{cita.x}} usan datos de ejemplo.');
                } else if (!bookingTriggerMatches(cfg, info)) {
                    reasons.push('esta cita es de otra página de agenda');
                }
                break;
            }
            case COMMENT_ADDED_TRIGGER: {
                // v0.1.444 — el último comentario del registro, o uno supuesto
                // con lo que pide el disparador.
                const tc = readCommentTriggerConfig(cfg);
                const last = ctx.recordId !== null ? await this.lastCommentSample(ctx.tenantId, ctx.recordId) : null;
                const word = tc.contains.split(',')[0]?.trim() ?? '';
                ctx.comment = last ?? {
                    id: 0,
                    text: word !== '' ? `(un comentario con «${word}»)` : '(el texto del comentario)',
                    author_id: 0,
                    author_name: tc.from === 'client' ? 'Cliente' : 'Alguien del equipo',
                    from: tc.from === 'client' ? 'client' : 'team',
                    source: tc.from === 'client' ? 'portal' : 'app',
                    visibility: tc.visibility === 'client' ? 'client' : 'internal',
                    parent_id: tc.replies === 'replies' ? 1 : null,
                };
                notes.push(
                    last
                        ? `Se usa el último comentario de este registro (de ${last.author_name}).`
                        : 'Este registro todavía no tiene comentarios: {{comentario.x}} usa datos de ejemplo.',
                );
                if (last) {
                    const m = commentTriggerMatches(tc, last);
                    if (!m.ok) reasons.push(`con su último comentario no: ${m.reason.replace(/\.$/, '').toLowerCase()}`);
                }
                break;
            }
            case 'email_received': {
                // D2 — el último correo que llegó al ticket, o uno supuesto.
                const kind = cfg.email_kind === 'new' ? 'nuevo' : cfg.email_kind === 'reply' ? 'respuesta' : null;
                const last = ctx.recordId !== null ? await this.helpdesk()?.lastInbound(ctx.tenantId, ctx.recordId) : null;
                ctx.email = {
                    tipo: kind ?? (last?.tipo ?? 'nuevo'),
                    de: last?.de ?? 'cliente@ejemplo.com',
                    nombre: last?.nombre ?? 'Cliente',
                    asunto: last?.asunto ?? '(el asunto del correo)',
                    texto: last?.texto ?? '(el texto del correo)',
                    message_id: last?.message_id ?? null,
                };
                notes.push(
                    last
                        ? `Se usan los datos del último correo que llegó a este registro (de ${last.de}).`
                        : 'Este registro todavía no recibió correos: {{correo.x}} usa datos de ejemplo.',
                );
                break;
            }
            case 'sla_alert': {
                // E5 — una alerta supuesta: la primera que escucha el disparador.
                const alerts = Array.isArray(cfg.sla_alerts) ? (cfg.sla_alerts as unknown[]).map(String) : [];
                const targets = Array.isArray(cfg.sla_targets) ? (cfg.sla_targets as unknown[]).map(String) : [];
                const alerta = alerts.includes('at_risk') || alerts.length === 0 ? 'at_risk' : 'breached';
                const objetivo = targets.includes('first_response') || targets.length === 0 ? 'first_response' : 'resolution';
                const sla = ctx.recordId !== null ? await this.helpdesk()?.slaSnapshot(ctx.tenantId, ctx.recordId, objetivo) : null;
                ctx.sla = {
                    alerta,
                    objetivo,
                    vence: sla?.due ?? null,
                    prioridad: sla?.priority ?? null,
                    estado: alerta === 'breached' ? 'vencido' : 'en_riesgo',
                };
                notes.push(
                    `Se asume que la ${SLA_TARGET_LABELS[objetivo]} de este registro quedó ${SLA_ALERT_LABELS[alerta]}${sla?.due ? '' : ' (el registro no tiene SLA calculado: {{sla.vence}} queda vacío)'}.`,
                );
                break;
            }
            case 'subscription_event': {
                // v0.1.367 — el primer evento que escucha el disparador, con la
                // suscripción del registro (o datos de ejemplo si no tiene).
                const events = Array.isArray(cfg.subscription_events) ? (cfg.subscription_events as unknown[]).map(String) : [];
                const evento = (events[0] ?? 'charged') as SubscriptionEventInfo['evento'];
                const sample = ctx.recordId !== null ? await this.subscriptionsSvc()?.sampleEvent(ctx.tenantId, ctx.recordId, evento) : null;
                ctx.suscripcion = sample ?? sampleSubscriptionEvent(evento);
                notes.push(
                    sample
                        ? `Se asume que en la suscripción de este registro pasó: ${SUBSCRIPTION_EVENT_LABELS[evento].toLowerCase()}.`
                        : `Este registro no tiene suscripción: {{suscripcion.x}} usa datos de ejemplo (${SUBSCRIPTION_EVENT_LABELS[evento].toLowerCase()}).`,
                );
                break;
            }
            case SIGNATURE_EVENT_TRIGGER: {
                // v0.1.447 — el primer evento que escucha el disparador, con la
                // última firma del registro (o datos de ejemplo si no tiene).
                const evento = readSignatureTriggerEvents(cfg)[0] ?? 'completed';
                const sample = ctx.recordId !== null ? await this.signaturesSvc()?.sampleEvent(ctx.tenantId, ctx.recordId, evento).catch(() => null) : null;
                ctx.firma = sample ?? sampleSignatureEvent(evento);
                if (!signatureTriggerMatches(cfg, ctx.firma)) reasons.push('la firma de este registro no es de la plantilla elegida');
                notes.push(
                    sample
                        ? `Se usa la última firma de este registro («${sample.titulo}») y se asume: ${SIGNATURE_EVENT_LABELS[evento].toLowerCase()}.`
                        : `Este registro no tiene firmas: {{firma.x}} usa datos de ejemplo (${SIGNATURE_EVENT_LABELS[evento].toLowerCase()}).`,
                );
                break;
            }
            case RECORD_MATCHES_TRIGGER: {
                // v0.1.455 — si el registro cumple HOY la condición (con el mismo
                // motor de filtros de la tabla). La prueba no anota nada.
                if (ctx.recordId === null) break;
                const recordId = ctx.recordId;
                const now = await this.withMatchWhere({ tenantId: ctx.tenantId, listId: auto.listId, triggerConfig: cfg }, (tx, where) =>
                    matchesNow(tx, ctx.tenantId, auto.listId, recordId, where),
                );
                if (now === null) reasons.push('la condición no tiene reglas válidas (o el registro está en la papelera)');
                else if (!now.matches) reasons.push('este registro no cumple la condición');
                else notes.push('Este registro cumple la condición: dispara en el momento en que la EMPIEZA a cumplir, no otra vez mientras la siga cumpliendo.');
                notes.push('Se revisa al crear o cambiar un registro y, además, cada 15 minutos (para lo que entra por el paso del tiempo, como «vence en 3 días»).');
                break;
            }
            case FILE_ADDED_TRIGGER: {
                // v0.1.455 — el último archivo del campo elegido, como si acabara de llegar.
                const fc = readFileAddedConfig(cfg);
                if (ctx.recordId !== null) {
                    const sample = await this.addedFile(auto, ctx, {}, ctx.data);
                    if (sample) {
                        ctx.file = sample;
                        notes.push(`Se usa «${sample.name}» (${humanFileSize(sample.size)}) como si se acabara de subir.`);
                        break;
                    }
                }
                ctx.file = { id: 0, name: 'documento.pdf', mime: 'application/pdf', size: 245_000, field_id: fc.fieldId ?? 0, field_label: 'Archivos', link: '', count: 1 };
                notes.push('Este registro no tiene archivos de ese tipo: {{archivo.x}} usa datos de ejemplo.');
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

    /**
     * v0.1.322 — Todo lo que se calcula al leer el registro (búsquedas,
     * resúmenes, calculados, fórmulas, tiempo y columnas de sistema), para las
     * variables y condiciones. Sin el servicio de registros (specs que arman el
     * motor a mano) quedan sólo las columnas de sistema, como antes.
     */
    private async derivedData(
        tenantId: number,
        listId: number,
        recordId: number | null,
        maps: Pick<RunContext, 'slugToKey' | 'fieldsBySlug'>,
    ): Promise<Record<string, unknown>> {
        if (recordId === null) return {};
        const svc = this.records();
        const needsMore = [...maps.fieldsBySlug.values()].some((f) => isDerivedForVariables(f.type) && !isSystemField(f.type));
        if (svc && needsMore) {
            try {
                return await svc.derivedValues(tenantId, listId, recordId);
            } catch (e) {
                this.logger.warn(`No se pudieron leer los valores calculados del registro ${recordId}: ${(e as Error).message}`);
            }
        }
        return this.systemData(tenantId, recordId, maps);
    }

    /** slug → f{id}, slug → {type, config}, zona y formato regional de la empresa. */
    private async fieldMaps(
        tx: Tx,
        tenantId: number,
        listId: number,
    ): Promise<Pick<RunContext, 'slugToKey' | 'fieldsBySlug' | 'timeZone' | 'format' | 'recordLinkPrefix' | 'formEditLink'>> {
        const fieldRows = await this.fields.listByList(tx, tenantId, listId);
        // v0.1.360 — los formularios de la lista que aceptan enlaces para actualizar.
        const formRows = await tx
            .select({ id: forms.id, token: forms.token, config: forms.config })
            .from(forms)
            .where(and(eq(forms.tenantId, tenantId), eq(forms.listId, listId), eq(forms.enabled, true)));
        const editForms: EditLinkForm[] = [];
        for (const r of formRows) {
            const links = readEditLinks(r.config);
            if (links) editForms.push({ id: r.id, token: r.token, links });
        }
        const [tenant] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        const [listRow] = await tx.select({ slug: lists.slug }).from(lists).where(eq(lists.id, listId)).limit(1);
        const parsed = tenantFormatSchema.safeParse((tenant?.settings as Record<string, unknown> | null | undefined)?.format ?? {});
        return {
            slugToKey: new Map(fieldRows.map((f) => [f.slug, jsonbKeyForField(f.id)])),
            fieldsBySlug: new Map(fieldRows.map((f) => [f.slug, { type: f.type, config: f.config, label: f.label }])),
            timeZone: await this.tenantTimeZone(tx, tenantId),
            format: parsed.success ? parsed.data : DEFAULT_FORMAT,
            recordLinkPrefix: listRow ? await recordLinkPrefix(tenantId, listRow.slug) : '',
            formEditLink: await editLinkMaker(tenantId, editForms),
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
            // v0.1.386 — «sólo si la página contiene…» / «…y no contiene…».
            const page = ctx.form?.origin?.page_url ?? '';
            if (typeof cfg.page_contains === 'string' && cfg.page_contains.trim() !== '' && !pageMatchesAny(page, cfg.page_contains)) return false;
            if (typeof cfg.page_excludes === 'string' && cfg.page_excludes.trim() !== '' && page !== '' && pageMatchesAny(page, cfg.page_excludes)) return false;
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
        // A9 — «Cuando se completa un checklist»: cualquiera, uno por nombre o todos.
        if (auto.triggerType === 'checklist_completed') {
            if (!ctx.checklist || !checklistTriggerMatches(cfg, ctx.checklist)) return false;
        }
        // D5 — «Cuando se agenda, reprograma o cancela una cita»: la página (vacía = cualquiera) y los eventos.
        if (auto.triggerType === 'booking_event') {
            if (!ctx.booking || !bookingTriggerMatches(cfg, ctx.booking)) return false;
        }
        // D3 — «Cuando llega un mensaje de WhatsApp»: sin `connection_id` vale
        // cualquier número de la empresa; con uno, sólo ese.
        if (auto.triggerType === 'whatsapp_message_received') {
            if (!ctx.whatsapp) return false;
            const wanted = Number(cfg.connection_id);
            if (Number.isInteger(wanted) && wanted > 0 && ctx.whatsapp.conexion_id !== wanted) return false;
        }
        // D2 — «Cuando llega un correo»: cualquiera, sólo tickets nuevos o sólo respuestas.
        if (auto.triggerType === 'email_received') {
            if (!ctx.email || !emailTriggerMatches(cfg, ctx.email)) return false;
        }
        // v0.1.444 — «Cuando se agrega un comentario»: autor, visibilidad, hilo y palabras.
        if (auto.triggerType === COMMENT_ADDED_TRIGGER) {
            if (!ctx.comment || !commentTriggerMatches(readCommentTriggerConfig(cfg), ctx.comment).ok) return false;
        }
        // E5 — «Cuando un SLA está en riesgo o se vence»: las alertas y objetivos elegidos.
        if (auto.triggerType === 'sla_alert') {
            if (!ctx.sla || !slaTriggerMatches(cfg, ctx.sla)) return false;
        }
        // v0.1.367 — «Cuando cambia una suscripción»: los eventos y planes elegidos.
        if (auto.triggerType === 'subscription_event') {
            if (!ctx.suscripcion || !subscriptionTriggerMatches(cfg, ctx.suscripcion)) return false;
        }
        // v0.1.447 — «Cuando cambia una firma»: los eventos y plantillas elegidos.
        if (auto.triggerType === SIGNATURE_EVENT_TRIGGER) {
            if (!ctx.firma || !signatureTriggerMatches(cfg, ctx.firma)) return false;
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
            // v0.1.344 — {{registro.enlace}} y {{registro.qr}} (la imagen de su QR).
            const recordToken = recordTokenValue(token, ctx.recordLinkPrefix && ctx.recordId ? `${ctx.recordLinkPrefix}${ctx.recordId}` : '');
            if (recordToken !== undefined) return recordToken;
            // v0.1.360 — el enlace para que actualice su registro con un formulario.
            const editFormId = editLinkFormId(token);
            if (editFormId !== null) return ctx.formEditLink && ctx.recordId ? ctx.formEditLink(editFormId, ctx.recordId) : '';
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
            // C1 — un campo «Equipo» guarda ids: `.nombre` da sus nombres («Ventas, Soporte»).
            const teamTok = /^(before\.)?([a-zA-Z0-9_]+)\.nombre$/.exec(token);
            if (teamTok && ctx.fieldsBySlug.get(teamTok[2]!)?.type === 'team') {
                const key = ctx.slugToKey.get(teamTok[2]!);
                const source = teamTok[1] ? ctx.before : ctx.data;
                return teamIdsOf(key !== undefined ? source?.[key] : undefined)
                    .map((id) => ctx.teamNames?.get(id))
                    .filter((n): n is string => typeof n === 'string')
                    .join(', ');
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
            // v0.1.366 — {{reunion.enlace}}, {{reunion.id}}… de la reunión que
            // creó o cambió una acción de calendario anterior.
            if (token.startsWith('reunion.')) return ctx.reunion?.[token.slice('reunion.'.length)] ?? '';
            // v0.1.401 — {{whats.contacto_id}}, {{whats.ejecucion_id}}… de una acción de Whats anterior.
            if (token.startsWith('whats.')) return ctx.whats?.[token.slice('whats.'.length)] ?? '';
            // v0.1.455 — el archivo que se subió y la persona que asignó «Asignar por turno».
            if (token.startsWith('archivo.')) return fileEventValue(ctx.file, token.slice('archivo.'.length)) ?? '';
            if (token.startsWith('asignado.')) return ctx.asignado?.[token.slice('asignado.'.length)] ?? '';
            // v0.1.275 — {{formulario.nombre}} del formulario que se envió.
            if (token === 'formulario.nombre') return ctx.form?.name ?? '';
            // v0.1.386 — su título y de dónde llegó.
            if (token.startsWith('formulario.')) {
                const v = formEventValue(ctx.form, token.slice('formulario.'.length));
                if (v !== undefined) return v;
            }
            // C5 — {{aprobacion.resultado}}, {{aprobacion.flujo}}, {{aprobacion.motivo}}…
            if (token.startsWith('aprobacion.')) return approvalValue(ctx.approval, token.slice('aprobacion.'.length));
            // Campo «Botón» — el botón que se presionó y quién lo presionó.
            if (token === 'boton.nombre') return ctx.button?.label ?? '';
            if (token === 'boton.persona') return ctx.button?.user_name ?? '';
            if (token === 'boton.email') return ctx.button?.user_email ?? '';
            // D3 — el mensaje de WhatsApp que llegó.
            if (token.startsWith('whatsapp.')) {
                const v = ctx.whatsapp?.[token.slice('whatsapp.'.length) as keyof WhatsappEventInfo];
                return v === undefined || v === null ? '' : v;
            }
            // A9 — el checklist que quedó completo.
            if (token === 'checklist.nombre') return ctx.checklist?.name ?? '';
            if (token === 'checklist.items') return ctx.checklist?.total ?? '';
            // D5 — la cita de la agenda: {{cita.servicio}}, {{cita.inicio}}, {{cita.enlace_cancelar}}…
            if (token.startsWith('cita.')) {
                return bookingMergeValue(ctx.booking, token.slice('cita.'.length), ctx.format?.time_format ?? 'h24');
            }
            // D2 — el correo que llegó al buzón de soporte.
            if (token.startsWith('correo.')) return emailValue(ctx.email, token.slice('correo.'.length));
            // v0.1.444 — el comentario que disparó la automatización.
            if (token.startsWith('comentario.')) return ctx.comment ? (commentEventValue(ctx.comment, token.slice('comentario.'.length)) ?? '') : '';
            // E5 — la alerta de SLA (el vencimiento, en el formato y la zona de la empresa).
            if (token.startsWith('sla.')) return slaValue(ctx, token.slice('sla.'.length));
            // v0.1.367 — la suscripción del registro (fechas en la zona de la empresa).
            if (token.startsWith('suscripcion.')) return subscriptionValue(ctx, token.slice('suscripcion.'.length));
            // v0.1.447 — la firma electrónica (la del disparador o la que pidió un paso anterior).
            if (token.startsWith('firma.')) return ctx.firma ? (signatureEventValue(ctx.firma, token.slice('firma.'.length)) ?? '') : '';
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
        const body = info.body;
        if (body === null || typeof body !== 'object') return undefined;
        // v0.1.365 — `{{respuestas.pago.url}}` es lo mismo que
        // `{{respuestas.pago.body.url}}`: es como lo escribe casi cualquiera
        // (y el asistente) y antes quedaba vacío sin avisar.
        const path = rest.startsWith('body.') ? rest.slice('body.'.length) : rest;
        return serializeResponseValue(getPath(body as Record<string, unknown>, path));
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

    /** C1 — Carga (una vez por corrida) los nombres de los equipos del registro. */
    private async ensureTeamNames(ctx: RunContext): Promise<void> {
        const keys: string[] = [];
        for (const [slug, f] of ctx.fieldsBySlug) {
            if (f.type !== 'team') continue;
            const key = ctx.slugToKey.get(slug);
            if (key) keys.push(key);
        }
        if (keys.length === 0) return;
        ctx.teamNames ??= new Map();
        const ids = new Set<number>();
        for (const source of [ctx.data, ctx.before ?? {}]) {
            for (const key of keys) for (const id of teamIdsOf(source[key])) if (!ctx.teamNames.has(id)) ids.add(id);
        }
        if (ids.size === 0) return;
        const rows = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
            tx
                .select({ id: teams.id, name: teams.name })
                .from(teams)
                .where(and(eq(teams.tenantId, ctx.tenantId), inArray(teams.id, [...ids]))),
        );
        for (const r of rows) ctx.teamNames.set(r.id, r.name);
    }

    /** ¿Es la primera vez que el trabajo en curso llega a esta unidad? (ver `claimJobUnit`). */
    async firstTimeInJob(unit: string): Promise<boolean> {
        return (await claimJobUnit(this.redis, unit)).first;
    }

    /**
     * La corrida ya había empezado en un intento anterior del mismo trabajo:
     * no se repite. Si quedó «en curso», se cierra como fallida con el motivo
     * (así se ve en el historial en vez de quedar colgada una hora).
     */
    private async skipRepeatedRun(tenantId: number, automationId: number, previous: string | null): Promise<number | null> {
        const runId = previous && /^\d+$/.test(previous) ? Number(previous) : null;
        this.logger.warn(`Automatización ${automationId}: el trabajo se repitió tras un corte; la corrida ${runId ?? '(sin abrir)'} no se vuelve a ejecutar.`);
        if (runId === null) return null;
        await this.markInterrupted(tenantId, runId);
        return runId;
    }

    /** Cierra como fallida una corrida que un reinicio dejó «en curso». */
    async markInterrupted(tenantId: number, runId: number): Promise<void> {
        await this.tenantDb
            .withTenant(tenantId, (tx) =>
                tx
                    .update(automationRuns)
                    .set({ status: 'failed', error: INTERRUPTED_MESSAGE, finishedAt: new Date(), resumeAt: null })
                    .where(and(eq(automationRuns.tenantId, tenantId), eq(automationRuns.id, runId), eq(automationRuns.status, 'running'))),
            )
            .catch((err: unknown) => this.logger.warn(`No se pudo cerrar la corrida ${runId}: ${errorText(err)}`));
    }

    private async runOne(
        ctx: RunContext,
        auto: RunnableAutomation,
        /**
         * v0.1.399 — `preLog`: pasos que ya pasaron antes de las acciones (el
         * webhook entrante encontró o creó el registro) y encabezan el
         * historial. `stop`: la corrida no sigue (no encontró el registro, o la
         * búsqueda está mal configurada): queda registrada con ese estado y el
         * motivo, sin correr ninguna acción.
         */
        opts: { preLog?: ActionLogEntry[]; stop?: { status: 'cancelled' | 'failed'; log: ActionLogEntry[] } } = {},
    ): Promise<number | null> {
        ctx.automation = { id: auto.id, name: auto.name, trigger: auto.triggerType };
        // v0.1.300 — las columnas de sistema para las variables (`{{creado_por}}`).
        // v0.1.322 — y las búsquedas, resúmenes, calculados y fórmulas (`{{email_cliente}}`).
        if (ctx.recordId !== null && [...ctx.fieldsBySlug.entries()].some(([slug, f]) => isDerivedForVariables(f.type) && !(ctx.slugToKey.get(slug)! in ctx.data))) {
            ctx.data = { ...ctx.data, ...(await this.derivedData(ctx.tenantId, ctx.listId, ctx.recordId, ctx)) };
        }
        // El trabajo de la cola se repite si el servidor se cae a mitad (BullMQ
        // lo da por colgado y lo vuelve a correr entero). Una corrida que ya
        // había EMPEZADO en el intento anterior no se repite: sus correos,
        // mensajes, cobros o registros podrían salir dos veces.
        const unit = `run:${auto.id}:${ctx.recordId ?? 0}`;
        const claim = await claimJobUnit(this.redis, unit);
        if (!claim.first) return this.skipRepeatedRun(ctx.tenantId, auto.id, claim.previous);
        const startedAt = new Date();
        let runId: number | null = null;
        try {
            runId = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
                this.automations.startRun(tx, { tenantId: ctx.tenantId, automationId: auto.id, recordId: ctx.recordId, startedAt }),
            );
            if (runId !== null) await noteJobUnit(this.redis, unit, String(runId));
        } catch (err) {
            // La automatización se borró mientras se encolaba el evento.
            this.logger.warn(`No se pudo abrir la corrida de la automatización ${auto.id}: ${errorText(err)}`);
            return null;
        }
        if (runId === null) return null;

        if (opts.stop) {
            const { status, log } = opts.stop;
            const reason = log.find((l) => l.status !== 'success')?.message ?? log[0]?.message ?? null;
            try {
                await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
                    this.automations.finishRun(tx, ctx.tenantId, runId!, { status, actionsLog: capLog(log), error: reason, finishedAt: new Date() }),
                );
            } catch (err) {
                this.logger.error(`No se pudo cerrar la corrida ${runId} de la automatización ${auto.id}: ${errorText(err)}`);
            }
            // «No encontré el registro» no es una falla de la automatización; una
            // búsqueda mal configurada sí (se avisa en Problemas).
            if (status === 'failed') this.reportRun(ctx, auto, log);
            return runId;
        }

        let flow: Flow;
        try {
            flow = await this.runSteps(ctx, auto.actions, [], 0, 0);
        } catch (err) {
            flow = { log: [{ action: 'engine', status: 'failed', message: errorText(err, 2000), details: {} }] };
            this.logger.error(`Automatización ${auto.id} falló: ${String(err)}`);
        }
        const log = opts.preLog && opts.preLog.length > 0 ? [...opts.preLog, ...flow.log] : flow.log;
        await this.finalize(ctx, auto, runId, log, flow.pause ?? null, log.some((l) => l.status === 'failed'));
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
                ...(ctx.checklist ? { checklist: ctx.checklist } : {}),
                ...(ctx.booking ? { booking: ctx.booking } : {}),
                ...(ctx.email ? { email: ctx.email } : {}),
                ...(ctx.comment ? { comment: ctx.comment } : {}),
                ...(ctx.sla ? { sla: ctx.sla } : {}),
                ...(ctx.pdf ? { pdf: ctx.pdf } : {}),
                ...(ctx.reunion ? { reunion: ctx.reunion } : {}),
                ...(ctx.whats ? { whats: ctx.whats } : {}),
                ...(ctx.webhook ? { webhook: ctx.webhook } : {}),
                ...(ctx.responses ? { responses: ctx.responses } : {}),
                ...(ctx.chain ? { chain: ctx.chain } : {}),
                ...(ctx.approval ? { approval: ctx.approval } : {}),
                ...(ctx.suscripcion ? { suscripcion: ctx.suscripcion } : {}),
                ...(ctx.firma ? { firma: ctx.firma } : {}),
                ...(ctx.actorId ? { actor_id: ctx.actorId } : {}),
                ...(ctx.file ? { file: ctx.file } : {}),
                ...(ctx.asignado ? { asignado: ctx.asignado } : {}),
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
        await this.ensureTeamNames(ctx);
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

        // D2 — responder por correo al hilo del ticket: la mesa de ayuda manda
        // el correo y escribe el comentario en sus propias transacciones (no
        // dentro de una del motor: el reloj del SLA vuelve a escribir la fila).
        if (spec.type === 'reply_email') {
            try {
                return { log: tag([await this.replyEmail(ctx, spec.config ?? {})]) };
            } catch (err) {
                return { log: tag([{ action: spec.type, status: 'failed', message: explainError(err), details: {} }]) };
            }
        }

        // E6 — pedirle trabajo a un agente de IA: queda en su cola (corre aparte,
        // con el acceso de su dueño) y deja su propio historial.
        if (spec.type === 'ask_agent') {
            try {
                return { log: tag([await this.askAgent(ctx, spec.config ?? {})]) };
            } catch (err) {
                return { log: tag([fail('ask_agent', explainError(err))]) };
            }
        }

        // v0.1.447 — «Pedir firma»: arma el PDF y lo manda a firmar con su
        // propio servicio (abre y confirma sus transacciones, manda los correos).
        if (spec.type === REQUEST_SIGNATURE_ACTION) {
            try {
                return { log: tag([await this.requestSignature(ctx, spec.config ?? {})]) };
            } catch (err) {
                return { log: tag([fail(REQUEST_SIGNATURE_ACTION, explainError(err))]) };
            }
        }

        // v0.1.444 — «Buscar registros»: sólo lee; deja lo encontrado con un
        // nombre y, si se pidió, detiene la automatización si no encuentra nada.
        if (spec.type === FIND_RECORDS_ACTION) {
            try {
                const r = await this.findRecords(ctx, spec.config ?? {});
                // «Probar»: lo encontrado sugiere sus rutas en el selector de variables.
                if (ctx.sim) {
                    const found = ctx.responses?.[readFindRecordsConfig(spec.config ?? {}).responseName];
                    if (found) ctx.sim.responses[pathKey] = found.body;
                }
                return { log: tag([r.entry]), ...(r.stop ? { stop: true } : {}) };
            } catch (err) {
                return { log: tag([fail(FIND_RECORDS_ACTION, explainError(err))]), stop: true };
            }
        }

        // v0.1.455 — avisar, asignar por turno y copiar: escriben por sus
        // servicios (avisos, registros), fuera de una transacción del motor.
        if (spec.type === NOTIFY_IN_APP_ACTION || spec.type === ASSIGN_ROUND_ROBIN_ACTION || spec.type === COPY_RECORD_ACTION) {
            try {
                const entry =
                    spec.type === NOTIFY_IN_APP_ACTION
                        ? await this.notifyInApp(ctx, spec.config ?? {})
                        : spec.type === ASSIGN_ROUND_ROBIN_ACTION
                          ? await this.assignRoundRobin(ctx, spec.config ?? {}, pathKey)
                          : await this.copyRecord(ctx, spec.config ?? {});
                if (ctx.sim && spec.type === COPY_RECORD_ACTION) {
                    const copied = ctx.responses?.[readCopyRecordConfig(spec.config ?? {}).responseName];
                    if (copied) ctx.sim.responses[pathKey] = copied.body;
                }
                return { log: tag([entry]) };
            } catch (err) {
                return { log: tag([fail(spec.type, explainError(err))]) };
            }
        }

        // Escribir registros: por RecordsService (abre y confirma su propia
        // transacción, con actividad, tiempo real y automatizaciones).
        if (spec.type === 'update_field' || spec.type === 'create_record' || spec.type === 'create_subtasks_from_template' || spec.type === UPSERT_RECORD_ACTION) {
            try {
                return {
                    log: tag([
                        spec.type === 'update_field'
                            ? await this.updateField(ctx, spec.config ?? {})
                            : spec.type === 'create_record'
                              ? await this.createRecord(ctx, spec.config ?? {})
                              : spec.type === UPSERT_RECORD_ACTION
                                ? await this.upsertRecord(ctx, spec.config ?? {})
                                : await this.createSubtasksFromTemplate(ctx, spec.config ?? {}),
                    ]),
                };
            } catch (err) {
                return { log: tag([{ action: spec.type, status: 'failed', message: explainError(err), details: {} }]) };
            }
        }

        // v0.1.285 — cada acción en su propia transacción: un error de base de
        // datos en una acción no arrastra a las demás ni a la corrida.
        let out: ActionLogEntry | null = null;
        const step: { later?: AfterCommit } = {};
        const pdfsBefore = new Set(ctx.pdfs?.keys() ?? []);
        ctx.docUploads = [];
        try {
            await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
                const r = await this.execAction(tx, ctx, spec, pathKey);
                if (isAfterCommit(r)) step.later = r;
                else out = r;
            });
            ctx.docUploads = undefined;
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
        // v0.1.392 — la parte que espera a otro servicio, ya sin transacción.
        if (step.later) {
            try {
                out = await step.later.afterCommit();
            } catch (err) {
                return { log: tag([{ action: spec.type, status: 'failed', message: errorText(err, 2000), details: {} }]) };
            }
        }
        return { log: tag([out!]) };
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
     * E6 — «Pedirle a un agente». Las variables de la instrucción extra traen
     * DATOS del registro: se envuelven como dato para el modelo. En «Probar»
     * no se le pide nada (el agente tiene su propio «Probar», que sí llama al
     * modelo): sólo se dice qué pasaría. Lo que escriba el agente lleva la
     * cadena de esta automatización (tope de profundidad, sin re-disparo).
     */
    private async askAgent(ctx: RunContext, cfg: Record<string, unknown>): Promise<ActionLogEntry> {
        const { agent_id, instruction } = readAskAgentConfig(cfg);
        if (agent_id === null) return fail('ask_agent', 'Elige el agente de IA al que se le pide el trabajo.');
        if (!this.agents) return fail('ask_agent', 'Los agentes de IA no están disponibles en este servidor.');
        {
            // v0.1.338 (ADR-S87) — plan sin «Inteligencia artificial».
            const off = await this.tenantDb.withTenant(ctx.tenantId, (tx) => planModuleStepError(tx, ctx.tenantId, 'ai'));
            if (off) return fail('ask_agent', off);
        }
        const { merge } = this.mergers(ctx);
        const extra = instruction ? merge(instruction, wrapMergedValue).trim() : '';
        if (ctx.sim) {
            const p = await this.agents.preview(ctx.tenantId, agent_id, ctx.listId);
            if (!p) return fail('ask_agent', 'El agente de IA ya no existe.');
            if (!p.active) return skip('ask_agent', `El agente «${p.name}» está en pausa: no se le pediría nada.`);
            if (!p.inScope) return fail('ask_agent', `El agente «${p.name}» no trabaja en esta lista.`);
            return ok(
                'ask_agent',
                `Le pediría al agente «${p.name}» que trabaje sobre ${ctx.recordId !== null ? 'este registro' : 'este disparo'}${extra ? ` (instrucción: «${extra.slice(0, 160)}»)` : ''}. ${p.mode === 'propose' ? 'Sus cambios quedarían como propuesta.' : 'Haría los cambios.'} Para ver qué haría, usa «Probar» en el agente.`,
                { _sim: 'would_run', agent: p.name },
            );
        }
        const res = await this.agents.ask({
            tenantId: ctx.tenantId,
            agentId: agent_id,
            listId: ctx.listId,
            recordId: ctx.recordId,
            automation: ctx.automation ? { id: ctx.automation.id, name: ctx.automation.name } : null,
            triggerType: ctx.automation?.trigger ?? '',
            instruction: extra,
            chain: nextChain(ctx.chain, ctx.automation?.id ?? 0),
        });
        if (res.status === 'failed') return fail('ask_agent', res.message);
        if (res.status === 'skipped') return skip('ask_agent', res.message);
        return ok('ask_agent', res.message, { agent: res.agentName, agent_run_id: res.runId });
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
            // En una prueba de alguien con acceso parcial: sólo los vinculados que ve.
            ctx.sim?.viewer ?? SYSTEM_ACTOR,
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
        const emptyVars: string[] = [];
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
            // v0.1.365 — una variable que no existe (o vacía) dejaba el campo
            // igual y el log decía «ya tenían esos valores»: ahora se nombra.
            if (typeof raw === 'string' && raw.includes('{{') && isBlank(this.fieldInput(ctx, raw, field).value)) {
                emptyVars.push(`«${field.label ?? slug}» (${raw.trim()} quedó vacía)`);
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
            const map = mirrorFieldMap(marker);
            const row = (packSlug: string): unknown => {
                const id = map[packSlug];
                return id ? merged[`f${id}`] : undefined;
            };
            for (const slug of Object.keys(applied)) {
                const key = target.slugToKey.get(slug)!;
                const fieldId = Number(key.slice(1));
                const access = mirrorCellAccess(marker, fieldId, row);
                const err =
                    access.access === 'locked'
                        ? access.reason
                        : access.access === 'editable'
                          ? mirrorValueError(marker, fieldId, merged[key], row)
                          : null;
                if (!err) continue;
                delete patch[key];
                delete applied[slug];
                storeSkipped.push(`${slug} (${err})`);
            }
        }
        // E5 + v0.1.383 — las columnas protegidas (vencimientos y estado del SLA,
        // lo que escriben los pagos y las suscripciones) no se escriben a mano.
        const managed = ctx.helpdeskManaged?.get(target.listId);
        if (managed && managed.size > 0) {
            for (const slug of Object.keys(applied)) {
                const key = target.slugToKey.get(slug)!;
                const lock = managed.get(Number(key.slice(1)));
                if (!lock) continue;
                delete patch[key];
                delete applied[slug];
                storeSkipped.push(`${slug} (${lock.reason})`);
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

        const notes = [...storeSkipped, ...invalid, ...emptyVars];
        const where = onItem ? ` (registro vinculado #${target.recordId})` : '';
        if (Object.keys(patch).length === 0) {
            // Nada válido que escribir por valores que no convierten: la
            // automatización está mal configurada y se tiene que ver.
            if (invalid.length > 0 && storeSkipped.length === 0) {
                return fail('update_field', `No se pudo escribir ningún valor${where}: ${[...invalid, ...emptyVars].join('; ')}.`);
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
        return ok('update_field', `Actualizó ${count} campo(s)${where}.${note}${chainCutNote(ctx)}`, {
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
        // Una lista de tienda (o de un sitio WordPress) no admite altas: sus registros nacen allá.
        const mirror = readMirrorListMarker(pre.settings);
        if (mirror) {
            return skip(
                'create_record',
                mirror.source === 'store'
                    ? 'La lista destino está sincronizada con una tienda: los registros se crean en WooCommerce.'
                    : 'La lista destino viene de un sitio WordPress: lo nuevo se crea en WordPress.',
            );
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

        const { data, relations, skipped } = await this.resolveRecordValues(ctx, pre.fields, (cfg.values as Record<string, unknown>) ?? {});

        // C6 — «Crear un registro» desde una plantilla de la lista destino: los
        // valores de la acción pisan los de la plantilla.
        const templateId = Number(cfg.template_id);
        const useTemplate = Number.isInteger(templateId) && templateId > 0;
        // Obligatorios que quedaron vacíos: el registro se crea igual (como
        // siempre), pero se avisa. Con plantilla, la plantilla puede llenarlos.
        for (const f of useTemplate ? [] : pre.fields) {
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
            const tpl = useTemplate ? await this.recordTemplates()?.get(ctx.tenantId, String(targetList), templateId).catch(() => null) : null;
            if (useTemplate && !tpl) return fail('create_record', 'La plantilla de registro elegida ya no existe en la lista destino.');
            const fromTpl = tpl
                ? ` desde la plantilla «${tpl.name}» (${tpl.content.subtasks.length} subtarea(s), ${tpl.content.checklists.length} checklist(s))`
                : '';
            return ok('create_record', `Crearía un registro en «${tl?.name ?? `lista ${targetList}`}»${fromTpl} con ${shown.length} valor(es).${note}`, {
                _sim: 'would_run',
                list: tl?.name ?? null,
                values: shown,
                ...(skipped.length > 0 ? { warnings: skipped } : {}),
            });
        }
        if (useTemplate) {
            const out = await this.writeCreateFromTemplate(ctx, targetList, templateId, data, relations.filter((r) => r.ids.length > 0));
            const extra = [
                out.subtask_ids.length > 0 ? `${out.subtask_ids.length} subtarea(s)` : '',
                out.checklist_ids.length > 0 ? `${out.checklist_ids.length} checklist(s)` : '',
            ].filter(Boolean);
            const warnings = [...skipped, ...out.warnings];
            return ok('create_record', `Creó registro #${out.record_id} en lista ${targetList} desde una plantilla${extra.length > 0 ? ` (con ${extra.join(' y ')})` : ''}.${note}`, {
                record_id: out.record_id,
                subtask_ids: out.subtask_ids,
                ...(warnings.length > 0 ? { warnings } : {}),
            });
        }
        const created = await this.writeCreate(ctx, targetList, data, relations.filter((r) => r.ids.length > 0));
        return ok('create_record', `Creó registro #${created.id} en lista ${targetList}.${note}${chainCutNote(ctx)}`, {
            record_id: created.id,
            ...(skipped.length > 0 ? { warnings: skipped } : {}),
        });
    }

    /**
     * Los valores que una acción escribe en un registro (por slug o `f{id}`):
     * cada uno convertido y validado para su campo (lo que no se puede, se
     * saltea con el motivo) y los vínculos sólo a registros vivos de la lista
     * destino del campo. Lo usan «Crear un registro» y «Crear o actualizar».
     */
    private async resolveRecordValues(
        ctx: RunContext,
        fields: readonly FieldRow[],
        rawValues: Record<string, unknown>,
    ): Promise<{ data: Record<string, unknown>; relations: Array<{ fieldId: number; label: string; targetListId: number; ids: number[] }>; skipped: string[] }> {
        const byKey = new Map(fields.map((f) => [jsonbKeyForField(f.id), f]));
        const bySlug = new Map(fields.map((f) => [f.slug, f]));
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
        return { data, relations, skipped };
    }

    /**
     * v0.1.444 — «Buscar registros»: busca en una lista (la de la automatización
     * u otra de la empresa) con condiciones cuyos valores aceptan variables, y
     * deja lo encontrado con un nombre para los pasos siguientes
     * (`{{respuestas.<nombre>.cantidad}}`, `{{respuestas.<nombre>.primero.<campo>}}`,
     * `{{respuestas.<nombre>.ids}}`). Sólo lee: corre igual en «Probar».
     *
     * «es» / «no es» sobre texto, correo, enlace o teléfono compara como
     * «Actualizar desde un archivo»: sin mayúsculas ni espacios de más, y el
     * teléfono por sus dígitos (con o sin indicativo). Una condición cuyo valor
     * quedó vacío (`{{correo}}` sin correo) no busca «todo»: con «todas», no
     * encuentra nada; con «alguna», esa condición no cuenta.
     */
    private async findRecords(ctx: RunContext, cfg: Record<string, unknown>): Promise<{ entry: ActionLogEntry; stop: boolean }> {
        const A = FIND_RECORDS_ACTION;
        const c = readFindRecordsConfig(cfg);
        const listId = c.listId ?? ctx.listId;
        const pre = await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const [l] = await tx
                .select({ name: lists.name, settings: lists.settings })
                .from(lists)
                .where(and(eq(lists.tenantId, ctx.tenantId), eq(lists.id, listId)))
                .limit(1);
            if (!l) return null;
            return { name: l.name, settings: (l.settings ?? {}) as Record<string, unknown>, fields: await this.fields.listByList(tx, ctx.tenantId, listId) };
        });
        if (!pre) return { entry: fail(A, `La lista donde se busca (#${listId}) ya no existe en esta empresa.`), stop: true };
        const bySlug = new Map(pre.fields.map((f) => [f.slug, f]));
        const filterable = new Map<number, FilterableField>(pre.fields.map((f) => [f.id, { id: f.id, type: f.type as FieldType }]));
        const clock = { now: new Date(), timeZone: ctx.timeZone ?? FALLBACK_TIME_ZONE };
        const parts: SQL[] = [];
        const notes: string[] = [];
        let impossible = false;
        for (const cond of c.conditions) {
            const field = bySlug.get(cond.field);
            if (!field) return { entry: fail(A, `El campo «${cond.field}» ya no existe en «${pre.name}»: revisa la búsqueda.`), stop: true };
            const label = `«${field.label}»`;
            if (!isFindableFieldType(field.type)) {
                return { entry: fail(A, `No se puede buscar por ${label} (${field.type}): elige otro campo.`), stop: true };
            }
            if (findOperatorIsNullary(cond.op)) {
                const one = compileFilterTree(filterable, { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: field.id, op: cond.op }] }, clock);
                if (one) parts.push(one);
                continue;
            }
            const resolved = this.findConditionValue(ctx, field, cond.op, cond.value);
            if (resolved.kind === 'error') return { entry: fail(A, `${label}: ${resolved.message}`), stop: true };
            if (resolved.kind === 'empty') {
                notes.push(`${label} quedó vacío`);
                if (c.logic === 'and') impossible = true;
                continue;
            }
            if (resolved.kind === 'keys') {
                const keys = resolved.keys;
                const expr = keyExpr({ id: field.id, type: field.type as never });
                const match = sql`${expr} IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`;
                parts.push(cond.op === 'neq' ? sql`(${expr} IS NULL OR NOT (${match}))` : match);
                continue;
            }
            const one = compileFilterTree(
                filterable,
                { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: field.id, op: cond.op as FilterOperator, value: resolved.value }] },
                clock,
            );
            if (one) parts.push(one);
        }
        const noneUsable = c.logic === 'or' && c.conditions.length > 0 && parts.length === 0;
        const sortField = c.sortField && c.sortField !== 'created_at' ? bySlug.get(c.sortField) : undefined;
        const titleId = resolveTitleFieldId(pre.fields.map((f) => ({ id: f.id, type: f.type as never })), pre.settings);
        const titleKey = titleId ? jsonbKeyForField(titleId) : null;
        const keyToSlug = new Map(pre.fields.map((f) => [jsonbKeyForField(f.id), f.slug]));

        let rows: Array<{ id: number; data: Record<string, unknown> }> = [];
        let total = 0;
        if (!impossible && !noneUsable) {
            const where = and(
                eq(records.tenantId, ctx.tenantId),
                eq(records.listId, listId),
                isNull(records.deletedAt),
                c.excludeSelf && listId === ctx.listId && ctx.recordId !== null ? ne(records.id, ctx.recordId) : undefined,
                parts.length === 0 ? undefined : c.logic === 'or' ? or(...parts) : and(...parts),
            );
            const sortExpr = sortField ? fieldTypedExpr({ id: sortField.id, type: sortField.type as FieldType }) : null;
            const dir = c.sortDir === 'asc' ? asc : desc;
            const out = await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
                const found = await tx
                    .select({ id: records.id, data: records.data })
                    .from(records)
                    .where(where)
                    .orderBy(...(sortExpr ? [sql`${sortExpr} ${sql.raw(c.sortDir === 'asc' ? 'ASC' : 'DESC')} NULLS LAST`, dir(records.id)] : [dir(records.id)]))
                    .limit(c.limit);
                const [n] = found.length < c.limit ? [{ n: found.length }] : await tx.select({ n: sql<number>`count(*)::int` }).from(records).where(where);
                return { found, total: Number(n?.n ?? found.length) };
            });
            rows = out.found.map((r) => ({ id: r.id, data: (r.data ?? {}) as Record<string, unknown> }));
            total = out.total;
        }
        const shaped = rows.map((r) => {
            const values: Record<string, unknown> = { id: r.id, titulo: titleKey ? recordTitleText(r.data[titleKey]) : `#${r.id}` };
            for (const [k, v] of Object.entries(r.data)) {
                const slug = keyToSlug.get(k);
                if (slug && !(slug in values)) values[slug] = v;
            }
            return values;
        });
        const first = shaped[0] ?? null;
        const body = {
            cantidad: rows.length,
            total,
            ids: rows.map((r) => r.id),
            primero: first,
            registros: shaped,
            lista: pre.name,
        };
        this.rememberNamed(ctx, { response_name: c.responseName }, { status: 200, body });
        const why = notes.length > 0 ? ` (${notes.join('; ')}: ${c.logic === 'and' ? 'no se buscó' : 'esa condición no contó'})` : '';
        const where = `«${pre.name}»`;
        const details: Record<string, unknown> = {
            list: pre.name,
            count: rows.length,
            total,
            ids: body.ids,
            response_name: c.responseName,
            ...(first ? { first: { id: first.id, titulo: first.titulo } } : {}),
            ...(ctx.sim ? { _sim: 'info' } : {}),
        };
        if (rows.length === 0) {
            const msg = `No encontró registros en ${where}${why}.`;
            if (c.ifNone === 'stop') return { entry: skip(A, `${msg} La automatización no siguió.`), stop: true };
            return { entry: ok(A, msg, details), stop: false };
        }
        const more = total > rows.length ? ` (hay ${total}: guardó los primeros ${rows.length})` : '';
        const named = first ? `: el primero es #${first.id}${first.titulo ? ` «${String(first.titulo)}»` : ''}` : '';
        return { entry: ok(A, `Encontró ${rows.length} registro(s) en ${where}${more}${named}.${why ? ` Nota${why}.` : ''}`, details), stop: false };
    }

    /**
     * El valor de una condición de «Buscar registros», ya resuelto: las
     * variables, la opción por su etiqueta, el número o la fecha en su forma, o
     * las claves comparables de un texto (sin mayúsculas, el teléfono por dígitos).
     */
    private findConditionValue(
        ctx: RunContext,
        field: FieldRow,
        op: FindOperator,
        raw: unknown,
    ): { kind: 'value'; value: unknown } | { kind: 'keys'; keys: string[] } | { kind: 'empty' } | { kind: 'error'; message: string } {
        const input = this.fieldInput(ctx, raw, field).value;
        const isBlankValue =
            input === null || input === undefined || (typeof input === 'string' && input.trim() === '') || (Array.isArray(input) && input.length === 0);
        if (isBlankValue) return { kind: 'empty' };
        const type = field.type;
        if (type === 'relation') {
            const ids = parseRelationIds(input);
            if (ids.length === 0) return { kind: 'error', message: `«${String(input)}» no es el id de un registro.` };
            return { kind: 'value', value: ids };
        }
        if (type === 'select' || type === 'multi_select') {
            const options = ((field.config as { options?: Array<{ value?: unknown; label?: unknown }> } | null)?.options ?? []).filter(
                (o): o is { value: string; label?: unknown } => typeof o?.value === 'string',
            );
            const wanted = (Array.isArray(input) ? input : [input]).map((v) => String(v).trim()).filter((v) => v !== '');
            const values: string[] = [];
            for (const w of wanted) {
                const folded = foldSearchText(w);
                const opt = options.find((o) => o.value === w) ?? options.find((o) => foldSearchText(o.value) === folded || foldSearchText(String(o.label ?? '')) === folded);
                if (!opt) {
                    if (op === 'contains' || op === 'not_contains') {
                        values.push(w);
                        continue;
                    }
                    return { kind: 'error', message: `«${w}» no es una opción del campo.` };
                }
                values.push(opt.value);
            }
            if (values.length === 0) return { kind: 'empty' };
            return { kind: 'value', value: values[0] };
        }
        const textLike = type === 'text' || type === 'long_text' || type === 'email' || type === 'url' || type === 'phone' || type === 'autonumber' || type === 'ai';
        if (textLike) {
            const text = Array.isArray(input) ? input.join(', ') : String(input);
            if (op === 'eq' || op === 'neq') {
                const keys = type === 'phone' ? matchKeysFor(field, text) : [normalizeKey({ id: field.id, type: type as never }, text)].filter((k) => k !== '');
                if (keys.length === 0) return { kind: 'empty' };
                return { kind: 'keys', keys };
            }
            return { kind: 'value', value: text.trim() };
        }
        // Números, fechas, casilla, persona, equipo…: convertidos como al escribir el campo.
        const res = this.coerce(ctx, field, raw);
        if (!res.ok) return { kind: 'error', message: res.error };
        if (res.value === null || res.value === undefined) return { kind: 'empty' };
        return { kind: 'value', value: res.value };
    }

    /**
     * v0.1.444 — «Crear o actualizar un registro»: busca UN registro por su id
     * o por un campo «Sin repetidos» y lo actualiza; si no existe, lo crea (o
     * sólo actualiza, o sólo crea si no existe). Nunca adivina: con dos
     * registros con el mismo valor (datos de antes de «Sin repetidos»), falla
     * sin tocar ninguno. Un valor que quedó vacío no borra lo que ya tenía.
     * Deja `{{respuestas.<nombre>.id}}`, `.titulo` y `.accion`.
     */
    private async upsertRecord(ctx: RunContext, cfg: Record<string, unknown>): Promise<ActionLogEntry> {
        const A = UPSERT_RECORD_ACTION;
        const c = readUpsertRecordConfig(cfg);
        const listId = c.listId ?? ctx.listId;
        const pre = await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const [l] = await tx
                .select({ name: lists.name, settings: lists.settings })
                .from(lists)
                .where(and(eq(lists.tenantId, ctx.tenantId), eq(lists.id, listId)))
                .limit(1);
            if (!l) return null;
            return { name: l.name, settings: (l.settings ?? {}) as Record<string, unknown>, fields: await this.fields.listByList(tx, ctx.tenantId, listId) };
        });
        if (!pre) return fail(A, `La lista destino (#${listId}) no existe en esta empresa.`);
        const titleId = resolveTitleFieldId(pre.fields.map((f) => ({ id: f.id, type: f.type as never })), pre.settings);
        const titleOf = (data: Record<string, unknown>, id: number): string => (titleId ? recordTitleText(data[jsonbKeyForField(titleId)]) : '') || `#${id}`;
        const remember = (id: number | null, titulo: string, accion: string): void =>
            this.rememberNamed(ctx, { response_name: c.responseName }, { status: 200, body: { id, titulo, accion, lista: pre.name } });

        // 1) Con qué dato se busca (acepta variables).
        const matchField = c.match.by === 'field' ? pre.fields.find((f) => f.slug === (c.match as { field: string }).field) : undefined;
        if (c.match.by === 'field') {
            const err = webhookMatchFieldError(
                matchField ? { slug: matchField.slug, type: matchField.type, label: matchField.label, is_unique: matchField.isUnique } : undefined,
            );
            if (err) return fail(A, err);
        }
        const rawMatch = this.fieldInput(ctx, c.matchValue, matchField ?? { type: 'text', config: {} }).value;
        const matchText = rawMatch === null || rawMatch === undefined ? '' : Array.isArray(rawMatch) ? String(rawMatch[0] ?? '') : String(rawMatch).trim();

        // 2) Buscar UN registro.
        type Found = { id: number; data: Record<string, unknown> };
        let found: Found | null = null;
        let lookedFor = '';
        if (matchText !== '') {
            if (c.match.by === 'record_id') {
                const id = parseRecordIdValue(matchText);
                lookedFor = `el registro #${matchText}`;
                if (id !== null) {
                    const [row] = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
                        tx
                            .select({ id: records.id, data: records.data })
                            .from(records)
                            .where(and(eq(records.tenantId, ctx.tenantId), eq(records.listId, listId), eq(records.id, id), isNull(records.deletedAt)))
                            .limit(1),
                    );
                    if (row) found = { id: row.id, data: (row.data ?? {}) as Record<string, unknown> };
                }
            } else if (matchField) {
                lookedFor = `«${matchField.label}» = ${matchText}`;
                const keys = matchKeysFor(matchField, matchText);
                if (keys.length > 0) {
                    const expr = keyExpr({ id: matchField.id, type: matchField.type as never });
                    const rows = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
                        tx
                            .select({ id: records.id, data: records.data })
                            .from(records)
                            .where(
                                and(
                                    eq(records.tenantId, ctx.tenantId),
                                    eq(records.listId, listId),
                                    isNull(records.deletedAt),
                                    sql`${expr} IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`,
                                ),
                            )
                            .orderBy(desc(records.id))
                            .limit(4),
                    );
                    if (rows.length > 1) {
                        const ids = rows.slice(0, 3).map((r) => `#${r.id}`).join(', ');
                        return fail(A, `Hay ${rows.length > 3 ? 'más de 3' : rows.length} registros con ${lookedFor} (${ids}): no se tocó ninguno. Deja uno solo con ese valor.`);
                    }
                    if (rows[0]) found = { id: rows[0].id, data: (rows[0].data ?? {}) as Record<string, unknown> };
                }
            }
        }
        if (matchText === '' && c.mode === 'update_only') {
            remember(null, '', 'no_encontrado');
            return skip(A, 'El dato con el que se busca quedó vacío: no se buscó ningún registro.');
        }

        // 3) Los valores (convertidos y validados para cada campo).
        const { data, relations, skipped } = await this.resolveRecordValues(ctx, pre.fields, c.values);
        const note = skipped.length > 0 ? ` Omitidos: ${skipped.join('; ')}.` : '';

        if (found) {
            const title = titleOf(found.data, found.id);
            if (c.mode === 'create_only') {
                remember(found.id, title, 'ya_existia');
                return ok(A, `Ya existía #${found.id} «${title}» (${lookedFor}): no se creó otro.`, { record_id: found.id, action: 'exists' });
            }
            // Sólo lo que cambia (un vínculo se escribe siempre: reemplaza los de ese campo).
            const patch: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(data)) if (JSON.stringify(found.data[k]) !== JSON.stringify(v)) patch[k] = v;
            for (const r of relations) if (r.ids.length > 0) patch[jsonbKeyForField(r.fieldId)] = r.ids;
            if (Object.keys(patch).length === 0) {
                remember(found.id, title, 'sin_cambios');
                return ok(A, `#${found.id} «${title}» ya tenía esos valores (${lookedFor}).${note}`, { record_id: found.id, action: 'unchanged' });
            }
            if (ctx.sim) {
                remember(found.id, title, 'actualizado');
                return ok(A, `Actualizaría ${Object.keys(patch).length} campo(s) de #${found.id} «${title}» (${lookedFor}).${note}`, {
                    _sim: 'would_run',
                    record_id: found.id,
                    values: Object.keys(patch).map((k) => pre.fields.find((f) => jsonbKeyForField(f.id) === k)?.label ?? k),
                });
            }
            const keyToSlug = new Map(pre.fields.map((f) => [jsonbKeyForField(f.id), f.slug]));
            const fieldsBySlug = new Map(pre.fields.map((f) => [f.slug, f as unknown as LabelFieldLike]));
            const after = await this.writeUpdate(ctx, { listId, recordId: found.id, slugToKey: new Map([...keyToSlug].map(([k, slug]) => [slug, k])), fieldsBySlug }, patch, found.data);
            const newTitle = titleOf(after, found.id);
            remember(found.id, newTitle, 'actualizado');
            return ok(A, `Actualizó ${Object.keys(patch).length} campo(s) de #${found.id} «${newTitle}» (${lookedFor}).${note}${chainCutNote(ctx)}`, {
                record_id: found.id,
                action: 'updated',
                ...(skipped.length > 0 ? { warnings: skipped } : {}),
            });
        }

        // 4) No existe.
        if (c.mode === 'update_only') {
            remember(null, '', 'no_encontrado');
            return skip(A, `No encontré ${lookedFor || 'el registro'} en «${pre.name}»: no se actualizó nada.`);
        }
        const mirror = readMirrorListMarker(pre.settings);
        if (mirror) {
            remember(null, '', 'no_encontrado');
            return skip(
                A,
                mirror.source === 'store'
                    ? 'No existe y la lista está sincronizada con una tienda: los registros se crean en WooCommerce.'
                    : 'No existe y la lista viene de un sitio WordPress: lo nuevo se crea en WordPress.',
            );
        }
        // Al crearlo, el campo con el que se buscó queda con ese dato (si no se escribió otro).
        if (matchField && matchText !== '' && !READ_ONLY_TYPES.includes(matchField.type)) {
            const key = jsonbKeyForField(matchField.id);
            if (data[key] === undefined) {
                const res = this.coerce(ctx, matchField, matchText);
                if (res.ok && res.value !== null) data[key] = res.value;
            }
        }
        if (Object.keys(data).length === 0 && relations.every((r) => r.ids.length === 0)) {
            remember(null, '', 'no_encontrado');
            return skip(A, `No encontré ${lookedFor || 'el registro'} y no hay valores para crear uno nuevo.${note}`);
        }
        if (ctx.sim) {
            remember(null, '', 'creado');
            return ok(A, `No existe ${lookedFor || 'el registro'}: crearía uno en «${pre.name}» con ${Object.keys(data).length + relations.filter((r) => r.ids.length > 0).length} valor(es).${note}`, {
                _sim: 'would_run',
                action: 'create',
            });
        }
        if (this.billing && !this.records()) {
            try {
                await this.billing.assertCanCreateRecords(ctx.tenantId, 1);
            } catch (err) {
                return fail(A, explainError(err) || 'Límite de registros del plan alcanzado.');
            }
        }
        const created = await this.writeCreate(ctx, listId, data, relations.filter((r) => r.ids.length > 0));
        const title = titleOf(created.data, created.id);
        remember(created.id, title, 'creado');
        return ok(A, `No existía ${lookedFor || 'el registro'}: creó #${created.id} «${title}» en «${pre.name}».${note}${chainCutNote(ctx)}`, {
            record_id: created.id,
            action: 'created',
            ...(skipped.length > 0 ? { warnings: skipped } : {}),
        });
    }

    // ─────────── v0.1.455 — «Avisar en la app», «Asignar por turno», «Copiar a otra lista» ───────────

    /** El servicio de avisos (vive en su módulo, que depende de registros): se resuelve al usarlo. */
    private notifySvc: NotificationsService | null | undefined;
    private notifications(): NotificationsService | null {
        if (this.notifySvc === undefined) {
            try {
                this.notifySvc = this.moduleRef?.get(NotificationsService, { strict: false }) ?? null;
            } catch {
                this.notifySvc = null;
            }
        }
        return this.notifySvc;
    }

    /** Para los specs que arman el motor a mano. */
    setNotifications(svc: NotificationsService | null): void {
        this.notifySvc = svc;
    }

    /** El slug de un campo por su id (`f{id}`) en la lista del registro. */
    private slugOfFieldId(ctx: RunContext, fieldId: number): string | null {
        const key = jsonbKeyForField(fieldId);
        for (const [slug, k] of ctx.slugToKey) if (k === key) return slug;
        return null;
    }

    /**
     * Las personas del EQUIPO de trabajo de la empresa (nunca clientes del
     * portal, invitados, gente de una agencia que entra a administrar ni
     * cuentas desactivadas), armadas como «actor» para el ACL de la lista:
     * rol, rol propio y equipos. Una lectura para todas.
     */
    private async staffActors(tenantId: number, userIds: readonly number[]): Promise<Map<number, { actor: Actor; name: string; email: string }>> {
        const ids = [...new Set(userIds)].filter((u) => Number.isInteger(u) && u > 0);
        const out = new Map<number, { actor: Actor; name: string; email: string }>();
        if (ids.length === 0) return out;
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx
                .select({ id: users.id, name: users.name, email: users.email, role: memberships.role, customRoleId: memberships.customRoleId })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(
                    and(
                        eq(memberships.tenantId, tenantId),
                        inArray(memberships.userId, ids),
                        inArray(memberships.role, ['admin', 'manager', 'agent', 'viewer']),
                        eq(memberships.viaAgency, false),
                        isNull(users.disabledAt),
                    ),
                );
            if (rows.length === 0) return;
            const tm = await tx
                .select({ userId: teamMembers.userId, teamId: teamMembers.teamId })
                .from(teamMembers)
                .where(and(eq(teamMembers.tenantId, tenantId), inArray(teamMembers.userId, rows.map((r) => r.id))));
            const teamsOf = new Map<number, number[]>();
            for (const t of tm) teamsOf.set(t.userId, [...(teamsOf.get(t.userId) ?? []), t.teamId]);
            for (const r of rows) {
                out.set(r.id, {
                    actor: { userId: r.id, role: r.role as Actor['role'], customRoleId: r.customRoleId ?? null, teamIds: teamsOf.get(r.id) ?? [] },
                    name: (r.name ?? '').trim() || r.email,
                    email: r.email,
                });
            }
        });
        return out;
    }

    /** Las personas de unos equipos HOY (en el orden del equipo, sin repetir). */
    private async teamMemberIds(tenantId: number, teamIds: readonly number[]): Promise<{ ids: number[]; names: Map<number, string> }> {
        const names = new Map<number, string>();
        if (teamIds.length === 0) return { ids: [], names };
        const rows = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const ts = await tx.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.tenantId, tenantId), inArray(teams.id, [...teamIds])));
            for (const t of ts) names.set(t.id, t.name);
            if (ts.length === 0) return [];
            return tx
                .select({ userId: teamMembers.userId })
                .from(teamMembers)
                .where(and(eq(teamMembers.tenantId, tenantId), inArray(teamMembers.teamId, ts.map((t) => t.id))))
                .orderBy(asc(teamMembers.teamId), asc(teamMembers.userId));
        });
        return { ids: [...new Set(rows.map((r) => r.userId))], names };
    }

    /**
     * v0.1.455 — «Avisar en la app»: un aviso en la campana (y en el teléfono,
     * según lo que cada persona eligió) con un título y un mensaje con
     * variables y el enlace al registro. Sólo le llega a quien puede VER el
     * registro, nunca a un invitado ni a un cliente del portal, y cada uno lo
     * lee sin los campos que tiene ocultos.
     */
    private async notifyInApp(ctx: RunContext, cfg: Record<string, unknown>): Promise<ActionLogEntry> {
        const A = NOTIFY_IN_APP_ACTION;
        const c = readNotifyInAppConfig(cfg);
        if (ctx.recordId === null) return skip(A, 'Sin registro en contexto: el aviso lleva al registro.');
        if (c.title.trim() === '') return fail(A, 'El aviso no tiene título.');
        const svc = this.notifications();
        if (!svc) return fail(A, 'Los avisos no están disponibles en este servidor.');
        // A quiénes: personas elegidas + las de campos Persona + las de equipos + quien hizo el cambio.
        const wanted: number[] = [...c.userIds];
        const notes: string[] = [];
        for (const fieldId of c.personFieldIds) {
            const slug = this.slugOfFieldId(ctx, fieldId);
            if (!slug) {
                notes.push(`un campo Persona elegido ya no existe`);
                continue;
            }
            const raw = ctx.data[jsonbKeyForField(fieldId)];
            const vals = Array.isArray(raw) ? raw : [raw];
            for (const v of vals) {
                const n = Number(v);
                if (Number.isInteger(n) && n > 0) wanted.push(n);
            }
        }
        if (c.teamIds.length > 0) wanted.push(...(await this.teamMemberIds(ctx.tenantId, c.teamIds)).ids);
        if (c.includeActor) {
            if (ctx.actorId && ctx.actorId > 0) wanted.push(ctx.actorId);
            else notes.push('el cambio no lo hizo una persona (lo hizo una automatización, un formulario o el sistema)');
        }
        const ids = [...new Set(wanted)].slice(0, NOTIFY_IN_APP_MAX_RECIPIENTS);
        if (ids.length === 0) return skip(A, `No hay a quién avisar${notes.length > 0 ? `: ${notes.join('; ')}` : ' (los campos Persona están vacíos)'}.`);

        // Cada destinatario lo lee sin los campos que tiene ocultos.
        const render = (template: string, hidden: ReadonlySet<number>): string => {
            const fv = this.accessor(ctx);
            const guarded =
                hidden.size === 0
                    ? fv
                    : (token: string): unknown => {
                          const t = token.startsWith('before.') ? token.slice('before.'.length) : token;
                          const key = ctx.slugToKey.get(t.split('.')[0] ?? '');
                          if (key && hidden.has(Number(key.slice(1)))) return '';
                          return fv(token);
                      };
            return this.mergers(ctx, guarded).merge(template).trim();
        };
        const recordId = ctx.recordId;
        const title = (hidden: ReadonlySet<number>): string => render(c.title, hidden);
        const body = (hidden: ReadonlySet<number>): string => render(c.message, hidden);
        const sent = await svc.automationNotice(ctx.tenantId, { listId: ctx.listId, recordId, userIds: ids, title, body, dryRun: Boolean(ctx.sim) });
        const names = await svc.namesOf(sent);
        const who = sent.map((u) => names.get(u) ?? `#${u}`);
        const left = ids.length - sent.length;
        const leftNote = left > 0 ? ` ${left} persona(s) no lo recibieron: no pueden ver el registro, no son del equipo o están desactivadas.` : '';
        const note = notes.length > 0 ? ` Nota: ${notes.join('; ')}.` : '';
        const shown = `«${title(new Set())}»`;
        if (sent.length === 0) return skip(A, `Nadie recibió el aviso ${shown}: ninguna de las personas puede ver el registro.${note}`);
        const list = who.slice(0, 8).join(', ') + (who.length > 8 ? ` y ${who.length - 8} más` : '');
        if (ctx.sim) {
            return ok(A, `Le avisaría a ${list}: ${shown}.${leftNote}${note}`, { _sim: 'would_run', recipients: who, title: title(new Set()), message: body(new Set()) });
        }
        return ok(A, `Avisó a ${list}: ${shown}.${leftNote}${note}`, { recipients: who, user_ids: sent });
    }

    /**
     * v0.1.455 — «Asignar por turno»: llena un campo Persona con una persona
     * de un grupo (elegidas o las de un equipo HOY), por turnos (un contador
     * atómico por automatización y paso) o a quien tenga menos registros
     * abiertos en la lista («abierto» = el criterio de «Mi trabajo»). Saltea a
     * quien no podría ver y editar el registro ya asignado, a las cuentas
     * desactivadas y a quien ya no es de la empresa. Deja `{{asignado.x}}`.
     */
    private async assignRoundRobin(ctx: RunContext, cfg: Record<string, unknown>, pathKey: string): Promise<ActionLogEntry> {
        const A = ASSIGN_ROUND_ROBIN_ACTION;
        const c = readAssignRoundRobinConfig(cfg);
        if (ctx.recordId === null) return skip(A, 'Sin registro en contexto.');
        if (c.personFieldId === null) return fail(A, 'Elige el campo Persona que se llena.');
        const slug = this.slugOfFieldId(ctx, c.personFieldId);
        const field = slug ? ctx.fieldsBySlug.get(slug) : undefined;
        if (!slug || !field || field.type !== 'user') return fail(A, 'El campo elegido ya no existe o no es de tipo Persona.');
        const label = `«${field.label ?? slug}»`;
        const key = jsonbKeyForField(c.personFieldId);
        const lock = await this.managedLockOf(ctx, ctx.listId, c.personFieldId);
        if (lock) return skip(A, `${label}: ${lock.reason}`);
        const recordId = ctx.recordId;
        const current = ctx.sim
            ? ctx.data
            : (await this.tenantDb.withTenant(ctx.tenantId, (tx) => this.recordsRepo.findById(tx, ctx.tenantId, ctx.listId, recordId)))?.data;
        if (!current) return skip(A, 'El registro ya no existe.');
        const currentId = Number(current[key]);
        const hasCurrent = Number.isInteger(currentId) && currentId > 0;

        // Entre quiénes.
        let ids = c.userIds;
        let teamName: string | null = null;
        if (ids.length === 0 && c.teamId !== null) {
            const t = await this.teamMemberIds(ctx.tenantId, [c.teamId]);
            teamName = t.names.get(c.teamId) ?? null;
            if (teamName === null) return fail(A, 'El equipo elegido ya no existe.');
            ids = t.ids;
        }
        if (ids.length === 0) return skip(A, teamName ? `El equipo «${teamName}» no tiene personas: no se asignó a nadie.` : 'No hay personas entre las cuales repartir.');
        const people = await this.staffActors(ctx.tenantId, [...ids, ...(hasCurrent ? [currentId] : [])]);

        if (c.onlyIfEmpty && hasCurrent) {
            const p = people.get(currentId);
            if (p) ctx.asignado = { nombre: p.name, email: p.email, id: String(currentId) };
            return skip(A, `${label} ya tiene a ${p?.name ?? `#${currentId}`}: no se cambió (sólo asigna si está vacío).`);
        }

        const actors = ids.map((id) => people.get(id)?.actor).filter((a): a is Actor => a !== undefined);
        const svc = this.records();
        const reach = svc
            ? await svc.editorsOf(ctx.tenantId, ctx.listId, recordId, actors, (a) => ({ [key]: a.userId }))
            : new Set(actors.map((a) => a.userId));
        const eligible = ids.filter((id) => reach.has(id)).map((id) => ({ userId: id, ...people.get(id)! }));
        const excluded = ids.filter((id) => !reach.has(id));
        const excludedNote =
            excluded.length > 0
                ? ` Se saltó a ${excluded.length} persona(s): ${excluded
                      .slice(0, 5)
                      .map((id) => people.get(id)?.name ?? `#${id}`)
                      .join(', ')} (no pueden ver o editar el registro, no son del equipo o están desactivadas).`
                : '';
        if (eligible.length === 0) {
            return fail(A, `Ninguna de las personas puede ver y editar este registro (o ya no están en la empresa): no se asignó a nadie.${excludedNote}`);
        }

        let chosen: (typeof eligible)[number] | null = null;
        let how = '';
        if (c.mode === 'least_open') {
            const open = await this.openCountsByPerson(ctx, c.personFieldId, eligible.map((p) => p.userId));
            chosen = pickLeastOpen(eligible.map((p) => ({ ...p, open: open.get(p.userId) ?? 0 })));
            if (chosen) how = ` (tenía ${open.get(chosen.userId) ?? 0} abierto(s), la que menos)`;
        } else {
            const rrKey = `autorr:${ctx.tenantId}:${ctx.automation?.id ?? 0}:${pathKey || '0'}`;
            let n = 0;
            try {
                if (ctx.sim) n = Number((await this.redis?.get(rrKey)) ?? 0) || 0;
                else if (this.redis) {
                    n = (await this.redis.incr(rrKey)) - 1;
                    await this.redis.expire(rrKey, 180 * 86_400).catch(() => undefined);
                } else n = Math.floor(Math.random() * eligible.length);
            } catch {
                n = Math.floor(Math.random() * eligible.length);
            }
            chosen = pickRoundRobin(eligible, n);
            how = ' (por turnos)';
        }
        if (!chosen) return fail(A, 'No se pudo elegir a nadie.');
        ctx.asignado = { nombre: chosen.name, email: chosen.email, id: String(chosen.userId) };
        if (hasCurrent && currentId === chosen.userId) return skip(A, `${label} ya era ${chosen.name}.`);
        if (ctx.sim) {
            ctx.data = { ...ctx.data, [key]: chosen.userId };
            return ok(A, `Asignaría ${label} a ${chosen.name}${how}.${excludedNote}`, {
                _sim: 'would_run',
                user_id: chosen.userId,
                person: chosen.name,
                candidates: eligible.map((p) => p.name),
            });
        }
        const after = await this.writeUpdate(ctx, { listId: ctx.listId, recordId, slugToKey: ctx.slugToKey, fieldsBySlug: ctx.fieldsBySlug }, { [key]: chosen.userId }, current);
        ctx.data = after;
        return ok(A, `Asignó ${label} a ${chosen.name}${how}.${excludedNote}${chainCutNote(ctx)}`, { user_id: chosen.userId, person: chosen.name });
    }

    /** Cuántos registros ABIERTOS (sin terminar, como en «Mi trabajo») tiene cada persona en el campo. */
    private async openCountsByPerson(ctx: RunContext, personFieldId: number, userIds: number[]): Promise<Map<number, number>> {
        const out = new Map<number, number>();
        if (userIds.length === 0) return out;
        const fields = [...ctx.fieldsBySlug].map(([slug, f]) => ({
            id: Number((ctx.slugToKey.get(slug) ?? 'f0').slice(1)),
            slug,
            type: f.type,
            label: f.label ?? slug,
            config: f.config as Record<string, unknown> | undefined,
        }));
        const rule = doneRuleFor(fields as never);
        const person = sql`(${records.data} ->> ${jsonbKeyForField(personFieldId)})`;
        const notDone = rule
            ? sql`((${records.data} ->> ${jsonbKeyForField(rule.fieldId)}) IS NULL OR (${records.data} ->> ${jsonbKeyForField(rule.fieldId)}) NOT IN (${sql.join(
                  rule.values.map((v) => sql`${v}`),
                  sql`, `,
              )}))`
            : sql`true`;
        const rows = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
            tx
                .select({ uid: sql<string>`${person}`, n: sql<number>`count(*)::int` })
                .from(records)
                .where(
                    and(
                        eq(records.tenantId, ctx.tenantId),
                        eq(records.listId, ctx.listId),
                        isNull(records.deletedAt),
                        sql`${person} IN (${sql.join(userIds.map((u) => sql`${String(u)}`), sql`, `)})`,
                        notDone,
                    ),
                )
                // Por posición: la clave del campo va como parámetro y Postgres no
                // reconoce dos parámetros iguales como la misma expresión.
                .groupBy(sql.raw('1')),
        );
        for (const r of rows) out.set(Number(r.uid), Number(r.n));
        return out;
    }

    /**
     * v0.1.455 — «Copiar a otra lista»: crea un registro en otra lista (o en
     * la misma) con los campos que se llaman igual y son compatibles, más los
     * valores elegidos a mano (por el slug de la lista destino, con
     * variables), y opcionalmente lo vincula con el original. Respeta el límite
     * de registros del plan y las listas espejo. Deja `{{respuestas.<nombre>.id}}`.
     */
    private async copyRecord(ctx: RunContext, cfg: Record<string, unknown>): Promise<ActionLogEntry> {
        const A = COPY_RECORD_ACTION;
        const c = readCopyRecordConfig(cfg);
        if (ctx.recordId === null) return skip(A, 'Sin registro en contexto: no hay qué copiar.');
        if (c.listId === null) return fail(A, 'Elige la lista donde se crea la copia.');
        const targetListId = c.listId;
        const recordId = ctx.recordId;
        const pre = await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const [l] = await tx
                .select({ name: lists.name, settings: lists.settings })
                .from(lists)
                .where(and(eq(lists.tenantId, ctx.tenantId), eq(lists.id, targetListId), isNull(lists.deletedAt)))
                .limit(1);
            if (!l) return null;
            const target = await this.fields.listByList(tx, ctx.tenantId, targetListId);
            const source = await this.fields.listByList(tx, ctx.tenantId, ctx.listId);
            const row = await this.recordsRepo.findById(tx, ctx.tenantId, ctx.listId, recordId);
            const relIds = source.filter((f) => f.type === 'relation').map((f) => f.id);
            const rel = row ? await this.relationsRepo.batchTargets(tx, ctx.tenantId, [recordId], relIds) : new Map<number, Map<number, number[]>>();
            return { name: l.name, settings: (l.settings ?? {}) as Record<string, unknown>, target, source, row, rel: rel.get(recordId) ?? new Map<number, number[]>() };
        });
        if (!pre) return fail(A, `La lista destino (#${targetListId}) no existe en esta empresa.`);
        if (!pre.row) return skip(A, 'El registro ya no existe.');
        const mirror = readMirrorListMarker(pre.settings);
        if (mirror) {
            return skip(
                A,
                mirror.source === 'store'
                    ? 'La lista destino está sincronizada con una tienda: los registros se crean en WooCommerce.'
                    : 'La lista destino viene de un sitio WordPress: lo nuevo se crea en WordPress.',
            );
        }
        if (this.billing && !this.records()) {
            try {
                await this.billing.assertCanCreateRecords(ctx.tenantId, 1);
            } catch (err) {
                return fail(A, explainError(err) || 'Límite de registros del plan alcanzado.');
            }
        }
        const srcData = ctx.sim ? ctx.data : ((pre.row.data ?? {}) as Record<string, unknown>);
        const targetOf = (f: { config: unknown }): number => Number((f.config as { target_list_id?: unknown } | null)?.target_list_id ?? 0);
        const data: Record<string, unknown> = {};
        const relations = new Map<number, { fieldId: number; label: string; targetListId: number; ids: number[] }>();
        const copied: string[] = [];
        const skipped: string[] = [];
        if (c.autoMap) {
            const pairs = autoMapCopyFields(
                pre.source.map((f) => ({ id: f.id, label: f.label, type: f.type, config: f.config })),
                pre.target.map((f) => ({ id: f.id, label: f.label, type: f.type, config: f.config })),
                { copyFiles: c.copyFiles },
            );
            const srcById = new Map(pre.source.map((f) => [f.id, f]));
            const tgtById = new Map(pre.target.map((f) => [f.id, f]));
            for (const { from, to } of pairs) {
                if (to.id === c.linkFieldId) continue;
                const fromF = srcById.get(from.id)!;
                const toF = tgtById.get(to.id)!;
                if (fromF.type === 'relation') {
                    const ids = pre.rel.get(from.id) ?? [];
                    if (ids.length > 0) {
                        relations.set(toF.id, { fieldId: toF.id, label: toF.label, targetListId: targetOf(toF), ids });
                        copied.push(toF.label);
                    }
                    continue;
                }
                const raw = srcData[jsonbKeyForField(from.id)];
                if (isBlank(raw)) continue;
                let input: unknown = raw;
                if (fromF.type === 'select' || fromF.type === 'multi_select') {
                    const labeled = labelForFieldValue({ type: fromF.type, config: fromF.config }, raw);
                    input = toF.type === 'select' || toF.type === 'multi_select' ? labeled : Array.isArray(labeled) ? labeled.join(', ') : labeled;
                }
                const res = coerceFieldValue(toF, input, { timeZone: ctx.timeZone, format: ctx.format ?? DEFAULT_FORMAT, fromVariable: false });
                if (!res.ok) {
                    skipped.push(`«${toF.label}» (${res.error})`);
                    continue;
                }
                if (res.value === null) continue;
                data[jsonbKeyForField(toF.id)] = res.value;
                copied.push(toF.label);
            }
        }
        // Los valores a mano pisan lo copiado solo.
        if (Object.keys(c.values).length > 0) {
            const r = await this.resolveRecordValues(ctx, pre.target, c.values);
            Object.assign(data, r.data);
            for (const rel of r.relations) if (rel.ids.length > 0) relations.set(rel.fieldId, rel);
            skipped.push(...r.skipped);
        }
        // El vínculo con el original: una relación de la destino que apunta aquí,
        // o una de esta lista que apunta a la destino (se le suma la copia).
        let backLink: { fieldId: number; ids: number[] } | null = null;
        let linkNote = '';
        if (c.linkFieldId !== null) {
            const tf = pre.target.find((f) => f.id === c.linkFieldId);
            const sf = pre.source.find((f) => f.id === c.linkFieldId);
            if (tf && tf.type === 'relation' && targetOf(tf) === ctx.listId) {
                relations.set(tf.id, { fieldId: tf.id, label: tf.label, targetListId: ctx.listId, ids: [recordId] });
                linkNote = ` vinculado al original por «${tf.label}»`;
            } else if (sf && sf.type === 'relation' && targetOf(sf) === targetListId) {
                backLink = { fieldId: sf.id, ids: [...(pre.rel.get(sf.id) ?? [])] };
                linkNote = ` y sumado a «${sf.label}» del original`;
            } else {
                skipped.push('el campo para vincular ya no es una relación entre las dos listas');
            }
        }
        const rels = [...relations.values()].filter((r) => r.ids.length > 0);
        if (Object.keys(data).length === 0 && rels.length === 0) {
            return skip(A, `No hay nada que copiar a «${pre.name}»: ningún campo se llama igual y no se eligió ninguno a mano.${skipped.length > 0 ? ` Omitidos: ${skipped.join('; ')}.` : ''}`);
        }
        const titleId = resolveTitleFieldId(pre.target.map((f) => ({ id: f.id, type: f.type as never })), pre.settings);
        const titleOf = (d: Record<string, unknown>, id: number | null): string => (titleId ? recordTitleText(d[jsonbKeyForField(titleId)]) : '') || (id ? `#${id}` : '');
        const note = skipped.length > 0 ? ` Omitidos: ${skipped.join('; ')}.` : '';
        const count = Object.keys(data).length + rels.length;
        if (ctx.sim) {
            const byKey = new Map(pre.target.map((f) => [jsonbKeyForField(f.id), f]));
            const shown = [
                ...Object.entries(data).map(([k, v]) => ({ field: byKey.get(k)?.slug ?? k, label: byKey.get(k)?.label ?? k, value: v })),
                ...rels.map((r) => ({ field: jsonbKeyForField(r.fieldId), label: r.label, value: r.ids })),
            ];
            this.rememberNamed(ctx, { response_name: c.responseName }, { status: 200, body: { id: null, titulo: titleOf(data, null), lista: pre.name } });
            return ok(A, `Copiaría el registro a «${pre.name}» con ${count} valor(es)${linkNote}.${note}`, {
                _sim: 'would_run',
                list: pre.name,
                values: shown,
                ...(skipped.length > 0 ? { warnings: skipped } : {}),
            });
        }
        const created = await this.writeCreate(ctx, targetListId, data, rels);
        if (backLink) {
            const after = await this.writeUpdate(
                ctx,
                { listId: ctx.listId, recordId, slugToKey: ctx.slugToKey, fieldsBySlug: ctx.fieldsBySlug },
                { [jsonbKeyForField(backLink.fieldId)]: [...backLink.ids.filter((id) => id !== created.id), created.id] },
                srcData,
            );
            ctx.data = after;
        }
        const title = titleOf(created.data, created.id);
        this.rememberNamed(ctx, { response_name: c.responseName }, { status: 200, body: { id: created.id, titulo: title, lista: pre.name } });
        return ok(A, `Copió el registro a «${pre.name}»: #${created.id} «${title}» con ${count} valor(es)${linkNote}.${note}${chainCutNote(ctx)}`, {
            record_id: created.id,
            list: pre.name,
            copied,
            ...(skipped.length > 0 ? { warnings: skipped } : {}),
        });
    }

    /**
     * D2 — «Responder por correo al hilo del registro»: el texto (con las
     * variables del registro, del correo que llegó y del ticket) va al cliente
     * por el correo de la empresa, con las cabeceras del hilo. En «Probar»
     * sólo se arma: no sale nada.
     */
    private async replyEmail(ctx: RunContext, cfg: Record<string, unknown>): Promise<ActionLogEntry> {
        const svc = this.helpdesk();
        if (!svc) return fail('reply_email', 'La mesa de ayuda no está disponible en este servidor.');
        {
            // v0.1.338 (ADR-S87) — plan sin «Mesa de ayuda por correo».
            const off = await this.tenantDb.withTenant(ctx.tenantId, (tx) => planModuleStepError(tx, ctx.tenantId, 'helpdesk'));
            if (off) return fail('reply_email', off);
        }
        if (ctx.recordId === null) return skip('reply_email', 'No hay un registro: la respuesta va al hilo de un ticket.');
        const raw = typeof cfg.body === 'string' ? cfg.body : '';
        if (raw.trim() === '') return fail('reply_email', 'La acción no tiene el texto de la respuesta.');
        const vars = await svc.ticketVars(ctx.tenantId, ctx.listId, ctx.recordId);
        const base = this.accessor(ctx);
        const fv = (token: string): unknown => (Object.prototype.hasOwnProperty.call(vars, token) ? vars[token] : base(token));
        const { merge } = this.mergers(ctx, fv);
        const body = merge(raw).trim();
        if (body === '') return skip('reply_email', 'La respuesta quedó vacía con los datos de este registro.');
        const subject = typeof cfg.subject === 'string' && cfg.subject.trim() !== '' ? merge(cfg.subject) : undefined;
        const cc = typeof cfg.cc === 'string' && cfg.cc.trim() !== '' ? merge(cfg.cc) : undefined;
        const sim = ctx.sim;
        const c = await svc.replyFromAutomation(
            ctx.tenantId,
            ctx.listId,
            ctx.recordId,
            { body, ...(subject ? { subject } : {}), ...(cc ? { cc } : {}), ...(ctx.automation ? { automationName: ctx.automation.name } : {}) },
            { simulate: !!sim },
        );
        const details = { to: c.to, cc: c.cc, subject: c.subject, in_reply_to: c.inReplyTo };
        if (sim) {
            return ok('reply_email', `Respondería por correo a ${c.to.join(', ')}: «${c.subject}».`, { ...details, body, _sim: 'would_run' });
        }
        return ok('reply_email', `Respondió por correo a ${c.to.join(', ')}: «${c.subject}».`, { ...details, message_id: c.messageId });
    }

    /**
     * v0.1.447 — «Pedir firma»: arma el PDF (una plantilla de documento de la
     * lista o el último PDF de un campo Archivo del registro) y lo manda a
     * firmar a las personas de la acción, con nombre y correo resueltos por
     * variables. Deja `{{firma.enlace}}` (el de quien firma primero), el código
     * y la verificación para los pasos siguientes (mandarlo por WhatsApp, p. ej.).
     */
    private async requestSignature(ctx: RunContext, cfg: Record<string, unknown>): Promise<ActionLogEntry> {
        const A = REQUEST_SIGNATURE_ACTION;
        const svc = this.signaturesSvc();
        if (!svc) return fail(A, 'La firma electrónica no está disponible en este servidor.');
        if (ctx.recordId === null) return skip(A, 'Pedir una firma necesita un registro.');
        const recordId = ctx.recordId;
        const c = readRequestSignatureConfig(cfg);
        const fieldIdOf = (slug: string, what: string, types: string[]): number | null => {
            if (slug === '') return null;
            const key = ctx.slugToKey.get(slug);
            const f = ctx.fieldsBySlug.get(slug);
            if (!key || !f || !types.includes(String(f.type))) throw new Error(`«${f?.label ?? slug}» no es ${what} de la lista: revisa la acción.`);
            return Number(key.slice(1));
        };
        const onComplete = {
            save_field_id: fieldIdOf(c.save_field, 'un campo Archivo', ['file']),
            status_field_id: fieldIdOf(c.status_field, 'un campo de selección', ['select']),
            status_value: c.status_field !== '' && c.status_value !== '' ? c.status_value : null,
            date_field_id: fieldIdOf(c.date_field, 'un campo de fecha', ['date', 'datetime']),
        };
        const pre = await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            // v0.1.338 (ADR-S87) — la firma va con «Documentos PDF» del plan.
            const off = await planModuleStepError(tx, ctx.tenantId, 'documents');
            if (off) return { off, name: null, fileId: null, fileName: null };
            if (c.source === 'template') {
                if (c.template_id === null) return { off: 'Elige la plantilla del documento que se firma.', name: null, fileId: null, fileName: null };
                const name = await this.templateName(tx, ctx.tenantId, c.template_id);
                if (name === null) return { off: 'La plantilla de documento de la acción ya no existe.', name: null, fileId: null, fileName: null };
                return { off: null, name, fileId: null, fileName: null };
            }
            const fid = fieldIdOf(c.file_field, 'un campo Archivo', ['file']);
            if (fid === null) return { off: 'Elige el campo Archivo con el PDF que se firma.', name: null, fileId: null, fileName: null };
            const current = await this.recordsRepo.findById(tx, ctx.tenantId, ctx.listId, recordId);
            const raw = (current?.data ?? ctx.data)[jsonbKeyForField(fid)];
            const ids = (Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
            if (ids.length === 0) return { off: null, name: null, fileId: null, fileName: null };
            const rows = await tx
                .select({ id: attachments.id, filename: attachments.filename, mime: attachments.mime })
                .from(attachments)
                .where(and(eq(attachments.tenantId, ctx.tenantId), inArray(attachments.id, ids)));
            const pdfs = new Map(rows.filter((r) => r.mime === 'application/pdf' || /\.pdf$/i.test(r.filename)).map((r) => [r.id, r.filename]));
            const last = [...ids].reverse().find((id) => pdfs.has(id)) ?? null;
            return { off: null, name: null, fileId: last, fileName: last !== null ? (pdfs.get(last) ?? null) : null };
        });
        if (pre.off) return fail(A, pre.off);
        if (c.source === 'file' && pre.fileId === null) return skip(A, 'El registro no tiene un PDF en el campo elegido: no hay qué firmar.');

        const fv = this.accessor(ctx);
        const { merge } = this.mergers(ctx, fv);
        const signers: Array<{ name: string; email: string; role: string; phone: string }> = [];
        const seen = new Set<string>();
        for (const [i, s] of c.signers.entries()) {
            const email = (this.recipients(ctx, s.email, merge).split(',')[0] ?? '').trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return fail(A, `La persona ${i + 1} quedó sin un correo válido con los datos de este registro («${s.email}»).`);
            }
            if (seen.has(email)) continue;
            seen.add(email);
            const name = merge(s.name).replace(/\s+/g, ' ').trim().slice(0, 120) || email.split('@')[0]!;
            // v0.1.448 — el celular sólo cuenta si el código sale por SMS o WhatsApp.
            const phone = c.verify === 'sms' || c.verify === 'whatsapp' ? merge(s.phone).trim().slice(0, 32) : '';
            signers.push({ name, email, role: merge(s.role).trim().slice(0, 60), phone });
        }
        if (signers.length === 0) return fail(A, 'La acción no tiene personas que firmen.');
        const title = merge(c.title).trim().slice(0, 160);
        const parsed = createSignatureRequestSchema.safeParse({
            record_id: recordId,
            source: c.source === 'template' ? { kind: 'template', template_id: c.template_id } : { kind: 'file', file_id: pre.fileId },
            title,
            signers,
            order: c.order,
            message: merge(c.message).trim().slice(0, 2000),
            expires_days: c.expires_days,
            verify: c.verify,
            verify_connection_id: c.verify === 'sms' || c.verify === 'whatsapp' ? c.verify_connection_id : null,
            verify_template: c.verify === 'whatsapp' ? c.verify_template : null,
            remind_days: c.remind_days,
            on_complete: onComplete,
            send_email: c.send_email,
        });
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            // «Escribe el celular de esta persona»: dice de quién (el celular sale de una variable).
            const at = issue && issue.path[0] === 'signers' && typeof issue.path[1] === 'number' ? `La persona ${issue.path[1] + 1}: ` : '';
            return fail(A, `${at}${issue?.message ?? 'La acción está mal configurada.'}`);
        }
        const doc = pre.name ? `«${pre.name}»` : pre.fileName ? `«${pre.fileName}»` : 'el documento';
        const who = signers.map((s) => `${s.name} (${s.email})`).join(', ');
        const inOrder = signers.length > 1 && c.order === 'sequential' ? ', en orden' : '';
        if (ctx.sim) {
            ctx.firma = {
                ...sampleSignatureEvent('requested'),
                titulo: title || pre.name || (pre.fileName ?? 'Documento').replace(/\.pdf$/i, ''),
                total: signers.length,
                siguiente: signers[0]!.name,
                siguiente_email: signers[0]!.email,
                enlace: '(se genera al correr)',
                template_id: c.template_id,
            };
            const codeBy = c.verify === 'sms' ? ' El código para firmar le llegaría por SMS.' : c.verify === 'whatsapp' ? ' El código para firmar le llegaría por WhatsApp.' : '';
            return ok(
                A,
                `Pediría la firma de ${doc} a ${who}${inOrder}${c.send_email ? ', con el enlace por correo' : ' (sin correo: el enlace queda en {{firma.enlace}})'}.${codeBy} En la prueba no se pide.`,
                { _sim: 'would_run', signers: signers.length },
            );
        }
        const dto = await svc.create(ctx.tenantId, SYSTEM_ACTOR, String(ctx.listId), parsed.data, { chain: nextChain(ctx.chain, ctx.automation?.id ?? 0) });
        ctx.firma = (await svc.infoFor(ctx.tenantId, dto.id, 'requested')) ?? {
            ...sampleSignatureEvent('requested'),
            request_id: dto.id,
            titulo: dto.title,
            estado: SIGNATURE_STATUS_LABELS[dto.status],
            estado_clave: dto.status,
            codigo: dto.code,
            total: dto.signers.length,
        };
        return ok(
            A,
            `Pidió la firma de ${doc} a ${who}${inOrder}.${c.send_email ? ' Les llegó el enlace por correo.' : ' No se mandaron correos: el enlace queda en {{firma.enlace}}.'}`,
            { request_id: dto.id, signers: signers.length, ...(dto.document_number ? { number: dto.document_number } : {}) },
        );
    }

    /** C6 — «Crear un registro» con plantilla: el registro, sus subtareas y checklists en una transacción. */
    private async writeCreateFromTemplate(
        ctx: RunContext,
        listId: number,
        templateId: number,
        data: Record<string, unknown>,
        relations: Array<{ fieldId: number; ids: number[] }>,
    ): Promise<FromTemplateResult> {
        const svc = this.recordTemplates();
        if (!svc) throw new Error('Las plantillas de registro no están disponibles en este servidor.');
        const input = { ...data } as Record<string, unknown>;
        for (const r of relations) input[jsonbKeyForField(r.fieldId)] = r.ids;
        return svc.createFromTemplate(
            ctx.tenantId,
            SYSTEM_ACTOR,
            String(listId),
            { template_id: templateId, data: input },
            { lenientRequired: true, automationChain: nextChain(ctx.chain, ctx.automation?.id ?? 0) },
        );
    }

    /**
     * C6 — «Crear subtareas desde una plantilla»: las subtareas de una
     * plantilla de registro (y, si se pide, sus checklists) sobre el registro
     * que disparó la automatización, en una transacción.
     */
    private async createSubtasksFromTemplate(ctx: RunContext, cfg: Record<string, unknown>): Promise<ActionLogEntry> {
        const action = 'create_subtasks_from_template';
        if (ctx.recordId === null) return skip(action, 'Esta acción necesita un registro (el que disparó la automatización).');
        const templateId = Number(cfg.template_id);
        if (!Number.isInteger(templateId) || templateId <= 0) return skip(action, 'Elige la plantilla de registro.');
        const svc = this.recordTemplates();
        if (!svc) return fail(action, 'Las plantillas de registro no están disponibles en este servidor.');
        const includeChecklists = cfg.include_checklists === true;
        if (ctx.sim) {
            const tpl = await svc.get(ctx.tenantId, String(ctx.listId), templateId).catch(() => null);
            if (!tpl) return fail(action, 'La plantilla de registro elegida ya no existe en esta lista.');
            const n = tpl.content.subtasks.length;
            const c = includeChecklists ? tpl.content.checklists.length : 0;
            return ok(action, `Crearía ${n} subtarea(s)${c > 0 ? ` y ${c} checklist(s)` : ''} desde «${tpl.name}» en este registro.`, {
                _sim: 'would_run',
                template: tpl.name,
                subtasks: tpl.content.subtasks.map((s) => s.title),
            });
        }
        const res = await svc.applyToRecord(ctx.tenantId, SYSTEM_ACTOR, String(ctx.listId), ctx.recordId, templateId, {
            lenientRequired: true,
            includeChecklists,
            automationChain: nextChain(ctx.chain, ctx.automation?.id ?? 0),
        });
        const parts = [`${res.subtask_ids.length} subtarea(s)`, ...(res.checklist_ids.length > 0 ? [`${res.checklist_ids.length} checklist(s)`] : [])];
        return ok(action, `Creó ${parts.join(' y ')} desde la plantilla.`, {
            subtask_ids: res.subtask_ids,
            checklist_ids: res.checklist_ids,
            ...(res.warnings.length > 0 ? { warnings: res.warnings } : {}),
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

    private async execAction(tx: Tx, ctx: RunContext, spec: ActionSpec, pathKey = ''): Promise<ActionLogEntry | AfterCommit> {
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
                    // «Ejecutar de verdad» en una prueba es USAR la conexión.
                    if (sim?.tester && realCall) await this.connectors.assertAttachable(ctx.tenantId, sim.tester, [connectionId], tx);
                    // v0.1.338 (ADR-S87) — el módulo de ESA conexión tiene que estar en el plan.
                    const off = await connectionModuleStepError(tx, ctx.tenantId, connectionId);
                    if (off) return fail('call_webhook', off);
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
                return afterCommit(async () => {
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
                // «Ejecutar de verdad» en una prueba es USAR la conexión.
                if (sim?.tester && realCall) await this.connectors.assertAttachable(ctx.tenantId, sim.tester, [connId], tx);
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
                // v0.1.338 (ADR-S87) — la app tiene que estar en el plan (la
                // tienda, el sitio y SQL tienen su módulo; el resto, «Integraciones»).
                {
                    const off = await planModuleStepError(tx, ctx.tenantId, moduleForIntegration(resolved.integration?.key));
                    if (off) return fail('connector_action', off);
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
                    (resolved.integration.key === 'mercadopago' || resolved.integration.key === 'wompi' || resolved.integration.key === 'paypal') &&
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
                        this.rememberNamed(ctx, cfg, {
                            status: 200,
                            body: { url: '(se crea al correr)', link: '(se crea al correr)', monto: amount, moneda: v.currency || (resolved.integration.key === 'paypal' ? 'USD' : 'COP'), concepto: v.title ?? '' },
                        });
                        return ok('connector_action', `Crearía un link de pago «${v.title ?? ''}» por ${amount} ${v.currency || (resolved.integration.key === 'paypal' ? 'USD' : 'COP')}${v.payer_email ? ` para ${v.payer_email}` : ''}.`, {
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
                        currency: v.currency || (resolved.integration.key === 'paypal' ? 'USD' : 'COP'),
                        payerEmail: (v.payer_email ?? '').trim() || null,
                        expiresDays: Number.isFinite(days) && days > 0 ? Math.min(365, Math.floor(days)) : null,
                        userId: null,
                    }).catch((err: unknown) => {
                        throw new Error(`${resolved.action!.label}: ${err instanceof Error ? err.message : String(err)}`);
                    });
                    if (created.write) ctx.data = created.write.after;
                    ctx.pago = { ...created.context };
                    // v0.1.365 — con «Guardar la respuesta como», el link también
                    // queda en `{{respuestas.<nombre>.url}}` (como un webhook).
                    this.rememberNamed(ctx, cfg, {
                        status: 200,
                        body: { ...created.context, url: created.link.url },
                    });
                    // Sin columna de link en la lista, el link sólo se ve en
                    // «Cobros» de la ficha: se dice, así no parece que no pasó nada.
                    const where = created.linkField
                        ? ` · guardado en «${created.linkField}»`
                        : ' · no quedó en ninguna columna: elige en la acción dónde se guarda el link';
                    return ok('connector_action', `${resolved.name} → link de pago ${created.link.url}${where}`, {
                        action: resolved.action.key,
                        integration: resolved.integration.key,
                        link_id: created.link.id,
                        url: created.link.url,
                    });
                }
                // v0.1.367 (ADR-S96) — suscripciones de Mercado Pago (y de PayPal desde v0.1.373): crear el
                // link para que el cliente autorice su tarjeta, o pausar /
                // reanudar / cancelar / cambiar el valor de la del registro.
                if (
                    resolved.integration &&
                    (resolved.integration.key === 'mercadopago' || resolved.integration.key === 'paypal') &&
                    (resolved.action.key === 'create_subscription_link' || resolved.action.key === 'manage_subscription')
                ) {
                    if (ctx.recordId === null) return skip('connector_action', 'Una suscripción necesita un registro.');
                    const subsSvc = this.subscriptionsSvc();
                    if (!subsSvc) throw new Error('Las suscripciones no están disponibles en este servidor.');
                    const compiled = compileIntegrationValues(resolved.integration.key, resolved.action, values, merge, merge);
                    if (compiled.missing.length > 0) {
                        return skip('connector_action', `Falta completar: ${compiled.missing.join(', ')}.`);
                    }
                    const v = compiled.values;
                    if (resolved.action.key === 'create_subscription_link') {
                        const planId = Number(v.plan_id);
                        const [plan] = Number.isInteger(planId) && planId > 0
                            ? await tx
                                  .select()
                                  .from(subscriptionPlans)
                                  .where(and(eq(subscriptionPlans.tenantId, ctx.tenantId), eq(subscriptionPlans.id, planId)))
                                  .limit(1)
                            : [];
                        if (!plan || plan.connectionId !== connId) {
                            throw new Error(`${resolved.action.label}: el plan elegido ya no existe o es de otra conexión: elígelo de nuevo en la acción.`);
                        }
                        const amountRaw = (v.amount ?? '').trim();
                        const amount = amountRaw === '' ? null : parseAmount(amountRaw);
                        if (amountRaw !== '' && amount === null) {
                            throw new Error(`${resolved.action.label}: el valor «${amountRaw}» no es un número.`);
                        }
                        if (sim) {
                            // Nunca de verdad en una prueba: le crearía una suscripción real al cliente.
                            ctx.suscripcion = { ...sampleSubscriptionEvent('activated'), plan: plan.name, monto: amount ?? Number(plan.amount), moneda: plan.currency, link: '(se crea al correr)', estado: 'Por autorizar' };
                            this.rememberNamed(ctx, cfg, { status: 200, body: { link: '(se crea al correr)', url: '(se crea al correr)', plan: plan.name } });
                            return ok('connector_action', `Crearía una suscripción «${plan.name}» por ${amount ?? Number(plan.amount)} ${plan.currency} para ${v.payer_email ?? ''}.`, {
                                _sim: 'would_run',
                                action: resolved.action.key,
                                integration: resolved.integration.key,
                            });
                        }
                        const created = await subsSvc
                            .createInTx(tx, ctx.tenantId, {
                                plan,
                                listId: ctx.listId,
                                recordId: ctx.recordId,
                                payerEmail: v.payer_email ?? '',
                                amount,
                                startDate: (v.start_date ?? '').trim() || null,
                                title: null,
                                userId: null,
                            })
                            .catch((err: unknown) => {
                                throw new Error(`${resolved.action!.label}: ${err instanceof Error ? err.message : String(err)}`);
                            });
                        if (created.write) ctx.data = created.write.after;
                        ctx.suscripcion = { ...created.info, link: created.sub.url };
                        this.rememberNamed(ctx, cfg, { status: 200, body: { link: created.sub.url, url: created.sub.url, plan: plan.name, monto: created.sub.amount } });
                        const where = created.linkField
                            ? ` · guardado en «${created.linkField}»`
                            : ' · el link no quedó en ninguna columna: úsalo con {{suscripcion.link}} en el paso siguiente';
                        return ok('connector_action', `${resolved.name} → suscripción «${plan.name}»: ${created.sub.url ?? ''}${where}`, {
                            action: resolved.action.key,
                            integration: resolved.integration.key,
                            subscription_id: created.sub.id,
                            url: created.sub.url,
                        });
                    }
                    // manage_subscription: la suscripción más nueva del registro.
                    const operation = (v.operation ?? '').trim();
                    if (!['pause', 'resume', 'cancel', 'amount'].includes(operation)) {
                        throw new Error(`${resolved.action.label}: elige qué hacer (pausar, reanudar, cancelar o cambiar el valor).`);
                    }
                    const [sub] = await tx
                        .select()
                        .from(subscriptionsTable)
                        .where(and(eq(subscriptionsTable.tenantId, ctx.tenantId), eq(subscriptionsTable.recordId, ctx.recordId)))
                        .orderBy(sql`${subscriptionsTable.createdAt} desc`)
                        .limit(1);
                    if (!sub || sub.connectionId !== connId) return skip('connector_action', 'El registro no tiene una suscripción de esta conexión.');
                    const verb = { pause: 'Pausaría', resume: 'Reanudaría', cancel: 'Cancelaría', amount: 'Cambiaría el valor de' }[operation]!;
                    let newAmount: number | null = null;
                    if (operation === 'amount') {
                        newAmount = parseAmount((v.amount ?? '').trim());
                        if (newAmount === null || newAmount <= 0) throw new Error(`${resolved.action.label}: el valor nuevo «${v.amount ?? ''}» no es un número.`);
                    }
                    if (sim) {
                        return ok('connector_action', `${verb} la suscripción «${sub.title}»${newAmount !== null ? ` a ${newAmount} ${sub.currency}` : ''}.`, {
                            _sim: 'would_run',
                            action: resolved.action.key,
                            integration: resolved.integration.key,
                        });
                    }
                    const patch =
                        operation === 'amount'
                            ? ({ kind: 'amount', amount: newAmount!, currency: sub.currency } as const)
                            : ({ kind: 'status', status: operation === 'pause' ? 'paused' : operation === 'resume' ? 'authorized' : 'cancelled' } as const);
                    const subLabel = resolved.action.label;
                    const subAction = resolved.action.key;
                    const subIntegration = resolved.integration.key;
                    const subName = resolved.name;
                    // v0.1.392 — el pedido al proveedor espera fuera de la transacción.
                    return afterCommit(async () => {
                        await subsSvc.patchInMp(ctx.tenantId, sub, patch, operation === 'cancel' ? ((v.reason ?? '').trim() || 'La canceló una automatización.') : null).catch((err: unknown) => {
                            throw new Error(`${subLabel}: ${err instanceof Error ? err.message : String(err)}`);
                        });
                        // El estado nuevo lo trae la sincronización.
                        subsSvc.syncSoon(ctx.tenantId, sub.id);
                        const done = { pause: 'pausó', resume: 'reanudó', cancel: 'canceló', amount: 'cambió el valor de' }[operation]!;
                        return ok('connector_action', `${subName} → se ${done} la suscripción «${sub.title}»${newAmount !== null ? ` (ahora ${newAmount} ${sub.currency})` : ''}.`, {
                            action: subAction,
                            integration: subIntegration,
                            subscription_id: sub.id,
                        });
                    });
                }
                // D3 — WhatsApp oficial: la petición la arma el canal (plantilla
                // aprobada, ventana de 24 h) y el envío queda en el registro.
                // v0.1.389 — también la versión nueva de Imagina WAS (mismo motor: estado y registro).
                if (resolved.integration && (resolved.integration.key === 'whatsapp_cloud' || resolved.integration.key === 'whatsapp_web')) {
                    const wa = this.whatsapp();
                    if (!wa) throw new Error('WhatsApp no está disponible en este servidor.');
                    const waKey = resolved.integration.key;
                    const waAction = resolved.action.key;
                    const outcome = await wa.runAutomationAction(tx, {
                        tenantId: ctx.tenantId,
                        listId: ctx.listId,
                        recordId: ctx.recordId,
                        connectionId: connId,
                        actionKey: waAction,
                        values,
                        merge: (raw) => merge(raw),
                        realCall,
                        deferSend: true,
                    });
                    const finishWa = (out: WhatsappAutomationResult): ActionLogEntry => {
                        if (out.write) ctx.data = { ...ctx.data, ...out.write.after };
                        if (out.outputs) ctx.whats = { ...(ctx.whats ?? {}), ...out.outputs };
                        if (out.status === 'failed') return fail('connector_action', out.message, { integration: waKey, ...out.details });
                        // v0.1.401 — «no había nada que hacer» (quitar una etiqueta a quien no está en Whats).
                        if (out.status === 'skipped') return skip('connector_action', out.message);
                        return ok('connector_action', out.message, { action: waAction, integration: waKey, ...out.details });
                    };
                    // v0.1.392 — el envío espera a WhatsApp fuera de la transacción.
                    if ('later' in outcome) return afterCommit(async () => finishWa(await outcome.later()));
                    return finishWa(outcome);
                }
                // SMS (ADR-S82): la petición la arma el proveedor, el envío queda
                // en `sms_messages` (estado de entrega) y, con «Respetar el
                // horario», fuera de la franja de la Ley 2300 queda programado.
                if (resolved.integration && isSmsProvider(resolved.integration.key)) {
                    const sms = this.sms();
                    if (!sms) throw new Error('El envío de SMS no está disponible en este servidor.');
                    const integKey = resolved.integration.key;
                    const smsAction = resolved.action.key;
                    const outcome = await sms.runAutomationAction(tx, {
                        tenantId: ctx.tenantId,
                        listId: ctx.listId,
                        recordId: ctx.recordId,
                        connectionId: connId,
                        automationId: ctx.automation?.id ?? null,
                        values,
                        merge: (raw) => merge(raw),
                        realCall,
                        deferSend: true,
                    });
                    const finishSms = (out: SmsAutomationResult): ActionLogEntry => {
                        if (out.write) ctx.data = { ...ctx.data, ...out.write.after };
                        if (out.status === 'failed') return fail('connector_action', out.message, { integration: integKey, ...out.details });
                        if (out.status === 'skipped') return skip('connector_action', out.message);
                        return ok('connector_action', out.message, { action: smsAction, integration: integKey, ...out.details });
                    };
                    // v0.1.392 — el envío espera al proveedor fuera de la transacción.
                    if ('later' in outcome) return afterCommit(async () => finishSms(await outcome.later()));
                    return finishSms(outcome);
                }
                if (resolved.integration) {
                    const integ = resolved.integration;
                    // v0.1.366 — una acción que necesita un permiso que la
                    // conexión no recibió (las reuniones de una conexión de
                    // Teams de antes): se dice «reconéctala», no el 403 de Microsoft.
                    const lacking = missingActionScopes(integ.key, resolved.action.key, integ.grantedScope);
                    if (lacking.length > 0) {
                        throw new Error(
                            `«${resolved.name}» se conectó antes de que existieran las reuniones y no tiene permiso para el calendario: vuelve a conectarla en Ajustes → Integraciones → ${integ.def.name} (si tu empresa pide la aprobación del administrador, crea el enlace otra vez).`,
                        );
                    }
                    // SEC-33: en el cuerpo HTML de Gmail/Outlook los valores se escapan, igual
                    // que en `send_email` — un registro no inyecta HTML en el correo.
                    const compiled = compileIntegrationValues(integ.key, resolved.action, values, merge, mergeHtml);
                    if (compiled.missing.length > 0) {
                        return skip('connector_action', `Falta completar: ${compiled.missing.join(', ')}.`);
                    }
                    const meetingKind = meetingActionKind(integ.key, resolved.action.key);
                    const hide = [integ.creds.secret, integ.creds.accessToken].filter((x) => typeof x === 'string' && x.length >= 4);
                    const showRequest = (req: { method: string; url: string; headers: Record<string, string>; body?: string }) => ({
                        method: req.method,
                        url: redactValues(req.url, hide),
                        headers: maskHeaders(req.headers),
                        body: req.body !== undefined ? redactValues(req.body, hide) : null,
                    });
                    if (!realCall) {
                        // v0.1.348 — algunas acciones necesitan pasos antes (el chat uno a
                        // uno de Teams); en la simulación no se ejecutan.
                        const req = await this.connectors.prepareIntegrationCall(integ.key, resolved.action.key, compiled, integ.creds, false);
                        const shownRequest = showRequest(req);
                        this.rememberResponse(ctx, cfg, null, pathKey);
                        if (meetingKind && meetingKind !== 'cancel') {
                            ctx.reunion = { id: '(se crea al correr)', enlace: '(se crea al correr)', web: '', titulo: compiled.values.title ?? '' };
                        }
                        const where = meetingKind ? this.meetingSaveSummary(ctx, cfg, meetingKind) : '';
                        return ok('connector_action', `${resolved.name} → ${resolved.action.label} (sin ejecutar).${where}`, {
                            _sim: 'would_run',
                            action: resolved.action.key,
                            integration: integ.key,
                            request: shownRequest,
                        });
                    }
                    const act = resolved.action;
                    return afterCommit(async () => {
                        // Los pasos previos (el chat uno a uno de Teams) también son de red.
                        const req = await this.connectors.prepareIntegrationCall(integ.key, act.key, compiled, integ.creds, true);
                        const shownRequest = showRequest(req);
                        const res = await safeWebhookFetch(req.url, {
                            method: req.method,
                            headers: req.headers,
                            body: req.body,
                            captureBody: true,
                            maxCaptureBytes: RESPONSE_BODY_MAX_BYTES,
                    });
                    this.rememberResponse(ctx, cfg, res, pathKey, hide);
                    // v0.1.366 — cancelar algo que ya no está en el calendario no
                    // es un error: lo borraron a mano, que era justo lo que se quería.
                    const gone = meetingKind === 'cancel' && cancelAlreadyGone(res.status);
                    const problem = gone ? null : checkIntegrationResponse(integ.key, res.status, res.body ?? '', act.key);
                    if (problem) throw new Error(`${act.label}: ${problem}`);
                    if (meetingKind) {
                        const note = await this.afterMeetingCall((fn) => this.tenantDb.withTenant(ctx.tenantId, fn), ctx, cfg, {
                            kind: meetingKind,
                            integration: integ.key,
                            body: res.body ?? '',
                            calendar: compiled.values.calendar ?? '',
                            accessToken: integ.creds.accessToken,
                            gone,
                            sim: Boolean(sim),
                            wantsVideo: wantsVideoCall(integ.key, compiled.values),
                        });
                        return ok('connector_action', `${resolved.name} → ${act.label}: ${note}`, {
                            status: res.status,
                            action: act.key,
                            integration: integ.key,
                            ...(ctx.reunion?.id ? { event_id: ctx.reunion.id } : {}),
                            ...(sim ? { _sim: 'ran', request: shownRequest, response: { status: res.status, body: redactValues(res.body ?? '', hide).slice(0, 4000) } } : {}),
                        });
                    }
                    return ok(
                        'connector_action',
                        `${resolved.name} → ${act.label}: ${res.status}`,
                        {
                            status: res.status,
                            action: act.key,
                            integration: integ.key,
                            ...(sim ? { _sim: 'ran', request: shownRequest, response: { status: res.status, body: redactValues(res.body ?? '', hide).slice(0, 4000) } } : {}),
                        },
                    );
                    });
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
                const actionLabel = `${resolved.name} → ${resolved.action.label}`;
                const actionKey = resolved.action.key;
                return afterCommit(async () => {
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
                        const failed = httpFail('connector_action', actionLabel, res.status, redactValues(res.body ?? '', hide));
                        return sim ? { ...failed, details: { ...failed.details, request: shownRequest, response: shownResponse } } : failed;
                    }
                    return ok('connector_action', `${actionLabel}: ${res.status}`, {
                        status: res.status,
                        action: actionKey,
                        ...(sim ? { _sim: 'ran', request: shownRequest, response: shownResponse } : {}),
                    });
                });
            }
            case 'generate_pdf': {
                // v0.1.266 (ADR-S35) — arma el PDF de una plantilla de la lista
                // con los datos del registro. Opcionalmente lo guarda en un campo
                // Archivo (cuenta contra el almacenamiento del plan) y deja
                // `{{pdf.link}}` / `{{pdf.nombre}}` para las acciones siguientes.
                if (!this.documents) throw new Error('Los documentos PDF no están disponibles en este servidor.');
                {
                    // v0.1.338 (ADR-S87) — plan sin «Documentos PDF».
                    const off = await planModuleStepError(tx, ctx.tenantId, 'documents');
                    if (off) return fail('generate_pdf', off);
                }
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
                const pdfLock = await this.managedLockOf(ctx, ctx.listId, Number(key.slice(1)));
                if (pdfLock) throw new Error(`«${field.label}» no se puede usar para guardar el PDF: ${pdfLock.reason}`);
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
                const { attachments, issuedNow } = await this.emailAttachments(tx, ctx, cfg);
                const send = async (): Promise<ActionLogEntry> => {
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
                };
                // v0.1.392 — el envío (SMTP, Gmail, Outlook) espera fuera de la
                // transacción. Salvo que el correo EMITA un número de documento
                // en este paso (un PDF numerado que el registro todavía no
                // tenía): ahí se manda adentro, como antes, para que si el correo
                // no sale el número y el PDF congelado se deshagan (v0.1.290).
                if (issuedNow) return send();
                return afterCommit(send);
            }
            default:
                return skip(spec.type, 'Acción no reconocida.');
        }
    }

    /**
     * v0.1.366 — Después de crear, cambiar o cancelar un evento: deja
     * `{{reunion.*}}` para los pasos siguientes y guarda el enlace y el id en
     * los campos elegidos (al cancelar, los vacía). Devuelve qué pasó, en
     * palabras, para el historial.
     */
    private async afterMeetingCall(
        /** v0.1.392 — abre la transacción recién para escribir (lo de red va antes). */
        withTx: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>,
        ctx: RunContext,
        cfg: Record<string, unknown>,
        p: {
            kind: MeetingActionKind;
            integration: string;
            body: string;
            calendar: string;
            accessToken: string;
            gone: boolean;
            sim: boolean;
            /** v0.1.384 — la acción pidió videollamada (Meet o Teams). */
            wantsVideo?: boolean;
        },
    ): Promise<string> {
        let meet: MeetingResult | null = null;
        if (p.kind !== 'cancel') {
            meet = meetingResult(p.integration as Parameters<typeof meetingResult>[0], p.body);
            // Google crea la sala de Meet un instante después: se vuelve a leer.
            meet = await settleGoogleMeet(meet, { integration: p.integration, calendar: p.calendar, accessToken: p.accessToken });
            if (meet) ctx.reunion = { id: meet.id, enlace: meet.enlace, web: meet.web, titulo: meet.titulo };
        }

        const parts: string[] = [];
        if (p.kind === 'cancel') parts.push(p.gone ? 'el evento ya no estaba en el calendario' : 'cancelado');
        else {
            parts.push(p.kind === 'create' ? 'creado' : 'actualizado');
            // v0.1.384 — se pidió videollamada y no vino el enlace: se dice.
            const video = p.kind === 'create' ? videoCallNote(p.integration, meet, p.wantsVideo ?? false) : null;
            if (video) parts.push(video);
        }

        // Qué se guarda (o se vacía) en el registro.
        const writes: Record<string, unknown> = {};
        const saved: string[] = [];
        const problems: string[] = [];
        for (const k of MEETING_SAVE_KEYS) {
            const slug = typeof cfg[k] === 'string' ? (cfg[k] as string).trim() : '';
            if (slug === '') continue;
            const field = ctx.fieldsBySlug.get(slug);
            const key = ctx.slugToKey.get(slug);
            if (!field || !key || !MEETING_SAVE_FIELD_TYPES[k].includes(field.type)) {
                problems.push(`«${field?.label ?? slug}» no es un campo de texto${k === 'save_meeting_link' ? ' o enlace' : ''}: no se guardó ahí`);
                continue;
            }
            const label = field.label ?? slug;
            const meetLock = await this.managedLockOf(ctx, ctx.listId, Number(key.slice(1)));
            if (meetLock) {
                problems.push(`«${label}» no se tocó: ${meetLock.reason}`);
                continue;
            }
            if (p.kind === 'cancel') {
                writes[key] = null;
                saved.push(`vació «${label}»`);
                continue;
            }
            const value = k === 'save_meeting_link' ? (meet?.enlace ?? '') : (meet?.id ?? '');
            if (value === '') continue;
            writes[key] = value;
            saved.push(`${k === 'save_meeting_link' ? 'enlace' : 'id'} en «${label}»`);
        }
        if (Object.keys(writes).length > 0 && ctx.recordId !== null) {
            if (p.sim) {
                parts.push(`en la prueba no se guarda en el registro (guardaría: ${saved.join(', ')})`);
            } else {
                const recordId = ctx.recordId;
                const { current, merged } = await withTx(async (tx) => {
                    const current = await this.recordsRepo.findById(tx, ctx.tenantId, ctx.listId, recordId);
                    const merged = (await patchRecordData(tx, ctx.tenantId, ctx.listId, recordId, writes)) ?? { ...ctx.data, ...writes };
                    return { current, merged };
                });
                this.changes?.emit({ tenantId: ctx.tenantId, listId: ctx.listId, recordId, before: current?.data ?? ctx.data, after: merged, actorId: 0 });
                ctx.data = merged;
                parts.push(saved.join(', '));
            }
        }
        if (p.kind !== 'cancel' && meet?.enlace) parts.push(meet.enlace);
        return [...parts, ...problems].join(' · ');
    }

    /** Lo que guardaría la acción (para «Probar» sin ejecutar). */
    private meetingSaveSummary(ctx: RunContext, cfg: Record<string, unknown>, kind: MeetingActionKind): string {
        const out: string[] = [];
        for (const k of MEETING_SAVE_KEYS) {
            const slug = typeof cfg[k] === 'string' ? (cfg[k] as string).trim() : '';
            if (slug === '') continue;
            const label = ctx.fieldsBySlug.get(slug)?.label ?? slug;
            out.push(kind === 'cancel' ? `vaciaría «${label}»` : `guardaría el ${k === 'save_meeting_link' ? 'enlace' : 'id'} en «${label}»`);
        }
        return out.length > 0 ? ` Después ${out.join(' y ')}.` : '';
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
        this.rememberNamed(ctx, cfg, info);
        if (ctx.sim && res !== null) ctx.sim.responses[pathKey] = info.body;
    }

    /** Guarda un resultado con el nombre del paso (`{{respuestas.<nombre>.x}}`). */
    private rememberNamed(ctx: RunContext, cfg: Record<string, unknown>, info: ResponseInfo): void {
        const name = typeof cfg.response_name === 'string' ? cfg.response_name.trim() : '';
        if (!RESPONSE_NAME_RE.test(name)) return;
        const next = { ...(ctx.responses ?? {}) };
        delete next[name];
        next[name] = info;
        // Con muchos pasos con nombre, se conservan las 10 más recientes.
        const names = Object.keys(next);
        for (const old of names.slice(0, Math.max(0, names.length - 10))) delete next[old];
        ctx.responses = next;
    }

    /** v0.1.444 — «Probar» con el disparador de comentarios: el último del registro, como llegaría. */
    private async lastCommentSample(tenantId: number, recordId: number): Promise<CommentEventInfo | null> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [c] = await tx
                .select({
                    id: comments.id,
                    body: comments.body,
                    userId: comments.userId,
                    parentId: comments.parentId,
                    visibility: comments.visibility,
                    metadata: comments.metadata,
                    name: users.name,
                    email: users.email,
                    role: memberships.role,
                })
                .from(comments)
                .leftJoin(users, eq(users.id, comments.userId))
                .leftJoin(memberships, and(eq(memberships.userId, comments.userId), eq(memberships.tenantId, comments.tenantId)))
                .where(and(eq(comments.tenantId, tenantId), eq(comments.recordId, recordId), isNull(comments.deletedAt)))
                .orderBy(desc(comments.id))
                .limit(1);
            if (!c) return null;
            const meta = (c.metadata ?? {}) as { email?: { direction?: unknown; from_name?: unknown; from?: unknown } };
            const byEmail = meta.email?.direction === 'in';
            const fromClient = byEmail || c.role === 'client';
            const name = byEmail ? String(meta.email?.from_name ?? meta.email?.from ?? '') : (c.name || c.email || '');
            return {
                id: c.id,
                text: c.body,
                author_id: c.userId,
                author_name: name.trim() || (fromClient ? 'Cliente' : 'Alguien del equipo'),
                from: fromClient ? 'client' : 'team',
                source: byEmail ? 'email' : fromClient ? 'portal' : 'app',
                visibility: c.visibility === 'client' ? 'client' : 'internal',
                parent_id: c.parentId,
            };
        });
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
    ): Promise<{ filename: string; buffer: Buffer; number: string | null; issued: boolean }> {
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
                token.startsWith('before.') || token.startsWith('pago.') || token.startsWith('payload.') || token.startsWith('pdf.') || token.startsWith('reunion.') || (token.startsWith('formulario.') && formEventValue(ctx.form, token.slice('formulario.'.length)) !== undefined) || token === 'formulario.nombre'
                    ? fv(token)
                    : undefined,
        });
        // v0.1.267 — el número emitido ya quedó escrito en su campo (mismo tx):
        // se refleja en la copia del run para que otra acción no lo pise.
        if (doc.numberField) ctx.data = { ...ctx.data, [doc.numberField.key]: doc.numberField.value };
        const out = { filename: doc.filename, buffer: doc.buffer, number: doc.number, issued: doc.numberIssued };
        ctx.pdfs.set(templateId, out);
        return out;
    }

    /** Los PDF que `send_email` adjunta (`pdf_templates`: ids de plantillas). */
    private async emailAttachments(tx: Tx, ctx: RunContext, cfg: Record<string, unknown>): Promise<{ attachments: MailAttachment[]; issuedNow: boolean }> {
        const ids = pdfTemplateIds(cfg);
        if (ids.length === 0) return { attachments: [], issuedNow: false };
        // v0.1.338 (ADR-S87) — los PDF adjuntos son parte de «Documentos PDF»:
        // sin el módulo el envío FALLA (mandar el correo sin el documento que
        // promete sería peor, mismo criterio que un PDF que no se puede armar).
        const off = await planModuleStepError(tx, ctx.tenantId, 'documents');
        if (off) throw new Error(off);
        if (ctx.recordId === null) throw new Error('Los PDF adjuntos necesitan un registro.');
        const out: MailAttachment[] = [];
        let total = 0;
        let issuedNow = false;
        for (const id of ids) {
            // Uno armado por una acción ANTERIOR ya quedó confirmado en la suya.
            const fresh = !(ctx.pdfs?.has(id) ?? false);
            const doc = await this.pdfFor(tx, ctx, id).catch((err: unknown) => {
                throw new Error(`No se pudo armar el PDF adjunto: ${err instanceof Error ? err.message : String(err)}`);
            });
            total += doc.buffer.length;
            if (total > MAIL_MAX_ATTACHMENT_BYTES) {
                throw new Error(`Los PDF adjuntos superan ${MAIL_MAX_ATTACHMENT_BYTES / 1024 / 1024} MB: achícalos o manda menos.`);
            }
            if (fresh && doc.issued) issuedNow = true;
            out.push({ filename: doc.filename, contentType: 'application/pdf', contentBase64: doc.buffer.toString('base64') });
        }
        return { attachments: out, issuedNow };
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

/** v0.1.399 — qué haría el webhook con un dato recibido (panel «Escuchar datos de prueba»). */
export interface WebhookMatchPreview {
    kind: 'none' | 'found' | 'create' | 'not_found' | 'error';
    message: string;
    record_id?: number | null;
    title?: string | null;
}

/**
 * v0.1.399 — Cuando una cadena llega al tope, el cambio se guarda igual pero no
 * dispara otras automatizaciones: el historial lo dice (antes sólo quedaba en
 * el log del servidor).
 */
function chainCutNote(ctx: RunContext): string {
    if (ctx.sim) return '';
    return nextChain(ctx.chain, ctx.automation?.id ?? 0).depth > MAX_AUTOMATION_CHAIN_DEPTH
        ? ` No disparó otras automatizaciones: ya van ${MAX_AUTOMATION_CHAIN_DEPTH} encadenadas (el tope).`
        : '';
}

/** Las claves del JSON que se llaman como un campo de la lista, por su clave `f{id}`. */
function payloadToData(payload: Record<string, unknown>, slugToKey: Map<string, string>): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
        const key = slugToKey.get(k);
        if (key !== undefined) data[key] = v;
    }
    return data;
}

/**
 * v0.1.399 — Los valores que el webhook escribe en el registro, como variables
 * `{{payload.clave}}`: así pasan por el MISMO camino que «Crear un registro» y
 * «Actualizar un campo» (cada valor con el validador de su campo) y el texto
 * que llega nunca se interpreta como plantilla. Al actualizar no se reescribe
 * el campo por el que se buscó; al crear, ese campo nace con el valor buscado.
 */
function webhookPayloadValues(
    payload: Record<string, unknown>,
    slugToKey: Map<string, string>,
    rc: WebhookRecordConfig,
    purpose: 'create' | 'update',
): Record<string, string> {
    const out: Record<string, string> = {};
    const searches = rc.mode === 'update' || rc.mode === 'upsert';
    const matchField = searches && rc.match.by === 'field' ? rc.match.field : null;
    for (const k of Object.keys(payload)) {
        if (!slugToKey.has(k) || !/^[a-zA-Z0-9_]+$/.test(k)) continue;
        if (searches && rc.match.by === 'record_id' && k === rc.matchKey) continue;
        if (purpose === 'update' && k === matchField) continue;
        out[k] = `{{payload.${k}}}`;
    }
    if (purpose === 'create' && matchField && slugToKey.has(matchField) && !(matchField in out)) {
        out[matchField] = `{{payload.${rc.matchKey}}}`;
    }
    return out;
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

/**
 * changed_fields puede venir como array de slugs o (field_changed) como `field`.
 * v0.1.392 — la MISMA función que usa el dispatcher para no encolar lo que no
 * coincide (si divergieran, se perderían corridas).
 */
const normalizeChangedFields = watchedSlugs;

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
/** v0.1.444 — Los campos por los que «Buscar registros» puede filtrar (viven en `data` o son vínculos). */

/** El título de un registro como texto (para mostrarlo y dejarlo en `{{respuestas.x.titulo}}`). */
function recordTitleText(raw: unknown): string {
    if (raw === null || raw === undefined) return '';
    if (typeof raw === 'string') return raw.trim();
    if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
    if (Array.isArray(raw)) return raw.map((v) => String(v)).join(', ');
    return '';
}

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

/** D2 — `{{correo.de}}`, `{{correo.nombre}}`, `{{correo.asunto}}`, `{{correo.texto}}`, `{{correo.tipo}}`. */
function emailValue(info: EmailEventInfo | undefined, key: string): unknown {
    if (!info) return '';
    switch (key) {
        case 'de':
            return info.de;
        case 'nombre':
            return info.nombre || info.de;
        case 'asunto':
            return info.asunto;
        case 'texto':
            return info.texto;
        case 'tipo':
            return info.tipo;
        default:
            return '';
    }
}

/**
 * E5 — `{{sla.alerta}}` («en riesgo» / «vencido»), `{{sla.objetivo}}`
 * («primera respuesta» / «resolución»), `{{sla.vence}}` (en el formato y la
 * zona de la empresa), `{{sla.prioridad}}` y `{{sla.estado}}`.
 */
function slaValue(ctx: RunContext, key: string): unknown {
    const info = ctx.sla;
    if (!info) return '';
    switch (key) {
        case 'alerta':
            return SLA_ALERT_LABELS[info.alerta];
        case 'objetivo':
            return SLA_TARGET_LABELS[info.objetivo];
        case 'vence': {
            if (!info.vence) return '';
            const at = new Date(info.vence);
            if (Number.isNaN(at.getTime())) return '';
            return formatEmailFieldValue({ type: 'datetime', config: {} }, at.toISOString(), {
                ...(ctx.format ?? DEFAULT_FORMAT),
                timezone: ctx.timeZone ?? FALLBACK_TIME_ZONE,
            });
        }
        case 'prioridad':
            return info.prioridad ?? '';
        case 'estado':
            return info.estado ? SLA_STATUS_LABELS[info.estado] : '';
        default:
            return '';
    }
}

/**
 * v0.1.367 — `{{suscripcion.x}}`. Los montos y contadores van crudos (como
 * `{{pago.monto}}`: `{{suscripcion.monto|moneda}}` los formatea); las fechas,
 * en el formato y la zona de la empresa.
 */
function subscriptionValue(ctx: RunContext, key: string): unknown {
    const info = ctx.suscripcion;
    if (!info) return '';
    const day = (iso: string | null): string => {
        if (!iso) return '';
        const at = new Date(iso);
        if (Number.isNaN(at.getTime())) return '';
        let ymd: string;
        try {
            ymd = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.timeZone ?? FALLBACK_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
        } catch {
            ymd = at.toISOString().slice(0, 10);
        }
        return String(formatEmailFieldValue({ type: 'date', config: {} }, ymd, { ...(ctx.format ?? DEFAULT_FORMAT), timezone: ctx.timeZone ?? FALLBACK_TIME_ZONE }));
    };
    switch (key) {
        case 'evento':
            return SUBSCRIPTION_EVENT_LABELS[info.evento] ?? info.evento;
        case 'estado':
            return info.estado;
        case 'plan':
            return info.plan;
        case 'monto':
            return info.monto;
        case 'moneda':
            return info.moneda;
        case 'link':
            return info.link ?? '';
        case 'proximo_cobro':
            return day(info.proximo_cobro);
        case 'pagado_hasta':
            return day(info.pagado_hasta);
        case 'cobros_pagados':
            return info.cobros_pagados;
        case 'cobros_fallidos':
            return info.cobros_fallidos;
        case 'motivo':
            return info.motivo ?? '';
        case 'monto_cobrado':
            return info.monto_cobrado ?? '';
        case 'fecha_cobro':
            return day(info.fecha_cobro);
        case 'id':
            return info.id ?? '';
        default:
            return '';
    }
}

/** v0.1.367 — una suscripción de ejemplo para «Probar» (el registro no tiene). */
function sampleSubscriptionEvent(evento: SubscriptionEventInfo['evento']): SubscriptionEventInfo {
    const now = new Date();
    return {
        subscription_id: 0,
        plan_id: null,
        evento,
        estado: evento === 'expired' ? 'Vencida' : evento === 'past_due' ? 'En mora' : evento === 'cancelled' ? 'Cancelada' : 'Al día',
        plan: 'Plan mensual (ejemplo)',
        monto: 50_000,
        moneda: 'COP',
        link: null,
        proximo_cobro: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        pagado_hasta: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        cobros_pagados: 3,
        cobros_fallidos: evento === 'charge_failed' || evento === 'past_due' || evento === 'expired' ? 1 : 0,
        motivo: evento === 'charge_failed' || evento === 'past_due' ? 'fondos insuficientes' : null,
        monto_cobrado: evento === 'charged' || evento === 'charge_failed' ? 50_000 : null,
        fecha_cobro: evento === 'charged' || evento === 'charge_failed' ? now.toISOString() : null,
        id: null,
    };
}

/** v0.1.447 — una firma de ejemplo para «Probar» (el registro no tiene firmas). */
function sampleSignatureEvent(evento: SignatureEventInfo['evento']): SignatureEventInfo {
    const done = evento === 'completed';
    return {
        request_id: 0,
        evento,
        titulo: 'Contrato de servicios (ejemplo)',
        estado: done ? 'Firmado' : evento === 'declined' ? 'Rechazado' : evento === 'expired' ? 'Vencido' : evento === 'voided' ? 'Anulado' : 'Esperando firmas',
        estado_clave: done ? 'completed' : evento === 'declined' || evento === 'expired' || evento === 'voided' ? evento : 'pending',
        numero: null,
        firmante: evento === 'signed' || evento === 'declined' || done ? 'Ana Gómez (ejemplo)' : null,
        firmante_email: evento === 'signed' || evento === 'declined' || done ? 'ana@ejemplo.com' : null,
        firmante_rol: null,
        firmaron: done ? 2 : evento === 'signed' ? 1 : 0,
        total: 2,
        motivo: evento === 'declined' ? 'No estoy de acuerdo con el plazo (ejemplo)' : null,
        codigo: 'ABCDE-12345',
        verificar: '(la página de verificación)',
        siguiente: evento === 'requested' || evento === 'signed' ? 'Carlos Ruiz (ejemplo)' : null,
        siguiente_email: evento === 'requested' || evento === 'signed' ? 'carlos@ejemplo.com' : null,
        enlace: evento === 'requested' || evento === 'signed' ? '(el enlace para firmar)' : null,
        pdf: done ? '(el PDF firmado)' : null,
        template_id: null,
    };
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

/**
 * v0.1.386 — `{{formulario.x}}` del formulario que se envió: su título y de
 * dónde llegó. undefined = no es una variable del formulario (sigue la
 * resolución normal: un campo puede llamarse «formulario»).
 */
export function formEventValue(form: FormEventInfo | undefined, key: string): string | undefined {
    const o = form?.origin ?? {};
    switch (key) {
        case 'nombre':
            return form?.name ?? '';
        case 'titulo':
            return form?.title || form?.name || '';
        case 'pagina':
            return o.page_url ?? '';
        case 'llego_desde':
            return o.referrer ?? '';
        case 'utm_source':
        case 'utm_medium':
        case 'utm_campaign':
        case 'utm_term':
        case 'utm_content':
            return o[key] ?? '';
        default:
            return undefined;
    }
}
