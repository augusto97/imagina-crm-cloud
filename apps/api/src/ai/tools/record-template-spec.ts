import {
    CHECKLIST_ITEM_TEXT_MAX,
    CHECKLIST_MAX_ITEMS,
    CHECKLIST_NAME_MAX,
    RECORD_TEMPLATE_MAX_CHECKLISTS,
    RECORD_TEMPLATE_MAX_SUBTASKS,
    RELATIVE_DATE_MAX_DAYS,
    coerceTextToFieldValue,
    describeRelativeDate,
    isTemplateValueType,
    jsonbKeyForField,
    markdownToRichDoc,
    richDocToMarkdown,
    type Field,
    type FieldType,
    type RecordTemplate,
    type RecordTemplateContent,
    type RelativeDate,
    type TemplatePerson,
    type TemplateValues,
} from '@imagina-base/shared';
import { z } from 'zod';
import { AiToolError } from './registry';

/**
 * C6 / A9 — Plantillas de registro en el VOCABULARIO del asistente: campos
 * por slug, fechas relativas y personas en un formato corto. Puro: arma el
 * contenido con ids y lo describe de vuelta (get_list_schema). La validación
 * fina (valores contra el tipo de cada campo, miembros del equipo) la hace
 * después el MISMO saneo que la interfaz (`RecordTemplatesService.validate`).
 */

const relDateSpec = z
    .object({
        days: z.number().int().min(-RELATIVE_DATE_MAX_DAYS).max(RELATIVE_DATE_MAX_DAYS).describe('Días a sumar (negativo = antes)'),
        from: z.string().max(63).optional().describe('Slug de un campo fecha de la lista; sin él, desde la creación del registro'),
        business_days: z.boolean().optional().describe('true = días hábiles (sin fines de semana ni festivos de Colombia)'),
        time: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
            .optional()
            .describe('Hora HH:MM (sólo campos fecha y hora)'),
    })
    .describe('Fecha relativa');

const personSpec = z
    .union([z.literal('creator'), z.number().int().positive(), z.object({ field: z.string().max(63) })])
    .describe('"creator" = quien crea el registro; un número = id de una persona del equipo (list_members); {field: slug} = la persona de un campo Persona del registro');

const valueSpec = z
    .unknown()
    .describe(
        'Valor fijo (como en propose_create_records), o {"date": {"days": 7, "from"?: slug, "business_days"?: true, "time"?: "09:00"}} para una fecha relativa, o {"person": "creator" | id | {"field": slug}} para una persona',
    );

const valuesSpec = z.record(valueSpec).describe('Mapa slug → valor de la plantilla');

const itemSpec = z.object({
    text: z.string().min(1).max(CHECKLIST_ITEM_TEXT_MAX),
    assignee: personSpec.optional(),
    due: relDateSpec.optional(),
});

export const recordTemplateSpec = z.object({
    list: z.string().max(63),
    kind: z.enum(['record', 'checklist']).optional().describe('record (default) = plantilla de registro; checklist = una plantilla de UN checklist que se aplica desde la ficha'),
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional().describe('Para qué sirve (se ve al elegirla)'),
    values: valuesSpec.optional(),
    subtasks: z
        .array(z.object({ title: z.string().min(1).max(500), values: valuesSpec.optional() }))
        .max(RECORD_TEMPLATE_MAX_SUBTASKS)
        .optional()
        .describe('Subtareas que nacen con cada registro'),
    checklists: z
        .array(
            z.object({
                name: z.string().min(1).max(CHECKLIST_NAME_MAX),
                items: z.array(itemSpec).min(1).max(CHECKLIST_MAX_ITEMS),
            }),
        )
        .max(RECORD_TEMPLATE_MAX_CHECKLISTS)
        .optional(),
    record_description: z.string().max(20_000).optional().describe('Texto de la descripción del registro, en formato sencillo (**negrita**, - viñeta, [enlace](url))'),
});
export type RecordTemplateSpec = z.infer<typeof recordTemplateSpec>;

