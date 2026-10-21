import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    bulkOperationSchema,
    filterTreeSchema,
    jsonbKeyForField,
    readStoreListMarker,
    storeCellAccess,
    storeValueError,
    tenantFormatSchema,
    zonedToday,
    FALLBACK_TIME_ZONE,
    type ActionLogEntry,
    type ActionSpec,
    type AutomationRunStatus,
    type ConditionData,
    type StoreListMarker,
    type TenantFormat,
} from '@imagina-base/shared';
import { and, asc, eq, gt, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { safeWebhookFetch } from '../common/safe-fetch';
import { redactValues, type ConnectionParts } from '../connectors/connection-parts';
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
import { lists, memberships, records, tenants, users } from '../db/schema';
import { tenantIsReadOnly } from '../tenancy/read-only';
import { FieldsRepository } from '../fields/fields.repository';
import { DocumentsService } from '../documents/documents.service';
import { MAIL_MAX_ATTACHMENT_BYTES, type MailAttachment } from '../mail/mail.types';
import { MailService } from '../mail/mail.service';
import { fieldTypedExpr, type FilterableField } from '../records/query-builder';
import { RecordsRepository } from '../records/records.repository';
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
    type TriggerEvent,
} from './automation-dispatcher.service';
import { evaluateCondition, type ConditionOptions } from './condition-evaluator';
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
    /** La cadena de automatizaciones de la que viene este evento (tope y anti-loop). */
    chain?: AutomationChain;
    /** Personas de los campos «Persona» (`{{responsable.email}}`), por id. */
    people?: Map<number, PersonInfo | null>;
    /** Marca de tienda por lista, leída una vez por corrida. */
    storeMarkers?: Map<number, StoreListMarker | null>;
}

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

    /** Trigger de record (record_created / record_updated). */
    async process(event: TriggerEvent): Promise<void> {
        const chain = event.chain;
        // Una cadena de automatizaciones que se pasó del tope no sigue
        // (un A → B → A → … no termina nunca).
        if (chain && chain.depth > MAX_AUTOMATION_CHAIN_DEPTH) {
            this.logger.warn(`Cadena de automatizaciones cortada en la profundidad ${chain.depth} (lista ${event.listId}).`);
            return;
        }
        const prep = await this.tenantDb.withTenant(event.tenantId, async (tx) => {
            // SEC-34: empresa en solo-lectura (impaga/archivada) → no corre nada.
            if (await tenantIsReadOnly(tx, event.tenantId)) return null;
            const triggerTypes = TRIGGERS_FOR_EVENT[event.trigger];
            const autos = (
                await this.automations.activeByTriggers(tx, event.tenantId, event.listId, triggerTypes)
            ).filter((a) => !chain || !chain.automation_ids.includes(a.id)); // nunca se re-dispara a sí misma
            if (autos.length === 0) return null;
            return { autos, maps: await this.fieldMaps(tx, event.tenantId, event.listId) };
        });
        if (!prep) return;
        for (const auto of prep.autos) {
            const ctx: RunContext = {
                tenantId: event.tenantId,
                listId: event.listId,
                recordId: event.recordId,
                data: event.after,
                before: event.before,
                ...prep.maps,
                ...(event.payment ? { pago: event.payment } : {}),
                ...(event.form ? { form: event.form } : {}),
                ...(chain ? { chain } : {}),
            };
            if (!this.triggerMatches(auto, ctx)) continue;
            await this.runOne(ctx, auto);
        }
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
        await this.runOne({ tenantId, listId: prep.auto.listId, recordId: null, data: {}, ...prep.maps }, prep.auto);
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
            // Un campo Persona guarda el id: `.email` y `.nombre` lo hacen útil
            // en un correo («Para: {{responsable.email}}»).
            const person = /^(before\.)?([a-zA-Z0-9_]+)\.(email|nombre)$/.exec(token);
            if (person && ctx.fieldsBySlug.get(person[2]!)?.type === 'user') {
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

    /** `merge` (valores crudos) y `mergeHtml` (valores escapados) con etiquetas y formato regional. */
    private mergers(ctx: RunContext, fv = this.accessor(ctx)): { merge: MergeFn; mergeHtml: (s: unknown) => string } {
        // v0.1.178 — `{{campo|label}}` traduce el value a la etiqueta de la opción.
        const labels = labelResolverFor(ctx.fieldsBySlug);
        const formatter = regionalFormatterFor(ctx.fieldsBySlug, ctx.format ?? DEFAULT_FORMAT, ctx.timeZone ?? FALLBACK_TIME_ZONE);
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
        const keys: string[] = [];
        for (const [slug, f] of ctx.fieldsBySlug) {
            if (f.type !== 'user') continue;
            const key = ctx.slugToKey.get(slug);
            if (key) keys.push(key);
        }
        if (keys.length === 0) return;
        ctx.people ??= new Map();
        const ids = new Set<number>();
        for (const source of [ctx.data, ctx.before ?? {}]) {
            for (const key of keys) {
                const id = Number(source[key]);
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

    private async runOne(ctx: RunContext, auto: AutomationRow): Promise<void> {
        ctx.automation = { id: auto.id, name: auto.name };
        const startedAt = new Date();
        let runId: number | null = null;
        try {
            runId = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
                this.automations.startRun(tx, { tenantId: ctx.tenantId, automationId: auto.id, recordId: ctx.recordId, startedAt }),
            );
        } catch (err) {
            // La automatización se borró mientras se encolaba el evento.
            this.logger.warn(`No se pudo abrir la corrida de la automatización ${auto.id}: ${errorText(err)}`);
            return;
        }
        if (runId === null) return;

        const log: ActionLogEntry[] = [];
        let hadFail = false;
        try {
            for (const spec of auto.actions) {
                for (const result of await this.executeStep(ctx, spec, 0)) {
                    log.push(result);
                    if (result.status === 'failed') hadFail = true;
                }
            }
        } catch (err) {
            hadFail = true;
            log.push({ action: 'engine', status: 'failed', message: errorText(err, 2000), details: {} });
            this.logger.error(`Automatización ${auto.id} falló: ${String(err)}`);
        }

        const status: AutomationRunStatus = hadFail ? 'failed' : 'success';
        try {
            await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
                this.automations.finishRun(tx, ctx.tenantId, runId!, {
                    status,
                    actionsLog: log,
                    error: hadFail ? (log.find((l) => l.status === 'failed')?.message ?? 'Falló una acción') : null,
                    finishedAt: new Date(),
                }),
            );
        } catch (err) {
            this.logger.error(`No se pudo cerrar la corrida ${runId} de la automatización ${auto.id}: ${errorText(err)}`);
        }
        this.reportRun(ctx, auto, hadFail ? log : null);
    }

    /**
     * v0.1.285 (ADR-S44) — Una corrida fallida abre (o suma) el problema de esa
     * automatización y avisa a los admins; una corrida buena lo cierra.
     */
    private reportRun(ctx: RunContext, auto: AutomationRow, failedLog: ActionLogEntry[] | null): void {
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
     * Ejecuta un step: gate por condición de la acción → if_else recursivo →
     * acción concreta. Devuelve uno o más ActionLogEntry (if_else emite el
     * summary + los de la rama ejecutada).
     */
    private async executeStep(ctx: RunContext, spec: ActionSpec, depth: number): Promise<ActionLogEntry[]> {
        await this.ensurePeople(ctx);
        const fv = this.accessor(ctx);
        if (spec.condition && !evaluateCondition(spec.condition, fv, this.condOpts(ctx))) {
            return [{ action: spec.type, status: 'skipped', message: 'Condición de ejecución no cumplida.', details: {} }];
        }

        if (spec.type === 'if_else') {
            return this.executeIfElse(ctx, spec.config ?? {}, depth);
        }

        // Escribir registros: por RecordsService (abre y confirma su propia
        // transacción, con actividad, tiempo real y automatizaciones).
        if (spec.type === 'update_field' || spec.type === 'create_record') {
            try {
                return [
                    spec.type === 'update_field'
                        ? await this.updateField(ctx, spec.config ?? {})
                        : await this.createRecord(ctx, spec.config ?? {}),
                ];
            } catch (err) {
                return [{ action: spec.type, status: 'failed', message: explainError(err), details: {} }];
            }
        }

        // v0.1.285 — cada acción en su propia transacción: un error de base de
        // datos en una acción no arrastra a las demás ni a la corrida.
        let out: ActionLogEntry | null = null;
        try {
            await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
                out = await this.execAction(tx, ctx, spec);
            });
            return [out!];
        } catch (err) {
            const done = out as ActionLogEntry | null;
            if (done?.status === 'failed') return [done];
            const message = done ? `Se deshizo por un error de la base de datos: ${errorText(err)}` : errorText(err, 2000);
            return [{ action: spec.type, status: 'failed', message, details: {} }];
        }
    }

    private async executeIfElse(ctx: RunContext, config: Record<string, unknown>, depth: number): Promise<ActionLogEntry[]> {
        const fv = this.accessor(ctx);
        const matched = evaluateCondition(config.condition as ConditionData | undefined, fv, this.condOpts(ctx));
        const branch = matched ? config.then_actions : config.else_actions;
        const list: ActionSpec[] = Array.isArray(branch) ? (branch as ActionSpec[]) : [];

        const out: ActionLogEntry[] = [
            {
                action: 'if_else',
                status: 'success',
                message: matched ? 'Se cumplió la condición → rama «Sí»' : 'No se cumplió la condición → rama «No»',
                details: { branch: matched ? 'then' : 'else', count: list.length },
            },
        ];
        if (depth >= MAX_IF_ELSE_DEPTH) return out;
        for (const nested of list) {
            if (!nested || typeof nested !== 'object' || typeof nested.type !== 'string') continue;
            const step: ActionSpec = {
                type: nested.type,
                config: (nested.config as Record<string, unknown>) ?? {},
                condition: nested.condition ?? null,
            };
            out.push(...(await this.executeStep(ctx, step, depth + 1)));
        }
        return out;
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
     */
    private async updateField(ctx: RunContext, cfg: Record<string, unknown>): Promise<ActionLogEntry> {
        if (ctx.recordId === null) return skip('update_field', 'Sin registro en contexto.');
        const values = (cfg.values as Record<string, unknown>) ?? {};
        const patch: Record<string, unknown> = {};
        const applied: Record<string, unknown> = {};
        const invalid: string[] = [];
        for (const [slug, raw] of Object.entries(values)) {
            const key = ctx.slugToKey.get(slug);
            const field = ctx.fieldsBySlug.get(slug);
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
            this.recordsRepo.findById(tx, ctx.tenantId, ctx.listId, ctx.recordId!),
        );
        if (!current) return skip('update_field', 'El registro ya no existe.');

        // v0.1.213 — en una lista de tienda, una automatización respeta
        // las MISMAS reglas que una persona: lo que la tienda no
        // aceptaría (o sólo se edita en WooCommerce) se saltea con el
        // motivo en el log, en vez de escribir un valor que la próxima
        // sincronización pisaría en silencio.
        const storeSkipped: string[] = [];
        const marker = await this.storeMarkerOf(ctx, ctx.listId);
        if (marker) {
            const merged = { ...current.data, ...patch };
            const row = (packSlug: string): unknown => {
                const id = marker.fields[packSlug];
                return id ? merged[`f${id}`] : undefined;
            };
            for (const slug of Object.keys(applied)) {
                const key = ctx.slugToKey.get(slug)!;
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
            const key = ctx.slugToKey.get(slug)!;
            if (ctx.fieldsBySlug.get(slug)?.type === 'relation') continue;
            if (sameValue(current.data[key], value)) {
                delete patch[key];
                delete applied[slug];
            }
        }

        const notes = [...storeSkipped, ...invalid];
        if (Object.keys(patch).length === 0) {
            // Nada válido que escribir por valores que no convierten: la
            // automatización está mal configurada y se tiene que ver.
            if (invalid.length > 0 && storeSkipped.length === 0) {
                return fail('update_field', `No se pudo escribir ningún valor: ${invalid.join('; ')}.`);
            }
            if (notes.length > 0) return skip('update_field', `Nada que cambiar: ${notes.join('; ')}`);
            return skip('update_field', 'Los campos ya tenían esos valores.');
        }

        const after = await this.writeUpdate(ctx, patch, current.data);
        ctx.data = after; // acciones posteriores ven el valor actualizado.
        const count = Object.keys(applied).length;
        const note = notes.length > 0 ? ` Omitidos: ${notes.join('; ')}.` : '';
        return ok('update_field', `Actualizó ${count} campo(s).${note}`, {
            values: applied,
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
            const filled = f.type === 'relation'
                ? relations.some((r) => r.fieldId === f.id && r.ids.length > 0)
                : !isBlank(data[jsonbKeyForField(f.id)]);
            if (!filled) skipped.push(`«${f.label}» quedó vacío y es obligatorio`);
        }

        const created = await this.writeCreate(ctx, targetList, data, relations.filter((r) => r.ids.length > 0));
        const note = skipped.length > 0 ? ` Omitidos: ${skipped.join('; ')}.` : '';
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
    private async writeUpdate(ctx: RunContext, patch: Record<string, unknown>, before: Record<string, unknown>): Promise<Record<string, unknown>> {
        const chain = nextChain(ctx.chain, ctx.automation?.id ?? 0);
        const dispatchOpts = chain.depth > MAX_AUTOMATION_CHAIN_DEPTH ? { noAutomations: true } : { automationChain: chain };
        const svc = this.records();
        if (svc) {
            const dto = await svc.update(ctx.tenantId, SYSTEM_ACTOR, String(ctx.listId), ctx.recordId!, { data: patch }, dispatchOpts);
            return dto.data;
        }
        const relationKeys = Object.keys(patch).filter((k) => ctx.fieldsBySlug.get(slugOf(ctx, k) ?? '')?.type === 'relation');
        const dataPatch = Object.fromEntries(Object.entries(patch).filter(([k]) => !relationKeys.includes(k)));
        const after = await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const row = await patchRecordData(tx, ctx.tenantId, ctx.listId, ctx.recordId!, dataPatch);
            for (const key of relationKeys) {
                await this.relationsRepo.sync(tx, ctx.tenantId, Number(key.slice(1)), ctx.recordId!, patch[key] as number[]);
            }
            return row;
        });
        if (!after) throw new Error('El registro ya no existe.');
        this.changes?.emit({ tenantId: ctx.tenantId, listId: ctx.listId, recordId: ctx.recordId!, before, after, actorId: SYSTEM_USER });
        if (!('noAutomations' in dispatchOpts)) {
            this.dispatcher?.dispatch({ tenantId: ctx.tenantId, listId: ctx.listId, recordId: ctx.recordId!, trigger: 'record_updated', after, before, chain });
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
        const isPerson = (slug: string): boolean => ctx.fieldsBySlug.get(slug)?.type === 'user';
        const withPeople = template
            .split(',')
            .map((part) => (isPerson(part.trim()) ? `{{${part.trim()}.email}}` : part))
            .join(',')
            .replace(/\{\{\s*(before\.)?([a-zA-Z0-9_]+)\s*\}\}/g, (m, before: string | undefined, slug: string) =>
                isPerson(slug) ? `{{${before ?? ''}${slug}.email}}` : m,
            );
        return limitRecipients(merge(withPeople));
    }

    private async execAction(tx: Tx, ctx: RunContext, spec: ActionSpec): Promise<ActionLogEntry> {
        const fv = this.accessor(ctx);
        const { merge, mergeHtml } = this.mergers(ctx, fv);
        const cfg = spec.config ?? {};

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
                const res = await safeWebhookFetch(req.url, {
                    method: req.method,
                    headers: req.headers,
                    body: req.body,
                    captureBody: true,
                    maxCaptureBytes: 2048,
                });
                const shownUrl = redactValues(req.url, connection?.redact ?? []);
                // Un 4xx/5xx NO es éxito: antes quedaba «→ 500» como corrida
                // exitosa y nadie se enteraba de que el destino rechazaba todo.
                if (res.status < 200 || res.status >= 300) {
                    return httpFail('call_webhook', `${req.method} ${shownUrl}`, res.status, res.body);
                }
                return ok('call_webhook', `${req.method} ${shownUrl} → ${res.status}`, {
                    status: res.status,
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
                    const res = await safeWebhookFetch(req.url, {
                        method: req.method,
                        headers: req.headers,
                        body: req.body,
                        captureBody: true,
                    });
                    const problem = checkIntegrationResponse(integ.key, res.status, res.body ?? '');
                    if (problem) throw new Error(`${resolved.action.label}: ${problem}`);
                    return ok(
                        'connector_action',
                        `${resolved.name} → ${resolved.action.label}: ${res.status}`,
                        { status: res.status, action: resolved.action.key, integration: integ.key },
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
                const res = await safeWebhookFetch(req.url, {
                    method: req.method,
                    headers: req.headers,
                    body: req.body,
                    captureBody: true,
                    maxCaptureBytes: 2048,
                });
                // Un 4xx/5xx es una falla (abre el problema de la automatización).
                if (res.status < 200 || res.status >= 300) {
                    return httpFail(
                        'connector_action',
                        `${resolved.name} → ${resolved.action.label}`,
                        res.status,
                        redactValues(res.body ?? '', resolved.parts.redact),
                    );
                }
                return ok(
                    'connector_action',
                    `${resolved.name} → ${resolved.action.label}: ${res.status}`,
                    { status: res.status, action: resolved.action.key },
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
        const ids = Array.isArray(cfg.pdf_templates)
            ? [...new Set(cfg.pdf_templates.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 5)
            : [];
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

/** El slug de una clave `f{id}` en el contexto del run. */
function slugOf(ctx: RunContext, key: string): string | undefined {
    for (const [slug, k] of ctx.slugToKey) if (k === key) return slug;
    return undefined;
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
        .set({ data: expr as unknown as Record<string, unknown>, updatedAt: sql`now()` as unknown as Date })
        .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), eq(records.id, recordId), isNull(records.deletedAt)))
        .returning({ data: records.data });
    return row?.data ?? null;
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
