import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
    jsonbKeyForField,
    type ActionLogEntry,
    type ActionSpec,
    type AutomationRunStatus,
    type ConditionData,
} from '@imagina-base/shared';
import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { safeWebhookFetch } from '../common/safe-fetch';
import type { Tx } from '../db/client';
import { automationRuns, records } from '../db/schema';
import { FieldsRepository } from '../fields/fields.repository';
import { MailService } from '../mail/mail.service';
import { fieldTypedExpr, type FilterableField } from '../records/query-builder';
import { RecordsRepository } from '../records/records.repository';
import { TenantDb } from '../tenancy/tenant-db.service';
import { AutomationsRepository, type AutomationRow } from './automations.repository';
import type { TriggerEvent } from './automation-dispatcher.service';
import { evaluateCondition } from './condition-evaluator';
import { applyMergeTags } from './merge-tags';

const SYSTEM_USER = 0;
const MAX_IF_ELSE_DEPTH = 5;

/** Qué trigger_types reaccionan a cada evento de record. */
const TRIGGERS_FOR_EVENT: Record<TriggerEvent['trigger'], string[]> = {
    record_created: ['record_created'],
    record_updated: ['record_updated', 'field_changed'],
};

interface RunContext {
    tenantId: number;
    listId: number;
    recordId: number | null;
    data: Record<string, unknown>;
    before?: Record<string, unknown>;
    /** slug → f{id} */
    slugToKey: Map<string, string>;
}

/**
 * Motor de automatizaciones (paridad plugin). Ejecuta el modelo flexible:
 * trigger_config (field_filters + changed_fields) + actions[] con condición por
 * acción + `if_else` recursivo + merge tags. Corre en el worker BullMQ.
 */
@Injectable()
export class AutomationEngine {
    private readonly logger = new Logger(AutomationEngine.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly automations: AutomationsRepository,
        private readonly fields: FieldsRepository,
        private readonly recordsRepo: RecordsRepository,
        private readonly mail: MailService,
    ) {}

    /** Trigger de record (record_created / record_updated). */
    async process(event: TriggerEvent): Promise<void> {
        await this.tenantDb.withTenant(event.tenantId, async (tx) => {
            const triggerTypes = TRIGGERS_FOR_EVENT[event.trigger];
            const autos = await this.automations.activeByTriggers(
                tx,
                event.tenantId,
                event.listId,
                triggerTypes,
            );
            if (autos.length === 0) return;
            const slugToKey = await this.slugMap(tx, event.tenantId, event.listId);
            for (const auto of autos) {
                const ctx: RunContext = {
                    tenantId: event.tenantId,
                    listId: event.listId,
                    recordId: event.recordId,
                    data: event.after,
                    before: event.before,
                    slugToKey,
                };
                if (!this.triggerMatches(auto, ctx)) continue;
                await this.runOne(tx, ctx, auto);
            }
        });
    }

