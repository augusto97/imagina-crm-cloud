import { defaultStoreEditable, STORE_EDITABLE_CATALOG, type StoreListMarker, type StoreListRole } from './store-sync';

/**
 * Qué se puede hacer en una lista de la tienda (v0.1.213, ADR-S24).
 *
 * Una lista sincronizada con WooCommerce es un ESPEJO de la tienda: si la app
 * dejara crear un producto, borrar un pedido o cambiar el nombre de una
 * variación, quedaría un dato que la tienda no tiene (o no acepta) y la
 * próxima sincronización lo pisaría o lo dejaría huérfano. Por eso:
 *
 *  - **Registros**: no se crean ni se borran aquí — se hace en WooCommerce.
 *  - **Columnas de la tienda**: de sólo lectura, salvo las que la empresa
 *    habilitó (v0.1.214; por defecto precios, stock y estados) y sólo con
 *    «Editar desde la app» activado.
 *  - **Columnas propias** (una nota, un responsable): libres. Nunca viajan.
 *
 * Y lo editable depende de la FILA, porque WooCommerce no acepta lo mismo en
 * todos los productos: uno con variaciones no tiene precio ni stock propios
 * (viven en cada variación), y con el stock controlado el «estado del stock»
 * lo calcula la tienda. Estas funciones son PURAS y las usan el backend (que
 * rechaza la edición) y la interfaz (que bloquea la celda y dice por qué),
 * así nunca dicen cosas distintas.
 */

/** Las columnas que se PUEDEN habilitar en cada lista (por su slug del pack). */
export const STORE_EDITABLE_SLUGS: Record<StoreListRole, readonly string[]> = {
    products: STORE_EDITABLE_CATALOG.products.map((c) => c.slug),
    orders: STORE_EDITABLE_CATALOG.orders.map((c) => c.slug),
    customers: STORE_EDITABLE_CATALOG.customers.map((c) => c.slug),
};

/** Las columnas que la empresa habilitó en esta lista (o las de por defecto). */
export function storeEditableSlugs(marker: StoreListMarker): readonly string[] {
    return marker.editable ?? defaultStoreEditable(marker.role);
}

/** Estados de pedido que se pueden elegir desde la app (los demás los pone la tienda). */
export const STORE_SETTABLE_ORDER_STATUSES = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'] as const;
/** Publicación que se puede elegir (la papelera se maneja en WooCommerce). */
export const STORE_SETTABLE_PRODUCT_STATUSES = ['publish', 'draft', 'pending', 'private'] as const;

/** Tipo de fila en Productos (`tipo`) y en Pedidos (`tipo`). */
export const STORE_PRODUCT_KINDS = ['simple', 'variable', 'variacion', 'grouped', 'external'] as const;
export const STORE_ORDER_KINDS = ['pedido', 'linea'] as const;

export type StoreCellAccess =
    | { access: 'own' }
    | { access: 'editable' }
    | { access: 'locked'; reason: string };

/** Lee un valor de la fila por el slug del PACK (el backend y la UI guardan distinto). */
export type StoreRowGetter = (packSlug: string) => unknown;

/** El slug del pack de una columna de la tienda, o null si es una columna propia. */
export function storeFieldSlug(marker: StoreListMarker, fieldId: number): string | null {
    for (const [slug, id] of Object.entries(marker.fields)) if (id === fieldId) return slug;
    return marker.meta_fields.includes(fieldId) ? `meta:${fieldId}` : null;
}

/** ¿La columna es de la tienda (y no una propia de la empresa)? */
export function isStoreField(marker: StoreListMarker, fieldId: number): boolean {
    return storeFieldSlug(marker, fieldId) !== null;
}

const HOW_TO_EDIT = 'Se edita en WooCommerce.';

/**
 * Qué se puede hacer con una celda: `own` (columna propia, libre),
 * `editable` (viaja a la tienda) o `locked` con el motivo en lenguaje claro.
 */
