import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import {
    SHOP_MAX_PUBLIC_PRODUCTS,
    jsonbKeyForField,
    missingVariantCombos,
    readShopConfig,
    type Field,
    type GenerateShopVariantsInput,
    type GenerateShopVariantsResult,
    type ShopProductVariantsDto,
    type ShopVariantAttributeDto,
    type ShopVariantProductDto,
} from '@imagina-base/shared';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import { lists, records } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { productFromRow, resolveCatalogFields, resolveVariantAttributes, variantAttributeValue, variantLabel, type ResolvedCatalog } from './shop-catalog';
import { ShopService } from './shop.service';

/** Variantes que se leen de un producto en el editor. */
const MAX_VARIANT_ROWS = 200;

function badRequest(code: string, message: string): never {
    throw new BadRequestException({ code, message, data: { status: 400 } });
}

function fold(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
}

function num(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
}

/** «Rojo oscuro» → «ROJO-OSCURO» para la referencia de la variante. */
function skuPart(v: string): string {
    return fold(v)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 20);
}

function selectOptions(field: Field): Array<{ value: string; label: string }> {
    const opts = (field.config as { options?: unknown }).options;
    if (!Array.isArray(opts)) return [];
    const out: Array<{ value: string; label: string }> = [];
    for (const o of opts) {
        if (!o || typeof o !== 'object') continue;
        const value = (o as { value?: unknown }).value;
        const label = (o as { label?: unknown }).label;
        if (typeof value !== 'string') continue;
        out.push({ value, label: typeof label === 'string' && label.trim() ? label.trim() : value });
    }
    return out;
}

/**
 * v0.1.414 — El generador de variantes del editor de la tienda. Una variante
 * es una SUBTAREA del producto en la lista del catálogo: se crea con el alta
 * de siempre (`RecordsService.create`), así respeta los permisos, el límite
 * del plan, la actividad y las automatizaciones.
 */
