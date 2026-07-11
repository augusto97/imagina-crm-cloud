import { randomBytes } from 'node:crypto';
import {
    BadRequestException,
    ForbiddenException,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import {
    isDataField,
    jsonbKeyForField,
    validateFieldValue,
    type ActivityDto,
    type CommentDto,
    type Field,
    type IssueMagicLinkInput,
    type MagicLinkResult,
    type PortalBoot,
    type PortalCommentInput,
    type PortalUpdateMeInput,
} from '@imagina-base/shared';
import * as argon2 from 'argon2';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ActivityRepository } from '../activity/activity.repository';
import { ActivityService, computeDiff } from '../activity/activity.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { SessionService } from '../auth/session.service';
import { CommentsRepository } from '../comments/comments.repository';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { fields, lists, memberships, portalLinks, records, relations, users } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { hiddenFieldsFor } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { MailService } from '../mail/mail.service';
import { RealtimeService } from '../realtime/realtime.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';

const MAGIC_TTL_SECONDS = 60 * 60 * 24; // 24h
const magicKey = (token: string) => `magic:${token}`;

interface MagicPayload {
    userId: number;
    tenantId: number;
}

/**
 * Portal del cliente (CONTRACT.md §9). Un admin emite un magic link para un
 * record → se crea (si hace falta) un usuario `client` vinculado a ese record.
 * El token de un solo uso vive en Redis; al consumirlo se abre una sesión.
 */
