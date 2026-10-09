import { BLUEPRINT_VERSION, WOO_ORDER_STATUS_OPTIONS, type ListBlueprint, type StoreSyncResource } from '@imagina-base/shared';
import { dashboard, f, kanban, kpi, list, listRef, opt, ref, rollup, select, table, widget } from '../../templates/blueprint-dsl';

/**
 * El PACK de la tienda (ADR-S24): las listas y los tableros que se crean al
 * conectar WooCommerce, en el MISMO formato que las plantillas del sistema.
 *
 * v0.1.213 (pack 5) — TRES listas, con la forma de la tienda:
 *  - **Clientes**.
 *  - **Productos**: cada variación (talla, color) es una SUBTAREA de su
 *    producto — se despliega con la flechita, en vez de vivir en una lista
 *    aparte que nadie sabía cómo leer junto a la de productos.
 *  - **Pedidos**: cada línea (qué se compró) es una SUBTAREA de su pedido.
 * Como padres e hijos comparten columnas, una columna `tipo` dice qué es cada
 * fila (producto simple/variable/variación, pedido/línea): los tableros y los
 * rollups filtran por ella para no contar dos veces.
 *
 * Las preguntas de negocio —cuánto compró un cliente, cuánto vendió un
 * producto o una talla— son rollups: la línea apunta a su producto Y a su
 * variación (las dos viven en Productos), así el producto suma todas sus
 * tallas y la variación sólo las suyas.
 *
 * Los `slug` de aquí son la clave con la que el MAPEO (`woo-map.ts`) nombra
 * cada dato; al crear el pack se traducen a ids de campo y eso es lo que se
 * guarda (regla de oro nº 1: renombrar un campo no rompe la sincronización).
 */

/** Recurso → key de la lista en el blueprint (hijos en la lista del padre). */
export const WOO_LIST_KEYS: Record<StoreSyncResource, string> = {
    customers: 'clientes',
    products: 'productos',
    variations: 'productos',
    orders: 'pedidos',
    line_items: 'pedidos',
};

/** Los recursos que tienen lista propia (los otros viven como subtareas). */
export const WOO_ROOT_RESOURCES = ['customers', 'products', 'orders'] as const;
/** Recurso hijo → recurso padre (cuya fila es la madre de la subtarea). */
export const WOO_PARENT_RESOURCE: Partial<Record<StoreSyncResource, StoreSyncResource>> = {
    variations: 'products',
    line_items: 'orders',
};

/** Estados que cuentan como venta (lo cobrado o por despachar). */
export const PAID_STATUSES = ['completed', 'processing'];

/**
 * 1 = v0.1.206, 2 = inventario, 3 = compras, 4 = identificadores,
 * 5 = v0.1.213: variaciones y líneas como subtareas, sin compras. Una
 * sincronización anterior se MIGRA sola (`StoreSyncService.upgradePack`).
 */
export const WOO_PACK_VERSION = 6;

export const INVENTORY_VIEW_NAME = 'Para reponer';
export const INVENTORY_DASHBOARD_PREFIX = 'Inventario · ';

const STATUS_COLORS: Record<string, string> = {
    pending: 'amber',
    processing: 'sky',
    'on-hold': 'violet',
    completed: 'emerald',
    cancelled: 'slate',
    refunded: 'rose',
    failed: 'rose',
    'checkout-draft': 'slate',
    trash: 'slate',
};
const ORDER_STATUS = WOO_ORDER_STATUS_OPTIONS.map((o) => opt(o.value, o.label, STATUS_COLORS[o.value] ?? 'slate'));

const STOCK_STATUS = [
    opt('instock', 'Hay existencias', 'emerald'),
    opt('outofstock', 'Agotado', 'rose'),
    opt('onbackorder', 'Se puede reservar', 'amber'),
];
const PRODUCT_STATUS = [
    opt('publish', 'Publicado', 'emerald'),
    opt('draft', 'Borrador', 'slate'),
    opt('pending', 'Pendiente de revisión', 'amber'),
    opt('private', 'Privado', 'violet'),
    opt('trash', 'En la papelera', 'rose'),
];
/** El estado de inventario que se lee de un vistazo (lo deriva el mapeo). */
const INVENTORY_STATE = [
    opt('agotado', 'Agotado', 'rose'),
    opt('bajo', 'Stock bajo', 'amber'),
    opt('en_stock', 'En stock', 'emerald'),
    opt('por_encargo', 'Por encargo', 'violet'),
    opt('sin_control', 'Sin control de stock', 'slate'),
];
const LOW_OR_OUT = ['agotado', 'bajo'];

