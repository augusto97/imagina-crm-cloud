import { devPrivateEgressAllowed } from '../../common/safe-fetch';
import type { IntegrationCreds, IntegrationRequest, IntegrationValues } from '../integration-calls';
import { IntegrationInputError } from '../integration-errors';

/**
 * WooCommerce (v0.1.205) — cómo se le habla a la API REST v3 de una tienda.
 *
 * PURO, como el resto de `integration-calls`: las acciones de las
 * automatizaciones, el probador, la verificación al conectar y (desde la fase
 * 2) el motor de sincronización arman las URLs y las cabeceras con estas mismas
 * funciones, así que lo que se prueba es lo que después se ejecuta.
 *
 * Dos detalles de hosting que el usuario NUNCA tiene que saber, y que por eso
 * se descubren probando al conectar (`wooVerifyPlan`) y quedan guardados en
 * los campos ocultos de la conexión:
 *  - **auth_mode**: la clave viaja por `Authorization: Basic` (lo correcto),
 *    pero muchos hostings con PHP por CGI/FastCGI TIRAN esa cabecera antes de
 *    que llegue a WordPress; ahí WooCommerce acepta la clave en la URL
 *    (`consumer_key`/`consumer_secret`, sólo sobre HTTPS).
 *  - **api_style**: sin enlaces permanentes activados, `/wp-json/…` no existe
 *    y la API se alcanza por `?rest_route=/wc/v3/…`.
 */

export type WooAuthMode = 'header' | 'query';
export type WooApiStyle = 'pretty' | 'plain';

/** La dirección de la tienda, normalizada. Tira un error para la persona si no sirve. */
export function wooStoreUrl(raw: string): string {
    let text = (raw ?? '').trim();
    if (text === '') throw new IntegrationInputError('Falta la dirección de la tienda.');
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        throw new IntegrationInputError(`«${raw}» no es una dirección válida.`);
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && devPrivateEgressAllowed())) {
        // Sin HTTPS WooCommerce exige OAuth 1.0a firmado por petición; la clave
        // sola viajaría en claro. No es una limitación nuestra: es la de ellos.
        throw new IntegrationInputError(
            'La tienda tiene que usar HTTPS (la dirección empieza con https://). WooCommerce no acepta claves de API sin conexión segura.',
        );
    }
    // Se conserva el subdirectorio (tiendas en example.com/tienda) y se
    // descarta lo que sobre: query, hash y un `/wp-admin` pegado por error.
    const path = url.pathname.replace(/\/wp-admin(\/.*)?$/i, '').replace(/\/+$/, '');
    return `${url.protocol}//${url.host}${path}`;
}

function modeOf(creds: IntegrationCreds): WooAuthMode {
    return creds.fields.auth_mode === 'query' ? 'query' : 'header';
}

function styleOf(creds: IntegrationCreds): WooApiStyle {
    return creds.fields.api_style === 'plain' ? 'plain' : 'pretty';
}

/**
 * URL de un recurso de `wc/v3`. `path` empieza con `/` (`/products/12`).
 * Los valores de `query` se codifican; las claves son nuestras.
 */
export function wooUrl(
    creds: IntegrationCreds,
    path: string,
    query: Array<[string, string]> = [],
): string {
    const base = wooStoreUrl(creds.fields.store_url ?? '');
    const pairs = [...query];
    if (modeOf(creds) === 'query') {
        pairs.push(['consumer_key', creds.fields.consumer_key ?? ''], ['consumer_secret', creds.secret]);
    }
    const qs = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    if (styleOf(creds) === 'plain') {
        return `${base}/?rest_route=/wc/v3${path}${qs ? `&${qs}` : ''}`;
    }
    return `${base}/wp-json/wc/v3${path}${qs ? `?${qs}` : ''}`;
}

