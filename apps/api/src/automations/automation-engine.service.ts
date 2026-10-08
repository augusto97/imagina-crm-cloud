import { Injectable, Logger, Optional } from '@nestjs/common';
import {
    bulkOperationSchema,
    filterTreeSchema,
    jsonbKeyForField,
    readStoreListMarker,
    storeCellAccess,
    storeValueError,
    validateFieldValue,
    zonedToday,
    FALLBACK_TIME_ZONE,
    type ActionLogEntry,
    type ActionSpec,
    type AutomationRunStatus,
    type ConditionData,
    type FieldValueSpec,
    type StoreListMarker,
} from '@imagina-base/shared';
import { and, asc, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import { safeWebhookFetch } from '../common/safe-fetch';
import type { ConnectionParts } from '../connectors/connection-parts';
import { compileConnectorCall } from '../connectors/connector-actions';
import {
    buildIntegrationRequest,
    checkIntegrationResponse,
    compileIntegrationValues,
} from '../connectors/integration-calls';
import { ConnectorsService } from '../connectors/connectors.service';
import { buildWebhookRequest } from './webhook-request';
import type { Tx } from '../db/client';
import { BillingService } from '../billing/billing.service';
import { CollectionsService } from '../collections/collections.service';
import { automationRuns, lists, records } from '../db/schema';
import { tenantIsReadOnly } from '../tenancy/read-only';
import { FieldsRepository } from '../fields/fields.repository';
import { DocumentsService } from '../documents/documents.service';
import { MAIL_MAX_ATTACHMENT_BYTES, type MailAttachment } from '../mail/mail.types';
import { MailService } from '../mail/mail.service';
import { fieldTypedExpr, type FilterableField } from '../records/query-builder';
import { RecordsRepository } from '../records/records.repository';
import { RecordChangeHub } from '../records/record-change-hub';
import { RelationsRepository } from '../records/relations.repository';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { AutomationsRepository, type AutomationRow } from './automations.repository';
import { AutomationDispatcher, type TriggerEvent } from './automation-dispatcher.service';
import { evaluateCondition } from './condition-evaluator';
import { EmailComposer } from './email-composer';
import { applyMergeTags, escapeHtml, labelResolverFor, type LabelFieldLike } from './merge-tags';

const SYSTEM_USER = 0;
const MAX_IF_ELSE_DEPTH = 5;

/** Qué trigger_types reaccionan a cada evento de record. */
const TRIGGERS_FOR_EVENT: Record<TriggerEvent['trigger'], string[]> = {
    record_created: ['record_created'],
    record_updated: ['record_updated', 'field_changed'],
    // v0.1.251 — un cliente pagó un link de Mercado Pago o Wompi.
    payment_received: ['payment_received'],
};

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
    /** v0.1.263 — zona de la empresa: `{{date.today}}` es el "hoy" de su reloj. */
    timeZone?: string;
    /**
     * v0.1.266 — el último PDF generado en este run (`{{pdf.link}}`,
     * `{{pdf.nombre}}`) y los PDF ya armados por plantilla: un «Enviar email»
     * que adjunta la misma plantilla no la vuelve a dibujar.
     */
    pdf?: Record<string, unknown>;
    pdfs?: Map<number, { filename: string; buffer: Buffer; number: string | null }>;
}

/**
 * Motor de automatizaciones (paridad plugin). Ejecuta el modelo flexible:
 * trigger_config (field_filters + changed_fields) + actions[] con condición por
 * acción + `if_else` recursivo + merge tags. Corre en el worker BullMQ.
 */
