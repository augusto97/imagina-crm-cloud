import { createHmac, timingSafeEqual } from 'node:crypto';
import { STORE_WRITE_BACK_FIELDS, type StoreMetaResource } from '@imagina-base/shared';

import type { SyncSettings } from '../store-sync.types';
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
    /** Campos de otros plugins que cambiaron: clave → valor nuevo + ejemplo visto en la tienda. */
    meta: Array<{ key: string; value: unknown; sample: string | null }>;
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

/**
 * Un valor de la app convertido a lo que guarda un plugin. Un sí/no se
 * escribe con la MISMA convención que ya usaba la tienda (WooCommerce usa
 * `yes/no`; ACF, `1/0`) — mandar la otra dejaría el dato "raro" para el plugin.
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
 * hay nada que mandar (se editó una columna propia de la app, o el cliente es
 * un invitado —que en la tienda no existe como cliente—). SÓLO viaja lo que
 * cambió: mandar el registro entero pisaría, por ejemplo, un stock que la
 * tienda bajó con una venta y todavía no llegó a la app.
 */
export function buildWriteBack(input: WriteBackInput): WriteBackRequest | null {
    const allowed = new Set(STORE_WRITE_BACK_FIELDS[input.resource].map((f) => f.slug));
    const label = new Map(STORE_WRITE_BACK_FIELDS[input.resource].map((f) => [f.slug, f.label]));
    const body: Record<string, unknown> = {};
    const sent: string[] = [];
    const billing: Record<string, unknown> = {};
    for (const [slug, value] of Object.entries(input.changed)) {
        if (!allowed.has(slug)) continue;
        sent.push(label.get(slug) ?? slug);
        switch (slug) {
            case 'nombre':
                if (text(value).trim() === '') {
                    sent.pop();
                    continue;
                }
                body.name = text(value).trim();
                break;
            case 'sku':
                body.sku = text(value);
                break;
            case 'precio_normal':
                body.regular_price = money(value);
                break;
            case 'precio_rebajado':
                // Vaciar el precio rebajado en la app = sacar la rebaja en la tienda.
                body.sale_price = money(value);
                break;
            case 'stock': {
                const n = wooNumber(value);
                if (n === null) {
                    body.manage_stock = false;
                } else {
                    body.manage_stock = true;
                    body.stock_quantity = Math.trunc(n);
                }
                break;
            }
            case 'estado_stock':
                body.stock_status = text(value);
                break;
            case 'estado':
                body.status = text(value);
                break;
            case 'nota_cliente':
                body.customer_note = text(value);
                break;
            case 'email':
                body.email = text(value);
                break;
            case 'telefono':
                billing.phone = text(value);
                break;
            case 'empresa':
                billing.company = text(value);
                break;
            case 'ciudad':
                billing.city = text(value);
                break;
            case 'region':
                billing.state = text(value);
                break;
            case 'pais':
                billing.country = text(value);
                break;
        }
    }
    if (Object.keys(billing).length > 0) body.billing = billing;
    if (input.meta.length > 0) {
        body.meta_data = input.meta.map((m) => ({ key: m.key, value: metaOut(m.value, m.sample) }));
        sent.push(...input.meta.map((m) => m.key));
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
