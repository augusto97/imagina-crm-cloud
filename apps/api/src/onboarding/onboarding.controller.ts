import { Body, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
    onboardingAiRequestSchema,
    onboardingApplySchema,
    onboardingPrefsPatchSchema,
    onboardingSamplesDeleteSchema,
    onboardingSamplesRestoreSchema,
    type OnboardingAiJob,
    type OnboardingAiRequest,
    type OnboardingAiStatus,
    type OnboardingApplyInput,
    type OnboardingApplyResult,
    type OnboardingPrefs,
    type OnboardingPrefsPatch,
    type OnboardingSamplesDeleteInput,
    type OnboardingSamplesDeleteResult,
    type OnboardingSamplesRestoreInput,
    type OnboardingStatus,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import type { AiToolContext } from '../ai/tools/registry';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../records/records.service';
import { aclOf } from '../tenancy/acl-of';
import { TenantGuard } from '../tenancy/tenant.guard';
import { OnboardingAiService } from './onboarding-ai.service';
import { OnboardingService } from './onboarding.service';

/**
 * F7 (ADR-S72) — «Empezar fácil». Cerrado a invitados (no lleva
 * `@AllowGuest()`): una persona de afuera no tiene bienvenida ni primeros
 * pasos. Los clientes del portal no llegan (el TenantGuard los rechaza).
 */
@Controller('onboarding')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class OnboardingController {
    constructor(
        private readonly onboarding: OnboardingService,
        private readonly ai: OnboardingAiService,
    ) {}

    /** Lo que «Primeros pasos» y la bienvenida necesitan, para esta persona. */
    @Get()
    status(@Req() req: FastifyRequest): Promise<OnboardingStatus> {
        return this.onboarding.status(tenantId(req), actor(req));
    }

    /** Ocultar, saltar un paso, marcar «Mi trabajo»… (se mezcla con lo guardado). */
    @Patch()
    prefs(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(onboardingPrefsPatchSchema)) patch: OnboardingPrefsPatch,
    ): Promise<OnboardingPrefs> {
        return this.onboarding.updatePrefs(tenantId(req), req.authUserId!, patch);
    }

    /** Si «Cuéntanos de tu negocio» se puede usar ahora (y por qué no). */
    @Get('ai')
    @RequireCapability('manage_lists')
    aiStatus(@Req() req: FastifyRequest): Promise<OnboardingAiStatus> {
        return this.ai.status(toolCtx(req));
    }

    /** Arranca el pedido a la IA (corre en segundo plano). */
    @Post('ai/proposals')
    @HttpCode(202)
    @RequireCapability('manage_lists')
    startProposal(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(onboardingAiRequestSchema)) input: OnboardingAiRequest,
    ): Promise<{ id: string }> {
        return this.ai.start(toolCtx(req), input);
    }

    @Get('ai/proposals/:id')
    @RequireCapability('manage_lists')
    async proposal(@Req() req: FastifyRequest, @Param('id') id: string): Promise<OnboardingAiJob> {
        const job = await this.ai.get(tenantId(req), req.authUserId!, id);
        if (!job) throw new NotFoundException({ code: 'onboarding_proposal_not_found', message: 'La propuesta venció. Vuelve a pedirla.', data: { status: 404 } });
        return job;
    }

    /** Crea lo elegido (propuesta de la IA o plantillas combinadas) con el motor de las plantillas. */
    @Post('apply')
    @HttpCode(201)
    @RequireCapability('manage_lists')
    apply(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(onboardingApplySchema)) input: OnboardingApplyInput,
    ): Promise<OnboardingApplyResult> {
        return this.onboarding.apply(tenantId(req), actor(req), input);
    }

    /** «Borrar los datos de ejemplo» (de una lista o de todas) → papelera. */
    @Post('samples/delete')
    @HttpCode(200)
    @RequireCapability('delete_records')
    deleteSamples(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(onboardingSamplesDeleteSchema)) input: OnboardingSamplesDeleteInput,
    ): Promise<OnboardingSamplesDeleteResult> {
        return this.onboarding.deleteSamples(tenantId(req), actor(req), input.list_id);
    }

    /** «Deshacer» del borrado de ejemplos. */
    @Post('samples/restore')
    @HttpCode(200)
    @RequireCapability('delete_records')
    restoreSamples(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(onboardingSamplesRestoreSchema)) input: OnboardingSamplesRestoreInput,
    ): Promise<{ restored: number }> {
        return this.onboarding.restoreSamples(tenantId(req), actor(req), input.edits);
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

function actor(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}

function toolCtx(req: FastifyRequest): AiToolContext {
    return { tenantId: tenantId(req), userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}
