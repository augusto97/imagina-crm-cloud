import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
    SHOP_MAX_PUBLIC_PRODUCTS,
    SHOP_PAYMENT_METHOD_LABELS,
    SHOP_TOKEN_RE,
    brandingSchema,
    collectionCurrencyError,
    computeShopCart,
    formatShopMoney,
    readShopConfig,
    shopOnlinePayment,
    shopWhatsappMessage,
    tenantFormatSchema,
    whatsappLink,
    type CaptchaProvider,
    type CollectionConnection,
    type PublicShopMeta,
    type PublicShopOrder,
    type PublicShopOrderInput,
    type PublicShopPayment,
    type PublicShopProduct,
    type ShopCartLineInput,
    type ShopCartResult,
    type ShopConfig,
    type ShopOrderLineSnapshot,
    type ShopPaymentMethod,
} from '@imagina-base/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type Redis from 'ioredis';
import { accessColumns, accessOf } from '../billing/tenant-access';
import { planModuleOff } from '../billing/plan-module-gate';
import { CollectionsService } from '../collections/collections.service';
import { rateKeyForIp } from '../common/client-ip';
import { DataConsentService } from '../data-consent/data-consent.service';
import { DRIZZLE, type Db } from '../db/client';
import { lists, records, shops, tenants, type ShopRow } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { FilesService } from '../files/files.service';
import { CaptchaService } from '../forms/captcha.service';
import { NO_PUBLIC_CACHE, type PublicCacheLike } from '../public-cache/public-cache';
import { PublicCacheService } from '../public-cache/public-cache.service';
import { REDIS } from '../redis/redis.module';
import { incrWithTtl } from '../redis/redis.util';
import { TenantDb } from '../tenancy/tenant-db.service';
import { categoryOrder, productFromRow, resolveCatalogFields } from './shop-catalog';
import { ShopImagesService, type ShopImage, type ShopImageSource } from './shop-images.service';
import { ShopOrdersService, paymentInstructions, type ResolvedShopForOrder } from './shop-orders.service';
import { shopCacheKey } from './shop.service';

/**
 * v0.1.412 (ADR-S103) — La tienda vista desde afuera (sin sesión).
 *
 * El token es la credencial (como formularios y agenda): desconocido,
 * apagado, suspendido, empresa pausada o plan sin tienda → el mismo 404
 * opaco. Lo que se arma por visita (catálogo, fotos, la página) sale de una
 * caché de 30 s compartida; comprar SIEMPRE relee precios y stock de la base.
 */

const PAGE_CACHE_TTL_MS = 30_000;
const MISSING_CACHE_TTL_MS = 15_000;
const STAMP_TTL_MS = 6 * 3600_000;
const MIN_FILL_MS = 3000;

/** Frenos por IP y por tienda (Redis caído → no frena; el sello y la trampa igual corren). */
const ORDER_LIMITS = [
    { scope: 'ip' as const, window: 600, max: 8 },
    { scope: 'ip' as const, window: 86_400, max: 40 },
    { scope: 'shop' as const, window: 3600, max: 600 },
];
const EMAIL_LIMIT = { window: 3600, max: 6 };

export interface ShopPageInfo {
    tenantId: number;
    shop: ShopRow;
    token: string;
    config: ShopConfig;
    company: string;
    tenantSettings: Record<string, unknown>;
    title: string;
    meta: PublicShopMeta;
    products: PublicShopProduct[];
    images: Map<string, ShopImageSource>;
    allowedDomains: string[];
    captchaProvider: CaptchaProvider | null;
    /** v0.1.413 — La cuenta de cobro del pago en línea (null = no se ofrece). */
    onlineConnectionId: number | null;
}

function badRequest(code: string, message: string, extra: Record<string, unknown> = {}): never {
    throw new BadRequestException({ code, message, data: { status: 400, ...extra } });
}

function tooMany(): never {
    throw new HttpException(
        { code: 'rate_limited', message: 'Se hicieron demasiados pedidos en poco tiempo. Espera un rato y vuelve a intentar.', data: { status: 429 } },
        HttpStatus.TOO_MANY_REQUESTS,
    );
}

