import { createHmac, timingSafeEqual } from 'node:crypto';
import { STORE_EDITABLE_CATALOG, type StoreMetaResource } from '@imagina-base/shared';

import { roleOfResource, type SyncSettings } from '../store-sync.types';
import { wooNumber, type WooJson } from './woo-map';

/**
 * Tiempo real y edición en los dos sentidos (v0.1.207, ADR-S24 fase 3). PURO:
 * qué avisos se registran en la tienda, cómo se verifica uno que llega, y qué
 * se le manda a la tienda cuando alguien edita un registro en la app. Lo que
 * hace red o toca la base vive en el motor; esto se prueba sin ninguna de las
 * dos cosas.
 */

// ── Avisos (webhooks) ──────────────────────────────────────────────────────

export type WooHookResource = 'order' | 'product' | 'customer';
export type WooHookEvent = 'created' | 'updated' | 'deleted' | 'restored';

/** Los temas a registrar según lo que se eligió traer. */
export function wooHookTopics(settings: Pick<SyncSettings, 'resources'>): string[] {
    const out: string[] = [];
    const add = (resource: WooHookResource, events: WooHookEvent[]) => {
        for (const e of events) out.push(`${resource}.${e}`);
    };
    if (settings.resources.orders) add('order', ['created', 'updated', 'deleted', 'restored']);
    if (settings.resources.products) add('product', ['created', 'updated', 'deleted', 'restored']);
    if (settings.resources.customers) add('customer', ['created', 'updated']);
    return out;
}

export function parseWooTopic(topic: string | undefined): { resource: WooHookResource; event: WooHookEvent } | null {
    const m = /^(order|product|customer)\.(created|updated|deleted|restored)$/.exec((topic ?? '').trim());
    return m ? { resource: m[1] as WooHookResource, event: m[2] as WooHookEvent } : null;
}

/**
 * WooCommerce firma cada entrega con `base64(HMAC-SHA256(secreto, cuerpo))`
 * en `X-WC-Webhook-Signature`. Se compara en tiempo constante y sobre el
 * cuerpo CRUDO: re-serializar el JSON cambiaría espacios y escapes y ninguna
 * firma válida coincidiría.
 */