/** Raíz de la API de WordPress (de ahí sale el nombre de la tienda). */
export function wooSiteIndexUrl(creds: IntegrationCreds): string {
    const base = wooStoreUrl(creds.fields.store_url ?? '');
    // `_fields=name`: el índice completo de una tienda real lista TODAS las
    // rutas (1,2 MB en un WooCommerce recién instalado, más con plugins) y
    // pasaba el tope de lectura — el nombre se perdía y la conexión quedaba
    // con el dominio. Con el filtro son ~20 bytes (WordPress ≥ 4.9.8).
    return styleOf(creds) === 'plain' ? `${base}/?rest_route=/&_fields=name` : `${base}/wp-json/?_fields=name`;
}

export function wooHeaders(creds: IntegrationCreds, json = false): Record<string, string> {
    const out: Record<string, string> = { accept: 'application/json' };
    if (json) out['content-type'] = 'application/json; charset=utf-8';
    if (modeOf(creds) === 'header') {
        const pair = `${creds.fields.consumer_key ?? ''}:${creds.secret}`;
        out.authorization = `Basic ${Buffer.from(pair, 'utf8').toString('base64')}`;
    }
    return out;
}

// --- Acciones ------------------------------------------------------------

function positiveId(raw: string | undefined, label: string): number {
    const text = (raw ?? '').trim().replace(/^#/, '');
    if (!/^\d+$/.test(text) || Number(text) <= 0) {
        throw new IntegrationInputError(
            `«${raw ?? ''}» no es un ${label} válido: tiene que ser el número que WooCommerce le asignó.`,
        );
    }
    return Number(text);
}

function isTrue(v: string | undefined): boolean {
    return ['1', 'true', 'si', 'sí', 'yes', 'on'].includes((v ?? '').trim().toLowerCase());
}

/** Un precio como lo espera WooCommerce: texto con punto decimal. */
export function wooPrice(raw: string, label: string): string {
    const text = raw.trim().replace(/[\s$]/g, '');
    let normalized = text;
    if (text.includes(',') && text.includes('.')) {
        // «1.234,50» y «1,234.50»: el separador que va ÚLTIMO es el decimal.
        normalized =
            text.lastIndexOf(',') > text.lastIndexOf('.')
                ? text.replace(/\./g, '').replace(',', '.')
                : text.replace(/,/g, '');
    } else if (/^\d{1,3}([.,]\d{3})+$/.test(text)) {
        // «26.000» o «1,250,000»: grupos de a tres = separador de MILES (en
        // Latinoamérica el punto es de miles). Un precio con tres decimales
        // no existe en la práctica; leerlo como 26 sí cobraría mil veces menos.
        normalized = text.replace(/[.,]/g, '');
    } else {
        normalized = text.replace(',', '.');
    }
    if (!/^\d+(\.\d+)?$/.test(normalized)) {
        throw new IntegrationInputError(`«${raw}» no es un ${label} válido.`);
    }
    return normalized;
}

function intValue(raw: string, label: string): number {
    const n = Number(raw.trim());
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
        throw new IntegrationInputError(`«${raw}» no es un ${label} válido: tiene que ser un número entero.`);
    }
    return n;
}

/**
 * «clave=valor», uno por renglón → `meta_data` de WooCommerce. Lo usan los
 * campos que agregan otros plugins (ACF, Yoast…).
 */
export function parseMetaLines(lines: string[]): Array<{ key: string; value: string }> {
    const out: Array<{ key: string; value: string }> = [];
    for (const line of lines) {
        if (line.trim() === '') continue;
        const at = line.indexOf('=');
        if (at <= 0) {
            throw new IntegrationInputError(`«${line.trim()}» no tiene el formato clave=valor.`);
        }
        const key = line.slice(0, at).trim();
        if (key === '') throw new IntegrationInputError(`«${line.trim()}» no tiene clave.`);
        out.push({ key, value: line.slice(at + 1).trim() });
    }
    return out;
}

