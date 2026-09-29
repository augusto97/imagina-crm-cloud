import type { StoreSyncResource } from '@imagina-base/shared';

/**
 * WooCommerce → pack (v0.1.206, ADR-S24). PURO: recibe el JSON tal como lo
 * devuelve la API REST v3 y dice qué valor va en cada dato del pack (por el
 * `slug` del pack), qué registro vincula cada relación y qué campos de otros
 * plugins (`meta_data`) trae. El motor traduce slugs a ids de campo y escribe.
 *
 * Lo que decide acá —y se prueba acá, sin base ni red—:
 *  - **Clientes invitados**: WooCommerce sólo lista los registrados, pero un
 *    pedido de invitado también es de alguien. El cliente se identifica por
 *    `id:N` (registrado) o por `email:x` (invitado), así "cuánto me compró"
 *    no deja afuera a quien nunca creó cuenta.
 *  - **Productos variables** (v0.1.213): cada variación (talla, color) es
 *    una SUBTAREA de su producto, en la misma lista. Una línea de pedido es
 *    una SUBTAREA de su pedido y apunta al producto Y a la variación, así se
 *    suma por producto y por variación.
 *  - **Fechas**: la API da `*_gmt` sin zona; se guardan como UTC explícito.
 */

export type WooJson = Record<string, unknown>;

export interface ExtRef {
    resource: StoreSyncResource;
    externalId: string;
}

export interface MappedItem {
    resource: StoreSyncResource;
    externalId: string;
    /** El pedido de una línea / el producto de una variación. */
    parentExternalId: string | null;
    /** slug del pack → valor crudo (lo valida el motor contra el campo real). */
    values: Record<string, unknown>;
    /** slug del pack (campo relation) → a qué registro(s) de la tienda apunta. */
    relations: Record<string, ExtRef | ExtRef[] | null>;
    /** Opciones que tienen que existir en un select/multi_select (categorías, estados de plugins). */
    options: Record<string, Array<{ value: string; label: string }>>;
    /** `meta_data` de la tienda: clave → valor (campos de otros plugins). */
    meta: Record<string, unknown>;
}

// --- Utilidades ------------------------------------------------------------

function obj(v: unknown): WooJson {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as WooJson) : {};
}

function str(v: unknown): string {
    if (v === null || v === undefined) return '';
    return typeof v === 'string' ? v.trim() : String(v);
}

function nonEmpty(v: unknown): string | null {
    const s = str(v);
    return s === '' ? null : s;
}

/** Un número de la API (que casi siempre viene como texto: "25000.00"). */
export function wooNumber(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
}

/** `2026-06-01T12:00:00` (GMT sin zona) → `2026-06-01T12:00:00Z`. */
export function wooDate(v: unknown): string | null {
    const s = str(v);
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(s);
    if (!m) return null;
    return `${m[1]}T${m[2]}Z`;
}

function joinNonEmpty(parts: unknown[], sep: string): string | null {
    const out = parts.map((p) => str(p)).filter((p) => p !== '');
    return out.length > 0 ? out.join(sep) : null;
}

/** Última aparición gana (así lo resuelve WordPress con claves repetidas). */
export function metaOf(o: WooJson): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const list = Array.isArray(o.meta_data) ? o.meta_data : [];
    for (const m of list) {
        const e = obj(m);
        const key = str(e.key);
        if (key !== '') out[key] = e.value;
    }
    return out;
}

function item(
    resource: StoreSyncResource,
    externalId: string,
    values: Record<string, unknown>,
    extra: Partial<Omit<MappedItem, 'resource' | 'externalId' | 'values'>> = {},
): MappedItem {
    return {
        resource,
        externalId,
        parentExternalId: null,
        values,
        relations: {},
        options: {},
        meta: {},
        ...extra,
    };
}

function address(a: WooJson): string | null {
    return joinNonEmpty([a.address_1, a.address_2], ', ');
}

function personName(a: WooJson): string | null {
    return joinNonEmpty([a.first_name, a.last_name], ' ');
}

// --- Clientes ----------------------------------------------------------------

export function customerKey(id: number): string {
    return `id:${id}`;
}

export function guestKey(email: string): string {
    return `email:${email.trim().toLowerCase()}`;
}

