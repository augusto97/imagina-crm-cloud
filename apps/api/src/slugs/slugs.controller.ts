import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
    slugCheckQuerySchema,
    type SlugCheckQuery,
    type SlugCheckResult,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { SlugsService } from './slugs.service';

@Controller('slugs')
@UseGuards(SessionGuard, TenantGuard)
export class SlugsController {
    constructor(private readonly slugs: SlugsService) {}

    @Get('check')
    check(
        @Req() req: FastifyRequest,
        @Query(new ZodValidationPipe(slugCheckQuerySchema)) query: SlugCheckQuery,
    ): Promise<SlugCheckResult> {
        return this.slugs.check(req.tenant!.tenantId, query);
    }
}
