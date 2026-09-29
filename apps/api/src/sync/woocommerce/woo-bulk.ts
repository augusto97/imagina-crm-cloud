import { roundTo, type StoreBulkChange, type StoreBulkOperation } from '@imagina-base/shared';
import { wooNumber, type WooJson } from './woo-map';

/**
 * Edición masiva de la tienda (v0.1.217, ADR-S24). PURO: dado el producto o la
 * variación tal como lo tiene la tienda AHORA y la lista de operaciones, qué
 * se le manda a WooCommerce y qué cambia, en criollo, para la vista previa.
 * Se prueba sin red ni base; el servicio hace la red.
 *
 * Reglas que viven acá (y no en la pantalla):
 *  - El producto con variaciones no tiene precio ni —en general— stock
 *    propio: esas operaciones van a cada variación.
 *  - Una variación que hereda el stock del producto (`manage_stock:
 *    "parent"`) no se toca: el stock es del padre.
 *  - El rebajado tiene que quedar por debajo del normal; si una combinación
 *    lo deja igual o más alto, esa fila NO cambia sus precios (y se dice).
 *  - Un atributo que usan las variaciones no se reemplaza ni se quita:
 *    rompería las variaciones existentes.
 *  - WooCommerce reemplaza la lista ENTERA de atributos, categorías y
 *    etiquetas en cada escritura: se manda siempre la lista completa.
 */

export type BulkItemKind = 'product' | 'variation';

export interface BulkPlanContext {
    kind: BulkItemKind;
    /** Decimales de los precios de la tienda. */
    priceDecimals: number;
    /** slug o nombre (en minúsculas) → id del término en la tienda, ya resueltos (y creados si faltaban). */
    terms: { categories: Map<string, number>; tags: Map<string, number> };
    /** id → nombre de los términos, para mostrar el antes/después. */
    termNames: Map<number, string>;
    /**
     * Columnas que la empresa dejó editar desde la app (v0.1.214). Las
     * operaciones que tocan una de esas columnas sólo corren si está
     * habilitada; `null` = sin restricción.
     */
    editable: Set<string> | null;
}

export interface BulkPlan {
    body: Record<string, unknown>;
    changes: StoreBulkChange[];
    notes: string[];
}

/** Qué columna del catálogo de edición (v0.1.214) toca cada operación. */
export const BULK_OP_COLUMN: Partial<Record<StoreBulkOperation['op'], string>> = {
    regular_price: 'precio_normal',
    sale_price: 'precio_rebajado',
    stock: 'stock',
    manage_stock: 'controla_stock',
    stock_status: 'estado_stock',
    low_stock: 'umbral_stock',
    status: 'estado',
    categories: 'categorias',
    tags: 'etiquetas',
    name: 'nombre',
};

const PRODUCT_ONLY = new Set<StoreBulkOperation['op']>(['catalog_visibility', 'featured', 'categories', 'tags', 'attribute', 'name']);

const STATUS_LABEL: Record<string, string> = {
    publish: 'Publicado',
    draft: 'Borrador',
    pending: 'Pendiente',
    private: 'Privado',
    instock: 'Hay existencias',
    outofstock: 'Agotado',
    onbackorder: 'Se puede reservar',
    no: 'No',
    notify: 'Sí, avisando',
    yes: 'Sí',
    visible: 'Tienda y búsqueda',
    catalog: 'Sólo tienda',
    search: 'Sólo búsqueda',
    hidden: 'Oculto',
    taxable: 'Con impuesto',
    shipping: 'Sólo el envío',
    none: 'Sin impuesto',
};

function str(v: unknown): string {
    return v === null || v === undefined ? '' : String(v);
}

function show(v: unknown): string {
    const s = str(v);
    return s === '' ? '—' : (STATUS_LABEL[s] ?? s);
}

/** Un precio como lo espera la API (texto, sin ceros de más). */
export function wooMoney(n: number, decimals: number): string {
    return String(Number(n.toFixed(Math.max(0, Math.min(6, decimals)))));
}

