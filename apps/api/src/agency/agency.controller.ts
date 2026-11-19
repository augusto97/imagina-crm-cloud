import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import {
    agencyBillingSettingsSchema,
    createAgencyClientSchema,
    registerAgencyPaymentSchema,
    setAgencyClientBillingSchema,
    type AgencyBillingSettings,
    type AgencyPayment,
    type MyAgencyBilling,
    type RegisterAgencyPaymentInput,
    type SetAgencyClientBillingInput,
    helpSupportSchema,
    updateAgencyClientSchema,
    type AgencyClient,
    type AgencyEnterResult,
    type AgencyOverview,
    type CreateAgencyClientInput,
    type HelpSupport,
    type UpdateAgencyClientInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AllowReadOnly } from '../tenancy/allow-read-only.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AgencyBillingService } from './agency-billing.service';
import { AgencyService, notAgency } from './agency.service';

/**
 * v0.1.449 (I3, ADR-S108) — La consola de la agencia. Sólo un ADMIN DIRECTO
 * de una empresa marcada como agencia (no alguien que entró «por» otra
 * agencia, no una sesión de un token de la API).
 */
function assertAgencyAdmin(req: FastifyRequest): number {
    const t = req.tenant!;
    if (!t.isAgency) throw notAgency();
    if (t.role !== 'admin' || t.viaAgency || req.apiToken) {
        throw new ForbiddenException({
            code: 'agency_admin_only',
            message: 'Sólo un administrador de la agencia puede gestionar sus empresas cliente',
            data: { status: 403 },
        });
    }
    return t.tenantId;
}

@Controller('agency')
@UseGuards(SessionGuard, TenantGuard)
export class AgencyController {
    constructor(
        private readonly agency: AgencyService,
        private readonly billing: AgencyBillingService,
    ) {}

    @Get()
    overview(@Req() req: FastifyRequest): Promise<{ data: AgencyOverview }> {
        return this.agency.overview(assertAgencyAdmin(req)).then((data) => ({ data }));
    }

    /** v0.1.450 — el contacto de soporte que ven sus clientes en «Ayuda». */
    @Get('support')
    support(@Req() req: FastifyRequest): Promise<{ data: HelpSupport }> {
        return this.agency.support(assertAgencyAdmin(req)).then((data) => ({ data }));
    }

    @Put('support')
    setSupport(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(helpSupportSchema)) input: HelpSupport,
    ): Promise<{ data: HelpSupport }> {
        return this.agency.setSupport(assertAgencyAdmin(req), req.authUserId!, input).then((data) => ({ data }));
    }

    @Get('clients')
    clients(@Req() req: FastifyRequest): Promise<{ data: AgencyClient[] }> {
        return this.agency.listClients(assertAgencyAdmin(req), req.authUserId!).then((data) => ({ data }));
    }

    @Post('clients')
    create(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createAgencyClientSchema)) input: CreateAgencyClientInput,
    ): Promise<{ data: AgencyClient }> {
        return this.agency.createClient(assertAgencyAdmin(req), req.authUserId!, input).then((data) => ({ data }));
    }

    @Patch('clients/:id')
    update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateAgencyClientSchema)) input: UpdateAgencyClientInput,
    ): Promise<{ data: AgencyClient }> {
        return this.agency.updateClient(assertAgencyAdmin(req), req.authUserId!, id, input).then((data) => ({ data }));
    }

    // ── v0.1.451 — el cobro a los clientes ─────────────────────────────

    /** Los planes de la agencia y sus reglas de cobro (gracia, avisos). */
    @Put('billing')
    async setBilling(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(agencyBillingSettingsSchema)) input: AgencyBillingSettings,
    ): Promise<{ data: AgencyOverview }> {
        const agencyId = assertAgencyAdmin(req);
        await this.billing.updateSettings(agencyId, req.authUserId!, input);
        return { data: await this.agency.overview(agencyId) };
    }

    /** Asignar o quitar el plan de un cliente, ajustar su valor o su «pagado hasta». */
    @Patch('clients/:id/billing')
    async setClientBilling(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(setAgencyClientBillingSchema)) input: SetAgencyClientBillingInput,
    ): Promise<{ data: AgencyClient }> {
        const agencyId = assertAgencyAdmin(req);
        await this.billing.setClientBilling(agencyId, req.authUserId!, id, input);
        return { data: await this.agency.clientOf(agencyId, req.authUserId!, id) };
    }

    @Get('clients/:id/payments')
    payments(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: AgencyPayment[] }> {
        return this.billing.listPayments(assertAgencyAdmin(req), id).then((data) => ({ data }));
    }

    /** Registrar un pago (a mano): extiende el «pagado hasta». */
    @Post('clients/:id/payments')
    async registerPayment(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(registerAgencyPaymentSchema)) input: RegisterAgencyPaymentInput,
    ): Promise<{ data: { payment: AgencyPayment; client: AgencyClient } }> {
        const agencyId = assertAgencyAdmin(req);
        const payment = await this.billing.registerPayment(agencyId, req.authUserId!, id, input);
        return { data: { payment, client: await this.agency.clientOf(agencyId, req.authUserId!, id) } };
    }

    /** Deshacer el último pago (vuelve el «pagado hasta» de antes). */
    @Delete('clients/:id/payments/:paymentId')
    async undoPayment(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Param('paymentId', ParseIntPipe) paymentId: number,
    ): Promise<{ data: AgencyClient }> {
        const agencyId = assertAgencyAdmin(req);
        await this.billing.undoPayment(agencyId, req.authUserId!, id, paymentId);
        return { data: await this.agency.clientOf(agencyId, req.authUserId!, id) };
    }

    /** Entrar a ver un cliente también se puede con la agencia en sólo lectura. */
    @Post('clients/:id/enter')
    @HttpCode(200)
    @AllowReadOnly()
    enter(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: AgencyEnterResult }> {
        return this.agency.enter(assertAgencyAdmin(req), req.authUserId!, id).then((data) => ({ data }));
    }
}

/**
 * v0.1.451 — Lo que ve una empresa CLIENTE de su cobro con la agencia (plan,
 * pagado hasta, pagos). Sólo sus administradores; también en sólo lectura
 * (justo cuando más importa saber por qué).
 */
@Controller('workspaces/current/agency-billing')
@UseGuards(SessionGuard, TenantGuard)
export class AgencyClientBillingController {
    constructor(private readonly billing: AgencyBillingService) {}

    @Get()
    @AllowReadOnly()
    async mine(@Req() req: FastifyRequest): Promise<{ data: MyAgencyBilling | null }> {
        const t = req.tenant!;
        if (t.role !== 'admin') {
            throw new ForbiddenException({ code: 'forbidden', message: 'Sólo un administrador ve el plan de la empresa', data: { status: 403 } });
        }
        return { data: await this.billing.mine(t.tenantId) };
    }
}
