import { BLUEPRINT_VERSION, WOO_ORDER_STATUS_OPTIONS, type ListBlueprint, type StoreSyncResource } from '@imagina-base/shared';
import { dashboard, f, kanban, kpi, list, listRef, opt, ref, rollup, select, table, widget } from '../../templates/blueprint-dsl';
import type { BlueprintField, ListBlueprint as Blueprint } from '@imagina-base/shared';

/**
 * El PACK de la tienda (v0.1.206, ADR-S24): cinco listas vinculadas y un
 * tablero, en el MISMO formato que las plantillas del sistema, así los crea el
 * mismo motor (`BlueprintService.materialize`).
 *
 * Las preguntas de negocio —cuánto compró un cliente, cuánto vendió un
 * producto o una talla— NO se traen de la tienda: son rollups sobre las
 * relaciones (líneas → pedido/producto/variación, pedido → cliente). Así se
 * recalculan solas, se filtran, se ordenan y se grafican como cualquier dato.
 *
 * Los `slug` de acá son la clave con la que el MAPEO del motor
 * (`woo-map.ts`) nombra cada dato; al crear el pack se traducen a ids de campo
 * y eso es lo que se guarda (regla de oro nº 1: renombrar un campo no rompe la
 * sincronización).
 */

/** Recurso → key de la lista en el blueprint. */
export const WOO_LIST_KEYS: Record<StoreSyncResource, string> = {
    customers: 'clientes',
    products: 'productos',
    variations: 'variaciones',
    orders: 'pedidos',
    line_items: 'lineas',
};

/** Estados que cuentan como venta (lo cobrado o por despachar). */
export const PAID_STATUSES = ['completed', 'processing'];

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
/** El estado de inventario que se lee de un vistazo (lo deriva el mapeo, v0.1.208). */
const INVENTORY_STATE = [
    opt('agotado', 'Agotado', 'rose'),
    opt('bajo', 'Stock bajo', 'amber'),
    opt('en_stock', 'En stock', 'emerald'),
    opt('por_encargo', 'Por encargo', 'violet'),
    opt('por_variacion', 'Por variación', 'sky'),
    opt('sin_control', 'Sin control de stock', 'slate'),
];
const LOW_OR_OUT = ['agotado', 'bajo'];

/**
 * Pack de la tienda: 1 = v0.1.206 (sin inventario), 2 = v0.1.208 (inventario:
 * estado, umbral, valor, rotación, vistas «Para reponer» y tablero). Una
 * sincronización creada antes se ACTUALIZA sola a la versión nueva.
 */
export const WOO_PACK_VERSION = 2;

/** Los slugs que agregó el pack 2 (lo que falta en una sincronización vieja). */
export const INVENTORY_FIELD_SLUGS = [
    'controla_stock',
    'umbral_stock',
    'estado_inventario',
    'valor_inventario',
    'vendidas_30d',
    'cobertura_meses',
    'stock_variaciones',
    'valor_variaciones',
];
export const INVENTORY_VIEW_NAME = 'Para reponer';
export const INVENTORY_DASHBOARD_PREFIX = 'Inventario · ';

const PRODUCT_TYPE = [
    opt('simple', 'Simple', 'sky'),
    opt('variable', 'Variable', 'violet'),
    opt('grouped', 'Agrupado', 'amber'),
    opt('external', 'Externo', 'slate'),
];

export interface WooPackOptions {
    storeName: string;
    currency: string;
    precision: number;
    /** País por defecto de los teléfonos (ISO2 de la tienda), si se conoce. */
    phoneCountry: string | null;
}

