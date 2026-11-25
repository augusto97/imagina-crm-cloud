import { Body, Controller, ForbiddenException, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import {
    updateCompanyHoursSchema,
    zonedToday,
    type CompanyHolidaysResponse,
    type CompanyHoursResponse,
    type UpdateCompanyHoursInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CompanyHoursService } from './company-hours.service';

/**
 * v0.1.467 (E8) — Ajustes → Horario laboral. Lo lee cualquier miembro del
 * equipo (lo usan las automatizaciones que arma un gerente); editarlo es del
 * admin, como el formato regional. Los invitados no (sin `@AllowGuest`).
 */
@Controller('workspaces')
@UseGuards(SessionGuard)
export class CompanyHoursController {
    constructor(private readonly hours: CompanyHoursService) {}

    @Get('current/business-hours')
    @UseGuards(TenantGuard)
    get(@Req() req: FastifyRequest): Promise<CompanyHoursResponse> {
        return this.hours.get(req.tenant!.tenantId);
    }

    @Put('current/business-hours')
    @UseGuards(TenantGuard)
    update(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(updateCompanyHoursSchema)) input: UpdateCompanyHoursInput,
    ): Promise<CompanyHoursResponse> {
        if (req.tenant!.role !== 'admin') {
            throw new ForbiddenException({
                code: 'admin_only',
                message: 'Sólo el admin del workspace puede cambiar el horario laboral',
                data: { status: 403 },
            });
        }
        return this.hours.update(req.tenant!.tenantId, input, req.authUserId ?? null);
    }

    /**
     * Los festivos de un año para la lista de Ajustes. `country` deja ver los
     * de otro país antes de guardarlo; sin él, el de la empresa.
     */
    @Get('current/business-hours/holidays')
    @UseGuards(TenantGuard)
    async holidays(
        @Req() req: FastifyRequest,
        @Query('country') country?: string,
        @Query('year') year?: string,
        @Query('regional') regional?: string,
    ): Promise<CompanyHolidaysResponse> {
        const saved = await this.hours.get(req.tenant!.tenantId);
        const tz = saved.timezone ?? 'UTC';
        const y = Number(year);
        const theYear = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : Number(zonedToday(tz).slice(0, 4));
        const c = country === undefined ? saved.hours.holiday_country : country === '' || country === 'none' ? null : country.toUpperCase();
        const reg = regional === undefined ? saved.hours.regional_holidays : regional === '1' || regional === 'true';
        return this.hours.holidaysOf(c, theYear, reg);
    }
}
