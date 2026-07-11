import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import {
    recurrenceUpsertSchema,
    type RecurrenceDto,
    type RecurrenceUpsertInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RecurrencesService } from './recurrences.service';

const MAX_BATCH_IDS = 500;

/**
 * Recurrencias por record (paridad con el plugin). El POST hace upsert por
 * (record, campo de fecha); el batch (`GET /lists/:l/recurrences?ids=…`)
 * alimenta los iconos de las celdas de fecha sin N+1.
 */
@Controller('lists/:list')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class RecurrencesController {
    constructor(private readonly recurrences: RecurrencesService) {}

    @Get('recurrences')
    @RequireCapability('view_records', 'view_own_records')
    batch(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Query('ids') ids: string | undefined,
    ): Promise<Record<string, RecurrenceDto[]>> {
        return this.recurrences.batchByRecords(tenantId(req), list, parseIds(ids));
    }

    @Get('records/:recordId/recurrences')
    @RequireCapability('view_records', 'view_own_records')
    list(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
    ): Promise<{ data: RecurrenceDto[] }> {
        return this.recurrences
            .listForRecord(tenantId(req), list, recordId)
            .then((data) => ({ data }));
    }

    @Post('records/:recordId/recurrences')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    upsert(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Body(new ZodValidationPipe(recurrenceUpsertSchema)) input: RecurrenceUpsertInput,
    ): Promise<RecurrenceDto> {
        return this.recurrences.upsert(tenantId(req), list, recordId, input);
    }

    @Delete('records/:recordId/recurrences/:rid')
    @HttpCode(204)
    @RequireCapability('edit_records', 'edit_own_records')
    async remove(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Param('rid', ParseIntPipe) rid: number,
    ): Promise<void> {
        await this.recurrences.delete(tenantId(req), list, recordId, rid);
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

/** Parsea `?ids=1,2,3` a números positivos únicos (cap defensivo). */
function parseIds(raw: string | undefined): number[] {
    const parts = (raw ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
    const ids: number[] = [];
    for (const part of parts) {
        const n = Number(part);
        if (!Number.isInteger(n) || n <= 0) {
            throw new BadRequestException({
                code: 'validation_failed',
                message: 'El parámetro ids debe ser una lista de IDs numéricos',
                data: { status: 400, errors: { ids: `ID inválido: ${part}` } },
            });
        }
        if (!ids.includes(n)) ids.push(n);
    }
    if (ids.length > MAX_BATCH_IDS) {
        throw new BadRequestException({
            code: 'validation_failed',
            message: `El batch admite hasta ${MAX_BATCH_IDS} ids`,
            data: { status: 400, errors: { ids: 'Demasiados ids' } },
        });
    }
    return ids;
}