@Injectable()
export class PortalService {
    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly sessions: SessionService,
        private readonly mail: MailService,
        private readonly fields: FieldsService,
        private readonly commentsRepo: CommentsRepository,
        private readonly activityRepo: ActivityRepository,
        private readonly activity: ActivityService,
        private readonly realtime: RealtimeService,
        private readonly automations: AutomationDispatcher,
    ) {}

    async issue(
        tenantId: number,
        listIdOrSlug: string,
        input: IssueMagicLinkInput,
    ): Promise<MagicLinkResult> {
        const list = await this.lists.get(tenantId, listIdOrSlug);

        const userId = await this.db.transaction(async (tx) => {
            await tx.execute(sql`set local role imagina_app`);
            await tx.execute(sql`select set_config('app.tenant_id', ${String(tenantId)}, true)`);

            // El record debe existir en la lista/tenant.
            const [record] = await tx
                .select({ id: records.id })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, list.id), eq(records.id, input.record_id)))
                .limit(1);
            if (!record) {
                throw new NotFoundException({
                    code: 'record_not_found',
                    message: 'El record no existe en esta lista',
                    data: { status: 404 },
                });
            }

            // Usuario client (por email) — passwordless (hash aleatorio).
            const [existingUser] = await tx
                .select({ id: users.id })
                .from(users)
                .where(sql`lower(${users.email}) = ${input.email}`)
                .limit(1);
            let uid = existingUser?.id;
            if (uid === undefined) {
                const hash = await argon2.hash(randomBytes(32).toString('hex'));
                const [created] = await tx
                    .insert(users)
                    .values({ email: input.email, passwordHash: hash, name: input.email })
                    .returning({ id: users.id });
                uid = created!.id;
            }

            // set app.user_id para las policies self de memberships/portal_links.
            await tx.execute(sql`select set_config('app.user_id', ${String(uid)}, true)`);

            // Defensa en profundidad (SEC-01): un magic link acuña una SESIÓN
            // para `uid`. Nunca hay que emitirlo para un usuario del equipo:
            // quien lo canjea obtendría la sesión de esa cuenta staff (incluso
            // de OTRO tenant). El self-policy de memberships deja ver todas las
            // membresías del propio uid, sin filtro de tenant → si alguna no es
            // `client`, es una cuenta de equipo y rechazamos.
            const staffMemberships = await tx
                .select({ role: memberships.role })
                .from(memberships)
                .where(and(eq(memberships.userId, uid), sql`${memberships.role} <> 'client'`))
                .limit(1);
            if (staffMemberships.length > 0) {
                throw new ForbiddenException({
                    code: 'portal_email_not_client',
                    message: 'Ese email pertenece a un usuario del equipo; el portal es solo para clientes',
                    data: { status: 403 },
                });
            }

            await tx
                .insert(memberships)
                .values({ userId: uid, tenantId, role: 'client' })
                .onConflictDoNothing();
            await tx
                .insert(portalLinks)
                .values({ tenantId, userId: uid, listId: list.id, recordId: input.record_id })
                .onConflictDoUpdate({
                    target: [portalLinks.userId, portalLinks.tenantId],
                    set: { listId: list.id, recordId: input.record_id },
                });
            return uid;
        });

        const token = randomBytes(24).toString('base64url');
        const payload: MagicPayload = { userId, tenantId };
        await this.redis.set(magicKey(token), JSON.stringify(payload), 'EX', MAGIC_TTL_SECONDS);
        const path = `/portal/acceso?token=${token}`;

        // Email transaccional: le mandamos el acceso al cliente. Best-effort —
        // si el correo falla, igual devolvemos el link para que el admin lo
        // comparta manualmente (la cola BullMQ ya reintenta por su cuenta).
        const url = `${this.env.APP_BASE_URL}${path}`;
        await this.mail
            .enqueue({
                to: input.email,
                subject: `Tu acceso al portal de ${list.name}`,
                text: `Hola,\n\nAccedé a tu portal con este enlace (válido por 24 h):\n${url}\n\nSi no esperabas este correo, ignoralo.`,
                html: `<p>Hola,</p><p>Accedé a tu portal con este enlace (válido por 24 h):</p><p><a href="${url}">Entrar al portal</a></p><p>Si no esperabas este correo, ignoralo.</p>`,
            })
            .catch(() => undefined);

        return { token, path };
    }

    /** Consume el token (un solo uso) y abre una sesión. Devuelve el token de sesión. */
    async consume(token: string): Promise<{ sessionToken: string }> {
        // SEC-15: consumo atómico. `GETDEL` lee y borra en una sola operación,
        // así dos requests concurrentes con el mismo token no pueden abrir dos
        // sesiones de un enlace "de un solo uso" (get+del tenía una carrera).
        const raw = await this.redis.getdel(magicKey(token));
        if (!raw) {
            throw new NotFoundException({
                code: 'invalid_magic_link',
                message: 'El enlace es inválido o expiró',
                data: { status: 404 },
            });
        }
        const payload = JSON.parse(raw) as MagicPayload;
        const sessionToken = await this.sessions.create(payload.userId);
        return { sessionToken };
    }


    // --- Endpoints del portal autenticado (paridad con el plugin) ----------
    // Todos resuelven el cliente desde `portal_links` (fail-closed: sin
    // vínculo → 404). JAMÁS se aceptan list_id/record_id del cliente para
    // el propio record — defensa contra spoofing (regla del plugin).

    /** Vínculo portal del usuario o 404. */
    private async requireLink(userId: number) {
        const link = await this.tenantDb.withUser(userId, async (tx) => {
            const [row] = await tx
                .select()
                .from(portalLinks)
                .where(eq(portalLinks.userId, userId))
                .limit(1);
            return row ?? null;
        });
        if (!link) {
            throw new NotFoundException({
                code: 'portal_not_linked',
                message: 'Este usuario no tiene un portal vinculado',
                data: { status: 404 },
            });
        }
        return link;
    }

    /**
     * PATCH /portal/me — el cliente edita su propio record. Whitelist
     * server-side: solo slugs declarados en bloques `editable_form` del
     * template configurado (el default no incluye ninguno → sin template
     * explícito nadie edita nada). Slug fuera de la lista → 403 explícito,
     * nunca silencioso.
     */
    async updateMe(userId: number, input: PortalUpdateMeInput): Promise<{ ok: true }> {
        const link = await this.requireLink(userId);
        const tenantId = link.tenantId;

        const { listId, changedAfter, changedBefore } = await this.tenantDb.withTenant(
            tenantId,
            async (tx) => {
                const [list] = await tx
                    .select({ id: lists.id, settings: lists.settings })
                    .from(lists)
                    .where(eq(lists.id, link.listId))
                    .limit(1);
                if (!list) throw portalGone();
                const allowed = editableSlugsFromTemplate(list.settings.portal_template);
                if (allowed.size === 0) {
                    throw new ForbiddenException({
                        code: 'portal_not_editable',
                        message: 'Tu portal no permite edición de campos',
                        data: { status: 403 },
                    });
                }

                const listFields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
                const bySlug = new Map(listFields.map((f) => [f.slug, f]));

                const patch: Record<string, unknown> = {};
                const errors: Record<string, string> = {};
                for (const [slug, value] of Object.entries(input.fields)) {
                    if (!allowed.has(slug)) {
                        throw new ForbiddenException({
                            code: 'portal_field_forbidden',
                            message: `No tienes permiso para editar el campo "${slug}"`,
                            data: { status: 403 },
                        });
                    }
                    const field = bySlug.get(slug);
                    if (!field || !isDataField(field.type)) {
                        errors[slug] = 'Campo inexistente o no editable';
                        continue;
                    }
                    const result = validateFieldValue(
                        { type: field.type, config: field.config, is_required: field.is_required },
                        value,
                    );
                    if (!result.ok) errors[slug] = result.error;
                    else patch[jsonbKeyForField(field.id)] = result.value;
                }
                if (Object.keys(errors).length > 0) {
                    throw new BadRequestException({
                        code: 'validation_failed',
                        message: 'Datos inválidos',
                        data: { status: 400, errors },
                    });
                }

                const [current] = await tx
                    .select()
                    .from(records)
                    .where(and(eq(records.id, link.recordId), eq(records.listId, list.id)))
                    .limit(1);
                if (!current) throw portalGone();
                const merged = { ...current.data, ...patch };
                await tx
                    .update(records)
                    .set({ data: merged, updatedAt: new Date() })
                    .where(eq(records.id, current.id));
                await this.activity.logInTx(tx, {
                    tenantId,
                    listId: list.id,
                    recordId: current.id,
                    userId,
                    action: 'record_updated',
                    diff: computeDiff(current.data, merged),
                });
                return { listId: list.id, changedBefore: current.data, changedAfter: merged };
            },
        );
        this.realtime.records(tenantId, listId);
        this.automations.dispatch({
            tenantId,
            listId,
            recordId: link.recordId,
            trigger: 'record_updated',
            after: changedAfter,
            before: changedBefore,
        });
        return { ok: true };
    }

    /** GET /portal/me/comments — comentarios del record del cliente. */
    async myComments(userId: number): Promise<CommentDto[]> {
        const link = await this.requireLink(userId);
        const rows = await this.tenantDb.withTenant(link.tenantId, (tx) =>
            this.commentsRepo.listByRecord(tx, link.tenantId, link.recordId),
        );
        return rows.map(toPortalComment);
    }

    /** POST /portal/me/comments — nota simple del cliente. */
    async createMyComment(userId: number, input: PortalCommentInput): Promise<CommentDto> {
        const link = await this.requireLink(userId);
        const row = await this.tenantDb.withTenant(link.tenantId, (tx) =>
            this.commentsRepo.insert(tx, {
                tenantId: link.tenantId,
                listId: link.listId,
                recordId: link.recordId,
                userId,
                body: input.content,
                kind: 'note',
                parentId: null,
                metadata: {},
            }),
        );
        this.realtime.records(link.tenantId, link.listId);
        return toPortalComment(row);
    }

    /** GET /portal/me/activity — timeline del record del cliente. */
    async myActivity(userId: number, limit: number): Promise<ActivityDto[]> {
        const link = await this.requireLink(userId);
        const cap = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
        const rows = await this.tenantDb.withTenant(link.tenantId, (tx) =>
            this.activityRepo.list(tx, link.tenantId, link.listId, {
                recordId: link.recordId,
                limit: cap,
            }),
        );
        return rows.map((row) => ({
            id: row.id,
            list_id: row.listId,
            record_id: row.recordId,
            user_id: row.userId,
            action: row.action as ActivityDto['action'],
            diff: row.diff,
            created_at: row.createdAt.toISOString(),
        }));
    }

    /**
     * Scope SQL del portal para una lista (la pieza de seguridad central,
     * paridad con `PortalScopeService` del plugin). Fail-closed:
     *  1. lista del portal → solo el record del cliente;
     *  2. lista con un campo `user` (primero por posición) → filas cuyo
     *     campo apunta al usuario;
     *  3. lista con un campo `relation` (primero por posición) hacia la
     *     lista del portal → filas vinculadas al record del cliente;
     *  4. cualquier otro caso → `false` (nunca "ver todo").
     */
    private portalScope(
        listId: number,
        listFields: Field[],
        link: { tenantId: number; listId: number; recordId: number; userId: number },
    ): SQL {
        if (listId === link.listId) return sql`${records.id} = ${link.recordId}`;

        const userField = listFields
            .filter((f) => f.type === 'user')
            .sort((a, b) => a.position - b.position)[0];
        if (userField) {
            return sql`${records.data} ->> ${jsonbKeyForField(userField.id)} = ${String(link.userId)}`;
        }

        const relField = listFields
            .filter(
                (f) =>
                    f.type === 'relation'
                    && Number((f.config as { target_list_id?: unknown }).target_list_id ?? 0) === link.listId,
            )
            .sort((a, b) => a.position - b.position)[0];
        if (relField) {
            return sql`${records.id} IN (
                SELECT ${relations.sourceRecordId} FROM ${relations}
                WHERE ${relations.tenantId} = ${link.tenantId}
                  AND ${relations.fieldId} = ${relField.id}
                  AND ${relations.targetRecordId} = ${link.recordId}
            )`;
        }
        return sql`false`;
    }

    /**
     * GET /portal/lists/:slug/records — records de OTRA lista visibles para
     * el cliente (scope del portal). Paginación por página (los sets del
     * portal son chicos; per_page ≤ 100). Campos por slug, sin los ocultos
     * para el rol `client`.
     */
    async listRecords(
        userId: number,
        listSlug: string,
        page: number,
        perPage: number,
    ): Promise<{
        data: Array<{ id: number; fields: Record<string, unknown>; relations: Record<string, unknown> }>;
        meta: { page: number; per_page: number; total: number; total_pages: number };
    }> {
        const link = await this.requireLink(userId);
        const tenantId = link.tenantId;
        const p = Math.min(Math.max(Math.trunc(page) || 1, 1), 1000);
        const pp = Math.min(Math.max(Math.trunc(perPage) || 10, 1), 100);

        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const list = await this.lists.getWithinTx(tx, tenantId, listSlug);
            const listFields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
            const scope = this.portalScope(
                list.id,
                listFields,
                { tenantId, listId: link.listId, recordId: link.recordId, userId },
            );
            const where = and(
                eq(records.tenantId, tenantId),
                eq(records.listId, list.id),
                sql`${records.deletedAt} IS NULL`,
                scope,
            );
            const [{ n: total } = { n: 0 }] = await tx
                .select({ n: sql<number>`count(*)::int` })
                .from(records)
                .where(where);
            const rows = await tx
                .select()
                .from(records)
                .where(where)
                .orderBy(records.id)
                .limit(pp)
                .offset((p - 1) * pp);

            const hidden = hiddenFieldsFor(list.settings, 'client');
            const visible = listFields.filter((f) => isDataField(f.type) && !hidden.has(f.slug));
            return {
                data: rows.map((r) => ({
                    id: r.id,
                    fields: Object.fromEntries(
                        visible.map((f) => [f.slug, (r.data as Record<string, unknown>)[jsonbKeyForField(f.id)] ?? null]),
                    ),
                    relations: {},
                })),
                meta: { page: p, per_page: pp, total, total_pages: Math.max(1, Math.ceil(total / pp)) },
            };
        });
    }

    /**
     * GET /portal/lists/:slug/aggregates?fields=1,2 — totales SIEMPRE bajo
     * el scope del portal. Keyed por slug: `{count, sum, avg, min, max}`.
     * Campos ocultos para el rol `client` se filtran (paridad fix S2).
     */
    async aggregates(
        userId: number,
        listSlug: string,
        rawFields: string,
    ): Promise<{ totals: Record<string, Record<string, number | null>> }> {
        const link = await this.requireLink(userId);
        const tenantId = link.tenantId;
        const fieldIds = rawFields
            .split(',')
            .map((v) => Number(v.trim()))
            .filter((n) => Number.isInteger(n) && n > 0)
            .slice(0, 10);
        if (fieldIds.length === 0) return { totals: {} };

        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const list = await this.lists.getWithinTx(tx, tenantId, listSlug);
            const listFields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
            const hidden = hiddenFieldsFor(list.settings, 'client');
            const targets = listFields.filter(
                (f) => fieldIds.includes(f.id) && isDataField(f.type) && !hidden.has(f.slug),
            );
            if (targets.length === 0) return { totals: {} };

            const scope = this.portalScope(
                list.id,
                listFields,
                { tenantId, listId: link.listId, recordId: link.recordId, userId },
            );
            const where = and(
                eq(records.tenantId, tenantId),
                eq(records.listId, list.id),
                sql`${records.deletedAt} IS NULL`,
                scope,
            );

            const totals: Record<string, Record<string, number | null>> = {};
            for (const field of targets) {
                const key = jsonbKeyForField(field.id);
                // Casteo numérico defensivo: valores no numéricos quedan
                // fuera de sum/avg/min/max (count cuenta TODAS las filas
                // del scope — "cuántos pedidos tengo").
                const num = sql`CASE WHEN ${records.data} ->> ${key} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${records.data} ->> ${key})::numeric END`;
                const [row] = await tx
                    .select({
                        count: sql<number>`count(*)::int`,
                        sum: sql<string | null>`sum(${num})`,
                        avg: sql<string | null>`avg(${num})`,
                        min: sql<string | null>`min(${num})`,
                        max: sql<string | null>`max(${num})`,
                    })
                    .from(records)
                    .where(where);
                totals[field.slug] = {
                    count: row?.count ?? 0,
                    sum: toNum(row?.sum),
                    avg: toNum(row?.avg),
                    min: toNum(row?.min),
                    max: toNum(row?.max),
                };
            }
            return { totals };
        });
    }

    /** Boot del portal para el client autenticado: su record + fields + template. */
    async me(userId: number): Promise<PortalBoot> {
        const link = await this.tenantDb.withUser(userId, async (tx) => {
            const [row] = await tx
                .select()
                .from(portalLinks)
                .where(eq(portalLinks.userId, userId))
                .limit(1);
            return row ?? null;
        });
        if (!link) {
            throw new NotFoundException({
                code: 'portal_not_linked',
                message: 'Este usuario no tiene un portal vinculado',
                data: { status: 404 },
            });
        }

        return this.tenantDb.withTenant(link.tenantId, async (tx) => {
            const [list] = await tx
                .select({ id: lists.id, slug: lists.slug, name: lists.name, settings: lists.settings })
                .from(lists)
                .where(eq(lists.id, link.listId))
                .limit(1);
            const [record] = await tx
                .select()
                .from(records)
                .where(and(eq(records.id, link.recordId), eq(records.listId, link.listId)))
                .limit(1);
            if (!list || !record) {
                throw new NotFoundException({
                    code: 'portal_record_missing',
                    message: 'El record del portal ya no existe',
                    data: { status: 404 },
                });
            }
            const fieldRows = await tx
                .select()
                .from(fields)
                .where(eq(fields.listId, link.listId))
                .orderBy(fields.position);

            // El editor visual guarda `portal_template` como objeto `{ blocks: [...] }`
            // (shape del template-editor). Aceptamos también un array plano legacy.
            const template = extractPortalBlocks(list.settings.portal_template);

            return {
                list_id: list.id,
                list_slug: list.slug,
                list_name: list.name,
                user_id: userId,
                record: {
                    id: record.id,
                    list_id: record.listId,
                    data: record.data,
                    created_by: record.createdBy,
                    created_at: record.createdAt.toISOString(),
                    updated_at: record.updatedAt.toISOString(),
                },
                fields: fieldRows.map((f) => ({
                    id: f.id,
                    list_id: f.listId,
                    slug: f.slug,
                    label: f.label,
                    type: f.type as PortalBoot['fields'][number]['type'],
                    config: f.config,
                    is_required: f.isRequired,
                    is_unique: f.isUnique,
                    is_indexed: f.isIndexed,
                    position: f.position,
                })),
                template,
            };
        });
    }
}

