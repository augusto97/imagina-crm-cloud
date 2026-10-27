import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import {
    updatePlatformHelpSchema,
    type HelpConfigView,
    type PlatformHelp,
    type UpdatePlatformHelpInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { HelpService } from './help.service';

/**
 * La ayuda que configuró el operador, para el panel «Ayuda» de cualquier
 * miembro del equipo. Cerrado a invitados (no lleva `@AllowGuest`) y a los
 * clientes del portal (el TenantGuard ya los rechaza).
 */
@Controller('help')
@UseGuards(SessionGuard, TenantGuard)
export class HelpController {
    constructor(private readonly help: HelpService) {}

    @Get()
    get(@Req() req: FastifyRequest): Promise<HelpConfigView> {
        return this.help.forMember(req.tenant!.role);
    }
}

/** Plataforma → Ayuda (superadmin con sesión de contraseña). */
@Controller('platform/help')
@UseGuards(SessionGuard, SuperadminGuard)
export class PlatformHelpController {
    constructor(private readonly help: HelpService) {}

    @Get()
    get(): Promise<PlatformHelp> {
        return this.help.get();
    }

    @Patch()
    update(
        @Body(new ZodValidationPipe(updatePlatformHelpSchema)) input: UpdatePlatformHelpInput,
    ): Promise<PlatformHelp> {
        return this.help.update(input);
    }
}