    /** Trigger `scheduled` (cron): corre una automatización sin record. */
    async runScheduled(tenantId: number, automationId: number): Promise<void> {
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const auto = await this.automations.findById(tx, tenantId, automationId);
            if (!auto || !auto.isActive) return;
            const slugToKey = await this.slugMap(tx, tenantId, auto.listId);
            await this.runOne(tx, { tenantId, listId: auto.listId, recordId: null, data: {}, slugToKey }, auto);
        });
    }

    /**
     * Trigger `due_date_reached`: por cada record cuyo campo fecha venció
     * (valor + offset ≤ now) y que la automatización aún no corrió, ejecuta.
     */
    async runDueDate(tenantId: number, automationId: number): Promise<void> {
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const auto = await this.automations.findById(tx, tenantId, automationId);
            if (!auto || !auto.isActive || auto.triggerType !== 'due_date_reached') return;

            const fieldRows = await this.fields.listByList(tx, tenantId, auto.listId);
            const slugToKey = new Map(fieldRows.map((f) => [f.slug, jsonbKeyForField(f.id)]));
            const fieldId = resolveDateFieldId(auto.triggerConfig, fieldRows);
            if (fieldId === null) return;
            const offset = Number(auto.triggerConfig.offset_minutes ?? 0) || 0;
            const field = fieldRows.find((f) => f.id === fieldId);
            if (!field) return;

            const dueExpr = fieldTypedExpr({ id: field.id, type: field.type as FilterableField['type'] });
            const threshold = sql`now() - make_interval(mins => ${offset})`;
            const alreadyRan = sql`exists (select 1 from ${automationRuns} ar
                where ar.tenant_id = ${tenantId} and ar.automation_id = ${auto.id}
                  and ar.record_id = ${records.id} and ar.status <> 'failed')`;

            const due = await tx
                .select({ id: records.id, data: records.data })
                .from(records)
                .where(
                    and(
                        eq(records.tenantId, tenantId),
                        eq(records.listId, auto.listId),
                        isNull(records.deletedAt),
                        lte(dueExpr, threshold),
                        sql`not ${alreadyRan}`,
                    ),
                )
                .limit(500);

            for (const rec of due) {
                await this.runOne(
                    tx,
                    { tenantId, listId: auto.listId, recordId: rec.id, data: rec.data, slugToKey },
                    auto,
                );
            }
        });
    }

    private async slugMap(tx: Tx, tenantId: number, listId: number): Promise<Map<string, string>> {
        const fieldRows = await this.fields.listByList(tx, tenantId, listId);
        return new Map(fieldRows.map((f) => [f.slug, jsonbKeyForField(f.id)]));
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
    private accessor(ctx: RunContext): (slug: string) => unknown {
        return (slug: string) => {
            const key = ctx.slugToKey.get(slug);
            return key ? ctx.data[key] : undefined;
        };
    }

    private async runOne(tx: Tx, ctx: RunContext, auto: AutomationRow): Promise<void> {
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
        const merge = (s: unknown): string => applyMergeTags(typeof s === 'string' ? s : '', fv, ctx.recordId);
        // SEC-08: variante que escapa los valores interpolados para contexto HTML.
        const mergeHtml = (s: unknown): string =>
            applyMergeTags(typeof s === 'string' ? s : '', fv, ctx.recordId, escapeHtml);
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
                await this.recordsRepo.updateData(tx, ctx.tenantId, ctx.listId, ctx.recordId, merged);
                ctx.data = merged; // acciones posteriores ven el valor actualizado.
                return ok('update_field', `Actualizó ${Object.keys(applied).length} campo(s).`, { values: applied });
            }
            case 'create_record': {
                const targetList = Number(cfg.target_list ?? cfg.list_id ?? ctx.listId) || ctx.listId;
                const rawValues = (cfg.values as Record<string, unknown>) ?? {};
                const data: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(rawValues)) {
                    const key = /^f\d+$/.test(k) ? k : (ctx.slugToKey.get(k) ?? k);
                    data[key] = typeof v === 'string' ? merge(v) : v;
                }
                const row = await this.recordsRepo.insert(tx, {
                    tenantId: ctx.tenantId,
                    listId: targetList,
                    data,
                    createdBy: SYSTEM_USER,
                });
                return ok('create_record', `Creó registro #${row.id} en lista ${targetList}.`, { record_id: row.id });
            }
            case 'call_webhook': {
                const url = merge(cfg.url);
                if (!url) return skip('call_webhook', 'URL vacía.');
                const method = String(cfg.method ?? 'POST').toUpperCase();
                const headers: Record<string, string> = { 'content-type': 'application/json' };
                if (cfg.headers && typeof cfg.headers === 'object') {
                    for (const [k, v] of Object.entries(cfg.headers as Record<string, unknown>)) headers[k] = String(v);
                }
                const body = typeof cfg.body_template === 'string' && cfg.body_template.trim() !== ''
                    ? merge(cfg.body_template)
                    : JSON.stringify({ record_id: ctx.recordId, list_id: ctx.listId });
                if (cfg.secret) {
                    headers['x-imagina-signature'] =
                        'sha256=' + createHmac('sha256', String(cfg.secret)).update(body).digest('hex');
                }
                // Guard anti-SSRF (SEC-03): bloquea metadata/loopback/red interna
                // y pinea la IP resuelta (anti DNS-rebinding) + timeout.
                const res = await safeWebhookFetch(url, {
                    method,
                    headers,
                    body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
                });
                return ok('call_webhook', `${method} ${url} → ${res.status}`, { status: res.status });
            }
            case 'send_email': {
                // SEC-08: destinatarios saneados y CAPADOS (to/cc/bcc son
                // merge-tag → una lista con comas podría convertir el SMTP en
                // relay / mail-bomb). El `to` debe resolver a ≥1 email válido.
                const to = limitRecipients(merge(cfg.to));
                if (!to) return skip('send_email', 'Destinatario vacío o inválido.');
                const cc = cfg.cc ? limitRecipients(merge(cfg.cc)) : undefined;
                const bcc = cfg.bcc ? limitRecipients(merge(cfg.bcc)) : undefined;
                const subject = merge(cfg.subject);
                const isHtml = Boolean(cfg.is_html);
                // En HTML, los valores interpolados se escapan (no el template).
                const body = isHtml ? mergeHtml(cfg.body) : merge(cfg.body);
                await this.mail.enqueue({
                    tenantId: ctx.tenantId,
                    to,
                    subject,
                    ...(isHtml ? { html: body } : { text: body }),
                    cc: cc || undefined,
                    bcc: bcc || undefined,
                    from: cfg.from_email ? merge(cfg.from_email) : undefined,
                    fromName: cfg.from_name ? merge(cfg.from_name) : undefined,
                });
                return ok('send_email', `Encolado a ${to}: "${subject}"`, { to, subject });
            }
            default:
                return skip(spec.type, 'Acción no reconocida.');
        }
    }
}

/** Escapa un valor para inyectarlo seguro en HTML (SEC-08). */
function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    );
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

/** Resuelve el field_id del campo fecha del due_date_reached (por id o slug). */
function resolveDateFieldId(
    cfg: Record<string, unknown>,
    fieldRows: Array<{ id: number; slug: string }>,
): number | null {
    if (typeof cfg.field_id === 'number') return cfg.field_id;
    const bySlug =
        typeof cfg.field === 'string' ? cfg.field : typeof cfg.date_field === 'string' ? cfg.date_field : null;
    if (bySlug) {
        const f = fieldRows.find((x) => x.slug === bySlug);
        return f ? f.id : null;
    }
    return null;
}
