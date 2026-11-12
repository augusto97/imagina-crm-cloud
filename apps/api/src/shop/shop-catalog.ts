import { createHash } from 'node:crypto';
import {
    jsonbKeyForField,
    resolveTitleFieldId,
    SHOP_CATALOG_FIELD_TYPES,
    SHOP_MAX_IMAGES,
    SHOP_MAX_VARIANT_ATTRIBUTES,
    SHOP_MAX_VARIANTS,
    SHOP_VARIANT_ATTRIBUTE_TYPES,
    shopImageKeyForFile,
    shopPurchasables,
    summarizeVariantProduct,
    type Field,
    type PublicShopOption,
    type PublicShopProduct,
    type PublicShopVariant,
    type ShopCartProduct,
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

// ── v0.1.414: variantes (subtareas del producto) ────────────────────────

/** Los atributos de las variantes: campos de la lista de selección o texto, en el orden elegido. */
export function resolveVariantAttributes(fields: readonly Field[], ids: readonly number[]): Field[] {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const out: Field[] = [];
    for (const id of ids) {
        const f = byId.get(id);
        if (!f || !(SHOP_VARIANT_ATTRIBUTE_TYPES as readonly string[]).includes(f.type) || out.some((x) => x.id === f.id)) continue;
        out.push(f);
        if (out.length >= SHOP_MAX_VARIANT_ATTRIBUTES) break;
    }
    return out;
}

/** El valor de un atributo como lo lee una persona (la etiqueta de la opción). */
export function variantAttributeValue(field: Field, value: unknown): string {
    if (field.type === 'select') {
        if (typeof value !== 'string' || value === '') return '';
        return (optionLabels(field).get(value) ?? '').slice(0, 80);
    }
    return str(value, 80);
}

/** Lo que se lee de una subtarea para armar su variante (sin decidir todavía los atributos usados). */
interface RawVariant {
    row: CatalogRow;
    raw: string[];
    label: string;
    price: number | null;
    compare_price: number | null;
    stock: number | null;
    sku: string;
    images: Array<[string, ShopImageSource]>;
}

/** «M / Rojo»: los valores de los atributos; sin ninguno, el nombre de la subtarea. */
export function variantLabel(row: CatalogRow, rf: ResolvedCatalog, attrs: readonly Field[], index = 0): string {
    const d = row.data ?? {};
    const raw = attrs.map((a) => variantAttributeValue(a, d[jsonbKeyForField(a.id)]));
    const joined = raw.filter(Boolean).join(' / ');
    if (joined) return joined.slice(0, 120);
    const own = rf.name ? str(d[jsonbKeyForField(rf.name.id)], 120) : '';
    return own || `Opción ${index + 1}`;
}

function readVariant(parent: PublicShopProduct, row: CatalogRow, rf: ResolvedCatalog, attrs: readonly Field[], index: number): RawVariant {
    const d = row.data ?? {};
    const get = (f: Field | null): unknown => (f ? d[jsonbKeyForField(f.id)] : undefined);
    const ownPrice = num(get(rf.price));
    const price = ownPrice !== null && ownPrice >= 0 ? ownPrice : parent.price;
    const ownCompare = num(get(rf.compare_price));
    // El «antes» se hereda sólo si también se hereda el precio.
    const compareRaw = ownCompare ?? (ownPrice === null ? parent.compare_price : null);
    const stockRaw = rf.stock ? num(get(rf.stock)) : null;
    return {
        row,
        raw: attrs.map((a) => variantAttributeValue(a, get(a))),
        label: variantLabel(row, rf, attrs, index),
        price,
        compare_price: compareRaw !== null && price !== null && compareRaw > price ? compareRaw : null,
        stock: stockRaw === null ? null : Math.max(0, Math.floor(stockRaw)),
        sku: str(get(rf.sku), 80),
        images: imageSources(rf.images, get(rf.images)),
    };
}

const EMPTY_VALUE = '—';

/**
 * El producto con sus variantes: cada subtarea es una opción. Sólo cuentan
 * los atributos que alguna variante llena; sin ninguno, la opción es el
 * nombre de la subtarea. Las combinaciones repetidas se ignoran (gana la
 * primera). Las fotos de las variantes se suman a las que sirve la tienda.
 */
export function attachVariants(parent: CatalogProduct, children: readonly CatalogRow[], rf: ResolvedCatalog, attrs: readonly Field[]): CatalogProduct {
    const raws = children.slice(0, SHOP_MAX_VARIANTS).map((row, i) => readVariant(parent.product, row, rf, attrs, i));
    if (raws.length === 0) return parent;
    const used = attrs.map((_, i) => i).filter((i) => raws.some((r) => r.raw[i] !== ''));
    const options: PublicShopOption[] = [];
    if (used.length === 0) {
        options.push({ name: 'Opción', values: [] });
    } else {
        for (const i of used) {
            const attr = attrs[i]!;
            const present = new Set(raws.map((r) => r.raw[i] || EMPTY_VALUE));
            const order = attr.type === 'select' ? [...optionLabels(attr).values()] : [];
            const values = [...order.filter((v) => present.has(v)), ...[...present].filter((v) => !order.includes(v))];
            options.push({ name: (attr.label || 'Opción').slice(0, 60), values });
        }
    }
    const seen = new Set<string>();
    const variants: PublicShopVariant[] = [];
    const images: Array<[string, ShopImageSource]> = [...parent.images];
    for (const r of raws) {
        const values = used.length === 0 ? [r.label] : used.map((i) => r.raw[i] || EMPTY_VALUE);
        const key = values.join('\u0001');
        if (seen.has(key)) continue;
        seen.add(key);
        if (used.length === 0) options[0]!.values.push(r.label);
        for (const im of r.images) images.push(im);
        variants.push({
            id: r.row.id,
            label: r.label,
            values,
            price: r.price,
            compare_price: r.compare_price,
            stock: r.stock,
            sku: r.sku,
            images: r.images.map(([k]) => `img/${k}`),
        });
    }
    return { ...parent, product: summarizeVariantProduct(parent.product, variants, options), images };
}

export interface PurchasableRow extends CatalogRow {
    parentId: number | null;
}

export interface PurchasableItem {
    data: Record<string, unknown>;
    product: ShopCartProduct;
    sku: string;
    /** Con una variante: su producto. */
    parentId: number | null;
    /** v0.1.415 — Las categorías del producto (las de su producto, en una variante): para los cupones. */
    categories: string[];
}

/**
 * v0.1.414 — Lo que se puede comprar de las filas que llegaron en el pedido
 * (bloqueadas por quien llama). `attrs === null` = la tienda no tiene
 * variantes: sólo se venden los registros de primer nivel. Con variantes, un
 * producto que TIENE variantes no se compra directamente y una variante se
 * vende si su producto se vende; su precio, nombre y referencia salen de la
 * misma cuenta que el catálogo (`attachVariants`).
 */
export function purchasablesFromRows(
    rows: readonly PurchasableRow[],
    parents: ReadonlyMap<number, CatalogRow>,
    withVariants: ReadonlySet<number>,
    rf: ResolvedCatalog,
    attrs: readonly Field[] | null,
): Map<number, PurchasableItem> {
    const out = new Map<number, PurchasableItem>();
    for (const r of rows) {
        if (r.parentId === null) {
            if (attrs !== null && withVariants.has(r.id)) continue;
            const p = productFromRow(r, rf);
            if (!p.active) continue;
            out.set(r.id, {
                data: r.data,
                product: { id: r.id, title: p.product.title, price: p.product.price, stock: p.product.stock },
                sku: p.product.sku,
                parentId: null,
                categories: p.product.categories,
            });
            continue;
        }
        if (attrs === null) continue;
        const parentRow = parents.get(r.parentId);
        if (!parentRow) continue;
        const parent = productFromRow(parentRow, rf);
        if (!parent.active) continue;
        const item = shopPurchasables([attachVariants(parent, [r], rf, attrs).product]).get(r.id);
        if (!item) continue;
        out.set(r.id, {
            data: r.data,
            product: { id: r.id, title: item.title, price: item.price, stock: item.stock },
            sku: item.sku,
            parentId: parentRow.id,
            categories: parent.product.categories,
        });
    }
    return out;
}
