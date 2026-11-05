import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
    createPaymentLinkSchema,
    setCollectionFieldsSchema,
    type SetCollectionFieldsInput,
    type CollectionConnection,
    type CollectionConnectionDetail,
    type CollectionFields,
    type CreatePaymentLinkInput,
    type PaymentLink,
    type RecordPayments,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CollectionsService, type CollectionActor, type PaypalPayOutcome } from './collections.service';
import { renderPaypalPayPage } from './paypal-pay-page';
import { aclOf } from '../tenancy/acl-of';
import { PlanModule } from '../tenancy/plan-module.decorator';

/**
 * Cobros de la empresa a sus clientes (v0.1.251, ADR-S31). Crear un link es
 * EDITAR el registro (queda escrito en él); verlo, verlo.
 */
@PlanModule('integrations')
@Controller()
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class CollectionsController {
    constructor(private readonly collections: CollectionsService) {}

    @Get('collections/connections')
    @RequireCapability('view_records', 'view_own_records')
    async connections(@Req() req: FastifyRequest): Promise<{ data: CollectionConnection[] }> {
        return { data: await this.collections.connectionsFor(tenantId(req), actorOf(req)) };
    }

    /** El panel «Cobros» de una conexión (sólo quien puede editarla). */
    @Get('collections/connections/:id')
    async connection(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<CollectionConnectionDetail> {
        return this.collections.connectionDetail(tenantId(req), actorOf(req), id);
    }

    @Get('lists/:list/records/:recordId/payments')
    @RequireCapability('view_records', 'view_own_records')
    record(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
    ): Promise<RecordPayments> {
        return this.collections.recordPayments(tenantId(req), actorOf(req), list, recordId);
    }

    @Post('lists/:list/records/:recordId/payments')
    @HttpCode(201)
    @RequireCapability('edit_records', 'edit_own_records')
    create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Body(new ZodValidationPipe(createPaymentLinkSchema)) input: CreatePaymentLinkInput,
    ): Promise<PaymentLink> {
        return this.collections.createForRecord(tenantId(req), actorOf(req), list, recordId, input);
    }

    @Post('payment-links/:id/verify')
    @HttpCode(200)
    @RequireCapability('view_records', 'view_own_records')
    verify(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<PaymentLink> {
        return this.collections.verifyLink(tenantId(req), actorOf(req), id);
    }

    @Post('payment-links/:id/cancel')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    cancel(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<PaymentLink> {
        return this.collections.cancelLink(tenantId(req), actorOf(req), id);
    }

    /** v0.1.365 — Las columnas donde la lista guarda el cobro. */
    @Get('lists/:list/collections/fields')
    @RequireCapability('view_records', 'view_own_records')
    async fields(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ fields: CollectionFields | null }> {
        return { fields: await this.collections.getFields(tenantId(req), list) };
    }

    /** v0.1.365 — Elegir las columnas: una existente, una nueva o ninguna. */
    @Put('lists/:list/collections/fields')
    @HttpCode(200)
    @RequireCapability('manage_fields')
    setFields(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(setCollectionFieldsSchema)) input: SetCollectionFieldsInput,
    ): Promise<CollectionFields> {
        return this.collections.setFields(tenantId(req), actorOf(req), list, input);
    }

    /** Usa las columnas de cobro que la lista ya tenga y crea las que falten. */
    @Post('lists/:list/collections/setup')
    @HttpCode(200)
    @RequireCapability('manage_fields')
    setup(@Req() req: FastifyRequest, @Param('list') list: string): Promise<CollectionFields> {
        return this.collections.setupFields(tenantId(req), actorOf(req), list);
    }
}

/**
 * Avisos de pago de Mercado Pago y Wompi. PÚBLICO: el token de la URL dice de
 * qué conexión es; el estado del pago se RELEE del proveedor con la
 * credencial de esa empresa (y Wompi además firma el aviso).
 */
@Controller('public/collections')
export class CollectionHooksController {
    constructor(private readonly collections: CollectionsService) {}

    @Post(':token')
    @HttpCode(200)
    async receive(
        @Param('token') token: string,
        @Query() query: Record<string, unknown>,
        @Body() body: unknown,
    ): Promise<{ ok: true }> {
        await this.collections.handleHook(token, query ?? {}, body ?? {});
        return { ok: true };
    }
}

/**
 * v0.1.372 — El link de pago de PayPal que recibe el cliente. PÚBLICO: la
 * referencia (aleatoria) es la llave. Abrirlo lleva a PayPal con una orden
 * vigente; al volver, la app CAPTURA la orden aprobada (aprobar no es pagar) y
 * muestra el resultado o vuelve al formulario que lo armó.
 */
@Controller('public/pay')
export class PublicPayController {
    constructor(private readonly collections: CollectionsService) {}

    @Get(':reference')
    async visit(@Param('reference') reference: string, @Res() reply: FastifyReply): Promise<void> {
        await send(reply, await this.collections.paypalVisit(reference));
    }

    @Get(':reference/return')
    async back(@Param('reference') reference: string, @Query('token') token: string | undefined, @Res() reply: FastifyReply): Promise<void> {
        await send(reply, await this.collections.paypalReturn(reference, typeof token === 'string' ? token : null));
    }

    @Get(':reference/cancel')
    async cancel(@Param('reference') reference: string, @Res() reply: FastifyReply): Promise<void> {
        await send(reply, await this.collections.paypalCancel(reference));
    }
}

async function send(reply: FastifyReply, out: PaypalPayOutcome): Promise<void> {
    reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex, nofollow').header('Referrer-Policy', 'no-referrer');
    if (out.kind === 'redirect') {
        await reply.redirect(out.url, 302);
        return;
    }
    await reply
        .status(out.page.state === 'not_found' ? 404 : 200)
        .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        .type('text/html; charset=utf-8')
        .send(renderPaypalPayPage(out.page));
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

function actorOf(req: FastifyRequest): CollectionActor {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}