function sortProducts(list: PublicShopProduct[], sort: ShopConfig['display']['sort']): PublicShopProduct[] {
    const out = [...list];
    const coll = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
    switch (sort) {
        case 'name':
            return out.sort((a, b) => coll.compare(a.title, b.title));
        case 'price_asc':
            return out.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
        case 'price_desc':
            return out.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
        case 'newest':
            return out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));
        default:
            return out;
    }
}

@Injectable()
export class ShopPublicService {
    private readonly logger = new Logger(ShopPublicService.name);
    private readonly pcache: PublicCacheLike;

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly fields: FieldsService,
        private readonly files: FilesService,
        private readonly images: ShopImagesService,
        private readonly orders: ShopOrdersService,
        @Optional() cache?: PublicCacheService,
        @Optional() @Inject(REDIS) private readonly redis?: Redis,
        @Optional() private readonly captcha?: CaptchaService,
        @Optional() private readonly dataConsent?: DataConsentService,
        // v0.1.413 — el pago en línea con la cuenta de cobro del equipo.
        @Optional() private readonly collections?: CollectionsService,
    ) {
        this.pcache = cache ?? NO_PUBLIC_CACHE;
    }

    /**
     * v0.1.413 — La cuenta de cobro del pago en línea, si está encendido y
     * sirve (del equipo, con el módulo de integraciones y en una moneda que el
     * proveedor acepta). Si no, la tienda simplemente no lo ofrece.
     */
    private async onlineConnection(tenantId: number, config: ShopConfig): Promise<CollectionConnection | null> {
        const o = config.payments.online;
        if (!o.enabled || o.connection_id === null || !this.collections) return null;
        const team = await this.collections.teamConnections(tenantId).catch(() => [] as CollectionConnection[]);
        const conn = team.find((c) => c.id === o.connection_id) ?? null;
        if (!conn || collectionCurrencyError(conn.provider, config.currency) !== null) return null;
        return conn;
    }

    cachedInfo(token: string): Promise<ShopPageInfo | null> {
        if (!SHOP_TOKEN_RE.test(token)) return Promise.resolve(null);
        return this.pcache.get(shopCacheKey(token), PAGE_CACHE_TTL_MS, () => this.info(token), MISSING_CACHE_TTL_MS);
    }

    /** Sin caché: comprar no confía en lo que se armó hace 30 s (una tienda recién apagada no vende). */
    freshInfo(token: string): Promise<ShopPageInfo | null> {
        if (!SHOP_TOKEN_RE.test(token)) return Promise.resolve(null);
        return this.info(token);
    }

    private async info(token: string): Promise<ShopPageInfo | null> {
        const [hit] = await this.db
            .select({ shop: shops, ...accessColumns, tenantSettings: tenants.settings, tenantName: tenants.name })
            .from(shops)
            .innerJoin(tenants, eq(tenants.id, shops.tenantId))
            .where(eq(shops.token, token))
            .limit(1);
        if (!hit || !hit.shop.enabled || hit.shop.suspendedAt !== null || hit.archivedAt !== null) return null;
        const access = accessOf(hit);
        // ADR-S87 — una cuenta pausada no sirve lo público; un plan sin tienda tampoco.
        if (access.state === 'locked') return null;
        if (await planModuleOff(this.db, hit.shop.tenantId, 'shop')) return null;
        const tenantId = hit.shop.tenantId;
        const config = readShopConfig(hit.shop.config);
        const settings = (hit.tenantSettings ?? {}) as Record<string, unknown>;
        const branding = brandingSchema.safeParse(settings.branding ?? {});
        const b = branding.success ? branding.data : brandingSchema.parse({});
        const format = tenantFormatSchema.safeParse(settings.format ?? {});
        const company = b.app_name || hit.tenantName;

        const built = await this.loadCatalog(tenantId, hit.shop.listId, config);
        if (!built) return null;

        const keys = config.checkout.captcha && this.captcha ? await this.captcha.resolve(tenantId, settings) : null;
        const consent = this.dataConsent ? await this.dataConsent.active(tenantId, settings) : null;
        const online = await this.onlineConnection(tenantId, config);
        const title = config.texts.title || hit.shop.name;
        const meta = this.buildMeta(config, {
            online: online ? online.provider : null,
            title,
            company,
            logoUrl: config.show_logo && b.logo_file_id ? this.files.signedUrl(tenantId, b.logo_file_id, 24 * 3600) : null,
            accent: config.color ?? b.primary_color ?? '#0e7490',
            numberFormat: format.success ? format.data.number_format : 'dot_comma',
            categories: built.categories,
            truncated: built.truncated,
            captcha: keys ? { provider: keys.provider, site_key: keys.siteKey } : null,
            consent: consent ? DataConsentService.toPublic(consent) : null,
            readOnly: access.state === 'read_only',
        });
        return {
            tenantId,
            shop: hit.shop,
            token,
            config,
            company,
            tenantSettings: settings,
            title,
            meta,
            products: built.products,
            images: built.images,
            allowedDomains: config.allowed_domains,
            captchaProvider: keys?.provider ?? null,
            onlineConnectionId: online?.id ?? null,
        };
    }

    /** Los productos de la lista con los papeles de la tienda (sólo los campos elegidos). */
    private async loadCatalog(
        tenantId: number,
        listId: number,
        config: ShopConfig,
    ): Promise<{ products: PublicShopProduct[]; images: Map<string, ShopImageSource>; categories: string[]; truncated: boolean } | null> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [list] = await tx
                .select({ settings: lists.settings, deletedAt: lists.deletedAt })
                .from(lists)
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId)))
                .limit(1);
            if (!list || list.deletedAt !== null) return null;
            const fields = await this.fields.listByListIdWithinTx(tx, tenantId, listId);
            const rf = resolveCatalogFields(fields, config.catalog, list.settings);
            const rows = await tx
                .select({ id: records.id, data: records.data, createdAt: records.createdAt })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), isNull(records.deletedAt), isNull(records.parentId)))
                .orderBy(asc(records.id))
                .limit(SHOP_MAX_PUBLIC_PRODUCTS + 1);
            const images = new Map<string, ShopImageSource>();
            const products: PublicShopProduct[] = [];
            for (const r of rows.slice(0, SHOP_MAX_PUBLIC_PRODUCTS)) {
                const p = productFromRow({ id: r.id, data: r.data as Record<string, unknown>, createdAt: r.createdAt }, rf);
                if (!p.active) continue;
                if (config.display.hide_sold_out && p.product.stock === 0) continue;
                for (const [k, src] of p.images) images.set(k, src);
                products.push(p.product);
            }
            const order = categoryOrder(rf.category);
            const used = new Set(products.flatMap((p) => p.categories));
            const categories = [...order.filter((c) => used.has(c)), ...[...used].filter((c) => !order.includes(c))];
            return { products: sortProducts(products, config.display.sort), images, categories, truncated: rows.length > SHOP_MAX_PUBLIC_PRODUCTS };
        });
    }

    private buildMeta(
        config: ShopConfig,
        o: {
            title: string;
            company: string;
            logoUrl: string | null;
            accent: string;
            numberFormat: PublicShopMeta['number_format'];
            categories: string[];
            truncated: boolean;
            captcha: PublicShopMeta['captcha'];
            consent: PublicShopMeta['data_consent'];
            readOnly: boolean;
            /** v0.1.413 — El proveedor del pago en línea (null = no se ofrece). */
            online: string | null;
        },
    ): PublicShopMeta {
        const p = config.payments;
        const payments: PublicShopPayment[] = [];
        const add = (method: ShopPaymentMethod, on: boolean): void => {
            if (on) payments.push({ method, label: SHOP_PAYMENT_METHOD_LABELS[method], instructions: paymentInstructions(config, method) });
        };
        // El pago en línea va primero: es el que la persona termina en el momento.
        if (o.online) {
            const t = shopOnlinePayment(o.online);
            payments.push({ method: 'online', label: t.label, instructions: t.instructions });
        }
        add('whatsapp', p.whatsapp.enabled && p.whatsapp.phone !== '');
        add('transfer', p.transfer.enabled);
        add('cod', p.cod.enabled);
        return {
            title: o.title,
            description: config.texts.description,
            company: o.company,
            logo_url: o.logoUrl,
            accent_color: o.accent,
            currency: config.currency,
            number_format: o.numberFormat,
            display: config.display,
            texts: config.texts,
            categories: o.categories,
            delivery: config.delivery
                .filter((d) => d.active && d.name.trim() !== '')
                .map((d) => ({ id: d.id, name: d.name, description: d.description, price: d.price, needs_address: d.needs_address })),
            payments,
            checkout: {
                ask_document: config.checkout.ask_document,
                ask_notes: config.checkout.ask_notes,
                require_terms: config.checkout.require_terms,
                min_order: config.checkout.min_order,
            },
            seller: config.seller,
            policies: config.policies,
            captcha: o.captcha,
            data_consent: o.consent,
            // ADR-S09: una empresa en solo lectura muestra el catálogo pero no recibe pedidos.
            closed: o.readOnly
                ? 'La tienda no está recibiendo pedidos en este momento.'
                : payments.length === 0 || config.orders.list_id === null
                  ? 'La tienda todavía no está lista para recibir pedidos.'
                  : null,
            truncated: o.truncated,
        };
    }

    /**
     * La vista previa del editor: lo que se está editando (sin guardar), con
     * las fotos por URL firmada (la tienda todavía puede no estar publicada).
     */
    async previewData(tenantId: number, shop: ShopRow, rawConfig: unknown): Promise<{ meta: PublicShopMeta; products: PublicShopProduct[] }> {
        const config = readShopConfig({ ...(rawConfig as Record<string, unknown>), orders: readShopConfig(shop.config).orders });
        const [t] = await this.db.select({ settings: tenants.settings, name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        const settings = (t?.settings ?? {}) as Record<string, unknown>;
        const branding = brandingSchema.safeParse(settings.branding ?? {});
        const b = branding.success ? branding.data : brandingSchema.parse({});
        const format = tenantFormatSchema.safeParse(settings.format ?? {});
        const built = (await this.loadCatalog(tenantId, shop.listId, config)) ?? { products: [], images: new Map(), categories: [], truncated: false };
        const url = (key: string): string | null => {
            const src = built.images.get(key);
            if (!src) return null;
            return src.kind === 'file' ? this.files.signedUrl(tenantId, src.fileId, 3600) : src.url;
        };
        const products = built.products.map((p) => ({ ...p, images: p.images.map((i) => url(i.replace(/^img\//, ''))).filter((x): x is string => !!x) }));
        const consent = this.dataConsent ? await this.dataConsent.active(tenantId, settings) : null;
        const online = await this.onlineConnection(tenantId, config);
        const meta = this.buildMeta(config, {
            online: online ? online.provider : null,
            title: config.texts.title || shop.name,
            company: b.app_name || t?.name || '',
            logoUrl: config.show_logo && b.logo_file_id ? this.files.signedUrl(tenantId, b.logo_file_id, 3600) : null,
            accent: config.color ?? b.primary_color ?? '#0e7490',
            numberFormat: format.success ? format.data.number_format : 'dot_comma',
            categories: built.categories,
            truncated: built.truncated,
            captcha: null,
            consent: consent ? DataConsentService.toPublic(consent) : null,
            readOnly: false,
        });
        return { meta: { ...meta, closed: null }, products };
    }

    // ─────────────────────────── Fotos ───────────────────────────

    async image(token: string, key: string, width: Parameters<ShopImagesService['thumb']>[3]): Promise<ShopImage | null> {
        if (!/^[fu][a-z0-9]{1,24}$/.test(key)) return null;
        const info = await this.cachedInfo(token);
        const src = info?.images.get(key);
        if (!info || !src) return null;
        return this.images.thumb(info.tenantId, key, src, width);
    }

    // ─────────────────────────── Comprar ───────────────────────────

    async stamp(token: string): Promise<string | null> {
        const info = await this.cachedInfo(token);
        if (!info) return null;
        const ts = Date.now();
        return `${ts}.${this.files.signParts('shopstamp', info.shop.id, ts)}`;
    }

    private checkStamp(shopId: number, stamp: string): void {
        const [tsRaw, sig] = (stamp ?? '').split('.');
        const ts = Number(tsRaw);
        if (!sig || !Number.isFinite(ts) || !this.files.verifyParts(sig, 'shopstamp', shopId, ts) || Date.now() - ts > STAMP_TTL_MS) {
            badRequest('shop_stale', 'La página de la tienda venció: recárgala y vuelve a intentar.');
        }
        if (Date.now() - ts < MIN_FILL_MS) badRequest('shop_too_fast', 'Espera un momento y vuelve a intentar.');
    }

    /** La cuenta del carrito con lo que hay ahora (estimación: el pedido relee de la base). */
    async quote(token: string, lines: ShopCartLineInput[], deliveryId: string | null): Promise<ShopCartResult | null> {
        const info = await this.cachedInfo(token);
        if (!info) return null;
        const byId = new Map(info.products.map((p) => [p.id, { id: p.id, title: p.title, price: p.price, stock: p.stock }]));
        const delivery = info.meta.delivery.find((d) => d.id === deliveryId);
        return computeShopCart(lines, byId, { shipping: delivery?.price ?? 0, minOrder: info.config.checkout.min_order });
    }

    async placeOrder(
        token: string,
        input: PublicShopOrderInput,
        meta: { ip: string; userAgent: string | null },
    ): Promise<{ order_token: string; number: string; total: number; payment_method: ShopPaymentMethod; whatsapp_path: string | null; pay_url: string | null } | null> {
        const info = await this.freshInfo(token);
        if (!info) return null;
        if (input.website && input.website.trim() !== '') badRequest('shop_stale', 'La página de la tienda venció: recárgala y vuelve a intentar.');
        if (info.meta.closed) badRequest('shop_closed', info.meta.closed);
        this.checkStamp(info.shop.id, input.stamp);
        await this.enforceLimits(info.shop.id, meta.ip, input.customer.email);
        await this.checkCaptcha(info, input.captcha, meta.ip);

        // Ley 1581: la prueba de la autorización se guarda ANTES que el pedido.
        const consent = this.dataConsent ? await this.dataConsent.active(info.tenantId, info.tenantSettings) : null;
        if (consent && input.consent !== true) badRequest('shop_consent', 'Para comprar, acepta la autorización para el tratamiento de tus datos personales.');
        let evidence: { id: number } | null = null;
        if (consent && this.dataConsent) {
            const accepted = await this.dataConsent.acceptedVersion(info.tenantId, undefined, consent);
            evidence = await this.dataConsent.recordShop(info.tenantId, {
                version: accepted.version,
                textHash: accepted.textHash,
                shopName: info.title,
                listId: info.config.orders.list_id ?? info.shop.listId,
                recordId: null,
                email: input.customer.email,
                name: input.customer.name,
                acceptedAt: new Date(),
                ip: meta.ip || null,
                userAgent: meta.userAgent,
            });
        }
        const resolved: ResolvedShopForOrder = {
            tenantId: info.tenantId,
            shop: info.shop,
            config: info.config,
            token,
            company: info.company,
            tenantSettings: info.tenantSettings,
            onlineConnectionId: info.onlineConnectionId,
        };
        try {
            const placed = await this.orders.place(resolved, input);
            if (evidence && this.dataConsent) {
                const rec = await this.orders.findByToken(info.tenantId, placed.order_token);
                if (rec?.recordId) await this.dataConsent.linkRecord(info.tenantId, evidence.id, rec.recordId).catch(() => undefined);
            }
            // El stock cambió: la página que se guarda vuelve a leerlo.
            this.pcache.invalidate(shopCacheKey(token));
            return {
                order_token: placed.order_token,
                number: placed.number,
                total: placed.cart.total,
                payment_method: placed.payment_method,
                whatsapp_path: placed.whatsapp_path,
                pay_url: placed.pay_url,
            };
        } catch (err) {
            if (evidence && this.dataConsent) await this.dataConsent.discard(info.tenantId, evidence.id);
            throw err;
        }
    }

    /**
     * El pedido como lo ve quien compró. v0.1.413 — Con `refresh` (la página
     * pregunta cada pocos segundos al volver de pagar), si el pago en línea
     * sigue pendiente se le pregunta al proveedor: el aviso a veces llega
     * después que la persona, o no llega.
     */
    async order(token: string, orderToken: string, opts: { refresh?: boolean; ip?: string } = {}): Promise<PublicShopOrder | null> {
        const info = await this.cachedInfo(token);
        if (!info) return null;
        if (opts.refresh && (await this.pollAllowed(info.shop.id, opts.ip ?? ''))) {
            await this.orders.refreshPayment(info.tenantId, info.shop.id, orderToken).catch((err: unknown) => {
                this.logger.warn(`Tienda ${info.shop.id}: no se pudo consultar el pago del pedido: ${String(err)}`);
            });
        }
        return this.orders.publicOrder(info.tenantId, info.shop.id, token, orderToken, info.config);
    }

    /** Consultar al proveedor tiene costo: a lo sumo 40 consultas cada 10 minutos por IP y tienda. */
    private async pollAllowed(shopId: number, ip: string): Promise<boolean> {
        if (!this.redis) return true;
        try {
            const n = await incrWithTtl(this.redis, `shoprl:poll:${Math.floor(Date.now() / 600_000)}:${rateKeyForIp(ip)}:${shopId}`, 600);
            return n <= 40;
        } catch {
            return true;
        }
    }

    /** Adónde lleva «Enviar por WhatsApp»: el número nunca viaja a la página. */
    async whatsappUrl(token: string, orderToken: string): Promise<string | null> {
        const info = await this.cachedInfo(token);
        if (!info) return null;
        const phone = info.config.payments.whatsapp.phone;
        if (!info.config.payments.whatsapp.enabled || !phone) return null;
        const row = await this.orders.findByToken(info.tenantId, orderToken);
        if (!row || row.shopId !== info.shop.id || row.paymentMethod !== 'whatsapp') return null;
        const money = (n: number): string => formatShopMoney(n, row.currency, info.meta.number_format);
        const customer = row.customer as Record<string, string>;
        const delivery = row.delivery as { name?: string };
        const text = shopWhatsappMessage(
            {
                number: row.number,
                lines: (row.lines as ShopOrderLineSnapshot[]).map((l) => ({ title: l.title, qty: l.qty, subtotal: l.subtotal })),
                shipping: row.shipping,
                total: row.total,
                delivery: delivery.name ?? '',
                customer: { name: customer.name ?? '', address: customer.address ?? '', city: customer.city ?? '', notes: customer.notes ?? '' },
                url: null,
            },
            info.config.payments.whatsapp.intro,
            money,
        );
        return whatsappLink(phone, text);
    }

    private async enforceLimits(shopId: number, ip: string, email: string): Promise<void> {
        if (!this.redis) return;
        const now = Math.floor(Date.now() / 1000);
        try {
            for (const l of ORDER_LIMITS) {
                const who = l.scope === 'ip' ? `ip:${rateKeyForIp(ip)}:${shopId}` : `shop:${shopId}`;
                const n = await incrWithTtl(this.redis, `shoprl:${l.window}:${Math.floor(now / l.window)}:${who}`, l.window);
                if (n > l.max) tooMany();
            }
            const n = await incrWithTtl(this.redis, `shoprl:mail:${Math.floor(now / EMAIL_LIMIT.window)}:${shopId}:${email.toLowerCase()}`, EMAIL_LIMIT.window);
            if (n > EMAIL_LIMIT.max) tooMany();
        } catch (err) {
            if (err instanceof HttpException) throw err;
            this.logger.warn(`Tienda ${shopId}: sin frenos por Redis (${String(err)}).`);
        }
    }

    private async checkCaptcha(info: ShopPageInfo, token: string | undefined, ip: string): Promise<void> {
        if (!info.config.checkout.captcha || !this.captcha) return;
        const keys = await this.captcha.resolve(info.tenantId, info.tenantSettings);
        if (!keys) return;
        const verdict = await this.captcha.verify(keys, token, ip);
        if (verdict.ok) return;
        if (verdict.reason === 'unavailable') {
            throw new HttpException(
                { code: 'captcha_unavailable', message: 'No pudimos comprobar la verificación en este momento. Prueba de nuevo en un rato.', data: { status: 503 } },
                HttpStatus.SERVICE_UNAVAILABLE,
            );
        }
        badRequest('captcha_failed', verdict.reason === 'reused' ? 'La verificación ya se usó. Complétala de nuevo.' : 'Completa la verificación para comprar.');
    }
}