/** Del vocabulario del modelo al contenido de la plantilla (ids). Lanza AiToolError con el motivo. */
export function templateSpecToContent(spec: RecordTemplateSpec, fields: Field[]): RecordTemplateContent {
    const bySlug = new Map(fields.map((f) => [f.slug, f]));
    const slugs = (): string => fields.map((f) => f.slug).join(', ');
    const field = (slug: string, where: string): Field => {
        const f = bySlug.get(slug);
        if (!f) throw new AiToolError(`${where}: no existe el campo «${slug}». Campos: ${slugs()}.`);
        return f;
    };
    const date = (d: z.infer<typeof relDateSpec>, where: string): RelativeDate => {
        let from: number | null = null;
        if (d.from) {
            const f = field(d.from, where);
            if (f.type !== 'date' && f.type !== 'datetime') throw new AiToolError(`${where}: «${d.from}» no es un campo fecha.`);
            from = f.id;
        }
        return { days: d.days, from_field_id: from, business_days: d.business_days ?? false, time: d.time ?? null };
    };
    const person = (p: z.infer<typeof personSpec>, where: string): TemplatePerson => {
        if (p === 'creator') return { kind: 'creator' };
        if (typeof p === 'number') return { kind: 'user', user_id: p };
        const f = field(p.field, where);
        if (f.type !== 'user') throw new AiToolError(`${where}: «${p.field}» no es un campo Persona.`);
        return { kind: 'field', field_id: f.id };
    };
    const values = (raw: Record<string, unknown> | undefined, where: string): TemplateValues => {
        const out: TemplateValues = {};
        for (const [slug, v] of Object.entries(raw ?? {})) {
            const f = field(slug, where);
            if (!isTemplateValueType(f.type as FieldType)) {
                throw new AiToolError(`${where}: «${slug}» (${f.type}) no se completa en una plantilla: la app lo calcula o apunta a otro registro.`);
            }
            const key = jsonbKeyForField(f.id);
            const obj = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
            if (obj && 'date' in obj && Object.keys(obj).length === 1) {
                const parsed = relDateSpec.safeParse(obj.date);
                if (!parsed.success) throw new AiToolError(`${where}: la fecha relativa de «${slug}» no es válida (${parsed.error.issues[0]?.message ?? 'formato'}).`);
                if (f.type !== 'date' && f.type !== 'datetime') throw new AiToolError(`${where}: «${slug}» no es una fecha.`);
                out[key] = { mode: 'relative_date', date: date(parsed.data, where) };
            } else if (obj && 'person' in obj && Object.keys(obj).length === 1) {
                const parsed = personSpec.safeParse(obj.person);
                if (!parsed.success) throw new AiToolError(`${where}: la persona de «${slug}» no es válida.`);
                if (f.type !== 'user') throw new AiToolError(`${where}: «${slug}» no es un campo Persona.`);
                out[key] = { mode: 'person', person: person(parsed.data, where) };
            } else {
                out[key] = { mode: 'fixed', value: fixedValue(f, v) };
            }
        }
        return out;
    };
    const kind = spec.kind ?? 'record';
    const checklists = (spec.checklists ?? []).map((c) => ({
        name: c.name,
        items: c.items.map((it, i) => ({
            text: it.text,
            assignee: it.assignee !== undefined ? person(it.assignee, `Checklist «${c.name}», ítem ${i + 1}`) : null,
            due: it.due ? date(it.due, `Checklist «${c.name}», ítem ${i + 1}`) : null,
        })),
    }));
    if (kind === 'checklist') {
        if (checklists.length !== 1) throw new AiToolError('Una plantilla de checklist lleva exactamente UN checklist (en `checklists`).');
        return { values: {}, subtasks: [], checklists, record_description: null };
    }
    return {
        values: values(spec.values, 'Valores'),
        subtasks: (spec.subtasks ?? []).map((s, i) => ({ title: s.title, values: values(s.values, `Subtarea ${i + 1}`) })),
        checklists,
        record_description: spec.record_description ? markdownToRichDoc(spec.record_description) : null,
    };
}

/** Las opciones se aceptan por value o por etiqueta (como en propose_create_records). */
function fixedValue(f: Field, v: unknown): unknown {
    if (f.type === 'select' && typeof v === 'string') return coerceTextToFieldValue(v, f as never);
    if (f.type === 'multi_select') {
        if (typeof v === 'string') return coerceTextToFieldValue(v, f as never);
        if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? coerceTextToFieldValue(x, { ...f, type: 'select' } as never) : x));
    }
    return v;
}

/** La plantilla descrita para el modelo (get_list_schema): slugs y texto legible. */
export function templateForModel(t: RecordTemplate, fields: Field[]): Record<string, unknown> {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const label = (id: number): string | undefined => byId.get(id)?.label;
    const person = (p: TemplatePerson | null): unknown => {
        if (!p) return undefined;
        if (p.kind === 'creator') return 'creator';
        if (p.kind === 'user') return p.user_id;
        return { field: byId.get(p.field_id)?.slug ?? null };
    };
    const values = (vals: TemplateValues): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const [key, v] of Object.entries(vals)) {
            const f = byId.get(Number(key.slice(1)));
            if (!f) continue;
            if (v.mode === 'fixed') out[f.slug] = v.value;
            else if (v.mode === 'relative_date') out[f.slug] = { date: describeRelativeDate(v.date, label) };
            else out[f.slug] = { person: person(v.person) };
        }
        return out;
    };
    const c = t.content;
    return {
        id: t.id,
        kind: t.kind,
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        ...(Object.keys(c.values).length > 0 ? { values: values(c.values) } : {}),
        ...(c.subtasks.length > 0 ? { subtasks: c.subtasks.map((s) => s.title) } : {}),
        ...(c.checklists.length > 0
            ? {
                  checklists: c.checklists.map((cl) => ({
                      name: cl.name,
                      items: cl.items.map((i) => ({
                          text: i.text,
                          ...(i.assignee ? { assignee: person(i.assignee) } : {}),
                          ...(i.due ? { due: describeRelativeDate(i.due, label) } : {}),
                      })),
                  })),
              }
            : {}),
        ...(c.record_description ? { record_description: richDocToMarkdown(c.record_description as never).slice(0, 600) } : {}),
    };
}
