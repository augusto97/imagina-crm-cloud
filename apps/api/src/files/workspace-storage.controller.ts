import {
    Body,
    Controller,
    Delete,
    ForbiddenException,
    Get,
    HttpCode,
    Inject,
    Optional,
    Post,
    Put,
    Req,
    ServiceUnavailableException,
    UseGuards,
} from '@nestjs/common';
import {
    moveTenantFilesSchema,
    setTenantStorageSchema,
    type MoveTenantFilesInput,
    type MoveTenantFilesResult,
    type SetTenantStorageInput,
    type StorageCandidate,
    type TenantStorageStatus,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { SessionGuard } from '../auth/session.guard';
import { BillingService } from '../billing/billing.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TENANT_STORAGE, type TenantStorageResolver } from './file-storage';
import { FilesService } from './files.service';

/**
 * v0.1.268 (ADR-S36) — Ajustes → Almacenamiento: dónde se guardan los
 * archivos de la empresa, cuánto hay en cada lugar y la mudanza por tandas.
 * Sólo el admin: decide dónde viven los datos de toda la empresa.
 */
@Controller('workspaces')
@UseGuards(SessionGuard, TenantGuard)
export class WorkspaceStorageController {
    constructor(
        private readonly files: FilesService,
        private readonly billing: BillingService,
        private readonly audit: AuditService,
        @Optional() @Inject(TENANT_STORAGE) private readonly resolver?: TenantStorageResolver,
    ) {}

    private assertAdmin(req: FastifyRequest): void {
        if (req.tenant!.role !== 'admin') {
            throw new ForbiddenException({
                code: 'admin_only',
                message: 'Sólo el admin del workspace puede cambiar dónde se guardan los archivos',
                data: { status: 403 },
            });
        }
    }

    private get storage(): TenantStorageResolver {
        if (!this.resolver) {
            throw new ServiceUnavailableException({
                code: 'storage_unavailable',
                message: 'El almacenamiento propio no está disponible en este servidor.',
                data: { status: 503 },
            });
        }
        return this.resolver;
    }

    @Get('current/storage')
    async status(@Req() req: FastifyRequest): Promise<TenantStorageStatus> {
        this.assertAdmin(req);
        return this.build(req.tenant!.tenantId);
    }

    @Put('current/storage')
    async set(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(setTenantStorageSchema)) input: SetTenantStorageInput,
    ): Promise<TenantStorageStatus> {
        this.assertAdmin(req);
        const tenantId = req.tenant!.tenantId;
        const chosen = await this.storage.set(tenantId, input.connection_id);
        await this.audit.log({
            tenantId,
            userId: req.authUserId ?? null,
            action: 'workspace.storage_change',
            targetType: 'connection',
            targetId: input.connection_id,
            targetLabel: chosen.name,
        });
        return this.build(tenantId);
    }

    /** Vuelve al servidor de la plataforma (lo ya guardado afuera queda donde está). */
    @Delete('current/storage')
    async clear(@Req() req: FastifyRequest): Promise<TenantStorageStatus> {
        this.assertAdmin(req);
        const tenantId = req.tenant!.tenantId;
        await this.storage.clear(tenantId);
        await this.audit.log({
            tenantId,
            userId: req.authUserId ?? null,
            action: 'workspace.storage_change',
            targetType: 'workspace',
            targetLabel: '(vuelve al servidor de la plataforma)',
        });
        return this.build(tenantId);
    }

    /** Una tanda de la mudanza. La interfaz repite hasta `remaining` 0. */
    @Post('current/storage/move')
    @HttpCode(200)
    async move(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(moveTenantFilesSchema)) input: MoveTenantFilesInput,
    ): Promise<MoveTenantFilesResult> {
        this.assertAdmin(req);
        const tenantId = req.tenant!.tenantId;
        // Volver al servidor sólo mientras entre en el plan.
        const room = input.to === 'platform' ? await this.billing.storageRoomBytes(tenantId) : null;
        const out = await this.files.moveBatch(tenantId, input.to, room === null ? null : Math.max(0, room));
        if (out.moved > 0) {
            await this.audit.log({
                tenantId,
                userId: req.authUserId ?? null,
                action: 'workspace.storage_move',
                targetType: 'workspace',
                targetLabel: input.to === 'platform' ? 'al servidor de la plataforma' : 'al almacenamiento propio',
                meta: { moved: out.moved, bytes: out.bytes, failed: out.failed.length },
            });
        }
        return out;
    }

    private async build(tenantId: number): Promise<TenantStorageStatus> {
        const [choice, candidates, usage, limit] = await Promise.all([
            this.resolver ? this.resolver.choice(tenantId) : Promise.resolve(null),
            this.resolver ? this.resolver.candidates(tenantId) : Promise.resolve([]),
            this.files.usageByLocation(tenantId),
            this.billing.storageLimitMb(tenantId),
        ]);
        const withUsage = (c: (typeof candidates)[number]): StorageCandidate => ({
            ...c,
            files: usage.get(c.id)?.files ?? 0,
            bytes: usage.get(c.id)?.bytes ?? 0,
        });
        const list = candidates.map(withUsage);
        let connection: StorageCandidate | null = null;
        if (choice !== null) {
            connection = list.find((c) => c.id === choice) ?? {
                id: choice,
                name: (await this.resolver!.names(tenantId, [choice])).get(choice) ?? '(conexión borrada)',
                integration: 's3',
                detail: null,
                problem:
                    'El almacenamiento elegido ya no existe: los archivos nuevos no se pueden subir. Elegí otro o volvé al servidor.',
                files: usage.get(choice)?.files ?? 0,
                bytes: usage.get(choice)?.bytes ?? 0,
            };
        }
        let elsewhereFiles = 0;
        let elsewhereBytes = 0;
        for (const [conn, u] of usage) {
            if (conn === null || conn === choice) continue;
            elsewhereFiles += u.files;
            elsewhereBytes += u.bytes;
        }
        return {
            mode: choice === null ? 'platform' : 'connection',
            connection,
            candidates: list,
            platform: {
                files: usage.get(null)?.files ?? 0,
                bytes: usage.get(null)?.bytes ?? 0,
                limit_mb: limit,
            },
            elsewhere: { files: elsewhereFiles, bytes: elsewhereBytes },
        };
    }
}
