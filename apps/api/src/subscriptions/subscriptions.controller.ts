import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
    cancelSubscriptionSchema,
    changeSubscriptionAmountSchema,
    createSubscriptionPlanSchema,
    createSubscriptionSchema,
    setSubscriptionChargeLogSchema,
    setSubscriptionFieldsSchema,
    updateSubscriptionPlanSchema,
    SUBSCRIPTION_STATUS_OPTIONS,
    type CancelSubscriptionInput,
    type ChangeSubscriptionAmountInput,
    type CreateSubscriptionInput,
    type CreateSubscriptionPlanInput,
    type RecordSubscriptions,
    type SetSubscriptionChargeLogInput,
    type SetSubscriptionFieldsInput,
    type SubscriptionChargeLogStatus,
    type Subscription,
    type SubscriptionFields,
    type SubscriptionFrequencyType,
    type SubscriptionPlan,
    type SubscriptionsOverview,
    type SubscriptionStatus,
    type UpdateSubscriptionPlanInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import type { CollectionActor } from '../collections/collections.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { aclOf } from '../tenancy/acl-of';
import { PlanModule } from '../tenancy/plan-module.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { SubscriptionChargeLogService } from './subscription-charge-log.service';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Suscripciones de la empresa a sus clientes (v0.1.367, ADR-S96). Crear,
 * pausar o cancelar una suscripción es EDITAR el registro; los planes los
 * maneja quien puede editar la conexión de Mercado Pago o PayPal.
 */