const PRODUCT_TYPE = [
    opt('simple', 'Simple', 'sky'),
    opt('variable', 'Con variaciones', 'violet'),
    opt('variacion', 'Variación', 'blue'),
    opt('grouped', 'Agrupado', 'amber'),
    opt('external', 'Externo', 'slate'),
];
const ORDER_KIND = [opt('pedido', 'Pedido', 'sky'), opt('linea', 'Línea', 'slate')];

/** Filas que tienen stock propio (un producto con variaciones lo lleva en cada una). */
const STOCK_ROWS = ['simple', 'variacion'];

export interface WooPackOptions {
    storeName: string;
    currency: string;
    precision: number;
    /** País por defecto de los teléfonos (ISO2 de la tienda), si se conoce. */
    phoneCountry: string | null;
}

const group = (...children: Array<Record<string, unknown>>) => ({ type: 'group', logic: 'and', children });
const cond = (slug: string, op: string, value?: unknown) => ({ type: 'condition', field_id: ref(slug), op, value });

export function buildWooPack(o: WooPackOptions): ListBlueprint {
    const money = (label: string, slug: string, description?: string) =>
        f(label, slug, 'currency', { config: { currency: o.currency, precision: o.precision }, ...(description ? { description } : {}) });
    const phone = (label: string, slug: string) =>
        f(label, slug, 'phone', { config: o.phoneCountry ? { default_country: o.phoneCountry } : {} });
    const wooId = () =>
        f('ID WooCommerce', 'woo_id', 'text', {
            description: 'El número del registro en la tienda. Lo usan las acciones de WooCommerce ({{woo_id}}).',
        });
    const editLink = (what: string) =>
        f('Editar en WooCommerce', 'editar', 'url', { description: `Abre ${what} en el panel de administración de la tienda.` });
    // Lo que cuenta como venta: pedidos completados o en proceso.
    const paidLines = { slug: 'estado', op: 'in', value: PAID_STATUSES };
    const paidOrders = [paidLines, { slug: 'tipo', op: 'eq', value: 'pedido' }];
    const paidOrdersTree = group(cond('estado', 'in', PAID_STATUSES), cond('tipo', 'eq', 'pedido'));
    const ordersOnly = group(cond('tipo', 'eq', 'pedido'));

    return {
        version: BLUEPRINT_VERSION,
        lists: [
            list(
                'clientes',
                'Clientes',
                'users',
                '#7F54B3',
                [
                    f('Nombre', 'nombre', 'text'),
                    f('Email', 'email', 'email'),
                    phone('Teléfono', 'telefono'),
                    f('Empresa', 'empresa', 'text'),
                    f('Ciudad', 'ciudad', 'text'),
                    f('Departamento / Estado', 'region', 'text'),
                    f('País', 'pais', 'text'),
                    f('Dirección', 'direccion', 'text'),
                    f('Registrado', 'registrado', 'checkbox', {
                        description: 'Tiene cuenta en la tienda. Los que compraron como invitados aparecen igual, por su email.',
                    }),
                    f('Cliente desde', 'fecha_alta', 'datetime'),
                    wooId(),
                    editLink('la ficha del cliente (sólo los que tienen cuenta)'),
                    rollup('Pedidos', 'pedidos', 'pedidos', 'cliente', 'count', null, 'Todos sus pedidos, en cualquier estado.'),
                    rollup('Total comprado', 'total_comprado', 'pedidos', 'cliente', 'sum', 'total',
                        'Suma de sus pedidos completados o en proceso.', paidOrders),
                    rollup('Ticket promedio', 'ticket_promedio', 'pedidos', 'cliente', 'avg', 'total',
                        'Promedio de sus pedidos completados o en proceso.', paidOrders),
                    rollup('Último pedido', 'ultimo_pedido', 'pedidos', 'cliente', 'max', 'fecha',
                        'Fecha de su pedido más reciente.'),
                ],
                { settings: { title_field_id: ref('nombre') } },
            ),
            list(
                'productos',
                'Productos',
                'package',
                '#7F54B3',
                [
                    f('Nombre', 'nombre', 'text'),
                    // La foto junto al nombre: es lo primero que se mira para reconocer un producto.
                    f('Imagen', 'imagen', 'url', { config: { display: 'image' } }),
                    select('Tipo', 'tipo', PRODUCT_TYPE),
                    f('Atributos', 'atributos', 'text', { description: 'La talla, el color… de cada variación.' }),
                    f('SKU', 'sku', 'text'),
                    f('Slug', 'slug_url', 'text', {
                        description: 'La última parte de la dirección del producto en la tienda (…/producto/<slug>/).',
                    }),
                    select('Publicación', 'estado', PRODUCT_STATUS),
                    money('Precio', 'precio', 'El precio al que se vende hoy (el rebajado si hay rebaja).'),
                    money('Precio normal', 'precio_normal'),
                    money('Precio rebajado', 'precio_rebajado'),
                    f('Stock', 'stock', 'number', {
                        description: 'En un producto con variaciones, la suma de las unidades de todas sus variaciones.',
                    }),
                    f('Controla stock', 'controla_stock', 'checkbox', {
                        description: 'La tienda lleva la cuenta de las unidades. Sin esto, sólo dice si hay o no hay.',
                    }),
                    select('Estado del stock', 'estado_stock', STOCK_STATUS),
                    f('Alerta de stock bajo', 'umbral_stock', 'number', {
                        description: 'Con cuántas unidades se considera «stock bajo». Vacío = el general de la tienda.',
                    }),
                    select('Inventario', 'estado_inventario', INVENTORY_STATE),
                    money('Valor en stock', 'valor_inventario', 'Unidades en stock × precio de venta.'),
                    rollup('Vendidas (30 días)', 'vendidas_30d', 'pedidos', 'producto', 'sum', 'cantidad',
                        'Unidades vendidas en los últimos 30 días (pedidos completados o en proceso).',
                        [paidLines, { slug: 'fecha', op: 'between_relative', value: 'last_30_days' }]),
                    f('Meses de cobertura', 'cobertura_meses', 'computed', {
                        config: { operation: 'divide', inputs: [ref('stock'), ref('vendidas_30d')] },
                        description: 'Stock ÷ vendidas en 30 días: cuántos meses alcanza al ritmo de venta actual.',
                    }),
                    rollup('Unidades vendidas', 'unidades_vendidas', 'pedidos', 'producto', 'sum', 'cantidad',
                        'Unidades en pedidos completados o en proceso (en un producto con variaciones, de todas).', paidLines),
                    rollup('Ingresos', 'ingresos', 'pedidos', 'producto', 'sum', 'total',
                        'Lo vendido en pedidos completados o en proceso.', paidLines),
                    f('Categorías', 'categorias', 'multi_select', { config: { options: [] } }),
                    f('Etiquetas', 'etiquetas', 'multi_select', { config: { options: [] } }),
                    f('Enlace', 'enlace', 'url', { description: 'La página en la tienda (lo que ve el cliente).' }),
                    editLink('el producto (las variaciones se editan dentro de su producto)'),
                    wooId(),
                    f('Modificado en la tienda', 'modificado', 'datetime'),
                ],
                {
                    settings: { title_field_id: ref('nombre') },
                    views: [restockView(), kanban('Por inventario', 'estado_inventario')],
                },
            ),
            list(
                'pedidos',
                'Pedidos',
                'receipt',
                '#7F54B3',
                [
                    f('Pedido', 'numero', 'text', {
                        description: 'El número del pedido; en cada línea, lo que se compró.',
                    }),
                    select('Tipo', 'tipo', ORDER_KIND),
                    f('Cliente', 'cliente', 'relation', { config: { target_list_id: listRef('clientes') } }),
                    select('Estado', 'estado', ORDER_STATUS),
                    f('Fecha', 'fecha', 'datetime'),
                    f('Unidades', 'cantidad', 'number', { description: 'En un pedido, el total de unidades; en una línea, las de ese producto.' }),
                    money('Precio unitario', 'precio'),
                    money('Total', 'total', 'En un pedido, lo que se cobró; en una línea, lo de ese producto.'),
                    f('Producto', 'producto', 'relation', {
                        config: { target_list_id: listRef('productos') },
                        description: 'En cada línea: el producto y, si tiene, la variación exacta.',
                    }),
                    f('SKU', 'sku', 'text'),
                    money('Subtotal', 'subtotal'),
                    money('Envío', 'envio'),
                    money('Descuento', 'descuento'),
                    money('Impuestos', 'impuestos'),
                    f('Moneda', 'moneda', 'text'),
                    f('Método de pago', 'metodo_pago', 'text'),
                    f('Email', 'email', 'email'),
                    phone('Teléfono', 'telefono'),
                    f('Ciudad', 'ciudad', 'text'),
                    f('País', 'pais', 'text'),
                    f('Dirección', 'direccion', 'text'),
                    f('Nota del cliente', 'nota_cliente', 'long_text'),
                    f('Cupones', 'cupones', 'text'),
                    wooId(),
                    f('Modificado en la tienda', 'modificado', 'datetime'),
                    f('Ver en WooCommerce', 'enlace', 'url'),
                ],
                {
                    settings: { title_field_id: ref('numero') },
                    views: [kanban('Por estado', 'estado')],
                },
            ),
        ],
        dashboards: [
            dashboard(`Ventas · ${o.storeName}`.slice(0, 190), 'Pedidos, ventas y lo más vendido de la tienda.', [
                kpi('pedidos', 'Ventas', { metric: 'sum', metric_field_id: ref('total'), icon: 'dollar', filter_tree: paidOrdersTree }, 0),
                kpi('pedidos', 'Pedidos', { icon: 'cart', filter_tree: paidOrdersTree }, 3),
                kpi('pedidos', 'Ticket promedio', { metric: 'avg', metric_field_id: ref('total'), icon: 'trending', filter_tree: paidOrdersTree }, 6),
                kpi('clientes', 'Clientes', { icon: 'users' }, 9),
                widget('chart_line', 'pedidos', 'Ventas por mes', {
                    metric: 'sum', metric_field_id: ref('total'), date_field_id: ref('fecha'), time_bucket: 'month', filter_tree: paidOrdersTree,
                }, 0, 2, 8, 4),
                widget('chart_pie', 'pedidos', 'Pedidos por estado', { group_by_field_id: ref('estado'), center_label: 'Pedidos', filter_tree: ordersOnly }, 8, 2, 4, 4),
                widget('table', 'productos', 'Lo más vendido', {
                    limit: 10, sort_field_id: ref('ingresos'), sort_dir: 'desc',
                    visible_field_ids: [ref('nombre'), ref('unidades_vendidas'), ref('ingresos'), ref('stock')],
                }, 0, 6, 6, 5),
                widget('table', 'clientes', 'Mejores clientes', {
                    limit: 10, sort_field_id: ref('total_comprado'), sort_dir: 'desc',
                    visible_field_ids: [ref('nombre'), ref('pedidos'), ref('total_comprado'), ref('ultimo_pedido')],
                }, 6, 6, 6, 5),
            ]),
            inventoryDashboard(o.storeName),
        ],
    };
}