export function mapCustomer(c: WooJson, storeUrl?: string | null): MappedItem {
    const billing = obj(c.billing);
    const id = Number(c.id);
    const email = nonEmpty(c.email) ?? nonEmpty(billing.email);
    return item(
        'customers',
        customerKey(id),
        {
            nombre: personName(c) ?? personName(billing) ?? email ?? `Cliente ${id}`,
            email,
            telefono: nonEmpty(billing.phone),
            empresa: nonEmpty(billing.company),
            ciudad: nonEmpty(billing.city),
            region: nonEmpty(billing.state),
            pais: nonEmpty(billing.country),
            direccion: address(billing),
            registrado: true,
            fecha_alta: wooDate(c.date_created_gmt),
            woo_id: String(id),
            editar: storeUrl ? userAdminUrl(storeUrl, id) : null,
        },
        { meta: metaOf(c) },
    );
}

/**
 * A quién pertenece un pedido: el cliente registrado, o —si compró como
 * invitado— su email. Sin ninguno de los dos no hay a quién vincularlo.
 */
export function customerRefForOrder(o: WooJson): ExtRef | null {
    const id = Number(o.customer_id);
    if (Number.isInteger(id) && id > 0) return { resource: 'customers', externalId: customerKey(id) };
    const email = nonEmpty(obj(o.billing).email);
    return email ? { resource: 'customers', externalId: guestKey(email) } : null;
}

/**
 * El cliente tal como lo describe el pedido. Se usa cuando el cliente todavía
 * no existe en la app (un invitado, o un registrado que llegó antes que la
 * lista de clientes): la próxima vuelta de clientes lo completa.
 */
export function customerFromOrder(o: WooJson): MappedItem | null {
    const ref = customerRefForOrder(o);
    if (!ref) return null;
    const billing = obj(o.billing);
    const registered = ref.externalId.startsWith('id:');
    const email = nonEmpty(billing.email);
    return item('customers', ref.externalId, {
        nombre: personName(billing) ?? email ?? 'Cliente',
        email,
        telefono: nonEmpty(billing.phone),
        empresa: nonEmpty(billing.company),
        ciudad: nonEmpty(billing.city),
        region: nonEmpty(billing.state),
        pais: nonEmpty(billing.country),
        direccion: address(billing),
        registrado: registered,
        fecha_alta: registered ? undefined : wooDate(o.date_created_gmt),
        woo_id: registered ? ref.externalId.slice(3) : null,
    });
}

// --- Productos y variaciones ---------------------------------------------------

function terms(v: unknown): Array<{ value: string; label: string }> {
    const list = Array.isArray(v) ? v : [];
    const out: Array<{ value: string; label: string }> = [];
    for (const t of list) {
        const e = obj(t);
        const label = str(e.name);
        const value = str(e.slug) || label.toLowerCase();
        if (value !== '' && label !== '') out.push({ value: value.slice(0, 190), label: label.slice(0, 190) });
    }
    return out;
}

function firstImage(v: unknown): string | null {
    const list = Array.isArray(v) ? v : [];
    return nonEmpty(obj(list[0]).src);
}

// --- Inventario (v0.1.208) ---------------------------------------------------------

/** Cómo está el inventario de un producto o variación, en una palabra. */
export type InventoryState = 'agotado' | 'bajo' | 'en_stock' | 'por_encargo' | 'sin_control';

/** Umbral de stock bajo cuando la tienda no dice otro (el default de WooCommerce). */
export const DEFAULT_LOW_STOCK = 2;

/**
 * WooCommerce dice `manage_stock: true` si el producto lleva la cuenta, y en
 * una variación `"parent"` si la lleva el producto padre (la API igual trae
 * la cantidad). Las dos cuentan como "lleva stock".
 */
export function managesStock(v: WooJson): boolean {
    return v.manage_stock === true || v.manage_stock === 'parent';
}

/**
 * El umbral de "stock bajo" que aplica: el del producto (`low_stock_amount`)
 * o, si no tiene, el general de la tienda. Un 0 es un umbral válido (avisar
 * sólo al agotarse).
 */
export function lowStockThreshold(v: WooJson, storeDefault: number | null): number {
    const own = wooNumber(v.low_stock_amount);
    if (own !== null && own >= 0) return own;
    return storeDefault !== null && storeDefault >= 0 ? storeDefault : DEFAULT_LOW_STOCK;
}

/**
 * El estado de inventario que se lee de un vistazo. Sin control de stock
 * manda el estado que declara la tienda (agotado / por encargo); con control,
 * la cantidad contra el umbral. Un stock en cero o negativo con reservas
 * permitidas es "por encargo", no "agotado": se sigue vendiendo.
 */
export function inventoryState(v: WooJson, threshold: number): InventoryState {
    const status = str(v.stock_status);
    if (!managesStock(v)) {
        if (status === 'outofstock') return 'agotado';
        if (status === 'onbackorder') return 'por_encargo';
        return 'sin_control';
    }
    const qty = wooNumber(v.stock_quantity) ?? 0;
    if (qty <= 0) return status === 'onbackorder' || (str(v.backorders) !== '' && str(v.backorders) !== 'no') ? 'por_encargo' : 'agotado';
    return qty <= threshold ? 'bajo' : 'en_stock';
}

