import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    createSavedFilterSchema,
    type CreateSavedFilterInput,
    type SavedFilter,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { SavedFiltersService } from './saved-filters.service';

/**
 * Filtros guardados por lista (herencia del plugin). Cualquier miembro puede
 * guardar/listar los suyos + los del workspace (shared); no exige capability
 * (son sólo consultas guardadas). Borrar sólo alcanza a los shared o los propios.
 */
@Controller('lists/:list/saved-filters')
@UseGuards(SessionGuard, TenantGuard)
export class SavedFiltersController {
    constructor(private readonly filters: SavedFiltersService) {}

    @Get()
    all(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ data: SavedFilter[] }> {
        return this.filters.list(tenantId(req), userId(req), list).then((data) => ({ data }));
    }

    @Post()
    @HttpCode(201)
    create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(createSavedFilterSchema)) input: CreateSavedFilterInput,
    ): Promise<SavedFilter> {
        return this.filters.create(tenantId(req), userId(req), list, input);
    }

    @Delete(':id')
    @HttpCode(204)
    async remove(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<void> {
        await this.filters.remove(tenantId(req), userId(req), list, id);
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}
function userId(req: FastifyRequest): number {
    return req.authUserId!;
}
