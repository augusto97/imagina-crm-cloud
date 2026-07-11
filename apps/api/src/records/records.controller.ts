import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    bulkRecordsSchema,
    createRecordSchema,
    listRecordsQuerySchema,
    updateRecordSchema,
    type BulkRecordsInput,
    type CreateRecordInput,
    type ListRecordsQuery,
    type RecordDto,
    type UpdateRecordInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { BillingService } from '../billing/billing.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RecordsService, type Actor, type RecordsPage } from './records.service';

/**
 * CRUD de registros por lista (CONTRACT.md §1). El listado usa cursor
 * pagination keyset + filter tree. Las capabilities se validan por acción,
 * con variantes `_own_` (scoping por created_by) resueltas en el service.
 */
@Controller('lists/:list/records')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class RecordsController {
    constructor(
        private readonly records: RecordsService,
        private readonly billing: BillingService,
    ) {}

    @Get()
    @RequireCapability('view_records', 'view_own_records')
    list(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Query() rawQuery: Record<string, unknown>,
    ): Promise<RecordsPage> {
        return this.records.list(tenantId(req), actor(req), list, parseListQuery(rawQuery));
    }

    @Post('bulk')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records', 'delete_records', 'delete_own_records')
    bulk(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(bulkRecordsSchema)) input: BulkRecordsInput,
    ): Promise<{ succeeded: number[]; failed: Array<{ id: number; message: string }> }> {
        return this.records.bulk(tenantId(req), actor(req), list, input.action, input.ids, input.values);
    }

    @Get(':id')
    @RequireCapability('view_records', 'view_own_records')
    get(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<RecordDto> {
        return this.records.get(tenantId(req), actor(req), list, id);
    }

    @Post()
    @HttpCode(201)
    @RequireCapability('create_records')
    async create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(createRecordSchema)) input: CreateRecordInput,
    ): Promise<RecordDto> {
        // Límite de records por plan (STANDALONE §11).
        await this.billing.assertCanCreateRecord(tenantId(req));
        return this.records.create(tenantId(req), actor(req), list, input);
    }

    @Patch(':id')
    @RequireCapability('edit_records', 'edit_own_records')
    update(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateRecordSchema)) input: UpdateRecordInput,
    ): Promise<RecordDto> {
        return this.records.update(tenantId(req), actor(req), list, id, input);
    }

    @Delete(':id')
    @HttpCode(204)
    @RequireCapability('delete_records', 'delete_own_records')
    async remove(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<void> {
        await this.records.remove(tenantId(req), actor(req), list, id);
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

function actor(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role };
}

/**
 * Parsea la query de listado. El `filter_tree` viaja como JSON codificado en
 * el query param `filter` (un árbol no cabe cómodo en pares clave=valor);
 * el resto (cursor/limit/sort_dir) son params planos. Todo se valida con Zod.
 */
function parseListQuery(raw: Record<string, unknown>): ListRecordsQuery {
    const candidate: Record<string, unknown> = {
        cursor: raw.cursor,
        limit: raw.limit,
        sort_dir: raw.sort_dir,
        search: raw.search,
    };
    if (typeof raw.filter === 'string' && raw.filter.trim() !== '') {
        try {
            candidate.filter_tree = JSON.parse(raw.filter);
        } catch {
            throw new BadRequestException({
                code: 'invalid_filter',
                message: 'El parámetro filter debe ser JSON válido',
                data: { status: 400 },
            });
        }
    }
    const parsed = listRecordsQuerySchema.safeParse(candidate);
    if (!parsed.success) {
        throw new BadRequestException({
            code: 'validation_failed',
            message: 'Query de listado inválida',
            data: { status: 400 },
        });
    }
    return parsed.data;
}
