import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
    SHOP_MAX_PUBLIC_PRODUCTS,
    SHOP_MY_ORDERS_DAYS,
    SHOP_PAYMENT_METHOD_LABELS,
    SHOP_TOKEN_RE,
    brandingSchema,
    collectionCurrencyError,
    computeShopCart,
    formatShopMoney,
    readShopConfig,
    shopOnlinePayment,
    shopCurrencyDecimals,
    shopImageKeyForFile,
    buildShopDesignCss,
    shopDesignClasses,
    shopDesignFileIds,
    SHOP_DESIGN_IMAGE_MIMES,
    publicRichDoc,
    shopPurchasables,
    shopPlanFor,
    shopServiceFor,
    shopShippingFor,
    shopWhatsappMessage,
    tenantFormatSchema,
    whatsappLink,
    type CaptchaProvider,
    type CollectionConnection,
    type PublicShopConversion,
    type PublicShopMeta,
    type PublicShopMyOrders,
    type PublicShopOrder,
    type PublicShopOrderInput,
    type PublicShopPayment,
    type PublicShopProduct,
    type PublicShopQuote,
    type ShopCartLineInput,
    type ShopStatEvent,
    type ShopConfig,
    type ShopCouponRule,
    type ShopOrderLineSnapshot,
    type ShopPaymentMethod,
    type RichNode,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { accessColumns, accessOf } from '../billing/tenant-access';
import { planModuleOff } from '../billing/plan-module-gate';
import { CollectionsService } from '../collections/collections.service';
import { rateKeyForIp } from '../common/client-ip';
import { DataConsentService } from '../data-consent/data-consent.service';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { attachments, bookingPages, lists, records, shops, tenants, type ShopRow } from '../db/schema';
import { readBookingConfig } from '../booking/booking-config';
import { FieldsService } from '../fields/fields.service';
import { FilesService, assertNewAttachable } from '../files/files.service';
import { CaptchaService } from '../forms/captcha.service';
import { directTags } from '../forms/form-conversion';
import { NO_PUBLIC_CACHE, type PublicCacheLike } from '../public-cache/public-cache';
import { PublicCacheService } from '../public-cache/public-cache.service';
import { REDIS } from '../redis/redis.module';
import { ShopStatsService } from './shop-stats.service';
import { incrWithTtl } from '../redis/redis.util';
import { TenantDb } from '../tenancy/tenant-db.service';
import { attachVariants, categoryOrder, fileIdsOf, productFromRow, resolveCatalogFields, resolveVariantAttributes, type CatalogRow } from './shop-catalog';
import { ShopCouponsService } from './shop-coupons.service';
import { ShopImagesService, type ShopImage, type ShopImageSource } from './shop-images.service';
import { ShopOrdersService, paymentInstructions, type ResolvedShopForOrder } from './shop-orders.service';
import { shopCacheKey, type ShopActor } from './shop.service';

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
/** v0.1.414 — Subtareas que lee el catálogo como variantes (todas las de la página). */
const SHOP_MAX_PUBLIC_VARIANT_ROWS = SHOP_MAX_PUBLIC_PRODUCTS * 10;

/** Frenos por IP y por tienda (Redis caído → no frena; el sello y la trampa igual corren). */
const ORDER_LIMITS = [
    { scope: 'ip' as const, window: 600, max: 8 },
    { scope: 'ip' as const, window: 86_400, max: 40 },
    { scope: 'shop' as const, window: 3600, max: 600 },
];
const EMAIL_LIMIT = { window: 3600, max: 6 };
/** v0.1.415 — Intentos de cupón por IP y tienda cada 10 minutos (los códigos no se adivinan). */
const COUPON_TRIES_PER_10_MIN = 30;

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

