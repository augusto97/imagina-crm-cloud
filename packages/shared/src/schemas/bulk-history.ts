import { z } from 'zod';
import { idSchema } from './common';

/**
 * Historial de ediciones masivas y DESHACER (v0.1.218).
 *
 * Cada edición masiva (de la app o de la tienda) queda registrada con el
 * antes y el después de lo que cambió en cada fila. Deshacer vuelve cada fila
 * a su antes — salvo las que alguien volvió a tocar después (CONFLICTO): esas
 * se muestran y sólo se pisan si la persona lo pide explícitamente.
 */

/** Tanda de filas que se revierten por pedido (el cliente muestra el avance). */
export const BULK_REVERT_CHUNK = 100;
/** Cuántos días se conserva una edición en el historial. */
export const BULK_HISTORY_DAYS = 30;

export const BULK_EDIT_KINDS = ['records', 'store'] as const;
export type BulkEditKind = (typeof BULK_EDIT_KINDS)[number];

export interface BulkEditLog {
    id: number;
    list_id: number;
    kind: BulkEditKind;
    /** En criollo: «Precio: subir 10 %, redondear a 1.000 ↑ −100». */
    summary: string;
    user_id: number | null;
    user_name: string | null;
    created_at: string;
    /** Filas que cambió. */
    item_count: number;
    /** Filas ya vueltas atrás. */
    reverted_count: number;
    reverted_at: string | null;
    /** Si la persona puede deshacerla (propia, o con permiso de acciones masivas). */
    can_revert: boolean;
}

export const bulkRevertPreviewSchema = z.object({}).strict();

export const bulkRevertApplySchema = z
    .object({
        item_ids: z.array(idSchema).min(1).max(BULK_REVERT_CHUNK),
        /** Pisar también las filas que alguien volvió a tocar después. */
        force: z.boolean().default(false),
    })
    .strict();
export type BulkRevertApplyInput = z.infer<typeof bulkRevertApplySchema>;

export interface BulkRevertPreview {
    edit_id: number;
    /** Filas pendientes de revertir (las ya revertidas no cuentan). */
    total: number;
    /** Filas que vuelven limpias a su valor anterior. */
    item_ids: number[];
    /** Filas que alguien cambió después de la edición (se revierten sólo con `force`). */
    conflict_ids: number[];
    conflicts: Array<{ item_id: number; title: string; message: string }>;
    /** Filas cuyo registro/producto ya no existe. */
    missing: number;
    /** Un ejemplo de lo que vuelve atrás. */
    sample: Array<{ item_id: number; title: string; changes: Array<{ label: string; before: string; after: string }> }>;
}

export interface BulkRevertResult {
    reverted: number;
    /** Filas saltadas por conflicto (sin `force`). */
    conflicts: number;
    failed: Array<{ item_id: number; title: string; message: string }>;
}

// ── Resumen en criollo (para el historial) ───────────────────────────────

type SummaryOp = { op: string; field_id: number } & Record<string, unknown>;

function num(n: unknown): string {
    return typeof n === 'number' ? String(Number(n.toFixed(6))) : String(n ?? '');
}

