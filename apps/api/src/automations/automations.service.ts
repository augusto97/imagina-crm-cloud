import { randomBytes } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
    Automation,
    AutomationRun,
    AutomationRunStatus,
    CreateAutomationInput,
    HookCapture,
    UpdateAutomationInput,
    WebhookTestInput,
    WebhookTestResult,
} from '@imagina-base/shared';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { safeWebhookFetch } from '../common/safe-fetch';
import { DRIZZLE, type Db } from '../db/client';
import { automationHooks, fields, records } from '../db/schema';
import { ListsService } from '../lists/lists.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { AutomationScheduler } from './automation-scheduler.service';
import { applyMergeTags } from './merge-tags';
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
        await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.findById(tx, tenantId, id),
        );
        if (!row) throw notFound(id);
        return toAutomation(row);
    }

    async create(
        tenantId: number,
        listIdOrSlug: string,
        input: CreateAutomationInput,
    ): Promise<Automation> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
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
        await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, id);
            if (!current) throw notFound(id);
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
        await this.lists.get(tenantId, listIdOrSlug);
        const deleted = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.remove(tx, tenantId, id),
        );
        if (!deleted) throw notFound(id);
        await this.scheduler.remove(id);
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
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const sample = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const fieldRows = await tx
                .select({ id: fields.id, slug: fields.slug })
                .from(fields)
                .where(eq(fields.listId, list.id));
            const where = input.record_id
                ? and(
                      eq(records.tenantId, tenantId),
                      eq(records.listId, list.id),
                      eq(records.id, input.record_id),
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
                record: row ?? null,
            };
        });

        const data = (sample.record?.data ?? {}) as Record<string, unknown>;
        const accessor = (token: string): unknown => {
            if (token === 'date.now') return new Date().toISOString().slice(0, 19).replace('T', ' ');
            if (token === 'date.today') return new Date().toISOString().slice(0, 10);
            const key = sample.slugToKey.get(token.replace(/^before\./, ''));
            return key !== undefined ? data[key] : undefined;
        };
        const merge = (raw: unknown): string =>
            applyMergeTags(typeof raw === 'string' ? raw : '', accessor, sample.record?.id ?? null);

        const req = buildWebhookRequest(input.config, merge, {
            recordId: sample.record?.id ?? null,
            listId: list.id,
        });
        const request = {
            url: req.url,
            method: req.method,
            headers: req.headers,
            body: req.body ?? null,
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

    /**
     * v0.1.110 — resuelve un token de webhook entrante (endpoint público).
     * Devuelve tenant/automation o null (el caller responde 404 opaco).
     */
    async resolveHookToken(token: string): Promise<{ tenantId: number; automationId: number } | null> {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
        const [row] = await this.db
            .select({ tenantId: automationHooks.tenantId, automationId: automationHooks.automationId })
            .from(automationHooks)
            .where(eq(automationHooks.token, token))
            .limit(1);
        return row ?? null;
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
