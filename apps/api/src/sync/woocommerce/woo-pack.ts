import { BLUEPRINT_VERSION, WOO_ORDER_STATUS_OPTIONS, type ListBlueprint, type StoreSyncResource } from '@imagina-base/shared';
import { dashboard, f, kanban, kpi, list, listRef, lookup, opt, ref, rollup, select, table, widget } from '../../templates/blueprint-dsl';
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
 * estado, umbral, valor, rotación, vistas «Para reponer» y tablero), 3 =
 * v0.1.209 (reposición: proveedores, órdenes de compra y sus líneas, «Sumar
 * al stock» y «En camino»). Una sincronización creada antes se ACTUALIZA sola
 * a la versión nueva.
 */
export const WOO_PACK_VERSION = 4;

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
/** Los slugs que agregó el pack 3 a Productos y Variaciones. */
export const RESTOCK_FIELD_SLUGS = ['sumar_stock', 'en_camino', 'ultimo_movimiento'];
/**
 * v0.1.210 — Lo que sirve para IDENTIFICAR cada registro en la tienda: el
 * enlace de edición en el panel de WooCommerce, el enlace público de la
 * variación y el SKU en la línea de compra (al proveedor se le pide por SKU).
 * Por lista (clave del pack), porque Clientes también suma uno.
 */
export const IDENTITY_FIELD_SLUGS: Record<string, string[]> = {
    clientes: ['editar'],
    productos: ['editar'],
    variaciones: ['enlace', 'editar'],
    lineas_compra: ['sku'],
};
/** Las listas de compras (key del pack) que agregó el pack 3. */
export const PURCHASE_LIST_KEYS = { suppliers: 'proveedores', orders: 'compras', lines: 'lineas_compra' } as const;
export const INVENTORY_VIEW_NAME = 'Para reponer';
export const INVENTORY_DASHBOARD_PREFIX = 'Inventario · ';

