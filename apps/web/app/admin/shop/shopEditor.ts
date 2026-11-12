import { SHOP_PAYMENT_METHOD_LABELS, type ShopConfig, type ShopProblem, type ShopSection } from '@imagina-base/shared';

/**
 * v0.1.412 (ADR-S103) — Lo PURO del editor de la tienda: las secciones, cómo
 * está cada una en palabras y la sección donde se arregla cada problema.
 */

export const SHOP_EDITOR_SECTIONS: readonly ShopSection[] = ['catalog', 'design', 'payment', 'coupons', 'checkout', 'seller', 'orders', 'measure', 'publish'];

export const SHOP_SECTION_INFO: Record<ShopSection, { label: string; group: string; title: string; hint: string }> = {
    catalog: {
        label: 'Productos',
        group: 'La tienda',
        title: 'Productos',
        hint: 'Qué campo de la lista es el nombre, el precio, la foto y el stock de cada producto.',
    },
    design: {
        label: 'Apariencia',
        group: 'La tienda',
        title: 'Apariencia',
        hint: 'El título, el color, cómo se ven las tarjetas y en qué orden salen los productos.',
    },
    payment: {
        label: 'Pago y entrega',
        group: 'Al comprar',
        title: 'Pago y entrega',
        hint: 'Cómo te pagan (en línea, WhatsApp, transferencia o contra entrega) y cómo reciben el pedido.',
    },
    coupons: {
        label: 'Cupones',
        group: 'Al comprar',
        title: 'Cupones de descuento',
        hint: 'Códigos que tus clientes escriben al comprar: un porcentaje, un monto fijo o el envío gratis.',
    },
    checkout: {
        label: 'Datos y avisos',
        group: 'Al comprar',
        title: 'Datos y avisos',
        hint: 'Qué le pides a quien compra, la compra mínima y a quién le avisa cada pedido.',
    },
    seller: {
        label: 'Quién vende',
        group: 'Al comprar',
        title: 'Quién vende y políticas',
        hint: 'Los datos que la ley pide mostrar antes de comprar: quién vende, cambios, devoluciones y términos.',
    },
    orders: {
        label: 'Pedidos',
        group: 'Publicar',
        title: 'Dónde caen los pedidos',
        hint: 'Cada compra llega como un registro de Pedidos, con sus productos y el cliente.',
    },
    measure: {
        label: 'Medir conversiones',
        group: 'Publicar',
        title: 'Medir conversiones',
        hint: 'Que Google Ads, Meta y Tag Manager vean cada compra, y de dónde llegó cada pedido.',
    },
    publish: {
        label: 'Publicar',
        group: 'Publicar',
        title: 'Publicar y compartir',
        hint: 'El enlace de la tienda, el código para tu sitio y lo que falta para publicarla.',
    },
};

/** Cómo está cada sección, en una línea (menú del editor). */
export function shopSectionSummary(
    s: ShopSection,
    config: ShopConfig,
    ctx: { enabled: boolean; productsCount: number; ordersListName: string | null; couponsActive?: number | null },
): string {
    switch (s) {
        case 'catalog': {
            const n = ctx.productsCount === 1 ? '1 producto' : `${ctx.productsCount} productos`;
            const extra = [
                config.variants.enabled ? 'con variantes' : '',
                config.kinds.download_field !== null ? 'con descargas' : '',
                config.kinds.booking_page_id !== null ? 'con servicios' : '',
                Object.keys(config.kinds.subscription_links).length > 0 ? 'con suscripciones' : '',
            ].filter(Boolean);
            return [n, ...extra].join(' · ');
        }
        case 'design':
            return `${config.display.columns} por fila · ${config.color ? 'color propio' : 'color de tu marca'}`;
        case 'payment': {
            const p = config.payments;
            const on = [
                ...(p.online.enabled ? ['En línea'] : []),
                ...(['whatsapp', 'transfer', 'cod'] as const).filter((m) => p[m].enabled).map((m) => SHOP_PAYMENT_METHOD_LABELS[m]),
            ];
            const deliveries = config.delivery.filter((d) => d.active).length;
            const zones = config.delivery.filter((d) => d.active).reduce((n, d) => n + d.zones.filter((z) => z.active).length, 0);
            return `${on.length > 0 ? on.join(', ') : 'Sin forma de pago'} · ${deliveries === 1 ? '1 entrega' : `${deliveries} entregas`}${zones > 0 ? ` · ${zones === 1 ? '1 zona' : `${zones} zonas`}` : ''}`;
        }
        case 'coupons': {
            const n = ctx.couponsActive ?? 0;
            return n === 0 ? 'Sin cupones' : n === 1 ? '1 cupón activo' : `${n} cupones activos`;
        }
        case 'checkout':
            return config.checkout.min_order ? 'Con compra mínima' : 'Sin compra mínima';
        case 'seller':
            return config.seller.legal_name || 'Falta quién vende';
        case 'orders':
            return ctx.ordersListName ?? 'Sin lista de pedidos';
        case 'measure': {
            const c = config.conversion;
            const on = [c.google_ads ? 'Google Ads' : '', c.meta_event ? 'Meta' : '', c.direct_tags ? 'enlace directo' : ''].filter(Boolean);
            return on.length > 0 ? on.join(', ') : 'Tag Manager';
        }
        case 'publish':
            return ctx.enabled ? 'Publicada' : 'Sin publicar';
    }
}

export function sectionsWithProblems(problems: readonly ShopProblem[]): Set<ShopSection> {
    return new Set(problems.map((p) => p.section));
}

/** `?t=` → sección (lo desconocido cae en Productos). */
export function shopEditorSection(raw: string | null): ShopSection {
    return SHOP_EDITOR_SECTIONS.includes(raw as ShopSection) ? (raw as ShopSection) : 'catalog';
}

/** v0.1.418 — Los dos modos del editor: editar la tienda o ver cómo vende. */
export type ShopEditorMode = 'edit' | 'stats';

/** `?t=stats` abre las estadísticas; cualquier otra cosa, una sección. */
export function shopEditorLocation(raw: string | null): { mode: ShopEditorMode; section: ShopSection } {
    if (raw === 'stats') return { mode: 'stats', section: 'catalog' };
    return { mode: 'edit', section: shopEditorSection(raw) };
}

/** Dos configuraciones iguales (para «sin cambios»): las claves de un objeto en orden. */
export function sameShopConfig(a: ShopConfig, b: ShopConfig): boolean {
    return stable(a) === stable(b);
}

function stable(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
    if (v && typeof v === 'object') {
        return `{${Object.keys(v as Record<string, unknown>)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
            .join(',')}}`;
    }
    return JSON.stringify(v ?? null);
}

/** Un número de teléfono tal como lo escribe la gente → E.164 (`+57 300 111 2233` → `+573001112233`). */
export function cleanPhone(raw: string): string {
    const t = raw.trim();
    const digits = t.replace(/[^\d]/g, '');
    if (!digits) return '';
    return `+${digits}`.slice(0, 20);
}