export function verifyWooSignature(secret: string, rawBody: string, header: string | undefined): boolean {
    if (!header || secret === '') return false;
    const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
    let given: Buffer;
    try {
        given = Buffer.from(header.trim(), 'base64');
    } catch {
        return false;
    }
    return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * El «ping» que WooCommerce manda al crear un aviso: `webhook_id=N` como
 * formulario, sin tema. Si no se le contesta 2xx, la tienda NO crea el aviso.
 */
export function isWooPing(topic: string | undefined, body: unknown): boolean {
    if (topic && topic.trim() !== '') return false;
    if (typeof body === 'string') return /^webhook_id=\d+$/.test(body.trim());
    return !!body && typeof body === 'object' && 'webhook_id' in (body as Record<string, unknown>);
}

/** Una variación llega con el tema `product.*`: se reconoce por su forma. */
export function isVariationPayload(p: WooJson): boolean {
    return p.type === 'variation' || (Number(p.parent_id) > 0 && !Array.isArray(p.variations));
}

// ── Edición en los dos sentidos ───────────────────────────────────────────

export interface WriteBackInput {
    resource: StoreMetaResource;
    /** El id de la tienda (`id:N` para clientes; los invitados no se pueden editar). */
    externalId: string;
    /** El producto padre de una variación. */
    parentExternalId: string | null;
    /** slug del pack → valor NUEVO (ya en el formato de la app). Sólo lo que cambió. */
    changed: Record<string, unknown>;
    /**
     * v0.1.214 — columnas que la empresa habilitó en esa lista (slugs del
     * catálogo y `meta:<id del campo>`). Lo que no está acá no viaja.
     */
    editable: readonly string[];
    /** Campos de otros plugins que cambiaron (sólo los habilitados viajan). */
    meta?: Array<{ key: string; fieldId: number; value: unknown; sample: string | null }>;
    /**
     * Categorías / etiquetas ya resueltas a ids de la tienda: la API de
     * WooCommerce sólo acepta `[{ id }]` (el nombre es de sólo lectura), así
     * que el motor las busca —o las crea— antes de armar el pedido.
     */
    terms?: { categorias?: number[]; etiquetas?: number[] };
}

export interface WriteBackRequest {
    path: string;
    body: Record<string, unknown>;
    /** Lo que se mandó, en criollo, para el registro de lo enviado. */
    fields: string[];
}

function money(v: unknown): string {
    const n = wooNumber(v);
    return n === null ? '' : String(n);
}

function text(v: unknown): string {
    return v === null || v === undefined ? '' : String(v);
}

/** «Ana María López» → nombre «Ana», apellido «María López» (la cuenta de WordPress los guarda separados). */
export function splitPersonName(full: string): { first_name: string; last_name: string } {
    const parts = full.trim().split(/\s+/).filter(Boolean);
    return { first_name: parts[0] ?? '', last_name: parts.slice(1).join(' ') };
}

/**
 * Un valor de la app como lo espera un campo de otro plugin: un sí/no respeta
 * la convención que ya usaba la tienda (`yes/no` o `1/0`), y un JSON se manda
 * como objeto (lo que guarda ACF), no como texto.
 */
export function metaOut(value: unknown, sample: string | null): unknown {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') {
        return /^(yes|no)$/i.test(sample ?? '') ? (value ? 'yes' : 'no') : value ? '1' : '0';
    }
    if (typeof value === 'string' && /^[[{]/.test(value.trim())) {
        try {
            return JSON.parse(value) as unknown;
        } catch {
            return value;
        }
    }
    return typeof value === 'number' ? String(value) : value;
}

/**
 * Qué mandarle a la tienda cuando se editó un registro. Devuelve `null` si no
 * hay nada que mandar (se editó una columna propia de la app o una que la
 * empresa no habilitó). SÓLO viaja lo que cambió —mandar el registro entero
 * pisaría, por ejemplo, un stock que la tienda bajó con una venta que todavía
 * no llegó— y sólo lo habilitado en «Columnas que se editan desde la app»
 * (v0.1.214). Qué fila acepta qué lo decide `storeCellAccess` ANTES de
 * guardar; acá se arma el pedido.
 */
export function buildWriteBack(input: WriteBackInput): WriteBackRequest | null {
    const role = roleOfResource(input.resource);
    const catalog = STORE_EDITABLE_CATALOG[role];
    const enabled = new Set(input.editable);
    const label = new Map(catalog.map((c) => [c.slug, c.label]));
    const body: Record<string, unknown> = {};
    const billing: Record<string, unknown> = {};
    const sent: string[] = [];
    const isVariation = input.resource === 'variations';
    for (const [slug, value] of Object.entries(input.changed)) {
        if (!label.has(slug) || !enabled.has(slug)) continue;
        switch (`${role}:${slug}`) {
            case 'products:precio_normal':
                body.regular_price = money(value);
                break;
            case 'products:precio_rebajado':
                // Vaciar el precio rebajado en la app = sacar la rebaja en la tienda.
                body.sale_price = money(value);
                break;
            case 'products:stock': {
                const n = wooNumber(value);
                if (n === null) continue;
                body.manage_stock = true;
                body.stock_quantity = Math.trunc(n);
                break;
            }
            case 'products:estado_stock':
                body.stock_status = text(value);
                break;
            case 'products:controla_stock':
                body.manage_stock = value === true;
                break;
            case 'products:umbral_stock': {
                // Vacío = volver al umbral general de la tienda.
                const n = wooNumber(value);
                body.low_stock_amount = n === null ? null : Math.max(0, Math.trunc(n));
                break;
            }
            case 'products:estado':
            case 'orders:estado':
                body.status = text(value);
                break;
            case 'products:nombre': {
                // El nombre de una variación lo arma WooCommerce con sus atributos.
                const name = text(value).trim();
                if (isVariation || name === '') continue;
                body.name = name;
                break;
            }
            case 'products:sku':
                body.sku = text(value).trim();
                break;
            case 'products:slug_url': {
                // WordPress lo limpia y lo hace único (`taza-roja-2`): lo que vuelve
                // de la tienda es lo que queda en la app.
                const slug = text(value).trim();
                if (isVariation || slug === '') continue;
                body.slug = slug;
                break;
            }
            case 'products:categorias':
            case 'products:etiquetas': {
                const ids = slug === 'categorias' ? input.terms?.categorias : input.terms?.etiquetas;
                if (isVariation || !ids) continue;
                body[slug === 'categorias' ? 'categories' : 'tags'] = ids.map((id) => ({ id }));
                break;
            }
            case 'orders:nota_cliente':
                body.customer_note = text(value);
                break;
            case 'orders:email':
                billing.email = text(value).trim();
                break;
            case 'orders:telefono':
            case 'customers:telefono':
                billing.phone = text(value).trim();
                break;
            case 'customers:nombre': {
                const name = text(value).trim();
                if (name === '') continue;
                const parts = splitPersonName(name);
                Object.assign(body, parts);
                Object.assign(billing, parts);
                break;
            }
            case 'customers:email': {
                const email = text(value).trim();
                if (email === '') continue;
                body.email = email;
                break;
            }
            case 'customers:empresa':
                billing.company = text(value).trim();
                break;
            case 'customers:ciudad':
                billing.city = text(value).trim();
                break;
            default:
                continue;
        }
        sent.push(label.get(slug) ?? slug);
    }
    if (Object.keys(billing).length > 0) body.billing = billing;
    const meta = (input.meta ?? []).filter((m) => enabled.has(`meta:${m.fieldId}`));
    if (meta.length > 0) {
        body.meta_data = meta.map((m) => ({ key: m.key, value: metaOut(m.value, m.sample) }));
        sent.push(...meta.map((m) => m.key));
    }
    if (Object.keys(body).length === 0) return null;

    const id = input.externalId;
    switch (input.resource) {
        case 'products':
            return { path: `/products/${Number(id)}`, body, fields: sent };
        case 'variations': {
            const parent = Number(input.parentExternalId);
            if (!(parent > 0)) return null;
            return { path: `/products/${parent}/variations/${Number(id)}`, body, fields: sent };
        }
        case 'orders':
            return { path: `/orders/${Number(id)}`, body, fields: sent };
        case 'customers': {
            // Un invitado (`email:x`) no es un cliente de la tienda: no hay a quién editar.
            const m = /^id:(\d+)$/.exec(id);
            return m ? { path: `/customers/${m[1]}`, body, fields: sent } : null;
        }
    }
}

/** Puertos a los que WordPress entrega avisos (`wp_http_validate_url`). */
const WP_SAFE_PORTS = new Set([80, 443, 8080]);

/**
 * ¿La tienda va a poder entregar avisos a esta dirección? WordPress manda los
 * avisos con `wp_safe_remote_post`, que rechaza cualquier puerto fuera de 80,
 * 443 y 8080 con «A valid URL was not provided» — y ese error sólo queda en el
 * log de la tienda: sin este chequeo la app mostraría «en tiempo real» mientras
 * WooCommerce descarta cada aviso (lo encontró la prueba contra un WooCommerce
 * real, v0.1.214). Devuelve el motivo, o null si la dirección sirve.
 */
export function wooDeliveryUrlProblem(url: string): string | null {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return 'la dirección pública de la app (APP_BASE_URL) no es válida.';
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'la dirección pública de la app (APP_BASE_URL) no es http(s).';
    const port = u.port === '' ? (u.protocol === 'https:' ? 443 : 80) : Number(u.port);
    if (!WP_SAFE_PORTS.has(port)) {
        return `WordPress sólo entrega avisos a los puertos 80, 443 y 8080, y la app está publicada en el ${port} (${u.origin}).`;
    }
    return null;
}

/** Motivo para mostrar cuando la tienda había desactivado avisos por fallas de entrega. */
export function wooDisabledHooksMessage(count: number, deliveryOrigin: string): string {
    return (
        `La tienda había desactivado ${count} aviso${count === 1 ? '' : 's'} porque no lograba entregarlos a ${deliveryOrigin}. ` +
        'Los volvimos a activar; si se repite, revisá que la tienda pueda llegar a esa dirección (un firewall o un plugin de seguridad pueden bloquearla). ' +
        'Mientras tanto, la tienda se sincroniza cada hora.'
    );
}
