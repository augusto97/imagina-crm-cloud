import { BULK_EDIT_MAX_OPERATIONS, BULK_OPS, bulkOperationSchema, fieldSlugSchema, type BulkOperation, type Field } from '@imagina-base/shared';
import { z } from 'zod';
import { AiToolError } from './registry';
import { filterRuleSpec, rulesToFilterTree, type FilterRuleSpec } from './structure-tools';

/**
 * v0.1.222 — Las operaciones de la edición masiva en el vocabulario del
 * modelo: por SLUG de campo (no por id) y con las opciones de un select por
 * value o etiqueta. `translateBulkOps` las lleva a `BulkOperation` (la forma
 * que valida y ejecuta el backend) — lo usan la herramienta
 * `propose_bulk_edit` y la acción `bulk_edit` de las automatizaciones que
 * arma el asistente.
 */
const operandSpec = z
    .object({ field: fieldSlugSchema.optional(), value: z.number().optional() })
    .describe('Una columna (field) o un número (value)');

export const bulkOpSpec = z
    .object({
        field: fieldSlugSchema.describe('La columna que se cambia'),
        op: z.enum(BULK_OPS).describe(
            'set (poner value) | clear | add/subtract (amount) | multiply (factor) | divide (divisor) | percent (percent: +10 sube, -15 baja) | ' +
                'round (multiple, mode nearest|up|down, adjust: 1000 up -100 = terminar en 900) | calc (left op right; operator + - * /) | ' +
                'copy (source_field) | prepend/append (text) | replace (find, replace) | text_case (mode upper|lower|title|sentence) | trim | ' +
                'add_options/remove_options (values) | toggle | shift_date (amount, unit minutes|hours|days|weeks|months|years) | today | add_links/remove_links (ids)',
        ),
        value: z.unknown().optional(),
        amount: z.number().optional(),
        factor: z.number().optional(),
        divisor: z.number().optional(),
        percent: z.number().optional(),
        multiple: z.number().optional(),
        mode: z.string().optional(),
        adjust: z.number().optional(),
        unit: z.string().optional(),
        text: z.string().optional(),
        find: z.string().optional(),
        replace: z.string().optional(),
        case_sensitive: z.boolean().optional(),
        values: z.array(z.string()).optional().describe('Opciones por value o etiqueta'),
        ids: z.array(z.number().int().positive()).optional(),
        source_field: fieldSlugSchema.optional(),
        left: operandSpec.optional(),
        right: operandSpec.optional(),
        operator: z.enum(['+', '-', '*', '/']).optional(),
    })
    .describe('Un cambio. Se aplican en orden y cada uno parte del valor de CADA registro.');
export type BulkOpSpec = z.infer<typeof bulkOpSpec>;

export const bulkOpsSpec = z.array(bulkOpSpec).min(1).max(BULK_EDIT_MAX_OPERATIONS);

type Opt = { value: string; label: string };
function optionValue(f: Field, raw: string): string {
    const opts = (f.config as { options?: Opt[] }).options ?? [];
    if (opts.some((o) => o.value === raw)) return raw;
    const byLabel = opts.find((o) => typeof o.label === 'string' && o.label.trim().toLowerCase() === raw.trim().toLowerCase());
    return byLabel ? byLabel.value : raw;
}

