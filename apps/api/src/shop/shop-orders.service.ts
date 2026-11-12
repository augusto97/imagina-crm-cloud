import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import {
    SHOP_ORDER_STATUS_LABELS,
    SHOP_PAYMENT_METHOD_LABELS,
    SHOP_PAYMENT_STATUS_LABELS,
    brandingSchema,
    computeShopCart,
    formatShopMoney,
    jsonbKeyForField,
    readShopConfig,
    readShopListMarker,
    shopOnlinePayment,
    tenantFormatSchema,
    validateFieldValue,
    type Field,
    type PublicShopOrder,
    type PublicShopOrderInput,
    type ShopCartProduct,
    type ShopCartResult,
    type ShopConfig,
    type ShopOrderLineSnapshot,
    type ShopOrderPanelDto,
    type ShopOrderStatus,
    type ShopPaymentMethod,
    type ShopPaymentStatus,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { ActivityService, computeDiff } from '../activity/activity.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { BillingService } from '../billing/billing.service';
import { CollectionsService } from '../collections/collections.service';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { lists, paymentLinks, records, shopOrders, shops, tenants, type ShopOrderRow, type ShopRow } from '../db/schema';
import { DomainsService } from '../domains/domains.service';
import { FieldsService } from '../fields/fields.service';
import { FilesService } from '../files/files.service';
import { IncidentHub } from '../incidents/incident-hub';
import { MailService } from '../mail/mail.service';
import { NotifyHub } from '../notifications/notify-hub';
import { senderName, type PortalEmailBrand } from '../portal/portal-email';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordChangeHub, type RecordChange } from '../records/record-change-hub';
import { RecordsRepository } from '../records/records.repository';
import { RelationsRepository } from '../records/relations.repository';
import { TenantDb } from '../tenancy/tenant-db.service';
import { productFromRow, resolveCatalogFields } from './shop-catalog';
import { shopOrderEmail } from './shop-email';
import type { CustomerRole, LineRole, OrderRole } from './shop-pack';

/**
 * v0.1.412 (ADR-S103) — El motor de los pedidos.
 *
 * Un pedido se arma en UNA transacción: se bloquean los productos (en orden
 * de id, así dos compras a la vez no se trancan), se recalcula el carrito con
 * los precios y el stock de la base —lo que mandó el navegador sólo dice qué
 * y cuánto—, se descuenta el stock, se busca o crea el cliente por su correo
 * y se escriben el pedido, sus líneas y sus vínculos. Si algo cambió (subió
 * el precio, se agotó), el pedido NO se crea y la página muestra qué pasó.
 *
 * Se escribe a bajo nivel (repositorio + actividad + automatizaciones después
 * del commit), como las recurrencias: `RecordsService` abre su propia
 * transacción y bloquear productos en una y escribir en otra se trancaría.
 *
 * Cancelar un pedido (la columna «Estado del pedido» en Cancelado) devuelve
 * el stock; sacarlo de Cancelado lo vuelve a tomar.
 */

export interface ResolvedShopForOrder {
    tenantId: number;
    shop: ShopRow;
    config: ShopConfig;
    token: string;
    company: string;
    tenantSettings: Record<string, unknown>;
    /** v0.1.413 — La cuenta de cobro del pago en línea (null = no se ofrece). */
    onlineConnectionId?: number | null;
}

/** Lo que hace falta de una tienda para los correos y el vencimiento (sin la página). */
type ShopCtx = Omit<ResolvedShopForOrder, 'onlineConnectionId'>;

export interface PlacedOrder {
    order_token: string;
    number: string;
    cart: ShopCartResult;
    payment_method: ShopPaymentMethod;
    /** Con WhatsApp: adónde ir para mandar el pedido. */
    whatsapp_path: string | null;
    /** v0.1.413 — Con el pago en línea: adónde ir a pagar. */
    pay_url: string | null;
}

/** v0.1.413 — El pago en línea no se pudo preparar: el pedido no queda. */
/** «30 minutos», «1 hora», «2 horas». */
function holdText(m: number): string {
    if (m < 60) return `${m} minutos`;
    const h = m / 60;
    return h === 1 ? '1 hora' : Number.isInteger(h) ? `${h} horas` : `${m} minutos`;
}

export class ShopPaymentUnavailableError extends HttpException {
    constructor() {
        super(
            {
                code: 'shop_payment_unavailable',
                message: 'No pudimos preparar el pago en línea. Intenta de nuevo en un momento o elige otra forma de pago.',
                data: { status: 503 },
            },
            HttpStatus.SERVICE_UNAVAILABLE,
        );
    }
}

/** Cuántos pedidos sin pagar vence cada barrido (lo que quede, al minuto siguiente). */
const EXPIRE_BATCH = 200;

export class ShopCartChangedError extends ConflictException {}

function badRequest(code: string, message: string): never {
    throw new BadRequestException({ code, message, data: { status: 400 } });
}

function newOrderToken(): string {
    return randomBytes(24).toString('base64url');
}

/** Un valor que pasa por el validador del campo (el campo puede haber cambiado de tipo). */
function put(data: Record<string, unknown>, field: Field | undefined, value: unknown): void {
    if (!field || value === undefined || value === null || value === '') return;
    const res = validateFieldValue({ type: field.type, config: field.config, is_required: false }, value);
    if (res.ok && res.value !== null && res.value !== undefined) data[jsonbKeyForField(field.id)] = res.value;
}

interface Touched {
    listId: number;
    recordId: number;
    kind: 'created' | 'updated';
    before?: Record<string, unknown>;
    after: Record<string, unknown>;
}

@Injectable()
export class ShopOrdersService implements OnModuleInit {
    private readonly logger = new Logger(ShopOrdersService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly fields: FieldsService,
        private readonly recordsRepo: RecordsRepository,
        private readonly relations: RelationsRepository,
        private readonly activity: ActivityService,
        private readonly realtime: RealtimeService,
        private readonly automations: AutomationDispatcher,
        private readonly files: FilesService,
        @Inject(ENV) private readonly env: Env,
        @Optional() private readonly billing?: BillingService,
        @Optional() private readonly mail?: MailService,
        @Optional() private readonly notify?: NotifyHub,
        @Optional() private readonly changes?: RecordChangeHub,
        @Optional() private readonly domains?: DomainsService,
        // v0.1.413 — el pago en línea (links de cobro) y sus fallas a Problemas.
        @Optional() private readonly collections?: CollectionsService,
        @Optional() private readonly incidents?: IncidentHub,
        @Optional() @Inject(DRIZZLE) private readonly db?: Db,
    ) {}

    onModuleInit(): void {
        this.changes?.subscribe((c) => this.onRecordChange(c));
        // v0.1.413 — llegó el pago de un link: si es de un pedido, se da por pagado.
        this.collections?.onLinkPaid((e) => this.onLinkPaid(e.tenantId, e.linkId));
    }

    private async base(tenantId: number): Promise<string> {
        if (this.domains) {
            try {
                return await this.domains.baseUrlFor(tenantId, 'app');
            } catch {
                /* al de la plataforma */
            }
        }
        return this.env.APP_BASE_URL.replace(/\/+$/, '');
    }

    // ─────────────────────────── Hacer el pedido ───────────────────────────

