import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Logger, Param, ParseIntPipe, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
    agencyBillingSettingsSchema,
    createAgencyChargeSchema,
    payAgencyPlanSchema,
    type AgencyCharge,
    type CreateAgencyChargeInput,
    type PayAgencyPlanInput,
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
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AllowReadOnly } from '../tenancy/allow-read-only.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AgencyBillingService } from './agency-billing.service';
import { AgencyChargesService } from './agency-charges.service';
import { AgencyClientsListService } from './agency-clients-list.service';
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
    private readonly logger = new Logger(AgencyController.name);

    constructor(
        private readonly agency: AgencyService,
        private readonly billing: AgencyBillingService,
        private readonly charges: AgencyChargesService,
        private readonly clientsList: AgencyClientsListService,
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
        // Un cliente de la API (o una pestaña con la versión anterior) que no manda
        // `online` no apaga el cobro en línea: se conserva lo guardado.
        const raw = req.body as Record<string, unknown> | null;
        const keepOnline = !raw || typeof raw !== 'object' || !('online' in raw);
        const saved = await this.billing.updateSettings(agencyId, req.authUserId!, input, { keepOnline });
        // v0.1.452 — cobrar en línea necesita la lista «Empresas cliente» (de ahí cuelgan los links).
        if (saved.online.connection_id !== null) {
            await this.clientsList.ensure(agencyId, req.authUserId!).catch((err: unknown) => this.logger.warn(`Agencia ${agencyId}: no se armó la lista de empresas cliente: ${String(err)}`));
        }
        return { data: await this.agency.overview(agencyId) };
    }

    /** v0.1.452 — Armar (o rearmar) la lista «Empresas cliente» de la agencia. */
    @Post('clients-list')
    @HttpCode(200)
    async ensureClientsList(@Req() req: FastifyRequest): Promise<{ data: AgencyOverview }> {
        const agencyId = assertAgencyAdmin(req);
        await this.clientsList.ensure(agencyId, req.authUserId!);
        await this.clientsList.syncAll(agencyId);
        return { data: await this.agency.overview(agencyId) };
    }

    // ── v0.1.452 — cobrar en línea ─────────────────────────────────────

    @Get('clients/:id/charges')
    async chargesOf(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: AgencyCharge[] }> {
        const agencyId = assertAgencyAdmin(req);
        await this.agency.clientOf(agencyId, req.authUserId!, id);
        return { data: await this.charges.list(agencyId, id) };
    }

    /** Un link de pago para el cliente (o el que ya estaba pendiente, si es igual). */
    @Post('clients/:id/charges')
    async createCharge(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(createAgencyChargeSchema)) input: CreateAgencyChargeInput,
    ): Promise<{ data: { charge: AgencyCharge; reused: boolean; client: AgencyClient } }> {
        const agencyId = assertAgencyAdmin(req);
        const out = await this.charges.create(agencyId, id, { months: input.months, amount: input.amount, via: 'agency', userId: req.authUserId!, sendEmail: input.send_email });
        return { data: { ...out, client: await this.agency.clientOf(agencyId, req.authUserId!, id) } };
    }

    @Delete('clients/:id/charges/:chargeId')
    async cancelCharge(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Param('chargeId', ParseIntPipe) chargeId: number,
    ): Promise<{ data: AgencyCharge[] }> {
        const agencyId = assertAgencyAdmin(req);
        await this.charges.cancel(agencyId, req.authUserId!, id, chargeId);
        return { data: await this.charges.list(agencyId, id) };
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
    constructor(
        private readonly billing: AgencyBillingService,
        private readonly charges: AgencyChargesService,
    ) {}

    @Get()
    @AllowReadOnly()
    async mine(@Req() req: FastifyRequest, @Query('refresh') refresh?: string): Promise<{ data: MyAgencyBilling | null }> {
        const t = assertClientAdmin(req);
        const base = await this.billing.mine(t);
        if (!base) return { data: null };
        // v0.1.452 — con `refresh` (volvió de pagar) se le pregunta al proveedor por el link pendiente.
        return { data: { ...base, online: await this.charges.onlineFor(t, { refresh: refresh === '1' }) } };
    }

    /**
     * v0.1.452 — Pagar desde la app: N períodos del plan, al valor que decide el
     * servidor. Vale en sólo lectura (es justo cuando más hace falta).
     */
    @Post('pay')
    @HttpCode(200)
    @AllowReadOnly()
    async pay(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(payAgencyPlanSchema)) input: PayAgencyPlanInput,
    ): Promise<{ data: AgencyCharge }> {
        const t = assertClientAdmin(req);
        return { data: await this.charges.payAsClient(t, req.authUserId!, input.periods) };
    }
}

function assertClientAdmin(req: FastifyRequest): number {
    const t = req.tenant!;
    if (t.role !== 'admin' || req.apiToken) {
        throw new ForbiddenException({ code: 'forbidden', message: 'Sólo un administrador ve y paga el plan de la empresa', data: { status: 403 } });
    }
    return t.tenantId;
}

/**
 * v0.1.452 — La vuelta del checkout de un cobro de agencia: le pregunta al
 * proveedor si ya entró el pago (el aviso a veces llega después) y lleva a la
 * persona a su app, en Suscripción. Sin sesión (la abre el navegador al volver
 * de pagar); sólo redirige: no muestra nada de la empresa.
 */
@Controller('public/agency-pay')
export class PublicAgencyPayController {
    constructor(private readonly charges: AgencyChargesService) {}

    @Get(':reference')
    async back(@Param('reference') reference: string, @Res() reply: FastifyReply): Promise<void> {
        const url = await this.charges.returnFromCheckout(reference).catch(() => null);
        await reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').redirect(url ?? '/', 302);
    }
}
