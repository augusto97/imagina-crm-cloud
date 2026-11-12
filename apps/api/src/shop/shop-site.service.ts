import { Injectable, Logger, Optional } from '@nestjs/common';
import {
    formatShopMoney,
    parseShopProductPath,
    shopCurrencyDecimals,
    shopProductPath,
    shopVariantPriceRange,
    type PublicShopProduct,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainsService, type ShopHost } from '../domains/domains.service';
import { directTagsCsp } from '../forms/direct-tags';
import { escapeHtml } from '../forms/form-page';
import { NO_PUBLIC_CACHE, PublicBusyError, type PublicCacheLike } from '../public-cache/public-cache';
import { PublicCacheService } from '../public-cache/public-cache.service';
import { precompress, sendPrecompressed, type Precompressed } from '../public-cache/public-send';
import { renderShopPage, shopMessagePage, type ShopSiteHead } from './shop-page';
import { ShopPageAssets } from './shop-page-assets';
import { ShopPublicService, type ShopPageInfo } from './shop-public.service';

/** Las rutas que el servidor web le pasa a la app (ver deploy/nginx.conf y deploy/Caddyfile). */
export type ShopSiteRoute = 'home' | 'product' | 'sitemap' | 'robots' | 'probe';

/** El mismo texto que `apps/web/public/robots.txt` (la app no se indexa; ver v0.1.331). */
export const PLATFORM_ROBOTS_TXT = [
    '# La app no se indexa: cada página responde con «noindex» (la cabecera',
    '# X-Robots-Tag del servidor y la etiqueta <meta name="robots"> de la app).',
    '# Se deja rastrear a propósito: si se bloqueara aquí, los buscadores no',
    '# podrían leer ese «noindex» y podrían listar las direcciones igual.',
    'User-agent: *',
    'Allow: /',
    '',
].join('\n');

const HOST_TTL_MS = 30_000;
const HOST_MISSING_TTL_MS = 15_000;
/** Páginas de producto guardadas por tienda (cada una lleva el catálogo entero en el arranque). */
const PRODUCT_PAGES_PER_SHOP = 48;

/**
 * v0.1.423 (ADR-S103) — La tienda en SU dominio: el único lugar de la app que
 * se deja indexar. El servidor web le pasa `/`, `/p/…`, `/sitemap.xml`,
 * `/robots.txt` y `/_imagina/site`; en un host que no es el de una tienda,
 * `/`, `/p/…` y `/sitemap.xml` responden 404 al instante y el servidor web
 * sirve la app (nginx `error_page 404`, Caddy `handle_response`).
 *
 * Lo que ve un buscador: título, descripción, dirección canónica, Open Graph,
 * datos estructurados (la tienda y cada producto) y el contenido en HTML
 * (nombres, precios y enlaces a cada producto) antes de ejecutar la tienda.
 */
@Injectable()
export class ShopSiteService {
    private readonly logger = new Logger(ShopSiteService.name);
    private readonly pcache: PublicCacheLike;
    private readonly homes = new WeakMap<ShopPageInfo, Map<string, { body: Precompressed; csp: string; head: ShopSiteHead }>>();

    constructor(
        private readonly publicSvc: ShopPublicService,
        private readonly domains: DomainsService,
        private readonly assets: ShopPageAssets,
        @Optional() cache?: PublicCacheService,
    ) {
        this.pcache = cache ?? NO_PUBLIC_CACHE;
    }

    /** Host → tienda, guardado unos segundos (cada `/` de la app pasa por aquí). */
    shopForHost(rawHost: string | undefined): Promise<ShopHost | null> {
        const host = (rawHost ?? '').split(',')[0]!.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
        if (!host || host === 'localhost' || /^[\d.]+$/.test(host) || host.includes('[')) return Promise.resolve(null);
        return this.pcache.getUngated(`shophost:${host}`, HOST_TTL_MS, () => this.domains.resolveShopHost(host), HOST_MISSING_TTL_MS);
    }

