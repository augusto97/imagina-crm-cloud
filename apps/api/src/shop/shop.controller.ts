import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, ParseIntPipe, Patch, Post, Query, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import {
    CAPTCHA_PROVIDER_INFO,
    createShopKindColumnSchema,
    createShopSchema,
    customDomainInputSchema,
    generateShopVariantsSchema,
    publicShopMyOrdersRequestSchema,
    publicShopOrderSchema,
    publicShopQuoteSchema,
    SHOP_STATS_RANGES,
    shopCouponInputSchema,
    shopStatEventsSchema,
    suspendShopSchema,
    updateShopSchema,
    type CreateShopInput,
    type CreateShopKindColumnInput,
    type CustomDomainInput,
    type DomainDnsReport,
    type DomainVerifyResult,
    type TenantDomain,
    type GenerateShopVariantsInput,
    type GenerateShopVariantsResult,
    type PublicShopMeta,
    type PublicShopMyOrders,
    type PublicShopOrder,
    type PublicShopOrderInput,
    type PlatformShopDto,
    type PublicShopProduct,
    type PublicShopQuote,
    type ShopCouponDto,
    type ShopCouponInput,
    type ShopDto,
    type ShopOptions,
    type ShopOrderPanelDto,
    type ShopProductVariantsDto,
    type ShopStatEventsInput,
    type ShopStatsDto,
    type ShopVariantProductDto,
    type SuspendShopInput,
    type UpdateShopInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { fetchContextOf, isCrossSiteEmbed } from '../common/hotlink';
import { FileBindingInterceptor } from '../files/file-binding';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { can } from '../authz/can';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { directTagsCsp, pageOrigin } from '../forms/direct-tags';
import { newNonce, type PageCspTags } from '../forms/form-page';
import { PublicBusyError } from '../public-cache/public-cache';
import { precompress, sendPrecompressed, type Precompressed } from '../public-cache/public-send';
import { RecordsService, type Actor } from '../records/records.service';
import { DomainsService } from '../domains/domains.service';
import { assertPlanModule } from '../billing/plan-module-gate';
import { DRIZZLE, type Db } from '../db/client';
import { aclOf } from '../tenancy/acl-of';
import { PlanModule } from '../tenancy/plan-module.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { shopImageWidth } from './shop-images.service';
import { ShopCouponsService } from './shop-coupons.service';
import { ShopOrdersService } from './shop-orders.service';
import { renderShopPage, shopMessagePage, shopNotFoundPage, shopPageCsp } from './shop-page';
import { ShopPublicService, type ShopPageInfo } from './shop-public.service';
import { ShopVariantsService } from './shop-variants.service';
import { ShopPageAssets } from './shop-page-assets';
import { ShopSiteService } from './shop-site.service';
import { ShopService, type ShopActor } from './shop.service';
import { ShopStatsService } from './shop-stats.service';

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
        private readonly variants: ShopVariantsService,
        private readonly couponsSvc: ShopCouponsService,
        private readonly statsSvc: ShopStatsService,
        private readonly domains: DomainsService,
        private readonly site: ShopSiteService,
        @Inject(DRIZZLE) private readonly db: Db,
    ) {}

    // ── v0.1.423: el dominio propio de la tienda (y ahí sí, en Google) ──────

    @Get(':id/domain')
    @RequireCapability('manage_lists')
    async getDomain(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<TenantDomain> {
        const out = await this.domains.getForShop(req.tenant!.tenantId, id);
        if (!out) throw shopNotFound();
        return out;
    }

    /** Pedir un dominio: queda pendiente hasta el TXT (SEC-32). Sólo un administrador. */
    @Patch(':id/domain')
    @RequireCapability('manage_lists')
    async setDomain(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(customDomainInputSchema)) input: CustomDomainInput,
    ): Promise<TenantDomain> {
        const tenantId = this.assertDomainAdmin(req);
        await assertPlanModule(this.db, tenantId, 'custom_domain');
        const out = await this.domains.setShop(tenantId, id, input.domain);
        if (!out) throw shopNotFound();
        await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'shop.domain_change', targetType: 'shop', targetLabel: input.domain, meta: { shop_id: id } });
        return out;
    }

    @Post(':id/domain/verify')
    @HttpCode(200)
    @RequireCapability('manage_lists')
    async verifyDomain(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<DomainVerifyResult> {
        const tenantId = this.assertDomainAdmin(req);
        await assertPlanModule(this.db, tenantId, 'custom_domain');
        const out = await this.domains.verifyShop(tenantId, id);
        if (!out) throw shopNotFound();
        if (out.verified) {
            await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'shop.domain_verified', targetType: 'shop', targetLabel: out.domain.domain ?? '', meta: { shop_id: id } });
            this.site.forget(out.domain.domain);
        }
        return out;
    }

    @Delete(':id/domain')
    @RequireCapability('manage_lists')
    async clearDomain(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<TenantDomain> {
        const tenantId = this.assertDomainAdmin(req);
        const before = await this.domains.getForShop(tenantId, id);
        const out = await this.domains.clearShop(tenantId, id);
        if (!out) throw shopNotFound();
        await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'shop.domain_change', targetType: 'shop', targetLabel: '(sin dominio propio)', meta: { shop_id: id } });
        this.site.forget(before?.domain);
        return out;
    }

    /** CNAME en vivo + si el dominio ya abre la tienda. 404 sin dominio. */
    @Get(':id/domain/dns')
    @RequireCapability('manage_lists')
    async domainDns(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<DomainDnsReport> {
        const out = await this.domains.shopDnsReport(req.tenant!.tenantId, id);
        if (!out) throw new NotFoundException({ code: 'domain_not_configured', message: 'Esta tienda todavía no tiene un dominio propio.', data: { status: 404 } });
        return out;
    }

    private assertDomainAdmin(req: FastifyRequest): number {
        if (req.tenant!.role !== 'admin') {
            throw new ForbiddenException({ code: 'admin_only', message: 'El dominio de la tienda lo configura un administrador de la empresa.', data: { status: 403 } });
        }
        return req.tenant!.tenantId;
    }

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

    /** v0.1.418 — Estadísticas: visitas, embudo, productos, de dónde llegan y lo vendido (`days` = 7, 30 o 90). */
    @Get(':id/stats')
    @RequireCapability('manage_lists')
    async stats(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number, @Query('days') daysRaw?: string): Promise<ShopStatsDto> {
        const tenantId = req.tenant!.tenantId;
        const n = Number(daysRaw);
        const days = (SHOP_STATS_RANGES as readonly number[]).includes(n) ? n : 30;
        const t = await this.shops.statsTarget(tenantId, id);
        return this.statsSvc.summary({ tenantId, shopId: id, timeZone: await this.statsSvc.timeZone(tenantId), currency: t.currency, titleKey: t.titleKey }, days);
    }

    /** v0.1.414 — Los productos para elegir a cuál crearle variantes. */
    @Get(':id/products')
    @RequireCapability('manage_lists')
    async products(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number, @Query('q') q?: string): Promise<{ data: ShopVariantProductDto[] }> {
        return { data: await this.variants.products(req.tenant!.tenantId, id, String(q ?? '').slice(0, 120)) };
    }

    /** v0.1.414 — Un producto con sus variantes, leídas con los atributos del editor (`attributes=1,2`). */
    @Get(':id/products/:productId/variants')
    @RequireCapability('manage_lists')
    productVariants(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Param('productId', ParseIntPipe) productId: number,
        @Query('attributes') attrsRaw?: string,
    ): Promise<ShopProductVariantsDto> {
        const attrs = String(attrsRaw ?? '')
            .split(',')
            .map((x) => Number(x))
            .filter((n) => Number.isSafeInteger(n) && n > 0)
            .slice(0, 3);
        return this.variants.forProduct(req.tenant!.tenantId, id, productId, attrs);
    }

    /** v0.1.414 — Crea las combinaciones que faltan como subtareas del producto. */
    @Post(':id/products/:productId/variants')
    @HttpCode(200)
    @RequireCapability('manage_lists')
    async generateVariants(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Param('productId', ParseIntPipe) productId: number,
        @Body(new ZodValidationPipe(generateShopVariantsSchema)) input: GenerateShopVariantsInput,
    ): Promise<GenerateShopVariantsResult> {
        const tenantId = req.tenant!.tenantId;
        const out = await this.variants.generate(tenantId, actorOf(req), id, productId, input);
        if (out.created > 0) {
            await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'shop.variants_create', targetType: 'record', targetId: productId, meta: { shop_id: id, created: out.created } });
        }
        return out;
    }

    /** v0.1.415 — Los cupones de la tienda, con cuántas veces se usaron. */
    @Get(':id/coupons')
    @RequireCapability('manage_lists')
    async coupons(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: ShopCouponDto[] }> {
        return { data: await this.couponsSvc.list(req.tenant!.tenantId, id) };
    }

    @Post(':id/coupons')
    @RequireCapability('manage_lists')
    async createCoupon(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(shopCouponInputSchema)) input: ShopCouponInput,
    ): Promise<ShopCouponDto> {
        const tenantId = req.tenant!.tenantId;
        const out = await this.couponsSvc.create(tenantId, req.authUserId!, id, input);
        await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'shop.coupon_create', targetType: 'shop', targetId: id, targetLabel: out.code, meta: { kind: out.kind } });
        return out;
    }

    @Patch(':id/coupons/:couponId')
    @RequireCapability('manage_lists')
    async updateCoupon(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Param('couponId', ParseIntPipe) couponId: number,
        @Body(new ZodValidationPipe(shopCouponInputSchema)) input: ShopCouponInput,
    ): Promise<ShopCouponDto> {
        const tenantId = req.tenant!.tenantId;
        const { dto } = await this.couponsSvc.update(tenantId, id, couponId, input);
        await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'shop.coupon_update', targetType: 'shop', targetId: id, targetLabel: dto.code, meta: { coupon_id: couponId } });
        return dto;
    }

    @Delete(':id/coupons/:couponId')
    @RequireCapability('manage_lists')
    async removeCoupon(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number, @Param('couponId', ParseIntPipe) couponId: number): Promise<{ ok: true }> {
        const tenantId = req.tenant!.tenantId;
        const row = await this.couponsSvc.remove(tenantId, id, couponId);
        await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'shop.coupon_delete', targetType: 'shop', targetId: id, targetLabel: row.code, meta: { coupon_id: couponId } });
        return { ok: true };
    }

    /** La vista previa con lo que se está editando (sin guardar). */
    @Post(':id/preview')
    @HttpCode(200)
    // v0.1.427 — las fotos de la vista previa (tienda quizá sin publicar) sólo
    // las abre el navegador de quien está editando.
    @UseInterceptors(FileBindingInterceptor)
    @RequireCapability('manage_lists')
    async preview(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(z.object({ config: z.record(z.string(), z.unknown()) }))) input: { config: Record<string, unknown> },
    ): Promise<{ meta: PublicShopMeta; products: PublicShopProduct[] }> {
        const tenantId = req.tenant!.tenantId;
        const row = await this.shops.row(tenantId, id);
        return this.publicSvc.previewData(tenantId, row, input.config, shopActor(req));
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
        const { dto, before } = await this.shops.update(tenantId, id, input, shopActor(req));
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

    /**
     * v0.1.416 — Crear la columna «Tipo de producto» o «Archivo para
     * descargar» en el catálogo. Agrega una columna: además de armar tiendas
     * hay que poder gestionar campos.
     */
    /**
     * v0.1.418 — Las columnas «Llegó desde» y «Campaña» en Pedidos (una tienda
     * creada antes de esta versión). Crear columnas pide poder gestionar campos.
     */
    @Post(':id/origin-columns')
    @RequireCapability('manage_lists')
    async createOriginColumns(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<ShopDto> {
        const tenantId = req.tenant!.tenantId;
        if (!can({ role: req.tenant!.role, ...aclOf(req) }, 'manage_fields')) {
            throw new ForbiddenException({ code: 'forbidden', message: 'Crear una columna requiere poder gestionar los campos.', data: { status: 403 } });
        }
        await this.shops.ensureOrderColumns(tenantId, id, 'origin');
        const dto = await this.shops.get(tenantId, id);
        await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'shop.origin_columns', targetType: 'shop', targetLabel: dto.name, meta: { shop_id: id } });
        return dto;
    }

    /** v0.1.429 — Crear las columnas de las unidades (Unidad de venta, mínimo, máximo, de a cuánto) en el catálogo. */
    @Post(':id/unit-columns')
    @RequireCapability('manage_lists')
    async createUnitColumns(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<ShopDto> {
        const tenantId = req.tenant!.tenantId;
        if (!can({ role: req.tenant!.role, ...aclOf(req) }, 'manage_fields')) {
            throw new ForbiddenException({ code: 'forbidden', message: 'Crear una columna requiere poder gestionar los campos.', data: { status: 403 } });
        }
        const dto = await this.shops.createUnitColumns(tenantId, id);
        await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'shop.unit_columns', targetType: 'shop', targetLabel: dto.name, meta: { shop_id: id } });
        return dto;
    }

    @Post(':id/kind-columns')
    @RequireCapability('manage_lists')
    async createKindColumn(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(createShopKindColumnSchema)) input: CreateShopKindColumnInput,
    ): Promise<ShopDto> {
        const tenantId = req.tenant!.tenantId;
        if (!can({ role: req.tenant!.role, ...aclOf(req) }, 'manage_fields')) {
            throw new ForbiddenException({ code: 'forbidden', message: 'Crear una columna requiere poder gestionar los campos.', data: { status: 403 } });
        }
        const dto = await this.shops.createKindColumn(tenantId, id, input.role);
        await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'shop.kind_column', targetType: 'shop', targetLabel: dto.name, meta: { shop_id: id, role: input.role } });
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
        // v0.1.423 — su dominio queda para sacar del servidor (y la consola avisa).
        const before = await this.domains.getForShop(tenantId, id);
        await this.domains.clearShop(tenantId, id);
        this.site.forget(before?.domain);
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

    /** v0.1.416 — Volver a mandar el correo con las descargas a quien compró. */
    @Post('resend-downloads')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    async resendDownloads(@Req() req: FastifyRequest, @Param('list') list: string, @Param('id', ParseIntPipe) id: number): Promise<{ data: ShopOrderPanelDto | null }> {
        const tenantId = req.tenant!.tenantId;
        await this.records.checkUpdate(tenantId, actorOf(req), list, id, {});
        const out = await this.orders.resendDownloads(tenantId, id);
        await this.audit.log({ tenantId, userId: req.authUserId ?? null, action: 'shop.resend_downloads', targetType: 'record', targetId: id, targetLabel: out.number, meta: { list } });
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

/** v0.1.422 — Quién guarda el estilo (el CSS propio es de administradores; la portada, un archivo que puede usar). */
function shopActor(req: FastifyRequest): ShopActor {
    return { isAdmin: req.tenant!.role === 'admin', file: { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) } };
}

