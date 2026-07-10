import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    Patch,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    createFieldSchema,
    reorderFieldsSchema,
    updateFieldSchema,
    type CreateFieldInput,
    type Field,
    type ReorderFieldsInput,
    type UpdateFieldInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { FieldsService } from './fields.service';

/**
 * CRUD de campos por lista (CONTRACT.md §1). Rutas anidadas bajo la lista;
 * mutaciones de schema exigen `manage_fields`.
 */
@Controller('lists/:list/fields')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class FieldsController {
    constructor(private readonly fields: FieldsService) {}

    @Get()
    all(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ data: Field[] }> {
        return this.fields.list(tenantId(req), list).then((data) => ({ data }));
    }

    /**
     * Valores distintos de un campo (autocomplete de filtros/conditions).
     * Expone datos de records → exige `view_records` (los usuarios con scope
     * "solo los míos" no ven valores del resto).
     */
    @Get(':field/values')
    @RequireCapability('view_records')
    values(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('field') field: string,
        @Query('search') search?: string,
        @Query('limit') limit?: string,
    ): Promise<{ data: Array<{ value: string; count: number }> }> {
        return this.fields
            .distinctValues(tenantId(req), list, field, search ?? '', Number(limit ?? 50))
            .then((data) => ({ data }));
    }

    @Get(':field')
    get(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('field') field: string,
    ): Promise<Field> {
        return this.fields.get(tenantId(req), list, field);
    }

    @Post()
    @HttpCode(201)
    @RequireCapability('manage_fields')
    create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(createFieldSchema)) input: CreateFieldInput,
    ): Promise<Field> {
        return this.fields.create(tenantId(req), list, input);
    }

    @Patch('reorder')
    @RequireCapability('manage_fields')
    reorder(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(reorderFieldsSchema)) input: ReorderFieldsInput,
    ): Promise<{ data: Field[] }> {
        return this.fields
            .reorder(tenantId(req), list, input.field_ids)
            .then((data) => ({ data }));
    }

    @Patch(':field')
    @RequireCapability('manage_fields')
    update(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('field') field: string,
        @Body(new ZodValidationPipe(updateFieldSchema)) patch: UpdateFieldInput,
    ): Promise<Field> {
        return this.fields.update(tenantId(req), list, field, patch);
    }

    @Delete(':field')
    @HttpCode(204)
    @RequireCapability('manage_fields')
    async remove(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('field') field: string,
    ): Promise<void> {
        await this.fields.remove(tenantId(req), list, field);
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}
