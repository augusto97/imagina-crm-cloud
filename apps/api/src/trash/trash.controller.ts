import { Controller, Delete, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
    listTrashQuerySchema,
    trashTargetSchema,
    type ListTrashQuery,
    type Role,
    type TrashItem,
    type TrashPageMeta,
    type TrashPurgeResult,
    type TrashRestoreResult,
    type TrashTarget,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TrashService, type TrashViewer } from './trash.service';
import { aclOf } from '../tenancy/acl-of';

/**
 * Papelera de la empresa. Cualquier miembro la abre: ve lo que borró y, de
 * los registros, los de las listas que puede ver. Restaurar y borrar para
 * siempre: quien lo borró o un admin. Vaciarla entera: sólo un admin.
 * (En solo-lectura —impago— se puede mirar pero no restaurar: es escribir.)
 */
@Controller('trash')
@UseGuards(SessionGuard, TenantGuard)
export class TrashController {
    constructor(private readonly trash: TrashService) {}

    @Get()
    list(
        @Req() req: FastifyRequest,
        @Query(new ZodValidationPipe(listTrashQuerySchema)) q: ListTrashQuery,
    ): Promise<{ data: TrashItem[]; meta: TrashPageMeta }> {
        return this.trash.list(req.tenant!.tenantId, viewer(req), q);
    }

    @Post(':type/:id/restore')
    @HttpCode(200)
    async restore(
        @Req() req: FastifyRequest,
        @Param(new ZodValidationPipe(trashTargetSchema)) target: TrashTarget,
    ): Promise<{ data: TrashRestoreResult }> {
        return { data: await this.trash.restore(req.tenant!.tenantId, viewer(req), target.type, target.id) };
    }

    @Delete(':type/:id')
    @HttpCode(200)
    async purge(
        @Req() req: FastifyRequest,
        @Param(new ZodValidationPipe(trashTargetSchema)) target: TrashTarget,
    ): Promise<{ data: TrashPurgeResult }> {
        return { data: await this.trash.purge(req.tenant!.tenantId, viewer(req), target.type, target.id) };
    }

    @Delete()
    @HttpCode(200)
    async empty(@Req() req: FastifyRequest): Promise<{ data: TrashPurgeResult }> {
        return { data: await this.trash.empty(req.tenant!.tenantId, viewer(req)) };
    }
}

function viewer(req: FastifyRequest): TrashViewer {
    return { userId: req.authUserId!, role: req.tenant!.role as Role, ...aclOf(req) };
}