    /** ¿Esta foto se pidió por el dominio de SU tienda y la tienda se deja indexar? */
    async indexableImageHost(rawHost: string | undefined, token: string): Promise<boolean> {
        const shop = await this.shopForHost(rawHost);
        if (!shop || shop.token !== token) return false;
        const info = await this.info(shop);
        return info !== null && info.config.seo.index;
    }

    /** Lo que cambió (verificar, quitar): el host se vuelve a resolver en todos los servidores. */
    forget(...domains: Array<string | null | undefined>): void {
        for (const d of domains) if (d) this.pcache.invalidate(`shophost:${d.toLowerCase()}`);
    }

    async handle(route: ShopSiteRoute, req: FastifyRequest, reply: FastifyReply): Promise<void> {
        let shop: ShopHost | null;
        try {
            shop = await this.shopForHost(req.host);
        } catch (err) {
            this.logger.warn(`No se pudo resolver el host ${req.host}: ${String(err)}`);
            shop = null;
        }
        reply.header('X-Content-Type-Options', 'nosniff');
        if (route === 'probe') {
            reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex').send({ ok: true, shop_id: shop?.shopId ?? null });
            return;
        }
        if (route === 'robots') {
            reply.header('Cache-Control', 'public, max-age=3600').type('text/plain; charset=utf-8');
            if (!shop) return void reply.send(PLATFORM_ROBOTS_TXT);
            const info = await this.info(shop).catch(() => null);
            const indexable = info !== null && info.config.seo.index;
            reply.send(['User-agent: *', 'Allow: /', ...(indexable ? ['', `Sitemap: https://${shop.domain}/sitemap.xml`] : []), ''].join('\n'));
            return;
        }
        // En un host que no es el de una tienda: que el servidor web sirva la app.
        if (!shop) return void reply.status(404).header('Cache-Control', 'no-store').type('text/plain; charset=utf-8').send('Not found');

        let info: ShopPageInfo | null;
        try {
            info = await this.info(shop);
        } catch (err) {
            if (!(err instanceof PublicBusyError)) this.logger.warn(`Tienda ${shop.shopId}: ${String(err)}`);
            return void this.message(reply, 503, 'Hay muchas visitas en este momento', 'Vuelve a intentar en unos segundos.');
        }
        // Apagada o suspendida después de resolver el host: el mismo aviso (410: no reintentar).
        if (!info) return void this.message(reply, 410, 'Esta tienda no está disponible', 'Puede que la tienda ya no esté abierta.');

        if (route === 'sitemap') {
            if (!info.config.seo.index) return void this.message(reply, 410, 'Sin mapa del sitio', 'Esta tienda no se muestra en buscadores.');
            reply.header('Cache-Control', 'public, max-age=600').header('X-Robots-Tag', 'noindex').type('application/xml; charset=utf-8').send(sitemapXml(shop.domain, info.products));
            return;
        }

        let productId: number | null = null;
        if (route === 'product') {
            const path = routePathname(req);
            productId = parseShopProductPath(path);
            const p = productId !== null ? info.products.find((x) => x.id === productId) : undefined;
            if (!p) return void this.message(reply, 410, 'Este producto ya no está', 'Puede que se haya agotado o que la tienda lo haya quitado.', '/');
            const canonical = shopProductPath(p.title, p.id);
            if (canonical !== path) return void reply.header('Cache-Control', 'public, max-age=300').redirect(`${canonical}${queryOf(req)}`, 301);
        }

        const client = this.assets.client();
        if (client === undefined) return void this.message(reply, 503, 'La tienda no está disponible ahora', 'Vuelve a intentar en un momento.');
        const page = this.page(info, shop, productId, client);
        // Con etiquetas en el enlace directo, la CSP se limita a la ruta pública de este origen (como en la plataforma).
        const tags = info.meta.conversion?.direct ?? null;
        const csp = tags ? this.assets.csp(info, client, { csp: directTagsCsp(tags), origin: `https://${shop.domain}` }) : page.csp;
        reply
            .header('Content-Security-Policy', csp)
            .header('X-Robots-Tag', page.head.index ? 'index, follow' : 'noindex, nofollow')
            .header('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300')
            .header('Referrer-Policy', 'strict-origin-when-cross-origin');
        if (tags) reply.header('Cross-Origin-Opener-Policy', 'same-origin');
        sendPrecompressed(req, reply, page.body, 'text/html; charset=utf-8');
    }

