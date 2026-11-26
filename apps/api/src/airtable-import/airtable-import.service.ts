import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
    AIRTABLE_API_URL,
    AIRTABLE_MAX_FILE_BYTES,
    AIRTABLE_MAX_RECORDS,
    AIRTABLE_SESSION_TTL_SECONDS,
    AIRTABLE_AUTONUMBER_CONFIG,
    airtableText,
    buildAirtableDraftPlan,
    convertAirtableValue,
    jsonbKeyForField,
    resolveAirtablePlan,
    validateFieldValue,
    type AirtableApplyInput,
    type AirtableAttachment,
    type AirtableAttachmentStats,
    type AirtableCellTarget,
    type AirtableCellWarning,
    type AirtableImportResult,
    type AirtableImportStatus,
    type AirtablePersonSeen,
    type AirtableTableScan,
    type Field,
    type ResolvedAirtableField,
    type ResolvedAirtablePlan,
} from '@imagina-base/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import type { AiToolContext } from '../ai/tools/registry';
import { AiToolError } from '../ai/tools/registry';
import type { ListSpec } from '../ai/tools/structure-tools';
import { StructureTools } from '../ai/tools/structure-tools';
import { AuditService } from '../audit/audit.service';
import { can } from '../authz/can';
import { BillingService } from '../billing/billing.service';
import { safeWebhookFetch } from '../common/safe-fetch';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { ENV, type Env } from '../config/env';
import { autonumberCounters, memberships, records, relations, users } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { defaultsForTimeZone } from '../file-import/file-import-store';
import { FilesService } from '../files/files.service';
import { staffRoleSql } from '../helpdesk/staff-roles';
import { ListGroupsService } from '../lists/list-groups.service';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { REDIS } from '../redis/redis.module';
import { acquireRedisLock, releaseRedisLock, renewRedisLock } from '../redis/redis-lock';
import { tenantIsReadOnly } from '../tenancy/read-only';
import { TenantDb } from '../tenancy/tenant-db.service';
import { readTenantFormat } from '../tenancy/tenant-format';
import { BlueprintService } from '../templates/blueprint.service';
import { AirtableApiError, AirtableClient, type AirtableClientOptions, type AirtableRecord } from './airtable-client';

/** Registros que se insertan de una vez (una página de Airtable). */
const INSERT_CHUNK = 100;
const LINK_CHUNK = 1000;
const MAX_CELL_WARNINGS = 200;
/** Personas distintas que se recuerdan por campo en el recorrido. */
const MAX_PEOPLE_PER_FIELD = 200;
/** El candado de la empresa: una importación de Airtable a la vez. */
const LOCK_TTL_S = 10 * 60;
/** Un estado quieto por más que esto (sin la corrida en este proceso) es una corrida cortada. */
const STALE_MS = 10 * 60 * 1000;

const PEOPLE_TYPES = new Set(['singleCollaborator', 'multipleCollaborators', 'createdBy', 'lastModifiedBy']);

export function airtableSessionKey(tenantId: number, userId: number, id: string): string {
    return `airtable:s:${tenantId}:${userId}:${id}`;
}
/** El token cifrado (sólo mientras dura la importación). */
export function airtableTokenKey(tenantId: number, userId: number, id: string): string {
    return `airtable:t:${tenantId}:${userId}:${id}`;
}
export function airtableLockKey(tenantId: number): string {
    return `airtable:lock:${tenantId}`;
}

interface PendingLink {
    fieldId: number;
    source: number;
    targetTable: string;
    ids: string[];
}

/**
 * v0.1.458 (ADR-S1XX) — «Importar de Airtable»: una base completa en listas.
 *
 *  1. `connect`: se verifica el token (quién es, qué permisos tiene, a qué
 *     bases llega). El token NO va a la base de datos: queda cifrado con
 *     `SECRETS_KEY` en Redis con vencimiento corto y se borra al terminar.
 *  2. `chooseBase`: se lee el esquema y se RECORRE la base en segundo plano
 *     (cuántos registros, cuánto pesan los adjuntos, quiénes son los
 *     colaboradores) para avisar del límite del plan ANTES de crear nada.
 *  3. `apply`: con el plan revisado, se crean las listas con el MISMO motor de
 *     las plantillas, se insertan los registros por páginas (sin disparar
 *     automatizaciones: la primera carga no es «un registro nuevo») y al final
 *     se arman los vínculos con el mapa id de Airtable → id nuevo.
 *
 * Una celda que no entra queda vacía con su aviso: nunca se corta por una
 * fila mala. Una importación de Airtable a la vez por empresa (candado).
 */
