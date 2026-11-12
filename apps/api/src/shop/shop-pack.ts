import {
    BLUEPRINT_VERSION,
    SHOP_ORDER_STATUS_COLORS,
    SHOP_ORDER_STATUS_LABELS,
    SHOP_ORDER_STATUSES,
    SHOP_PAYMENT_METHOD_LABELS,
    SHOP_PAYMENT_METHODS,
    SHOP_PAYMENT_STATUS_COLORS,
    SHOP_PAYMENT_STATUS_LABELS,
    SHOP_PAYMENT_STATUSES,
    shopCurrencyDecimals,
    type ListBlueprint,
} from '@imagina-base/shared';
import { dashboard, f, kanban, kpi, list, listRef, opt, ref, rollup, select, table, widget } from '../templates/blueprint-dsl';

/**
 * v0.1.412 (ADR-S103) — Las listas donde cae cada compra. Se arman con el
 * motor de plantillas (como el registro de cobros de las suscripciones): son
 * listas COMUNES de la empresa —con sus vistas, su tablero, sus
 * automatizaciones— y sólo las columnas que escribe la tienda quedan con
 * candado (marca `shop_orders_of`).
 *
 * Los papeles (`ORDER_ROLES`…) son lo que guarda la tienda en
 * `config.orders.fields`: el slug de cada columna puede cambiar (renombrar),
 * el id no (regla de oro nº 1).
 */

export const ORDER_ROLES = [
    'title',
    'number',
    'status',
    'payment_status',
    'payment_method',
    'total',
    'subtotal',
    'shipping',
    'delivery',
    'customer',
    'email',
    'phone',
    'document',
    'address',
    'notes',
    'items',
    'shop',
    'paid_at',
    'order_url',
    /** v0.1.415 */
    'discount',
    'coupon',
] as const;
export type OrderRole = (typeof ORDER_ROLES)[number];

/** Las columnas del pedido que escribe la tienda (candado). El estado del pedido, la dirección y las notas las maneja el equipo. */
export const PROTECTED_ORDER_ROLES: readonly OrderRole[] = [
    'title',
    'payment_status',
    'payment_method',
    'total',
    'subtotal',
    'shipping',
    'delivery',
    'customer',
    'email',
    'items',
    'shop',
    'paid_at',
    'order_url',
    'discount',
    'coupon',
];

/** v0.1.415 — Columnas que llegaron después del pack: una tienda que ya existía las suma al crear su primer cupón. */
export const LATER_ORDER_COLUMNS: ReadonlyArray<{ role: OrderRole; label: string; slug: string; type: 'currency' | 'text' }> = [
    { role: 'discount', label: 'Descuento', slug: 'descuento', type: 'currency' },
    { role: 'coupon', label: 'Cupón', slug: 'cupon', type: 'text' },
];

export const LINE_ROLES = ['title', 'order', 'product', 'qty', 'unit_price', 'subtotal', 'sku'] as const;
export type LineRole = (typeof LINE_ROLES)[number];

export const CUSTOMER_ROLES = ['name', 'email', 'phone', 'document', 'address', 'city'] as const;
export type CustomerRole = (typeof CUSTOMER_ROLES)[number];

const ORDER_SLUG: Record<OrderRole, string> = {
    title: 'pedido',
    number: 'numero',
    status: 'estado',
    payment_status: 'pago',
    payment_method: 'metodo',
    total: 'total',
    subtotal: 'subtotal',
    shipping: 'envio',
    delivery: 'entrega',
    customer: 'cliente',
    email: 'correo',
    phone: 'telefono',
    document: 'documento',
    address: 'direccion',
    notes: 'notas',
    items: 'productos',
    shop: 'tienda',
    paid_at: 'pagado_el',
    order_url: 'enlace',
    discount: 'descuento',
    coupon: 'cupon',
};
const LINE_SLUG: Record<LineRole, string> = {
    title: 'producto_nombre',
    order: 'pedido',
    product: 'producto',
    qty: 'cantidad',
    unit_price: 'precio',
    subtotal: 'subtotal',
    sku: 'sku',
};
const CUSTOMER_SLUG: Record<CustomerRole, string> = {
    name: 'nombre',
    email: 'correo',
    phone: 'telefono',
    document: 'documento',
    address: 'direccion',
    city: 'ciudad',
};

export interface ShopPackInput {
    shopName: string;
    catalogListId: number;
    catalogListName: string;
    currency: string;
    withDashboard: boolean;
}

