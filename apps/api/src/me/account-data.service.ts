import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { type AccountExportDto } from '@imagina-base/shared';
import * as argon2 from 'argon2';
import { and, count, eq, ne } from 'drizzle-orm';
import { SessionService } from '../auth/session.service';
import { DRIZZLE, type Db } from '../db/client';
import {
    activity,
    attachments,
    comments,
    memberships,
    mentions,
    savedFilters,
    tenants,
    users,
} from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';

/**
 * v0.1.121 — Datos personales del usuario: descarga y borrado (GDPR art. 15 y
 * 17).
 *
 * Sobre el borrado: NO se elimina la fila de `users` ni el contenido que la
 * persona produjo dentro de una empresa. Los registros, comentarios y la
 * bitácora son datos del CLIENTE (el responsable del tratamiento), no del
 * empleado que los tipeó: borrarlos sería destruirle la operación a la empresa.
 * Lo que se elimina es la IDENTIDAD — email, nombre, credenciales, segundo
 * factor, firma, membresías y sesiones — y lo que sólo le pertenece a la
 * persona (filtros guardados, menciones recibidas). El contenido queda
 * atribuido a "Usuario eliminado".
 */

/** Marca de una cuenta anonimizada (el email debe seguir siendo único). */
const anonEmail = (userId: number): string => `borrado-${userId}@cuenta-eliminada.invalid`;

/**
 * El shape del export vive en `packages/shared` (regla de oro nº 2): el mismo
 * schema que valida el front tipa lo que arma el backend.
 */
export type AccountExport = AccountExportDto;

@Injectable()
export class AccountDataService {
    private readonly logger = new Logger(AccountDataService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly sessions: SessionService,
    ) {}

    /**
     * Todo lo que la app sabe de esta persona, en un JSON descargable.
     *
     * Se recorre empresa por empresa DENTRO de su scope de tenant: es el mismo
     * camino con RLS que usa el resto del API, así el export no puede filtrar
     * datos de una empresa a la que el usuario ya no pertenece.
     */
    async exportData(userId: number): Promise<AccountExport> {
        const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) throw new NotFoundException('Usuario no encontrado');

        const memberRows = await this.db
            .select({
                tenantId: memberships.tenantId,
                role: memberships.role,
                createdAt: memberships.createdAt,
                name: tenants.name,
                slug: tenants.slug,
            })
            .from(memberships)
            .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
            .where(eq(memberships.userId, userId));

        const workspaces: AccountExport['workspaces'] = [];
        for (const m of memberRows) {
            const data = await this.tenantDb.withTenant(m.tenantId, async (tx) => {
                const commentRows = await tx
                    .select({
                        recordId: comments.recordId,
                        body: comments.body,
                        createdAt: comments.createdAt,
                        userId: comments.userId,
                    })
                    .from(comments)
                    .where(and(eq(comments.tenantId, m.tenantId), eq(comments.userId, userId)));
                const activityRows = await tx
                    .select({
                        recordId: activity.recordId,
                        action: activity.action,
                        createdAt: activity.createdAt,
                        userId: activity.userId,
                    })
                    .from(activity)
                    .where(and(eq(activity.tenantId, m.tenantId), eq(activity.userId, userId)));
                const mentionRows = await tx
                    .select({
                        commentId: mentions.commentId,
                        snippet: mentions.snippet,
                        createdAt: mentions.createdAt,
                    })
                    .from(mentions)
                    .where(and(eq(mentions.tenantId, m.tenantId), eq(mentions.mentionedUserId, userId)));
                const filterRows = await tx
                    .select({ name: savedFilters.name, createdAt: savedFilters.createdAt })
                    .from(savedFilters)
                    .where(
                        and(eq(savedFilters.tenantId, m.tenantId), eq(savedFilters.userId, userId)),
                    );
                const fileRows = await tx
                    .select({
                        filename: attachments.filename,
                        size: attachments.sizeBytes,
                        createdAt: attachments.createdAt,
                    })
                    .from(attachments)
                    .where(
                        and(eq(attachments.tenantId, m.tenantId), eq(attachments.createdBy, userId)),
                    );
                return {
                    comments: commentRows,
                    activity: activityRows,
                    mentions: mentionRows,
                    filters: filterRows,
                    files: fileRows,
                };
            });

            workspaces.push({
                id: m.tenantId,
                name: m.name,
                slug: m.slug,
                role: m.role,
                joined_at: m.createdAt.toISOString(),
                comments: data.comments.map((c) => ({
                    record_id: c.recordId,
                    body: c.body,
                    created_at: c.createdAt.toISOString(),
                })),
                activity: data.activity.map((a) => ({
                    record_id: a.recordId,
                    action: a.action,
                    created_at: a.createdAt.toISOString(),
                })),
                mentions_received: data.mentions.map((x) => ({
                    comment_id: x.commentId,
                    snippet: x.snippet,
                    created_at: x.createdAt.toISOString(),
                })),
                saved_filters: data.filters.map((f) => ({
                    name: f.name,
                    created_at: f.createdAt.toISOString(),
                })),
                files_uploaded: data.files.map((f) => ({
                    filename: f.filename,
                    size_bytes: f.size,
                    created_at: f.createdAt.toISOString(),
                })),
            });
        }

