import { randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import type {
    Automation,
    AutomationRun,
    AutomationRunStatus,
    CreateAutomationInput,
    HookCapture,
    UpdateAutomationInput,
    WebhookTestInput,
    WebhookTestResult,
    EmailTestInput,
    EmailTestResult,
} from '@imagina-base/shared';
import {
    emailDesignSchema,
    FALLBACK_TIME_ZONE,
    isEffectivelyReadOnly,
    parseEmailDesign,
    zonedToday,
    type BillingStatus,
} from '@imagina-base/shared';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { safeWebhookFetch } from '../common/safe-fetch';
import { maskHeaders, redactValues } from '../connectors/connection-parts';
import { ConnectorsService, type ResolvedAction } from '../connectors/connectors.service';
import { DRIZZLE, type Db } from '../db/client';
import { automationHooks, automations, fields, records, tenants, users } from '../db/schema';
import { ListsService } from '../lists/lists.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { AutomationScheduler } from './automation-scheduler.service';
import { EmailComposer, type ComposedEmail } from './email-composer';
import { applyMergeTags, escapeHtml, labelResolverFor } from './merge-tags';
import { DocumentsService } from '../documents/documents.service';
import { MailService } from '../mail/mail.service';
import type { MailAttachment } from '../mail/mail.types';
import { compileConnectorCall } from '../connectors/connector-actions';
import {
    buildIntegrationRequest,
    checkIntegrationResponse,
    compileIntegrationValues,
} from '../connectors/integration-calls';
import { buildWebhookRequest } from './webhook-request';
import {
    AutomationsRepository,
    type AutomationRow,
    type AutomationRunRow,
} from './automations.repository';

/**
 * Subconjunto de ioredis que usan las capturas de webhook — tipado angosto
 * para poder pasar un fake en memoria en los tests sin levantar Redis.
 */
export interface HookCaptureStore {
    lpush(key: string, value: string): Promise<number>;
    ltrim(key: string, start: number, stop: number): Promise<unknown>;
    expire(key: string, seconds: number): Promise<unknown>;
    lrange(key: string, start: number, stop: number): Promise<string[]>;
}

/** Cuántas capturas de prueba se conservan por webhook y por cuánto tiempo. */
const HOOK_CAPTURES_MAX = 5;
const HOOK_CAPTURES_TTL_S = 24 * 60 * 60;

@Injectable()
export class AutomationsService {
    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly repo: AutomationsRepository,
        private readonly lists: ListsService,
        private readonly scheduler: AutomationScheduler,
        @Inject(REDIS) private readonly captures: HookCaptureStore,
        private readonly connectors: ConnectorsService,
        // v0.1.263 — para que el probador resuelva {{date.today}} como el motor.
        @Optional() private readonly timeZones?: TenantTimeZones,
        // v0.1.265 — «Enviar prueba» del editor de correos.
        @Optional() private readonly mail?: MailService,
        // v0.1.266 — los PDF adjuntos de la prueba.
        @Optional() private readonly documents?: DocumentsService,
    ) {}

    /**
     * v0.1.110 — Webhook entrante: asegura el token público del trigger
     * `incoming_webhook`. Si el trigger_config no trae `webhook_token`
     * (alta nueva o "regenerar URL"), se genera uno opaco y se persiste en
     * el config; el mapeo token → automatización vive en `automation_hooks`
     * (sin RLS, patrón public_lists) y cualquier token viejo se revoca.
     * Con otro trigger, se elimina el mapeo (la URL deja de existir).
     */
    private async syncHook(tenantId: number, row: AutomationRow): Promise<AutomationRow> {
        if (row.triggerType !== 'incoming_webhook') {
            await this.db.delete(automationHooks).where(eq(automationHooks.automationId, row.id));
            return row;
        }
        const cfg = { ...(row.triggerConfig ?? {}) } as Record<string, unknown>;
        let token = typeof cfg.webhook_token === 'string' ? cfg.webhook_token : '';
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
            token = randomBytes(24).toString('base64url');
            cfg.webhook_token = token;
            const updated = await this.tenantDb.withTenant(tenantId, (tx) =>
                this.repo.update(tx, tenantId, row.id, { triggerConfig: cfg as AutomationRow['triggerConfig'] }),
            );
            if (updated) row = updated;
        }
        // Primero revocar tokens viejos: el índice único por automation_id
        // haría que el insert del token NUEVO se descartara en silencio.
        await this.db
            .delete(automationHooks)
            .where(and(eq(automationHooks.automationId, row.id), ne(automationHooks.token, token)));
        await this.db
            .insert(automationHooks)
            .values({ token, tenantId, automationId: row.id })
            .onConflictDoNothing();
        return row;
    }

    async list(tenantId: number, listIdOrSlug: string): Promise<Automation[]> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listByList(tx, tenantId, list.id),
        );
        return rows.map(toAutomation);
    }

    async get(tenantId: number, listIdOrSlug: string, id: number): Promise<Automation> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.findById(tx, tenantId, id),
        );
        // SEC-31 (v0.1.228): la automatización tiene que ser de ESTA lista
        // (la ruta la nombra); antes cualquier id de la empresa servía.
        if (!row || row.listId !== list.id) throw notFound(id);
        return toAutomation(row);
    }

    /**
     * v0.1.221 — Re-registra al arrancar los horarios de TODAS las
     * automatizaciones temporales activas (cross-tenant, por la conexión
     * base). Idempotente. Hace falta porque hasta v0.1.220 una automatización
     * programada guardada desde el editor nunca quedaba registrada (ver
     * `AutomationScheduler.sync`): sin esto seguirían muertas hasta que
     * alguien las volviera a guardar.
     */
    async resyncSchedules(): Promise<number> {
        const rows = await this.db
            .select()
            .from(automations)
            .where(and(eq(automations.isActive, true), inArray(automations.triggerType, ['scheduled', 'due_date_reached'])));
        for (const row of rows) await this.scheduler.sync(row.tenantId, row);
        return rows.length;
    }

    /**
     * v0.1.263 — La empresa cambió su zona horaria: re-registra sus horarios
     * (los que no tienen zona propia pasan a correr en la nueva).
     */
    async resyncTenantSchedules(tenantId: number): Promise<number> {
        const rows = await this.db
            .select()
            .from(automations)
            .where(and(eq(automations.tenantId, tenantId), eq(automations.isActive, true), eq(automations.triggerType, 'scheduled')));
        for (const row of rows) await this.scheduler.sync(row.tenantId, row);
        return rows.length;
    }

    /**
     * v0.1.221 — Ejecutar AHORA una automatización programada (para probar,
     * p. ej., una edición en lote semanal sin esperar al lunes). Corre por la
     * cola igual que el horario: el resultado aparece en su historial.
     */
    async runNow(tenantId: number, listIdOrSlug: string, id: number): Promise<{ queued: true }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, (tx) => this.repo.findById(tx, tenantId, id));
        if (!row || row.listId !== list.id) throw notFound(id);
        if (row.triggerType !== 'scheduled') {
            throw new BadRequestException({
                code: 'automation_not_scheduled',
                message: 'Sólo una automatización «En un horario» se puede ejecutar a mano.',
                data: { status: 400 },
            });
        }
        if (!(await this.scheduler.runNow(tenantId, id))) {
            throw new ServiceUnavailableException({
                code: 'queue_unavailable',
                message: 'La cola de tareas no está disponible: probá de nuevo en un rato.',
                data: { status: 503 },
            });
        }
        return { queued: true };
    }

    /** v0.1.265 — email de una cuenta (la prueba del correo sale a su casilla). */
    async userEmail(userId: number): Promise<string> {
        const [row] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
        if (!row) throw new NotFoundException({ code: 'user_not_found', message: 'Usuario no encontrado', data: { status: 404 } });
        return row.email;
    }

    async create(
        tenantId: number,
        listIdOrSlug: string,
        input: CreateAutomationInput,
    ): Promise<Automation> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        normalizeEmailDesigns(input.actions);
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.insert(tx, {
                tenantId,
                listId: list.id,
                name: input.name,
                description: input.description ?? null,
                triggerType: input.trigger_type,
                triggerConfig: input.trigger_config ?? {},
                actions: input.actions,
                isActive: input.is_active ?? true,
            }),
        );
        await this.scheduler.sync(tenantId, row);
        return toAutomation(await this.syncHook(tenantId, row));
    }

    async update(
        tenantId: number,
        listIdOrSlug: string,
        id: number,
        patch: UpdateAutomationInput,
    ): Promise<Automation> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        if (patch.actions !== undefined) normalizeEmailDesigns(patch.actions);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, id);
            if (!current || current.listId !== list.id) throw notFound(id);
            const changes: Partial<typeof import('../db/schema').automations.$inferInsert> = {};
            if (patch.name !== undefined) changes.name = patch.name;
            if (patch.description !== undefined) changes.description = patch.description ?? null;
            if (patch.trigger_type !== undefined) changes.triggerType = patch.trigger_type;
            if (patch.trigger_config !== undefined) changes.triggerConfig = patch.trigger_config;
            if (patch.actions !== undefined) changes.actions = patch.actions;
            if (patch.is_active !== undefined) changes.isActive = patch.is_active;
            const updated = await this.repo.update(tx, tenantId, id, changes);
            if (!updated) throw notFound(id);
            return updated;
        });
        await this.scheduler.sync(tenantId, row);
        return toAutomation(await this.syncHook(tenantId, row));
    }

    async remove(tenantId: number, listIdOrSlug: string, id: number): Promise<void> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const deleted = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, id);
            if (!current || current.listId !== list.id) return false;
            return this.repo.remove(tx, tenantId, id);
        });
        if (!deleted) throw notFound(id);
        await this.scheduler.remove(id);
    }

    /**
     * Contexto de PRUEBA de una acción: un registro real de la lista (el
     * indicado o el último) y las mismas funciones de variables que usa el
     * motor (`|label`, `{{date.today}}` en la zona de la empresa). Lo usan el
     * probador de webhooks y el de correos: lo que se prueba es lo que sale.
     */
    private async sampleContext(tenantId: number, listIdOrSlug: string, recordId?: number) {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const sample = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const fieldRows = await tx
                .select({ id: fields.id, slug: fields.slug, label: fields.label, type: fields.type, config: fields.config })
                .from(fields)
                .where(eq(fields.listId, list.id));
            const where = recordId
                ? and(
                      eq(records.tenantId, tenantId),
                      eq(records.listId, list.id),
                      eq(records.id, recordId),
                      isNull(records.deletedAt),
                  )
                : and(eq(records.tenantId, tenantId), eq(records.listId, list.id), isNull(records.deletedAt));
            const [row] = await tx
                .select({ id: records.id, data: records.data })
                .from(records)
                .where(where)
                .orderBy(desc(records.id))
                .limit(1);
            return {
                slugToKey: new Map(fieldRows.map((f) => [f.slug, `f${f.id}`])),
                fieldsBySlug: new Map(
                    fieldRows.map((f) => [f.slug, { type: f.type, config: f.config, label: f.label }]),
                ),
                record: row ?? null,
            };
        });

        const data = (sample.record?.data ?? {}) as Record<string, unknown>;
        const tz = this.timeZones ? await this.timeZones.orUtc(tenantId) : FALLBACK_TIME_ZONE;
        const accessor = (token: string): unknown => {
            if (token === 'date.now') return new Date().toISOString().slice(0, 19).replace('T', ' ');
            if (token === 'date.today') return zonedToday(tz);
            const key = sample.slugToKey.get(token.replace(/^before\./, ''));
            return key !== undefined ? data[key] : undefined;
        };
        // v0.1.178 — el probador resuelve `|label` igual que el motor: lo que
        // se prueba es lo que después sale.
        const merge = (raw: unknown): string =>
            applyMergeTags(
                typeof raw === 'string' ? raw : '',
                accessor,
                sample.record?.id ?? null,
                undefined,
                labelResolverFor(sample.fieldsBySlug),
            );
        const mergeHtml = (raw: unknown): string =>
            applyMergeTags(
                typeof raw === 'string' ? raw : '',
                accessor,
                sample.record?.id ?? null,
                escapeHtml,
                labelResolverFor(sample.fieldsBySlug),
            );
        return { ...sample, list, accessor, merge, mergeHtml, timeZone: tz };
    }

    /**
     * v0.1.265 — Probador de correos (ADR-S34). Arma el correo con el MISMO
     * compositor del motor contra un registro real y, si se pide, lo manda a
     * la casilla de QUIEN prueba (nunca a otra: la prueba no es un canal para
     * mandar correos arbitrarios). Sin `send` sólo devuelve el HTML resuelto
     * — la vista «con datos de un registro» del editor.
     */
    async testEmail(
        tenantId: number,
        listIdOrSlug: string,
        input: EmailTestInput,
        user: { id: number; email: string },
    ): Promise<EmailTestResult> {
        const sample = await this.sampleContext(tenantId, listIdOrSlug, input.record_id);
        const cfg = input.config;
        let composed: ComposedEmail;
        try {
            composed = await this.tenantDb.withTenant(tenantId, (tx) =>
                new EmailComposer().compose(tx, {
                    tenantId,
                    cfg,
                    merge: sample.merge,
                    mergeHtml: sample.mergeHtml,
                    fieldsBySlug: sample.fieldsBySlug,
                    fieldValue: (slug) => sample.accessor(slug),
                    timeZone: sample.timeZone,
                }),
            );
        } catch (err) {
            return {
                subject: '',
                html: null,
                text: null,
                sample_record_id: sample.record?.id ?? null,
                sent_to: null,
                error: err instanceof Error ? err.message : String(err),
                signature_note: null,
            };
        }
        const base = {
            subject: composed.subject,
            html: composed.html ?? null,
            text: composed.text ?? null,
            sample_record_id: sample.record?.id ?? null,
            signature_note: composed.signatureNote ?? null,
        };
        if (!input.send) return { ...base, sent_to: null, error: null };
        if (!this.mail) return { ...base, sent_to: null, error: 'El correo no está disponible en este servidor.' };
        // v0.1.266 — los PDF que adjunta la acción, armados con el registro de
        // ejemplo (si no hay registro, la prueba sale sin adjuntos y lo dice).
        const attachments: MailAttachment[] = [];
        const pdfIds = Array.isArray(cfg.pdf_templates)
            ? [...new Set((cfg.pdf_templates as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 5)
            : [];
        if (pdfIds.length > 0) {
            if (!this.documents || !sample.record) {
                return { ...base, sent_to: null, error: 'Para probar los PDF adjuntos la lista necesita al menos un registro.' };
            }
            try {
                for (const id of pdfIds) {
                    const doc = await this.tenantDb.withTenant(tenantId, (tx) =>
                        this.documents!.renderTemplateInTx(tx, {
                            tenantId,
                            listId: sample.list.id,
                            recordId: sample.record!.id,
                            templateId: id,
                            actor: { userId: 0, role: 'admin' },
                        }),
                    );
                    attachments.push({ filename: doc.filename, contentType: 'application/pdf', contentBase64: doc.buffer.toString('base64') });
                }
            } catch (err) {
                return { ...base, sent_to: null, error: `No se pudo armar el PDF adjunto: ${err instanceof Error ? err.message : String(err)}` };
            }
        }
        const attachedInfo = attachments.map((a) => ({ filename: a.filename, bytes: Math.round((a.contentBase64.length * 3) / 4) }));
        try {
            await this.mail.sendNow({
                ...(attachments.length > 0 ? { attachments } : {}),
                tenantId,
                to: user.email,
                subject: `[Prueba] ${composed.subject || '(sin asunto)'}`,
                ...(composed.html !== undefined ? { html: composed.html } : {}),
                ...(composed.text !== undefined ? { text: composed.text } : {}),
                from: typeof cfg.from_email === 'string' && cfg.from_email ? sample.merge(cfg.from_email) : undefined,
                fromName: typeof cfg.from_name === 'string' && cfg.from_name ? sample.merge(cfg.from_name) : undefined,
            });
            return { ...base, sent_to: user.email, error: null, ...(attachedInfo.length > 0 ? { attachments: attachedInfo } : {}) };
        } catch (err) {
            return { ...base, sent_to: null, error: err instanceof Error ? err.message : String(err) };
        }
    }

    /**
     * Probador de webhooks salientes (v0.1.155). Arma la petición con el MISMO
     * builder que el motor, resolviendo las variables contra un registro real
     * de la lista (el indicado o el último), la ejecuta con el guard anti-SSRF
     * y devuelve lo enviado + lo respondido.
     *
     * Configurar una API ajena (un gateway de WhatsApp, un CRM externo) era
     * escribir a ciegas y esperar a que saltara un registro para ver si
     * funcionaba; ahora se ve el cuerpo exacto y el error exacto en el acto.
     */
    async testWebhook(
        tenantId: number,
        listIdOrSlug: string,
        input: WebhookTestInput,
    ): Promise<WebhookTestResult> {
        const sample = await this.sampleContext(tenantId, listIdOrSlug, input.record_id);
        const { merge, mergeHtml } = sample;

        // v0.1.196 — el probador resuelve la CONEXIÓN igual que el motor: si
        // la acción usa un conector, lo que se prueba lleva su credencial.
        const connectionId = Number((input.config as Record<string, unknown>).connection_id);
        let connection = null;
        try {
            if (Number.isFinite(connectionId) && connectionId > 0) {
                connection = await this.connectors.resolveParts(tenantId, connectionId);
            }
        } catch (err) {
            return {
                request: { url: '', method: 'POST', headers: {}, body: null },
                response: null,
                error: err instanceof Error ? err.message : String(err),
                sample_record_id: sample.record?.id ?? null,
            };
        }

        // v0.1.198 — si la acción es de un CONECTOR con nombre, se compila
        // igual que en el motor y lo que se prueba es la misma petición.
        let cfg: Record<string, unknown> = input.config;
        let mergeForBuild = merge;
        const actionKey = (input.config as Record<string, unknown>).action_key;
        if (actionKey !== undefined && actionKey !== null && String(actionKey) !== '') {
            const resolved = await this.connectors
                .resolveAction(tenantId, connectionId, actionKey)
                .catch(() => null);
            if (!resolved?.action) {
                return {
                    request: { url: '', method: 'POST', headers: {}, body: null },
                    response: null,
                    error: resolved
                        ? `«${resolved.name}» ya no tiene la acción «${String(actionKey)}».`
                        : `La conexión #${connectionId} ya no existe.`,
                    sample_record_id: sample.record?.id ?? null,
                };
            }
            const rawValues = ((input.config as Record<string, unknown>).values ?? {}) as Record<string, unknown>;
            // v0.1.203 — una app de la galería: la petición la arma el código
            // de esa app, exactamente como en el motor.
            if (resolved.integration) {
                return this.testIntegration(resolved, rawValues, merge, mergeHtml, sample.record?.id ?? null);
            }
            const call = compileConnectorCall(resolved.action, rawValues, merge);
            if (call.missing.length > 0) {
                return {
                    request: { url: '', method: resolved.action.method, headers: {}, body: null },
                    response: null,
                    error: `Falta completar: ${call.missing.join(', ')}.`,
                    sample_record_id: sample.record?.id ?? null,
                };
            }
            cfg = call.cfg;
            // Los valores ya pasaron por merge en el compilador (ver el motor).
            mergeForBuild = (raw: unknown): string => String(raw ?? '');
        }

        const req = buildWebhookRequest(
            cfg,
            mergeForBuild,
            { recordId: sample.record?.id ?? null, listId: sample.list.id },
            connection,
        );
        // Lo que se MUESTRA no puede volver a filtrar la credencial que
        // acabamos de sacar del jsonb: se tapa dondequiera que haya quedado.
        const hide = connection?.redact ?? [];
        const request = {
            url: redactValues(req.url, hide),
            method: req.method,
            headers: connection ? maskHeaders(req.headers) : req.headers,
            body: req.body !== undefined ? redactValues(req.body, hide) : null,
        };
        if (!req.url) {
            return {
                request,
                response: null,
                error: 'Falta la URL del webhook.',
                sample_record_id: sample.record?.id ?? null,
            };
        }
        try {
            const res = await safeWebhookFetch(req.url, {
                method: req.method,
                headers: req.headers,
                body: req.body,
                captureBody: true,
            });
            return {
                request,
                response: { status: res.status, content_type: res.contentType ?? '', body: res.body ?? '' },
                error: null,
                sample_record_id: sample.record?.id ?? null,
            };
        } catch (err) {
            // Un destino bloqueado o caído NO es un 500 de nuestra app: es el
            // resultado de la prueba, y el usuario tiene que poder leerlo.
            return {
                request,
                response: null,
                error: err instanceof Error ? err.message : String(err),
                sample_record_id: sample.record?.id ?? null,
            };
        }
    }

    /** Prueba de una acción de la galería: arma, ejecuta y revisa la respuesta. */
    private async testIntegration(
        resolved: ResolvedAction,
        rawValues: Record<string, unknown>,
        merge: (raw: unknown) => string,
        mergeHtml: (raw: unknown) => string,
        sampleRecordId: number | null,
    ): Promise<WebhookTestResult> {
        const integ = resolved.integration!;
        const action = resolved.action!;
        const hide = [integ.creds.secret, integ.creds.accessToken].filter((v) => v.length >= 4);
        const compiled = compileIntegrationValues(integ.key, action, rawValues, merge, mergeHtml);
        if (compiled.missing.length > 0) {
            return {
                request: { url: '', method: 'POST', headers: {}, body: null },
                response: null,
                error: `Falta completar: ${compiled.missing.join(', ')}.`,
                sample_record_id: sampleRecordId,
            };
        }
        // v0.1.251 — un link de cobro no se "prueba" de verdad: crearía un
        // link real a nombre de la empresa. Se muestra lo que se crearía.
        if (integ.key === 'mercadopago' || integ.key === 'wompi') {
            const v = compiled.values;
            const currency = integ.key === 'wompi' ? 'COP' : (v.currency || 'COP');
            return {
                request: { url: '', method: 'POST', headers: {}, body: null },
                response: null,
                error: `Así se crearía el link: «${v.title ?? ''}» por ${v.amount ?? ''} ${currency}${v.payer_email ? ` para ${v.payer_email}` : ''}. Para no generar un cobro real, la prueba no lo envía: probalo con «Cobrar» en un registro.`,
                sample_record_id: sampleRecordId,
            };
        }
        let req;
        try {
            req = buildIntegrationRequest(integ.key, action.key, compiled, integ.creds);
        } catch (err) {
            return {
                request: { url: '', method: 'POST', headers: {}, body: null },
                response: null,
                error: err instanceof Error ? err.message : String(err),
                sample_record_id: sampleRecordId,
            };
        }
        const request = {
            url: redactValues(req.url, hide),
            method: req.method,
            headers: maskHeaders(req.headers),
            body: req.body !== undefined ? redactValues(req.body, hide) : null,
        };
        try {
            const res = await safeWebhookFetch(req.url, {
                method: req.method,
                headers: req.headers,
                body: req.body,
                captureBody: true,
            });
            return {
                request,
                response: {
                    status: res.status,
                    content_type: res.contentType ?? '',
                    body: redactValues(res.body ?? '', hide),
                },
                error: checkIntegrationResponse(integ.key, res.status, res.body ?? ''),
                sample_record_id: sampleRecordId,
            };
        } catch (err) {
            return {
                request,
                response: null,
                error: redactValues(err instanceof Error ? err.message : String(err), hide),
                sample_record_id: sampleRecordId,
            };
        }
    }

    /**
     * v0.1.110 — resuelve un token de webhook entrante (endpoint público).
     * Devuelve tenant/automation o null (el caller responde 404 opaco).
     */
    async resolveHookToken(
        token: string,
    ): Promise<{ tenantId: number; automationId: number; readOnly: boolean } | null> {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
        const [row] = await this.db
            .select({
                tenantId: automationHooks.tenantId,
                automationId: automationHooks.automationId,
                status: tenants.status,
                archivedAt: tenants.archivedAt,
                subscriptionEndsAt: tenants.subscriptionEndsAt,
                paidUntil: tenants.paidUntil,
            })
            .from(automationHooks)
            .innerJoin(tenants, eq(tenants.id, automationHooks.tenantId))
            .where(eq(automationHooks.token, token))
            .limit(1);
        if (!row) return null;
        // SEC-34: el estado de la empresa viaja con el token, así el endpoint
        // público rechaza ANTES de capturar o encolar nada.
        return {
            tenantId: row.tenantId,
            automationId: row.automationId,
            readOnly: isEffectivelyReadOnly({
                status: row.status as BillingStatus,
                archived_at: row.archivedAt,
                subscription_ends_at: row.subscriptionEndsAt,
                paid_until: row.paidUntil,
            }),
        };
    }

    /**
     * v0.1.111 — guarda una captura de prueba del webhook entrante (los
     * últimos N payloads recibidos, TTL 24h) para que el editor muestre
     * qué llega y ayude a mapear claves → campos. Best-effort: un fallo de
     * Redis no debe romper la recepción del hook (el caller ya la ignora).
     */
    async captureHookPayload(
        tenantId: number,
        automationId: number,
        payload: Record<string, unknown>,
    ): Promise<void> {
        const key = hookCapturesKey(tenantId, automationId);
        const entry = JSON.stringify({ payload, received_at: new Date().toISOString() });
        await this.captures.lpush(key, entry);
        await this.captures.ltrim(key, 0, HOOK_CAPTURES_MAX - 1);
        await this.captures.expire(key, HOOK_CAPTURES_TTL_S);
    }

    /**
     * v0.1.111 — capturas de prueba del webhook de una automatización
     * (más reciente primero). 404 si la automatización no es del tenant.
     */
    async hookCaptures(tenantId: number, automationId: number): Promise<HookCapture[]> {
        const auto = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.findById(tx, tenantId, automationId),
        );
        if (!auto) throw notFound(automationId);
        const raw = await this.captures.lrange(
            hookCapturesKey(tenantId, automationId),
            0,
            HOOK_CAPTURES_MAX - 1,
        );
        const out: HookCapture[] = [];
        for (const item of raw) {
            try {
                const parsed = JSON.parse(item) as HookCapture;
                if (parsed && typeof parsed === 'object' && parsed.payload && typeof parsed.received_at === 'string') {
                    out.push({ payload: parsed.payload, received_at: parsed.received_at });
                }
            } catch {
                // entrada corrupta: se ignora
            }
        }
        return out;
    }

    /** Runs de una automatización por id (sin contexto de lista — la ruta del fork). */
    async runsById(
        tenantId: number,
        automationId: number,
        opts: { cursor?: number; limit?: number },
    ): Promise<{ data: AutomationRun[]; meta: { next_cursor: string | null } }> {
        const auto = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.findById(tx, tenantId, automationId),
        );
        if (!auto) throw notFound(automationId);
        const limit = Math.min(opts.limit ?? 50, 200);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listRuns(tx, tenantId, automationId, { cursor: opts.cursor, limit: limit + 1 }),
        );
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore ? String(page[page.length - 1]!.id) : null;
        return { data: page.map((r) => toRun(r, auto.listId)), meta: { next_cursor: nextCursor } };
    }
}