    private info(shop: ShopHost): Promise<ShopPageInfo | null> {
        return this.publicSvc.cachedInfo(shop.token).then((info) => (info && info.shop.id === shop.shopId ? info : null));
    }

    private page(info: ShopPageInfo, shop: ShopHost, productId: number | null, client: string | null): { body: Precompressed; csp: string; head: ShopSiteHead } {
        let pages = this.homes.get(info);
        if (!pages) {
            pages = new Map();
            this.homes.set(info, pages);
        }
        const key = `${shop.domain}|${productId ?? 0}`;
        const hit = pages.get(key);
        if (hit) return hit;
        const head = siteHeadFor(info, shop.domain, productId);
        const html = renderShopPage({ title: head.title, token: info.token, meta: info.meta, products: info.products, client, captchaScripts: {}, site: head });
        const out = { body: precompress(html), csp: this.assets.csp(info, client, null), head };
        if (pages.size >= PRODUCT_PAGES_PER_SHOP) pages.clear();
        pages.set(key, out);
        return out;
    }

    private message(reply: FastifyReply, status: 410 | 503, title: string, text: string, home: string | null = null): void {
        reply
            .status(status)
            .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
            .header('X-Robots-Tag', 'noindex')
            .header('Cache-Control', status === 503 ? 'no-store' : 'public, max-age=60')
            .type('text/html; charset=utf-8')
            .send(shopMessagePage(title, text, home, 'Ir a la tienda'));
    }
}

/** La ruta tal como llegó (sin la consulta). */
function routePathname(req: FastifyRequest): string {
    const raw = req.raw.url ?? '/';
    const q = raw.indexOf('?');
    return q === -1 ? raw : raw.slice(0, q);
}

function queryOf(req: FastifyRequest): string {
    const raw = req.raw.url ?? '';
    const q = raw.indexOf('?');
    return q === -1 ? '' : raw.slice(q).slice(0, 2000);
}