@PlanModule('integrations')
@Controller()
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class SubscriptionsController {
    constructor(
        private readonly subs: SubscriptionsService,
        private readonly chargeLog: SubscriptionChargeLogService,
    ) {}

    @Get('subscriptions/plans')
    @RequireCapability('view_records', 'view_own_records')
    async plans(@Req() req: FastifyRequest, @Query('connection_id') connectionId?: string): Promise<{ data: SubscriptionPlan[] }> {
        const id = connectionId ? Number(connectionId) : undefined;
        return { data: await this.subs.listPlans(tenantId(req), actorOf(req), Number.isInteger(id) ? id : undefined) };
    }

    @Post('subscriptions/plans')
    @HttpCode(201)
    createPlan(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createSubscriptionPlanSchema)) input: CreateSubscriptionPlanInput,
    ): Promise<SubscriptionPlan> {
        return this.subs.createPlan(tenantId(req), actorOf(req), input);
    }

    @Patch('subscriptions/plans/:id')
    updatePlan(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateSubscriptionPlanSchema)) input: UpdateSubscriptionPlanInput,
    ): Promise<SubscriptionPlan> {
        return this.subs.updatePlan(tenantId(req), actorOf(req), id, input);
    }

    @Delete('subscriptions/plans/:id')
    @HttpCode(200)
    async deletePlan(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
        await this.subs.deletePlan(tenantId(req), actorOf(req), id);
        return { ok: true };
    }

    /** El resumen de suscripciones de una conexión (sólo quien puede editarla). */
    @Get('collections/connections/:id/subscriptions')
    overview(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<SubscriptionsOverview> {
        return this.subs.overview(tenantId(req), actorOf(req), id);
    }

    @Get('lists/:list/records/:recordId/subscriptions')
    @RequireCapability('view_records', 'view_own_records')
    record(@Req() req: FastifyRequest, @Param('list') list: string, @Param('recordId', ParseIntPipe) recordId: number): Promise<RecordSubscriptions> {
        return this.subs.recordSubscriptions(tenantId(req), actorOf(req), list, recordId);
    }

    @Post('lists/:list/records/:recordId/subscriptions')
    @HttpCode(201)
    @RequireCapability('edit_records', 'edit_own_records')
    create(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Body(new ZodValidationPipe(createSubscriptionSchema)) input: CreateSubscriptionInput,
    ): Promise<Subscription> {
        return this.subs.createForRecord(tenantId(req), actorOf(req), list, recordId, input);
    }

    @Post('subscriptions/:id/pause')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    pause(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<Subscription> {
        return this.subs.pause(tenantId(req), actorOf(req), id);
    }

    @Post('subscriptions/:id/resume')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    resume(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<Subscription> {
        return this.subs.resume(tenantId(req), actorOf(req), id);
    }

    @Post('subscriptions/:id/cancel')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    cancel(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(cancelSubscriptionSchema)) input: CancelSubscriptionInput,
    ): Promise<Subscription> {
        return this.subs.cancel(tenantId(req), actorOf(req), id, input.reason ?? null);
    }

    @Post('subscriptions/:id/amount')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    amount(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(changeSubscriptionAmountSchema)) input: ChangeSubscriptionAmountInput,
    ): Promise<Subscription> {
        return this.subs.changeAmount(tenantId(req), actorOf(req), id, input.amount);
    }

    @Post('subscriptions/:id/verify')
    @HttpCode(200)
    @RequireCapability('view_records', 'view_own_records')
    verify(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<Subscription> {
        return this.subs.verify(tenantId(req), actorOf(req), id);
    }

    @Get('lists/:list/subscriptions/fields')
    @RequireCapability('view_records', 'view_own_records')
    async fields(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ fields: SubscriptionFields | null }> {
        return { fields: await this.subs.getFields(tenantId(req), list) };
    }

    @Put('lists/:list/subscriptions/fields')
    @HttpCode(200)
    @RequireCapability('manage_fields')
    setFields(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(setSubscriptionFieldsSchema)) input: SetSubscriptionFieldsInput,
    ): Promise<SubscriptionFields> {
        return this.subs.setFields(tenantId(req), actorOf(req), list, input);
    }

    @Post('lists/:list/subscriptions/setup')
    @HttpCode(200)
    @RequireCapability('manage_fields')
    setup(@Req() req: FastifyRequest, @Param('list') list: string): Promise<SubscriptionFields> {
        return this.subs.setupFields(tenantId(req), actorOf(req), list);
    }

    /** v0.1.371 — El registro de cobros de la lista: a dónde va cada cobro. */
    @Get('lists/:list/subscriptions/charge-log')
    @RequireCapability('view_records', 'view_own_records')
    chargeLogStatus(@Req() req: FastifyRequest, @Param('list') list: string): Promise<SubscriptionChargeLogStatus> {
        return this.chargeLog.status(tenantId(req), actorOf(req), list);
    }

    @Put('lists/:list/subscriptions/charge-log')
    @HttpCode(200)
    @RequireCapability('manage_fields')
    setChargeLog(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(setSubscriptionChargeLogSchema)) input: SetSubscriptionChargeLogInput,
    ): Promise<SubscriptionChargeLogStatus> {
        return this.chargeLog.configure(tenantId(req), actorOf(req), list, input);
    }
}

/**
 * La página a la que vuelve el cliente después de autorizar el pago en
 * Mercado Pago o PayPal. PÚBLICA: la referencia es aleatoria y sólo muestra lo
 * que el cliente ya sabe (el plan y si quedó activa). Sin scripts: mientras el
 * proveedor confirma, la página se recarga sola unas veces.
 */
@Controller('public/subscriptions')
export class PublicSubscriptionsController {
    constructor(private readonly subs: SubscriptionsService) {}

    @Get(':reference')
    async page(
        @Param('reference') reference: string,
        @Query('n') n: string | undefined,
        @Query('cancelado') cancelled: string | undefined,
        @Res() reply: FastifyReply,
    ): Promise<void> {
        const tries = Math.min(30, Math.max(0, Number(n) || 0));
        const status = await this.subs.publicStatus(reference, { returning: tries < 3 });
        reply
            .status(status ? 200 : 404)
            .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
            .header('Cache-Control', 'no-store')
            .header('X-Robots-Tag', 'noindex, nofollow')
            .type('text/html; charset=utf-8')
            .send(returnPage(status, reference, tries, cancelled === '1'));
    }
}

function esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function money(amount: number, currency: string): string {
    const noCents = ['COP', 'CLP', 'PYG'].includes(currency.toUpperCase());
    const n = new Intl.NumberFormat('es-CO', { minimumFractionDigits: noCents ? 0 : 2, maximumFractionDigits: noCents ? 0 : 2 }).format(amount);
    return `$${n} ${currency.toUpperCase()}`;
}

function every(frequency: number, type: SubscriptionFrequencyType): string {
    if (type === 'days') return frequency === 1 ? 'cada día' : `cada ${frequency} días`;
    if (frequency === 1) return 'cada mes';
    if (frequency === 12) return 'cada año';
    return `cada ${frequency} meses`;
}

/** La página de vuelta (todo escapado). */
export function returnPage(
    s: Awaited<ReturnType<SubscriptionsService['publicStatus']>>,
    reference: string,
    tries: number,
    cancelled = false,
): string {
    let title: string;
    let body: string;
    let refresh = '';
    let action = '';
    if (!s) {
        title = 'No encontramos esta suscripción';
        body = 'El enlace no es válido. Si acabas de autorizar una suscripción, escríbele a la empresa que te la envió.';
    } else {
        const what = `«${esc(s.title)}» por ${esc(money(s.amount, s.currency))} ${esc(every(s.frequency, s.frequencyType))}`;
        const status = s.status as SubscriptionStatus;
        const provider = s.provider === 'paypal' ? 'PayPal' : 'Mercado Pago';
        const how = s.provider === 'paypal' ? 'con tu cuenta PayPal' : 'con la tarjeta que autorizaste';
        if (status === 'pending' && cancelled) {
            // v0.1.373 — el cliente se arrepintió en PayPal: no se le cobró nada.
            title = 'No se completó la suscripción';
            body = `No autorizaste ${what}, así que no se te cobrará nada. Si quieres suscribirte, vuelve a intentarlo.`;
            if (s.url) action = `<a class="btn" href="${esc(s.url)}">Volver a ${provider}</a>`;
        } else if (status === 'pending') {
            if (tries < 24) refresh = `<meta http-equiv="refresh" content="5;url=${esc(`/api/v1/public/subscriptions/${reference}?n=${tries + 1}`)}">`;
            title = 'Estamos confirmando tu suscripción';
            body =
                tries < 24
                    ? `${provider} está confirmando la autorización para ${what}. Esta página se actualiza sola.`
                    : `Todavía no tenemos la confirmación de ${provider} para ${what}. Si completaste la autorización, en unos minutos queda activa; puedes cerrar esta página.`;
        } else if (status === 'active' || status === 'retrying' || status === 'past_due') {
            title = '¡Listo! Tu suscripción quedó activa';
            body = `${provider} te cobrará ${what} ${how}. Puedes cerrar esta página.`;
        } else {
            title = `Tu suscripción está ${esc(SUBSCRIPTION_STATUS_OPTIONS[status]?.label.toLowerCase() ?? status)}`;
            body = `Si tienes dudas sobre ${what}, escríbele a ${s.tenantName ? esc(s.tenantName) : 'la empresa'}.`;
        }
    }
    const brand = s?.tenantName ? `<p class="brand">${esc(s.tenantName)}</p>` : '';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">${refresh}<title>${title}</title><style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
main{max-width:460px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px;box-shadow:0 10px 30px -18px rgba(15,23,42,.35)}
h1{font-size:20px;margin:0 0 10px}p{margin:0;line-height:1.55;color:#334155}.brand{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#64748b;margin-bottom:12px}
.btn{display:inline-block;margin-top:20px;background:#0070ba;color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:999px}
@media (prefers-color-scheme:dark){body{background:#121212;color:#f1f5f9}main{background:#1c1c1c;border-color:#2b2b2b}p{color:#cbd5e1}}
</style></head><body><main>${brand}<h1>${title}</h1><p>${body}</p>${action}</main></body></html>`;
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

function actorOf(req: FastifyRequest): CollectionActor {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}