function toAutomation(row: AutomationRow): Automation {
    return {
        id: row.id,
        list_id: row.listId,
        name: row.name,
        description: row.description ?? null,
        trigger_type: row.triggerType,
        trigger_config: row.triggerConfig ?? {},
        actions: row.actions,
        is_active: row.isActive,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
}

function toRun(row: AutomationRunRow, listId: number): AutomationRun {
    return {
        id: row.id,
        automation_id: row.automationId,
        list_id: listId,
        record_id: row.recordId,
        status: row.status as AutomationRunStatus,
        actions_log: row.actionsLog,
        error: row.error ?? null,
        started_at: row.startedAt ? row.startedAt.toISOString() : null,
        finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
        created_at: row.createdAt.toISOString(),
    };
}

function hookCapturesKey(tenantId: number, automationId: number): string {
    return `hookcap:${tenantId}:${automationId}`;
}

function notFound(id: number): NotFoundException {
    return new NotFoundException({
        code: 'automation_not_found',
        message: `Automatización ${id} no encontrada`,
        data: { status: 404 },
    });
}

/**
 * v0.1.265 (ADR-S34) — Valida y limpia los diseños de correo de las acciones
 * `send_email` (también dentro de un si/sino): un diseño que no valida se
 * rechaza al GUARDAR (400 con el motivo), no al primer envío; los documentos
 * de texto pasan por la whitelist de `sanitizeRichDoc`.
 */
function normalizeEmailDesigns(actions: unknown, depth = 0): void {
    if (!Array.isArray(actions) || depth > 4) return;
    for (const a of actions) {
        if (!a || typeof a !== 'object') continue;
        const spec = a as { type?: unknown; config?: Record<string, unknown> };
        const cfg = spec.config;
        if (!cfg || typeof cfg !== 'object') continue;
        if (spec.type === 'if_else') {
            normalizeEmailDesigns(cfg.then_actions, depth + 1);
            normalizeEmailDesigns(cfg.else_actions, depth + 1);
            continue;
        }
        if (spec.type !== 'send_email' || cfg.body_mode !== 'design') continue;
        const design = parseEmailDesign(cfg.design);
        if (!design) {
            const issue = emailDesignSchema.safeParse(cfg.design);
            const detail = issue.success ? '' : issue.error.issues[0]?.path.join('.') ?? '';
            throw new BadRequestException({
                code: 'invalid_email_design',
                message: `El diseño del correo no es válido${detail ? ` (${detail})` : ''}.`,
                data: { status: 400 },
            });
        }
        cfg.design = design;
    }
}
