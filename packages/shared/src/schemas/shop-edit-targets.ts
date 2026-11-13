/**
 * v0.1.428 (ADR-S103) — Tocar una parte de la tienda en la vista previa del
 * editor lleva a su ajuste.
 *
 * La página pública (sólo en la vista previa) marca cada parte con
 * `data-pv="<id>"`; al tocarla le avisa al editor (`imb-shop-edit`) y el
 * editor abre la sección y baja hasta el bloque con ese `data-tour`. El mismo
 * mapa lo usan los dos lados.
 *
 * Sin zod: lo importa la página pública (el cliente va en línea y chico).
 */

/** Las secciones del editor (las mismas que `ShopSection`). */
export type ShopEditSection = 'catalog' | 'style' | 'design' | 'payment' | 'coupons' | 'checkout' | 'seller' | 'orders' | 'measure' | 'domain' | 'publish';

export interface ShopEditTarget {
    /** Lo que se lee en la etiqueta de la vista previa («Foto»). */
    label: string;
    section: ShopEditSection;
    /** El `data-tour` del bloque del panel al que se baja. */
    tour: string;
}

export const SHOP_EDIT_TARGETS = {
    // Arriba
    header: { label: 'Encabezado', section: 'style', tour: 'shop-style-header' },
    logo: { label: 'Logo', section: 'style', tour: 'shop-style-header' },
    hero: { label: 'Portada', section: 'style', tour: 'shop-style-hero' },
    browse: { label: 'Buscador y orden', section: 'design', tour: 'shop-design-browse' },
    categories: { label: 'Categorías', section: 'design', tour: 'shop-design-browse' },
    // La vitrina
    grid: { label: 'Productos por fila', section: 'design', tour: 'shop-design-grid' },
    card: { label: 'Tarjeta', section: 'style', tour: 'shop-style-cards' },
    image: { label: 'Foto', section: 'style', tour: 'shop-style-images' },
    name: { label: 'Nombre', section: 'catalog', tour: 'shop-role-name' },
    price: { label: 'Precio', section: 'catalog', tour: 'shop-role-price' },
    summary: { label: 'Descripción corta', section: 'catalog', tour: 'shop-role-summary' },
    stock: { label: 'Cuántas quedan', section: 'design', tour: 'shop-design-stock' },
    button: { label: 'Botón', section: 'design', tour: 'shop-design-after-add' },
    footer: { label: 'Quién vende', section: 'seller', tour: 'shop-seller' },
    policies: { label: 'Políticas', section: 'seller', tour: 'shop-policies' },
    // La ficha del producto
    product: { label: 'Ficha del producto', section: 'style', tour: 'shop-style-product' },
    gallery: { label: 'Fotos de la ficha', section: 'style', tour: 'shop-style-images-product' },
    description: { label: 'Descripción', section: 'catalog', tour: 'shop-role-description' },
    variants: { label: 'Variantes', section: 'catalog', tour: 'shop-variants' },
    /** v0.1.429 — La unidad, el mínimo y «de a cuánto» de cada producto. */
    units: { label: 'Unidades y cantidades', section: 'catalog', tour: 'shop-units' },
    buy: { label: 'Botones de compra', section: 'design', tour: 'shop-design-after-add' },
    delivery: { label: 'Cómo se entrega', section: 'payment', tour: 'shop-delivery' },
    // El carrito y el pago
    cart: { label: 'Carrito', section: 'design', tour: 'shop-design-after-add' },
    checkout: { label: 'Página de pago', section: 'style', tour: 'shop-style-checkout' },
    'cx-you': { label: 'Tus datos', section: 'checkout', tour: 'shop-checkout-fields' },
    'cx-delivery': { label: 'Entrega', section: 'payment', tour: 'shop-delivery' },
    'cx-pay': { label: 'Pago', section: 'payment', tour: 'shop-payments' },
    'cx-coupon': { label: 'Cupón', section: 'coupons', tour: 'shop-coupons' },
    'cx-summary': { label: 'Resumen del pedido', section: 'style', tour: 'shop-style-checkout' },
    'cx-terms': { label: 'Términos', section: 'seller', tour: 'shop-policies' },
} as const satisfies Record<string, ShopEditTarget>;

export type ShopEditTargetId = keyof typeof SHOP_EDIT_TARGETS;

const SECTION_NAMES: Record<ShopEditSection, string> = {
    catalog: 'Productos',
    style: 'Estilo',
    design: 'Apariencia',
    payment: 'Pago y entrega',
    coupons: 'Cupones',
    checkout: 'Datos y avisos',
    seller: 'Quién vende',
    orders: 'Pedidos',
    measure: 'Medir conversiones',
    domain: 'Dominio y Google',
    publish: 'Publicar',
};

export function isShopEditTarget(raw: unknown): raw is ShopEditTargetId {
    return typeof raw === 'string' && Object.prototype.hasOwnProperty.call(SHOP_EDIT_TARGETS, raw);
}

/** La etiqueta de la vista previa: «Foto · Estilo». */
export function shopEditTargetText(id: ShopEditTargetId): string {
    const t: ShopEditTarget = SHOP_EDIT_TARGETS[id];
    return `${t.label} · ${SECTION_NAMES[t.section]}`;
}
