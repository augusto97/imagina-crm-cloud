import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { z } from 'zod';
import { readShopConfig, type ShopDto } from '@imagina-base/shared';

import { AiToolRegistry, toolAllowed, type AiToolContext, type AiToolResult } from '../ai/tools/registry';
import { ShopService } from './shop.service';
import { ShopStatsService } from './shop-stats.service';

const statsInput = z.object({
    shop_id: z.number().int().positive().describe('El id de la tienda (de `shops` en get_list_schema)'),
    days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30).describe('Cuántos días hacia atrás (7, 30 o 90; por defecto 30)'),
});

/**
 * v0.1.419 (ADR-S103) — La tienda en el asistente ✨ y el MCP: `get_list_schema`
 * cuenta qué tiendas venden los productos de una lista (o reciben sus pedidos)
 * y `get_shop_stats` lee las estadísticas (visitas, ventas, embudo, productos
 * y de dónde llegan los que compran). Sólo para quien administra listas, como
 * en la app. Nada aquí escribe: la tienda se configura en su editor.
 */
@Injectable()
export class ShopAiTools implements OnModuleInit {
    constructor(
        private readonly shops: ShopService,
        private readonly stats: ShopStatsService,
        @Optional() private readonly registry?: AiToolRegistry,
    ) {}

    onModuleInit(): void {
        if (this.registry) this.registerInto(this.registry);
    }

    registerInto(registry: AiToolRegistry): void {
        if (registry.get('get_shop_stats')) return;
        registry.register({
            name: 'get_shop_stats',
            label: 'Leyendo las estadísticas de la tienda',
            description:
                'Lee las estadísticas de una tienda (la de `shops` en get_list_schema): visitas, pedidos, pedidos pagados, ventas, ticket promedio y conversión de los últimos 7, 30 o 90 días (en la zona de la empresa), ' +
                'el embudo de la visita al pago, los productos que más venden (con cuántas veces los abren y agregan al carrito), de dónde llegan los que compran (campaña, sitio o directo) y el dispositivo. ' +
                'Las visitas son conteos: nunca datos de una persona. Úsala para responder «¿cuánto vendí?», «¿qué producto se vende más?», «¿de dónde vienen las compras?».',
            capability: 'manage_lists',
            input: statsInput,
            run: (ctx, input) => this.getStats(ctx, input as z.infer<typeof statsInput>),
        });
        registry.addListSchemaExtra((ctx, list) => this.schemaExtra(ctx, list));
    }

    private async getStats(ctx: AiToolContext, input: z.infer<typeof statsInput>): Promise<AiToolResult> {
        let shop: ShopDto;
        try {
            shop = await this.shops.get(ctx.tenantId, input.shop_id);
        } catch {
            return { content: { error: `No existe la tienda ${input.shop_id}. Mira \`shops\` en get_list_schema de la lista de productos.` }, isError: true };
        }
        const t = await this.shops.statsTarget(ctx.tenantId, shop.id);
        const s = await this.stats.summary({ tenantId: ctx.tenantId, shopId: shop.id, timeZone: await this.stats.timeZone(ctx.tenantId), currency: t.currency, titleKey: t.titleKey }, input.days);
        return {
            content: {
                shop: { id: shop.id, name: shop.name, published: shop.enabled },
                range: s.range,
                currency: s.currency,
                totals: s.totals,
                funnel: s.funnel,
                top_products: s.products,
                sources: s.sources,
                devices: s.devices,
                // Lo día por día, sólo con movimiento (no 90 filas en cero).
                days: s.days.filter((d) => d.visits > 0 || d.orders > 0),
            },
        };
    }

    private async schemaExtra(ctx: AiToolContext, list: { id: number }): Promise<Record<string, unknown>> {
        if (!toolAllowed({ role: ctx.role, capabilities: ctx.capabilities }, 'manage_lists')) return {};
        const all = await this.shops.listForTenant(ctx.tenantId);
        const mine = all.filter((s) => s.list_id === list.id || s.orders?.list_id === list.id || s.orders?.lines_list_id === list.id || s.orders?.customers_list_id === list.id);
        if (mine.length === 0) return {};
        return {
            shops: {
                _nota:
                    'Tiendas en línea que usan esta lista: «catalog» = sus registros son los productos; «orders» / «order_lines» / «customers» = ahí llegan los pedidos, sus líneas y los clientes. ' +
                    'Las estadísticas se leen con get_shop_stats. La tienda (pagos, entregas, cupones, diseño) se configura en su editor: Ajustes de la lista de productos → Tienda.',
                items: mine.map((s) => {
                    const c = readShopConfig(s.config);
                    const role =
                        s.list_id === list.id ? 'catalog' : s.orders?.list_id === list.id ? 'orders' : s.orders?.lines_list_id === list.id ? 'order_lines' : 'customers';
                    return {
                        id: s.id,
                        name: s.name,
                        role,
                        published: s.enabled,
                        suspended: s.suspended,
                        public_path: s.public_path,
                        currency: c.currency,
                        orders: s.orders_count,
                        payments: {
                            online: c.payments.online.enabled,
                            whatsapp: c.payments.whatsapp.enabled,
                            transfer: c.payments.transfer.enabled,
                            cash_on_delivery: c.payments.cod.enabled,
                        },
                        delivery: c.delivery.filter((d) => d.active).map((d) => d.name),
                        product_link: 'Para abrir la tienda en un producto: la dirección pública + ?producto=<id del registro>.',
                    };
                }),
            },
        };
    }
}