@Injectable()
export class AutomationEngine {
    private readonly logger = new Logger(AutomationEngine.name);
    /** v0.1.265 — arma el correo (diseño / texto / HTML + firma). Sin dependencias. */
    private readonly composer = new EmailComposer();

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
    ) {}

    /** Marca de lista de tienda (v0.1.213), o null. */
    private async storeMarkerOf(tx: Tx, tenantId: number, listId: number): Promise<StoreListMarker | null> {
        const [row] = await tx
            .select({ settings: lists.settings })
            .from(lists)
            .where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId)))
            .limit(1);
        return readStoreListMarker(row?.settings);
    }

    /** Trigger de record (record_created / record_updated). */
    async process(event: TriggerEvent): Promise<void> {
        await this.tenantDb.withTenant(event.tenantId, async (tx) => {
            // SEC-34: empresa en solo-lectura (impaga/archivada) → no corre nada.
            if (await tenantIsReadOnly(tx, event.tenantId)) return;
            const triggerTypes = TRIGGERS_FOR_EVENT[event.trigger];
            const autos = await this.automations.activeByTriggers(
                tx,
                event.tenantId,
                event.listId,
                triggerTypes,
            );
            if (autos.length === 0) return;
            const maps = await this.fieldMaps(tx, event.tenantId, event.listId);
            for (const auto of autos) {
                const ctx: RunContext = {
                    tenantId: event.tenantId,
                    listId: event.listId,
                    recordId: event.recordId,
                    data: event.after,
                    before: event.before,
                    ...maps,
                    ...(event.payment ? { pago: event.payment } : {}),
                };
                if (!this.triggerMatches(auto, ctx)) continue;
                await this.runOne(tx, ctx, auto);
            }
        });
    }

    /** Trigger `scheduled` (cron): corre una automatización sin record. */
    async runScheduled(tenantId: number, automationId: number): Promise<void> {
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            // SEC-34: empresa en solo-lectura (impaga/archivada) → no corre nada.
            if (await tenantIsReadOnly(tx, tenantId)) return;
            const auto = await this.automations.findById(tx, tenantId, automationId);
            if (!auto || !auto.isActive) return;
            const maps = await this.fieldMaps(tx, tenantId, auto.listId);
            await this.runOne(tx, { tenantId, listId: auto.listId, recordId: null, data: {}, ...maps }, auto);
        });
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
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            // SEC-34: empresa en solo-lectura (impaga/archivada) → no corre nada.
            if (await tenantIsReadOnly(tx, tenantId)) return;
            const auto = await this.automations.findById(tx, tenantId, automationId);
            if (!auto || !auto.isActive || auto.triggerType !== 'incoming_webhook') return;
            const maps = await this.fieldMaps(tx, tenantId, auto.listId);
            const data: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(payload)) {
                const key = maps.slugToKey.get(k);
                if (key !== undefined) data[key] = v;
            }
            const ctx: RunContext = { tenantId, listId: auto.listId, recordId: null, data, ...maps, payload };
            if (!evaluateCondition(auto.triggerConfig.field_filters as ConditionData | undefined, this.accessor(ctx))) {
                return;
            }
            await this.runOne(tx, ctx, auto);
        });
    }

    /**
     * Trigger `due_date_reached`: por cada record cuyo campo fecha venció
     * (valor + offset ≤ now) y que la automatización aún no corrió, ejecuta.
     */
    async runDueDate(tenantId: number, automationId: number): Promise<void> {
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            // SEC-34: empresa en solo-lectura (impaga/archivada) → no corre nada.
            if (await tenantIsReadOnly(tx, tenantId)) return;
            const auto = await this.automations.findById(tx, tenantId, automationId);
            if (!auto || !auto.isActive || auto.triggerType !== 'due_date_reached') return;

            const fieldRows = await this.fields.listByList(tx, tenantId, auto.listId);
            const slugToKey = new Map(fieldRows.map((f) => [f.slug, jsonbKeyForField(f.id)]));
            const fieldsBySlug = new Map<string, LabelFieldLike>(
                fieldRows.map((f) => [f.slug, { type: f.type, config: f.config }]),
            );
            const fieldId = resolveDateFieldId(auto.triggerConfig, fieldRows);
            if (fieldId === null) return;
            const offset = Number(auto.triggerConfig.offset_minutes ?? 0) || 0;
            const field = fieldRows.find((f) => f.id === fieldId);
            if (!field) return;

            // v0.1.263 — una fecha SIN hora («vence el 7») vence a la medianoche
            // del reloj de la empresa, no a la de UTC (que en Colombia es el 6 a
            // las 7 pm). Un datetime ya es un instante y se compara tal cual.
            const typed = fieldTypedExpr({ id: field.id, type: field.type as FilterableField['type'] });
            const tz = await this.tenantTimeZone(tx, tenantId);
            const dueExpr = field.type === 'date' ? sql`((${typed})::timestamp AT TIME ZONE ${tz})` : typed;
            const threshold = sql`now() - make_interval(mins => ${offset})`;
            const alreadyRan = sql`exists (select 1 from ${automationRuns} ar
                where ar.tenant_id = ${tenantId} and ar.automation_id = ${auto.id}
                  and ar.record_id = ${records.id} and ar.status <> 'failed')`;

            // v0.1.252 — keyset por id en tandas de 500. Antes era UN `limit 500`
            // sin orden: los vencidos que no pasan los field_filters no
            // registran run (a propósito: si vuelven a cumplir, disparan), así
            // que con más de 500 de esos la consulta devolvía SIEMPRE los
            // mismos y el resto de los vencidos no se procesaba nunca.
            const BATCH = 500;
            const MAX_BATCHES = 50;
            let afterId = 0;
            for (let batch = 0; batch < MAX_BATCHES; batch++) {
                const due = await tx
                    .select({ id: records.id, data: records.data })
                    .from(records)
                    .where(
                        and(
                            eq(records.tenantId, tenantId),
                            eq(records.listId, auto.listId),
                            isNull(records.deletedAt),
                            gt(records.id, afterId),
                            lte(dueExpr, threshold),
                            sql`not ${alreadyRan}`,
                        ),
                    )
                    .orderBy(asc(records.id))
                    .limit(BATCH);

                for (const rec of due) {
                    const ctx: RunContext = {
                        tenantId,
                        listId: auto.listId,
                        recordId: rec.id,
                        data: rec.data,
                        slugToKey,
                        fieldsBySlug,
                        timeZone: tz,
                    };
                    // Los field_filters del trigger se evalúan AL DISPARAR (no
                    // solo en process()): "recordar a los 20 días SI la factura
                    // sigue pendiente" depende de esto. Un record filtrado no
                    // registra run → si más adelante vuelve a cumplir, dispara.
                    if (!evaluateCondition(auto.triggerConfig.field_filters as ConditionData | undefined, this.accessor(ctx))) {
                        continue;
                    }
                    await this.runOne(tx, ctx, auto);
                }
                if (due.length < BATCH) break;
                afterId = due[due.length - 1]!.id;
            }
        });
    }

    /** slug → f{id} y slug → {type, config} de la lista, en UNA query. */
    private async fieldMaps(
        tx: Tx,
        tenantId: number,
        listId: number,
    ): Promise<Pick<RunContext, 'slugToKey' | 'fieldsBySlug' | 'timeZone'>> {
        const fieldRows = await this.fields.listByList(tx, tenantId, listId);
        return {
            slugToKey: new Map(fieldRows.map((f) => [f.slug, jsonbKeyForField(f.id)])),
            fieldsBySlug: new Map(fieldRows.map((f) => [f.slug, { type: f.type, config: f.config, label: f.label }])),
            timeZone: await this.tenantTimeZone(tx, tenantId),
        };
    }

    /** v0.1.263 — la zona de la empresa (UTC si todavía no eligió). */
    private async tenantTimeZone(tx: Tx, tenantId: number): Promise<string> {
        return this.timeZones ? this.timeZones.orUtc(tenantId, tx) : FALLBACK_TIME_ZONE;
    }

    /** ¿La automatización matchea el trigger? (field_filters + changed_fields). */
    private triggerMatches(auto: AutomationRow, ctx: RunContext): boolean {
        const cfg = auto.triggerConfig ?? {};
        const fv = this.accessor(ctx);
        if (!evaluateCondition(cfg.field_filters as ConditionData | undefined, fv)) return false;

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
        return true;
    }

    /** Accessor slug → valor del record (desde `data` keyed por f{id}). */
    /**
     * Accessor de merge tags / condiciones. Además de `{{slug}}` (valor
     * actual) resuelve:
     * - `{{before.slug}}`: valor ANTERIOR al cambio (triggers de update —
     *   ej. la fecha de cobro que acaba de vencer ANTES de que la
     *   recurrencia la ruede al mes siguiente = el período facturado).
     * - `{{date.now}}` / `{{date.today}}`: timestamp/fecha del disparo.
     *   `date.now` es el instante (naive UTC, como guardan los datetime) y
     *   `date.today` la fecha de HOY en el reloj de la empresa (v0.1.263:
     *   antes era la de UTC, y de 7 pm a medianoche en Colombia daba mañana).
     */
    private accessor(ctx: RunContext): (slug: string) => unknown {
        return (token: string) => {
            if (token === 'date.now') return new Date().toISOString().slice(0, 19).replace('T', ' ');
            if (token === 'date.today') return zonedToday(ctx.timeZone ?? FALLBACK_TIME_ZONE);
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

    private async runOne(tx: Tx, ctx: RunContext, auto: AutomationRow): Promise<void> {
        ctx.automation = { id: auto.id, name: auto.name };
        const startedAt = new Date();
        const log: ActionLogEntry[] = [];
        let hadFail = false;

        try {
            for (const spec of auto.actions) {
                for (const result of await this.executeStep(tx, ctx, spec, 0)) {
                    log.push(result);
                    if (result.status === 'failed') hadFail = true;
                }
            }
        } catch (err) {
            hadFail = true;
            log.push({ action: 'engine', status: 'failed', message: err instanceof Error ? err.message : String(err), details: {} });
            this.logger.error(`Automatización ${auto.id} falló: ${String(err)}`);
        }

        const status: AutomationRunStatus = hadFail ? 'failed' : 'success';
        await this.automations.logRun(tx, {
            tenantId: ctx.tenantId,
            automationId: auto.id,
            recordId: ctx.recordId,
            status,
            actionsLog: log,
            error: hadFail ? (log.find((l) => l.status === 'failed')?.message ?? 'Falló una acción') : null,
            startedAt,
            finishedAt: new Date(),
        });
    }

    /**
     * Ejecuta un step: gate por condición de la acción → if_else recursivo →
     * acción concreta. Devuelve uno o más ActionLogEntry (if_else emite el
     * summary + los de la rama ejecutada).
     */
    private async executeStep(
        tx: Tx,
        ctx: RunContext,
        spec: ActionSpec,
        depth: number,
    ): Promise<ActionLogEntry[]> {
        const fv = this.accessor(ctx);
        if (spec.condition && !evaluateCondition(spec.condition, fv)) {
            return [{ action: spec.type, status: 'skipped', message: 'Condición de ejecución no cumplida.', details: {} }];
        }

        if (spec.type === 'if_else') {
            return this.executeIfElse(tx, ctx, spec.config ?? {}, depth);
        }

        try {
            return [await this.execAction(tx, ctx, spec)];
        } catch (err) {
            return [{ action: spec.type, status: 'failed', message: err instanceof Error ? err.message : String(err), details: {} }];
        }
    }

    private async executeIfElse(
        tx: Tx,
        ctx: RunContext,
        config: Record<string, unknown>,
        depth: number,
    ): Promise<ActionLogEntry[]> {
        const fv = this.accessor(ctx);
        const matched = evaluateCondition(config.condition as ConditionData | undefined, fv);
        const branch = matched ? config.then_actions : config.else_actions;
        const list: ActionSpec[] = Array.isArray(branch) ? (branch as ActionSpec[]) : [];

        const out: ActionLogEntry[] = [
            {
                action: 'if_else',
                status: 'success',
                message: matched ? 'Condición matcheó → then' : 'Condición no matcheó → else',
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
            out.push(...(await this.executeStep(tx, ctx, step, depth + 1)));
        }
        return out;
    }

    private async execAction(tx: Tx, ctx: RunContext, spec: ActionSpec): Promise<ActionLogEntry> {
        const fv = this.accessor(ctx);
        // v0.1.178 — `{{campo|label}}` traduce el value a la etiqueta de la opción.
        const labels = labelResolverFor(ctx.fieldsBySlug);
        const merge = (s: unknown): string =>
            applyMergeTags(typeof s === 'string' ? s : '', fv, ctx.recordId, undefined, labels);
        // SEC-08: variante que escapa los valores interpolados para contexto HTML.
        const mergeHtml = (s: unknown): string =>
            applyMergeTags(typeof s === 'string' ? s : '', fv, ctx.recordId, escapeHtml, labels);
        const cfg = spec.config ?? {};

        switch (spec.type) {
            case 'update_field': {
                if (ctx.recordId === null) return skip('update_field', 'Sin record en contexto.');
                const values = (cfg.values as Record<string, unknown>) ?? {};
                const merged = { ...ctx.data };
                const applied: Record<string, unknown> = {};
                for (const [slug, value] of Object.entries(values)) {
                    const key = ctx.slugToKey.get(slug);
                    if (!key) continue;
                    const resolved = typeof value === 'string' ? merge(value) : value;
                    merged[key] = resolved;
                    applied[slug] = resolved;
                }
                // v0.1.213 — en una lista de tienda, una automatización respeta
                // las MISMAS reglas que una persona: lo que la tienda no
                // aceptaría (o sólo se edita en WooCommerce) se saltea con el
                // motivo en el log, en vez de escribir un valor que la próxima
                // sincronización pisaría en silencio.
                const storeSkipped: string[] = [];
                const marker = await this.storeMarkerOf(tx, ctx.tenantId, ctx.listId);
                if (marker) {
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
                        if (key in ctx.data) merged[key] = ctx.data[key];
                        else delete merged[key];
                        delete applied[slug];
                        storeSkipped.push(`${slug} (${err})`);
                    }
                    if (Object.keys(applied).length === 0) {
                        return skip('update_field', `Nada que cambiar: ${storeSkipped.join('; ')}`);
                    }
                }
                await this.recordsRepo.updateData(tx, ctx.tenantId, ctx.listId, ctx.recordId, merged);
                // Una automatización que cambia un producto sincronizado también
                // lo cambia en la tienda. Si la corrida revierte, el envío lee el
                // valor vigente y manda lo que la tienda ya tenía (inocuo).
                this.changes?.emit({ tenantId: ctx.tenantId, listId: ctx.listId, recordId: ctx.recordId, before: ctx.data, after: merged });
                ctx.data = merged; // acciones posteriores ven el valor actualizado.
                const storeNote = storeSkipped.length > 0 ? ` Omitidos: ${storeSkipped.join('; ')}.` : '';
                return ok('update_field', `Actualizó ${Object.keys(applied).length} campo(s).${storeNote}`, { values: applied });
            }
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
            case 'create_record': {
                // Los slugs de `values` se resuelven contra la lista DESTINO
                // (no la del trigger — pueden ser listas distintas), cada valor
                // pasa por el validador compartido del campo (coerción de
                // números/fechas/selects; los inválidos se saltan con nota), y
                // los campos relation se sincronizan en la tabla `relations`
                // con targets verificados vivos en su lista destino.
                const targetList = Number(cfg.target_list ?? cfg.list_id ?? ctx.listId) || ctx.listId;
                // SEC-31 (v0.1.228): la lista destino tiene que ser DE ESTA
                // empresa. El id viene de la config (editable a mano o por la
                // API) y `records.list_id` referencia la tabla compartida sin
                // mirar el tenant: con el id de una lista ajena se creaba una
                // fila huérfana colgando de ella.
                const [target] = await tx
                    .select({ settings: lists.settings })
                    .from(lists)
                    .where(and(eq(lists.tenantId, ctx.tenantId), eq(lists.id, targetList)))
                    .limit(1);
                if (!target) {
                    return fail('create_record', `La lista destino (#${targetList}) no existe en esta empresa.`);
                }
                // Una lista de tienda no admite altas: sus registros nacen en WooCommerce.
                if (readStoreListMarker(target.settings)) {
                    return skip('create_record', 'La lista destino está sincronizada con una tienda: los registros se crean en WooCommerce.');
                }
                // El límite de registros del plan vale también para lo que crea
                // una automatización (si no, sería la forma de saltearlo).
                if (this.billing) {
                    try {
                        await this.billing.assertCanCreateRecords(ctx.tenantId, 1);
                    } catch (err) {
                        return fail('create_record', err instanceof Error ? err.message : 'Límite de registros del plan alcanzado.');
                    }
                }
                const rawValues = (cfg.values as Record<string, unknown>) ?? {};
                const targetFields = await this.fields.listByList(tx, ctx.tenantId, targetList);
                const byKey = new Map(targetFields.map((f) => [jsonbKeyForField(f.id), f]));
                const bySlug = new Map(targetFields.map((f) => [f.slug, f]));

                const data: Record<string, unknown> = {};
                const relationValues: Array<{ fieldId: number; targetListId: number; ids: number[] }> = [];
                const skipped: string[] = [];
                for (const [k, v] of Object.entries(rawValues)) {
                    const field = /^f\d+$/.test(k) ? byKey.get(k) : bySlug.get(k);
                    if (!field) {
                        skipped.push(`${k} (campo inexistente en la lista destino)`);
                        continue;
                    }
                    if (field.type === 'computed' || field.type === 'lookup' || field.type === 'rollup') {
                        skipped.push(`${k} (${field.type} es solo lectura)`);
                        continue;
                    }
                    const resolved = typeof v === 'string' ? merge(v) : v;
                    if (field.type === 'relation') {
                        const targetListId = Number(
                            (field.config as { target_list_id?: unknown }).target_list_id ?? 0,
                        );
                        const ids = parseRelationIds(resolved);
                        if (targetListId <= 0 || ids.length === 0) {
                            skipped.push(`${k} (relación sin destino o sin IDs)`);
                            continue;
                        }
                        relationValues.push({ fieldId: field.id, targetListId, ids });
                        continue;
                    }
                    const result = validateFieldValue(
                        { type: field.type as FieldValueSpec['type'], config: field.config as Record<string, unknown>, is_required: false },
                        resolved,
                    );
                    if (!result.ok) {
                        skipped.push(`${k} (${result.error})`);
                        continue;
                    }
                    if (result.value !== null) data[jsonbKeyForField(field.id)] = result.value;
                }

                const row = await this.recordsRepo.insert(tx, {
                    tenantId: ctx.tenantId,
                    listId: targetList,
                    data,
                    createdBy: SYSTEM_USER,
                });
                for (const rel of relationValues) {
                    const alive = await this.relationsRepo.existingInList(
                        tx,
                        ctx.tenantId,
                        rel.targetListId,
                        rel.ids,
                    );
                    const valid = rel.ids.filter((id) => alive.has(id));
                    if (valid.length > 0) {
                        await this.relationsRepo.sync(tx, ctx.tenantId, rel.fieldId, row.id, valid);
                    }
                }
                const note = skipped.length > 0 ? ` Omitidos: ${skipped.join('; ')}.` : '';
                return ok('create_record', `Creó registro #${row.id} en lista ${targetList}.${note}`, { record_id: row.id });
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
                            `La conexión #${connectionId} ya no existe: revisá la acción en el editor.`,
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
                });
                return ok('call_webhook', `${req.method} ${req.url} → ${res.status}`, {
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
                        `La conexión #${connId} ya no existe: revisá la acción en el editor.`,
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
                // Volver a expandir acá re-interpretaría como plantilla el
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
                });
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
                if (!Number.isInteger(templateId) || templateId <= 0) return skip('generate_pdf', 'Elegí la plantilla del documento.');
                const doc = await this.pdfFor(tx, ctx, templateId, typeof cfg.filename === 'string' ? merge(cfg.filename) : '');
                const kb = Math.max(1, Math.round(doc.buffer.length / 1024));
                ctx.pdf = { nombre: doc.filename, link: '', kb, numero: doc.number ?? '' };
                const saveSlug = typeof cfg.save_field === 'string' ? cfg.save_field : '';
                if (!saveSlug) {
                    return ok('generate_pdf', `Generó «${doc.filename}»${doc.number ? `, N.º ${doc.number}` : ''} (${kb} KB).`, { filename: doc.filename, bytes: doc.buffer.length });
                }
                const field = ctx.fieldsBySlug.get(saveSlug);
                const key = ctx.slugToKey.get(saveSlug);
                if (!field || !key || field.type !== 'file') {
                    throw new Error(`«${saveSlug}» no es un campo Archivo de la lista: elegí dónde guardar el PDF.`);
                }
                const saved = await this.documents.storePdf(ctx.tenantId, SYSTEM_USER, doc.filename, doc.buffer).catch((err: unknown) => {
                    throw new Error(`No se pudo guardar el PDF: ${err instanceof Error ? err.message : String(err)}`);
                });
                const prev = ctx.data[key];
                const prevIds = (Array.isArray(prev) ? prev : prev === null || prev === undefined ? [] : [prev])
                    .map(Number)
                    .filter((n) => Number.isInteger(n) && n > 0);
                const merged = { ...ctx.data, [key]: cfg.save_mode === 'replace' ? [saved.id] : [...prevIds, saved.id] };
                await this.recordsRepo.updateData(tx, ctx.tenantId, ctx.listId, ctx.recordId, merged);
                this.changes?.emit({ tenantId: ctx.tenantId, listId: ctx.listId, recordId: ctx.recordId, before: ctx.data, after: merged });
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
                const to = limitRecipients(merge(cfg.to));
                if (!to) return skip('send_email', 'Destinatario vacío o inválido.');
                const cc = cfg.cc ? limitRecipients(merge(cfg.cc)) : undefined;
                const bcc = cfg.bcc ? limitRecipients(merge(cfg.bcc)) : undefined;
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
                token.startsWith('before.') || token.startsWith('pago.') || token.startsWith('payload.') || token.startsWith('pdf.')
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
                throw new Error(`Los PDF adjuntos superan ${MAIL_MAX_ATTACHMENT_BYTES / 1024 / 1024} MB: achicalos o mandá menos.`);
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
function fail(action: string, message: string): ActionLogEntry {
    return { action, status: 'failed', message, details: {} };
}

function skip(action: string, message: string): ActionLogEntry {
    return { action, status: 'skipped', message, details: {} };
}

/** changed_fields puede venir como array de slugs o (field_changed) como `field`. */
function normalizeChangedFields(cfg: Record<string, unknown>): string[] {
    const cf = cfg.changed_fields;
    if (Array.isArray(cf)) return cf.map((x) => String(x)).filter(Boolean);
    if (typeof cfg.field === 'string' && cfg.field !== '') return [cfg.field];
    return [];
}

/**
 * Normaliza el valor de un campo relation en create_record a IDs de record:
 * acepta número, string numérico (típico de un merge tag `{{record.id}}`),
 * lista separada por comas y arrays mixtos. IDs inválidos se descartan.
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

/**
 * Resuelve el field_id del campo fecha del due_date_reached (por id o slug).
 * Acepta `due_field` — la clave que escribe el DueDateConfig de la UI; sin
 * este alias, una automatización configurada desde la interfaz jamás
 * resolvía el campo y el trigger no disparaba nunca.
 */
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