@Injectable()
export class AirtableImportService {
    private readonly logger = new Logger(AirtableImportService.name);
    private readonly running = new Map<string, Promise<void>>();
    private readonly cancelled = new Set<string>();

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly groups: ListGroupsService,
        private readonly fields: FieldsService,
        private readonly blueprints: BlueprintService,
        private readonly structure: StructureTools,
        private readonly billing: BillingService,
        private readonly files: FilesService,
        private readonly realtime: RealtimeService,
        private readonly audit: AuditService,
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
    ) {}

    /** La API de Airtable: fija en producción; los tests y el desarrollo apuntan a un doble. */
    apiBase(): string {
        return this.env.NODE_ENV === 'production' || !this.env.AIRTABLE_API_URL ? AIRTABLE_API_URL : this.env.AIRTABLE_API_URL;
    }

    /** Se puede cambiar en los tests (esperas cortas). */
    clientOptions: Partial<AirtableClientOptions> = {};

    private client(token: string, key?: string): AirtableClient {
        return new AirtableClient({
            baseUrl: this.apiBase(),
            token,
            aborted: key ? () => this.cancelled.has(key) : undefined,
            ...this.clientOptions,
        });
    }

    // ── 1. Conectar ───────────────────────────────────────────────────────

    async connect(ctx: AiToolContext, token: string): Promise<AirtableImportStatus> {
        const client = this.client(token);
        const who = await this.call(() => client.whoami());
        const missing = AirtableClient.missingScopes(who.scopes);
        if (missing.length > 0) {
            throw new BadRequestException({
                code: 'airtable_missing_scope',
                message: `Al token le ${missing.length === 1 ? 'falta el permiso' : 'faltan los permisos'} ${missing.map((s) => `«${s}»`).join(' y ')}: agrégale${missing.length === 1 ? 'lo' : 'los'} en Airtable y vuelve a pegarlo.`,
                data: { status: 400, missing },
            });
        }
        const bases = await this.call(() => client.bases());
        if (bases.length === 0) {
            throw new BadRequestException({
                code: 'airtable_no_bases',
                message: 'El token no tiene acceso a ninguna base: en Airtable, agrega la base que quieres importar en «Access» del token.',
                data: { status: 400 },
            });
        }
        const format = await readTenantFormat(this.tenantDb, ctx.tenantId);
        const defaults = defaultsForTimeZone(format.timezone ?? null);
        const id = randomBytes(12).toString('base64url');
        const status: AirtableImportStatus = {
            id,
            stage: 'connected',
            bases,
            base: null,
            tables: [],
            scan: [],
            plan: null,
            limit: null,
            defaults: { currency: defaults.currency, country: defaults.country, time_zone: format.timezone ?? null },
            progress: null,
            result: null,
            error: null,
            updated_at: new Date().toISOString(),
        };
        await this.redis.set(airtableTokenKey(ctx.tenantId, ctx.userId, id), encryptSecret(token, this.env.SECRETS_KEY), 'EX', AIRTABLE_SESSION_TTL_SECONDS);
        await this.save(ctx, status);
        return status;
    }

    // ── 2. Elegir la base y recorrerla ────────────────────────────────────

    async chooseBase(ctx: AiToolContext, id: string, baseId: string): Promise<AirtableImportStatus> {
        const status = await this.load(ctx, id);
        if (status.stage === 'scanning' || status.stage === 'importing') busy('Ya se está leyendo esta base: espera a que termine.');
        if (status.stage === 'done' || status.stage === 'cancelled') gone();
        const base = status.bases.find((b) => b.id === baseId);
        if (!base) throw new NotFoundException({ code: 'airtable_base_not_found', message: 'Esa base no está entre las que puede ver el token.', data: { status: 404 } });
        const token = await this.token(ctx, id);
        const tables = await this.call(() => this.client(token).tables(base.id));
        if (tables.length === 0) {
            throw new BadRequestException({ code: 'airtable_base_empty', message: 'Esa base no tiene tablas.', data: { status: 400 } });
        }
        status.base = base;
        status.tables = tables;
        status.scan = [];
        status.plan = null;
        status.limit = null;
        status.result = null;
        status.error = null;
        status.stage = 'scanning';
        status.progress = { table: tables[0]!.name, table_done: 0, table_total: 0, done: 0, total: 0, files_done: 0, files_total: 0, linking: false };
        await this.save(ctx, status);
        this.start(ctx, id, () => this.scan(ctx, status, token));
        return status;
    }

    async get(ctx: AiToolContext, id: string): Promise<AirtableImportStatus> {
        const status = await this.load(ctx, id);
        // Lo que corre en segundo plano vive en este proceso: si el servidor se
        // reinició a mitad, nadie lo sigue y la pantalla esperaría para siempre.
        // Cada página guarda el avance, así que un estado quieto por más de
        // STALE_MS (más que la espera más larga ante un 429) es una corrida cortada.
        if (
            (status.stage === 'scanning' || status.stage === 'importing') &&
            !this.running.has(runKey(ctx, id)) &&
            Date.now() - Date.parse(status.updated_at) > STALE_MS
        ) {
            const importing = status.stage === 'importing';
            status.stage = 'error';
            status.progress = null;
            status.error = {
                code: 'airtable_import_interrupted',
                message: importing
                    ? 'La importación se cortó porque el servidor se reinició. Lo que alcanzó a crearse quedó en tus listas: revísalo antes de volver a importar.'
                    : 'La lectura de la base se cortó porque el servidor se reinició. Vuelve a leerla.',
            };
            await this.save(ctx, status);
            // Leyendo, el token sigue sirviendo para volver a leer; importando, la corrida terminó.
            if (importing) await this.redis.del(airtableTokenKey(ctx.tenantId, ctx.userId, id)).catch(() => undefined);
        }
        return status;
    }

    /** Para los tests: espera a que termine lo que corre en segundo plano. */
    async waitFor(ctx: AiToolContext, id: string): Promise<AirtableImportStatus> {
        await this.running.get(runKey(ctx, id));
        return this.load(ctx, id);
    }

    private async scan(ctx: AiToolContext, status: AirtableImportStatus, token: string): Promise<void> {
        const key = runKey(ctx, status.id);
        try {
            const client = this.client(token, key);
            const members = await this.memberEmails(ctx.tenantId);
            let budget = AIRTABLE_MAX_RECORDS;
            const progress = status.progress!;
            for (const table of status.tables) {
                const s: AirtableTableScan = { table_id: table.id, records: 0, truncated: false, attachments: {}, people: {}, autonumber_max: {} };
                status.scan.push(s);
                progress.table = table.name;
                progress.table_done = 0;
                const watch = table.fields.filter((f) => f.type === 'multipleAttachments' || PEOPLE_TYPES.has(f.type) || f.type === 'autoNumber');
                const ask = watch.length > 0 ? watch.map((f) => f.id) : [table.primaryFieldId];
                const people = new Map<string, Map<string, AirtablePersonSeen>>();
                let offset: string | undefined;
                do {
                    if (this.cancelled.has(key)) return;
                    if (budget <= 0) {
                        s.truncated = true;
                        break;
                    }
                    const page = await client.page(status.base!.id, table.id, offset, ask);
                    for (const rec of page.records.slice(0, budget)) {
                        s.records++;
                        for (const f of watch) scanCell(s, people, f.id, f.type, rec.fields[f.id], members);
                    }
                    budget -= Math.min(page.records.length, budget);
                    if (page.offset && budget <= 0) s.truncated = true;
                    offset = page.offset;
                    progress.table_done = s.records;
                    progress.done = status.scan.reduce((n, x) => n + x.records, 0);
                    progress.total = progress.done;
                    await this.save(ctx, status);
                } while (offset);
                for (const [fid, m] of people) s.people[fid] = [...m.values()];
            }
            const external = await this.files.uploadsExternally(ctx.tenantId).catch(() => false);
            status.limit = {
                records_remaining: await this.billing.recordsRemaining(ctx.tenantId),
                storage_room: external ? null : await this.billing.storageRoomBytes(ctx.tenantId),
                storage_external: external,
            };
            const bytes = status.scan.reduce((n, x) => n + Object.values(x.attachments).reduce((m, a) => m + a.bytes, 0), 0);
            const attachments = status.limit.storage_room === null || bytes <= status.limit.storage_room;
            status.plan = buildAirtableDraftPlan(status.tables, status.scan, { attachments, baseName: status.base!.name });
            status.stage = 'ready';
            status.progress = null;
            await this.save(ctx, status);
        } catch (err) {
            status.stage = 'error';
            status.progress = null;
            status.error = errorOf(err);
            await this.save(ctx, status);
        }
    }

    // ── 3. Importar ───────────────────────────────────────────────────────

    async apply(ctx: AiToolContext, id: string, input: AirtableApplyInput): Promise<AirtableImportStatus> {
        if (!can(ctx, 'manage_fields') || !can(ctx, 'create_records')) {
            throw new ForbiddenException({
                code: 'forbidden',
                message: 'Importar una base de Airtable crea listas, campos y registros: tu rol no tiene todos esos permisos.',
                data: { status: 403 },
            });
        }
        const status = await this.load(ctx, id);
        if (status.stage === 'importing') busy('Esta base ya se está importando.');
        if (status.stage === 'done' || status.stage === 'cancelled') gone();
        if (status.stage === 'error') {
            throw new ConflictException({ code: 'airtable_import_failed', message: 'Esta importación no pudo seguir: vuelve a elegir la base para leerla de nuevo.', data: { status: 409 } });
        }
        if (status.stage !== 'ready' || !status.base) busy('Todavía se está leyendo la base: espera a que termine.');
        const resolved = resolveAirtablePlan(input.plan, status.tables, status.scan, { currency: status.defaults.currency, country: status.defaults.country });
        if (resolved.errors.length > 0) {
            throw new BadRequestException({
                code: 'airtable_invalid_plan',
                message: resolved.errors.slice(0, 3).join(' '),
                data: { status: 400, errors: { plan: resolved.errors.join('\n') } },
            });
        }
        if (await this.tenantDb.withTenant(ctx.tenantId, (tx) => tenantIsReadOnly(tx, ctx.tenantId))) {
            throw new ForbiddenException({ code: 'read_only', message: 'Tu empresa está en solo lectura: no se pueden importar datos.', data: { status: 403 } });
        }
        // Los límites del plan, ANTES de crear nada.
        const remaining = await this.billing.recordsRemaining(ctx.tenantId);
        if (remaining !== null && resolved.records > remaining && input.max_records === undefined) {
            throw new ForbiddenException({
                code: 'plan_limit_reached',
                message: `La base trae ${resolved.records} registros y a tu plan le quedan ${remaining}. Puedes importar sólo los primeros ${remaining} o pasar a un plan mayor.`,
                data: { status: 403, errors: { plan: 'límite de registros' } },
            });
        }
        if (remaining !== null && remaining <= 0) {
            throw new ForbiddenException({ code: 'plan_limit_reached', message: 'Tu plan ya no tiene lugar para más registros.', data: { status: 403 } });
        }
        if (input.plan.attachments && resolved.file_bytes > 0 && !(await this.files.uploadsExternally(ctx.tenantId).catch(() => false))) {
            const room = await this.billing.storageRoomBytes(ctx.tenantId);
            if (room !== null && resolved.file_bytes > room) {
                throw new ForbiddenException({
                    code: 'storage_limit_reached',
                    message: `Los adjuntos pesan ${mb(resolved.file_bytes)} y en el almacenamiento de tu plan quedan ${mb(Math.max(0, room))}. Importa sin los adjuntos o libera espacio.`,
                    data: { status: 403 },
                });
            }
        }
        const token = await this.token(ctx, id);
        const lock = await acquireRedisLock(this.redis, airtableLockKey(ctx.tenantId), LOCK_TTL_S);
        if (!lock) {
            throw new ConflictException({
                code: 'airtable_import_busy',
                message: 'Ya hay una importación de Airtable en curso en tu empresa: espera a que termine.',
                data: { status: 409 },
            });
        }
        status.stage = 'importing';
        status.plan = input.plan;
        status.error = null;
        status.progress = { table: null, table_done: 0, table_total: 0, done: 0, total: resolved.records, files_done: 0, files_total: input.plan.attachments ? resolved.files : 0, linking: false };
        await this.save(ctx, status);
        this.start(ctx, id, () => this.runImport(ctx, status, resolved, input, token, lock));
        return status;
    }

    async cancel(ctx: AiToolContext, id: string): Promise<AirtableImportStatus> {
        const status = await this.load(ctx, id);
        if (status.stage === 'done' || status.stage === 'cancelled') return status;
        this.cancelled.add(runKey(ctx, id));
        if (status.stage === 'importing') return status; // Se detiene en la próxima página y arma lo que alcanzó.
        await this.running.get(runKey(ctx, id));
        const fresh = await this.load(ctx, id);
        fresh.stage = 'cancelled';
        fresh.progress = null;
        await this.save(ctx, fresh);
        await this.redis.del(airtableTokenKey(ctx.tenantId, ctx.userId, id)).catch(() => undefined);
        this.cancelled.delete(runKey(ctx, id));
        return fresh;
    }

    private async runImport(
        ctx: AiToolContext,
        status: AirtableImportStatus,
        resolved: ResolvedAirtablePlan,
        input: AirtableApplyInput,
        token: string,
        lock: string,
    ): Promise<void> {
        const key = runKey(ctx, status.id);
        const progress = status.progress!;
        const cellWarnings: AirtableCellWarning[] = [];
        let cellWarningsTotal = 0;
        const warn = (w: AirtableCellWarning): void => {
            cellWarningsTotal++;
            if (cellWarnings.length < MAX_CELL_WARNINGS) cellWarnings.push(w);
        };
        const result: AirtableImportResult = {
            lists: [],
            group_id: null,
            imported: 0,
            left_out: 0,
            linked: 0,
            unmatched_links: 0,
            files: 0,
            files_bytes: 0,
            files_skipped: 0,
            warnings: [...resolved.notes],
            cell_warnings: cellWarnings,
            cell_warnings_total: 0,
        };
        try {
            const client = this.client(token, key);
            const created = await this.createLists(ctx, resolved, input);
            result.group_id = created.groupId;
            result.warnings.push(...created.warnings);
            result.lists = resolved.lists.map((l, i) => ({ ...created.lists[i]!, table_id: l.table_id, records: 0 }));

            const format = await readTenantFormat(this.tenantDb, ctx.tenantId);
            const members = await this.memberEmails(ctx.tenantId);
            const remaining = await this.billing.recordsRemaining(ctx.tenantId);
            let budget = Math.min(remaining ?? Infinity, input.max_records ?? Infinity, AIRTABLE_MAX_RECORDS);
            const external = await this.files.uploadsExternally(ctx.tenantId).catch(() => false);
            let room = external ? null : await this.billing.storageRoomBytes(ctx.tenantId);
            const recordMap = new Map<string, Map<string, number>>();
            const pending: PendingLink[] = [];
            let stopped = false;

            for (let li = 0; li < resolved.lists.length; li++) {
                const list = resolved.lists[li]!;
                const listId = created.lists[li]!.id;
                const fieldBySlug = created.fields[li]!;
                const map = new Map<string, number>();
                recordMap.set(list.table_id, map);
                const table = status.tables.find((t) => t.id === list.table_id)!;
                const targets = list.fields.map((f) => ({ f, field: fieldBySlug.get(f.slug), target: cellTarget(f) }));
                await this.setAutonumberCounters(ctx.tenantId, targets);
                const hasAutonumber = list.fields.some((f) => f.type === 'autonumber');
                progress.table = list.name;
                progress.table_done = 0;
                progress.table_total = list.records;
                await this.save(ctx, status);
                let offset: string | undefined;
                do {
                    if (this.cancelled.has(key)) {
                        stopped = true;
                        break;
                    }
                    if (budget <= 0) break;
                    await renewRedisLock(this.redis, airtableLockKey(ctx.tenantId), lock, LOCK_TTL_S);
                    const page = await client.page(status.base!.id, table.id, offset, list.fields.map((f) => f.field_id));
                    offset = page.offset;
                    const take = page.records.slice(0, budget);
                    const rows: Array<{ rec: AirtableRecord; data: Record<string, unknown>; links: Array<{ fieldId: number; to: string; ids: string[] }> }> = [];
                    for (const rec of take) {
                        const title = (airtableText(rec.fields[table.primaryFieldId]) ?? rec.id).slice(0, 80);
                        const data: Record<string, unknown> = {};
                        const links: Array<{ fieldId: number; to: string; ids: string[] }> = [];
                        for (const { f, field, target } of targets) {
                            if (!field) continue;
                            const cell = convertAirtableValue(target, rec.fields[f.field_id], { timeZone: format.timezone ?? undefined, memberIdByEmail: members });
                            if (cell.kind === 'empty') continue;
                            if (cell.kind === 'warn') {
                                warn({ list: list.name, record: title, field: f.label, message: cell.message });
                                continue;
                            }
                            if (cell.kind === 'links') {
                                if (f.relation_to) links.push({ fieldId: field.id, to: f.relation_to, ids: cell.ids });
                                continue;
                            }
                            let value: unknown;
                            if (cell.kind === 'files') {
                                const ids: number[] = [];
                                for (const a of cell.files) {
                                    const stored = await this.storeAttachment(ctx, a, room, (w) => warn({ list: list.name, record: title, field: f.label, message: w }));
                                    progress.files_done++;
                                    if (!stored) {
                                        result.files_skipped++;
                                        continue;
                                    }
                                    ids.push(stored.id);
                                    result.files++;
                                    result.files_bytes += stored.size;
                                    if (room !== null) room -= stored.size;
                                }
                                if (ids.length === 0) continue;
                                value = ids;
                            } else value = cell.value;
                            const res = validateFieldValue({ type: field.type, config: field.config, is_required: false }, value);
                            if (!res.ok) {
                                warn({ list: list.name, record: title, field: f.label, message: res.error });
                                continue;
                            }
                            if (res.value !== null) data[jsonbKeyForField(field.id)] = res.value;
                        }
                        rows.push({ rec, data, links });
                    }
                    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
                        const chunk = rows.slice(i, i + INSERT_CHUNK);
                        const inserted = await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
                            // El número automático de Airtable se conserva tal cual (el trigger lo respeta).
                            if (hasAutonumber) await tx.execute(sql`select set_config('app.keep_autonumber', 'on', true)`);
                            return tx
                                .insert(records)
                                .values(
                                    chunk.map((r) => {
                                        const at = r.rec.createdTime ? new Date(r.rec.createdTime) : null;
                                        return {
                                            tenantId: ctx.tenantId,
                                            listId,
                                            data: r.data,
                                            createdBy: ctx.userId,
                                            ...(at && !Number.isNaN(at.getTime()) ? { createdAt: at } : {}),
                                        };
                                    }),
                                )
                                .returning({ id: records.id });
                        });
                        // El RETURNING de un INSERT … VALUES respeta el orden de las filas.
                        inserted.forEach((row, j) => {
                            const r = chunk[j]!;
                            map.set(r.rec.id, row.id);
                            for (const l of r.links) pending.push({ fieldId: l.fieldId, source: row.id, targetTable: l.to, ids: l.ids });
                        });
                    }
                    budget -= rows.length;
                    result.imported += rows.length;
                    result.lists[li]!.records += rows.length;
                    progress.table_done += rows.length;
                    progress.done = result.imported;
                    await this.save(ctx, status);
                } while (offset);
                if (stopped) break;
            }

            // Lo que no entró en el plan (o quedó sin leer al detener).
            result.left_out = Math.max(0, resolved.records - result.imported);
            if (stopped) result.warnings.unshift(`Detuviste la importación: se importaron ${result.imported} de ${resolved.records} registros.`);
            else if (result.left_out > 0) result.warnings.unshift(`${result.left_out} ${result.left_out === 1 ? 'registro no se importó' : 'registros no se importaron'} por el límite de tu plan.`);
            if (result.files_skipped > 0) result.warnings.push(`${result.files_skipped} ${result.files_skipped === 1 ? 'adjunto no se bajó' : 'adjuntos no se bajaron'} (más de 15 MB, sin espacio en el almacenamiento o Airtable no lo entregó); el detalle está en la lista de abajo.`);

            // 2. Los vínculos: el id de Airtable → el id nuevo.
            progress.linking = true;
            await this.save(ctx, status);
            const rows: Array<{ fieldId: number; source: number; target: number; position: number }> = [];
            for (const p of pending) {
                const targetMap = recordMap.get(p.targetTable);
                let pos = 0;
                for (const aid of p.ids) {
                    const target = targetMap?.get(aid);
                    if (target === undefined) {
                        result.unmatched_links++;
                        continue;
                    }
                    rows.push({ fieldId: p.fieldId, source: p.source, target, position: pos++ });
                }
            }
            for (let i = 0; i < rows.length; i += LINK_CHUNK) {
                const chunk = rows.slice(i, i + LINK_CHUNK);
                await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
                    tx
                        .insert(relations)
                        .values(chunk.map((r) => ({ tenantId: ctx.tenantId, fieldId: r.fieldId, sourceRecordId: r.source, targetRecordId: r.target, position: r.position })))
                        .onConflictDoNothing(),
                );
            }
            result.linked = rows.length;
            if (result.unmatched_links > 0) {
                result.warnings.push(`${result.unmatched_links} ${result.unmatched_links === 1 ? 'vínculo quedó' : 'vínculos quedaron'} sin armar porque el registro del otro lado no se importó.`);
            }

            for (const l of created.lists) this.realtime.records(ctx.tenantId, l.id);
            result.cell_warnings_total = cellWarningsTotal;
            status.result = result;
            status.stage = stopped ? 'cancelled' : 'done';
            status.progress = null;
            await this.save(ctx, status);
            void this.audit.log({
                tenantId: ctx.tenantId,
                userId: ctx.userId,
                action: 'airtable_import.apply',
                targetType: 'workspace',
                targetId: ctx.tenantId,
                targetLabel: result.lists.map((l) => l.name).join(', ').slice(0, 300),
                meta: {
                    base: status.base?.name ?? null,
                    lists: result.lists.map((l) => l.id),
                    records: result.imported,
                    linked: result.linked,
                    files: result.files,
                    left_out: result.left_out,
                    stopped,
                },
            });
        } catch (err) {
            this.logger.warn(`Importar de Airtable falló (empresa ${ctx.tenantId}): ${err instanceof Error ? err.message : String(err)}`);
            result.cell_warnings_total = cellWarningsTotal;
            status.result = result.lists.length > 0 ? result : null;
            status.stage = 'error';
            status.progress = null;
            status.error = errorOf(err);
            await this.save(ctx, status);
        } finally {
            // El token se borra al terminar, salga como salga.
            await this.redis.del(airtableTokenKey(ctx.tenantId, ctx.userId, status.id)).catch(() => undefined);
            await releaseRedisLock(this.redis, airtableLockKey(ctx.tenantId), lock);
            this.cancelled.delete(key);
        }
    }

    /** Las listas (y la carpeta) con el MISMO constructor del asistente y el motor de las plantillas. */
    private async createLists(
        ctx: AiToolContext,
        resolved: ResolvedAirtablePlan,
        input: AirtableApplyInput,
    ): Promise<{ lists: Array<{ id: number; slug: string; name: string }>; fields: Array<Map<string, Field>>; groupId: number | null; warnings: string[] }> {
        const existing = new Set((await this.lists.list(ctx.tenantId)).map((l) => fold(l.name)));
        const names = new Map<string, string>();
        for (const l of resolved.lists) {
            let name = l.name;
            let n = 2;
            while (existing.has(fold(name))) name = `${l.name.slice(0, 74)} ${n++}`;
            existing.add(fold(name));
            names.set(l.key, name);
        }
        const specs: ListSpec[] = resolved.lists.map((l) => ({
            key: l.key,
            name: names.get(l.key)!,
            title_field: l.title_slug,
            fields: l.fields.map(toFieldSpec) as ListSpec['fields'],
        }));
        let blueprint: Awaited<ReturnType<StructureTools['buildCreateListBlueprint']>>;
        try {
            blueprint = await this.structure.buildCreateListBlueprint(ctx, specs);
        } catch (err) {
            if (err instanceof AiToolError) throw new BadRequestException({ code: 'airtable_invalid_plan', message: err.message, data: { status: 400 } });
            throw err;
        }
        const target = input.group_id !== undefined && (await this.groups.list(ctx.tenantId)).some((g) => g.id === input.group_id) ? input.group_id : null;
        const folder =
            target === null && resolved.lists.length > 1
                ? await this.groups.create(ctx.tenantId, { name: (input.plan.folder_name?.trim() || resolved.folder_name || 'Airtable').slice(0, 190), color: null })
                : null;
        let materialized: Awaited<ReturnType<BlueprintService['materialize']>>;
        try {
            materialized = await this.blueprints.materialize(ctx.tenantId, ctx.userId, blueprint, {
                groupId: target ?? folder?.id ?? null,
                includeRecords: false,
                suggestRecordLayout: true,
            });
        } catch (err) {
            if (folder) await this.groups.remove(ctx.tenantId, folder.id).catch(() => undefined);
            throw err;
        }
        const fields: Array<Map<string, Field>> = [];
        for (const l of materialized.lists) {
            const list = await this.fields.listByListId(ctx.tenantId, l.id);
            fields.push(new Map(list.map((f) => [f.slug, f])));
        }
        return {
            lists: materialized.lists.map((l) => ({ id: l.id, slug: l.slug, name: l.name })),
            fields,
            groupId: target ?? folder?.id ?? null,
            warnings: materialized.warnings,
        };
    }

    /** Los registros nuevos que se creen después siguen desde el mayor número de Airtable. */
    private async setAutonumberCounters(tenantId: number, targets: Array<{ f: ResolvedAirtableField; field: Field | undefined }>): Promise<void> {
        for (const { f, field } of targets) {
            if (f.type !== 'autonumber' || !field) continue;
            const next = (f.autonumber_max ?? 0) + 1;
            await this.tenantDb.withTenant(tenantId, (tx) =>
                tx
                    .insert(autonumberCounters)
                    .values({ tenantId, fieldId: field.id, period: 0, nextValue: next })
                    .onConflictDoUpdate({
                        target: [autonumberCounters.fieldId, autonumberCounters.period],
                        set: { nextValue: sql`GREATEST(${autonumberCounters.nextValue}, excluded.next_value)` },
                    }),
            );
        }
    }

    /** Baja un adjunto de Airtable y lo guarda como archivo de la app (cuenta para el almacenamiento del plan). */
    private async storeAttachment(ctx: AiToolContext, a: AirtableAttachment, room: number | null, note: (w: string) => void): Promise<{ id: number; size: number } | null> {
        if (a.size > AIRTABLE_MAX_FILE_BYTES) {
            note(`«${a.filename}» pesa ${mb(a.size)} (el tope es 15 MB): no se bajó.`);
            return null;
        }
        if (room !== null && a.size > room) {
            note(`«${a.filename}» no entró en el almacenamiento de tu plan: no se bajó.`);
            return null;
        }
        let bytes: Buffer | null = null;
        let url = a.url;
        try {
            for (let hop = 0; hop < 4; hop++) {
                const res = await safeWebhookFetch(url, { method: 'GET', captureBody: true, binary: true, maxCaptureBytes: AIRTABLE_MAX_FILE_BYTES + 1, timeoutMs: 30_000 });
                const location = res.headers?.location;
                if (res.status >= 300 && res.status < 400 && location) {
                    url = new URL(location, url).toString();
                    continue;
                }
                if (res.status === 200 && res.bytes && !res.truncated) bytes = res.bytes;
                break;
            }
        } catch {
            bytes = null;
        }
        if (!bytes) {
            note(`Airtable no entregó «${a.filename}»: no se bajó.`);
            return null;
        }
        if (bytes.length > AIRTABLE_MAX_FILE_BYTES || (room !== null && bytes.length > room)) {
            note(`«${a.filename}» no entró en el almacenamiento de tu plan: no se bajó.`);
            return null;
        }
        try {
            const dto = await this.files.upload(ctx.tenantId, ctx.userId, a.filename, a.type, Readable.from(bytes));
            return { id: dto.id, size: bytes.length };
        } catch (err) {
            note(`«${a.filename}» no se pudo guardar: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}.`);
            return null;
        }
    }

    // ── Soporte ───────────────────────────────────────────────────────────

    /** Correo (minúsculas) → id de los miembros del equipo (nunca clientes ni invitados). */
    private async memberEmails(tenantId: number): Promise<Map<string, number>> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: users.id, email: users.email })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(and(eq(memberships.tenantId, tenantId), staffRoleSql(), isNull(users.disabledAt))),
        );
        return new Map(rows.filter((r) => r.email).map((r) => [r.email.trim().toLowerCase(), r.id]));
    }

    private start(ctx: AiToolContext, id: string, job: () => Promise<void>): void {
        const key = runKey(ctx, id);
        const run = job()
            .catch((err: unknown) => this.logger.warn(`Importar de Airtable: ${err instanceof Error ? err.message : String(err)}`))
            .finally(() => this.running.delete(key));
        this.running.set(key, run);
    }

    private async token(ctx: AiToolContext, id: string): Promise<string> {
        const raw = await this.redis.get(airtableTokenKey(ctx.tenantId, ctx.userId, id));
        if (!raw) {
            throw new NotFoundException({ code: 'airtable_session_expired', message: 'La conexión con Airtable venció: vuelve a pegar el token.', data: { status: 404 } });
        }
        try {
            return decryptSecret(raw, this.env.SECRETS_KEY);
        } catch {
            throw new NotFoundException({ code: 'airtable_session_expired', message: 'La conexión con Airtable venció: vuelve a pegar el token.', data: { status: 404 } });
        }
    }

    private async load(ctx: AiToolContext, id: string): Promise<AirtableImportStatus> {
        if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) throw notFound();
        const raw = await this.redis.get(airtableSessionKey(ctx.tenantId, ctx.userId, id));
        if (!raw) throw notFound();
        try {
            return JSON.parse(raw) as AirtableImportStatus;
        } catch {
            throw notFound();
        }
    }

    private async save(ctx: AiToolContext, status: AirtableImportStatus): Promise<void> {
        status.updated_at = new Date().toISOString();
        await this.redis.set(airtableSessionKey(ctx.tenantId, ctx.userId, status.id), JSON.stringify(status), 'EX', AIRTABLE_SESSION_TTL_SECONDS);
        // El token vive mientras viva la sesión (sin pasarse de su vencimiento).
        await this.redis.expire(airtableTokenKey(ctx.tenantId, ctx.userId, status.id), AIRTABLE_SESSION_TTL_SECONDS).catch(() => undefined);
    }

    private async call<T>(fn: () => Promise<T>): Promise<T> {
        try {
            return await fn();
        } catch (err) {
            if (err instanceof AirtableApiError) {
                const body = { code: err.code, message: err.message, data: { status: err.status } };
                if (err.status === 404) throw new NotFoundException(body);
                if (err.status === 400) throw new BadRequestException(body);
                throw new BadRequestException({ ...body, data: { status: 400 } });
            }
            throw err;
        }
    }
}