function applyChange(
    base: number | null,
    change: { kind: string; amount: number; round?: { multiple: number; mode: 'nearest' | 'up' | 'down'; adjust: number } },
    decimals: number,
): number | null {
    let v: number;
    if (change.kind === 'set') v = change.amount;
    else if (base === null) return null;
    else if (change.kind === 'add') v = base + change.amount;
    else if (change.kind === 'subtract') v = base - change.amount;
    else v = base * (1 + change.amount / 100);
    v = Number(v.toFixed(decimals));
    if (change.round) v = roundTo(v - change.round.adjust, change.round.multiple, change.round.mode) + change.round.adjust;
    return Number(v.toFixed(decimals));
}

interface WooAttribute {
    id: number;
    name: string;
    position: number;
    visible: boolean;
    variation: boolean;
    options: string[];
}

function attributesOf(obj: WooJson): WooAttribute[] {
    const list = Array.isArray(obj.attributes) ? obj.attributes : [];
    return list.map((a, i) => {
        const e = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
        return {
            id: Number(e.id) || 0,
            name: str(e.name),
            position: Number.isFinite(Number(e.position)) ? Number(e.position) : i,
            visible: e.visible !== false,
            variation: e.variation === true,
            options: Array.isArray(e.options) ? e.options.map(String) : [],
        };
    });
}

function termIds(obj: WooJson, key: 'categories' | 'tags'): number[] {
    const list = Array.isArray(obj[key]) ? (obj[key] as unknown[]) : [];
    return list.map((t) => Number((t as Record<string, unknown>)?.id)).filter((n) => n > 0);
}

function termLabel(ids: number[], names: Map<number, string>, obj: WooJson, key: 'categories' | 'tags'): string {
    const own = new Map<number, string>();
    for (const t of Array.isArray(obj[key]) ? (obj[key] as Array<Record<string, unknown>>) : []) own.set(Number(t?.id), str(t?.name));
    const out = ids.map((id) => own.get(id) ?? names.get(id) ?? `#${id}`);
    return out.length > 0 ? out.join(', ') : '—';
}

