import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { desc, eq, lt, and } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { auditLog, users } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';

/**
 * v0.1.114 — Bitácora de acciones ADMINISTRATIVAS del workspace.
 *
 * Qué se registra: lo que cambia la configuración o DESTRUYE datos (borrar
 * listas/campos, tocar permisos por rol, publicar una lista al mundo, mover
 * miembros, cambiar plan, SMTP o dominio). Los cambios de registros siguen en
 * `activity` — esto es la capa de arriba.
 *
 * Dos reglas de diseño:
 *  - **Nunca rompe la mutación**: si el insert falla, se loguea y se sigue. Una
 *    bitácora caída no puede impedir que el admin trabaje.
 *  - **Se guarda el nombre** (`targetLabel`) al momento de la acción: cuando el
 *    objeto se borra, la entrada sigue siendo legible ("borró la lista
 *    «Clientes»" en vez de "borró la lista 87").
 */

/** Acciones conocidas (string libre en DB para no migrar por cada alta). */
export type AuditAction =
    | 'list.create'
    | 'list.delete'
    | 'list.permissions'
    | 'list.public_enable'
    | 'list.public_disable'
    | 'field.delete'
    | 'field.type_change'
    | 'member.add'
    | 'member.role_change'
    | 'member.remove'
    | 'billing.plan_change'
    | 'workspace.smtp_change'
    | 'workspace.domain_change'
    | 'import.run';

export interface AuditEntryDto {
    id: number;
    action: string;
    target_type: string;
    target_id: number | null;
    target_label: string;
    meta: Record<string, unknown>;
    user_id: number | null;
    user_name: string | null;
    created_at: string;
}

export interface AuditParams {
    tenantId: number;
    userId: number | null;
    action: AuditAction;
    targetType?: string;
    targetId?: number | null;
    targetLabel?: string;
    meta?: Record<string, unknown>;
}

const MAX_LIMIT = 100;

@Injectable()
export class AuditService {
    private readonly logger = new Logger(AuditService.name);

    constructor(private readonly tenantDb: TenantDb) {}

    /** Registra dentro de un tx existente (atómico con la mutación). */
    logInTx(tx: Tx, params: AuditParams): Promise<unknown> {
        return tx
            .insert(auditLog)
            .values({
                tenantId: params.tenantId,
                userId: params.userId,
                action: params.action,
                targetType: params.targetType ?? '',
                targetId: params.targetId ?? null,
                targetLabel: params.targetLabel ?? '',
                meta: params.meta ?? {},
            })
            .catch((err: unknown) => {
                // Best-effort: no tumbar la mutación por la bitácora.
                this.logger.warn(
                    `No se pudo registrar ${params.action}: ${err instanceof Error ? err.message : String(err)}`,
                );
            });
    }

    /** Registra fuera de un tx (abre el suyo con el scope del tenant). */
    async log(params: AuditParams): Promise<void> {
        try {
            await this.tenantDb.withTenant(params.tenantId, (tx) => this.logInTx(tx, params));
        } catch (err) {
            this.logger.warn(
                `No se pudo registrar ${params.action}: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /** Feed del workspace, más reciente primero (cursor keyset por id). */
    async list(
        tenantId: number,
        opts: { limit?: number; cursor?: number } = {},
    ): Promise<{ data: AuditEntryDto[]; meta: { next_cursor: string | null } }> {
        const limit = Math.min(Math.max(opts.limit ?? 50, 1), MAX_LIMIT);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    id: auditLog.id,
                    action: auditLog.action,
                    targetType: auditLog.targetType,
                    targetId: auditLog.targetId,
                    targetLabel: auditLog.targetLabel,
                    meta: auditLog.meta,
                    userId: auditLog.userId,
                    userName: users.name,
                    createdAt: auditLog.createdAt,
                })
                .from(auditLog)
                .leftJoin(users, eq(users.id, auditLog.userId))
                .where(
                    opts.cursor
                        ? and(eq(auditLog.tenantId, tenantId), lt(auditLog.id, opts.cursor))
                        : eq(auditLog.tenantId, tenantId),
                )
                .orderBy(desc(auditLog.id))
                .limit(limit + 1),
        );
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        return {
            data: page.map((r) => ({
                id: r.id,
                action: r.action,
                target_type: r.targetType,
                target_id: r.targetId,
                target_label: r.targetLabel,
                meta: r.meta,
                user_id: r.userId,
                user_name: r.userName ?? null,
                created_at: r.createdAt.toISOString(),
            })),
            meta: { next_cursor: hasMore ? String(page[page.length - 1]!.id) : null },
        };
    }
}

/**
 * Global: la bitácora se escribe desde muchos módulos (lists, fields, members,
 * billing, workspaces, import) y no aporta nada importarla en cada uno.
 */
@Global()
@Module({
    providers: [AuditService],
    exports: [AuditService],
})
export class AuditModule {}
