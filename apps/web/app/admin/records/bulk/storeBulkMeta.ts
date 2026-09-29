import {
    storeBulkOperationSchema,
    type StoreBulkOperation,
    type StoreBulkOpKind,
} from '@imagina-base/shared';

import { __ } from '@/lib/i18n';
import type { NumberFormatId } from '@/lib/tenantFormat';

import { parseNumberInput } from './bulkOpMeta';

/**
 * Piezas PURAS del diálogo de edición masiva de la tienda (v0.1.217): el menú
 * de «qué cambiar» agrupado como en el panel de WooCommerce, y cómo un
 * borrador del formulario se convierte en una operación que el backend acepta.
 */

export interface StoreOpMeta {
    op: StoreBulkOpKind;
    label: string;
    group: string;
    /** Columna del catálogo de edición que toca (si la empresa no la habilitó, no corre). */
    column?: string;
    hint?: string;
}

export const STORE_OPS: StoreOpMeta[] = [
    { op: 'regular_price', label: 'Precio normal', group: 'Precios', column: 'precio_normal' },
    { op: 'sale_price', label: 'Precio rebajado', group: 'Precios', column: 'precio_rebajado' },
    { op: 'sale_dates', label: 'Programar la rebaja', group: 'Precios', hint: 'Desde y hasta cuándo vale el precio rebajado.' },
    { op: 'stock', label: 'Stock (unidades)', group: 'Inventario', column: 'stock' },
    { op: 'manage_stock', label: 'Controlar stock', group: 'Inventario', column: 'controla_stock' },
    { op: 'stock_status', label: 'Estado del stock', group: 'Inventario', column: 'estado_stock', hint: 'Sólo en lo que NO controla stock (si lo controla, lo calcula WooCommerce).' },
    { op: 'backorders', label: 'Permitir reservas', group: 'Inventario' },
    { op: 'low_stock', label: 'Alerta de stock bajo', group: 'Inventario', column: 'umbral_stock' },
    { op: 'status', label: 'Publicación', group: 'Publicación', column: 'estado' },
    { op: 'catalog_visibility', label: 'Visibilidad en el catálogo', group: 'Publicación' },
    { op: 'featured', label: 'Destacado', group: 'Publicación' },
    { op: 'categories', label: 'Categorías', group: 'Organización', column: 'categorias' },
    { op: 'tags', label: 'Etiquetas', group: 'Organización', column: 'etiquetas' },
    { op: 'attribute', label: 'Atributos (color, talla, material…)', group: 'Organización' },
    { op: 'name', label: 'Nombre', group: 'Organización', column: 'nombre' },
    { op: 'weight', label: 'Peso', group: 'Envío e impuestos' },
    { op: 'dimensions', label: 'Medidas', group: 'Envío e impuestos' },
    { op: 'shipping_class', label: 'Clase de envío', group: 'Envío e impuestos' },
    { op: 'tax_status', label: 'Impuesto', group: 'Envío e impuestos' },
    { op: 'tax_class', label: 'Clase de impuesto', group: 'Envío e impuestos' },
    { op: 'meta', label: 'Campo de otro plugin', group: 'Otros', hint: 'Un dato de meta_data (ACF, Yoast…) por su clave.' },
];

export function storeOpMeta(op: StoreBulkOpKind): StoreOpMeta {
    return STORE_OPS.find((o) => o.op === op)!;
}

export interface StoreDraft {
    key: string;
    op: StoreBulkOpKind | null;
    /** Numérico: set | add | subtract | percent | percent_off | clear. */
    kind?: string;
    amount?: string;
    direction?: 'up' | 'down';
    round?: boolean;
    roundMultiple?: string;
    roundMode?: string;
    roundAdjust?: string;
    value?: string;
    bool?: boolean;
    mode?: 'add' | 'remove' | 'replace';
    values?: string[];
    attributeId?: number;
    attributeName?: string;
    /** Eligió «Otro (propio del producto)»: se escribe el nombre. */
    attributeCustom?: boolean;
    visible?: boolean;
    from?: string;
    to?: string;
    length?: string;
    width?: string;
    height?: string;
    text?: string;
    find?: string;
    metaKey?: string;
}

let seq = 0;
export function newStoreDraft(): StoreDraft {
    seq += 1;
    return { key: `sop-${Date.now()}-${seq}`, op: null };
}

export function storeDraftDefaults(op: StoreBulkOpKind): Partial<StoreDraft> {
    switch (op) {
        case 'regular_price':
            return { kind: 'percent', direction: 'up', amount: '', round: false, roundMultiple: '1000', roundMode: 'up', roundAdjust: '-100' };
        case 'sale_price':
            return { kind: 'percent_off', amount: '', round: false, roundMultiple: '1000', roundMode: 'up', roundAdjust: '-100' };
        case 'stock':
            return { kind: 'add', amount: '' };
        case 'manage_stock':
        case 'featured':
            return { bool: true };
        case 'stock_status':
            return { value: 'instock' };
        case 'backorders':
            return { value: 'no' };
        case 'status':
            return { value: 'publish' };
        case 'catalog_visibility':
            return { value: 'visible' };
        case 'tax_status':
            return { value: 'taxable' };
        case 'categories':
        case 'tags':
            return { mode: 'add', values: [] };
        case 'attribute':
            return { mode: 'add', values: [], visible: true, attributeId: 0, attributeName: '' };
        case 'name':
            return { kind: 'append', text: '' };
        default:
            return {};
    }
}

