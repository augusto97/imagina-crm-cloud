import { Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
    CAPTCHA_PROVIDER_INFO,
    captchaCspSources,
    createShopSchema,
    publicShopOrderSchema,
    publicShopQuoteSchema,
    suspendShopSchema,
    updateShopSchema,
    type CreateShopInput,
    type PublicShopMeta,
    type PublicShopOrder,
    type PublicShopOrderInput,
    type PlatformShopDto,
    type PublicShopProduct,
    type ShopCartResult,
    type ShopDto,
    type ShopOptions,
    type ShopOrderPanelDto,
    type SuspendShopInput,
    type UpdateShopInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { useWebBuild } from '../common/web-build';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV, type Env } from '../config/env';
import { inlineScriptHash, newNonce } from '../forms/form-page';
import { PublicBusyError } from '../public-cache/public-cache';
import { precompress, sendPrecompressed, type Precompressed } from '../public-cache/public-send';
import { RecordsService, type Actor } from '../records/records.service';
import { aclOf } from '../tenancy/acl-of';
import { PlanModule } from '../tenancy/plan-module.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { shopImageWidth } from './shop-images.service';
import { ShopOrdersService } from './shop-orders.service';
import { loadShopClient, renderShopPage, shopNotFoundPage, shopPageCsp } from './shop-page';
import { ShopPublicService, type ShopPageInfo } from './shop-public.service';
import { ShopService } from './shop.service';

/**
 * v0.1.412 (ADR-S103) — Las tiendas de la empresa. Las arma quien administra
 * las listas (`manage_lists`): una tienda crea listas y publica datos de una
 * lista hacia afuera.
 */
@PlanModule('shop')
@Controller('shops')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class ShopsController {
    constructor(
        private readonly shops: ShopService,
        private readonly publicSvc: ShopPublicService,
        private readonly audit: AuditService,
    ) {}

    @Get()
    @RequireCapability('manage_lists')
    async list(@Req() req: FastifyRequest, @Query('list_id') listIdRaw?: string): Promise<{ data: ShopDto[] }> {
        const listId = Number(listIdRaw);
        if (!Number.isSafeInteger(listId) || listId <= 0) return { data: [] };
        return { data: await this.shops.listForList(req.tenant!.tenantId, listId) };
    }

    @Get(':id')
    @RequireCapability('manage_lists')
    get(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<ShopDto> {
        return this.shops.get(req.tenant!.tenantId, id);
    }

    /** Lo que el editor necesita (campos de la lista, personas, otras tiendas) en un pedido. */
    @Get(':id/options')
    @RequireCapability('manage_lists')
    options(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<ShopOptions> {
        return this.shops.options(req.tenant!.tenantId, id);
    }

    /** La vista previa con lo que se está editando (sin guardar). */
    @Post(':id/preview')
    @HttpCode(200)
    @RequireCapability('manage_lists')
    async preview(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(z.object({ config: z.record(z.string(), z.unknown()) }))) input: { config: Record<string, unknown> },
    ): Promise<{ meta: PublicShopMeta; products: PublicShopProduct[] }> {
        const tenantId = req.tenant!.tenantId;
        const row = await this.shops.row(tenantId, id);
        return this.publicSvc.previewData(tenantId, row, input.config);
    }

    @Post()
    @RequireCapability('manage_lists')
    async create(@Req() req: FastifyRequest, @Body(new ZodValidationPipe(createShopSchema)) input: CreateShopInput): Promise<ShopDto> {
        const tenantId = req.tenant!.tenantId;
        const dto = await this.shops.create(tenantId, req.authUserId!, input);
        await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'shop.create', targetType: 'shop', targetLabel: dto.name, meta: { shop_id: dto.id, list_id: dto.list_id } });
        return dto;
    }

    @Patch(':id')
    @RequireCapability('manage_lists')
    async update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateShopSchema)) input: UpdateShopInput,
    ): Promise<ShopDto> {
        const tenantId = req.tenant!.tenantId;
        const { dto, before } = await this.shops.update(tenantId, id, input);
        if (before.enabled !== dto.enabled) {
            await this.audit.log({
                tenantId,
                userId: req.authUserId ?? null,
                action: dto.enabled ? 'shop.publish' : 'shop.unpublish',
                targetType: 'shop',
                targetLabel: dto.name,
                meta: { shop_id: dto.id },
            });
        }
        return dto;
    }

    @Post(':id/regenerate')
    @RequireCapability('manage_lists')
    async regenerate(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<ShopDto> {
        const tenantId = req.tenant!.tenantId;
        const dto = await this.shops.regenerate(tenantId, id);
        await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'shop.regenerate_link', targetType: 'shop', targetLabel: dto.name, meta: { shop_id: dto.id } });
        return dto;
    }

    @Delete(':id')
    @HttpCode(204)
    @RequireCapability('manage_lists')
    async remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
        const tenantId = req.tenant!.tenantId;
        const row = await this.shops.remove(tenantId, id);
        await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'shop.delete', targetType: 'shop', targetLabel: row.name, meta: { shop_id: id } });
    }
}