function brief(v: unknown): string {
    if (v === null || v === undefined || v === '') return 'vacío';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (Array.isArray(v)) return v.map(String).join(', ');
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

/**
 * Una línea por operación, con el nombre de la columna: «Precio: subir 10 %
 * · Precio: redondear a 1000 ↑ (−100)». Es lo que la persona reconoce en el
 * historial para decidir qué deshacer.
 */
export function summarizeBulkOperations(ops: readonly SummaryOp[], labelOf: (fieldId: number) => string): string {
    const parts = ops.map((o) => {
        const label = labelOf(o.field_id);
        const operand = (x: unknown) =>
            x && typeof x === 'object' && 'field_id' in x ? `«${labelOf(Number((x as { field_id: unknown }).field_id))}»` : num((x as { value?: unknown })?.value);
        let what: string;
        switch (o.op) {
            case 'set': what = `poner ${brief(o.value)}`; break;
            case 'clear': what = 'vaciar'; break;
            case 'add': what = `sumar ${num(o.amount)}`; break;
            case 'subtract': what = `restar ${num(o.amount)}`; break;
            case 'multiply': what = `multiplicar por ${num(o.factor)}`; break;
            case 'divide': what = `dividir por ${num(o.divisor)}`; break;
            case 'percent': {
                const p = Number(o.percent);
                what = p >= 0 ? `subir ${num(p)} %` : `bajar ${num(-p)} %`;
                break;
            }
            case 'round': {
                const dir = o.mode === 'up' ? ' ↑' : o.mode === 'down' ? ' ↓' : '';
                const adj = Number(o.adjust) ? ` (${Number(o.adjust) > 0 ? '+' : '−'}${num(Math.abs(Number(o.adjust)))})` : '';
                what = `redondear a ${num(o.multiple)}${dir}${adj}`;
                break;
            }
            case 'calc': what = `= ${operand(o.left)} ${String(o.operator).replace('*', '×').replace('/', '÷')} ${operand(o.right)}`; break;
            case 'copy': what = `copiar de «${labelOf(Number(o.source_field_id))}»`; break;
            case 'prepend': what = `anteponer «${brief(o.text)}»`; break;
            case 'append': what = `agregar al final «${brief(o.text)}»`; break;
            case 'replace': what = `reemplazar «${brief(o.find)}» por «${brief(o.replace)}»`; break;
            case 'text_case': what = o.mode === 'upper' ? 'MAYÚSCULAS' : o.mode === 'lower' ? 'minúsculas' : 'Mayúscula inicial'; break;
            case 'trim': what = 'quitar espacios'; break;
            case 'add_options': what = `agregar ${brief(o.values)}`; break;
            case 'remove_options': what = `quitar ${brief(o.values)}`; break;
            case 'toggle': what = 'invertir'; break;
            case 'shift_date': {
                const units: Record<string, string> = { minutes: 'min', hours: 'h', days: 'días', weeks: 'semanas', months: 'meses', years: 'años' };
                const a = Number(o.amount);
                what = `correr ${a >= 0 ? '+' : '−'}${Math.abs(a)} ${units[String(o.unit)] ?? String(o.unit)}`;
                break;
            }
            case 'today': what = 'poner hoy'; break;
            case 'add_links': what = `vincular ${Array.isArray(o.ids) ? o.ids.length : 0}`; break;
            case 'remove_links': what = `desvincular ${Array.isArray(o.ids) ? o.ids.length : 0}`; break;
            default: what = o.op;
        }
        return `${label}: ${what}`;
    });
    return parts.join(' · ').slice(0, 500);
}

type StoreSummaryOp = { op: string } & Record<string, unknown>;

/** Lo mismo para la edición masiva de la tienda (v0.1.217). */
export function summarizeStoreBulkOperations(ops: readonly StoreSummaryOp[]): string {
    const change = (c: unknown): string => {
        const ch = (c ?? {}) as { kind?: string; amount?: number };
        const a = num(ch.amount);
        switch (ch.kind) {
            case 'set': return `poner ${a}`;
            case 'add': return `sumar ${a}`;
            case 'subtract': return `restar ${a}`;
            case 'percent': return Number(ch.amount) >= 0 ? `subir ${a} %` : `bajar ${num(-Number(ch.amount))} %`;
            case 'percent_off': return `${a} % de descuento`;
            case 'clear': return 'quitar';
            default: return String(ch.kind ?? '');
        }
    };
    const LABEL: Record<string, string> = {
        regular_price: 'Precio normal',
        sale_price: 'Precio rebajado',
        sale_dates: 'Rebaja programada',
        stock: 'Stock',
        manage_stock: 'Controla stock',
        stock_status: 'Estado del stock',
        backorders: 'Reservas',
        low_stock: 'Alerta de stock bajo',
        status: 'Publicación',
        catalog_visibility: 'Visibilidad',
        featured: 'Destacado',
        categories: 'Categorías',
        tags: 'Etiquetas',
        attribute: 'Atributo',
        weight: 'Peso',
        dimensions: 'Medidas',
        shipping_class: 'Clase de envío',
        tax_status: 'Impuesto',
        tax_class: 'Clase de impuesto',
        name: 'Nombre',
        meta: 'Campo',
    };
    const parts = ops.map((o) => {
        const label = LABEL[o.op] ?? o.op;
        switch (o.op) {
            case 'regular_price':
            case 'sale_price': return `${label}: ${change(o.change)}`;
            case 'stock': return `${label}: ${change({ kind: o.kind, amount: o.amount })}`;
            case 'categories':
            case 'tags': return `${label}: ${o.mode === 'add' ? 'agregar' : o.mode === 'remove' ? 'quitar' : 'reemplazar por'} ${brief(o.values)}`;
            case 'attribute': {
                const a = (o.attribute ?? {}) as { name?: string };
                return `${label} ${a.name ?? ''}: ${o.mode === 'remove' ? 'quitar' : brief(o.options)}`;
            }
            case 'name': return `${label}: ${o.kind === 'prepend' ? 'anteponer' : o.kind === 'append' ? 'agregar al final' : 'reemplazar'} «${brief(o.text)}»`;
            case 'meta': return `${label} ${String(o.key)}: ${brief(o.value)}`;
            case 'sale_dates': return `${label}: ${brief(o.from)} → ${brief(o.to)}`;
            case 'dimensions': return label;
            default: return `${label}: ${brief(o.value)}`;
        }
    });
    return parts.join(' · ').slice(0, 500);
}

// ── Comparación de valores (detección de conflictos al deshacer) ────────

function canonical(v: unknown): unknown {
    if (v === undefined) return null;
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = canonical((v as Record<string, unknown>)[k]);
        return out;
    }
    if (v === '') return null;
    return v;
}

/**
 * ¿Son el mismo valor guardado? Ignora el orden de las claves (JSONB las
 * reordena), trata vacío/ausente/null como iguales y, si `unordered`, compara
 * listas como conjuntos (vínculos de una relación).
 */
export function sameBulkValue(a: unknown, b: unknown, unordered = false): boolean {
    let ca = canonical(a);
    let cb = canonical(b);
    if (unordered && Array.isArray(ca) && Array.isArray(cb)) {
        ca = [...ca].map((x) => JSON.stringify(x)).sort();
        cb = [...cb].map((x) => JSON.stringify(x)).sort();
    }
    if (Array.isArray(ca) && ca.length === 0) ca = null;
    if (Array.isArray(cb) && cb.length === 0) cb = null;
    return JSON.stringify(ca) === JSON.stringify(cb);
}
