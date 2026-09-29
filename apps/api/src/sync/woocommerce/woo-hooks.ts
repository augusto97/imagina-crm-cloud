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
 * Qué mandarle a la tienda cuando se editó un registro. Devuelve `null` si no
 * hay nada que mandar (se editó una columna propia de la app). SÓLO viaja lo
 * que cambió —mandar el registro entero pisaría, por ejemplo, un stock que la
 * tienda bajó con una venta que todavía no llegó— y sólo precios, stock y
 * estados (v0.1.213): el resto se edita en WooCommerce. Qué fila acepta qué lo
 * decide `storeCellAccess` ANTES de guardar; acá se arma el pedido.
 */
export function buildWriteBack(input: WriteBackInput): WriteBackRequest | null {
    const allowed = new Set(STORE_WRITE_BACK_FIELDS[input.resource].map((f) => f.slug));
    const label = new Map(STORE_WRITE_BACK_FIELDS[input.resource].map((f) => [f.slug, f.label]));
    const body: Record<string, unknown> = {};
    const sent: string[] = [];
    for (const [slug, value] of Object.entries(input.changed)) {
        if (!allowed.has(slug)) continue;
        switch (slug) {
            case 'precio_normal':
                body.regular_price = money(value);
                break;
            case 'precio_rebajado':
                // Vaciar el precio rebajado en la app = sacar la rebaja en la tienda.
                body.sale_price = money(value);
                break;
            case 'stock': {
                const n = wooNumber(value);
                if (n === null) continue;
                body.manage_stock = true;
                body.stock_quantity = Math.trunc(n);
                break;
            }
            case 'estado_stock':
                body.stock_status = text(value);
                break;
            case 'controla_stock':
                body.manage_stock = value === true;
                break;
            case 'umbral_stock': {
                // Vacío = volver al umbral general de la tienda.
                const n = wooNumber(value);
                body.low_stock_amount = n === null ? null : Math.max(0, Math.trunc(n));
                break;
            }
            case 'estado':
                body.status = text(value);
                break;
            default:
                continue;
        }
        sent.push(label.get(slug) ?? slug);
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
        case 'customers':
            return null;
    }
}