/**
 * El pedido de un registro de «Pedidos» (el panel de la ficha). Ver: el ACL
 * del registro. Marcar como pagado: poder editarlo.
 */
@PlanModule('shop')
@Controller('lists/:list/records/:id/shop-order')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class RecordShopOrderController {
    constructor(
        private readonly orders: ShopOrdersService,
        private readonly records: RecordsService,
        private readonly audit: AuditService,
    ) {}

    @Get()
    @RequireCapability('view_records', 'view_own_records')
    async get(@Req() req: FastifyRequest, @Param('list') list: string, @Param('id', ParseIntPipe) id: number): Promise<{ data: ShopOrderPanelDto | null }> {
        const tenantId = req.tenant!.tenantId;
        // Casi ningún registro es un pedido: primero lo barato (un índice), y
        // sólo si lo es se chequea que la persona alcance el registro.
        const panel = await this.orders.panel(tenantId, id);
        if (!panel) return { data: null };
        await this.records.get(tenantId, actorOf(req), list, id);
        return { data: panel };
    }

    @Post('mark-paid')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    async markPaid(@Req() req: FastifyRequest, @Param('list') list: string, @Param('id', ParseIntPipe) id: number): Promise<{ data: ShopOrderPanelDto | null }> {
        const tenantId = req.tenant!.tenantId;
        await this.records.checkUpdate(tenantId, actorOf(req), list, id, {});
        const out = await this.orders.markPaid(tenantId, req.authUserId!, id);
        await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'shop.mark_paid', targetType: 'record', targetId: id, targetLabel: out.number, meta: { list } });
        return { data: await this.orders.panel(tenantId, id) };
    }
}

/**
 * Plataforma → Empresas: las tiendas de una empresa y suspender una que se usa
 * mal (estafa, productos prohibidos). Suspendida, la página da 404 y la empresa
 * no la puede volver a publicar.
 */
@Controller('platform/shops')
@UseGuards(SessionGuard, SuperadminGuard)
export class PlatformShopsController {
    constructor(
        private readonly shops: ShopService,
        private readonly audit: AuditService,
    ) {}

    @Get()
    async list(@Query('tenant_id') tenantRaw?: string): Promise<{ data: PlatformShopDto[] }> {
        const tenantId = Number(tenantRaw);
        if (!Number.isSafeInteger(tenantId) || tenantId <= 0) return { data: [] };
        return { data: await this.shops.platformList(tenantId) };
    }

    @Patch(':id')
    async suspend(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(suspendShopSchema)) input: SuspendShopInput,
    ): Promise<{ data: PlatformShopDto[] }> {
        const tenantId = await this.shops.tenantOf(id);
        if (!tenantId) throw notFound();
        const row = await this.shops.setSuspended(tenantId, id, input.suspended, input.reason ?? null);
        await this.audit.log({
            tenantId,
            userId: req.authUserId ?? null,
            action: input.suspended ? 'shop.suspend' : 'shop.unsuspend',
            targetType: 'shop',
            targetLabel: row.name,
            meta: { shop_id: id, reason: input.reason ?? null, by: 'platform' },
        });
        return { data: await this.shops.platformList(tenantId) };
    }
}

