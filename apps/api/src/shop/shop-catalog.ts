import { createHash } from 'node:crypto';
import {
    jsonbKeyForField,
    resolveTitleFieldId,
    SHOP_CATALOG_FIELD_TYPES,
    SHOP_MAX_IMAGES,
    shopImageKeyForFile,
    type Field,
    type PublicShopProduct,
    type ShopCatalogFields,
} from '@imagina-base/shared';
import type { ShopImageSource } from './shop-images.service';

/**
 * v0.1.412 (ADR-S103) — De los registros de la lista a los productos de la
 * tienda. PURO: lo usan el catálogo público (en caché), el checkout (con las
 * filas bloqueadas) y los tests.
 *
 * Sólo viajan los campos que la empresa eligió para cada papel: el resto de
 * las columnas del registro (costos, notas internas, proveedores) nunca sale
 * de la app.
 */

export type CatalogRole = keyof ShopCatalogFields;

export type ResolvedCatalog = Record<CatalogRole, Field | null>;

/** Cada papel con su campo, sólo si existe y es de un tipo que sirve. */
export function resolveCatalogFields(fields: readonly Field[], catalog: ShopCatalogFields, listSettings: Record<string, unknown> | null): ResolvedCatalog {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const pick = (role: CatalogRole, id: number | null): Field | null => {
        if (id === null) return null;
        const f = byId.get(id);
        return f && SHOP_CATALOG_FIELD_TYPES[role].includes(f.type) ? f : null;
    };
    const titleId = resolveTitleFieldId(fields as Field[], listSettings ?? {});
    return {
        name: pick('name', catalog.name) ?? (titleId ? (byId.get(titleId) ?? null) : null),
        price: pick('price', catalog.price),
        compare_price: pick('compare_price', catalog.compare_price),
        images: pick('images', catalog.images),
        description: pick('description', catalog.description),
        category: pick('category', catalog.category),
        stock: pick('stock', catalog.stock),
        sku: pick('sku', catalog.sku),
        active: pick('active', catalog.active),
    };
}

/** Clave de una foto que viene por enlace: no se adivina la dirección desde la clave. */
export function shopUrlImageKey(url: string): string {
    return `u${createHash('sha256').update(url, 'utf8').digest('hex').slice(0, 16)}`;
}

function num(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
}

function str(v: unknown, max: number): string {
    if (typeof v === 'string') return v.trim().slice(0, max);
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return '';
}

function optionLabels(field: Field): Map<string, string> {
    const opts = (field.config as { options?: unknown }).options;
    const out = new Map<string, string>();
    if (!Array.isArray(opts)) return out;
    for (const o of opts) {
        if (o && typeof o === 'object' && typeof (o as { value?: unknown }).value === 'string') {
            const v = (o as { value: string }).value;
            const l = (o as { label?: unknown }).label;
            out.set(v, typeof l === 'string' && l.trim() ? l.trim() : v);
        }
    }
    return out;
}

/** Las categorías de un producto, como las lee una persona (etiqueta de la opción). */
export function productCategories(field: Field | null, value: unknown): string[] {
    if (!field) return [];
    if (field.type === 'text') {
        const t = str(value, 80);
        return t ? [t] : [];
    }
    const labels = optionLabels(field);
    const raw = Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value];
    const out: string[] = [];
    for (const v of raw) {
        if (typeof v !== 'string') continue;
        const l = labels.get(v);
        if (l && !out.includes(l)) out.push(l);
    }
    return out;
}

/** El orden de las categorías: el de las opciones del campo (como en la tabla). */
export function categoryOrder(field: Field | null): string[] {
    if (!field || field.type === 'text') return [];
    return [...optionLabels(field).values()];
}

export interface CatalogRow {
    id: number;
    data: Record<string, unknown>;
    createdAt: Date | string;
}

export interface CatalogProduct {
    product: PublicShopProduct;
    /** Lo que se sirve en `img/<clave>`. */
    images: Array<[string, ShopImageSource]>;
    /** El registro se vende (casilla «¿Se vende?» marcada o sin casilla). */
    active: boolean;
}

function imageSources(field: Field | null, value: unknown): Array<[string, ShopImageSource]> {
    if (!field) return [];
    if (field.type === 'file') {
        const ids = Array.isArray(value) ? value : [];
        const out: Array<[string, ShopImageSource]> = [];
        for (const raw of ids) {
            const id = Number(raw);
            if (!Number.isInteger(id) || id <= 0) continue;
            out.push([shopImageKeyForFile(id), { kind: 'file', fileId: id }]);
            if (out.length >= SHOP_MAX_IMAGES) break;
        }
        return out;
    }
    // Enlace: una sola foto por campo, sólo direcciones de la web.
    const url = str(value, 2000);
    if (!/^https?:\/\//i.test(url)) return [];
    return [[shopUrlImageKey(url), { kind: 'url', url }]];
}

export function productFromRow(row: CatalogRow, rf: ResolvedCatalog): CatalogProduct {
    const d = row.data ?? {};
    const get = (f: Field | null): unknown => (f ? d[jsonbKeyForField(f.id)] : undefined);
    const name = str(get(rf.name), 200) || 'Producto sin nombre';
    const price = num(get(rf.price));
    const compareRaw = num(get(rf.compare_price));
    const compare = compareRaw !== null && price !== null && compareRaw > price ? compareRaw : null;
    const stockRaw = rf.stock ? num(get(rf.stock)) : null;
    const images = imageSources(rf.images, get(rf.images));
    const active = rf.active ? get(rf.active) === true : true;
    const created = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);
    return {
        product: {
            id: row.id,
            title: name,
            price: price !== null && price >= 0 ? price : null,
            compare_price: compare,
            images: images.map(([key]) => `img/${key}`),
            description: str(get(rf.description), 4000),
            categories: productCategories(rf.category, get(rf.category)),
            stock: stockRaw === null ? null : Math.max(0, Math.floor(stockRaw)),
            sku: str(get(rf.sku), 80),
            created_at: created,
        },
        images,
        active,
    };
}