/**
 * Lo que el inventario vale a precio de venta (stock × precio). Se calcula al
 * sincronizar —y no como campo calculado— porque así se SUMA en el tablero y
 * se filtra como cualquier número. Sin control de stock no hay a qué
 * multiplicar.
 */
export function inventoryValue(v: WooJson): number | null {
    if (!managesStock(v)) return null;
    const qty = wooNumber(v.stock_quantity);
    const price = wooNumber(v.price);
    if (qty === null || price === null || qty <= 0) return qty !== null && qty <= 0 ? 0 : null;
    return Math.round(qty * price * 100) / 100;
}

function inventoryValues(v: WooJson, storeDefault: number | null): Record<string, unknown> {
    const threshold = lowStockThreshold(v, storeDefault);
    const own = wooNumber(v.low_stock_amount);
    return {
        controla_stock: managesStock(v),
        umbral_stock: own !== null && own >= 0 ? own : null,
        estado_inventario: inventoryState(v, threshold),
        valor_inventario: inventoryValue(v),
    };
}

export interface MapInventoryOptions {
    /** Umbral general de la tienda (`woocommerce_notify_low_stock_amount`). */
    lowStockDefault?: number | null;
    /** v0.1.210 — Dirección de la tienda, para el enlace «Editar en WooCommerce». */
    storeUrl?: string | null;
}

/**
 * El slug tal como se lee: WordPress guarda los que llevan acentos o eñes
 * codificados (`caf%c3%a9`), y en la app se muestran como se escriben.
 */