function actorOf(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}

const CAPTCHA_SCRIPTS = Object.fromEntries(Object.entries(CAPTCHA_PROVIDER_INFO).map(([k, v]) => [k, v.script_url])) as Record<string, string>;

/**
 * Lo PÚBLICO de la tienda: sin sesión ni empresa. El token opaco es la
 * credencial; uno desconocido, apagado o suspendido responde lo mismo.
 */
@Controller('public/s')
export class PublicShopPageController {
    private readonly rendered = new WeakMap<ShopPageInfo, { body: Precompressed; csp: string }>();
    private hashFor: string | null = null;
    private hash = '';

    constructor(
        private readonly publicSvc: ShopPublicService,
        @Inject(ENV) private readonly env: Env,
    ) {}

    /** La vista previa del editor: arranca vacía y el catálogo llega por postMessage. */
    @Get('preview')
    preview(@Res() reply: FastifyReply): void {
        const client = this.client();
        if (client === undefined) return void this.missing(reply, 503);
        const nonce = newNonce();
        reply
            .header('Content-Security-Policy', shopPageCsp(`'nonce-${nonce}'`, [], { dev: client === null, preview: true }))
            .header('X-Robots-Tag', 'noindex, nofollow')
            .header('Cache-Control', 'no-store')
            .type('text/html; charset=utf-8')
            .send(renderShopPage({ nonce, title: 'Vista previa', token: 'preview', meta: null, products: [], client, captchaScripts: CAPTCHA_SCRIPTS }));
    }

    /** Una foto del catálogo al ancho pedido (160, 320, 640 o 1200). No cambia: se guarda un año. */
    @Get(':token/img/:key/:w')
    async image(@Param('token') token: string, @Param('key') key: string, @Param('w') w: string, @Res() reply: FastifyReply): Promise<void> {
        const width = shopImageWidth(w);
        let img = null;
        if (width) {
            try {
                img = await this.publicSvc.image(token, key, width);
            } catch (err) {
                if (!(err instanceof PublicBusyError)) throw err;
            }
        }
        reply.header('X-Content-Type-Options', 'nosniff').header('X-Robots-Tag', 'noindex');
        if (!img) {
            reply.status(404).header('Cache-Control', 'public, max-age=60').send();
            return;
        }
        reply
            .header('Cache-Control', 'public, max-age=31536000, immutable')
            .header('Content-Security-Policy', "default-src 'none'; sandbox")
            .header('Cross-Origin-Resource-Policy', 'cross-origin')
            .type(img.mime)
            .send(img.bytes);
    }

    /** «Enviar el pedido por WhatsApp»: el número nunca viaja a la página. */
    @Get(':token/wa/:order')
    async whatsapp(@Param('token') token: string, @Param('order') order: string, @Res() reply: FastifyReply): Promise<void> {
        let url: string | null = null;
        if (/^[A-Za-z0-9_-]{20,64}$/.test(order)) {
            try {
                url = await this.publicSvc.whatsappUrl(token, order);
            } catch (err) {
                if (!(err instanceof PublicBusyError)) throw err;
            }
        }
        reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').header('X-Robots-Tag', 'noindex');
        if (!url) return void this.missing(reply, 404);
        reply.redirect(url, 302);
    }

    @Get(':token')
    async page(@Req() req: FastifyRequest, @Param('token') token: string, @Res() reply: FastifyReply): Promise<void> {
        let info: ShopPageInfo | null;
        try {
            info = await this.publicSvc.cachedInfo(token);
        } catch (err) {
            if (err instanceof PublicBusyError) return void this.missing(reply, 503);
            throw err;
        }
        if (!info) return void this.missing(reply, 404);
        const client = this.client();
        if (client === undefined) return void this.missing(reply, 503);
        const page = this.page_(info, client);
        reply
            .header('Content-Security-Policy', page.csp)
            .header('X-Robots-Tag', 'noindex, nofollow')
            .header('Cache-Control', 'public, max-age=30, s-maxage=30, stale-while-revalidate=120')
            .header('Referrer-Policy', 'strict-origin-when-cross-origin');
        sendPrecompressed(req, reply, page.body, 'text/html; charset=utf-8');
    }

