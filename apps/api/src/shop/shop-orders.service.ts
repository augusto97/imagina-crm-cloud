import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import {
    SHOP_MY_ORDERS_MAX,
    SHOP_ORDER_STATUS_LABELS,
    SHOP_PAYMENT_METHOD_LABELS,
    SHOP_PAYMENT_STATUS_LABELS,
    SUBSCRIPTION_STATUS_OPTIONS,
    SHOP_STAT_SOURCE_RE,
    brandingSchema,
    cleanAttribution,
    cleanShopAnswers,
    publicShopCheckoutFields,
    shopAnswerText,
    shopFieldLabel,
    shopPhoneOk,
    computeShopCart,
    formStatSourceLabel,
    roundShopQty,
    shopLineText,
    shopCouponProblemText,
    shopCurrencyDecimals,
    shopNeedsDelivery,
    shopShippingFor,
    formatShopMoney,
    jsonbKeyForField,
    readShopConfig,
    readShopListMarker,
    shopOnlinePayment,
    shopPlanFor,
    shopPurchaseConversion,
    subscriptionFrequencyText,
    subscriptionPlanExtras,
    tenantFormatSchema,
    validateFieldValue,
    type Field,
    type PublicShopDownload,
    type PublicShopMyOrders,
    type PublicShopOrder,
    type PublicShopOrderInput,
    type PublicShopQuestion,
    type ShopAnswer,
    type ShopCartResult,
    type ShopConfig,
    type ShopOrderLineSnapshot,
    type ShopOrderPanelDto,
    type ShopOrderStatus,
    type TenantFormat,
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
import { attachments, lists, paymentLinks, records, shopOrders, shops, tenants, type ShopOrderRow, type ShopRow } from '../db/schema';
import { DomainsService } from '../domains/domains.service';
import { FieldsService } from '../fields/fields.service';
import { FilesService } from '../files/files.service';
import { IncidentHub } from '../incidents/incident-hub';
import { MailService } from '../mail/mail.service';
import { NotifyHub } from '../notifications/notify-hub';
import { senderName, type PortalEmailBrand } from '../portal/portal-email';
import { RealtimeService } from '../realtime/realtime.service';
import { ShopCouponsService, type ResolvedCoupon } from './shop-coupons.service';
import { RecordChangeHub, type RecordChange } from '../records/record-change-hub';
import { RecordsRepository } from '../records/records.repository';
import { RelationsRepository } from '../records/relations.repository';
import { TenantDb } from '../tenancy/tenant-db.service';
import { productFromRow, purchasablesFromRows, resolveCatalogFields, resolveVariantAttributes, type PurchasableRow, type ResolvedCatalog } from './shop-catalog';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { shopMyOrdersEmail, shopOrderEmail } from './shop-email';
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
    constructor(message = 'No pudimos preparar el pago en línea. Intenta de nuevo en un momento o elige otra forma de pago.') {
        super(
            {
                code: 'shop_payment_unavailable',
                message,
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

/**
 * v0.1.430 — La respuesta de una pregunta propia en el tipo de su columna de
 * «Pedidos»: una opción por su valor (la etiqueta que eligió la persona),
 * un texto en palabras («Sí», «14/11/2026»), o tal cual.
 */
function answerForColumn(field: Field, q: PublicShopQuestion, value: ShopAnswer, format: TenantFormat['number_format']): unknown {
    if (field.type === 'select') {
        const opts = ((field.config as { options?: Array<{ value?: unknown; label?: unknown }> } | undefined)?.options ?? []) as Array<{ value?: unknown; label?: unknown }>;
        const key = (x: unknown): string => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        const want = key(value);
        const hit = opts.find((o) => key(o.label) === want || key(o.value) === want);
        return hit ? hit.value : undefined;
    }
    if (field.type === 'text' || field.type === 'long_text') return shopAnswerText(q, value, format);
    return value;
}

/** v0.1.430 — Las respuestas guardadas con el pedido (tolerante: un pedido de antes no trae). */
export function orderAnswers(customer: unknown): Array<{ label: string; text: string }> {
    const raw = (customer as { answers?: unknown } | null)?.answers;
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((a): a is { label: unknown; text: unknown } => !!a && typeof a === 'object')
        .map((a) => ({ label: String(a.label ?? '').slice(0, 120), text: String(a.text ?? '').slice(0, 2000) }))
        .filter((a) => a.label !== '' && a.text !== '')
        .slice(0, 12);
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
        // v0.1.415 — cupones (se validan y se cuentan dentro del pedido).
        @Optional() private readonly coupons?: ShopCouponsService,
        // v0.1.417 — suscripciones (débito automático) desde la tienda.
        @Optional() readonly subscriptions?: SubscriptionsService,
    ) {}

    onModuleInit(): void {
        this.changes?.subscribe((c) => this.onRecordChange(c));
        // v0.1.417 — la persona autorizó la tarjeta: el pedido queda pagado.
        this.subscriptions?.registerEventSink((tenantId, sub, events) => this.onSubscriptionEvent(tenantId, sub.id, events));
        // v0.1.413 — llegó el pago de un link: si es de un pedido, se da por pagado.
        this.collections?.onLinkPaid((e) => this.onLinkPaid(e.tenantId, e.linkId));
    }

    /** v0.1.416 — El dominio de la empresa para los enlaces públicos (o el de la plataforma). */
    publicBase(tenantId: number): Promise<string> {
        return this.base(tenantId);
    }

    /**
     * v0.1.423 — La página de la tienda para los enlaces que salen (el pedido,
     * «Mis pedidos»): su dominio propio si ya responde; si no, la dirección de
     * la tienda en la plataforma (que funciona siempre).
     */
    async shopPageUrl(tenantId: number, shop: { id: number; token: string; customDomain?: string | null } | null, token: string): Promise<string> {
        if (shop?.customDomain && this.domains) {
            const site = await this.domains.shopSiteUrl(shop.id, shop.customDomain).catch(() => null);
            if (site) return `${site}/`;
        }
        return `${await this.base(tenantId)}/api/v1/public/s/${token}`;
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
        // v0.1.416 — La entrega se exige recién al ver qué se compra: un
        // carrito sólo de descargables no pide forma de entrega ni dirección.
        const delivery = input.delivery_id ? (config.delivery.find((d) => d.active && d.id === input.delivery_id) ?? null) : null;
        // v0.1.415 — Con zonas, la persona elige a dónde y la zona pone el precio.
        const zones = delivery ? delivery.zones.filter((z) => z.active && z.name.trim() !== '') : [];
        const zone = zones.length > 0 ? (zones.find((z) => z.id === input.zone_id) ?? null) : null;
        const enabled: Record<ShopPaymentMethod, boolean> = {
            whatsapp: config.payments.whatsapp.enabled,
            transfer: config.payments.transfer.enabled,
            cod: config.payments.cod.enabled,
            online: config.payments.online.enabled && (s.onlineConnectionId ?? null) !== null && !!this.collections,
            // v0.1.416 — Sólo vale si el carrito sale en cero (se comprueba con la cuenta).
            free: true,
            // v0.1.417 — Un producto de suscripción con su plan (se comprueba abajo).
            subscription: !!this.subscriptions,
        };
        if (!enabled[input.payment_method]) badRequest('shop_payment', 'Elige una forma de pago.');
        // v0.1.417 — Suscribirse es de a un producto, sin cupón.
        const subscribing = input.payment_method === 'subscription';
        if (subscribing) {
            if (input.lines.length !== 1) badRequest('shop_subscription', 'Las suscripciones se contratan de a una.');
            if (input.coupon && input.coupon.trim() !== '') badRequest('shop_coupon', 'Los cupones no aplican a las suscripciones.');
        }
        const subPlans = subscribing ? await this.subscriptions!.shopPlans(tenantId).catch(() => []) : [];
        const orderLines = subscribing ? [{ product_id: input.lines[0]!.product_id, qty: 1 }] : input.lines;
        // v0.1.430 — Lo que la tienda no pide no se guarda aunque llegue; lo obligatorio se exige.
        const ch = config.checkout;
        const askFields = publicShopCheckoutFields(ch);
        const c = {
            ...input.customer,
            phone: ch.ask_phone === 'hidden' ? '' : input.customer.phone,
            document: ch.ask_document === 'hidden' ? '' : input.customer.document,
            notes: ch.ask_notes === 'hidden' ? '' : input.customer.notes,
        };
        if (ch.ask_phone === 'required' && !shopPhoneOk(c.phone)) badRequest('shop_phone', `Completa «${shopFieldLabel(askFields, 'phone')}» (al menos 7 números).`);
        if (ch.ask_document === 'required' && !c.document.trim()) badRequest('shop_document', `Completa «${shopFieldLabel(askFields, 'document')}».`);
        if (ch.ask_notes === 'required' && !c.notes.trim()) badRequest('shop_notes', `Completa «${shopFieldLabel(askFields, 'notes')}».`);
        if (config.checkout.require_terms && input.terms !== true) badRequest('shop_terms', 'Para comprar, acepta los términos y condiciones.');

        const cap = this.billing ? await this.billing.recordLimit(tenantId) : null;
        const currency = config.currency;
        const fmt = tenantFormatSchema.safeParse(s.tenantSettings.format ?? {});
        const numberFormat = fmt.success ? fmt.data.number_format : 'dot_comma';
        const money = (n: number): string => formatShopMoney(n, currency, numberFormat);
        const orderToken = newOrderToken();
        const orderUrl = `${await this.shopPageUrl(tenantId, shop, s.token)}?pedido=${orderToken}`;
        // v0.1.416 — «Sin costo» como opción de la columna del método (tiendas de antes).
        if (input.payment_method === 'free' || input.payment_method === 'subscription') await this.ensureMethodOption(tenantId, config, input.payment_method).catch(() => undefined);

        const touched: Touched[] = [];
        const result = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const catalogFields = await this.fields.listByListIdWithinTx(tx, tenantId, shop.listId);
            const [catalogList] = await tx.select({ settings: lists.settings, name: lists.name }).from(lists).where(and(eq(lists.tenantId, tenantId), eq(lists.id, shop.listId))).limit(1);
            const rf = resolveCatalogFields(catalogFields, config.catalog, catalogList?.settings ?? {}, config.kinds);
            if (!rf.price) badRequest('shop_closed', 'Esta tienda no está recibiendo pedidos ahora.');

            // 1) Los productos (o variantes), bloqueados y leídos de la base.
            const ids = [...new Set(orderLines.map((l) => l.product_id))].sort((a, b) => a - b);
            const variantsOn = config.variants.enabled;
            const rows = await tx
                .select({ id: records.id, data: records.data, createdAt: records.createdAt, parentId: records.parentId })
                .from(records)
                .where(
                    and(
                        eq(records.tenantId, tenantId),
                        eq(records.listId, shop.listId),
                        inArray(records.id, ids),
                        isNull(records.deletedAt),
                        ...(variantsOn ? [] : [isNull(records.parentId)]),
                    ),
                )
                .orderBy(asc(records.id))
                .for('no key update');
            const byId = await this.purchasableRows(tx, tenantId, shop.listId, rows, rf, variantsOn ? resolveVariantAttributes(catalogFields, config.variants.attributes) : null, {
                subscriptions: subscribing,
            });
            // v0.1.417 — El plan del producto de suscripción (el de su producto si es una variante).
            let planId: number | null = null;
            if (subscribing) {
                const item = byId.get(orderLines[0]!.product_id);
                if (item) {
                    const baseId = item.parentId ?? orderLines[0]!.product_id;
                    let baseTitle = item.product.title;
                    if (item.parentId !== null) {
                        const [parent] = await tx
                            .select({ id: records.id, data: records.data, createdAt: records.createdAt })
                            .from(records)
                            .where(and(eq(records.tenantId, tenantId), eq(records.id, item.parentId)))
                            .limit(1);
                        if (parent) baseTitle = productFromRow({ id: parent.id, data: parent.data as Record<string, unknown>, createdAt: parent.createdAt }, rf).product.title;
                    }
                    planId = shopPlanFor({ id: baseId, title: baseTitle }, config.kinds.subscription_links, subPlans, currency);
                    if (planId === null) badRequest('shop_subscription', 'Este producto no se puede suscribir ahora. Escríbenos para contratarlo.');
                }
                if (config.kinds.subscription_address && (!c.address.trim() || !c.city.trim())) badRequest('shop_address', 'Escribe la dirección y la ciudad de entrega.');
            }
            // v0.1.416 — ¿Algo se envía o se recoge? Un carrito de descargables no pide entrega.
            const needsDelivery = !subscribing && shopNeedsDelivery(orderLines, (id) => byId.get(id)?.kind);
            if (needsDelivery) {
                if (!delivery) badRequest('shop_delivery', 'Elige cómo quieres recibir tu pedido.');
                if (zones.length > 0 && !zone) badRequest('shop_zone', 'Elige a dónde enviamos tu pedido.');
                if (delivery!.needs_address && (!c.address.trim() || !c.city.trim())) badRequest('shop_address', 'Escribe la dirección y la ciudad de entrega.');
            }
            // v0.1.430 — Las preguntas propias: las de la dirección, sólo si la entrega pide dirección.
            const withAddress = subscribing ? config.kinds.subscription_address : needsDelivery && !!delivery?.needs_address;
            const asked = cleanShopAnswers(askFields.questions, input.answers ?? {}, { withAddress, format: numberFormat });
            if (asked.error) {
                throw new BadRequestException({ code: 'shop_answer', message: asked.error.text, data: { status: 400, question: asked.error.id } });
            }
            const answers = asked.answers;
            const answerTexts = askFields.questions.filter((q) => answers[q.id] !== undefined).map((q) => ({ label: q.label, text: shopAnswerText(q, answers[q.id]!, numberFormat) }));
            const ship = needsDelivery ? shopShippingFor({ price: delivery!.price, free_over: delivery!.free_over, zones }, zone?.id ?? null) : { price: 0, free_over: null };
            const deliveryLabel = subscribing
                ? config.kinds.subscription_address
                    ? 'Suscripción · con envío'
                    : 'Suscripción'
                : needsDelivery
                  ? zone
                      ? `${delivery!.name} · ${zone.name}`
                      : delivery!.name
                  : 'Descarga digital';
            // v0.1.415 — El cupón: la fila se bloquea antes de contar sus usos.
            let coupon: ResolvedCoupon | null = null;
            if (input.coupon && input.coupon.trim() !== '') {
                if (!this.coupons) badRequest('shop_coupon', 'Ese cupón no existe o ya no está vigente.');
                const items = [...byId].map(([id, it]) => ({ id, product_id: it.parentId ?? id, categories: it.categories }));
                const r = await this.coupons!.resolve(tx, tenantId, shop.id, input.coupon, { items, currency, numberFormat, email: c.email, lock: true });
                if (!r.ok) badRequest('shop_coupon', r.message);
                coupon = r.coupon;
            }
            const cart = computeShopCart(orderLines, new Map([...byId].map(([k, v]) => [k, v.product])), {
                shipping: ship.price,
                freeOver: ship.free_over,
                minOrder: subscribing ? null : config.checkout.min_order,
                coupon: coupon?.rule ?? null,
                decimals: shopCurrencyDecimals(currency),
            });
            // v0.1.429 — Una cantidad que la regla del producto no acepta (cambió
            // el mínimo o el «de a cuánto» mientras compraba): no se cobra otra
            // cosa de la que vio; se le muestra el carrito corregido.
            if (cart.lines.some((l) => l.adjusted)) {
                throw new ShopCartChangedError({
                    code: 'shop_cart_changed',
                    message: 'Cambió la cantidad que se puede comprar de un producto. Revisa tu carrito y vuelve a intentar.',
                    data: { status: 409, cart },
                });
            }
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
            if (coupon && cart.coupon_problem) badRequest('shop_coupon', shopCouponProblemText(cart.coupon_problem, coupon.rule, money));
            // v0.1.416 — Un pedido en cero no se paga: queda pagado al hacerlo.
            if (input.payment_method === 'free' && cart.total > 0) badRequest('shop_payment', 'Elige una forma de pago.');
            // v0.1.417 — Una suscripción en cero no tiene qué cobrar cada período.
            if (subscribing && cart.total <= 0) badRequest('shop_subscription', 'Este producto no tiene precio: no se puede suscribir.');
            const method: ShopPaymentMethod = subscribing ? 'subscription' : cart.total === 0 ? 'free' : input.payment_method;
            // v0.1.413 — Pago en línea: el stock queda apartado mientras la persona paga.
            const holdUntil = method === 'online' ? new Date(Date.now() + config.payments.online.hold_minutes * 60_000) : null;
            const paidNow = method === 'free' ? new Date() : null;

            // 2) El tope de registros del plan: el pedido, sus líneas y quizá el cliente.
            if (cap && this.billing) await this.billing.assertRecordRoomInTx(tx, tenantId, cap, cart.lines.length + 2);

            // 3) El stock.
            const lines: ShopOrderLineSnapshot[] = [];
            let tookStock = false;
            for (const l of cart.lines) {
                const p = byId.get(l.product_id)!;
                let taken = false;
                // v0.1.417 — Una suscripción no descuenta stock (en 0 se cierran las inscripciones).
                if (!subscribing && rf.stock && p.product.stock !== null) {
                    const key = jsonbKeyForField(rf.stock.id);
                    const next = { ...p.data, [key]: Math.max(0, roundShopQty(p.product.stock - l.qty)) };
                    const updated = await this.recordsRepo.updateData(tx, tenantId, shop.listId, l.product_id, next, 0);
                    if (updated) {
                        await this.activity.logInTx(tx, { tenantId, listId: shop.listId, recordId: l.product_id, userId: null, action: 'record_updated', diff: computeDiff(p.data, next) });
                        touched.push({ listId: shop.listId, recordId: l.product_id, kind: 'updated', before: p.data, after: updated.data as Record<string, unknown> });
                        taken = true;
                        tookStock = true;
                    }
                }
                lines.push({
                    product_id: l.product_id,
                    title: l.title,
                    sku: p.sku,
                    qty: l.qty,
                    unit_price: l.unit_price,
                    subtotal: l.subtotal,
                    stock_taken: taken,
                    parent_id: p.parentId,
                    kind: p.kind,
                    ...(p.downloads.length > 0 ? { files: p.downloads } : {}),
                    ...(l.unit ? { unit: l.unit } : {}),
                });
            }

            // 4) El cliente: por su correo en «Clientes de la tienda».
            const customerId = await this.upsertCustomer(tx, tenantId, o, c, touched);

            // 5) El pedido.
            const orderFields = await this.fieldsOf(tx, tenantId, o.list_id!);
            const of = (r: OrderRole): Field | undefined => orderFields.get(o.fields[r] ?? -1);
            const where = [c.address, c.city].filter((x) => x.trim()).join(', ');
            const items = lines.map((l) => `${shopLineText(l, numberFormat)} — ${money(l.subtotal)}`).join('\n');
            const data: Record<string, unknown> = {};
            put(data, of('status'), 'nuevo');
            put(data, of('payment_status'), paidNow ? 'pagado' : 'pendiente');
            put(data, of('payment_method'), method);
            if (paidNow) {
                const paidField = of('paid_at');
                if (paidField) put(data, paidField, paidField.type === 'date' ? paidNow.toISOString().slice(0, 10) : paidNow.toISOString());
            }
            put(data, of('total'), cart.total);
            put(data, of('subtotal'), cart.subtotal);
            put(data, of('shipping'), cart.shipping);
            if (cart.discount > 0) put(data, of('discount'), cart.discount);
            if (coupon) put(data, of('coupon'), coupon.rule.code);
            put(data, of('delivery'), deliveryLabel);
            put(data, of('email'), c.email);
            put(data, of('phone'), c.phone);
            put(data, of('document'), c.document);
            put(data, of('address'), where);
            put(data, of('notes'), c.notes);
            put(data, of('items'), items);
            // v0.1.430 — Cada respuesta en su columna.
            for (const q of askFields.questions) {
                const value = answers[q.id];
                const fid = ch.questions.find((x) => x.id === q.id)?.field_id ?? null;
                const field = fid !== null ? orderFields.get(fid) : undefined;
                if (value === undefined || !field) continue;
                put(data, field, answerForColumn(field, q, value, numberFormat));
            }
            put(data, of('shop'), shop.name);
            // v0.1.418 — De dónde llegó (lo que ve el equipo, en palabras).
            {
                const origin = shopOrderOrigin(input.origin);
                put(data, of('source'), formStatSourceLabel(String(origin.src)));
                const campaign = (origin.attribution as Record<string, string> | undefined)?.utm_campaign;
                if (campaign) put(data, of('campaign'), campaign.slice(0, 200));
            }
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
                // v0.1.429 — En qué se compró («horas», «kg»): la cantidad sola no lo dice.
                if (l.unit) put(ld, lf('unit'), l.qty === 1 ? l.unit.one : l.unit.many);
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
                paymentStatus: paidNow ? 'pagado' : 'pendiente',
                paidAt: paidNow,
                currency,
                subtotal: cart.subtotal,
                shipping: cart.shipping,
                discount: cart.discount,
                couponId: coupon?.row.id ?? null,
                couponCode: coupon?.rule.code ?? '',
                total: cart.total,
                lines,
                customer: {
                    name: c.name,
                    email: c.email,
                    phone: c.phone,
                    document: c.document,
                    address: c.address,
                    city: c.city,
                    notes: c.notes,
                    // v0.1.430 — Las respuestas en palabras (correo, WhatsApp, página del pedido).
                    ...(answerTexts.length > 0 ? { answers: answerTexts } : {}),
                },
                delivery: needsDelivery
                    ? { id: delivery!.id, name: deliveryLabel, needs_address: delivery!.needs_address, ...(zone ? { zone_id: zone.id, zone_name: zone.name } : {}) }
                    : { id: null, name: deliveryLabel, needs_address: subscribing && config.kinds.subscription_address, ...(subscribing ? { subscription: true } : { digital: true }) },
                origin: shopOrderOrigin(input.origin),
                catalogListId: shop.listId,
                stockFieldId: tookStock && rf.stock ? rf.stock.id : null,
                statusFieldId: statusField?.id ?? null,
                stockState: tookStock ? 'taken' : 'none',
                expiresAt: holdUntil,
            });
            return { cart, number, recordId: inserted.id, orderListId: o.list_id!, lines, method, holdUntil, deliveryLabel, planId, answerTexts };
        });
        const method = result.method;
        const holdUntil = result.holdUntil;
        const deliveryLabel = result.deliveryLabel;

        // v0.1.413 — Pago en línea: el link se arma DESPUÉS del commit (es una
        // llamada al proveedor y no puede tener los productos bloqueados). Si no
        // se puede, el pedido se cancela en el acto (vuelve el stock) y la
        // persona elige otra forma de pago.
        let payUrl: string | null = null;
        // v0.1.417 — Suscripción: el débito automático se arma DESPUÉS del commit
        // (es una llamada al proveedor). Si no se puede, el pedido se cancela.
        if (method === 'subscription') {
            try {
                const product = result.lines[0]!;
                const sub = await this.subscriptions!.createForShop(tenantId, {
                    planId: result.planId!,
                    listId: result.orderListId,
                    recordId: result.recordId,
                    payerEmail: c.email,
                    amount: result.cart.total,
                    title: `${product.title} · ${result.number}`.slice(0, 200),
                    backUrlFor: () => `${orderUrl}&suscripcion=1`,
                });
                payUrl = sub.url;
                await this.tenantDb.withTenant(tenantId, (tx) =>
                    tx
                        .update(shopOrders)
                        .set({ subscriptionId: sub.id, updatedAt: new Date() })
                        .where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.token, orderToken))),
                );
                this.incidents?.resolve(tenantId, `shop-sub:${shop.id}`);
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                this.logger.warn(`Tienda ${shop.id}: no se pudo preparar la suscripción del pedido ${result.number}: ${reason}`);
                this.incidents?.report({
                    tenantId,
                    key: `shop-sub:${shop.id}`,
                    source: 'shop',
                    sourceId: shop.id,
                    listId: shop.listId,
                    ownerId: shop.createdBy,
                    title: `La tienda «${shop.name}» no puede crear suscripciones`,
                    message: `Alguien intentó suscribirse y no se pudo preparar el débito automático: ${reason} Revisa el plan del producto y la cuenta de cobro (Ajustes → Integraciones → Cobros).`,
                });
                for (const listId of new Set(touched.map((t) => t.listId))) this.realtime.records(tenantId, listId);
                const row = await this.findByToken(tenantId, orderToken);
                if (row) await this.expireOrder(tenantId, row.id, 'No se pudo preparar la suscripción.').catch(() => undefined);
                throw new ShopPaymentUnavailableError('No pudimos preparar la suscripción. Intenta de nuevo en un momento.');
            }
        }
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
        // v0.1.417 — Lo mismo con la suscripción: el aviso sale al autorizarla.
        if (method === 'subscription') {
            if (config.checkout.send_confirmation) {
                void this.sendConfirmation(s, {
                    kind: 'awaiting',
                    number: result.number,
                    customer: c,
                    answers: result.answerTexts,
                    lines: result.lines,
                    totals: { subtotal: result.cart.subtotal, shipping: 0, total: result.cart.total },
                    delivery: deliveryLabel,
                    method,
                    orderUrl,
                    money,
                    subscription: await this.subscriptionText(tenantId, orderToken, money),
                }).catch((err: unknown) => this.logger.warn(`Tienda ${shop.id}: no salió el correo del pedido ${result.number}: ${String(err)}`));
            }
            return { order_token: orderToken, number: result.number, cart: result.cart, payment_method: method, whatsapp_path: null, pay_url: payUrl };
        }
        if (method === 'online') {
            if (config.checkout.send_confirmation) {
                void this.sendConfirmation(s, {
                    kind: 'awaiting',
                    number: result.number,
                    customer: c,
                    answers: result.answerTexts,
                    lines: result.lines,
                    totals: { subtotal: result.cart.subtotal, shipping: result.cart.shipping, total: result.cart.total, discount: result.cart.discount, coupon: result.cart.coupon?.code ?? '' },
                    delivery: deliveryLabel,
                    method,
                    orderUrl,
                    money,
                    holdMinutes: config.payments.online.hold_minutes,
                }).catch((err: unknown) => this.logger.warn(`Tienda ${shop.id}: no salió el correo del pedido ${result.number}: ${String(err)}`));
            }
            return { order_token: orderToken, number: result.number, cart: result.cart, payment_method: method, whatsapp_path: null, pay_url: payUrl };
        }
        const notifyIds = this.notifyIds(config, shop);
        const hasDownloads = result.lines.some((l) => (l.files?.length ?? 0) > 0);
        this.notify?.emit({
            type: 'shop',
            tenantId,
            listId: result.orderListId,
            recordId: result.recordId,
            userIds: notifyIds,
            title: (method === 'free' ? `Pedido nuevo ${result.number} · sin costo` : `Pedido nuevo ${result.number} · ${money(result.cart.total)}`).slice(0, 200),
            body: `${c.name} · ${SHOP_PAYMENT_METHOD_LABELS[method]} · ${result.lines.length === 1 ? '1 producto' : `${result.lines.length} productos`}`,
        });
        // v0.1.416 — Sin costo: queda pagado y, si trae descargables, el correo
        // los lleva (es la entrega: sale aunque los correos de confirmación estén apagados).
        if (method === 'free' && (config.checkout.send_confirmation || hasDownloads)) {
            void this.sendPaidEmail(tenantId, orderToken).catch((err: unknown) => this.logger.warn(`Tienda ${shop.id}: no salió el correo del pedido ${result.number}: ${String(err)}`));
        } else if (method !== 'free' && config.checkout.send_confirmation) {
            void this.sendConfirmation(s, {
                kind: 'placed',
                number: result.number,
                customer: c,
                answers: result.answerTexts,
                lines: result.lines,
                totals: { subtotal: result.cart.subtotal, shipping: result.cart.shipping, total: result.cart.total, discount: result.cart.discount, coupon: result.cart.coupon?.code ?? '' },
                delivery: deliveryLabel,
                method,
                orderUrl,
                money,
                ...(hasDownloads ? { downloadsNote: 'Las descargas te llegan a este correo apenas confirmemos el pago.' } : {}),
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

    /** v0.1.417 — «$ 80.000 cada mes · 7 días gratis · 12 cobros» (sin consultar al proveedor). */
    private async subscriptionText(tenantId: number, orderToken: string, money: (n: number) => string): Promise<string | null> {
        const row = await this.findByToken(tenantId, orderToken);
        if (!row?.subscriptionId || !this.subscriptions) return null;
        const sub = await this.subscriptions.shopOrderSubscription(tenantId, row.subscriptionId, { sync: false }).catch(() => null);
        if (!sub) return null;
        const extras = subscriptionPlanExtras({ trial_days: sub.trial_days, cycles: sub.cycles });
        return `${money(sub.amount)} ${subscriptionFrequencyText(sub.frequency, sub.frequency_type)}${extras ? ` · ${extras}` : ''}`;
    }

    /**
     * v0.1.417 — Un evento de la suscripción de un pedido: al activarse (la
     * persona autorizó la tarjeta) el pedido queda pagado, el equipo se entera
     * y a quien se suscribió le llega «Tu suscripción quedó activa».
     */
    private async onSubscriptionEvent(tenantId: number, subscriptionId: number, events: readonly string[]): Promise<void> {
        if (!events.includes('activated') && !events.includes('charged')) return;
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: shopOrders.id, paymentStatus: shopOrders.paymentStatus })
                .from(shopOrders)
                .where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.subscriptionId, subscriptionId)))
                .limit(1),
        );
        if (!row || row.paymentStatus === 'pagado') return;
        await this.settlePaid(tenantId, row.id);
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
            /** v0.1.430 — Las respuestas de las preguntas propias, en palabras. */
            answers?: Array<{ label: string; text: string }>;
            lines: ShopOrderLineSnapshot[];
            totals: { subtotal: number; shipping: number; total: number; discount?: number; coupon?: string };
            delivery: string;
            method: ShopPaymentMethod;
            orderUrl: string;
            money: (n: number) => string;
            provider?: string | null;
            holdMinutes?: number;
            /** v0.1.416 — Los archivos para descargar (pedido pagado). */
            downloads?: Array<{ title: string; name: string; url: string }>;
            /** v0.1.416 — Cuándo llegan o hasta cuándo sirven las descargas. */
            downloadsNote?: string;
            /** v0.1.417 — Un pedido de suscripción: «$ 80.000 cada mes · 7 días gratis». */
            subscription?: string | null;
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
            lines: o.lines.map((l) => ({ text: shopLineText(l, this.numberFormatOf(s)), subtotal: o.money(l.subtotal) })),
            subtotal: o.money(o.totals.subtotal),
            discount: (o.totals.discount ?? 0) > 0 ? `-${o.money(o.totals.discount ?? 0)}` : null,
            couponCode: o.totals.coupon ?? '',
            shipping: o.totals.shipping > 0 ? o.money(o.totals.shipping) : null,
            total: o.money(o.totals.total),
            delivery: o.delivery,
            paymentLabel:
                o.method === 'free'
                    ? 'Sin costo'
                    : o.method === 'subscription'
                      ? paid
                          ? 'Suscripción activa · débito automático'
                          : 'Suscripción · débito automático'
                      : paid
                      ? o.method === 'online'
                          ? providerLabel
                              ? `Pagado en línea · ${providerLabel}`
                              : 'Pagado en línea'
                          : `Pagado · ${SHOP_PAYMENT_METHOD_LABELS[o.method]}`
                      : SHOP_PAYMENT_METHOD_LABELS[o.method],
            paymentInstructions:
                o.method === 'subscription'
                    ? paid
                        ? `Tu suscripción quedó activa${o.subscription ? `: ${o.subscription}` : ''}. Los cobros se hacen solos con la tarjeta que autorizaste; en la página de tu pedido ves cómo va.`
                        : `${o.subscription ? `Se cobra ${o.subscription}. ` : ''}Para activarla, autoriza el débito automático con tu tarjeta (el botón te lleva). Si cerraste esa página, el botón de este correo te deja terminar.`
                    : paid
                ? o.method === 'free'
                    ? 'Tu pedido no tiene costo.'
                    : o.lines.every((l) => (l.kind ?? 'physical') !== 'physical')
                      ? 'Recibimos el pago.'
                      : 'Recibimos el pago. Te avisamos cuando preparemos y enviemos tu pedido.'
                : o.kind === 'awaiting'
                  ? `Tienes ${holdText(o.holdMinutes ?? 30)} para pagarlo. Si no se paga a tiempo, el pedido se cancela solo y los productos vuelven a la tienda.`
                  : paymentInstructions(s.config, o.method),
            stage: o.method === 'subscription' && paid ? 'subscribed' : o.kind,
            subscription: o.method === 'subscription',
            downloads: o.downloads ?? [],
            downloadsNote: o.downloadsNote ?? null,
            orderUrl: o.orderUrl,
            answers: o.answers ?? [],
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
            lines: (row.lines as ShopOrderLineSnapshot[]).map((l) => ({ title: l.title, qty: l.qty, unit_price: l.unit_price, subtotal: l.subtotal, ...(l.unit ? { unit: l.unit } : {}) })),
            subtotal: row.subtotal,
            discount: row.discount,
            coupon_code: row.couponCode,
            shipping: row.shipping,
            total: row.total,
            currency: row.currency,
            delivery: delivery.name ?? '',
            customer: { name: customer.name ?? '', email: customer.email ?? '', address: customer.address ?? '', city: customer.city ?? '' },
            // El número nunca viaja: el botón pasa por la redirección del servidor.
            whatsapp_url: method === 'whatsapp' && pay === 'pendiente' && status !== 'cancelado' ? `/api/v1/public/s/${shopToken}/wa/${row.token}` : null,
            ...(await this.onlinePart(tenantId, row, status)),
            ...(await this.downloadsPart(tenantId, row, config, `/api/v1/public/s/${shopToken}`)),
            digital_only: (row.delivery as { digital?: unknown }).digital === true,
            ...(await this.subscriptionPart(tenantId, row, status)),
            // v0.1.418 — La compra cuenta cuando el pedido quedó hecho: si se paga en
            // línea (o es una suscripción), recién cuando se pagó; nunca cancelado.
            conversion:
                status === 'cancelado' || row.cancelledAt !== null || ((method === 'online' || method === 'subscription') && pay !== 'pagado')
                    ? null
                    : shopPurchaseConversion({
                          number: row.number,
                          total: row.total,
                          currency: row.currency,
                          shipping: row.shipping,
                          couponCode: row.couponCode,
                          lines: row.lines as ShopOrderLineSnapshot[],
                          customer: { email: customer.email, phone: customer.phone },
                          shareContact: config.conversion.share_contact,
                      }),
        };
    }

    /**
     * v0.1.417 — La suscripción de un pedido: cómo va, el link para terminar
     * de autorizarla (mientras falta) y qué pasó si el pedido se canceló.
     */
    private async subscriptionPart(tenantId: number, row: ShopOrderRow, status: ShopOrderStatus): Promise<Pick<PublicShopOrder, 'subscription'> & Partial<Pick<PublicShopOrder, 'payment_note'>>> {
        if (row.paymentMethod !== 'subscription') return {};
        const sub = row.subscriptionId && this.subscriptions ? await this.subscriptions.shopOrderSubscription(tenantId, row.subscriptionId, { sync: false }).catch(() => null) : null;
        if (!sub) return { subscription: null, payment_note: status === 'cancelado' ? 'El pedido se canceló.' : null };
        // Un pedido cancelado no ofrece terminar de autorizar.
        const out = status === 'cancelado' && sub.state === 'pending' ? { ...sub, url: null } : sub;
        return { subscription: out };
    }

    // ─────────────────────────── Descargas (v0.1.416) ───────────────────────────

    /** Los archivos del pedido (los del momento de la compra), uno por producto y archivo. */
    private downloadFiles(row: ShopOrderRow): Array<{ product_id: number; file_id: number; title: string }> {
        const out: Array<{ product_id: number; file_id: number; title: string }> = [];
        for (const l of row.lines as ShopOrderLineSnapshot[]) {
            for (const f of l.files ?? []) {
                if (!out.some((x) => x.product_id === l.product_id && x.file_id === f)) out.push({ product_id: l.product_id, file_id: f, title: l.title });
            }
        }
        return out;
    }

    /**
     * Si las descargas sirven ahora: pedido pagado, no cancelado y dentro de
     * los días de la tienda (contados desde el pago). Si no, por qué.
     */
    private downloadState(row: ShopOrderRow, config: ShopConfig, now = new Date()): { available: boolean; until: Date | null; note: string | null } {
        if (row.cancelledAt) return { available: false, until: null, note: 'El pedido se canceló: las descargas ya no están disponibles.' };
        if (row.paymentStatus !== 'pagado' || !row.paidAt) return { available: false, until: null, note: 'Las descargas aparecen apenas confirmemos el pago.' };
        const until = new Date(row.paidAt.getTime() + config.kinds.download_days * 86_400_000);
        if (until.getTime() <= now.getTime()) {
            return { available: false, until, note: 'El plazo para descargar terminó. Escríbenos si necesitas los archivos de nuevo.' };
        }
        return { available: true, until, note: null };
    }

    private async attachmentInfo(tenantId: number, ids: number[]): Promise<Map<number, { name: string; size: number }>> {
        if (ids.length === 0) return new Map();
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: attachments.id, name: attachments.filename, size: attachments.sizeBytes })
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), inArray(attachments.id, [...new Set(ids)]))),
        );
        return new Map(rows.map((r) => [r.id, { name: r.name, size: Number(r.size) }]));
    }

    private async downloadsPart(
        tenantId: number,
        row: ShopOrderRow,
        config: ShopConfig,
        prefix: string,
    ): Promise<Pick<PublicShopOrder, 'downloads' | 'downloads_note' | 'downloads_until'>> {
        const files = this.downloadFiles(row);
        if (files.length === 0) return { downloads: [], downloads_note: null, downloads_until: null };
        const info = await this.attachmentInfo(
            tenantId,
            files.map((f) => f.file_id),
        );
        const st = this.downloadState(row, config);
        const counts = (row.downloads ?? {}) as Record<string, number>;
        const max = config.kinds.max_downloads;
        const downloads: PublicShopDownload[] = [];
        for (const f of files) {
            const a = info.get(f.file_id);
            if (!a) continue; // el archivo se borró
            const used = Number(counts[`${f.product_id}:${f.file_id}`] ?? 0);
            const left = max === null || used < max;
            downloads.push({
                product_id: f.product_id,
                file_id: f.file_id,
                title: f.title,
                name: a.name,
                size: a.size,
                url: st.available && left ? `${prefix}/d/${row.token}/${f.product_id}/${f.file_id}` : null,
                used,
                max,
            });
        }
        return { downloads, downloads_note: st.note, downloads_until: st.until ? st.until.toISOString() : null };
    }

    /**
     * Bajar un archivo: suma una descarga (con el tope de la tienda, en un
     * UPDATE condicional: dos clics a la vez no pasan del tope) y devuelve la
     * dirección firmada de unos minutos. `limit` = ya usó todas; null = no
     * existe, no está pagado, se canceló o venció.
     */
    async download(
        tenantId: number,
        shopId: number,
        orderToken: string,
        productId: number,
        fileId: number,
        config: ShopConfig,
    ): Promise<{ url: string } | 'limit' | 'unavailable' | null> {
        const row = await this.findByToken(tenantId, orderToken);
        if (!row || row.shopId !== shopId) return null;
        if (!this.downloadFiles(row).some((f) => f.product_id === productId && f.file_id === fileId)) return null;
        if (!this.downloadState(row, config).available) return 'unavailable';
        const key = `${productId}:${fileId}`;
        const max = config.kinds.max_downloads;
        const count = sql`coalesce((${shopOrders.downloads}->>${key})::int, 0)`;
        const [upd] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(shopOrders)
                .set({ downloads: sql`jsonb_set(${shopOrders.downloads}, ${`{${key}}`}::text[], to_jsonb(${count} + 1))`, updatedAt: new Date() })
                .where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.id, row.id), ...(max !== null ? [sql`${count} < ${max}`] : [])))
                .returning({ id: shopOrders.id }),
        );
        if (!upd) return 'limit';
        return { url: `${this.files.signedUrl(tenantId, fileId, 300)}&dl=1` };
    }

    /**
     * v0.1.416 — El correo de un pedido pagado (o sin costo): el detalle y, si
     * trae descargables, los enlaces. Lo usan el pago en línea, «Marcar como
     * pagado», los pedidos sin costo y «Reenviar las descargas».
     */
    async sendPaidEmail(tenantId: number, orderToken: string): Promise<boolean> {
        const row = await this.findByToken(tenantId, orderToken);
        if (!row || row.paymentStatus !== 'pagado') return false;
        const ctx = await this.shopCtx(tenantId, row.shopId);
        const customer = row.customer as Record<string, string>;
        if (!ctx || !customer.email) return false;
        const base = await this.base(tenantId);
        const money = this.moneyFor(ctx, row.currency);
        const part = await this.downloadsPart(tenantId, row, ctx.config, `${base}/api/v1/public/s/${ctx.token}`);
        const link = row.paymentMethod === 'online' && row.paymentLinkId ? await this.linkRow(tenantId, row.paymentLinkId) : null;
        const max = ctx.config.kinds.max_downloads;
        await this.sendConfirmation(ctx, {
            kind: 'paid',
            number: row.number,
            customer: { name: customer.name ?? '', email: customer.email },
            answers: orderAnswers(row.customer),
            lines: row.lines as ShopOrderLineSnapshot[],
            totals: { subtotal: row.subtotal, shipping: row.shipping, total: row.total, discount: row.discount, coupon: row.couponCode },
            delivery: (row.delivery as { name?: string }).name ?? '',
            method: row.paymentMethod as ShopPaymentMethod,
            orderUrl: `${await this.shopPageUrl(tenantId, ctx.shop, ctx.token)}?pedido=${row.token}`,
            money,
            provider: link?.provider ?? null,
            ...(row.paymentMethod === 'subscription' ? { subscription: await this.subscriptionText(tenantId, row.token, money) } : {}),
            downloads: part.downloads.filter((d) => d.url).map((d) => ({ title: d.title, name: d.name, url: d.url! })),
            ...(part.downloads.length > 0
                ? {
                      downloadsNote: part.downloads_note
                          ? part.downloads_note
                          : `Los enlaces sirven ${ctx.config.kinds.download_days === 1 ? '1 día' : `${ctx.config.kinds.download_days} días`}${max !== null ? ` y hasta ${max === 1 ? '1 descarga' : `${max} descargas`} por archivo` : ''}. También los tienes en la página de tu pedido.`,
                  }
                : {}),
        });
        return true;
    }

    /** v0.1.416 — «Reenviar las descargas» desde la ficha del pedido. */
    async resendDownloads(tenantId: number, recordId: number): Promise<{ number: string; email: string }> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(shopOrders).where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.recordId, recordId))).limit(1),
        );
        if (!row) throw new NotFoundException({ code: 'shop_order_not_found', message: 'Ese registro no es un pedido de la tienda.', data: { status: 404 } });
        const ctx = await this.shopCtx(tenantId, row.shopId);
        if (!ctx) badRequest('shop_not_found', 'La tienda de este pedido ya no existe.');
        if (this.downloadFiles(row).length === 0) badRequest('shop_no_downloads', 'Este pedido no trae archivos para descargar.');
        const st = this.downloadState(row, ctx!.config);
        if (!st.available) badRequest('shop_downloads_unavailable', st.note ?? 'Las descargas de este pedido no están disponibles.');
        const email = (row.customer as Record<string, string>).email ?? '';
        if (!email || !this.mail) badRequest('shop_no_email', 'Este pedido no tiene un correo al que mandarlo.');
        await this.sendPaidEmail(tenantId, row.token);
        return { number: row.number, email };
    }

    // ─────────────────────────── «Mis pedidos» (v0.1.416) ───────────────────────────

    /** Cuántos pedidos tiene un correo en una tienda (para no mandar enlaces vacíos). */
    async hasOrders(tenantId: number, shopId: number, email: string): Promise<boolean> {
        const [hit] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: shopOrders.id })
                .from(shopOrders)
                .where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.shopId, shopId), sql`lower(${shopOrders.customer}->>'email') = ${email.toLowerCase()}`))
                .limit(1),
        );
        return !!hit;
    }

    /** Los pedidos de un correo en una tienda, los más nuevos primero (con el estado del registro, en una consulta). */
    async myOrders(tenantId: number, shopId: number, email: string): Promise<PublicShopMyOrders> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(shopOrders)
                .where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.shopId, shopId), sql`lower(${shopOrders.customer}->>'email') = ${email.toLowerCase()}`))
                .orderBy(sql`${shopOrders.createdAt} desc`)
                .limit(SHOP_MY_ORDERS_MAX),
        );
        const recIds = rows.filter((r) => r.recordId && r.statusFieldId).map((r) => r.recordId!);
        const recs = recIds.length
            ? await this.tenantDb.withTenant(tenantId, (tx) =>
                  tx
                      .select({ id: records.id, data: records.data })
                      .from(records)
                      .where(and(eq(records.tenantId, tenantId), inArray(records.id, recIds))),
              )
            : [];
        const dataOf = new Map(recs.map((r) => [r.id, r.data as Record<string, unknown>]));
        // v0.1.417 — Las suscripciones de esos pedidos (sin consultar al proveedor).
        const subIds = rows.map((r) => r.subscriptionId).filter((x): x is number => typeof x === 'number');
        const subs = subIds.length > 0 && this.subscriptions ? await this.subscriptions.shopOrderSubscriptionsBrief(tenantId, subIds).catch(() => new Map()) : new Map();
        return {
            email: email.toLowerCase(),
            orders: rows.map((r) => {
                let status: ShopOrderStatus = 'nuevo';
                if (r.cancelledAt) status = 'cancelado';
                else if (r.recordId && r.statusFieldId) {
                    const v = dataOf.get(r.recordId)?.[jsonbKeyForField(r.statusFieldId)];
                    if (typeof v === 'string' && v in SHOP_ORDER_STATUS_LABELS) status = v as ShopOrderStatus;
                }
                const pay = r.paymentStatus as ShopPaymentStatus;
                const lines = r.lines as ShopOrderLineSnapshot[];
                return {
                    number: r.number,
                    created_at: r.createdAt.toISOString(),
                    status,
                    status_label: SHOP_ORDER_STATUS_LABELS[status],
                    payment_status: pay,
                    payment_status_label: SHOP_PAYMENT_STATUS_LABELS[pay] ?? pay,
                    total: r.total,
                    currency: r.currency,
                    // v0.1.429 — Una línea con unidad (3 horas, 1,5 kg) cuenta como un producto.
                    items: lines.reduce((n, l) => n + (l.unit || !Number.isInteger(l.qty) ? 1 : l.qty), 0),
                    downloads: this.downloadFiles(r).length,
                    subscription: (() => {
                        const sb = r.subscriptionId ? subs.get(r.subscriptionId) : undefined;
                        if (!sb) return r.paymentMethod === 'subscription' ? 'Suscripción' : null;
                        const freq = subscriptionFrequencyText(sb.frequency, sb.frequency_type);
                        return `Suscripción ${freq} · ${SUBSCRIPTION_STATUS_OPTIONS[sb.status as keyof typeof SUBSCRIPTION_STATUS_OPTIONS]?.label ?? sb.status}`;
                    })(),
                    order_token: r.token,
                };
            }),
        };
    }

    /** v0.1.416 — Manda el enlace de «Mis pedidos» al correo (con la marca de la empresa). */
    async sendMyOrdersLink(s: ShopCtx, email: string, url: string, days: number): Promise<void> {
        if (!this.mail) return;
        const brand = await this.emailBrand(s);
        const seller = s.config.seller;
        const m = shopMyOrdersEmail({
            brand,
            shopName: s.config.texts.title || s.shop.name,
            url,
            days,
            sellerLine: [seller.legal_name, seller.document ? `NIT/C.C. ${seller.document}` : '', seller.email, seller.phone].filter(Boolean).join(' · '),
        });
        await this.mail.enqueue({
            tenantId: s.tenantId,
            to: email,
            subject: m.subject,
            html: m.html,
            text: m.text,
            fromName: senderName(brand.name),
            fromNameSoft: true,
            ...(seller.email ? { replyTo: seller.email } : {}),
        });
    }

    /**
     * Agrega «Sin costo» (v0.1.416) o «Suscripción» (v0.1.417) a la columna del
     * método de pago (las tiendas de antes no las traían).
     */
    private methodOptionReady = new Set<string>();
    private async ensureMethodOption(tenantId: number, config: ShopConfig, method: 'free' | 'subscription'): Promise<void> {
        const listId = config.orders.list_id;
        const fid = config.orders.fields.payment_method;
        if (!listId || typeof fid !== 'number') return;
        const key = `${tenantId}:${fid}:${method}`;
        if (this.methodOptionReady.has(key)) return;
        const field = (await this.fields.listByListId(tenantId, listId)).find((f) => f.id === fid);
        if (!field || field.type !== 'select') return;
        const opts = (field.config as { options?: Array<{ value?: unknown }> }).options ?? [];
        if (!opts.some((op) => op.value === method)) {
            await this.fields.appendOption(tenantId, String(listId), String(fid), {
                value: method,
                label: SHOP_PAYMENT_METHOD_LABELS[method],
                color: method === 'free' ? '#0d9488' : '#db2777',
            });
        }
        this.methodOptionReady.add(key);
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
            const [shop] = row.shopId ? await tx.select({ id: shops.id, name: shops.name, token: shops.token, customDomain: shops.customDomain }).from(shops).where(and(eq(shops.tenantId, tenantId), eq(shops.id, row.shopId))).limit(1) : [];
            return { row, shop: shop ?? null };
        });
        if (!res) return null;
        const { row, shop } = res;
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
            public_url: shop ? `${await this.shopPageUrl(tenantId, shop, shop.token)}?pedido=${row.token}` : null,
            created_at: row.createdAt.toISOString(),
            ...(await this.panelOnline(tenantId, row)),
            ...(await this.panelDownloads(tenantId, row)),
            origin: panelOrigin(row.origin),
        };
    }

    /** v0.1.416 — Las descargas del pedido en la ficha (cuántas, hasta cuándo, si se puede reenviar). */
    private async panelDownloads(tenantId: number, row: ShopOrderRow): Promise<Pick<ShopOrderPanelDto, 'downloads' | 'can_resend'>> {
        const files = this.downloadFiles(row);
        if (files.length === 0) return { downloads: null, can_resend: false };
        const ctx = await this.shopCtx(tenantId, row.shopId);
        const config = ctx?.config ?? readShopConfig({});
        const st = this.downloadState(row, config);
        const used = Object.values((row.downloads ?? {}) as Record<string, number>).reduce((n, v) => n + (Number(v) || 0), 0);
        return {
            downloads: { files: files.length, used, max: config.kinds.max_downloads, until: st.until ? st.until.toISOString() : null },
            can_resend: st.available && !!(row.customer as Record<string, string>).email && !!ctx,
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
            // v0.1.417 — Una suscripción queda pagada sola cuando se autoriza el débito.
            if (row.paymentMethod === 'subscription') badRequest('shop_subscription_paid', 'Este pedido es una suscripción: queda pagado solo cuando el cliente autoriza el débito automático.');
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
        // v0.1.416 — Con descargables, marcar pagado es entregar: sale el correo con los enlaces.
        if (out.changed && (out.row.lines as ShopOrderLineSnapshot[]).some((l) => (l.files?.length ?? 0) > 0)) {
            void this.sendPaidEmail(tenantId, out.row.token).catch((err: unknown) => this.logger.warn(`Tienda: no salió el correo de las descargas de ${out.row.number}: ${String(err)}`));
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

    /** v0.1.429 — Los separadores de la empresa (para escribir cantidades: «1,5 kg»). */
    private numberFormatOf(ctx: ShopCtx): TenantFormat['number_format'] {
        const fmt = tenantFormatSchema.safeParse(ctx.tenantSettings.format ?? {});
        return fmt.success ? fmt.data.number_format : 'dot_comma';
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
        // v0.1.417 — Suscripción: se pregunta al proveedor y, si ya se activó, el
        // aviso de la suscripción deja el pedido pagado en el acto.
        if (row && row.shopId === shopId && row.paymentMethod === 'subscription' && row.paymentStatus === 'pendiente' && row.subscriptionId && this.subscriptions) {
            await this.subscriptions.shopOrderSubscription(tenantId, row.subscriptionId, { returning: true });
            return;
        }
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
        const isSub = out.row.paymentMethod === 'subscription';
        if (out.outcome === 'late' && isSub) {
            this.notify?.emit({
                type: 'shop',
                tenantId,
                listId: orderList,
                recordId,
                userIds: this.notifyIds(ctx.config, ctx.shop),
                title: `Se activó la suscripción de ${out.row.number}, pero el pedido estaba cancelado`.slice(0, 200),
                body: `${customer.name ?? 'El cliente'} autorizó el débito automático. Si no la vas a atender, cancélala desde la ficha del pedido (sección Suscripción).`,
            });
            return out.outcome;
        }
        if (isSub) {
            const text = await this.subscriptionText(tenantId, out.row.token, money);
            this.notify?.emit({
                type: 'shop',
                tenantId,
                listId: orderList,
                recordId,
                userIds: this.notifyIds(ctx.config, ctx.shop),
                title: `Suscripción nueva ${out.row.number} · ${text ?? money(out.row.total)}`.slice(0, 200),
                body: `${customer.name ?? ''} · autorizó el débito automático · ${(out.row.lines as ShopOrderLineSnapshot[])[0]?.title ?? ''}`.slice(0, 300),
            });
            if (ctx.config.checkout.send_confirmation && customer.email) {
                void this.sendPaidEmail(tenantId, out.row.token).catch((err: unknown) => this.logger.warn(`Tienda ${ctx.shop.id}: no salió el correo de la suscripción ${out.row.number}: ${String(err)}`));
            }
            return out.outcome;
        }
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
        const withDownloads = (out.row.lines as ShopOrderLineSnapshot[]).some((l) => (l.files?.length ?? 0) > 0);
        if ((ctx.config.checkout.send_confirmation || withDownloads) && customer.email) {
            void this.sendPaidEmail(tenantId, out.row.token).catch((err: unknown) => this.logger.warn(`Tienda ${ctx.shop.id}: no salió el correo del pago ${out.row.number}: ${String(err)}`));
        }
        return out.outcome;
    }

    /**
     * v0.1.414 — Lo que se puede comprar de las filas pedidas: un producto sin
     * variantes, o una variante (subtarea) de un producto que se vende. Un
     * producto CON variantes no se compra directamente (se elige una).
     */
    private async purchasableRows(
        tx: Tx,
        tenantId: number,
        listId: number,
        rows: PurchasableRow[],
        rf: ResolvedCatalog,
        attrs: Field[] | null,
        opts: { subscriptions?: boolean } = {},
    ): Promise<ReturnType<typeof purchasablesFromRows>> {
        const parents = new Map<number, PurchasableRow>();
        const withVariants = new Set<number>();
        if (attrs !== null) {
            const parentIds = [...new Set(rows.map((r) => r.parentId).filter((x): x is number => x !== null))];
            if (parentIds.length > 0) {
                const ps = await tx
                    .select({ id: records.id, data: records.data, createdAt: records.createdAt, parentId: records.parentId })
                    .from(records)
                    .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), inArray(records.id, parentIds), isNull(records.deletedAt), isNull(records.parentId)));
                for (const p of ps) parents.set(p.id, { ...p, data: p.data as Record<string, unknown> });
            }
            const topIds = rows.filter((r) => r.parentId === null).map((r) => r.id);
            if (topIds.length > 0) {
                const kids = await tx
                    .selectDistinct({ parentId: records.parentId })
                    .from(records)
                    .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), inArray(records.parentId, topIds), isNull(records.deletedAt)));
                for (const k of kids) if (k.parentId !== null) withVariants.add(k.parentId);
            }
        }
        return purchasablesFromRows(
            rows.map((r) => ({ ...r, data: r.data as Record<string, unknown> })),
            parents,
            withVariants,
            rf,
            attrs,
            opts,
        );
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
            const next = { ...data, [key]: Math.max(0, roundShopQty(cur + sign * qty)) };
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