/** Estados de una orden de compra (los mismos valores que `PURCHASE_ORDER_STATUSES` de shared). */
const PURCHASE_STATUS = [
    opt('borrador', 'Borrador', 'slate'),
    opt('enviada', 'Enviada al proveedor', 'sky'),
    opt('recibida_parcial', 'Recibida en parte', 'amber'),
    opt('recibida', 'Recibida', 'emerald'),
    opt('cancelada', 'Cancelada', 'rose'),
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
    const editLink = (what: string) =>
        f('Editar en WooCommerce', 'editar', 'url', { description: `Abre ${what} en el panel de administración de la tienda.` });
    const image = () => f('Imagen', 'imagen', 'url', { config: { display: 'image' } });
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
                    image(),
                    f('SKU', 'sku', 'text', { is_indexed: true }),
                    select('Tipo', 'tipo', PRODUCT_TYPE),
                    select('Publicación', 'estado', PRODUCT_STATUS),
                    money('Precio', 'precio'),
                    money('Precio normal', 'precio_normal'),
                    money('Precio rebajado', 'precio_rebajado'),
                    f('Stock', 'stock', 'number'),
                    select('Inventario', 'estado_stock', STOCK_STATUS),
                    ...inventoryFields('lineas', 'producto', o),
                    ...restockFields('producto', 'Unidades pedidas a proveedores (de este producto y sus variaciones) que todavía no llegaron.'),
                    rollup('Stock de variaciones', 'stock_variaciones', 'variaciones', 'producto', 'sum', 'stock',
                        'Unidades en stock sumando todas sus variaciones (talla, color…).'),
                    rollup('Valor en variaciones', 'valor_variaciones', 'variaciones', 'producto', 'sum', 'valor_inventario',
                        'Lo que valen, a precio de venta, las unidades de todas sus variaciones.'),
                    f('Categorías', 'categorias', 'multi_select', { config: { options: [] } }),
                    f('Etiquetas', 'etiquetas', 'multi_select', { config: { options: [] } }),
                    f('Enlace', 'enlace', 'url', { description: 'La página del producto en la tienda (lo que ve el cliente).' }),
                    editLink('el producto'),
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
                    image(),
                    f('Producto', 'producto', 'relation', { config: { target_list_id: listRef('productos') } }),
                    f('Atributos', 'atributos', 'text'),
                    f('SKU', 'sku', 'text', { is_indexed: true }),
                    money('Precio', 'precio'),
                    money('Precio normal', 'precio_normal'),
                    money('Precio rebajado', 'precio_rebajado'),
                    f('Stock', 'stock', 'number'),
                    select('Inventario', 'estado_stock', STOCK_STATUS),
                    ...inventoryFields('lineas', 'variacion', o),
                    ...restockFields('variacion', 'Unidades de esta variación pedidas a proveedores que todavía no llegaron.'),
                    select('Publicación', 'estado', PRODUCT_STATUS),
                    f('Enlace', 'enlace', 'url', { description: 'La página de la variación en la tienda (lo que ve el cliente).' }),
                    editLink('el producto de esta variación (las variaciones se editan dentro de su producto)'),
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
            ...purchaseLists(money),
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

/**
 * v0.1.209 — Reposición en Productos y Variaciones: «Sumar al stock» (se
 * escribe cuántas unidades entraron y la app las SUMA en la tienda, leyendo
 * el stock de ese momento), «En camino» (lo pedido a proveedores que no
 * llegó) y el último movimiento (qué se sumó, cuándo y por qué).
 */
function restockFields(linesRelSlug: string, inTransitHelp: string): BlueprintField[] {
    return [
        f('Sumar al stock', 'sumar_stock', 'number', {
            description: 'Escribí cuántas unidades entraron (o un negativo para descontar): se suman al stock de la tienda y la celda vuelve a quedar vacía.',
        }),
        rollup('En camino', 'en_camino', PURCHASE_LIST_KEYS.lines, linesRelSlug, 'sum', 'pendiente', inTransitHelp),
        f('Último movimiento de stock', 'ultimo_movimiento', 'text', {
            description: 'Lo último que la app sumó o descontó en la tienda, y por qué.',
        }),
    ];
}

/**
 * v0.1.209 — Las listas de COMPRAS: a quién se le compra, qué se le pidió y
 * cada renglón del pedido. No existen en WooCommerce: son de la empresa.
 * Lo que cruza a la tienda es el efecto de recibir una orden (el stock sube,
 * ver `StorePurchasingService`). Varias columnas de las líneas las mantiene
 * la app (subtotal, lo ya sumado, lo pendiente, el artículo): se dice en su
 * descripción.
 */
function purchaseLists(money: (label: string, slug: string) => BlueprintField): Blueprint['lists'] {
    const K = PURCHASE_LIST_KEYS;
    return [
        list(
            K.suppliers,
            'Proveedores',
            'handshake',
            '#7F54B3',
            [
                f('Nombre', 'nombre', 'text'),
                f('Contacto', 'contacto', 'text'),
                f('Email', 'email', 'email'),
                f('Teléfono', 'telefono', 'phone'),
                f('Tiempo de entrega (días)', 'entrega_dias', 'number', {
                    description: 'Cuántos días tarda en llegar un pedido, para calcular la fecha esperada.',
                }),
                f('Notas', 'notas', 'long_text'),
                rollup('Órdenes', 'ordenes', K.orders, 'proveedor', 'count', null, 'Órdenes de compra hechas a este proveedor.'),
                rollup('Última orden', 'ultima_orden', K.orders, 'proveedor', 'max', 'fecha', 'Fecha de la orden más reciente.'),
            ],
            { settings: { title_field_id: ref('nombre') } },
        ),
        list(
            K.orders,
            'Órdenes de compra',
            'truck',
            '#7F54B3',
            [
                f('Orden', 'numero', 'text', {
                    is_indexed: true,
                    description: 'Se numera sola (OC-0001, OC-0002…) si la dejás vacía.',
                }),
                f('Proveedor', 'proveedor', 'relation', { config: { target_list_id: listRef(K.suppliers) } }),
                select('Estado', 'estado', PURCHASE_STATUS),
                f('Fecha', 'fecha', 'date'),
                f('Entrega esperada', 'entrega', 'date'),
                f('Recibida el', 'recibida_el', 'datetime', { description: 'Se completa sola al recibir la orden entera.' }),
                rollup('Líneas', 'lineas', K.lines, 'orden', 'count', null, 'Artículos distintos en la orden.'),
                rollup('Unidades', 'unidades', K.lines, 'orden', 'sum', 'cantidad', 'Unidades pedidas en total.'),
                rollup('Total', 'total', K.lines, 'orden', 'sum', 'subtotal', 'Suma de los subtotales (cantidad × costo).'),
                rollup('Por recibir', 'por_recibir', K.lines, 'orden', 'sum', 'pendiente', 'Unidades que todavía no llegaron.'),
                f('Resultado de la recepción', 'resultado', 'long_text', {
                    description: 'Qué se sumó al stock de la tienda al recibir la orden (o qué no se pudo). Lo escribe la app.',
                }),
                f('Notas', 'notas', 'long_text'),
            ],
            {
                settings: { title_field_id: ref('numero') },
                views: [table(), kanban('Por estado', 'estado')],
            },
        ),
        list(
            K.lines,
            'Líneas de compra',
            'list',
            '#7F54B3',
            [
                f('Artículo', 'articulo', 'text', { description: 'Se completa solo con el producto o la variación elegida.' }),
                f('SKU', 'sku', 'text', {
                    is_indexed: true,
                    description: 'El SKU del producto o la variación: se completa solo (al proveedor se le pide por SKU).',
                }),
                f('Orden de compra', 'orden', 'relation', { config: { target_list_id: listRef(K.orders) } }),
                f('Producto', 'producto', 'relation', { config: { target_list_id: listRef('productos') } }),
                f('Variación', 'variacion', 'relation', {
                    config: { target_list_id: listRef('variaciones') },
                    description: 'En un producto con variaciones, la talla o el color exacto que se repone.',
                }),
                f('Cantidad pedida', 'cantidad', 'number'),
                f('Cantidad recibida', 'recibida', 'number', {
                    description: 'Vacío = llegó todo lo pedido (cuando la orden se marca «Recibida»). Con «Recibida en parte» se suma lo que diga acá.',
                }),
                money('Costo unitario', 'costo'),
                money('Subtotal', 'subtotal'),
                f('Sumado al stock', 'aplicada', 'number', {
                    description: 'Unidades de esta línea que ya se sumaron al stock de la tienda. Lo lleva la app: así recibir dos veces no suma dos veces.',
                }),
                f('Pendiente de recibir', 'pendiente', 'number', { description: 'Lo pedido que todavía no llegó (lo lleva la app).' }),
                lookup('Estado de la orden', 'estado_orden', K.lines, 'orden', K.orders, 'estado', 'El estado de la orden de compra de esta línea.'),
                f('Último movimiento', 'movimiento', 'text', { description: 'Qué se sumó al stock por esta línea (o por qué no).' }),
            ],
            { settings: { title_field_id: ref('articulo') } },
        ),
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
            visible_field_ids: [ref('nombre'), ref('stock'), ref('en_camino'), ref('estado_inventario'), ref('vendidas_30d'), ref('cobertura_meses')],
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
 * Lo que le falta a una sincronización hecha con un pack anterior para quedar
 * en la versión actual. Se DERIVA del pack completo (una sola definición: lo
 * que ve una tienda nueva y lo que recibe una vieja no pueden divergir).
 *  - desde el pack 1: los campos de inventario de Productos y Variaciones,
 *    su vista «Para reponer» y el tablero de Inventario;
 *  - desde el pack 2 (o 1): las columnas de reposición y las tres listas de
 *    compras;
 *  - desde el pack 3 (o antes): los identificadores (`IDENTITY_FIELD_SLUGS`).
 * Sin productos no hay inventario que reponer: lo de inventario y compras
 * queda fuera, pero los identificadores de las otras listas sí llegan.
 */
export function packAddition(
    full: Blueprint,
    fromVersion: number,
    present: boolean | ReadonlySet<string>,
): Blueprint {
    // `present`: qué listas del pack EXISTEN (por su clave). Sólo se agregan
    // campos a listas que ya están: una tienda que no sincroniza clientes no
    // tiene por qué ganar una lista de Clientes vacía en la actualización.
    // `true` = todas (los tests).
    const has = (key: string): boolean => present === true || (present !== false && present.has(key));
    const withProducts = has('productos');
    const slugsFor = (key: string): Set<string> => {
        const out = new Set<string>();
        if (withProducts && (key === 'productos' || key === 'variaciones')) {
            if (fromVersion < 2) INVENTORY_FIELD_SLUGS.forEach((x) => out.add(x));
            if (fromVersion < 3) RESTOCK_FIELD_SLUGS.forEach((x) => out.add(x));
        }
        if (fromVersion < 4) (IDENTITY_FIELD_SLUGS[key] ?? []).forEach((x) => out.add(x));
        return out;
    };
    const purchaseKeys = new Set<string>(withProducts && fromVersion < 3 ? Object.values(PURCHASE_LIST_KEYS) : []);
    const lists: Blueprint['lists'] = [];
    for (const l of full.lists) {
        if (purchaseKeys.has(l.key)) {
            lists.push({ ...l, automations: [], records: [] });
            continue;
        }
        if (!has(l.key)) continue;
        const slugs = slugsFor(l.key);
        const views =
            withProducts && fromVersion < 2 && (l.key === 'productos' || l.key === 'variaciones')
                ? l.views.filter((v) => v.name === INVENTORY_VIEW_NAME)
                : [];
        const fields = l.fields.filter((fd) => slugs.has(fd.slug));
        if (fields.length === 0 && views.length === 0) continue;
        lists.push({ ...l, fields, views, automations: [], records: [] });
    }
    return {
        version: full.version,
        lists,
        dashboards:
            withProducts && fromVersion < 2 ? full.dashboards.filter((d) => d.name.startsWith(INVENTORY_DASHBOARD_PREFIX)) : [],
    };
}