export function wooSlug(v: unknown): string | null {
    const raw = nonEmpty(v);
    if (!raw) return null;
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

export function mapProduct(p: WooJson, inv: MapInventoryOptions = {}): MappedItem {
    const id = Number(p.id);
    const categorias = terms(p.categories);
    const etiquetas = terms(p.tags);
    const manages = managesStock(p);
    const variable = p.type === 'variable';
    const values: Record<string, unknown> = {
        nombre: nonEmpty(p.name) ?? `Producto ${id}`,
        sku: nonEmpty(p.sku),
        slug_url: wooSlug(p.slug),
        tipo: nonEmpty(p.type),
        estado: nonEmpty(p.status),
        precio: wooNumber(p.price),
        precio_normal: variable ? null : wooNumber(p.regular_price),
        precio_rebajado: variable ? null : wooNumber(p.sale_price),
        estado_stock: nonEmpty(p.stock_status),
        categorias: categorias.map((c) => c.value),
        etiquetas: etiquetas.map((c) => c.value),
        imagen: firstImage(p.images),
        enlace: nonEmpty(p.permalink),
        editar: inv.storeUrl ? orderAdminUrl(inv.storeUrl, id) : null,
        woo_id: String(id),
        modificado: wooDate(p.date_modified_gmt),
    };
    if (variable) {
        // El stock, su valor y su estado de un producto con variaciones son el
        // RESUMEN de sus variaciones: los calcula el motor al traerlas
        // (`recomputeVariableParents`). Escribirlos acá los pisaría.
        values.controla_stock = false;
    } else {
        values.stock = manages ? wooNumber(p.stock_quantity) : null;
        Object.assign(values, inventoryValues(p, inv.lowStockDefault ?? null));
    }
    return item('products', String(id), values, {
        options: {
            categorias,
            etiquetas,
            tipo: optionFor(p.type),
            estado: optionFor(p.status),
            estado_stock: optionFor(p.stock_status),
        },
        meta: metaOf(p),
    });
}

/**
 * El inventario de un producto con variaciones, resumido de sus variaciones:
 * el stock y su valor se SUMAN, y el estado es el que más urge (si alguna
 * talla está por agotarse, el producto aparece en «Para reponer» y al
 * desplegarlo se ve cuál).
 */
export function summarizeVariations(
    children: Array<{ stock: number | null; value: number | null; state: string | null }>,
): { stock: number | null; value: number | null; state: InventoryState } {
    const stocks = children.map((c) => c.stock).filter((n): n is number => n !== null);
    const values = children.map((c) => c.value).filter((n): n is number => n !== null);
    const states = new Set(children.map((c) => c.state));
    let state: InventoryState = 'sin_control';
    if (children.length > 0 && [...states].every((s) => s === 'agotado')) state = 'agotado';
    else if (states.has('agotado') || states.has('bajo')) state = 'bajo';
    else if (states.has('en_stock')) state = 'en_stock';
    else if (states.has('por_encargo')) state = 'por_encargo';
    return {
        stock: stocks.length > 0 ? stocks.reduce((a, b) => a + b, 0) : null,
        value: values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100 : null,
        state,
    };
}

/** «Color: Rojo · Talla: M». */
export function variationAttributes(v: WooJson): string | null {
    const list = Array.isArray(v.attributes) ? v.attributes : [];
    return joinNonEmpty(
        list.map((a) => {
            const e = obj(a);
            const name = str(e.name);
            const option = str(e.option);
            return option === '' ? '' : name === '' ? option : `${name}: ${option}`;
        }),
        ' · ',
    );
}

export function mapVariation(v: WooJson, parent: WooJson, inv: MapInventoryOptions = {}): MappedItem {
    const id = Number(v.id);
    const parentId = Number(parent.id ?? v.parent_id);
    const opts = (Array.isArray(v.attributes) ? v.attributes : []).map((a) => str(obj(a).option)).filter(Boolean);
    const parentName = nonEmpty(parent.name);
    const manages = managesStock(v);
    return item(
        'variations',
        String(id),
        {
            nombre: parentName ? (opts.length ? `${parentName} — ${opts.join(' / ')}` : parentName) : opts.length ? opts.join(' / ') : `Variación ${id}`,
            tipo: 'variacion',
            atributos: variationAttributes(v),
            sku: nonEmpty(v.sku),
            precio: wooNumber(v.price),
            precio_normal: wooNumber(v.regular_price),
            precio_rebajado: wooNumber(v.sale_price),
            stock: manages ? wooNumber(v.stock_quantity) : null,
            estado_stock: nonEmpty(v.stock_status),
            estado: nonEmpty(v.status),
            imagen: nonEmpty(obj(v.image).src),
            enlace: nonEmpty(v.permalink),
            // Una variación se edita DENTRO de su producto en el panel de WooCommerce.
            editar: inv.storeUrl && Number.isInteger(parentId) && parentId > 0 ? orderAdminUrl(inv.storeUrl, parentId) : null,
            woo_id: String(id),
            modificado: wooDate(v.date_modified_gmt),
            ...inventoryValues(v, inv.lowStockDefault ?? null),
        },
        {
            // La variación es una SUBTAREA de su producto (v0.1.213).
            parentExternalId: String(parentId),
            options: { estado_stock: optionFor(v.stock_status), estado: optionFor(v.status) },
            meta: metaOf(v),
        },
    );
}

// --- Pedidos y líneas --------------------------------------------------------------

/** Un estado que no está en el catálogo (lo agrega un plugin) se suma como opción. */
function optionFor(v: unknown): Array<{ value: string; label: string }> {
    const value = str(v);
    if (value === '') return [];
    const label = value.replace(/^wc-/, '').replace(/[-_]+/g, ' ');
    return [{ value, label: label.charAt(0).toUpperCase() + label.slice(1) }];
}

/**
 * Pantalla de edición en el panel de WordPress. Pedidos y productos son
 * «posts» (la misma URL; con HPOS WordPress redirige el pedido a su pantalla
 * nueva), los clientes son usuarios.
 */
export function orderAdminUrl(storeUrl: string, id: number): string {
    return `${storeUrl.replace(/\/+$/, '')}/wp-admin/post.php?post=${id}&action=edit`;
}

export function userAdminUrl(storeUrl: string, id: number): string {
    return `${storeUrl.replace(/\/+$/, '')}/wp-admin/user-edit.php?user_id=${id}`;
}

export function mapOrder(o: WooJson, storeUrl: string): MappedItem {
    const id = Number(o.id);
    const billing = obj(o.billing);
    const lines = Array.isArray(o.line_items) ? o.line_items : [];
    const subtotal = lines.reduce<number>((sum, l) => sum + (wooNumber(obj(l).subtotal) ?? 0), 0);
    const coupons = (Array.isArray(o.coupon_lines) ? o.coupon_lines : []).map((c) => str(obj(c).code));
    return item(
        'orders',
        String(id),
        {
            numero: `#${str(o.number) || id}`,
            tipo: 'pedido',
            estado: nonEmpty(o.status),
            fecha: wooDate(o.date_created_gmt),
            total: wooNumber(o.total),
            cantidad: lines.reduce<number>((sum, l) => sum + (wooNumber(obj(l).quantity) ?? 0), 0),
            subtotal: lines.length > 0 ? Math.round(subtotal * 100) / 100 : null,
            envio: wooNumber(o.shipping_total),
            descuento: wooNumber(o.discount_total),
            impuestos: wooNumber(o.total_tax),
            moneda: nonEmpty(o.currency),
            metodo_pago: nonEmpty(o.payment_method_title) ?? nonEmpty(o.payment_method),
            email: nonEmpty(billing.email),
            telefono: nonEmpty(billing.phone),
            ciudad: nonEmpty(billing.city),
            pais: nonEmpty(billing.country),
            direccion: address(billing),
            nota_cliente: nonEmpty(o.customer_note),
            cupones: joinNonEmpty(coupons, ', '),
            woo_id: String(id),
            modificado: wooDate(o.date_modified_gmt),
            enlace: orderAdminUrl(storeUrl, id),
        },
        {
            relations: { cliente: customerRefForOrder(o) },
            options: { estado: optionFor(o.status) },
            meta: metaOf(o),
        },
    );
}

/**
 * Las líneas de un pedido: cada una es una SUBTAREA del pedido (v0.1.213) y
 * copia el estado y la fecha del pedido — así un rollup «vendido en pedidos
 * completados» filtra la línea sin cruzar otra relación. Apunta al producto
 * y, si la tiene, a la variación: las dos viven en Productos.
 */
export function mapLineItems(o: WooJson, storeUrl?: string | null): MappedItem[] {
    const orderId = String(Number(o.id));
    const lines = Array.isArray(o.line_items) ? o.line_items : [];
    return lines.map((raw) => {
        const l = obj(raw);
        const productId = Number(l.product_id);
        const variationId = Number(l.variation_id);
        const targets: ExtRef[] = [];
        if (productId > 0) targets.push({ resource: 'products', externalId: String(productId) });
        if (variationId > 0) targets.push({ resource: 'variations', externalId: String(variationId) });
        return item(
            'line_items',
            String(Number(l.id)),
            {
                numero: nonEmpty(l.name) ?? 'Producto',
                tipo: 'linea',
                sku: nonEmpty(l.sku),
                cantidad: wooNumber(l.quantity),
                precio: wooNumber(l.price),
                total: wooNumber(l.total),
                fecha: wooDate(o.date_created_gmt),
                estado: nonEmpty(o.status),
                moneda: nonEmpty(o.currency),
                woo_id: String(Number(l.id)),
                enlace: storeUrl ? orderAdminUrl(storeUrl, Number(o.id)) : null,
            },
            {
                parentExternalId: orderId,
                relations: { producto: targets.length > 0 ? targets : null },
                options: { estado: optionFor(o.status) },
            },
        );
    });
}

// --- Campos de otros plugins (meta_data) ------------------------------------------

export type MetaFieldType = 'text' | 'long_text' | 'number' | 'date' | 'checkbox' | 'url';

/** Texto corto para mostrar un valor de meta como ejemplo. */
export function metaSample(v: unknown): string | null {
    if (v === null || v === undefined || v === '') return null;
    const text = typeof v === 'string' ? v : JSON.stringify(v);
    return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

export function suggestMetaType(v: unknown): MetaFieldType {
    if (v !== null && typeof v === 'object') return 'long_text';
    if (typeof v === 'boolean') return 'checkbox';
    if (typeof v === 'number') return 'number';
    const s = str(v);
    if (/^(yes|no)$/i.test(s)) return 'checkbox';
    if (/^-?\d+(\.\d+)?$/.test(s) && s.length < 16) return 'number';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'date';
    if (/^https?:\/\//i.test(s)) return 'url';
    return s.length > 120 ? 'long_text' : 'text';
}

/**
 * Un valor de meta convertido al tipo del campo que lo recibe. `undefined` =
 * no se puede (se deja el campo como está). Un objeto o arreglo (ACF, datos
 * serializados de un plugin) se guarda como JSON en un texto: se ve y se
 * busca, aunque no se edite como dato estructurado.
 */
export function coerceMeta(v: unknown, type: string): unknown {
    if (v === null || v === undefined || v === '') return null;
    switch (type) {
        case 'number':
        case 'currency':
        case 'percent':
            return wooNumber(v) ?? undefined;
        case 'checkbox':
            if (typeof v === 'boolean') return v;
            return /^(1|yes|si|sí|true|on)$/i.test(str(v));
        case 'date': {
            const m = /^(\d{4}-\d{2}-\d{2})/.exec(str(v));
            return m ? m[1] : undefined;
        }
        case 'url':
            return /^https?:\/\//i.test(str(v)) ? str(v) : undefined;
        default: {
            const text = typeof v === 'object' ? JSON.stringify(v) : str(v);
            return text.slice(0, 8000);
        }
    }
}