    private page_(info: ShopPageInfo, client: string | null): { body: Precompressed; csp: string } {
        const hit = this.rendered.get(info);
        if (hit) return hit;
        const html = renderShopPage({ title: info.title, token: info.token, meta: info.meta, products: info.products, client, captchaScripts: CAPTCHA_SCRIPTS });
        const c = captchaCspSources(info.captchaProvider);
        const out = {
            body: precompress(html),
            csp: shopPageCsp(client === null ? '' : `'${this.clientHash(client)}'`, info.allowedDomains, {
                dev: client === null,
                captchaScript: c.script,
                captchaFrame: c.frame,
                captchaConnect: c.connect,
            }),
        };
        this.rendered.set(info, out);
        return out;
    }

    /** El compilado (null = desarrollo, módulo de vite; undefined = producción sin el build). */
    private client(): string | null | undefined {
        if (!useWebBuild(this.env)) return null;
        return loadShopClient(this.env.WEB_DIST_DIR) ?? undefined;
    }

    private clientHash(client: string): string {
        if (this.hashFor !== client) {
            this.hashFor = client;
            this.hash = inlineScriptHash(client);
        }
        return this.hash;
    }

    private missing(reply: FastifyReply, status: 404 | 503): void {
        reply
            .status(status)
            .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
            .header('X-Robots-Tag', 'noindex')
            .header('Cache-Control', status === 404 ? 'public, max-age=30' : 'no-store')
            .type('text/html; charset=utf-8')
            .send(shopNotFoundPage());
    }
}

/** Lo que la página pública pide por JSON: el sello, la cuenta del carrito, el pedido. */
@Controller('public/shops')
export class PublicShopApiController {
    constructor(private readonly publicSvc: ShopPublicService) {}

    @Get(':token/stamp')
    async stamp(@Param('token') token: string, @Res({ passthrough: true }) reply: FastifyReply): Promise<{ stamp: string }> {
        reply.header('Cache-Control', 'no-store');
        const stamp = await this.publicSvc.stamp(token);
        if (!stamp) throw notFound();
        return { stamp };
    }

    @Post(':token/quote')
    @HttpCode(200)
    async quote(
        @Param('token') token: string,
        @Body(new ZodValidationPipe(publicShopQuoteSchema)) input: z.infer<typeof publicShopQuoteSchema>,
    ): Promise<ShopCartResult> {
        const out = await this.publicSvc.quote(token, input.lines, input.delivery_id ?? null);
        if (!out) throw notFound();
        return out;
    }

    @Post(':token/orders')
    @HttpCode(200)
    async place(
        @Req() req: FastifyRequest,
        @Param('token') token: string,
        @Body(new ZodValidationPipe(publicShopOrderSchema)) input: PublicShopOrderInput,
    ): Promise<{ order_token: string; number: string; total: number; payment_method: string; whatsapp_path: string | null }> {
        const ua = req.headers['user-agent'];
        const out = await this.publicSvc.placeOrder(token, input, { ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 400) : null });
        if (!out) throw notFound();
        return out;
    }

    @Get(':token/orders/:order')
    async order(@Param('token') token: string, @Param('order') order: string, @Res({ passthrough: true }) reply: FastifyReply): Promise<PublicShopOrder> {
        reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex');
        if (!/^[A-Za-z0-9_-]{20,64}$/.test(order)) throw notFound();
        const out = await this.publicSvc.order(token, order);
        if (!out) throw notFound();
        return out;
    }
}

function notFound(): NotFoundException {
    return new NotFoundException({ code: 'not_found', message: 'La tienda no existe o ya no está disponible.', data: { status: 404 } });
}