/** El texto de un producto para buscadores: sin saltos ni espacios de más, cortado en una palabra. */
function snippet(text: string, max = 160): string {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max - 1);
    const sp = cut.lastIndexOf(' ');
    return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trim()}…`;
}

function priceString(n: number, currency: string): string {
    return n.toFixed(shopCurrencyDecimals(currency));
}

function imageUrl(origin: string, token: string, src: string | undefined): string | null {
    if (!src || !src.startsWith('img/')) return null;
    return `${origin}/api/v1/public/s/${token}/${src}/1200`;
}

/** La cabecera (y el HTML visible sin JavaScript) del inicio o de un producto. */
export function siteHeadFor(info: ShopPageInfo, domain: string, productId: number | null): ShopSiteHead {
    const origin = `https://${domain}`;
    const meta = info.meta;
    const seo = info.config.seo;
    const shopTitle = seo.title || meta.title || info.title;
    const shopDesc = snippet(seo.description || meta.description || '');
    const index = seo.index;
    const money = (n: number): string => formatShopMoney(n, meta.currency, meta.number_format);
    const store = {
        '@context': 'https://schema.org',
        '@type': 'OnlineStore',
        name: meta.company || shopTitle,
        url: `${origin}/`,
    };
    const p = productId !== null ? info.products.find((x) => x.id === productId) : undefined;
    if (!p) {
        const items = info.products
            .slice(0, 200)
            .map((x) => `<li><a href="${escapeHtml(shopProductPath(x.title, x.id))}">${escapeHtml(x.title)}</a>${x.price !== null ? ` — ${escapeHtml(money(x.price))}` : ''}</li>`)
            .join('');
        const body = [
            '<main class="s-wrap s-ssr">',
            `<h1>${escapeHtml(meta.title || info.title)}</h1>`,
            meta.description ? `<p>${escapeHtml(meta.description)}</p>` : '',
            items ? `<ul class="s-ssr-list">${items}</ul>` : '',
            '</main>',
        ].join('');
        const website = { '@context': 'https://schema.org', '@type': 'WebSite', name: shopTitle, url: `${origin}/` };
        return {
            index,
            title: shopTitle,
            description: shopDesc,
            canonical: `${origin}/`,
            image: imageUrl(origin, info.token, meta.design?.hero_image ?? undefined) ?? imageUrl(origin, info.token, info.products.find((x) => x.images.length > 0)?.images[0]),
            siteName: meta.company || shopTitle,
            ogType: 'website',
            jsonLd: [website, store],
            body,
            productId: null,
            homeTitle: shopTitle,
        };
    }
    const canonical = `${origin}${shopProductPath(p.title, p.id)}`;
    const images = p.images.map((src) => imageUrl(origin, info.token, src)).filter((x): x is string => x !== null);
    // v0.1.424 — La descripción corta es la que se escribió para esto; si no hay, la larga.
    const desc = snippet(p.summary || p.description || shopDesc);
    const range = shopVariantPriceRange(p);
    const inStock = p.stock === null || p.stock > 0;
    const availability = inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
    const offers =
        range && range.min !== range.max
            ? {
                  '@type': 'AggregateOffer',
                  priceCurrency: meta.currency,
                  lowPrice: priceString(range.min, meta.currency),
                  highPrice: priceString(range.max, meta.currency),
                  offerCount: p.variants?.length ?? 1,
                  availability,
                  url: canonical,
              }
            : p.price !== null
              ? {
                    '@type': 'Offer',
                    priceCurrency: meta.currency,
                    price: priceString(p.price, meta.currency),
                    availability,
                    itemCondition: 'https://schema.org/NewCondition',
                    url: canonical,
                }
              : null;
    const product: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.title,
        url: canonical,
        ...(desc ? { description: desc } : {}),
        ...(images.length > 0 ? { image: images.slice(0, 6) } : {}),
        ...(p.sku ? { sku: p.sku } : {}),
        ...(p.categories[0] ? { category: p.categories[0] } : {}),
        brand: { '@type': 'Brand', name: meta.company || shopTitle },
        ...(offers ? { offers } : {}),
    };
    const crumbs = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: shopTitle, item: `${origin}/` },
            { '@type': 'ListItem', position: 2, name: p.title, item: canonical },
        ],
    };
    const priceText = productPriceText(p, money);
    const body = [
        '<main class="s-wrap s-ssr">',
        `<p class="s-ssr-nav"><a href="/">← ${escapeHtml(meta.title || info.title)}</a></p>`,
        `<h1>${escapeHtml(p.title)}</h1>`,
        images[0] ? `<img src="${escapeHtml(images[0])}" alt="${escapeHtml(p.title)}" width="520" />` : '',
        priceText ? `<p class="s-ssr-price">${escapeHtml(priceText)}</p>` : '',
        p.summary ? `<p>${escapeHtml(p.summary)}</p>` : '',
        p.description ? `<p>${escapeHtml(snippet(p.description, 2000))}</p>` : '',
        '</main>',
    ].join('');
    const title = `${p.title} · ${meta.title || info.title}`.slice(0, 120);
    return {
        index,
        title,
        description: desc,
        canonical,
        image: images[0] ?? null,
        siteName: meta.company || shopTitle,
        ogType: 'product',
        jsonLd: [product, crumbs],
        body,
        productId: p.id,
        homeTitle: shopTitle,
    };
}

function productPriceText(p: PublicShopProduct, money: (n: number) => string): string {
    const range = shopVariantPriceRange(p);
    if (range && range.min !== range.max) return `Desde ${money(range.min)}`;
    return p.price !== null ? money(p.price) : '';
}

/** El mapa del sitio: el inicio y cada producto (con sus fotos). */
export function sitemapXml(domain: string, products: readonly PublicShopProduct[]): string {
    const origin = `https://${domain}`;
    const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const urls = [`<url><loc>${esc(`${origin}/`)}</loc></url>`, ...products.map((p) => `<url><loc>${esc(`${origin}${shopProductPath(p.title, p.id)}`)}</loc></url>`)];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