export function buildWooRequest(
    actionKey: string,
    compiled: IntegrationValues,
    creds: IntegrationCreds,
): IntegrationRequest {
    const v = compiled.values;
    switch (actionKey) {
        case 'update_product': {
            const productId = positiveId(v.product_id, 'ID de producto');
            const variation = (v.variation_id ?? '').trim();
            const body: Record<string, unknown> = {};
            if (variation === '' && (v.name ?? '').trim() !== '') body.name = v.name!.trim();
            if ((v.regular_price ?? '').trim() !== '') body.regular_price = wooPrice(v.regular_price!, 'precio');
            const sale = (v.sale_price ?? '').trim();
            if (sale !== '') body.sale_price = /^quitar$/i.test(sale) ? '' : wooPrice(sale, 'precio rebajado');
            if ((v.stock_quantity ?? '').trim() !== '') {
                body.manage_stock = true;
                body.stock_quantity = intValue(v.stock_quantity!, 'stock');
            }
            if ((v.stock_status ?? '').trim() !== '') body.stock_status = v.stock_status!.trim();
            if ((v.status ?? '').trim() !== '') body.status = v.status!.trim();
            const meta = parseMetaLines(compiled.lines.meta ?? []);
            if (meta.length > 0) body.meta_data = meta;
            if (Object.keys(body).length === 0) {
                throw new IntegrationInputError('No hay nada para cambiar: completa al menos un dato del producto.');
            }
            const path =
                variation === ''
                    ? `/products/${productId}`
                    : `/products/${productId}/variations/${positiveId(variation, 'ID de variación')}`;
            return { url: wooUrl(creds, path), method: 'PUT', headers: wooHeaders(creds, true), body: JSON.stringify(body) };
        }
        case 'update_order_status': {
            const id = positiveId(v.order_id, 'ID de pedido');
            const status = (v.status ?? '').trim();
            if (status === '') throw new IntegrationInputError('Falta el estado nuevo del pedido.');
            return {
                url: wooUrl(creds, `/orders/${id}`),
                method: 'PUT',
                headers: wooHeaders(creds, true),
                body: JSON.stringify({ status }),
            };
        }
        case 'add_order_note': {
            const id = positiveId(v.order_id, 'ID de pedido');
            return {
                url: wooUrl(creds, `/orders/${id}/notes`),
                method: 'POST',
                headers: wooHeaders(creds, true),
                body: JSON.stringify({ note: v.note ?? '', customer_note: isTrue(v.customer_note) }),
            };
        }
        case 'create_coupon': {
            const code = (v.code ?? '').trim();
            if (code === '') throw new IntegrationInputError('Falta el código del cupón.');
            const body: Record<string, unknown> = {
                code,
                discount_type: (v.discount_type ?? '').trim() || 'percent',
                amount: wooPrice(v.amount ?? '', 'valor de descuento'),
                individual_use: isTrue(v.individual_use),
                free_shipping: isTrue(v.free_shipping),
            };
            const expires = (v.date_expires ?? '').trim();
            if (expires !== '') {
                const m = /^(\d{4}-\d{2}-\d{2})/.exec(expires);
                if (!m) throw new IntegrationInputError(`«${expires}» no es una fecha AAAA-MM-DD.`);
                body.date_expires = m[1];
            }
            if ((v.usage_limit ?? '').trim() !== '') body.usage_limit = intValue(v.usage_limit!, 'límite de usos');
            if ((v.usage_limit_per_user ?? '').trim() !== '') {
                body.usage_limit_per_user = intValue(v.usage_limit_per_user!, 'límite de usos por cliente');
            }
            const emails = (v.email_restrictions ?? '')
                .split(/[,;\s]+/)
                .map((e) => e.trim().toLowerCase())
                .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
            if (emails.length > 0) body.email_restrictions = emails.slice(0, 25);
            if ((v.minimum_amount ?? '').trim() !== '') body.minimum_amount = wooPrice(v.minimum_amount!, 'monto mínimo');
            if ((v.description ?? '').trim() !== '') body.description = v.description!.trim();
            return { url: wooUrl(creds, '/coupons'), method: 'POST', headers: wooHeaders(creds, true), body: JSON.stringify(body) };
        }
        default:
            throw new IntegrationInputError(`La acción «${actionKey}» no existe en WooCommerce.`);
    }
}

