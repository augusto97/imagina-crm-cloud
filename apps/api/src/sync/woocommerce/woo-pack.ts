import { BLUEPRINT_VERSION, WOO_ORDER_STATUS_OPTIONS, type ListBlueprint, type StoreSyncResource } from '@imagina-base/shared';
import { dashboard, f, kanban, kpi, list, listRef, opt, ref, rollup, select, table, widget } from '../../templates/blueprint-dsl';

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
                    views: [table(), kanban('Por inventario', 'estado_stock')],
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
                    select('Publicación', 'estado', PRODUCT_STATUS),
                    f('Imagen', 'imagen', 'url'),
                    wooId(),
                    f('Modificado en la tienda', 'modificado', 'datetime'),
                    rollup('Unidades vendidas', 'unidades_vendidas', 'lineas', 'variacion', 'sum', 'cantidad',
                        'Unidades de ESTA variación en pedidos completados o en proceso.', paid),
                    rollup('Ingresos', 'ingresos', 'lineas', 'variacion', 'sum', 'total',
                        'Lo vendido de esta variación en pedidos completados o en proceso.', paid),
                ],
                { settings: { title_field_id: ref('nombre') } },
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
                    columns: [ref('nombre'), ref('unidades_vendidas'), ref('ingresos'), ref('stock')],
                }, 0, 6, 6, 5),
                widget('table', 'clientes', 'Mejores clientes', {
                    limit: 10, sort_field_id: ref('total_comprado'), sort_dir: 'desc',
                    columns: [ref('nombre'), ref('pedidos'), ref('total_comprado'), ref('ultimo_pedido')],
                }, 6, 6, 6, 5),
            ]),
        ],
    };
}