/**
 * La vista de trabajo del inventario: lo agotado o por agotarse, lo más
 * urgente arriba. Un producto con variaciones aparece si ALGUNA variación lo
 * necesita (el mapeo le pone al padre el peor estado de sus hijas) y al
 * desplegarlo se ve cuál.
 */
function restockView() {
    return table(INVENTORY_VIEW_NAME, false, {
        filter_tree: group(cond('estado_inventario', 'in', LOW_OR_OUT)),
        filters: [{ field_id: ref('estado_inventario'), op: 'in', value: LOW_OR_OUT }],
        sort: [{ field_id: ref('stock'), dir: 'asc' }],
    });
}

export function inventoryDashboard(storeName: string) {
    // Sólo filas con stock propio: sumar también al producto variable (que ya
    // es la suma de sus variaciones) contaría todo dos veces.
    const stockRows = (...more: Array<Record<string, unknown>>) => group(cond('tipo', 'in', STOCK_ROWS), ...more);
    const state = (v: string[]) => stockRows(cond('estado_inventario', 'in', v));
    return dashboard(`${INVENTORY_DASHBOARD_PREFIX}${storeName}`.slice(0, 190), 'Qué hay, qué falta y qué reponer.', [
        kpi('productos', 'Agotados', { icon: 'alert', filter_tree: state(['agotado']) }, 0),
        kpi('productos', 'Con stock bajo', { icon: 'alert', filter_tree: state(['bajo']) }, 3),
        kpi('productos', 'Valor en stock', { metric: 'sum', metric_field_id: ref('valor_inventario'), icon: 'dollar', filter_tree: stockRows() }, 6),
        kpi('productos', 'Unidades en stock', { metric: 'sum', metric_field_id: ref('stock'), icon: 'briefcase', filter_tree: stockRows() }, 9),
        widget('chart_pie', 'productos', 'Inventario', { group_by_field_id: ref('estado_inventario'), center_label: 'Artículos', filter_tree: stockRows() }, 0, 2, 5, 5),
        widget('table', 'productos', 'Para reponer', {
            limit: 15, sort_field_id: ref('stock'), sort_dir: 'asc', filter_tree: group(cond('estado_inventario', 'in', LOW_OR_OUT)),
            visible_field_ids: [ref('nombre'), ref('stock'), ref('estado_inventario'), ref('vendidas_30d'), ref('cobertura_meses')],
        }, 5, 2, 7, 5),
    ]);
}