function runKey(ctx: AiToolContext, id: string): string {
    return `${ctx.tenantId}:${ctx.userId}:${id}`;
}

function notFound(): NotFoundException {
    return new NotFoundException({ code: 'airtable_session_expired', message: 'Esta importación venció: vuelve a conectar Airtable.', data: { status: 404 } });
}

function busy(message: string): never {
    throw new ConflictException({ code: 'airtable_import_busy', message, data: { status: 409 } });
}

function gone(): never {
    throw new ConflictException({ code: 'airtable_import_finished', message: 'Esta importación ya terminó: empieza otra para importar de nuevo.', data: { status: 409 } });
}

function errorOf(err: unknown): { code: string; message: string } {
    if (err instanceof AirtableApiError) return { code: err.code, message: err.message };
    const response = (err as { getResponse?: () => unknown })?.getResponse?.();
    if (response && typeof response === 'object') {
        const r = response as { code?: unknown; message?: unknown };
        if (typeof r.message === 'string') return { code: typeof r.code === 'string' ? r.code : 'airtable_import_failed', message: r.message };
    }
    return { code: 'airtable_import_failed', message: 'La importación no pudo terminar. Intenta de nuevo; si sigue fallando, avísale a soporte.' };
}

function mb(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toLocaleString('es', { maximumFractionDigits: 1 })} MB`;
}

function fold(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim()
        .toLowerCase();
}

function cellTarget(f: ResolvedAirtableField): AirtableCellTarget {
    return { label: f.label, type: f.type, source: f.source, option_map: f.option_map, time_zone: f.time_zone };
}

/** Lo que mira el recorrido en cada celda: adjuntos, personas y números automáticos. */
function scanCell(
    s: AirtableTableScan,
    people: Map<string, Map<string, AirtablePersonSeen>>,
    fieldId: string,
    type: string,
    raw: unknown,
    members: ReadonlyMap<string, number>,
): void {
    if (raw === undefined || raw === null) return;
    if (type === 'multipleAttachments') {
        const st: AirtableAttachmentStats = (s.attachments[fieldId] ??= { files: 0, bytes: 0, too_big: 0 });
        for (const a of Array.isArray(raw) ? raw : []) {
            const size = typeof (a as { size?: unknown })?.size === 'number' ? (a as { size: number }).size : 0;
            if (size > AIRTABLE_MAX_FILE_BYTES) st.too_big++;
            else {
                st.files++;
                st.bytes += size;
            }
        }
        return;
    }
    if (type === 'autoNumber') {
        if (typeof raw === 'number' && raw > (s.autonumber_max[fieldId] ?? 0)) s.autonumber_max[fieldId] = raw;
        return;
    }
    const m = people.get(fieldId) ?? new Map<string, AirtablePersonSeen>();
    people.set(fieldId, m);
    for (const p of Array.isArray(raw) ? raw : [raw]) {
        if (m.size >= MAX_PEOPLE_PER_FIELD || !p || typeof p !== 'object') continue;
        const o = p as Record<string, unknown>;
        const email = typeof o.email === 'string' ? o.email.trim().toLowerCase() : '';
        const name = typeof o.name === 'string' && o.name.trim() !== '' ? o.name.trim() : email;
        const k = email || name;
        if (!k || m.has(k)) continue;
        const member = email !== '' && members.has(email);
        // El correo de alguien de afuera no se guarda (sólo el nombre).
        m.set(k, { email: member ? email : null, name: name || 'Sin nombre', member });
    }
}

/** El campo del plan → el `fieldSpec` del constructor de listas del asistente. */
function toFieldSpec(f: ResolvedAirtableField): Record<string, unknown> {
    const spec: Record<string, unknown> = { label: f.label, slug: f.slug, type: f.type };
    if (f.description) spec.description = f.description;
    if (f.options) spec.options = f.options.map((o) => ({ label: o.label, value: o.value, ...(o.color ? { color: o.color } : {}) }));
    if (f.currency) spec.currency = f.currency;
    if (f.precision !== undefined) spec.precision = f.precision;
    if (f.max !== undefined) spec.max = f.max;
    if (f.default_country) spec.default_country = f.default_country;
    if (f.relation_to) spec.relation_to = f.relation_to;
    if (f.type === 'autonumber') spec.autonumber = { ...AIRTABLE_AUTONUMBER_CONFIG };
    return spec;
}