export function planBulkUpdate(ops: readonly StoreBulkOperation[], obj: WooJson, ctx: BulkPlanContext): BulkPlan {
    const body: Record<string, unknown> = {};
    const changes: StoreBulkChange[] = [];
    const notes: string[] = [];
    const isVariable = ctx.kind === 'product' && obj.type === 'variable';
    const isGrouped = ctx.kind === 'product' && obj.type === 'grouped';
    const dec = ctx.priceDecimals;
    const blocked = (op: StoreBulkOperation['op']): boolean => {
        const col = BULK_OP_COLUMN[op];
        return !!col && ctx.editable !== null && !ctx.editable.has(col);
    };

    // Estado de trabajo: las operaciones se encadenan.
    let regular = wooNumber(obj.regular_price);
    let sale = wooNumber(obj.sale_price);
    let priceTouched = false;
    let stockQty = wooNumber(obj.stock_quantity);
    let manages = obj.manage_stock === true;
    const inheritsStock = ctx.kind === 'variation' && obj.manage_stock === 'parent';
    let attrs: WooAttribute[] | null = null;
    let cats: number[] | null = null;
    let tags: number[] | null = null;
    let name = str(obj.name);
    let dims: Record<string, string> | null = null;
    const meta = new Map<string, string>();

    const note = (msg: string) => {
        if (!notes.includes(msg)) notes.push(msg);
    };

    for (const op of ops) {
        if (blocked(op.op)) {
            note(`«${BULK_OP_COLUMN[op.op]}» no está habilitada para editarse desde la app.`);
            continue;
        }
        if (PRODUCT_ONLY.has(op.op) && ctx.kind === 'variation') continue;
        switch (op.op) {
            case 'regular_price':
            case 'sale_price': {
                if (isVariable) {
                    note('El precio de un producto con variaciones está en cada variación.');
                    continue;
                }
                if (isGrouped) {
                    note('Un producto agrupado no tiene precio propio.');
                    continue;
                }
                if (op.op === 'regular_price') {
                    const next = applyChange(regular, op.change, dec);
                    if (next === null) {
                        note('No tiene precio normal cargado: no hay de dónde partir.');
                        continue;
                    }
                    if (next < 0) {
                        note('El precio quedaría negativo.');
                        continue;
                    }
                    regular = next;
                } else if (op.change.kind === 'clear') {
                    sale = null;
                } else if (op.change.kind === 'percent_off') {
                    if (regular === null) {
                        note('Sin precio normal no se puede calcular el descuento.');
                        continue;
                    }
                    const next = applyChange(regular, { ...op.change, kind: 'percent', amount: -Math.abs(op.change.amount) }, dec);
                    sale = next;
                } else {
                    const next = applyChange(sale, op.change, dec);
                    if (next === null) {
                        note('No tiene precio rebajado: no hay de dónde partir.');
                        continue;
                    }
                    if (next < 0) {
                        note('El precio rebajado quedaría negativo.');
                        continue;
                    }
                    sale = next;
                }
                priceTouched = true;
                break;
            }
            case 'sale_dates': {
                if (isVariable || isGrouped) continue;
                const from = op.from ? `${op.from}T00:00:00` : '';
                const to = op.to ? `${op.to}T23:59:59` : '';
                if (str(obj.date_on_sale_from).slice(0, 10) !== (op.from ?? '') || str(obj.date_on_sale_to).slice(0, 10) !== (op.to ?? '')) {
                    body.date_on_sale_from = from;
                    body.date_on_sale_to = to;
                    changes.push({
                        label: 'Rebaja programada',
                        before: `${show(str(obj.date_on_sale_from).slice(0, 10))} → ${show(str(obj.date_on_sale_to).slice(0, 10))}`,
                        after: `${show(op.from)} → ${show(op.to)}`,
                    });
                }
                break;
            }
            case 'stock': {
                if (inheritsStock) {
                    note('Hereda el stock del producto: se cambia en el producto.');
                    continue;
                }
                if (isVariable && !manages) {
                    note('El stock de un producto con variaciones está en cada variación.');
                    continue;
                }
                if (isGrouped) continue;
                const base = stockQty ?? 0;
                const next = op.kind === 'set' ? op.amount : op.kind === 'add' ? base + op.amount : base - op.amount;
                stockQty = Math.trunc(next);
                manages = true;
                break;
            }
            case 'manage_stock':
                if (inheritsStock || isGrouped) continue;
                manages = op.value;
                break;
            case 'stock_status':
                if (manages || inheritsStock) {
                    note('Controla el stock: el estado lo calcula WooCommerce con las unidades.');
                    continue;
                }
                if (str(obj.stock_status) !== op.value) {
                    body.stock_status = op.value;
                    changes.push({ label: 'Estado del stock', before: show(obj.stock_status), after: show(op.value) });
                }
                break;
            case 'backorders':
                if (str(obj.backorders) !== op.value) {
                    body.backorders = op.value;
                    changes.push({ label: 'Permitir reservas', before: show(obj.backorders), after: show(op.value) });
                }
                break;
            case 'low_stock': {
                const cur = wooNumber(obj.low_stock_amount);
                if (cur !== op.value) {
                    body.low_stock_amount = op.value;
                    changes.push({ label: 'Alerta de stock bajo', before: cur === null ? 'la de la tienda' : String(cur), after: op.value === null ? 'la de la tienda' : String(op.value) });
                }
                break;
            }
            case 'status':
                if (str(obj.status) !== op.value) {
                    body.status = op.value;
                    changes.push({ label: 'Publicación', before: show(obj.status), after: show(op.value) });
                }
                break;
            case 'catalog_visibility':
                if (str(obj.catalog_visibility) !== op.value) {
                    body.catalog_visibility = op.value;
                    changes.push({ label: 'Visibilidad', before: show(obj.catalog_visibility), after: show(op.value) });
                }
                break;
            case 'featured':
                if ((obj.featured === true) !== op.value) {
                    body.featured = op.value;
                    changes.push({ label: 'Destacado', before: obj.featured === true ? 'Sí' : 'No', after: op.value ? 'Sí' : 'No' });
                }
                break;
            case 'categories':
            case 'tags': {
                const key = op.op;
                const map = key === 'categories' ? ctx.terms.categories : ctx.terms.tags;
                const current = (key === 'categories' ? cats : tags) ?? termIds(obj, key);
                const wanted = op.values.map((v) => map.get(v.toLowerCase())).filter((n): n is number => typeof n === 'number');
                let next: number[];
                if (op.mode === 'add') next = [...new Set([...current, ...wanted])];
                else if (op.mode === 'remove') next = current.filter((id) => !wanted.includes(id));
                else next = [...new Set(wanted)];
                if (key === 'categories') cats = next;
                else tags = next;
                break;
            }
            case 'attribute': {
                const list: WooAttribute[] = attrs ?? attributesOf(obj);
                const match = (a: WooAttribute) =>
                    op.attribute.id > 0 ? a.id === op.attribute.id : a.id === 0 && a.name.toLowerCase() === op.attribute.name.toLowerCase();
                const idx = list.findIndex(match);
                const found = idx >= 0 ? list[idx]! : null;
                if (op.mode === 'remove') {
                    if (!found) continue;
                    if (found.variation) {
                        note(`«${found.name}» lo usan las variaciones: no se quita.`);
                        continue;
                    }
                    list.splice(idx, 1);
                } else if (!found) {
                    if (op.options.length === 0) continue;
                    list.push({
                        id: op.attribute.id,
                        name: op.attribute.name,
                        position: list.length,
                        visible: op.visible,
                        variation: false,
                        options: [...new Set(op.options)],
                    });
                } else if (op.mode === 'add') {
                    found.options = [...new Set([...found.options, ...op.options])];
                } else {
                    if (found.variation) {
                        note(`«${found.name}» lo usan las variaciones: sólo se le pueden agregar valores.`);
                        continue;
                    }
                    found.options = [...new Set(op.options)];
                    found.visible = op.visible;
                }
                attrs = list;
                break;
            }
            case 'weight': {
                const next = op.value === null ? '' : String(op.value);
                if (str(obj.weight) !== next) {
                    body.weight = next;
                    changes.push({ label: 'Peso', before: show(obj.weight), after: show(next) });
                }
                break;
            }
            case 'dimensions': {
                const cur = (obj.dimensions && typeof obj.dimensions === 'object' ? obj.dimensions : {}) as Record<string, unknown>;
                dims = dims ?? { length: str(cur.length), width: str(cur.width), height: str(cur.height) };
                for (const k of ['length', 'width', 'height'] as const) {
                    const v = op[k];
                    if (v === undefined) continue;
                    dims[k] = v === null ? '' : String(v);
                }
                break;
            }
            case 'shipping_class':
                if (str(obj.shipping_class) !== op.value) {
                    body.shipping_class = op.value;
                    changes.push({ label: 'Clase de envío', before: show(obj.shipping_class), after: op.value === '' ? 'Sin clase' : op.value });
                }
                break;
            case 'tax_status':
                if (str(obj.tax_status) !== op.value) {
                    body.tax_status = op.value;
                    changes.push({ label: 'Impuesto', before: show(obj.tax_status), after: show(op.value) });
                }
                break;
            case 'tax_class':
                if (str(obj.tax_class) !== op.value) {
                    body.tax_class = op.value;
                    changes.push({ label: 'Clase de impuesto', before: str(obj.tax_class) || 'Estándar', after: op.value || 'Estándar' });
                }
                break;
            case 'name': {
                if (op.kind === 'prepend') name = `${op.text}${name}`;
                else if (op.kind === 'append') name = `${name}${op.text}`;
                else {
                    if (op.find === '') continue;
                    name = name.replace(new RegExp(op.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), () => op.text);
                }
                break;
            }
            case 'meta':
                meta.set(op.key, op.value ?? '');
                break;
        }
    }

    // ── Precios: se validan juntos al final (el rebajado por debajo del normal).
    if (priceTouched) {
        const oldRegular = wooNumber(obj.regular_price);
        const oldSale = wooNumber(obj.sale_price);
        if (sale !== null && regular !== null && sale >= regular) {
            note('El precio rebajado quedaría igual o más alto que el normal: los precios de este producto no se cambian.');
        } else {
            if (regular !== oldRegular && regular !== null) {
                body.regular_price = wooMoney(regular, dec);
                changes.push({ label: 'Precio normal', before: show(oldRegular), after: wooMoney(regular, dec) });
            }
            if (sale !== oldSale) {
                body.sale_price = sale === null ? '' : wooMoney(sale, dec);
                changes.push({ label: 'Precio rebajado', before: show(oldSale), after: sale === null ? '—' : wooMoney(sale, dec) });
            }
        }
    }
    const oldQty = wooNumber(obj.stock_quantity);
    if (manages !== (obj.manage_stock === true) && !inheritsStock) {
        body.manage_stock = manages;
        changes.push({ label: 'Controla stock', before: obj.manage_stock === true ? 'Sí' : 'No', after: manages ? 'Sí' : 'No' });
    }
    if (manages && stockQty !== null && stockQty !== oldQty) {
        body.manage_stock = true;
        body.stock_quantity = stockQty;
        changes.push({ label: 'Stock', before: show(oldQty), after: String(stockQty) });
    }
    if (cats !== null) {
        const before = termIds(obj, 'categories');
        if (JSON.stringify([...before].sort()) !== JSON.stringify([...cats].sort())) {
            body.categories = cats.map((id) => ({ id }));
            changes.push({ label: 'Categorías', before: termLabel(before, ctx.termNames, obj, 'categories'), after: termLabel(cats, ctx.termNames, obj, 'categories') });
        }
    }
    if (tags !== null) {
        const before = termIds(obj, 'tags');
        if (JSON.stringify([...before].sort()) !== JSON.stringify([...tags].sort())) {
            body.tags = tags.map((id) => ({ id }));
            changes.push({ label: 'Etiquetas', before: termLabel(before, ctx.termNames, obj, 'tags'), after: termLabel(tags, ctx.termNames, obj, 'tags') });
        }
    }
    if (attrs !== null) {
        const before = attributesOf(obj);
        const fmt = (list: WooAttribute[]) => (list.length > 0 ? list.map((a) => `${a.name}: ${a.options.join(', ')}`).join(' · ') : '—');
        if (fmt(before) !== fmt(attrs)) {
            body.attributes = attrs.map((a, i) => ({
                ...(a.id > 0 ? { id: a.id } : { name: a.name }),
                position: i,
                visible: a.visible,
                variation: a.variation,
                options: a.options,
            }));
            changes.push({ label: 'Atributos', before: fmt(before), after: fmt(attrs) });
        }
    }
    if (dims !== null) {
        const cur = (obj.dimensions && typeof obj.dimensions === 'object' ? obj.dimensions : {}) as Record<string, unknown>;
        const before = `${str(cur.length) || '—'} × ${str(cur.width) || '—'} × ${str(cur.height) || '—'}`;
        const after = `${dims.length || '—'} × ${dims.width || '—'} × ${dims.height || '—'}`;
        if (before !== after) {
            body.dimensions = dims;
            changes.push({ label: 'Medidas (largo × ancho × alto)', before, after });
        }
    }
    if (name !== str(obj.name) && ctx.kind === 'product') {
        if (name.trim() === '') note('El nombre quedaría vacío.');
        else {
            body.name = name.trim();
            changes.push({ label: 'Nombre', before: str(obj.name), after: name.trim() });
        }
    }
    if (meta.size > 0) {
        const current = new Map<string, string>();
        for (const m of Array.isArray(obj.meta_data) ? (obj.meta_data as Array<Record<string, unknown>>) : []) {
            current.set(str(m?.key), typeof m?.value === 'object' ? JSON.stringify(m.value) : str(m?.value));
        }
        const out: Array<{ key: string; value: string }> = [];
        for (const [key, value] of meta) {
            if ((current.get(key) ?? '') === value) continue;
            out.push({ key, value });
            changes.push({ label: key, before: show(current.get(key)), after: show(value) });
        }
        if (out.length > 0) body.meta_data = out;
    }
    return { body, changes, notes };
}