function actorOf(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}

function shopNotFound(): NotFoundException {
    return new NotFoundException({ code: 'shop_not_found', message: 'Esa tienda no existe.', data: { status: 404 } });
}

const CAPTCHA_SCRIPTS = Object.fromEntries(Object.entries(CAPTCHA_PROVIDER_INFO).map(([k, v]) => [k, v.script_url])) as Record<string, string>;

/**
 * Lo PÚBLICO de la tienda: sin sesión ni empresa. El token opaco es la
 * credencial; uno desconocido, apagado o suspendido responde lo mismo.
 */
@Controller('public/s')
export class PublicShopPageController {
    private readonly rendered = new WeakMap<ShopPageInfo, { body: Precompressed; csp: string }>();

    constructor(
        private readonly publicSvc: ShopPublicService,
        private readonly assets: ShopPageAssets,
        private readonly site: ShopSiteService,
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

    /** Una foto del catálogo al ancho pedido (160, 320, 640, 1200 o 1600). No cambia: se guarda un año. */
    @Get(':token/img/:key/:w')
    async image(@Req() req: FastifyRequest, @Param('token') token: string, @Param('key') key: string, @Param('w') w: string, @Res() reply: FastifyReply): Promise<void> {
        // v0.1.427 — la foto se ve en la tienda (su dirección, su dominio o
        // insertada en un sitio: el marco es de la tienda); una página de OTRO
        // sitio no la puede usar como su imagen.
        if (isCrossSiteEmbed(fetchContextOf(req))) {
            reply.status(403).header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').send();
            return;
        }
        const width = shopImageWidth(w);
        let img = null;
        if (width) {
            try {
                img = await this.publicSvc.image(token, key, width);
            } catch (err) {
                if (!(err instanceof PublicBusyError)) throw err;
            }
        }
        // v0.1.423 — Pedida por el dominio propio de la tienda (y la tienda se deja
        // mostrar en Google): la foto también, para que aparezca con el producto.
        const indexable = img ? await this.site.indexableImageHost(req.host, token).catch(() => false) : false;
        reply.header('X-Content-Type-Options', 'nosniff').header('X-Robots-Tag', indexable ? 'all' : 'noindex');
        if (!img) {
            reply.status(404).header('Cache-Control', 'public, max-age=60').send();
            return;
        }
        reply
            .header('Cache-Control', 'public, max-age=31536000, immutable')
            .header('Content-Security-Policy', "default-src 'none'; sandbox")
            .header('Cross-Origin-Resource-Policy', 'same-site')
            .type(img.mime)
            .send(img.bytes);
    }

    /**
     * v0.1.420 — La descripción con formato de un producto (el documento del
     * registro): la ficha la pide al abrirse. Sólo productos de esa tienda.
     */
    @Get(':token/desc/:pid')
    async description(@Param('token') token: string, @Param('pid') pid: string, @Res() reply: FastifyReply): Promise<void> {
        let doc = null;
        if (/^[1-9]\d{0,15}$/.test(pid)) {
            try {
                doc = await this.publicSvc.productDescription(token, Number(pid));
            } catch (err) {
                if (!(err instanceof PublicBusyError)) throw err;
                reply.status(503).header('Cache-Control', 'no-store').send({ message: 'Hay muchas visitas en este momento.' });
                return;
            }
        }
        reply.header('X-Robots-Tag', 'noindex').header('X-Content-Type-Options', 'nosniff');
        if (!doc) {
            reply.status(404).header('Cache-Control', 'public, max-age=30').send({ doc: null });
            return;
        }
        reply.header('Cache-Control', 'public, max-age=30').send({ doc });
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

    /**
     * v0.1.416 — Bajar un archivo comprado: el token del pedido es la
     * credencial. Lleva a una URL firmada de 5 minutos; si ya no se puede
     * (tope de descargas, vencido, sin pagar), una página que lo dice.
     */
    @Get(':token/d/:order/:pid/:fid')
    async download(
        @Param('token') token: string,
        @Param('order') order: string,
        @Param('pid') pidRaw: string,
        @Param('fid') fidRaw: string,
        @Res() reply: FastifyReply,
    ): Promise<void> {
        const pid = Number(pidRaw);
        const fid = Number(fidRaw);
        reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').header('X-Robots-Tag', 'noindex');
        if (!/^[A-Za-z0-9_-]{20,64}$/.test(order) || !Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(fid) || fid <= 0) {
            return void this.missing(reply, 404);
        }
        let out: Awaited<ReturnType<ShopPublicService['download']>> = null;
        try {
            out = await this.publicSvc.download(token, order, pid, fid);
        } catch (err) {
            if (err instanceof PublicBusyError) return void this.missing(reply, 503);
            throw err;
        }
        if (!out) return void this.missing(reply, 404);
        if (out === 'limit' || out === 'unavailable') {
            const back = `/api/v1/public/s/${token}?pedido=${order}`;
            reply
                .status(out === 'limit' ? 429 : 410)
                .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
                .type('text/html; charset=utf-8')
                .send(
                    out === 'limit'
                        ? shopMessagePage('Llegaste al tope de descargas', 'Ya bajaste este archivo las veces que permite la tienda. Si lo necesitas de nuevo, escríbele a la tienda.', back)
                        : shopMessagePage('Esta descarga no está disponible', 'El pedido todavía no está pagado, se canceló o ya pasó el plazo para descargar. Si crees que es un error, escríbele a la tienda.', back),
                );
            return;
        }
        reply.redirect(out.url, 302);
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
        // v0.1.418 — con etiquetas en el enlace directo, la CSP se limita a la
        // ruta pública de ESTE origen y la ventana queda en su propio grupo.
        const tags = info.meta.conversion?.direct ?? null;
        const csp = tags ? this.csp(info, client, { csp: directTagsCsp(tags), origin: pageOrigin(req.protocol, req.host) }) : page.csp;
        reply
            .header('Content-Security-Policy', csp)
            .header('X-Robots-Tag', 'noindex, nofollow')
            .header('Cache-Control', 'public, max-age=30, s-maxage=30, stale-while-revalidate=120')
            .header('Referrer-Policy', 'strict-origin-when-cross-origin');
        if (tags) reply.header('Cross-Origin-Opener-Policy', 'same-origin');
        sendPrecompressed(req, reply, page.body, 'text/html; charset=utf-8');
    }

    private csp(info: ShopPageInfo, client: string | null, tags: PageCspTags | null): string {
        return this.assets.csp(info, client, tags);
    }

    private page_(info: ShopPageInfo, client: string | null): { body: Precompressed; csp: string } {
        const hit = this.rendered.get(info);
        if (hit) return hit;
        const html = renderShopPage({ title: info.title, token: info.token, meta: info.meta, products: info.products, client, captchaScripts: CAPTCHA_SCRIPTS });
        const out = { body: precompress(html), csp: this.csp(info, client, null) };
        this.rendered.set(info, out);
        return out;
    }

    private client(): string | null | undefined {
        return this.assets.client();
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

    /**
     * v0.1.418 — Estadísticas: la página manda lo que pasó (visitas,
     * productos, carrito, compra). Siempre 204: las estadísticas nunca le
     * cuestan una respuesta a nadie.
     */
    @Post(':token/events')
    @HttpCode(204)
    async events(
        @Req() req: FastifyRequest,
        @Param('token') token: string,
        @Body(new ZodValidationPipe(shopStatEventsSchema)) input: ShopStatEventsInput,
        @Res({ passthrough: true }) reply: FastifyReply,
    ): Promise<void> {
        reply.header('Cache-Control', 'no-store');
        const ok = await this.publicSvc.recordStats(token, input.events, req.ip);
        if (!ok) throw notFound();
    }

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
        @Req() req: FastifyRequest,
    ): Promise<PublicShopQuote> {
        const out = await this.publicSvc.quote(token, input.lines, {
            deliveryId: input.delivery_id ?? null,
            zoneId: input.zone_id ?? null,
            coupon: input.coupon,
            ip: req.ip,
        });
        if (!out) throw notFound();
        return out;
    }

    @Post(':token/orders')
    @HttpCode(200)
    async place(
        @Req() req: FastifyRequest,
        @Param('token') token: string,
        @Body(new ZodValidationPipe(publicShopOrderSchema)) input: PublicShopOrderInput,
    ): Promise<{ order_token: string; number: string; total: number; payment_method: string; whatsapp_path: string | null; pay_url: string | null }> {
        const ua = req.headers['user-agent'];
        const out = await this.publicSvc.placeOrder(token, input, { ip: req.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 400) : null });
        if (!out) throw notFound();
        return out;
    }

    /**
     * v0.1.416 — «Mis pedidos»: manda el enlace al correo si tiene pedidos en
     * esta tienda. La respuesta es la misma en los dos casos.
     */
    @Post(':token/my-orders')
    @HttpCode(202)
    async requestMyOrders(
        @Req() req: FastifyRequest,
        @Param('token') token: string,
        @Body(new ZodValidationPipe(publicShopMyOrdersRequestSchema)) input: z.infer<typeof publicShopMyOrdersRequestSchema>,
        @Res({ passthrough: true }) reply: FastifyReply,
    ): Promise<{ ok: true }> {
        reply.header('Cache-Control', 'no-store');
        if (input.website) return { ok: true }; // campo trampa: no se dice nada
        const ok = await this.publicSvc.requestMyOrders(token, input.email, req.ip);
        if (!ok) throw notFound();
        return { ok: true };
    }

    @Get(':token/my-orders/:code')
    async myOrders(@Param('token') token: string, @Param('code') code: string, @Res({ passthrough: true }) reply: FastifyReply): Promise<PublicShopMyOrders> {
        reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex').header('Referrer-Policy', 'no-referrer');
        const out = await this.publicSvc.myOrders(token, code);
        if (!out) throw new NotFoundException({ code: 'my_orders_expired', message: 'Este enlace ya no sirve. Pide uno nuevo desde la tienda.', data: { status: 404 } });
        return out;
    }

    /** v0.1.413 — Con `?refresh=1` (al volver de pagar en línea) se le pregunta al proveedor cómo va el pago. */
    @Get(':token/orders/:order')
    async order(
        @Req() req: FastifyRequest,
        @Param('token') token: string,
        @Param('order') order: string,
        @Query('refresh') refresh: string | undefined,
        @Res({ passthrough: true }) reply: FastifyReply,
    ): Promise<PublicShopOrder> {
        reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex');
        if (!/^[A-Za-z0-9_-]{20,64}$/.test(order)) throw notFound();
        const out = await this.publicSvc.order(token, order, { refresh: refresh === '1', ip: req.ip });
        if (!out) throw notFound();
        return out;
    }
}

function notFound(): NotFoundException {
    return new NotFoundException({ code: 'not_found', message: 'La tienda no existe o ya no está disponible.', data: { status: 404 } });
}