@Injectable()
export class ShopVariantsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly shops: ShopService,
    ) {}

    private async catalog(tenantId: number, shopId: number): Promise<{ listId: number; fields: Field[]; rf: ResolvedCatalog }> {
        const row = await this.shops.row(tenantId, shopId);
        const config = readShopConfig(row.config);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [list] = await tx
                .select({ settings: lists.settings, deletedAt: lists.deletedAt })
                .from(lists)
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, row.listId)))
                .limit(1);
            if (!list || list.deletedAt !== null) throw new NotFoundException({ code: 'shop_list_gone', message: 'La lista de productos ya no existe.', data: { status: 404 } });
            const fields = await this.fields.listByListIdWithinTx(tx, tenantId, row.listId);
            return { listId: row.listId, fields, rf: resolveCatalogFields(fields, config.catalog, list.settings) };
        });
    }

    /** Los productos (registros de primer nivel) para elegir uno, con cuántas variantes tienen. */
    async products(tenantId: number, shopId: number, q: string): Promise<ShopVariantProductDto[]> {
        const { listId, rf } = await this.catalog(tenantId, shopId);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx
                .select({ id: records.id, data: records.data, createdAt: records.createdAt })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), isNull(records.deletedAt), isNull(records.parentId)))
                .orderBy(asc(records.id))
                .limit(SHOP_MAX_PUBLIC_PRODUCTS);
            const needle = fold(q);
            const picked = rows
                .map((r) => productFromRow({ id: r.id, data: r.data as Record<string, unknown>, createdAt: r.createdAt }, rf).product)
                .filter((p) => !needle || needle.split(/\s+/).every((w) => fold(`${p.title} ${p.sku}`).includes(w)))
                .slice(0, 40);
            const counts = new Map<number, number>();
            if (picked.length > 0) {
                const rowsN = await tx
                    .select({ parentId: records.parentId, n: count() })
                    .from(records)
                    .where(
                        and(
                            eq(records.tenantId, tenantId),
                            eq(records.listId, listId),
                            isNull(records.deletedAt),
                            inArray(
                                records.parentId,
                                picked.map((p) => p.id),
                            ),
                        ),
                    )
                    .groupBy(records.parentId);
                for (const r of rowsN) if (r.parentId !== null) counts.set(r.parentId, Number(r.n));
            }
            return picked.map((p) => ({ id: p.id, title: p.title, price: p.price, variants: counts.get(p.id) ?? 0 }));
        });
    }

    /** Un producto con sus variantes, leídas con los atributos que se están editando. */
    async forProduct(tenantId: number, shopId: number, productId: number, attributeIds: number[]): Promise<ShopProductVariantsDto> {
        const { listId, fields, rf } = await this.catalog(tenantId, shopId);
        const attrs = resolveVariantAttributes(fields, attributeIds);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [parent] = await tx
                .select({ id: records.id, data: records.data, createdAt: records.createdAt })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), eq(records.id, productId), isNull(records.deletedAt), isNull(records.parentId)))
                .limit(1);
            if (!parent) throw new NotFoundException({ code: 'shop_product_not_found', message: 'Ese producto ya no está en la lista.', data: { status: 404 } });
            const kids = await tx
                .select({ id: records.id, data: records.data, createdAt: records.createdAt })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), eq(records.parentId, productId), isNull(records.deletedAt)))
                .orderBy(asc(records.id))
                .limit(MAX_VARIANT_ROWS);
            const p = productFromRow({ id: parent.id, data: parent.data as Record<string, unknown>, createdAt: parent.createdAt }, rf).product;
            const variants = kids.map((k, i) => {
                const d = k.data as Record<string, unknown>;
                const row = { id: k.id, data: d, createdAt: k.createdAt };
                const price = rf.price ? num(d[jsonbKeyForField(rf.price.id)]) : null;
                const stock = rf.stock ? num(d[jsonbKeyForField(rf.stock.id)]) : null;
                return {
                    id: k.id,
                    label: variantLabel(row, rf, attrs, i),
                    values: attrs.map((a) => variantAttributeValue(a, d[jsonbKeyForField(a.id)])),
                    price,
                    stock: stock === null ? null : Math.max(0, Math.floor(stock)),
                    sku: rf.sku ? String(d[jsonbKeyForField(rf.sku.id)] ?? '').slice(0, 80) : '',
                };
            });
            const attributes: ShopVariantAttributeDto[] = attrs.map((a, i) => ({
                field_id: a.id,
                label: a.label,
                type: a.type === 'select' ? 'select' : 'text',
                values:
                    a.type === 'select'
                        ? selectOptions(a).map((o) => o.label)
                        : [...new Set(variants.map((v) => v.values[i] ?? '').filter(Boolean))],
            }));
            return { product: { id: p.id, title: p.title, price: p.price, stock: p.stock, sku: p.sku }, attributes, variants };
        });
    }

    /**
     * Crea las combinaciones que faltan (Talla × Color) como subtareas del
     * producto. Los valores de un atributo de selección tienen que ser
     * opciones del campo; los de texto, lo que se escriba.
     */
    async generate(tenantId: number, actor: Actor, shopId: number, productId: number, input: GenerateShopVariantsInput): Promise<GenerateShopVariantsResult> {
        const { listId, fields, rf } = await this.catalog(tenantId, shopId);
        if (input.values.length !== input.attributes.length) badRequest('invalid_shop_variants', 'Elige los valores de cada atributo.');
        const attrs = resolveVariantAttributes(fields, input.attributes);
        if (attrs.length !== input.attributes.length) badRequest('invalid_shop_variants', 'Uno de los atributos ya no es un campo de selección o de texto de la lista.');
        const current = await this.forProduct(tenantId, shopId, productId, input.attributes);
        // Cada valor de un atributo de selección, a la opción que le corresponde;
        // uno de texto que ya existe (sin tildes ni mayúsculas) se escribe como ya está.
        const toStored: Array<Map<string, string>> = attrs.map((a, i) => {
            const m = new Map<string, string>();
            if (a.type !== 'select') {
                const known = current.variants.map((v) => v.values[i] ?? '').filter(Boolean);
                for (const v of input.values[i]!) m.set(fold(v), known.find((k) => fold(k) === fold(v)) ?? v.trim().slice(0, 80));
                return m;
            }
            const opts = selectOptions(a);
            for (const v of input.values[i]!) {
                const o = opts.find((x) => fold(x.label) === fold(v) || fold(x.value) === fold(v));
                if (!o) badRequest('invalid_shop_variants', `«${v}» no es una opción de «${a.label}»: agrégala al campo primero.`);
                m.set(fold(v), o!.value);
            }
            return m;
        });
        const plan = missingVariantCombos(
            input.values.map((vals, i) =>
                vals.map((v) => {
                    // Se compara por la etiqueta, como la lee una persona.
                    if (attrs[i]!.type !== 'select') return toStored[i]!.get(fold(v)) ?? v;
                    const stored = toStored[i]!.get(fold(v));
                    return selectOptions(attrs[i]!).find((o) => o.value === stored)?.label ?? v;
                }),
            ),
            current.variants.map((v) => v.values),
        );
        const parentSku = current.product.sku.trim();
        let created = 0;
        let error: string | null = null;
        for (const combo of plan.combos) {
            const data: Record<string, unknown> = {};
            combo.forEach((label, i) => {
                const a = attrs[i]!;
                data[jsonbKeyForField(a.id)] = toStored[i]!.get(fold(label)) ?? (a.type === 'select' ? selectOptions(a).find((o) => o.label === label)?.value : label);
            });
            const label = combo.join(' / ');
            if (rf.name && !attrs.some((a) => a.id === rf.name!.id)) data[jsonbKeyForField(rf.name.id)] = label.slice(0, 200);
            if (rf.price && input.price !== null && input.price !== undefined) data[jsonbKeyForField(rf.price.id)] = input.price;
            if (rf.stock && input.stock !== null && input.stock !== undefined) data[jsonbKeyForField(rf.stock.id)] = input.stock;
            if (rf.sku && rf.sku.type === 'text' && parentSku) data[jsonbKeyForField(rf.sku.id)] = `${parentSku}-${combo.map(skuPart).filter(Boolean).join('-')}`.slice(0, 80);
            try {
                await this.records.create(tenantId, actor, String(listId), { data, parent_id: productId });
                created++;
            } catch (err) {
                const body = err instanceof HttpException ? (err.getResponse() as { message?: unknown }) : null;
                error = typeof body?.message === 'string' ? body.message : 'No se pudieron crear todas las variantes.';
                break;
            }
        }
        return { created, existing: plan.existing, truncated: plan.truncated, error };
    }
}