export function buildWooPack(o: WooPackOptions): ListBlueprint {
    const money = (label: string, slug: string) =>
        f(label, slug, 'currency', { config: { currency: o.currency, precision: o.precision } });
    const phone = (label: string, slug: string) =>
        f(label, slug, 'phone', { config: o.phoneCountry ? { default_country: o.phoneCountry } : {} });
    const wooId = () =>
        f('ID WooCommerce', 'woo_id', 'text', {
            is_indexed: true,
            description: 'El número del registro en la tienda. Lo usan las acciones de WooCommerce ({{woo_id}}).',
        });
    const paid = { slug: 'estado_pedido', op: 'in', value: PAID_STATUSES };
    const paidOrders = { slug: 'estado', op: 'in', value: PAID_STATUSES };
    const paidTree = { type: 'condition', field_id: ref('estado'), op: 'in', value: PAID_STATUSES };

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
                    f('Email', 'email', 'email', { is_indexed: true }),
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
                    f('SKU', 'sku', 'text', { is_indexed: true }),
                    select('Tipo', 'tipo', PRODUCT_TYPE),
                    select('Publicación', 'estado', PRODUCT_STATUS),
                    money('Precio', 'precio'),
                    money('Precio normal', 'precio_normal'),
                    money('Precio rebajado', 'precio_rebajado'),
                    f('Stock', 'stock', 'number'),
                    select('Inventario', 'estado_stock', STOCK_STATUS),
                    ...inventoryFields('lineas', 'producto', o),
                    rollup('Stock de variaciones', 'stock_variaciones', 'variaciones', 'producto', 'sum', 'stock',
                        'Unidades en stock sumando todas sus variaciones (talla, color…).'),
                    rollup('Valor en variaciones', 'valor_variaciones', 'variaciones', 'producto', 'sum', 'valor_inventario',
                        'Lo que valen, a precio de venta, las unidades de todas sus variaciones.'),
                    f('Categorías', 'categorias', 'multi_select', { config: { options: [] } }),
                    f('Etiquetas', 'etiquetas', 'multi_select', { config: { options: [] } }),
                    f('Imagen', 'imagen', 'url'),
                    f('Enlace', 'enlace', 'url'),
                    wooId(),
                    f('Modificado en la tienda', 'modificado', 'datetime'),
                    rollup('Unidades vendidas', 'unidades_vendidas', 'lineas', 'producto', 'sum', 'cantidad',
                        'Unidades en pedidos completados o en proceso (todas sus variaciones).', paid),
                    rollup('Ingresos', 'ingresos', 'lineas', 'producto', 'sum', 'total',
                        'Lo vendido en pedidos completados o en proceso.', paid),
                    rollup('Variaciones', 'variaciones', 'variaciones', 'producto', 'count', null,
                        'Cuántas variaciones (talla, color…) tiene.'),
                ],
                {
                    settings: { title_field_id: ref('nombre') },
                    views: [table(), restockView(), kanban('Por inventario', 'estado_inventario')],
                },
            ),
            list(
                'variaciones',
                'Variaciones',
                't_shirt',
                '#7F54B3',
                [
                    f('Nombre', 'nombre', 'text'),
                    f('Producto', 'producto', 'relation', { config: { target_list_id: listRef('productos') } }),
                    f('Atributos', 'atributos', 'text'),
                    f('SKU', 'sku', 'text', { is_indexed: true }),
                    money('Precio', 'precio'),
                    money('Precio normal', 'precio_normal'),
                    money('Precio rebajado', 'precio_rebajado'),
                    f('Stock', 'stock', 'number'),
                    select('Inventario', 'estado_stock', STOCK_STATUS),
                    ...inventoryFields('lineas', 'variacion', o),
                    select('Publicación', 'estado', PRODUCT_STATUS),
                    f('Imagen', 'imagen', 'url'),
                    wooId(),
                    f('Modificado en la tienda', 'modificado', 'datetime'),
                    rollup('Unidades vendidas', 'unidades_vendidas', 'lineas', 'variacion', 'sum', 'cantidad',
                        'Unidades de ESTA variación en pedidos completados o en proceso.', paid),
                    rollup('Ingresos', 'ingresos', 'lineas', 'variacion', 'sum', 'total',
                        'Lo vendido de esta variación en pedidos completados o en proceso.', paid),
                ],
                {
                    settings: { title_field_id: ref('nombre') },
                    views: [table(), restockView(), kanban('Por inventario', 'estado_inventario')],
                },
            ),
            list(
                'pedidos',
                'Pedidos',
                'receipt',
                '#7F54B3',
                [
                    f('Pedido', 'numero', 'text', { is_indexed: true }),
                    f('Cliente', 'cliente', 'relation', { config: { target_list_id: listRef('clientes') } }),
                    select('Estado', 'estado', ORDER_STATUS),
                    f('Fecha', 'fecha', 'datetime'),
                    money('Total', 'total'),
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
                    rollup('Líneas', 'lineas', 'lineas', 'pedido', 'count', null, 'Productos distintos en el pedido.'),
                    rollup('Unidades', 'unidades', 'lineas', 'pedido', 'sum', 'cantidad', 'Unidades en total.'),
                ],
                {
                    settings: { title_field_id: ref('numero') },
                    views: [table(), kanban('Por estado', 'estado')],
                },
            ),
            list(
                'lineas',
                'Líneas de pedido',
                'list',
                '#7F54B3',
                [
                    f('Producto', 'nombre', 'text'),
                    f('Pedido', 'pedido', 'relation', { config: { target_list_id: listRef('pedidos') } }),
                    f('Producto vinculado', 'producto', 'relation', { config: { target_list_id: listRef('productos') } }),
                    f('Variación', 'variacion', 'relation', { config: { target_list_id: listRef('variaciones') } }),
                    f('SKU', 'sku', 'text'),
                    f('Cantidad', 'cantidad', 'number'),
                    money('Precio', 'precio'),
                    money('Total', 'total'),
                    f('Fecha', 'fecha', 'datetime'),
                    select('Estado del pedido', 'estado_pedido', ORDER_STATUS),
                    wooId(),
                ],
                { settings: { title_field_id: ref('nombre') } },
            ),
        ],
        dashboards: [
            dashboard(`Ventas · ${o.storeName}`.slice(0, 190), 'Pedidos, ventas y lo más vendido de la tienda.', [
                kpi('pedidos', 'Ventas', { metric: 'sum', metric_field_id: ref('total'), icon: 'dollar', filter_tree: paidTree }, 0),
                kpi('pedidos', 'Pedidos', { icon: 'cart', filter_tree: paidTree }, 3),
                kpi('pedidos', 'Ticket promedio', { metric: 'avg', metric_field_id: ref('total'), icon: 'trending', filter_tree: paidTree }, 6),
                kpi('clientes', 'Clientes', { icon: 'users' }, 9),
                widget('chart_line', 'pedidos', 'Ventas por mes', {
                    metric: 'sum', metric_field_id: ref('total'), date_field_id: ref('fecha'), time_bucket: 'month', filter_tree: paidTree,
                }, 0, 2, 8, 4),
                widget('chart_pie', 'pedidos', 'Pedidos por estado', { group_by_field_id: ref('estado'), center_label: 'Pedidos' }, 8, 2, 4, 4),
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
 * Los campos de inventario de productos y variaciones. Los cuatro primeros los
 * trae la sincronización; la rotación y la cobertura se CALCULAN sobre las
 * líneas de pedido, así responden "¿cuánto me dura lo que tengo?" sin que la
 * tienda lo sepa.
 */
function inventoryFields(linesKey: string, linesRelSlug: string, o: WooPackOptions): BlueprintField[] {
    const paidLast30 = [
        { slug: 'estado_pedido', op: 'in', value: PAID_STATUSES },
        { slug: 'fecha', op: 'between_relative', value: 'last_30_days' },
    ];
    return [
        f('Controla stock', 'controla_stock', 'checkbox', {
            description: 'La tienda lleva la cuenta de las unidades. Sin esto, sólo dice si hay o no hay.',
        }),
        f('Alerta de stock bajo', 'umbral_stock', 'number', {
            description: 'Con cuántas unidades se considera «stock bajo». Vacío = el general de la tienda.',
        }),
        select('Estado de inventario', 'estado_inventario', INVENTORY_STATE),
        f('Valor en stock', 'valor_inventario', 'currency', {
            config: { currency: o.currency, precision: o.precision },
            description: 'Unidades en stock × precio de venta.',
        }),
        rollup('Vendidas (30 días)', 'vendidas_30d', linesKey, linesRelSlug, 'sum', 'cantidad',
            'Unidades vendidas en los últimos 30 días (pedidos completados o en proceso).', paidLast30),
        f('Meses de cobertura', 'cobertura_meses', 'computed', {
            config: { operation: 'divide', inputs: [ref('stock'), ref('vendidas_30d')] },
            description: 'Stock ÷ vendidas en 30 días: cuántos meses alcanza al ritmo de venta actual.',
        }),
    ];
}

/** La vista de trabajo del inventario: lo agotado o por agotarse, lo más urgente arriba. */
function restockView() {
    // La raíz de un filtro de vista es SIEMPRE un grupo (filterTreeSchema).
    const tree = {
        type: 'group',
        logic: 'and',
        children: [{ type: 'condition', field_id: ref('estado_inventario'), op: 'in', value: LOW_OR_OUT }],
    };
    return table(INVENTORY_VIEW_NAME, false, {
        filter_tree: tree,
        filters: [{ field_id: ref('estado_inventario'), op: 'in', value: LOW_OR_OUT }],
        sort: [{ field_id: ref('stock'), dir: 'asc' }],
    });
}

export function inventoryDashboard(storeName: string) {
    const state = (v: string[]) => ({ type: 'condition', field_id: ref('estado_inventario'), op: 'in', value: v });
    const restock = (listKey: string, title: string, x: number) =>
        widget('table', listKey, title, {
            limit: 15, sort_field_id: ref('stock'), sort_dir: 'asc', filter_tree: state(LOW_OR_OUT),
            visible_field_ids: [ref('nombre'), ref('stock'), ref('estado_inventario'), ref('vendidas_30d'), ref('cobertura_meses')],
        }, x, 8, 6, 6);
    return dashboard(`${INVENTORY_DASHBOARD_PREFIX}${storeName}`.slice(0, 190), 'Qué hay, qué falta y qué reponer.', [
        kpi('productos', 'Productos agotados', { icon: 'alert', filter_tree: state(['agotado']) }, 0),
        kpi('productos', 'Con stock bajo', { icon: 'alert', filter_tree: state(['bajo']) }, 3),
        kpi('variaciones', 'Variaciones agotadas', { icon: 'alert', filter_tree: state(['agotado']) }, 6),
        kpi('variaciones', 'Variaciones con stock bajo', { icon: 'alert', filter_tree: state(['bajo']) }, 9),
        kpi('productos', 'Valor en stock (productos)', { metric: 'sum', metric_field_id: ref('valor_inventario'), icon: 'dollar' }, 0, 2, 4),
        kpi('variaciones', 'Valor en stock (variaciones)', { metric: 'sum', metric_field_id: ref('valor_inventario'), icon: 'dollar' }, 4, 2, 4),
        kpi('productos', 'Unidades en stock', { metric: 'sum', metric_field_id: ref('stock'), icon: 'briefcase' }, 8, 2, 4),
        widget('chart_pie', 'productos', 'Productos por estado de inventario', { group_by_field_id: ref('estado_inventario'), center_label: 'Productos' }, 0, 4, 6, 4),
        widget('chart_pie', 'variaciones', 'Variaciones por estado de inventario', { group_by_field_id: ref('estado_inventario'), center_label: 'Variaciones' }, 6, 4, 6, 4),
        restock('productos', 'Productos para reponer', 0),
        restock('variaciones', 'Variaciones para reponer', 6),
    ]);
}

/**
 * Lo que el pack 2 le agrega a una sincronización hecha con el pack 1: los
 * campos de inventario de Productos y Variaciones, su vista «Para reponer» y
 * el tablero de Inventario. Se DERIVA del pack completo (una sola definición:
 * lo que ve una tienda nueva y lo que recibe una vieja no pueden divergir).
 */
export function inventoryAddition(full: Blueprint, withProducts: boolean): Blueprint {
    const keys = withProducts ? new Set(['productos', 'variaciones']) : new Set<string>();
    return {
        version: full.version,
        lists: full.lists
            .filter((l) => keys.has(l.key))
            .map((l) => ({
                ...l,
                fields: l.fields.filter((fd) => INVENTORY_FIELD_SLUGS.includes(fd.slug)),
                views: l.views.filter((v) => v.name === INVENTORY_VIEW_NAME),
                automations: [],
                records: [],
            })),
        dashboards: withProducts ? full.dashboards.filter((d) => d.name.startsWith(INVENTORY_DASHBOARD_PREFIX)) : [],
    };
}