        return {
            generated_at: new Date().toISOString(),
            account: {
                id: user.id,
                email: user.email,
                name: user.name,
                locale: user.locale,
                created_at: user.createdAt.toISOString(),
                email_verified: user.emailVerifiedAt !== null,
                two_factor_enabled: user.totpEnabledAt !== null,
                email_signature: user.emailSignature,
            },
            workspaces,
        };
    }

    /**
     * Borra la cuenta: exige la contraseña, anonimiza la identidad, corta las
     * membresías y revoca las sesiones al instante.
     *
     * Guard rail: si es el ÚNICO admin de alguna empresa, se rechaza con la
     * lista — irse dejaría a esa empresa sin nadie que pueda administrarla.
     * Primero hay que nombrar otro admin (o cerrar la empresa).
     */
    async deleteAccount(userId: number, password: string): Promise<void> {
        const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) throw new NotFoundException('Usuario no encontrado');
        const valid = await argon2.verify(user.passwordHash, password).catch(() => false);
        if (!valid) throw new UnauthorizedException('La contraseña no coincide');

        const blocking = await this.soleAdminWorkspaces(userId);
        if (blocking.length > 0) {
            throw new ConflictException({
                code: 'sole_admin',
                message: `Sos el único administrador de: ${blocking.map((b) => b.name).join(', ')}. Nombrá otro administrador antes de borrar tu cuenta.`,
                data: { status: 409, workspaces: blocking },
            });
        }

        // Identidad fuera. El contenido creado dentro de cada empresa queda:
        // es del cliente, no de la persona (ver comentario del módulo).
        await this.db
            .update(users)
            .set({
                email: anonEmail(userId),
                name: 'Usuario eliminado',
                // Hash de un secreto aleatorio: la fila deja de ser una cuenta
                // usable aunque alguien conociera la contraseña anterior.
                passwordHash: await argon2.hash(randomBytes(32).toString('hex')),
                emailSignature: null,
                totpSecret: null,
                totpEnabledAt: null,
                totpBackupCodes: null,
                emailVerifiedAt: null,
                disabledAt: new Date(),
            })
            .where(eq(users.id, userId));

        // Membresías (y con ellas favoritos/ajustes por empresa), filtros
        // guardados y menciones recibidas: son del usuario, se van. Empresa por
        // empresa dentro de su scope — son tablas con RLS (regla de oro nº 3).
        const tenantIds = await this.db
            .select({ tenantId: memberships.tenantId })
            .from(memberships)
            .where(eq(memberships.userId, userId));
        for (const { tenantId } of tenantIds) {
            await this.tenantDb.withTenant(tenantId, async (tx) => {
                await tx
                    .delete(savedFilters)
                    .where(and(eq(savedFilters.tenantId, tenantId), eq(savedFilters.userId, userId)));
                await tx
                    .delete(mentions)
                    .where(and(eq(mentions.tenantId, tenantId), eq(mentions.mentionedUserId, userId)));
                await tx
                    .delete(memberships)
                    .where(
                        and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)),
                    );
            });
        }
        await this.sessions.destroyAllForUser(userId);
        this.logger.warn(`Cuenta ${userId} borrada a pedido del usuario (identidad anonimizada)`);
    }

    /** Empresas donde el usuario es el único admin (bloquean el borrado). */
    async soleAdminWorkspaces(userId: number): Promise<Array<{ id: number; name: string }>> {
        const adminOf = await this.db
            .select({ tenantId: memberships.tenantId, name: tenants.name })
            .from(memberships)
            .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
            .where(and(eq(memberships.userId, userId), eq(memberships.role, 'admin')));

        const blocking: Array<{ id: number; name: string }> = [];
        for (const t of adminOf) {
            const [others] = await this.db
                .select({ n: count() })
                .from(memberships)
                .where(
                    and(
                        eq(memberships.tenantId, t.tenantId),
                        eq(memberships.role, 'admin'),
                        ne(memberships.userId, userId),
                    ),
                );
            if ((others?.n ?? 0) === 0) blocking.push({ id: t.tenantId, name: t.name });
        }
        return blocking;
    }
}

/** Sólo para tests: la marca determinista del email anonimizado. */
export const anonymizedEmailFor = anonEmail;
/** Hash usado en logs de auditoría sin exponer el email real. */
export const emailFingerprint = (email: string): string =>
    createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 12);
