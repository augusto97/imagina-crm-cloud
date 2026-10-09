import {
    BadGatewayException,
    BadRequestException,
    HttpException,
    ServiceUnavailableException,
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
    type OnApplicationShutdown,
    type OnModuleInit,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AI_INPUT_TYPES, aiFieldConfigSchema, type Field, type Role } from '@imagina-base/shared';
import { Queue, Worker } from 'bullmq';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import type Redis from 'ioredis';
import type { Readable } from 'node:stream';
import { AI_CLIENT_FACTORY, defaultClientFactory, type AiClientFactory } from '../ai/assistant.service';
import { AiQuotaService } from '../ai/ai-quota.service';
import { AiSettingsService } from '../ai/ai-settings.service';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { attachments, records, users } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { FilesService } from '../files/files.service';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordChangeHub, type RecordChange } from '../records/record-change-hub';
import { RecordsService } from '../records/records.service';
import { REDIS } from '../redis/redis.module';
import { guardRedis } from '../redis/redis.util';
import { TenantDb } from '../tenancy/tenant-db.service';
import {
    AI_FIELD_MAX_TOKENS,
    aiFieldConfigProblem,
    buildAiFieldPrompt,
    parseAiFieldAnswer,
    type AiFieldInput,
} from './ai-field-prompt';

/** Modelo de los campos en calidad «rápida»: muchas filas, poco texto. */
export const AI_FIELD_FAST_MODEL = 'claude-haiku-4-5';
/** Archivos que se le pasan al modelo por campo, y su tamaño máximo. */
const MAX_FILES = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Registros que encola un «Llenar en todos» de una vez. */
const MAX_FILL = 500;
const QUEUE = 'ai-fields';
/** Un autoguardado escribe varias veces seguidas: se espera un poco antes de llamar al modelo. */
const DEBOUNCE_MS = 4000;

interface AiFieldJob {
    tenantId: number;
    listId: number;
    recordId: number;
    fieldId: number;
}

export interface AiFieldStatus {
    last_error: { message: string; record_id: number; at: string } | null;
    pending_estimate: number;
}

/** Qué campos con IA hay que recalcular ante un cambio. Puro, testeado. */
export function aiFieldsToRun(fields: readonly Field[], change: Pick<RecordChange, 'before' | 'after' | 'kind'>): number[] {
    const out: number[] = [];
    for (const f of fields) {
        if (f.type !== 'ai') continue;
        const cfg = aiFieldConfigSchema.safeParse(f.config ?? {});
        if (!cfg.success || cfg.data.auto === false || aiFieldConfigProblem(cfg.data) !== null) continue;
        const inputs = cfg.data.inputs ?? [];
        const changed = inputs.some((id) => {
            const k = `f${id}`;
            const a = change.after[k];
            if (change.kind === 'created') return !(a === null || a === undefined || a === '' || (Array.isArray(a) && a.length === 0));
            return JSON.stringify(change.before[k] ?? null) !== JSON.stringify(a ?? null);
        });
        if (changed) out.push(f.id);
    }
    return out;
}

/**
 * v0.1.277 (ADR-S41) — Campos con IA. Cuando cambian sus fuentes, un job
 * (BullMQ, con espera para no llamar al modelo en cada tecla del
 * autoguardado) arma el pedido, llama al modelo con la clave de la empresa
 * (o la compartida de la plataforma, contra la cuota del plan) y escribe el
 * valor por un camino que NO vuelve a emitir cambios — si no, un campo con IA
 * que lee otro dispararía una cadena.
 */