    async place(s: ResolvedShopForOrder, input: PublicShopOrderInput): Promise<PlacedOrder> {
        const { tenantId, config, shop } = s;
        const o = config.orders;
        if (o.list_id === null || o.lines_list_id === null) badRequest('shop_closed', 'Esta tienda no está recibiendo pedidos ahora.');
        const delivery = config.delivery.find((d) => d.active && d.id === input.delivery_id);
        if (!delivery) badRequest('shop_delivery', 'Elige cómo quieres recibir tu pedido.');
        const method = input.payment_method;
        const enabled = {
            whatsapp: config.payments.whatsapp.enabled,
            transfer: config.payments.transfer.enabled,
            cod: config.payments.cod.enabled,
            online: config.payments.online.enabled && (s.onlineConnectionId ?? null) !== null && !!this.collections,
        } as const;
        if (!enabled[method]) badRequest('shop_payment', 'Elige una forma de pago.');
        const c = input.customer;
        if (delivery!.needs_address && (!c.address.trim() || !c.city.trim())) badRequest('shop_address', 'Escribe la dirección y la ciudad de entrega.');
        if (config.checkout.ask_document === 'required' && !c.document.trim()) badRequest('shop_document', 'Escribe tu número de documento.');
        if (config.checkout.require_terms && input.terms !== true) badRequest('shop_terms', 'Para comprar, acepta los términos y condiciones.');

        const cap = this.billing ? await this.billing.recordLimit(tenantId) : null;
        const currency = config.currency;
        const fmt = tenantFormatSchema.safeParse(s.tenantSettings.format ?? {});
        const numberFormat = fmt.success ? fmt.data.number_format : 'dot_comma';
        const money = (n: number): string => formatShopMoney(n, currency, numberFormat);
        const base = await this.base(tenantId);
        const orderToken = newOrderToken();
        const orderUrl = `${base}/api/v1/public/s/${s.token}?pedido=${orderToken}`;
        // v0.1.413 — Pago en línea: el stock queda apartado mientras la persona paga.
        const holdUntil = method === 'online' ? new Date(Date.now() + config.payments.online.hold_minutes * 60_000) : null;

        const touched: Touched[] = [];
        const result = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const catalogFields = await this.fields.listByListIdWithinTx(tx, tenantId, shop.listId);
            const [catalogList] = await tx.select({ settings: lists.settings, name: lists.name }).from(lists).where(and(eq(lists.tenantId, tenantId), eq(lists.id, shop.listId))).limit(1);
            const rf = resolveCatalogFields(catalogFields, config.catalog, catalogList?.settings ?? {});
            if (!rf.price) badRequest('shop_closed', 'Esta tienda no está recibiendo pedidos ahora.');

            // 1) Los productos, bloqueados y leídos de la base.
            const ids = [...new Set(input.lines.map((l) => l.product_id))].sort((a, b) => a - b);
            const rows = await tx
                .select({ id: records.id, data: records.data, createdAt: records.createdAt })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, shop.listId), inArray(records.id, ids), isNull(records.deletedAt), isNull(records.parentId)))
                .orderBy(asc(records.id))
                .for('no key update');
            const byId = new Map<number, { data: Record<string, unknown>; product: ShopCartProduct; sku: string }>();
            for (const r of rows) {
                const p = productFromRow({ id: r.id, data: r.data as Record<string, unknown>, createdAt: r.createdAt }, rf);
                if (!p.active) continue;
                byId.set(r.id, { data: r.data as Record<string, unknown>, product: { id: r.id, title: p.product.title, price: p.product.price, stock: p.product.stock }, sku: p.product.sku });
            }
            const cart = computeShopCart(input.lines, new Map([...byId].map(([k, v]) => [k, v.product])), {
                shipping: delivery!.price,
                minOrder: config.checkout.min_order,
            });
            if (cart.blocked) {
                throw new ShopCartChangedError({
                    code: 'shop_cart_changed',
                    message: 'Algo de tu carrito cambió (se agotó o ya no está). Revísalo y vuelve a intentar.',
                    data: { status: 409, cart },
                });
            }
            if (cart.below_minimum !== null) {
                badRequest('shop_minimum', `La compra mínima es de ${money(config.checkout.min_order ?? 0)}: te faltan ${money(cart.below_minimum)}.`);
            }

            // 2) El tope de registros del plan: el pedido, sus líneas y quizá el cliente.
            if (cap && this.billing) await this.billing.assertRecordRoomInTx(tx, tenantId, cap, cart.lines.length + 2);

            // 3) El stock.
            const lines: ShopOrderLineSnapshot[] = [];
            let tookStock = false;
            for (const l of cart.lines) {
                const p = byId.get(l.product_id)!;
                let taken = false;
                if (rf.stock && p.product.stock !== null) {
                    const key = jsonbKeyForField(rf.stock.id);
                    const next = { ...p.data, [key]: Math.max(0, p.product.stock - l.qty) };
                    const updated = await this.recordsRepo.updateData(tx, tenantId, shop.listId, l.product_id, next, 0);
                    if (updated) {
                        await this.activity.logInTx(tx, { tenantId, listId: shop.listId, recordId: l.product_id, userId: null, action: 'record_updated', diff: computeDiff(p.data, next) });
                        touched.push({ listId: shop.listId, recordId: l.product_id, kind: 'updated', before: p.data, after: updated.data as Record<string, unknown> });
                        taken = true;
                        tookStock = true;
                    }
                }
                lines.push({ product_id: l.product_id, title: l.title, sku: p.sku, qty: l.qty, unit_price: l.unit_price, subtotal: l.subtotal, stock_taken: taken });
            }

            // 4) El cliente: por su correo en «Clientes de la tienda».
            const customerId = await this.upsertCustomer(tx, tenantId, o, c, touched);

            // 5) El pedido.
            const orderFields = await this.fieldsOf(tx, tenantId, o.list_id!);
            const of = (r: OrderRole): Field | undefined => orderFields.get(o.fields[r] ?? -1);
            const where = [c.address, c.city].filter((x) => x.trim()).join(', ');
            const items = lines.map((l) => `${l.qty} × ${l.title} — ${money(l.subtotal)}`).join('\n');
            const data: Record<string, unknown> = {};
            put(data, of('status'), 'nuevo');
            put(data, of('payment_status'), 'pendiente');
            put(data, of('payment_method'), method);
            put(data, of('total'), cart.total);
            put(data, of('subtotal'), cart.subtotal);
            put(data, of('shipping'), cart.shipping);
            put(data, of('delivery'), delivery!.name);
            put(data, of('email'), c.email);
            put(data, of('phone'), c.phone);
            put(data, of('document'), c.document);
            put(data, of('address'), where);
            put(data, of('notes'), c.notes);
            put(data, of('items'), items);
            put(data, of('shop'), shop.name);
            put(data, of('order_url'), orderUrl);
            put(data, of('title'), `Pedido · ${c.name}`);
            const inserted = await this.recordsRepo.insert(tx, { tenantId, listId: o.list_id!, data, createdBy: 0 });
            const numberField = of('number');
            const number = (numberField ? String((inserted.data as Record<string, unknown>)[jsonbKeyForField(numberField.id)] ?? '') : '') || `#${inserted.id}`;
            let orderData = inserted.data as Record<string, unknown>;
            const titleField = of('title');
            if (titleField) {
                orderData = { ...orderData, [jsonbKeyForField(titleField.id)]: `${number} · ${c.name}`.slice(0, 250) };
                await this.recordsRepo.updateData(tx, tenantId, o.list_id!, inserted.id, orderData, 0);
            }
            await this.activity.logInTx(tx, { tenantId, listId: o.list_id!, recordId: inserted.id, userId: null, action: 'record_created', diff: computeDiff({}, orderData) });
            const customerRel = of('customer');
            if (customerRel?.type === 'relation' && customerId !== null) await this.relations.sync(tx, tenantId, customerRel.id, inserted.id, [customerId]);
            touched.push({ listId: o.list_id!, recordId: inserted.id, kind: 'created', after: orderData });

            // 6) Las líneas.
            const lineFields = await this.fieldsOf(tx, tenantId, o.lines_list_id!);
            const lf = (r: LineRole): Field | undefined => lineFields.get(o.line_fields[r] ?? -1);
            for (const l of lines) {
                const ld: Record<string, unknown> = {};
                put(ld, lf('title'), l.title);
                put(ld, lf('qty'), l.qty);
                put(ld, lf('unit_price'), l.unit_price);
                put(ld, lf('subtotal'), l.subtotal);
                put(ld, lf('sku'), l.sku);
                const line = await this.recordsRepo.insert(tx, { tenantId, listId: o.lines_list_id!, data: ld, createdBy: 0 });
                await this.activity.logInTx(tx, { tenantId, listId: o.lines_list_id!, recordId: line.id, userId: null, action: 'record_created', diff: computeDiff({}, line.data) });
                const orderRel = lf('order');
                if (orderRel?.type === 'relation') await this.relations.sync(tx, tenantId, orderRel.id, line.id, [inserted.id]);
                const prodRel = lf('product');
                if (prodRel?.type === 'relation' && Number((prodRel.config as { target_list_id?: unknown }).target_list_id) === shop.listId) {
                    await this.relations.sync(tx, tenantId, prodRel.id, line.id, [l.product_id]);
                }
                touched.push({ listId: o.lines_list_id!, recordId: line.id, kind: 'created', after: line.data as Record<string, unknown> });
            }

            // 7) Lo que sabe la tienda del pedido.
            const statusField = of('status');
            await tx.insert(shopOrders).values({
                tenantId,
                shopId: shop.id,
                recordId: inserted.id,
                token: orderToken,
                number,
                paymentMethod: method,
                paymentStatus: 'pendiente',
                currency,
                subtotal: cart.subtotal,
                shipping: cart.shipping,
                discount: 0,
                total: cart.total,
                lines,
                customer: { name: c.name, email: c.email, phone: c.phone, document: c.document, address: c.address, city: c.city, notes: c.notes },
                delivery: { id: delivery!.id, name: delivery!.name, needs_address: delivery!.needs_address },
                origin: { page: input.origin?.page?.slice(0, 500) ?? null, referrer: input.origin?.referrer?.slice(0, 500) ?? null },
                catalogListId: shop.listId,
                stockFieldId: tookStock && rf.stock ? rf.stock.id : null,
                statusFieldId: statusField?.id ?? null,
                stockState: tookStock ? 'taken' : 'none',
                expiresAt: holdUntil,
            });
            return { cart, number, recordId: inserted.id, orderListId: o.list_id!, lines };
        });

        // v0.1.413 — Pago en línea: el link se arma DESPUÉS del commit (es una
        // llamada al proveedor y no puede tener los productos bloqueados). Si no
        // se puede, el pedido se cancela en el acto (vuelve el stock) y la
        // persona elige otra forma de pago.
        let payUrl: string | null = null;
        if (method === 'online') {
            try {
                const link = await this.collections!.createForShop(tenantId, {
                    shopId: shop.id,
                    connectionId: s.onlineConnectionId!,
                    listId: result.orderListId,
                    recordId: result.recordId,
                    title: `Pedido ${result.number} · ${s.company}`.slice(0, 200),
                    amount: result.cart.total,
                    currency,
                    payerEmail: c.email,
                    expiresAt: holdUntil!,
                    returnUrlFor: () => `${orderUrl}&pago=1`,
                });
                payUrl = link.url;
                await this.tenantDb.withTenant(tenantId, (tx) =>
                    tx
                        .update(shopOrders)
                        .set({ paymentLinkId: link.id, updatedAt: new Date() })
                        .where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.token, orderToken))),
                );
                this.incidents?.resolve(tenantId, `shop-pay:${shop.id}`);
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                this.logger.warn(`Tienda ${shop.id}: no se pudo preparar el pago en línea del pedido ${result.number}: ${reason}`);
                this.incidents?.report({
                    tenantId,
                    key: `shop-pay:${shop.id}`,
                    source: 'shop',
                    sourceId: shop.id,
                    listId: shop.listId,
                    ownerId: shop.createdBy,
                    title: `La tienda «${shop.name}» no puede cobrar en línea`,
                    message: `Alguien intentó pagar en línea y no se pudo preparar el pago: ${reason} Revisa la cuenta de cobro en la tienda → Pago.`,
                });
                for (const listId of new Set(touched.map((t) => t.listId))) this.realtime.records(tenantId, listId);
                const row = await this.findByToken(tenantId, orderToken);
                if (row) await this.expireOrder(tenantId, row.id, 'No se pudo preparar el pago en línea.').catch(() => undefined);
                throw new ShopPaymentUnavailableError();
            }
        }

        // Después del commit: pantallas, automatizaciones y avisos.
        for (const listId of new Set(touched.map((t) => t.listId))) this.realtime.records(tenantId, listId);
        for (const t of touched) {
            this.automations.dispatch({
                tenantId,
                listId: t.listId,
                recordId: t.recordId,
                trigger: t.kind === 'created' ? 'record_created' : 'record_updated',
                after: t.after,
                ...(t.before ? { before: t.before } : {}),
            });
        }
        // El pago en línea avisa al equipo cuando entra el pago: un carrito
        // abandonado en el checkout no es una venta. A quien compra sí le
        // llega el enlace de su pedido, por si cierra el checkout sin pagar.
        if (method === 'online') {
            if (config.checkout.send_confirmation) {
                void this.sendConfirmation(s, {
                    kind: 'awaiting',
                    number: result.number,
                    customer: c,
                    lines: result.lines,
                    totals: { subtotal: result.cart.subtotal, shipping: result.cart.shipping, total: result.cart.total },
                    delivery: delivery!.name,
                    method,
                    orderUrl,
                    money,
                    holdMinutes: config.payments.online.hold_minutes,
                }).catch((err: unknown) => this.logger.warn(`Tienda ${shop.id}: no salió el correo del pedido ${result.number}: ${String(err)}`));
            }
            return { order_token: orderToken, number: result.number, cart: result.cart, payment_method: method, whatsapp_path: null, pay_url: payUrl };
        }
        const notifyIds = this.notifyIds(config, shop);
        this.notify?.emit({
            type: 'shop',
            tenantId,
            listId: result.orderListId,
            recordId: result.recordId,
            userIds: notifyIds,
            title: `Pedido nuevo ${result.number} · ${money(result.cart.total)}`.slice(0, 200),
            body: `${c.name} · ${SHOP_PAYMENT_METHOD_LABELS[method]} · ${result.lines.length === 1 ? '1 producto' : `${result.lines.length} productos`}`,
        });
        if (config.checkout.send_confirmation) {
            void this.sendConfirmation(s, {
                kind: 'placed',
                number: result.number,
                customer: c,
                lines: result.lines,
                totals: { subtotal: result.cart.subtotal, shipping: result.cart.shipping, total: result.cart.total },
                delivery: delivery!.name,
                method,
                orderUrl,
                money,
            }).catch((err: unknown) => this.logger.warn(`Tienda ${shop.id}: no salió el correo del pedido ${result.number}: ${String(err)}`));
        }
        return {
            order_token: orderToken,
            number: result.number,
            cart: result.cart,
            payment_method: method,
            whatsapp_path: method === 'whatsapp' ? `/api/v1/public/s/${s.token}/wa/${orderToken}` : null,
            pay_url: null,
        };
    }

    /** A quién del equipo le llega el aviso de un pedido (vacío = quien creó la tienda). */
    private notifyIds(config: ShopConfig, shop: ShopRow): number[] {
        return config.checkout.notify_user_ids.length > 0 ? config.checkout.notify_user_ids : shop.createdBy ? [shop.createdBy] : [];
    }

    private async fieldsOf(tx: Tx, tenantId: number, listId: number): Promise<Map<number, Field>> {
        const list = await this.fields.listByListIdWithinTx(tx, tenantId, listId);
        return new Map(list.map((f) => [f.id, f]));
    }

    private async upsertCustomer(
        tx: Tx,
        tenantId: number,
        o: ShopConfig['orders'],
        c: PublicShopOrderInput['customer'],
        touched: Touched[],
    ): Promise<number | null> {
        if (o.customers_list_id === null) return null;
        const fields = await this.fieldsOf(tx, tenantId, o.customers_list_id);
        const cf = (r: CustomerRole): Field | undefined => fields.get(o.customer_fields[r] ?? -1);
        const emailField = cf('email');
        const listId = o.customers_list_id;
        let existing: { id: number; data: Record<string, unknown> } | null = null;
        if (emailField) {
            const key = jsonbKeyForField(emailField.id);
            const [hit] = await tx
                .select({ id: records.id, data: records.data })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), isNull(records.deletedAt), sql`lower(${records.data}->>${key}) = ${c.email.toLowerCase()}`))
                .orderBy(asc(records.id))
                .limit(1)
                .for('no key update');
            if (hit) existing = { id: hit.id, data: hit.data as Record<string, unknown> };
        }
        const values: Array<[CustomerRole, string]> = [
            ['name', c.name],
            ['email', c.email],
            ['phone', c.phone],
            ['document', c.document],
            ['address', c.address],
            ['city', c.city],
        ];
        if (existing) {
            // Sólo se completa lo que falta o lo que la persona escribió ahora (no se borra nada).
            const next = { ...existing.data };
            for (const [role, v] of values) put(next, cf(role), v);
            if (JSON.stringify(next) !== JSON.stringify(existing.data)) {
                const updated = await this.recordsRepo.updateData(tx, tenantId, listId, existing.id, next, 0);
                if (updated) {
                    await this.activity.logInTx(tx, { tenantId, listId, recordId: existing.id, userId: null, action: 'record_updated', diff: computeDiff(existing.data, next) });
                    touched.push({ listId, recordId: existing.id, kind: 'updated', before: existing.data, after: updated.data as Record<string, unknown> });
                }
            }
            return existing.id;
        }
        const data: Record<string, unknown> = {};
        for (const [role, v] of values) put(data, cf(role), v);
        const row = await this.recordsRepo.insert(tx, { tenantId, listId, data, createdBy: 0 });
        await this.activity.logInTx(tx, { tenantId, listId, recordId: row.id, userId: null, action: 'record_created', diff: computeDiff({}, row.data) });
        touched.push({ listId, recordId: row.id, kind: 'created', after: row.data as Record<string, unknown> });
        return row.id;
    }

    private async sendConfirmation(
        s: ShopCtx,
        o: {
            /** v0.1.413 — `awaiting`: pedido en línea sin pagar todavía; `paid`: entró el pago. */
            kind: 'placed' | 'awaiting' | 'paid';
            number: string;
            customer: Pick<PublicShopOrderInput['customer'], 'name' | 'email'>;
            lines: ShopOrderLineSnapshot[];
            totals: { subtotal: number; shipping: number; total: number };
            delivery: string;
            method: ShopPaymentMethod;
            orderUrl: string;
            money: (n: number) => string;
            provider?: string | null;
            holdMinutes?: number;
        },
    ): Promise<void> {
        if (!this.mail) return;
        const brand = await this.emailBrand(s);
        const seller = s.config.seller;
        const paid = o.kind === 'paid';
        const providerLabel = o.provider ? shopOnlinePayment(o.provider).provider_label : '';
        const email = shopOrderEmail({
            brand,
            shopName: s.shop.name,
            number: o.number,
            customerName: o.customer.name,
            lines: o.lines.map((l) => ({ title: l.title, qty: l.qty, subtotal: o.money(l.subtotal) })),
            subtotal: o.money(o.totals.subtotal),
            shipping: o.totals.shipping > 0 ? o.money(o.totals.shipping) : null,
            total: o.money(o.totals.total),
            delivery: o.delivery,
            paymentLabel: paid ? (providerLabel ? `Pagado en línea · ${providerLabel}` : 'Pagado en línea') : SHOP_PAYMENT_METHOD_LABELS[o.method],
            paymentInstructions: paid
                ? 'Recibimos el pago. Te avisamos cuando preparemos y enviemos tu pedido.'
                : o.kind === 'awaiting'
                  ? `Tienes ${holdText(o.holdMinutes ?? 30)} para pagarlo. Si no se paga a tiempo, el pedido se cancela solo y los productos vuelven a la tienda.`
                  : paymentInstructions(s.config, o.method),
            stage: o.kind,
            orderUrl: o.orderUrl,
            sellerLine: [seller.legal_name, seller.document ? `NIT/C.C. ${seller.document}` : '', seller.email, seller.phone].filter(Boolean).join(' · '),
        });
        await this.mail.enqueue({
            tenantId: s.tenantId,
            to: o.customer.email,
            subject: email.subject,
            html: email.html,
            text: email.text,
            fromName: senderName(brand.name),
            fromNameSoft: true,
            ...(seller.email ? { replyTo: seller.email } : {}),
        });
    }

    async emailBrand(s: { tenantId: number; tenantSettings: Record<string, unknown>; company: string; config: ShopConfig }): Promise<PortalEmailBrand> {
        const b = brandingSchema.safeParse(s.tenantSettings.branding ?? {});
        const base = await this.base(s.tenantId);
        const logoId = b.success ? b.data.logo_file_id : null;
        return {
            name: (b.success ? b.data.app_name : null) || s.company,
            color: s.config.color ?? (b.success ? b.data.primary_color : null) ?? '#0e7490',
            logoUrl: logoId ? `${base}${this.files.signedUrl(s.tenantId, logoId, 30 * 24 * 3600)}` : null,
        };
    }

    // ─────────────────────────── Ver el pedido ───────────────────────────

    async publicOrder(tenantId: number, shopId: number, shopToken: string, orderToken: string, config: ShopConfig): Promise<PublicShopOrder | null> {
        const row = await this.findByToken(tenantId, orderToken);
        if (!row || row.shopId !== shopId) return null;
        const status = await this.orderStatus(tenantId, row);
        const method = row.paymentMethod as ShopPaymentMethod;
        const pay = row.paymentStatus as ShopPaymentStatus;
        const customer = row.customer as Record<string, string>;
        const delivery = row.delivery as { name?: string };
        return {
            number: row.number,
            created_at: row.createdAt.toISOString(),
            status,
            status_label: SHOP_ORDER_STATUS_LABELS[status],
            payment_status: pay,
            payment_status_label: SHOP_PAYMENT_STATUS_LABELS[pay] ?? pay,
            payment_method: method,
            payment_label: SHOP_PAYMENT_METHOD_LABELS[method] ?? method,
            payment_instructions: pay === 'pendiente' ? paymentInstructions(config, method) : '',
            lines: (row.lines as ShopOrderLineSnapshot[]).map((l) => ({ title: l.title, qty: l.qty, unit_price: l.unit_price, subtotal: l.subtotal })),
            subtotal: row.subtotal,
            shipping: row.shipping,
            total: row.total,
            currency: row.currency,
            delivery: delivery.name ?? '',
            customer: { name: customer.name ?? '', email: customer.email ?? '', address: customer.address ?? '', city: customer.city ?? '' },
            // El número nunca viaja: el botón pasa por la redirección del servidor.
            whatsapp_url: method === 'whatsapp' && pay === 'pendiente' && status !== 'cancelado' ? `/api/v1/public/s/${shopToken}/wa/${row.token}` : null,
            ...(await this.onlinePart(tenantId, row, status)),
        };
    }

    /**
     * v0.1.413 — El pago en línea como lo ve quien compró: el link mientras se
     * puede pagar, hasta cuándo, con qué, y qué pasó si no se pagó a tiempo o
     * el pago llegó cuando el pedido ya estaba cancelado.
     */
    private async onlinePart(
        tenantId: number,
        row: ShopOrderRow,
        status: ShopOrderStatus,
    ): Promise<Pick<PublicShopOrder, 'pay_url' | 'pay_until' | 'pay_provider' | 'payment_note'>> {
        const none = { pay_url: null, pay_until: null, pay_provider: null, payment_note: null };
        if (row.paymentMethod !== 'online') return none;
        const link = row.paymentLinkId ? await this.linkRow(tenantId, row.paymentLinkId) : null;
        const provider = link ? shopOnlinePayment(link.provider).provider_label || null : null;
        const pending = row.paymentStatus === 'pendiente' && status !== 'cancelado';
        const live = pending && link?.status === 'pending' && (!row.expiresAt || row.expiresAt.getTime() > Date.now());
        let note: string | null = null;
        if (row.paymentStatus === 'vencido') note = 'El tiempo para pagar terminó y el pedido se canceló. Si todavía lo quieres, vuelve a la tienda y hazlo de nuevo.';
        else if (row.paymentStatus === 'pagado' && status === 'cancelado') note = 'Recibimos tu pago, pero el pedido estaba cancelado. La tienda se va a comunicar contigo.';
        else if (pending && !live) note = 'Estamos confirmando tu pago.';
        return {
            pay_url: live ? link!.url : null,
            pay_until: live && row.expiresAt ? row.expiresAt.toISOString() : null,
            pay_provider: provider,
            payment_note: note,
        };
    }

    private async linkRow(tenantId: number, linkId: number): Promise<{ id: number; url: string; status: string; provider: string } | null> {
        const [l] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: paymentLinks.id, url: paymentLinks.url, status: paymentLinks.status, provider: paymentLinks.provider })
                .from(paymentLinks)
                .where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.id, linkId)))
                .limit(1),
        );
        return l ?? null;
    }

    async findByToken(tenantId: number, orderToken: string): Promise<ShopOrderRow | null> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(shopOrders).where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.token, orderToken))).limit(1),
        );
        return row ?? null;
    }

    /** El estado del pedido lo maneja el equipo en el registro: se lee de ahí. */
    private async orderStatus(tenantId: number, row: ShopOrderRow): Promise<ShopOrderStatus> {
        if (row.cancelledAt) return 'cancelado';
        if (!row.recordId || !row.statusFieldId) return 'nuevo';
        const [rec] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ v: sql<string | null>`${records.data}->>${jsonbKeyForField(row.statusFieldId!)}` })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.id, row.recordId!)))
                .limit(1),
        );
        const v = rec?.v;
        return v && v in SHOP_ORDER_STATUS_LABELS ? (v as ShopOrderStatus) : 'nuevo';
    }

    // ─────────────────────────── Panel de la ficha ───────────────────────────

    async panel(tenantId: number, recordId: number): Promise<ShopOrderPanelDto | null> {
        const res = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx.select().from(shopOrders).where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.recordId, recordId))).limit(1);
            if (!row) return null;
            const [shop] = row.shopId ? await tx.select({ name: shops.name, token: shops.token }).from(shops).where(and(eq(shops.tenantId, tenantId), eq(shops.id, row.shopId))).limit(1) : [];
            return { row, shop: shop ?? null };
        });
        if (!res) return null;
        const { row, shop } = res;
        const base = await this.base(tenantId);
        return {
            shop_id: row.shopId,
            shop_name: shop?.name ?? 'Tienda eliminada',
            number: row.number,
            payment_method: row.paymentMethod,
            payment_label: SHOP_PAYMENT_METHOD_LABELS[row.paymentMethod as ShopPaymentMethod] ?? row.paymentMethod,
            payment_status: row.paymentStatus,
            payment_status_label: SHOP_PAYMENT_STATUS_LABELS[row.paymentStatus as ShopPaymentStatus] ?? row.paymentStatus,
            total: row.total,
            currency: row.currency,
            stock_state: (row.stockState as ShopOrderPanelDto['stock_state']) ?? 'none',
            paid_at: row.paidAt ? row.paidAt.toISOString() : null,
            cancelled: row.cancelledAt !== null,
            public_url: shop ? `${base}/api/v1/public/s/${shop.token}?pedido=${row.token}` : null,
            created_at: row.createdAt.toISOString(),
            ...(await this.panelOnline(tenantId, row)),
        };
    }

    private async panelOnline(tenantId: number, row: ShopOrderRow): Promise<Pick<ShopOrderPanelDto, 'pay_url' | 'pay_until' | 'pay_provider'>> {
        if (row.paymentMethod !== 'online' || !row.paymentLinkId) return { pay_url: null, pay_until: null, pay_provider: null };
        const link = await this.linkRow(tenantId, row.paymentLinkId);
        const live = row.paymentStatus === 'pendiente' && !row.cancelledAt && link?.status === 'pending';
        return {
            pay_url: live ? link!.url : null,
            pay_until: live && row.expiresAt ? row.expiresAt.toISOString() : null,
            pay_provider: link ? shopOnlinePayment(link.provider).provider_label || null : null,
        };
    }

    /** Pagó por fuera (transferencia, contra entrega): el equipo lo marca. */
    async markPaid(tenantId: number, userId: number, recordId: number): Promise<{ number: string; listId: number }> {
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .select()
                .from(shopOrders)
                .where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.recordId, recordId)))
                .limit(1)
                .for('update');
            if (!row) throw new NotFoundException({ code: 'shop_order_not_found', message: 'Ese registro no es un pedido de la tienda.', data: { status: 404 } });
            if (row.paymentStatus === 'pagado') return { row, changed: null };
            const now = new Date();
            await tx.update(shopOrders).set({ paymentStatus: 'pagado', paidAt: now, updatedAt: now }).where(eq(shopOrders.id, row.id));
            const [rec] = await tx.select({ listId: records.listId, data: records.data }).from(records).where(and(eq(records.tenantId, tenantId), eq(records.id, recordId), isNull(records.deletedAt))).limit(1).for('no key update');
            if (!rec) return { row, changed: null };
            const [shop] = row.shopId ? await tx.select({ config: shops.config }).from(shops).where(and(eq(shops.tenantId, tenantId), eq(shops.id, row.shopId))).limit(1) : [];
            const o = shop ? readShopConfig(shop.config).orders : null;
            if (!o) return { row, changed: null };
            const fields = await this.fieldsOf(tx, tenantId, rec.listId);
            const before = rec.data as Record<string, unknown>;
            const next = { ...before };
            put(next, fields.get(o.fields.payment_status ?? -1), 'pagado');
            const paidField = fields.get(o.fields.paid_at ?? -1);
            if (paidField) put(next, paidField, paidField.type === 'date' ? now.toISOString().slice(0, 10) : now.toISOString());
            await this.recordsRepo.updateData(tx, tenantId, rec.listId, recordId, next, userId);
            await this.activity.logInTx(tx, { tenantId, listId: rec.listId, recordId, userId, action: 'record_updated', diff: computeDiff(before, next) });
            return { row, changed: { listId: rec.listId, before, after: next } };
        });
        if (out.changed) {
            this.realtime.records(tenantId, out.changed.listId);
            this.automations.dispatch({ tenantId, listId: out.changed.listId, recordId, trigger: 'record_updated', before: out.changed.before, after: out.changed.after });
        }
        // v0.1.413 — Pagó por otro medio: el link en línea ya no se debe pagar.
        if (out.row.paymentLinkId && this.collections) {
            await this.collections.expireLink(tenantId, out.row.paymentLinkId, 'El pedido se marcó como pagado por otro medio.').catch(() => undefined);
        }
        return { number: out.row.number, listId: out.changed?.listId ?? 0 };
    }

    // ─────────────────────────── Cancelar → devolver stock ───────────────────────────

    private async onRecordChange(c: RecordChange): Promise<void> {
        if (c.origin === 'shop' || !c.list) return;
        const marker = readShopListMarker(c.list.settings);
        if (!marker || marker.role !== 'orders') return;
        await this.syncCancellation(c.tenantId, c.recordId, c.before, c.after);
    }

    /** Público para los tests (y por si un día se llama desde otro lado). */
    async syncCancellation(tenantId: number, recordId: number, before: Record<string, unknown>, after: Record<string, unknown>): Promise<void> {
        const after2 = { cancelLink: null as number | null };
        const touched = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .select()
                .from(shopOrders)
                .where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.recordId, recordId)))
                .limit(1)
                .for('update');
            if (!row || !row.statusFieldId) return [];
            const key = jsonbKeyForField(row.statusFieldId);
            const was = before[key] === 'cancelado';
            const now = after[key] === 'cancelado';
            if (was === now) return [];
            // v0.1.413 — El equipo canceló un pedido que esperaba el pago en línea: el link ya no se paga.
            if (now && row.paymentStatus === 'pendiente' && row.paymentLinkId) after2.cancelLink = row.paymentLinkId;
            const out: Touched[] = [];
            if (now && row.stockState === 'taken') {
                out.push(...(await this.moveStock(tx, tenantId, row, +1)));
                await tx.update(shopOrders).set({ stockState: 'returned', cancelledAt: new Date(), updatedAt: new Date() }).where(eq(shopOrders.id, row.id));
            } else if (!now && row.stockState === 'returned') {
                out.push(...(await this.moveStock(tx, tenantId, row, -1)));
                await tx.update(shopOrders).set({ stockState: 'taken', cancelledAt: null, updatedAt: new Date() }).where(eq(shopOrders.id, row.id));
            } else {
                await tx
                    .update(shopOrders)
                    .set({ cancelledAt: now ? new Date() : null, updatedAt: new Date() })
                    .where(eq(shopOrders.id, row.id));
            }
            return out;
        });
        for (const listId of new Set(touched.map((t) => t.listId))) this.realtime.records(tenantId, listId);
        for (const t of touched) {
            this.automations.dispatch({ tenantId, listId: t.listId, recordId: t.recordId, trigger: 'record_updated', before: t.before ?? {}, after: t.after });
        }
        if (after2.cancelLink !== null && this.collections) {
            await this.collections.expireLink(tenantId, after2.cancelLink, 'El pedido se canceló.').catch(() => undefined);
        }
    }

    // ─────────────────────────── Pago en línea (v0.1.413) ───────────────────────────

    /** La tienda de un pedido, para los correos y el vencimiento (sin la página). */
    private async shopCtx(tenantId: number, shopId: number | null): Promise<ShopCtx | null> {
        if (!shopId) return null;
        const [hit] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ shop: shops, settings: tenants.settings, name: tenants.name })
                .from(shops)
                .innerJoin(tenants, eq(tenants.id, shops.tenantId))
                .where(and(eq(shops.tenantId, tenantId), eq(shops.id, shopId)))
                .limit(1),
        );
        if (!hit) return null;
        const settings = (hit.settings ?? {}) as Record<string, unknown>;
        const b = brandingSchema.safeParse(settings.branding ?? {});
        return {
            tenantId,
            shop: hit.shop,
            config: readShopConfig(hit.shop.config),
            token: hit.shop.token,
            company: (b.success ? b.data.app_name : null) || hit.name,
            tenantSettings: settings,
        };
    }

    private moneyFor(ctx: ShopCtx, currency: string): (n: number) => string {
        const fmt = tenantFormatSchema.safeParse(ctx.tenantSettings.format ?? {});
        const numberFormat = fmt.success ? fmt.data.number_format : 'dot_comma';
        return (n: number): string => formatShopMoney(n, currency, numberFormat);
    }

    /** Llegó el pago de un link (el aviso del proveedor, «Verificar» o la consulta al volver). */
    async onLinkPaid(tenantId: number, linkId: number): Promise<void> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: shopOrders.id })
                .from(shopOrders)
                .where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.paymentLinkId, linkId)))
                .limit(1),
        );
        if (row) await this.settlePaid(tenantId, row.id);
    }

    /**
     * v0.1.413 — Al volver de pagar, la página pregunta: si el pago en línea
     * sigue pendiente, se le pregunta al proveedor y, si ya está, el pedido
     * queda pagado EN EL ACTO (el aviso llegaría segundos después).
     */
    async refreshPayment(tenantId: number, shopId: number, orderToken: string): Promise<void> {
        const row = await this.findByToken(tenantId, orderToken);
        if (!row || row.shopId !== shopId || row.paymentMethod !== 'online' || row.paymentStatus !== 'pendiente' || !row.paymentLinkId || !this.collections) return;
        const st = await this.collections.linkState(tenantId, row.paymentLinkId, { refresh: true });
        if (st?.status === 'approved') await this.settlePaid(tenantId, row.id);
    }

    /**
     * Entró el pago en línea de un pedido. Es idempotente (todo pasa con la
     * fila bloqueada y sólo si todavía no estaba pagado):
     *  - El pedido esperaba el pago: queda pagado.
     *  - Se había cancelado por no pagar a tiempo: si el stock alcanza, se
     *    vuelve a tomar y el pedido revive; si no, queda pagado pero cancelado
     *    y el equipo se entera para conseguir el producto o devolver el dinero.
     *  - Lo canceló el equipo: queda pagado y el equipo se entera.
     */
    async settlePaid(tenantId: number, orderId: number): Promise<'paid' | 'reopened' | 'late' | null> {
        const touched: Touched[] = [];
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx.select().from(shopOrders).where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.id, orderId))).limit(1).for('update');
            if (!row || row.paymentStatus === 'pagado') return null;
            const [shop] = row.shopId ? await tx.select({ config: shops.config }).from(shops).where(and(eq(shops.tenantId, tenantId), eq(shops.id, row.shopId))).limit(1) : [];
            const o = shop ? readShopConfig(shop.config).orders : null;
            const now = new Date();
            let outcome: 'paid' | 'reopened' | 'late' = 'paid';
            let reopen = false;
            if (row.cancelledAt) {
                outcome = 'late';
                if (row.paymentStatus === 'vencido') {
                    // Se canceló porque no pagó a tiempo: si todavía hay stock, revive.
                    if (row.stockState === 'returned') {
                        if (await this.stockAvailable(tx, tenantId, row)) {
                            touched.push(...(await this.moveStock(tx, tenantId, row, -1)));
                            reopen = true;
                        }
                    } else reopen = true;
                    if (reopen) outcome = 'reopened';
                }
            }
            await tx
                .update(shopOrders)
                .set({
                    paymentStatus: 'pagado',
                    paidAt: now,
                    updatedAt: now,
                    ...(reopen ? { cancelledAt: null, ...(row.stockState === 'returned' ? { stockState: 'taken' } : {}) } : {}),
                })
                .where(eq(shopOrders.id, row.id));
            // El registro del pedido: estado del pago (y del pedido si revive).
            if (row.recordId && o) {
                const [rec] = await tx
                    .select({ listId: records.listId, data: records.data })
                    .from(records)
                    .where(and(eq(records.tenantId, tenantId), eq(records.id, row.recordId), isNull(records.deletedAt)))
                    .limit(1)
                    .for('no key update');
                if (rec) {
                    const fields = await this.fieldsOf(tx, tenantId, rec.listId);
                    const before = rec.data as Record<string, unknown>;
                    const next = { ...before };
                    put(next, fields.get(o.fields.payment_status ?? -1), 'pagado');
                    const paidField = fields.get(o.fields.paid_at ?? -1);
                    if (paidField) put(next, paidField, paidField.type === 'date' ? now.toISOString().slice(0, 10) : now.toISOString());
                    if (reopen) put(next, fields.get(o.fields.status ?? -1), 'nuevo');
                    const updated = await this.recordsRepo.updateData(tx, tenantId, rec.listId, row.recordId, next, 0);
                    if (updated) {
                        await this.activity.logInTx(tx, { tenantId, listId: rec.listId, recordId: row.recordId, userId: null, action: 'record_updated', diff: computeDiff(before, next) });
                        touched.push({ listId: rec.listId, recordId: row.recordId, kind: 'updated', before, after: updated.data as Record<string, unknown> });
                    }
                }
            }
            return { row, outcome };
        });
        if (!out) return null;
        for (const listId of new Set(touched.map((t) => t.listId))) this.realtime.records(tenantId, listId);
        for (const t of touched) {
            this.automations.dispatch({ tenantId, listId: t.listId, recordId: t.recordId, trigger: 'record_updated', before: t.before ?? {}, after: t.after });
        }
        const ctx = await this.shopCtx(tenantId, out.row.shopId);
        if (!ctx) return out.outcome;
        const money = this.moneyFor(ctx, out.row.currency);
        const customer = out.row.customer as Record<string, string>;
        const orderList = ctx.config.orders.list_id ?? ctx.shop.listId;
        const recordId = out.row.recordId ?? 0;
        if (out.outcome === 'late') {
            this.notify?.emit({
                type: 'shop',
                tenantId,
                listId: orderList,
                recordId,
                userIds: this.notifyIds(ctx.config, ctx.shop),
                title: `Llegó el pago de ${out.row.number}, pero el pedido estaba cancelado`.slice(0, 200),
                body:
                    out.row.paymentStatus === 'vencido'
                        ? `${customer.name ?? 'El cliente'} pagó ${money(out.row.total)} después del tiempo y ya no hay stock para todo el pedido. Comunícate para conseguir el producto o devolver el pago.`
                        : `${customer.name ?? 'El cliente'} pagó ${money(out.row.total)}. Comunícate para reactivar el pedido o devolver el pago.`,
            });
            return out.outcome;
        }
        this.notify?.emit({
            type: 'shop',
            tenantId,
            listId: orderList,
            recordId,
            userIds: this.notifyIds(ctx.config, ctx.shop),
            title: `Pedido pagado ${out.row.number} · ${money(out.row.total)}`.slice(0, 200),
            body: `${customer.name ?? ''} · pagó en línea · ${(out.row.lines as ShopOrderLineSnapshot[]).length === 1 ? '1 producto' : `${(out.row.lines as ShopOrderLineSnapshot[]).length} productos`}`,
        });
        if (ctx.config.checkout.send_confirmation && customer.email) {
            const base = await this.base(tenantId);
            const link = out.row.paymentLinkId ? await this.linkRow(tenantId, out.row.paymentLinkId) : null;
            void this.sendConfirmation(ctx, {
                kind: 'paid',
                number: out.row.number,
                customer: { name: customer.name ?? '', email: customer.email },
                lines: out.row.lines as ShopOrderLineSnapshot[],
                totals: { subtotal: out.row.subtotal, shipping: out.row.shipping, total: out.row.total },
                delivery: (out.row.delivery as { name?: string }).name ?? '',
                method: 'online',
                orderUrl: `${base}/api/v1/public/s/${ctx.token}?pedido=${out.row.token}`,
                money,
                provider: link?.provider ?? null,
            }).catch((err: unknown) => this.logger.warn(`Tienda ${ctx.shop.id}: no salió el correo del pago ${out.row.number}: ${String(err)}`));
        }
        return out.outcome;
    }

    /** ¿Alcanza el stock de hoy para volver a tomar lo que devolvió el pedido? (con los productos bloqueados) */
    private async stockAvailable(tx: Tx, tenantId: number, row: ShopOrderRow): Promise<boolean> {
        if (!row.catalogListId || !row.stockFieldId) return true;
        const lines = (row.lines as ShopOrderLineSnapshot[]).filter((l) => l.stock_taken);
        const ids = [...new Set(lines.map((l) => l.product_id))].sort((a, b) => a - b);
        if (ids.length === 0) return true;
        const key = jsonbKeyForField(row.stockFieldId);
        const rows = await tx
            .select({ id: records.id, data: records.data })
            .from(records)
            .where(and(eq(records.tenantId, tenantId), eq(records.listId, row.catalogListId), inArray(records.id, ids), isNull(records.deletedAt)))
            .orderBy(asc(records.id))
            .for('no key update');
        const stock = new Map(rows.map((r) => [r.id, Number((r.data as Record<string, unknown>)[key])]));
        for (const id of ids) {
            const have = stock.get(id);
            const need = lines.filter((l) => l.product_id === id).reduce((n, l) => n + l.qty, 0);
            // Un producto borrado no vuelve; uno que dejó de controlar stock, sí.
            if (have === undefined) return false;
            if (Number.isFinite(have) && have < need) return false;
        }
        return true;
    }

    /**
     * v0.1.413 — Un pedido de pago en línea que no se pagó a tiempo (o cuyo
     * pago no se pudo preparar) se cancela: vuelve el stock, el pedido queda
     * «Cancelado · No se pagó» y el link deja de servir. Un pago que llegue
     * igual lo resuelve `settlePaid`.
     */
    async expireOrder(tenantId: number, orderId: number, note: string): Promise<boolean> {
        const touched: Touched[] = [];
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx.select().from(shopOrders).where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.id, orderId))).limit(1).for('update');
            if (!r || r.paymentStatus !== 'pendiente' || r.cancelledAt) return null;
            if (r.stockState === 'taken') touched.push(...(await this.moveStock(tx, tenantId, r, +1)));
            const now = new Date();
            await tx
                .update(shopOrders)
                .set({ paymentStatus: 'vencido', cancelledAt: now, updatedAt: now, ...(r.stockState === 'taken' ? { stockState: 'returned' } : {}) })
                .where(eq(shopOrders.id, r.id));
            const [shop] = r.shopId ? await tx.select({ config: shops.config }).from(shops).where(and(eq(shops.tenantId, tenantId), eq(shops.id, r.shopId))).limit(1) : [];
            const o = shop ? readShopConfig(shop.config).orders : null;
            if (r.recordId && o) {
                const [rec] = await tx
                    .select({ listId: records.listId, data: records.data })
                    .from(records)
                    .where(and(eq(records.tenantId, tenantId), eq(records.id, r.recordId), isNull(records.deletedAt)))
                    .limit(1)
                    .for('no key update');
                if (rec) {
                    const fields = await this.fieldsOf(tx, tenantId, rec.listId);
                    const before = rec.data as Record<string, unknown>;
                    const next = { ...before };
                    put(next, fields.get(o.fields.payment_status ?? -1), 'vencido');
                    put(next, fields.get(o.fields.status ?? -1), 'cancelado');
                    const updated = await this.recordsRepo.updateData(tx, tenantId, rec.listId, r.recordId, next, 0);
                    if (updated) {
                        await this.activity.logInTx(tx, { tenantId, listId: rec.listId, recordId: r.recordId, userId: null, action: 'record_updated', diff: computeDiff(before, next) });
                        touched.push({ listId: rec.listId, recordId: r.recordId, kind: 'updated', before, after: updated.data as Record<string, unknown> });
                    }
                }
            }
            return r;
        });
        if (!row) return false;
        for (const listId of new Set(touched.map((t) => t.listId))) this.realtime.records(tenantId, listId);
        for (const t of touched) {
            this.automations.dispatch({ tenantId, listId: t.listId, recordId: t.recordId, trigger: 'record_updated', before: t.before ?? {}, after: t.after });
        }
        if (row.paymentLinkId && this.collections) await this.collections.expireLink(tenantId, row.paymentLinkId, note).catch(() => undefined);
        return true;
    }

    /**
     * v0.1.413 — El barrido (cada minuto, `ShopTasksService`): los pedidos de
     * pago en línea cuyo tiempo para pagar pasó. Antes de cancelar se le
     * pregunta al proveedor (el aviso puede no haber llegado). Por la conexión
     * base: recorre todas las empresas; cada cambio va en su transacción con
     * la fila bloqueada, así dos nodos no cancelan dos veces.
     */
    async expireDue(now = new Date()): Promise<number> {
        if (!this.db) return 0;
        const due = await this.db
            .select({ id: shopOrders.id, tenantId: shopOrders.tenantId, linkId: shopOrders.paymentLinkId })
            .from(shopOrders)
            .where(and(eq(shopOrders.paymentStatus, 'pendiente'), eq(shopOrders.paymentMethod, 'online'), isNull(shopOrders.cancelledAt), lt(shopOrders.expiresAt, now)))
            .orderBy(asc(shopOrders.expiresAt))
            .limit(EXPIRE_BATCH);
        let done = 0;
        for (const d of due) {
            try {
                if (d.linkId && this.collections) {
                    const st = await this.collections.linkState(d.tenantId, d.linkId, { refresh: true }).catch(() => null);
                    if (st?.status === 'approved') {
                        if (await this.settlePaid(d.tenantId, d.id)) done++;
                        continue;
                    }
                }
                if (await this.expireOrder(d.tenantId, d.id, 'Venció el tiempo para pagar el pedido.')) done++;
            } catch (err) {
                this.logger.warn(`Tienda: no se pudo vencer el pedido ${d.id}: ${String(err)}`);
            }
        }
        return done;
    }

    private async moveStock(tx: Tx, tenantId: number, row: ShopOrderRow, sign: 1 | -1): Promise<Touched[]> {
        if (!row.catalogListId || !row.stockFieldId) return [];
        const lines = (row.lines as ShopOrderLineSnapshot[]).filter((l) => l.stock_taken);
        const ids = [...new Set(lines.map((l) => l.product_id))].sort((a, b) => a - b);
        if (ids.length === 0) return [];
        const key = jsonbKeyForField(row.stockFieldId);
        const rows = await tx
            .select({ id: records.id, data: records.data })
            .from(records)
            .where(and(eq(records.tenantId, tenantId), eq(records.listId, row.catalogListId), inArray(records.id, ids), isNull(records.deletedAt)))
            .orderBy(asc(records.id))
            .for('no key update');
        const out: Touched[] = [];
        for (const r of rows) {
            const data = r.data as Record<string, unknown>;
            const cur = Number(data[key]);
            // Un producto que ahora no controla stock (lo vaciaron) no se toca.
            if (!Number.isFinite(cur)) continue;
            const qty = lines.filter((l) => l.product_id === r.id).reduce((n, l) => n + l.qty, 0);
            const next = { ...data, [key]: Math.max(0, cur + sign * qty) };
            const updated = await this.recordsRepo.updateData(tx, tenantId, row.catalogListId, r.id, next, 0);
            if (!updated) continue;
            await this.activity.logInTx(tx, { tenantId, listId: row.catalogListId, recordId: r.id, userId: null, action: 'record_updated', diff: computeDiff(data, next) });
            out.push({ listId: row.catalogListId, recordId: r.id, kind: 'updated', before: data, after: next });
        }
        return out;
    }
}

export function paymentInstructions(config: ShopConfig, method: ShopPaymentMethod): string {
    switch (method) {
        case 'whatsapp':
            return 'Envíanos el pedido por WhatsApp y te confirmamos la disponibilidad, el pago y la entrega.';
        case 'transfer':
            return config.payments.transfer.instructions;
        case 'cod':
            return config.payments.cod.instructions;
        default:
            return '';
    }
}