export function translateBulkOps(specs: BulkOpSpec[], bySlug: ReadonlyMap<string, Field>, listName: string): BulkOperation[] {
    const need = (slug: string, what: string): Field => {
        const f = bySlug.get(slug);
        if (!f) throw new AiToolError(`${what} «${slug}» no existe en «${listName}». Campos: ${[...bySlug.keys()].join(', ')}.`);
        return f;
    };
    return specs.map((spec, i) => {
        const f = need(spec.field, `Cambio ${i + 1}: la columna`);
        const { field: _field, source_field, left, right, values, value, ...rest } = spec;
        const operand = (o: { field?: string; value?: number } | undefined, side: string) => {
            if (o?.field) return { field_id: need(o.field, `Cambio ${i + 1}: la columna del cálculo`).id };
            if (typeof o?.value === 'number') return { value: o.value };
            throw new AiToolError(`Cambio ${i + 1}: falta el lado ${side} del cálculo (field o value).`);
        };
        const raw: Record<string, unknown> = { ...rest, field_id: f.id };
        if (source_field) raw.source_field_id = need(source_field, `Cambio ${i + 1}: la columna de origen`).id;
        if (spec.op === 'calc') {
            raw.left = operand(left, 'izquierdo');
            raw.right = operand(right, 'derecho');
        }
        if (values) raw.values = values.map((v) => optionValue(f, v));
        if (spec.op === 'set') {
            raw.value =
                (f.type === 'select' || f.type === 'multi_select') && typeof value === 'string'
                    ? optionValue(f, value)
                    : f.type === 'multi_select' && Array.isArray(value)
                      ? value.map((v) => (typeof v === 'string' ? optionValue(f, v) : v))
                      : value;
        }
        const parsed = bulkOperationSchema.safeParse(raw);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            throw new AiToolError(`Cambio ${i + 1} (${spec.op} sobre «${spec.field}»): ${issue?.path.join('.') || 'config'} — ${issue?.message ?? 'inválido'}.`);
        }
        return parsed.data;
    });
}

/**
 * La acción `bulk_edit` que arma el asistente viene con `filters` y
 * `operations` por slug: se traducen IN PLACE a `filter_tree` y operaciones
 * por id (también dentro de las ramas de un `if_else`).
 */
export function translateBulkEditActions(actions: unknown[], fields: Field[], listName: string): void {
    const bySlug = new Map(fields.map((f) => [f.slug, f]));
    for (const a of actions) {
        if (!a || typeof a !== 'object') continue;
        const act = a as { type?: unknown; config?: Record<string, unknown> };
        const cfg = act.config ?? {};
        if (act.type === 'if_else') {
            translateBulkEditActions(Array.isArray(cfg.then_actions) ? cfg.then_actions : [], fields, listName);
            translateBulkEditActions(Array.isArray(cfg.else_actions) ? cfg.else_actions : [], fields, listName);
            continue;
        }
        if (act.type !== 'bulk_edit') continue;
        // Ya en ids (una automatización existente que el modelo copió tal cual): se deja.
        if (z.array(bulkOperationSchema).min(1).safeParse(cfg.operations).success) continue;
        const ops = bulkOpsSpec.safeParse(cfg.operations);
        if (!ops.success) {
            throw new AiToolError(`«Editar en lote»: operations tiene que ser una lista de 1 a ${BULK_EDIT_MAX_OPERATIONS} cambios por slug (${ops.error.issues[0]?.message ?? ''}).`);
        }
        const next: Record<string, unknown> = { operations: translateBulkOps(ops.data, bySlug, listName) };
        const rules = z.array(filterRuleSpec).max(20).safeParse(cfg.filters ?? []);
        if (!rules.success) throw new AiToolError('«Editar en lote»: filters está mal armado.');
        if (rules.data.length > 0) {
            next.filter_tree = rulesToFilterTree(
                rules.data.map((r: FilterRuleSpec) => {
                    const f = bySlug.get(r.field);
                    if (!f) throw new AiToolError(`«Editar en lote»: el campo del filtro «${r.field}» no existe en «${listName}».`);
                    return { ...r, value: typeof r.value === 'string' ? optionValue(f, r.value) : r.value };
                }),
                (slug) => bySlug.get(slug)!.id,
            );
        } else if (cfg.filter_tree) {
            next.filter_tree = cfg.filter_tree;
        } else if (cfg.all_records !== true) {
            throw new AiToolError('«Editar en lote» sin filters editaría TODA la lista cada vez que corra: pasa filters, o all_records: true si la persona lo pidió así.');
        }
        act.config = next;
    }
}