/** El blueprint del pack. Las claves de lista son `pedidos`, `lineas` y `clientes`. */
export function shopPackBlueprint(input: ShopPackInput): ListBlueprint {
    const money = { currency: input.currency, precision: shopCurrencyDecimals(input.currency) };
    const symbol = input.currency === 'USD' ? 'US$' : '$';
    const statusOpts = SHOP_ORDER_STATUSES.map((s) => opt(s, SHOP_ORDER_STATUS_LABELS[s], SHOP_ORDER_STATUS_COLORS[s]));
    const payOpts = SHOP_PAYMENT_STATUSES.map((s) => opt(s, SHOP_PAYMENT_STATUS_LABELS[s], SHOP_PAYMENT_STATUS_COLORS[s]));
    const methodColors: Record<string, string> = { whatsapp: '#16a34a', transfer: '#2563eb', cod: '#d97706', online: '#7c3aed', free: '#0d9488' };
    const methodOpts = SHOP_PAYMENT_METHODS.map((m) => opt(m, SHOP_PAYMENT_METHOD_LABELS[m], methodColors[m] ?? '#6b7280'));
    const notCancelled = { type: 'condition', field_id: ref(ORDER_SLUG.status), op: 'neq', value: 'cancelado' };
    const valid = { type: 'group', logic: 'and', children: [notCancelled] };
    const pendingPay = {
        type: 'group',
        logic: 'and',
        children: [
            { type: 'condition', field_id: ref(ORDER_SLUG.payment_status), op: 'eq', value: 'pendiente' },
            notCancelled,
        ],
    };
    const thisMonth = { field_id: ref('fecha'), preset: 'this_month' };
    const productName = input.catalogListName.slice(0, 120) || 'Producto';

    return {
        version: BLUEPRINT_VERSION,
        lists: [
            list(
                'pedidos',
                'Pedidos',
                'shopping_bag',
                '#2563EB',
                [
                    f('Pedido', ORDER_SLUG.title, 'text', { description: 'El número del pedido y quién compró.' }),
                    f('Número', ORDER_SLUG.number, 'autonumber', { config: { prefix: 'PED', separator: '-', digits: 4 } }),
                    select('Estado del pedido', ORDER_SLUG.status, statusOpts),
                    select('Estado del pago', ORDER_SLUG.payment_status, payOpts),
                    select('Forma de pago', ORDER_SLUG.payment_method, methodOpts),
                    f('Total', ORDER_SLUG.total, 'currency', { config: money }),
                    f('Subtotal', ORDER_SLUG.subtotal, 'currency', { config: money }),
                    f('Envío', ORDER_SLUG.shipping, 'currency', { config: money }),
                    f('Descuento', ORDER_SLUG.discount, 'currency', { config: money, description: 'Lo que descontó el cupón.' }),
                    f('Cupón', ORDER_SLUG.coupon, 'text'),
                    f('Entrega', ORDER_SLUG.delivery, 'text'),
                    f('Cliente', ORDER_SLUG.customer, 'relation', { config: { target_list_id: listRef('clientes') } }),
                    f('Correo', ORDER_SLUG.email, 'email'),
                    f('Teléfono', ORDER_SLUG.phone, 'text'),
                    f('Documento', ORDER_SLUG.document, 'text'),
                    f('Dirección', ORDER_SLUG.address, 'long_text'),
                    f('Notas del cliente', ORDER_SLUG.notes, 'long_text'),
                    f('Productos', ORDER_SLUG.items, 'long_text', { description: 'Lo que pidió, con cantidades y precios.' }),
                    rollup('Unidades', 'unidades', 'lineas', LINE_SLUG.order, 'sum', LINE_SLUG.qty, 'Cuántas unidades tiene el pedido.'),
                    f('Tienda', ORDER_SLUG.shop, 'text'),
                    f('Pagado el', ORDER_SLUG.paid_at, 'datetime'),
                    f('Enlace del pedido', ORDER_SLUG.order_url, 'url', { description: 'La página del pedido que ve quien compró.' }),
                    f('Fecha', 'fecha', 'created_at'),
                ],
                {
                    settings: { title_field_id: ref(ORDER_SLUG.title) },
                    views: [
                        table('Todos', true, { sort: [{ field_id: ref('fecha'), dir: 'desc' }] }),
                        kanban('Por estado', ORDER_SLUG.status),
                        table('Por cobrar', false, {
                            filter_tree: pendingPay,
                            sort: [{ field_id: ref('fecha'), dir: 'desc' }],
                        }),
                    ],
                },
            ),
            list(
                'lineas',
                'Líneas de pedido',
                'package',
                '#7C3AED',
                [
                    f('Producto', LINE_SLUG.title, 'text', { description: 'El nombre del producto cuando se compró.' }),
                    f('Pedido', LINE_SLUG.order, 'relation', { config: { target_list_id: listRef('pedidos') } }),
                    f(productName, LINE_SLUG.product, 'relation', { config: { target_list_id: input.catalogListId } }),
                    f('Cantidad', LINE_SLUG.qty, 'number'),
                    f('Precio', LINE_SLUG.unit_price, 'currency', { config: money }),
                    f('Subtotal', LINE_SLUG.subtotal, 'currency', { config: money }),
                    f('Referencia', LINE_SLUG.sku, 'text'),
                    f('Fecha', 'fecha', 'created_at'),
                ],
                {
                    settings: { title_field_id: ref(LINE_SLUG.title) },
                    views: [table('Todas', true, { sort: [{ field_id: ref('fecha'), dir: 'desc' }] })],
                },
            ),
            list(
                'clientes',
                'Clientes de la tienda',
                'users',
                '#0EA5E9',
                [
                    f('Nombre', CUSTOMER_SLUG.name, 'text'),
                    f('Correo', CUSTOMER_SLUG.email, 'email'),
                    f('Teléfono', CUSTOMER_SLUG.phone, 'text'),
                    f('Documento', CUSTOMER_SLUG.document, 'text'),
                    f('Dirección', CUSTOMER_SLUG.address, 'long_text'),
                    f('Ciudad', CUSTOMER_SLUG.city, 'text'),
                    rollup('Pedidos', 'pedidos', 'pedidos', ORDER_SLUG.customer, 'count', null, 'Cuántos pedidos hizo (sin los cancelados).', {
                        slug: ORDER_SLUG.status,
                        op: 'neq',
                        value: 'cancelado',
                    }),
                    rollup('Total comprado', 'total_comprado', 'pedidos', ORDER_SLUG.customer, 'sum', ORDER_SLUG.total, 'Lo que compró (sin los cancelados).', {
                        slug: ORDER_SLUG.status,
                        op: 'neq',
                        value: 'cancelado',
                    }),
                    f('Desde', 'fecha', 'created_at'),
                ],
                {
                    settings: { title_field_id: ref(CUSTOMER_SLUG.name) },
                    views: [table('Todos', true, { sort: [{ field_id: ref('fecha'), dir: 'desc' }] })],
                },
            ),
        ],
        dashboards: input.withDashboard
            ? [
                  dashboard(`Ventas · ${input.shopName}`.slice(0, 190), 'Lo que se vende en la tienda, mes a mes.', [
                      kpi('pedidos', 'Vendido este mes', { metric: 'sum', metric_field_id: ref(ORDER_SLUG.total), prefix: symbol, icon: 'wallet', filter_tree: valid, period: thisMonth }, 0),
                      kpi('pedidos', 'Pedidos este mes', { icon: 'receipt', filter_tree: valid, period: thisMonth }, 3),
                      kpi('pedidos', 'Ticket promedio', { metric: 'avg', metric_field_id: ref(ORDER_SLUG.total), prefix: symbol, icon: 'dollar', filter_tree: valid, period: thisMonth }, 6),
                      kpi('pedidos', 'Por cobrar', { metric: 'sum', metric_field_id: ref(ORDER_SLUG.total), prefix: symbol, icon: 'flag', filter_tree: pendingPay }, 9),
                      widget(
                          'chart_bar',
                          'pedidos',
                          'Vendido por mes',
                          {
                              metric: 'sum',
                              metric_field_id: ref(ORDER_SLUG.total),
                              group_by_field_id: ref('fecha'),
                              date_field_id: ref('fecha'),
                              time_bucket: 'month',
                              filter_tree: valid,
                              bar_orientation: 'vertical',
                          },
                          0,
                          2,
                          8,
                          5,
                      ),
                      widget('chart_pie', 'pedidos', 'Pedidos por estado', { metric: 'count', group_by_field_id: ref(ORDER_SLUG.status), center_label: 'Pedidos' }, 8, 2, 4, 5),
                      widget(
                          'chart_bar',
                          'lineas',
                          'Lo más vendido',
                          {
                              metric: 'sum',
                              metric_field_id: ref(LINE_SLUG.qty),
                              group_by_field_id: ref(LINE_SLUG.title),
                              top_n: 10,
                              bar_orientation: 'horizontal',
                          },
                          0,
                          7,
                          6,
                          5,
                      ),
                      widget(
                          'table',
                          'pedidos',
                          'Últimos pedidos',
                          {
                              limit: 10,
                              sort_field_id: ref('fecha'),
                              sort_dir: 'desc',
                              visible_field_ids: [ref(ORDER_SLUG.title), ref(ORDER_SLUG.status), ref(ORDER_SLUG.payment_status), ref(ORDER_SLUG.total)],
                          },
                          6,
                          7,
                          6,
                          5,
                      ),
                  ]),
              ]
            : [],
    };
}

/** Del resultado de `materialize` a los ids que guarda la tienda. */
export function packFieldIds(fieldIds: Record<string, Record<string, number>>): {
    fields: Partial<Record<OrderRole, number>>;
    line_fields: Partial<Record<LineRole, number>>;
    customer_fields: Partial<Record<CustomerRole, number>>;
} {
    const pick = <R extends string>(key: string, slugs: Record<R, string>): Partial<Record<R, number>> => {
        const ids = fieldIds[key] ?? {};
        const out: Partial<Record<R, number>> = {};
        for (const role of Object.keys(slugs) as R[]) {
            const id = ids[slugs[role]];
            if (typeof id === 'number') out[role] = id;
        }
        return out;
    };
    return { fields: pick('pedidos', ORDER_SLUG), line_fields: pick('lineas', LINE_SLUG), customer_fields: pick('clientes', CUSTOMER_SLUG) };
}