@Injectable()
export class AiFieldsService implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(AiFieldsService.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];
    private readonly clientFactory: AiClientFactory;

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly files: FilesService,
        private readonly realtime: RealtimeService,
        private readonly settings: AiSettingsService,
        private readonly quota: AiQuotaService,
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
        @Optional() private readonly changes?: RecordChangeHub,
        @Optional() @Inject(AI_CLIENT_FACTORY) clientFactory?: AiClientFactory,
    ) {
        this.clientFactory = clientFactory ?? defaultClientFactory;
    }

    async onModuleInit(): Promise<void> {
        this.changes?.subscribe((c) => this.onChange(c));
        if (this.env.NODE_ENV === 'test') return;
        try {
            const conn = () => {
                const c = guardRedis(new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }), this.logger, QUEUE);
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue(QUEUE, { connection: conn() });
            this.queue.on('error', (err) => this.logger.warn(`Cola de campos con IA con error: ${err.message}`));
            this.worker = new Worker(
                QUEUE,
                async (job) => {
                    const d = job.data as AiFieldJob;
                    await this.compute(d.tenantId, d.listId, d.recordId, d.fieldId).catch(() => undefined);
                },
                { connection: conn(), concurrency: 2 },
            );
            this.worker.on('error', (err) => this.logger.warn(`Worker de campos con IA con error: ${err.message}`));
        } catch (err) {
            this.logger.warn(`Campos con IA en segundo plano deshabilitados (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }

    async onChange(c: RecordChange): Promise<void> {
        const list = await this.lists.get(c.tenantId, String(c.listId)).catch(() => null);
        if (!list) return;
        const fields = await this.fields.listByListId(c.tenantId, c.listId);
        for (const fieldId of aiFieldsToRun(fields, c)) this.enqueue({ tenantId: c.tenantId, listId: c.listId, recordId: c.recordId, fieldId });
    }

    enqueue(job: AiFieldJob, delay = DEBOUNCE_MS): void {
        if (!this.queue) return;
        this.queue
            .add('compute', job, {
                // Un job pendiente por (registro, campo): los cambios seguidos se juntan.
                jobId: `ai-${job.tenantId}-${job.recordId}-${job.fieldId}`,
                delay,
                removeOnComplete: true,
                removeOnFail: 50,
            })
            .catch((err) => this.logger.warn(`No se pudo encolar el campo con IA ${job.fieldId}: ${String(err)}`));
    }

    /**
     * Calcula UN campo de UN registro y lo guarda. Lanza con un motivo legible
     * (IA desactivada, cuota, configuración incompleta, respuesta inválida);
     * en segundo plano el motivo queda como «último error» del campo.
     */
    async compute(tenantId: number, listId: number, recordId: number, fieldId: number): Promise<string | null> {
        try {
            const value = await this.computeInner(tenantId, listId, recordId, fieldId);
            await this.redis.del(errKey(tenantId, fieldId)).catch(() => undefined);
            return value;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await this.redis
                .set(errKey(tenantId, fieldId), JSON.stringify({ message, record_id: recordId, at: new Date().toISOString() }), 'EX', 7 * 86_400)
                .catch(() => undefined);
            this.logger.warn(`Campo con IA ${fieldId} (registro ${recordId}): ${message}`);
            throw err;
        }
    }

    private async computeInner(tenantId: number, listId: number, recordId: number, fieldId: number): Promise<string | null> {
        const list = await this.lists.get(tenantId, String(listId));
        const fields = await this.fields.listByListId(tenantId, listId);
        const field = fields.find((f) => f.id === fieldId && f.type === 'ai');
        if (!field) throw new NotFoundException({ code: 'field_not_found', message: 'El campo con IA ya no existe.' });
        const cfg = aiFieldConfigSchema.parse(field.config ?? {});
        const problem = aiFieldConfigProblem(cfg);
        if (problem) throw new BadRequestException({ code: 'ai_field_incomplete', message: problem });

        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ data: records.data })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), eq(records.id, recordId), isNull(records.deletedAt)))
                .limit(1),
        );
        if (!row) throw new NotFoundException({ code: 'record_not_found', message: 'El registro ya no existe.' });
        const data = (row.data ?? {}) as Record<string, unknown>;

        const sources = (cfg.inputs ?? [])
            .map((id) => fields.find((f) => f.id === id))
            .filter((f): f is Field => !!f && AI_INPUT_TYPES.includes(f.type));
        const names = await this.userNames(sources, data);
        const inputs: AiFieldInput[] = [];
        const blocks: Anthropic.ContentBlockParam[] = [];
        for (const f of sources) {
            const v = data[`f${f.id}`];
            if (f.type === 'file') {
                const docs = await this.fileBlocks(tenantId, v);
                blocks.push(...docs.blocks);
                inputs.push({ label: f.label, text: docs.names.join(', ') });
            } else {
                inputs.push({ label: f.label, text: inputText(f, v, names) });
            }
        }
        if (blocks.length === 0 && inputs.every((i) => i.text.trim() === '')) {
            // Sin nada que leer, el campo queda vacío (no se gasta un pedido).
            await this.write(tenantId, listId, recordId, fieldId, null);
            return null;
        }

        const access = await this.settings.resolve(tenantId);
        if (access.source === 'platform') await this.quota.assertWithinQuota(tenantId);
        const { system, user } = buildAiFieldPrompt(cfg, { fieldLabel: field.label, listName: list.name, inputs, attachments: blocks.length });
        const client = this.clientFactory(access.apiKey);
        const res = await client.messages.create({
            model: cfg.quality === 'best' ? access.model : AI_FIELD_FAST_MODEL,
            max_tokens: AI_FIELD_MAX_TOKENS[cfg.length ?? 'short'],
            system,
            messages: [{ role: 'user', content: [...blocks, { type: 'text', text: user }] }],
        });
        if (access.source === 'platform') {
            await this.quota.record(tenantId, {
                input: res.usage.input_tokens + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0),
                output: res.usage.output_tokens,
            });
        }
        const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
        const parsed = parseAiFieldAnswer(cfg, text);
        if (parsed.error) throw new BadRequestException({ code: 'ai_field_bad_answer', message: parsed.error });
        await this.write(tenantId, listId, recordId, fieldId, parsed.value);
        return parsed.value;
    }

    /** Escribe el valor SIN pasar por el hub de cambios (sin cadenas) y avisa por realtime. */
    private async write(tenantId: number, listId: number, recordId: number, fieldId: number, value: string | null): Promise<void> {
        const key = `f${fieldId}`;
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(records)
                .set({
                    data:
                        value === null
                            ? sql`coalesce(${records.data}, '{}'::jsonb) - ${key}`
                            : sql`jsonb_set(coalesce(${records.data}, '{}'::jsonb), ${`{${key}}`}::text[], to_jsonb(${value}::text))`,
                    updatedAt: new Date(),
                })
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), eq(records.id, recordId))),
        );
        this.realtime.records(tenantId, listId);
    }

    private async fileBlocks(tenantId: number, value: unknown): Promise<{ blocks: Anthropic.ContentBlockParam[]; names: string[] }> {
        const ids = (Array.isArray(value) ? value : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, MAX_FILES);
        if (ids.length === 0) return { blocks: [], names: [] };
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: attachments.id, filename: attachments.filename, mime: attachments.mime, size: attachments.sizeBytes, key: attachments.storageKey, conn: attachments.storageConnectionId })
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), inArray(attachments.id, ids))),
        );
        const blocks: Anthropic.ContentBlockParam[] = [];
        const names: string[] = [];
        for (const r of rows) {
            names.push(r.filename);
            const kind = r.mime === 'application/pdf' ? 'pdf' : /^image\/(png|jpeg|gif|webp)$/.test(r.mime) ? 'image' : null;
            if (!kind || r.size > MAX_FILE_BYTES) continue;
            const stream = await this.files.readStream(tenantId, { storageKey: r.key, storageConnectionId: r.conn }).catch(() => null);
            const bytes = stream ? await readAll(stream, MAX_FILE_BYTES) : null;
            if (!bytes) continue;
            const data = bytes.toString('base64');
            blocks.push(
                kind === 'pdf'
                    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
                    : { type: 'image', source: { type: 'base64', media_type: r.mime as 'image/png', data } },
            );
        }
        return { blocks, names };
    }

    private async userNames(fields: Field[], data: Record<string, unknown>): Promise<Map<number, string>> {
        const ids = fields.filter((f) => f.type === 'user').map((f) => Number(data[`f${f.id}`])).filter((n) => Number.isInteger(n) && n > 0);
        if (ids.length === 0) return new Map();
        const rows = await this.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
        return new Map(rows.map((r) => [r.id, r.name]));
    }

    // ─────────────────────────── Endpoints ───────────────────────────

    /** «Recalcular» desde la ficha: espera la respuesta (con el ACL de quien lo pide). */
    async runNow(tenantId: number, actor: { userId: number; role: Role }, listIdOrSlug: string, recordId: number, fieldId: number): Promise<{ value: string | null }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        await this.records.get(tenantId, actor, String(list.id), recordId);
        try {
            return { value: await this.compute(tenantId, list.id, recordId, fieldId) };
        } catch (err) {
            throw toHttpError(err);
        }
    }

    /**
     * «Llenar en todos los registros»: encola los registros de la lista (los
     * vacíos, o todos). Con la clave compartida se corta en lo que queda de
     * la cuota del mes — encolar más sería prometer lo que va a fallar.
     */
    async fill(tenantId: number, listIdOrSlug: string, fieldId: number, onlyEmpty: boolean): Promise<{ queued: number; capped: boolean; reason?: string }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const field = (await this.fields.listByListId(tenantId, list.id)).find((f) => f.id === fieldId && f.type === 'ai');
        if (!field) throw new NotFoundException({ code: 'field_not_found', message: 'Campo con IA no encontrado' });
        const problem = aiFieldConfigProblem(aiFieldConfigSchema.parse(field.config ?? {}));
        if (problem) throw new BadRequestException({ code: 'ai_field_incomplete', message: problem });
        const access = await this.settings.resolve(tenantId).catch((err: Error & { code?: string }) => {
            throw new ForbiddenException({ code: err.code ?? 'ai_unavailable', message: err.message });
        });
        let cap = MAX_FILL;
        let reason: string | undefined;
        if (access.source === 'platform') {
            const limit = await this.quota.limitFor(tenantId);
            if (limit !== null) {
                const left = Math.max(0, limit - (await this.quota.usedThisMonth(tenantId)));
                if (left < cap) {
                    cap = left;
                    reason = `Quedan ${left} pedidos de IA este mes en el plan.`;
                }
            }
        }
        const key = `f${fieldId}`;
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: records.id })
                .from(records)
                .where(
                    and(
                        eq(records.tenantId, tenantId),
                        eq(records.listId, list.id),
                        isNull(records.deletedAt),
                        onlyEmpty ? sql`coalesce(${records.data}->>${key}, '') = ''` : undefined,
                    ),
                )
                .orderBy(records.id)
                .limit(cap + 1),
        );
        const take = rows.slice(0, cap);
        take.forEach((r, i) => this.enqueue({ tenantId, listId: list.id, recordId: r.id, fieldId }, 500 + i * 250));
        return { queued: take.length, capped: rows.length > cap, reason };
    }

    async status(tenantId: number, fieldId: number): Promise<AiFieldStatus> {
        const raw = await this.redis.get(errKey(tenantId, fieldId)).catch(() => null);
        let last: AiFieldStatus['last_error'] = null;
        try {
            last = raw ? (JSON.parse(raw) as AiFieldStatus['last_error']) : null;
        } catch {
            last = null;
        }
        const pending = this.queue ? await this.queue.getDelayedCount().catch(() => 0) : 0;
        return { last_error: last, pending_estimate: pending };
    }
}

/** Los motivos de la IA (desactivada, cuota, proveedor) como respuesta HTTP legible. */
function toHttpError(err: unknown): unknown {
    if (err instanceof HttpException) return err;
    const e = err as { code?: string; status?: number; message?: string };
    if (e.code === 'ai_unavailable') return new ForbiddenException({ code: e.code, message: e.message });
    if (e.code === 'ai_quota_reached') return new HttpException({ code: e.code, message: e.message }, 429);
    if (e.status === 401) return new BadGatewayException({ code: 'ai_bad_key', message: 'El proveedor de IA rechazó la clave. Revísala en Ajustes → Asistente IA.' });
    if (e.status === 429) return new HttpException({ code: 'ai_rate_limited', message: 'El proveedor de IA está limitando los pedidos. Prueba en un rato.' }, 429);
    if (e.status === 529 || e.status === 503) return new ServiceUnavailableException({ code: 'ai_overloaded', message: 'El proveedor de IA está saturado. Prueba en un rato.' });
    return new BadGatewayException({ code: 'ai_error', message: `La IA no respondió: ${e.message ?? String(err)}` });
}

function errKey(tenantId: number, fieldId: number): string {
    return `aifield:err:${tenantId}:${fieldId}`;
}

/** El valor de una fuente, como lo lee una persona. */
export function inputText(field: Pick<Field, 'type' | 'config'>, value: unknown, userNames: Map<number, string>): string {
    if (value === null || value === undefined || value === '') return '';
    const opts = ((field.config as { options?: Array<{ value: string; label?: string }> } | undefined)?.options ?? []);
    const label = (v: unknown) => opts.find((o) => o.value === v)?.label || String(v);
    switch (field.type) {
        case 'select':
            return label(value);
        case 'multi_select':
            return Array.isArray(value) ? value.map(label).join(', ') : String(value);
        case 'checkbox':
            return value === true ? 'Sí' : 'No';
        case 'user':
            return userNames.get(Number(value)) ?? '';
        default:
            return typeof value === 'object' ? JSON.stringify(value) : String(value).slice(0, 20_000);
    }
}

async function readAll(stream: Readable, max: number): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += b.length;
        if (size > max) {
            stream.destroy();
            return null;
        }
        chunks.push(b);
    }
    return Buffer.concat(chunks);
}