function tooMany(message = 'Se hicieron demasiados pedidos en poco tiempo. Espera un rato y vuelve a intentar.'): never {
    throw new HttpException(
        { code: 'rate_limited', message, data: { status: 429 } },
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
        // v0.1.415 — cupones.
        @Optional() private readonly coupons?: ShopCouponsService,
        // v0.1.418 — estadísticas.
        @Optional() private readonly stats?: ShopStatsService,
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
        const hasCoupons = this.coupons ? await this.tenantDb.withTenant(tenantId, (tx) => this.coupons!.hasActive(tx, tenantId, hit.shop.id)) : false;
        const title = config.texts.title || hit.shop.name;
        // v0.1.422 — La foto de la portada se sirve por la misma ruta que las del catálogo.
        const heroId = shopDesignFileIds(config.design)[0] ?? null;
        if (heroId !== null) built.images.set(shopImageKeyForFile(heroId), { kind: 'file', fileId: heroId });
        const meta = this.buildMeta(config, {
            heroImage: heroId !== null ? `img/${shopImageKeyForFile(heroId)}` : null,
            coupons: hasCoupons,
            online: online ? online.provider : null,
            title,
            company,
            logoUrl: config.show_logo && b.logo_file_id ? this.files.signedUrl(tenantId, b.logo_file_id, 24 * 3600) : null,
            accent: config.color ?? b.primary_color ?? '#0e7490',
            numberFormat: format.success ? format.data.number_format : 'dot_comma',
            categories: built.categories,
            truncated: built.truncated,
            downloadable: built.products.some((p) => p.downloadable),
            subscribable: built.products.some((p) => p.kind === 'subscription' && p.subscription),
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
        // v0.1.417 — Los planes de suscripción que se pueden vender (del equipo, activos).
        const plans = this.orders.subscriptions ? await this.orders.subscriptions.shopPlans(tenantId).catch(() => []) : [];
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [list] = await tx
                .select({ settings: lists.settings, deletedAt: lists.deletedAt })
                .from(lists)
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId)))
                .limit(1);
            if (!list || list.deletedAt !== null) return null;
            const fields = await this.fields.listByListIdWithinTx(tx, tenantId, listId);
            const rf = resolveCatalogFields(fields, config.catalog, list.settings, config.kinds);
            // v0.1.416 — La agenda de los servicios (sólo si está publicada y el plan la incluye).
            const agenda = await this.agendaFor(tx, tenantId, config);
            // v0.1.420 — La descripción con formato: el texto (para buscar) y las
            // imágenes subidas que trae (se sirven como las fotos). El documento
            // entero se pide al abrir el producto (`productDescription`).
            const fromDoc = config.description_from === 'record';
            const rows = await tx
                .select({
                    id: records.id,
                    data: records.data,
                    createdAt: records.createdAt,
                    descText: fromDoc ? records.descriptionText : sql<string | null>`null`,
                    descImages: fromDoc
                        ? sql<unknown>`jsonb_path_query_array(${records.description}, 'strict $.** ? (@.type == "imageBlock").attrs.fileId')`
                        : sql<unknown>`null`,
                })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), isNull(records.deletedAt), isNull(records.parentId)))
                .orderBy(asc(records.id))
                .limit(SHOP_MAX_PUBLIC_PRODUCTS + 1);
            const images = new Map<string, ShopImageSource>();
            const products: PublicShopProduct[] = [];
            const top = rows.slice(0, SHOP_MAX_PUBLIC_PRODUCTS);
            // v0.1.414 — Las variantes son subtareas del producto (una consulta para todas).
            const children = new Map<number, CatalogRow[]>();
            if (config.variants.enabled && top.length > 0) {
                const kids = await tx
                    .select({ id: records.id, data: records.data, createdAt: records.createdAt, parentId: records.parentId })
                    .from(records)
                    .where(
                        and(
                            eq(records.tenantId, tenantId),
                            eq(records.listId, listId),
                            isNull(records.deletedAt),
                            inArray(
                                records.parentId,
                                top.map((r) => r.id),
                            ),
                        ),
                    )
                    .orderBy(asc(records.id))
                    .limit(SHOP_MAX_PUBLIC_VARIANT_ROWS);
                for (const k of kids) {
                    if (k.parentId === null) continue;
                    const list = children.get(k.parentId) ?? [];
                    list.push({ id: k.id, data: k.data as Record<string, unknown>, createdAt: k.createdAt });
                    children.set(k.parentId, list);
                }
            }
            const attrs = config.variants.enabled ? resolveVariantAttributes(fields, config.variants.attributes) : [];
            for (const r of top) {
                let p = productFromRow({ id: r.id, data: r.data as Record<string, unknown>, createdAt: r.createdAt }, rf);
                if (!p.active) continue;
                if (fromDoc) {
                    const descImages = fileIdsOf(r.descImages, 40);
                    for (const id of descImages) images.set(shopImageKeyForFile(id), { kind: 'file', fileId: id });
                    const text = (r.descText ?? '').trim();
                    p = {
                        ...p,
                        product: {
                            ...p.product,
                            description: text.slice(0, 4000),
                            ...(text !== '' || descImages.length > 0 ? { rich_description: true } : {}),
                        },
                    };
                }
                const kids = children.get(r.id);
                if (kids && kids.length > 0) p = attachVariants(p, kids, rf, attrs, r.data as Record<string, unknown>);
                if (p.product.kind === 'service') {
                    // Un servicio se agenda: el botón lleva a la agenda con el servicio elegido.
                    const sid = agenda ? shopServiceFor(p.product, config.kinds.service_links, agenda.services) : null;
                    p = { ...p, product: { ...p.product, book_url: agenda && sid ? `/api/v1/public/b/${agenda.token}?servicio=${encodeURIComponent(sid)}` : null } };
                } else if (p.product.kind === 'subscription') {
                    // Una suscripción se contrata sola, con el plan que le toca.
                    const pid = shopPlanFor(p.product, config.kinds.subscription_links, plans, config.currency);
                    const plan = pid !== null ? plans.find((x) => x.id === pid) : undefined;
                    p = {
                        ...p,
                        product: {
                            ...p.product,
                            subscription: plan
                                ? { frequency: plan.frequency, frequency_type: plan.frequency_type, trial_days: plan.trial_days, cycles: plan.cycles, provider: plan.provider ?? 'mercadopago' }
                                : null,
                        },
                    };
                    if (config.display.hide_sold_out && p.product.stock === 0) continue;
                } else if (config.display.hide_sold_out && p.product.stock === 0) continue;
                for (const [k, src] of p.images) images.set(k, src);
                products.push(p.product);
            }
            const order = categoryOrder(rf.category);
            const used = new Set(products.flatMap((p) => p.categories));
            const categories = [...order.filter((c) => used.has(c)), ...[...used].filter((c) => !order.includes(c))];
            return { products: sortProducts(products, config.display.sort), images, categories, truncated: rows.length > SHOP_MAX_PUBLIC_PRODUCTS };
        });
    }

    /** v0.1.416 — La agenda de los servicios, si está publicada y el plan la incluye. */
    private async agendaFor(tx: Tx, tenantId: number, config: ShopConfig): Promise<{ token: string; services: Array<{ id: string; name: string; active: boolean }> } | null> {
        if (config.kinds.booking_page_id === null) return null;
        const [page] = await tx
            .select({ token: bookingPages.token, enabled: bookingPages.enabled, config: bookingPages.config, listDeleted: lists.deletedAt })
            .from(bookingPages)
            .innerJoin(lists, eq(lists.id, bookingPages.listId))
            .where(and(eq(bookingPages.tenantId, tenantId), eq(bookingPages.id, config.kinds.booking_page_id)))
            .limit(1);
        if (!page || !page.enabled || page.listDeleted !== null) return null;
        if (await planModuleOff(this.db, tenantId, 'booking')) return null;
        // Sólo los servicios que la agenda muestra: activos y con alguien que los
        // atienda (el mismo criterio de la página pública de la agenda).
        const cfg = readBookingConfig(page.config);
        const staff = cfg.staff.filter((x) => x.active && (x.kind === 'resource' || x.staff_user_id !== null));
        return {
            token: page.token,
            services: cfg.services.map((sv) => ({
                id: sv.id,
                name: sv.name,
                active: sv.active && staff.some((st) => st.services.length === 0 || st.services.includes(sv.id)),
            })),
        };
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
            /** v0.1.415 — Hay cupones activos. */
            coupons: boolean;
            /** v0.1.416 — Algún producto trae descargas. */
            downloadable?: boolean;
            /** v0.1.417 — Hay productos de suscripción que se pueden contratar. */
            subscribable?: boolean;
            /** v0.1.422 — La foto de la portada (clave de la página o URL firmada en la vista previa). */
            heroImage: string | null;
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
                .map((d) => ({
                    id: d.id,
                    name: d.name,
                    description: d.description,
                    price: d.price,
                    needs_address: d.needs_address,
                    eta: d.eta,
                    free_over: d.free_over,
                    zones: d.zones
                        .filter((z) => z.active && z.name.trim() !== '')
                        .map((z) => ({ id: z.id, name: z.name, price: z.price, free_over: z.free_over, eta: z.eta })),
                })),
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
            coupons: o.coupons,
            ...(o.downloadable ? { downloads: { days: config.kinds.download_days, max: config.kinds.max_downloads } } : {}),
            ...(o.subscribable ? { subscriptions: { address: config.kinds.subscription_address } } : {}),
            conversion: shopPublicConversion(config.conversion),
            // ADR-S09: una empresa en solo lectura muestra el catálogo pero no recibe pedidos.
            closed: o.readOnly
                ? 'La tienda no está recibiendo pedidos en este momento.'
                : payments.length === 0 || config.orders.list_id === null
                  ? 'La tienda todavía no está lista para recibir pedidos.'
                  : null,
            truncated: o.truncated,
            design: {
                css: buildShopDesignCss(config.design, o.accent),
                classes: shopDesignClasses(config.design),
                hero_image: o.heroImage,
                auto: config.design.mode === 'auto',
                product: config.design.product,
                checkout: config.design.checkout,
            },
        };
    }

    /**
     * La vista previa del editor: lo que se está editando (sin guardar), con
     * las fotos por URL firmada (la tienda todavía puede no estar publicada).
     */
    async previewData(tenantId: number, shop: ShopRow, rawConfig: unknown, actor?: ShopActor): Promise<{ meta: PublicShopMeta; products: PublicShopProduct[] }> {
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
        const urls = (list: string[]): string[] => list.map((i) => url(i.replace(/^img\//, ''))).filter((x): x is string => !!x);
        // v0.1.420 — En la vista previa la descripción con formato viaja incluida
        // (no hay token para pedirla), con las imágenes por URL firmada.
        const docs = new Map<number, RichNode | null>();
        if (config.description_from === 'record') {
            const ids = built.products.filter((p) => p.rich_description).slice(0, 60).map((p) => p.id);
            if (ids.length > 0) {
                const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
                    tx
                        .select({ id: records.id, description: records.description })
                        .from(records)
                        .where(and(eq(records.tenantId, tenantId), eq(records.listId, shop.listId), inArray(records.id, ids))),
                );
                for (const r of rows) {
                    docs.set(
                        r.id,
                        publicRichDoc(r.description as RichNode | null, {
                            imageKey: (fileId) => (built.images.has(shopImageKeyForFile(fileId)) ? this.files.signedUrl(tenantId, fileId, 3600) : null),
                        }),
                    );
                }
            }
        }
        const products = built.products.map((p) => ({
            ...p,
            images: urls(p.images),
            ...(docs.has(p.id) ? { description_doc: docs.get(p.id) ?? null } : {}),
            ...(p.variants ? { variants: p.variants.map((v) => ({ ...v, images: urls(v.images) })) } : {}),
        }));
        const consent = this.dataConsent ? await this.dataConsent.active(tenantId, settings) : null;
        const online = await this.onlineConnection(tenantId, config);
        const hasCoupons = this.coupons ? await this.tenantDb.withTenant(tenantId, (tx) => this.coupons!.hasActive(tx, tenantId, shop.id)) : false;
        const heroId = await this.previewHero(tenantId, config, readShopConfig(shop.config), actor);
        const meta = this.buildMeta(config, {
            heroImage: heroId !== null ? this.files.signedUrl(tenantId, heroId, 3600) : null,
            coupons: hasCoupons,
            online: online ? online.provider : null,
            title: config.texts.title || shop.name,
            company: b.app_name || t?.name || '',
            logoUrl: config.show_logo && b.logo_file_id ? this.files.signedUrl(tenantId, b.logo_file_id, 3600) : null,
            accent: config.color ?? b.primary_color ?? '#0e7490',
            numberFormat: format.success ? format.data.number_format : 'dot_comma',
            categories: built.categories,
            truncated: built.truncated,
            downloadable: built.products.some((p) => p.downloadable),
            subscribable: built.products.some((p) => p.kind === 'subscription' && p.subscription),
            captcha: null,
            consent: consent ? DataConsentService.toPublic(consent) : null,
            readOnly: false,
        });
        return { meta: { ...meta, closed: null }, products };
    }

    /**
     * v0.1.422 — La foto de la portada en la vista previa: sólo una imagen de
     * la empresa y, si no es la guardada, un archivo que quien edita puede
     * usar (si no, la vista previa sería una forma de bajar cualquier adjunto).
     */
    private async previewHero(tenantId: number, config: ShopConfig, saved: ShopConfig, actor?: ShopActor): Promise<number | null> {
        const id = shopDesignFileIds(config.design)[0] ?? null;
        if (id === null) return null;
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            if (actor && !actor.isAdmin && !shopDesignFileIds(saved.design).includes(id)) {
                try {
                    await assertNewAttachable(tx, tenantId, actor.file, [id]);
                } catch {
                    return null;
                }
            }
            const [a] = await tx
                .select({ mime: attachments.mime })
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), eq(attachments.id, id)))
                .limit(1);
            return a && SHOP_DESIGN_IMAGE_MIMES.includes(a.mime.toLowerCase()) ? id : null;
        });
    }

    // ─────────────────────── v0.1.420 — Descripción ───────────────────────

    /**
     * La descripción con formato de un producto (el documento del registro),
     * lista para la página: sólo lo que se muestra afuera y con las imágenes
     * por la clave con que la página las pide. null = el producto no está en
     * la tienda o no tiene descripción con formato.
     */
    async productDescription(token: string, productId: number): Promise<RichNode | null> {
        if (!Number.isSafeInteger(productId) || productId <= 0) return null;
        const info = await this.cachedInfo(token);
        if (!info || info.config.description_from !== 'record') return null;
        const product = info.products.find((p) => p.id === productId);
        if (!product?.rich_description) return null;
        return this.pcache.get(
            `${shopCacheKey(token)}:desc:${productId}`,
            PAGE_CACHE_TTL_MS,
            () => this.loadDescription(info, productId),
            MISSING_CACHE_TTL_MS,
        );
    }

    private async loadDescription(info: ShopPageInfo, productId: number): Promise<RichNode | null> {
        const raw = await this.tenantDb.withTenant(info.tenantId, async (tx) => {
            const [row] = await tx
                .select({ description: records.description })
                .from(records)
                .where(and(eq(records.tenantId, info.tenantId), eq(records.listId, info.shop.listId), eq(records.id, productId), isNull(records.deletedAt)))
                .limit(1);
            return row?.description ?? null;
        });
        return publicRichDoc(raw as RichNode | null, {
            // Sólo las imágenes que el catálogo ya sirve (las de los productos).
            imageKey: (fileId) => {
                const key = shopImageKeyForFile(fileId);
                return info.images.has(key) ? `img/${key}` : null;
            },
        });
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

    /**
     * v0.1.418 — Los eventos de estadísticas que manda la página (visitas,
     * productos, carrito, compra). Sólo cuentan los productos que la tienda
     * vende hoy. false = la tienda no existe o no está publicada.
     */
    async recordStats(token: string, events: readonly ShopStatEvent[], ip: string): Promise<boolean> {
        const info = await this.cachedInfo(token);
        if (!info) return false;
        if (!this.stats) return true;
        const ids = new Set(info.products.map((p) => p.id));
        const timeZone = await this.stats.timeZone(info.tenantId);
        await this.stats.record({ tenantId: info.tenantId, shopId: info.shop.id, timeZone }, ip, events, ids);
        return true;
    }

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
    async quote(
        token: string,
        lines: ShopCartLineInput[],
        opts: { deliveryId: string | null; zoneId?: string | null; coupon?: string; ip?: string },
    ): Promise<PublicShopQuote | null> {
        const info = await this.cachedInfo(token);
        if (!info) return null;
        // v0.1.414 — Con variantes, lo que se compra es la variante (el producto no).
        const byId = shopPurchasables(info.products);
        const delivery = info.meta.delivery.find((d) => d.id === opts.deliveryId);
        const ship = shopShippingFor(delivery ?? null, opts.zoneId ?? null);
        // v0.1.415 — El cupón se valida en el servidor (con freno por IP: los códigos no se adivinan).
        let couponRule: ShopCouponRule | null = null;
        let couponError: string | null = null;
        const code = (opts.coupon ?? '').trim();
        if (code !== '') {
            // Freno: sólo cuentan los códigos que fallan (adivinar es lo que hay que frenar).
            await this.couponGuard(info.shop.id, opts.ip ?? '', false);
            if (!this.coupons) couponError = 'Ese cupón no existe o ya no está vigente.';
            else {
                const items = [...byId.values()].map((p) => ({ id: p.id, product_id: p.product.id, categories: p.product.categories }));
                const r = await this.tenantDb.withTenant(info.tenantId, (tx) =>
                    this.coupons!.resolve(tx, info.tenantId, info.shop.id, code, { items, currency: info.config.currency, numberFormat: info.meta.number_format }),
                );
                if (r.ok) couponRule = r.coupon.rule;
                else couponError = r.message;
            }
            if (couponError !== null) await this.couponGuard(info.shop.id, opts.ip ?? '', true);
        }
        const cart = computeShopCart(lines, byId, {
            shipping: ship.price,
            freeOver: ship.free_over,
            minOrder: info.config.checkout.min_order,
            coupon: couponRule,
            decimals: shopCurrencyDecimals(info.config.currency),
        });
        return { ...cart, coupon_error: couponError, coupon_rule: couponRule };
    }

    /**
     * v0.1.415 — Freno de cupones por IP y tienda: `fail` suma un intento
     * fallido; sin `fail` sólo mira si ya se pasó (un código válido no suma).
     */
    private async couponGuard(shopId: number, ip: string, fail: boolean): Promise<void> {
        if (!this.redis) return;
        const key = `shoprl:coupon:${Math.floor(Date.now() / 600_000)}:${rateKeyForIp(ip)}:${shopId}`;
        try {
            const n = fail ? await incrWithTtl(this.redis, key, 600) : Number((await this.redis.get(key)) ?? 0);
            if (n > COUPON_TRIES_PER_10_MIN || (!fail && n >= COUPON_TRIES_PER_10_MIN)) tooMany('Probaste muchos cupones seguidos. Espera unos minutos y vuelve a intentar.');
        } catch (err) {
            if (err instanceof HttpException) throw err;
        }
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

    /** v0.1.416 — Bajar un archivo de un pedido pagado (la tienda tiene que seguir abierta). */
    async download(token: string, orderToken: string, productId: number, fileId: number): Promise<{ url: string } | 'limit' | 'unavailable' | null> {
        const info = await this.cachedInfo(token);
        if (!info) return null;
        return this.orders.download(info.tenantId, info.shop.id, orderToken, productId, fileId, info.config);
    }

    /**
     * v0.1.416 — «Mis pedidos»: si el correo tiene pedidos en esta tienda, le
     * llega un enlace (7 días). La respuesta es la misma haya o no pedidos.
     */
    async requestMyOrders(token: string, email: string, ip: string): Promise<boolean> {
        const info = await this.cachedInfo(token);
        if (!info) return false;
        if (!this.redis) throw new HttpException({ code: 'unavailable', message: 'No podemos mandar el enlace ahora. Intenta en un rato.', data: { status: 503 } }, HttpStatus.SERVICE_UNAVAILABLE);
        const e = email.trim().toLowerCase();
        try {
            const now = Math.floor(Date.now() / 1000);
            const byIp = await incrWithTtl(this.redis, `shoprl:my:ip:${Math.floor(now / 600)}:${rateKeyForIp(ip)}:${info.shop.id}`, 600);
            if (byIp > 5) tooMany('Pediste muchos enlaces seguidos. Espera unos minutos y vuelve a intentar.');
            const byMail = await incrWithTtl(this.redis, `shoprl:my:mail:${Math.floor(now / 3600)}:${info.shop.id}:${e}`, 3600);
            if (byMail > 3) return true; // ya se mandaron varios: no se repite (y no se dice)
        } catch (err) {
            if (err instanceof HttpException) throw err;
        }
        if (!(await this.orders.hasOrders(info.tenantId, info.shop.id, e))) return true;
        const code = randomBytes(24).toString('base64url');
        await this.redis.set(`shopmy:${code}`, JSON.stringify({ t: info.tenantId, s: info.shop.id, e }), 'EX', SHOP_MY_ORDERS_DAYS * 86_400);
        const page = await this.orders.shopPageUrl(info.tenantId, info.shop, token);
        const ctx = { tenantId: info.tenantId, shop: info.shop, config: info.config, token, company: info.company, tenantSettings: info.tenantSettings };
        void this.orders
            .sendMyOrdersLink(ctx, e, `${page}?mis-pedidos=${code}`, SHOP_MY_ORDERS_DAYS)
            .catch((err: unknown) => this.logger.warn(`Tienda ${info.shop.id}: no salió el enlace de «Mis pedidos»: ${String(err)}`));
        return true;
    }

    /** v0.1.416 — Los pedidos del enlace de «Mis pedidos» (sólo de ESTA tienda). */
    async myOrders(token: string, code: string): Promise<PublicShopMyOrders | null> {
        if (!/^[A-Za-z0-9_-]{20,64}$/.test(code) || !this.redis) return null;
        const info = await this.cachedInfo(token);
        if (!info) return null;
        const raw = await this.redis.get(`shopmy:${code}`).catch(() => null);
        if (!raw) return null;
        let v: { t?: unknown; s?: unknown; e?: unknown };
        try {
            v = JSON.parse(raw) as { t?: unknown; s?: unknown; e?: unknown };
        } catch {
            return null;
        }
        if (v.t !== info.tenantId || v.s !== info.shop.id || typeof v.e !== 'string') return null;
        return this.orders.myOrders(info.tenantId, info.shop.id, v.e);
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
                lines: (row.lines as ShopOrderLineSnapshot[]).map((l) => ({ title: l.title, qty: l.qty, subtotal: l.subtotal, ...(l.unit ? { unit: l.unit } : {}) })),
                shipping: row.shipping,
                total: row.total,
                discount: row.discount,
                coupon_code: row.couponCode,
                delivery: delivery.name ?? '',
                customer: { name: customer.name ?? '', address: customer.address ?? '', city: customer.city ?? '', notes: customer.notes ?? '' },
                url: null,
            },
            info.config.payments.whatsapp.intro,
            money,
            info.meta.number_format,
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

/**
 * v0.1.418 — Lo que la página necesita para medir: la etiqueta de Google Ads
 * de la compra, si se avisa al píxel de Meta y las etiquetas del enlace
 * directo. null = sólo los eventos para Tag Manager (salen siempre).
 */
export function shopPublicConversion(c: ShopConfig['conversion']): PublicShopConversion | null {
    const direct = directTags(c);
    if (!c.google_ads && !c.meta_event && !direct) return null;
    return { google_ads: c.google_ads, meta_event: c.meta_event, direct };
}