/**
 * v0.1.418 — Lo que se guarda de dónde vino el pedido: la página, el sitio
 * anterior, la clave del origen (la misma de las estadísticas) y la campaña
 * del anuncio, limpia. Nada de la persona.
 */
export function shopOrderOrigin(raw: PublicShopOrderInput['origin']): Record<string, unknown> {
    const src = typeof raw?.src === 'string' && SHOP_STAT_SOURCE_RE.test(raw.src) ? raw.src : 'd';
    const attribution = cleanAttribution(raw?.attribution ?? {});
    return {
        page: raw?.page?.slice(0, 500) ?? null,
        referrer: raw?.referrer?.slice(0, 500) ?? null,
        src,
        ...(Object.keys(attribution).length > 0 ? { attribution } : {}),
    };
}

/** v0.1.418 — De dónde llegó un pedido, para la ficha (null = de antes de esta versión). */
export function panelOrigin(raw: unknown): ShopOrderPanelDto['origin'] {
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    if (typeof o.src !== 'string') return null;
    const a = o.attribution && typeof o.attribution === 'object' ? (o.attribution as Record<string, unknown>) : {};
    const campaign = typeof a.utm_campaign === 'string' && a.utm_campaign.trim() ? a.utm_campaign.slice(0, 200) : null;
    const ad = typeof a.gclid === 'string' || typeof a.gbraid === 'string' || typeof a.wbraid === 'string' ? 'google' : typeof a.fbclid === 'string' ? 'meta' : null;
    const page = typeof a.page_url === 'string' && /^https?:\/\//.test(a.page_url) ? a.page_url.slice(0, 500) : null;
    return { source: formStatSourceLabel(SHOP_STAT_SOURCE_RE.test(o.src) ? o.src : 'd'), campaign, ad, page };
}