// --- Respuestas ------------------------------------------------------------

function parseJson(body: string): unknown {
    try {
        return JSON.parse(body) as unknown;
    } catch {
        return undefined;
    }
}

function stripTags(text: string): string {
    return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** El motivo legible de un error de WooCommerce, o `null` si salió bien. */
export function checkWooResponse(status: number, body: string): string | null {
    const json = parseJson(body);
    const obj = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
    if (status >= 400) {
        const code = typeof obj?.code === 'string' ? obj.code : '';
        const message = typeof obj?.message === 'string' ? stripTags(obj.message) : '';
        if (code === 'woocommerce_rest_cannot_edit' || code === 'woocommerce_rest_cannot_create') {
            return 'La clave de API no tiene permiso de escritura: genérala de nuevo en WooCommerce con «Lectura/Escritura».';
        }
        if (status === 401) {
            return `WooCommerce rechazó la clave${message ? ` (${message})` : ''}. Actualízala en Ajustes → Integraciones.`;
        }
        return `WooCommerce respondió ${status}${message ? `: ${message.replace(/\.+$/, '')}` : ''}.`;
    }
    if (json === undefined && body.trim() !== '') {
        // Un 200 con HTML: la dirección no es la API (una página de la tienda,
        // un «modo mantenimiento», un firewall).
        return 'La tienda respondió una página web en vez de la API. Revisa la dirección y que la API REST no esté bloqueada.';
    }
    return null;
}

// --- Verificación al conectar ---------------------------------------------

export interface WooVerifyAttempt {
    fields: { auth_mode: WooAuthMode; api_style: WooApiStyle };
    url: string;
    headers: Record<string, string>;
}

/**
 * Las combinaciones que se prueban, en orden: la ideal primero (cabecera +
 * enlaces permanentes) y los rodeos de hosting después.
 */
export function wooVerifyPlan(creds: IntegrationCreds): WooVerifyAttempt[] {
    const out: WooVerifyAttempt[] = [];
    for (const api_style of ['pretty', 'plain'] as const) {
        for (const auth_mode of ['header', 'query'] as const) {
            const c: IntegrationCreds = { ...creds, fields: { ...creds.fields, auth_mode, api_style } };
            out.push({
                fields: { auth_mode, api_style },
                url: wooUrl(c, '/products', [
                    ['per_page', '1'],
                    ['_fields', 'id'],
                ]),
                headers: wooHeaders(c),
            });
        }
    }
    return out;
}

export type WooVerifyVerdict =
    | { kind: 'ok' }
    | { kind: 'auth'; message: string }
    | { kind: 'no_api' }
    | { kind: 'other'; message: string };

export function classifyWooVerify(status: number, body: string): WooVerifyVerdict {
    const json = parseJson(body);
    if (status === 200 && Array.isArray(json)) return { kind: 'ok' };
    const obj = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
    const code = typeof obj?.code === 'string' ? obj.code : '';
    const message = typeof obj?.message === 'string' ? stripTags(obj.message) : '';
    if ((status === 401 || status === 403) && code !== '') return { kind: 'auth', message };
    // `rest_no_route` = WordPress existe pero WooCommerce no (o está apagado).
    if (code === 'rest_no_route') return { kind: 'other', message: 'Ese sitio es WordPress, pero no tiene WooCommerce activo.' };
    if (status === 404 || json === undefined) return { kind: 'no_api' };
    return { kind: 'other', message: message || `respuesta ${status}` };
}

/** Nombre del sitio desde la raíz de la API de WordPress. */
export function wooSiteName(body: string): string | null {
    const json = parseJson(body);
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    const name = (json as Record<string, unknown>).name;
    return typeof name === 'string' && name.trim() !== '' ? stripTags(name).slice(0, 80) : null;
}