/**
 * Normaliza el `portal_template` guardado en `list.settings` al array plano de
 * bloques que consume el portal. El editor visual persiste `{ blocks: [...] }`;
 * también aceptamos un array plano (formato legacy) y devolvemos `[]` si no hay.
 */
function extractPortalBlocks(raw: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(raw)) {
        return raw as Array<Record<string, unknown>>;
    }
    if (raw && typeof raw === 'object' && Array.isArray((raw as { blocks?: unknown }).blocks)) {
        return (raw as { blocks: Array<Record<string, unknown>> }).blocks;
    }
    return [];
}

function portalGone(): NotFoundException {
    return new NotFoundException({
        code: 'portal_record_missing',
        message: 'El record del portal ya no existe',
        data: { status: 404 },
    });
}

function toNum(v: string | number | null | undefined): number | null {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** CommentRow → shape que consume el bloque del portal (content = body). */
function toPortalComment(row: {
    id: number;
    listId: number;
    recordId: number;
    userId: number;
    body: string;
    kind: string;
    parentId: number | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}): CommentDto & { content: string } {
    return {
        id: row.id,
        list_id: row.listId,
        record_id: row.recordId,
        user_id: row.userId,
        body: row.body,
        content: row.body,
        kind: row.kind as CommentDto['kind'],
        parent_id: row.parentId,
        metadata: row.metadata,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
}

/**
 * Recorre el template (con anidamiento arbitrario — nested_section) y junta
 * los slugs editables declarados en bloques `editable_form`.
 */
function editableSlugsFromTemplate(raw: unknown): Set<string> {
    const out = new Set<string>();
    const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
            for (const item of node) walk(item);
            return;
        }
        if (!node || typeof node !== 'object') return;
        const obj = node as Record<string, unknown>;
        if (obj.type === 'editable_form') {
            const cfg = (obj.config as Record<string, unknown> | undefined) ?? obj;
            const slugs = cfg.editable_field_slugs;
            if (Array.isArray(slugs)) {
                for (const s of slugs) if (typeof s === 'string' && s !== '') out.add(s);
            }
        }
        for (const v of Object.values(obj)) {
            if (v && typeof v === 'object') walk(v);
        }
    };
    walk(raw);
    return out;
}