export function storeCellAccess(marker: StoreListMarker, fieldId: number, row: StoreRowGetter): StoreCellAccess {
    const slug = storeFieldSlug(marker, fieldId);
    if (slug === null) return { access: 'own' };
    const isMeta = slug.startsWith('meta:');
    if (!isMeta && !STORE_EDITABLE_SLUGS[marker.role].includes(slug)) return { access: 'locked', reason: HOW_TO_EDIT };
    if (!marker.write_back) {
        return {
            access: 'locked',
            reason: 'Viene de WooCommerce. Para cambiarla desde aquí, activa «Editar desde la app» en la página de la tienda.',
        };
    }
    if (!storeEditableSlugs(marker).includes(slug)) {
        return {
            access: 'locked',
            reason: 'Viene de WooCommerce. Para cambiarla desde aquí, habilítala en «Columnas que se editan desde la app» (ajustes de la tienda).',
        };
    }
    const kind = typeof row('tipo') === 'string' ? (row('tipo') as string) : '';

    if (marker.role === 'orders') {
        if (kind === 'linea') return { access: 'locked', reason: 'Las líneas de un pedido se editan en WooCommerce.' };
        return { access: 'editable' };
    }
    if (marker.role === 'customers') {
        if (row('registrado') !== true) {
            return { access: 'locked', reason: 'Compró como invitado: no tiene una cuenta en la tienda que se pueda editar.' };
        }
        return { access: 'editable' };
    }
    if (isMeta) return { access: 'editable' };

    // Productos y variaciones.
    const ownStock = kind === 'simple' || kind === 'variacion';
    const managed = row('controla_stock') === true;
    switch (slug) {
        case 'precio_normal':
        case 'precio_rebajado':
            if (kind === 'variable') return { access: 'locked', reason: 'Un producto con variaciones no tiene precio propio: se cambia en cada variación.' };
            if (kind === 'grouped') return { access: 'locked', reason: 'Un producto agrupado no tiene precio propio.' };
            return { access: 'editable' };
        case 'controla_stock':
            if (!ownStock) return { access: 'locked', reason: stockElsewhere(kind) };
            return { access: 'editable' };
        case 'stock':
        case 'umbral_stock':
            if (!ownStock) return { access: 'locked', reason: stockElsewhere(kind) };
            if (!managed) return { access: 'locked', reason: 'Activa «Controla stock» para llevar la cantidad.' };
            return { access: 'editable' };
        case 'estado_stock':
            if (!ownStock) return { access: 'locked', reason: stockElsewhere(kind) };
            if (managed) return { access: 'locked', reason: 'Con el stock controlado, WooCommerce calcula este estado solo.' };
            return { access: 'editable' };
        case 'estado':
        case 'sku':
            return { access: 'editable' };
        case 'nombre':
            if (kind === 'variacion') return { access: 'locked', reason: 'El nombre de una variación sale de su producto y sus atributos: cambia el del producto.' };
            return { access: 'editable' };
        case 'slug_url':
            if (kind === 'variacion') return { access: 'locked', reason: 'Una variación no tiene dirección propia: usa la de su producto.' };
            return { access: 'editable' };
        case 'categorias':
        case 'etiquetas':
            if (kind === 'variacion') return { access: 'locked', reason: 'Las categorías y etiquetas son del producto: se cambian en el producto.' };
            return { access: 'editable' };
        default:
            return { access: 'locked', reason: HOW_TO_EDIT };
    }
}

function stockElsewhere(kind: string): string {
    return kind === 'variable'
        ? 'Un producto con variaciones lleva el stock en cada variación.'
        : 'Este tipo de producto no lleva stock propio.';
}

function num(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Un valor que WooCommerce no aceptaría (o aceptaría pero dejaría el producto
 * en un estado raro). `null` = está bien. Se chequea ANTES de guardar: si la
 * app lo aceptara y la tienda no, el dato quedaría distinto en los dos lados.
 */
export function storeValueError(
    marker: StoreListMarker,
    fieldId: number,
    value: unknown,
    row: StoreRowGetter,
): string | null {
    const slug = storeFieldSlug(marker, fieldId);
    if (slug === null) return null;
    const empty = value === null || value === undefined || value === '';
    switch (slug) {
        case 'precio_normal': {
            if (empty) return null;
            const n = num(value);
            if (n === null || n < 0) return 'El precio tiene que ser un número mayor o igual a 0.';
            const sale = num(row('precio_rebajado'));
            if (sale !== null && sale >= n) return 'El precio normal tiene que ser mayor que el rebajado.';
            return null;
        }
        case 'precio_rebajado': {
            if (empty) return null;
            const n = num(value);
            if (n === null || n < 0) return 'El precio tiene que ser un número mayor o igual a 0.';
            const regular = num(row('precio_normal'));
            if (regular !== null && n >= regular) return 'El precio rebajado tiene que ser menor que el normal.';
            return null;
        }
        case 'stock': {
            if (empty) return 'El stock no puede quedar vacío: desactiva «Controla stock» si no quieres llevar la cantidad.';
            const n = num(value);
            if (n === null || !Number.isInteger(n)) return 'El stock tiene que ser un número entero.';
            return null;
        }
        case 'umbral_stock': {
            if (empty) return null;
            const n = num(value);
            if (n === null || !Number.isInteger(n) || n < 0) return 'La alerta de stock bajo tiene que ser un entero mayor o igual a 0.';
            return null;
        }
        case 'estado_stock':
            if (empty || !['instock', 'outofstock', 'onbackorder'].includes(String(value))) return 'Elige un estado del stock.';
            return null;
        case 'nombre':
            if (empty || String(value).trim() === '') return 'El nombre no puede quedar vacío.';
            return null;
        case 'slug_url':
            if (empty || String(value).trim() === '') return 'El slug no puede quedar vacío: WordPress lo usa para la dirección del producto.';
            if (String(value).trim().length > 190) return 'El slug es demasiado largo (máximo 190 caracteres).';
            if (/[/?#]/.test(String(value))) return 'El slug no puede llevar «/», «?» ni «#»: es sólo la última parte de la dirección.';
            return null;
        case 'email':
            if (marker.role === 'customers' && (empty || String(value).trim() === '')) return 'El email de una cuenta de la tienda no puede quedar vacío.';
            return null;
        case 'estado': {
            if (marker.role === 'orders') {
                return (STORE_SETTABLE_ORDER_STATUSES as readonly string[]).includes(String(value))
                    ? null
                    : 'Ese estado lo pone la tienda: elige otro.';
            }
            return (STORE_SETTABLE_PRODUCT_STATUSES as readonly string[]).includes(String(value))
                ? null
                : 'La papelera se maneja en WooCommerce: elige otro estado.';
        }
        default:
            return null;
    }
}