export type StoreDraftResult = { ok: true; operation: StoreBulkOperation } | { ok: false; error: string };

export function storeDraftToOperation(d: StoreDraft, format?: NumberFormatId): StoreDraftResult {
    if (d.op === null) return { ok: false, error: __('Elegí qué cambiar.') };
    const num = (s: string | undefined) => parseNumberInput(s ?? '', format);
    const round = () =>
        d.round
            ? {
                  multiple: num(d.roundMultiple) ?? 0,
                  mode: d.roundMode ?? 'up',
                  adjust: num(d.roundAdjust) ?? 0,
              }
            : undefined;
    let raw: Record<string, unknown>;
    switch (d.op) {
        case 'regular_price':
        case 'sale_price': {
            const kind = d.kind ?? 'set';
            if (kind === 'clear') {
                raw = { op: d.op, change: { kind: 'clear' } };
                break;
            }
            const n = num(d.amount);
            if (n === null) return { ok: false, error: __('Escribí el valor.') };
            const amount = kind === 'percent' ? (d.direction === 'down' ? -Math.abs(n) : Math.abs(n)) : n;
            raw = { op: d.op, change: { kind, amount, round: round() } };
            break;
        }
        case 'sale_dates':
            raw = { op: 'sale_dates', from: d.from || null, to: d.to || null };
            if (!d.from && !d.to) return { ok: false, error: __('Elegí al menos una fecha (o dejá las dos vacías para sacar la programación).') };
            break;
        case 'stock': {
            const n = num(d.amount);
            if (n === null || !Number.isInteger(n)) return { ok: false, error: __('Escribí un número entero de unidades.') };
            raw = { op: 'stock', kind: d.kind ?? 'add', amount: n };
            break;
        }
        case 'manage_stock':
        case 'featured':
            raw = { op: d.op, value: d.bool !== false };
            break;
        case 'low_stock': {
            if ((d.value ?? '').trim() === '') {
                raw = { op: 'low_stock', value: null };
                break;
            }
            const n = num(d.value);
            if (n === null || !Number.isInteger(n) || n < 0) return { ok: false, error: __('Escribí un número entero (o vacío = el de la tienda).') };
            raw = { op: 'low_stock', value: n };
            break;
        }
        case 'stock_status':
        case 'backorders':
        case 'status':
        case 'catalog_visibility':
        case 'tax_status':
            raw = { op: d.op, value: d.value };
            break;
        case 'shipping_class':
        case 'tax_class':
            raw = { op: d.op, value: d.value ?? '' };
            break;
        case 'categories':
        case 'tags':
            if (!d.values || d.values.length === 0) {
                if (d.mode !== 'replace') return { ok: false, error: __('Elegí al menos una.') };
            }
            raw = { op: d.op, mode: d.mode ?? 'add', values: d.values ?? [] };
            break;
        case 'attribute':
            if (!d.attributeName) return { ok: false, error: __('Elegí o escribí el atributo.') };
            if (d.mode !== 'remove' && (!d.values || d.values.length === 0)) return { ok: false, error: __('Elegí o escribí al menos un valor.') };
            raw = {
                op: 'attribute',
                mode: d.mode ?? 'add',
                attribute: { id: d.attributeId ?? 0, name: d.attributeName },
                options: d.values ?? [],
                visible: d.visible !== false,
            };
            break;
        case 'weight': {
            if ((d.value ?? '').trim() === '') {
                raw = { op: 'weight', value: null };
                break;
            }
            const n = num(d.value);
            if (n === null || n < 0) return { ok: false, error: __('Escribí el peso.') };
            raw = { op: 'weight', value: n };
            break;
        }
        case 'dimensions': {
            const dim = (s: string | undefined) => (s === undefined || s.trim() === '' ? undefined : num(s));
            const l = dim(d.length);
            const w = dim(d.width);
            const h = dim(d.height);
            if (l === undefined && w === undefined && h === undefined) return { ok: false, error: __('Completá al menos una medida.') };
            if ([l, w, h].some((x) => x === null)) return { ok: false, error: __('Revisá las medidas.') };
            raw = { op: 'dimensions', ...(l !== undefined ? { length: l } : {}), ...(w !== undefined ? { width: w } : {}), ...(h !== undefined ? { height: h } : {}) };
            break;
        }
        case 'name':
            if (d.kind === 'replace' ? !d.find : !d.text) return { ok: false, error: __('Escribí el texto.') };
            raw = { op: 'name', kind: d.kind ?? 'append', text: d.text ?? '', find: d.find ?? '' };
            break;
        case 'meta':
            if (!d.metaKey) return { ok: false, error: __('Escribí la clave del campo.') };
            raw = { op: 'meta', key: d.metaKey, value: (d.value ?? '') === '' ? null : d.value };
            break;
        default:
            return { ok: false, error: __('Operación desconocida.') };
    }
    const parsed = storeBulkOperationSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? __('Revisá la operación.') };
    return { ok: true, operation: parsed.data };
}
