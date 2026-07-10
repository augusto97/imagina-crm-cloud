import { randomBytes } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { IssueMagicLinkInput, MagicLinkResult, PortalBoot } from '@imagina-base/shared';
import * as argon2 from 'argon2';
import { and, eq, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { SessionService } from '../auth/session.service';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { fields, lists, memberships, portalLinks, records, users } from '../db/schema';
import { ListsService } from '../lists/lists.service';
import { MailService } from '../mail/mail.service';
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
        const raw = await this.redis.get(magicKey(token));
        if (!raw) {
            throw new NotFoundException({
                code: 'invalid_magic_link',
                message: 'El enlace es inválido o expiró',
                data: { status: 404 },
            });
        }
        await this.redis.del(magicKey(token)); // un solo uso
        const payload = JSON.parse(raw) as MagicPayload;
        const sessionToken = await this.sessions.create(payload.userId);
        return { sessionToken };
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
                .select({ id: lists.id, name: lists.name, settings: lists.settings })
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

            const template = Array.isArray(list.settings.portal_template)
                ? (list.settings.portal_template as Array<Record<string, unknown>>)
                : [];

            return {
                list_id: list.id,
                list_name: list.name,
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
