import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';
import { CHECKLIST_ITEM_TEXT_MAX, CHECKLIST_MAX_ITEMS, CHECKLIST_NAME_MAX } from './checklist';
import { isUserWritableType, jsonbKeyForField, type FieldType } from './field';
import { recordDataSchema } from './record';
import { addDaysYmd, resolveTimeZone, zonedDayAndMinute, zonedInstant, zonedToday } from './timezone';
import { addBusinessDaysMs, msToYmd } from '../formula/dates';

/**
 * C6 — Plantillas de registro (y A9 — plantillas de checklist).
 *
 * Una plantilla de REGISTRO es «Nuevo cliente»: crea el registro con sus
 * valores, N subtareas (cada una con responsable y fecha relativa) y sus
 * checklists, todo en UNA transacción. Una plantilla de CHECKLIST es un
 * checklist con nombre que se aplica a un registro que ya existe. Las dos
 * viven en la misma tabla (`record_templates`, por lista, con RLS) con un
 * `kind`, y comparten el formato de los ítems.
 *
 * Todo lo que referencia un campo lo hace por ID (regla de oro nº 1): las
 * plantillas de lista y la migración de empresa lo re-apuntan.
 *
 * Los valores DINÁMICOS se resuelven al crear:
 *  - fecha relativa: «+N días» desde la creación o desde un campo fecha del
 *    registro, opcionalmente en días HÁBILES (lunes a viernes sin los
 *    festivos de Colombia, la misma lógica de `SUMAR_DIAS_HABILES`) y en la
 *    zona de la empresa (ADR-S33);
 *  - persona: una fija, «quien crea el registro» o «el valor del campo
 *    Persona X del registro».
 */

export const RECORD_TEMPLATE_KINDS = ['record', 'checklist'] as const;
export const recordTemplateKindSchema = z.enum(RECORD_TEMPLATE_KINDS);
export type RecordTemplateKind = z.infer<typeof recordTemplateKindSchema>;

/** Plantillas por lista (de cada tipo). */
export const RECORD_TEMPLATE_MAX_PER_LIST = 100;
/** Subtareas por plantilla. */
export const RECORD_TEMPLATE_MAX_SUBTASKS = 50;
/** Checklists por plantilla. */
export const RECORD_TEMPLATE_MAX_CHECKLISTS = 10;
/** Días (hacia adelante o atrás) de una fecha relativa. */
export const RELATIVE_DATE_MAX_DAYS = 3650;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Quién: una persona fija, quien crea el registro, o el valor de un campo
 * Persona del registro (en una subtarea o un ítem: el del registro PRINCIPAL).
 */
export const templatePersonSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('user'), user_id: idSchema }),
    z.object({ kind: z.literal('creator') }),
    z.object({ kind: z.literal('field'), field_id: idSchema }),
]);
export type TemplatePerson = z.infer<typeof templatePersonSchema>;

/**
 * Fecha relativa: `days` desde la creación (`from_field_id` null) o desde un
 * campo fecha del registro principal. `business_days` cuenta sólo días hábiles.
 * `time` ('HH:MM', zona de la empresa) da la hora cuando el destino la lleva;
 * sin `time`, un destino con hora conserva la hora del origen.
 */
export const relativeDateSchema = z.object({
    days: z.number().int().min(-RELATIVE_DATE_MAX_DAYS).max(RELATIVE_DATE_MAX_DAYS),
    from_field_id: idSchema.nullable().default(null),
    business_days: z.boolean().default(false),
    time: z.string().regex(HHMM, 'Hora HH:MM').nullable().default(null),
});
export type RelativeDate = z.infer<typeof relativeDateSchema>;

/**
 * El valor de un campo en la plantilla: fijo (validado con el tipo del campo),
 * una fecha relativa (campos fecha) o una persona (campos Persona).
 */
export const templateValueSchema = z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed'), value: z.unknown() }),
    z.object({ mode: z.literal('relative_date'), date: relativeDateSchema }),
    z.object({ mode: z.literal('person'), person: templatePersonSchema }),
]);
export type TemplateValue = z.infer<typeof templateValueSchema>;

/** Valores por clave `f{id}`. */
export const templateValuesSchema = z.record(z.string().regex(/^f\d+$/), templateValueSchema);
export type TemplateValues = z.infer<typeof templateValuesSchema>;

export const templateChecklistItemSchema = z.object({
    text: z.string().trim().min(1).max(CHECKLIST_ITEM_TEXT_MAX),
    assignee: templatePersonSchema.nullable().default(null),
    due: relativeDateSchema.nullable().default(null),
});
export type TemplateChecklistItem = z.infer<typeof templateChecklistItemSchema>;

export const templateChecklistSchema = z.object({
    name: z.string().trim().min(1).max(CHECKLIST_NAME_MAX),
    items: z.array(templateChecklistItemSchema).max(CHECKLIST_MAX_ITEMS).default([]),
});
export type TemplateChecklist = z.infer<typeof templateChecklistSchema>;

/**
 * Una subtarea: su título (va al campo de título de la lista) y sus valores.
 * El responsable y la fecha son valores más (`person` / `relative_date`) en
 * los campos que la persona eligió.
 */
export const templateSubtaskSchema = z.object({
    title: z.string().trim().min(1).max(500),
    values: templateValuesSchema.default({}),
});
export type TemplateSubtask = z.infer<typeof templateSubtaskSchema>;

export const recordTemplateContentSchema = z.object({
    values: templateValuesSchema.default({}),
    subtasks: z.array(templateSubtaskSchema).max(RECORD_TEMPLATE_MAX_SUBTASKS).default([]),
    checklists: z.array(templateChecklistSchema).max(RECORD_TEMPLATE_MAX_CHECKLISTS).default([]),
    /** Descripción del registro (documento). El servidor la sanea al guardar. */
    record_description: z.unknown().nullable().default(null),
});
export type RecordTemplateContent = z.infer<typeof recordTemplateContentSchema>;

export const recordTemplateSchema = z.object({
    id: idSchema,
    list_id: idSchema,
    kind: recordTemplateKindSchema,
    name: z.string(),
    description: z.string().nullable(),
    icon: z.string().nullable(),
    color: z.string().nullable(),
    content: recordTemplateContentSchema,
    position: z.number().int(),
    created_by: idSchema.nullable(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
});
export type RecordTemplate = z.infer<typeof recordTemplateSchema>;

const templateName = z.string().trim().min(1, 'Ponle un nombre').max(120);

export const createRecordTemplateSchema = z.object({
    kind: recordTemplateKindSchema.default('record'),
    name: templateName,
    description: z.string().trim().max(500).nullable().optional(),
    icon: z.string().max(64).nullable().optional(),
    color: z.string().max(32).nullable().optional(),
    content: recordTemplateContentSchema.default({}),
});
export type CreateRecordTemplateInput = z.infer<typeof createRecordTemplateSchema>;

export const updateRecordTemplateSchema = z
    .object({
        name: templateName,
        description: z.string().trim().max(500).nullable(),
        icon: z.string().max(64).nullable(),
        color: z.string().max(32).nullable(),
        content: recordTemplateContentSchema,
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, { message: 'El cambio no puede estar vacío' });
export type UpdateRecordTemplateInput = z.infer<typeof updateRecordTemplateSchema>;

/**
 * «Guardar como plantilla» desde la ficha: toma los valores, las subtareas y
 * los checklists del registro (lo elegido en `include`). Las fechas absolutas
 * se vuelven relativas respecto de HOY (en la zona de la empresa).
 */
export const recordTemplateFromRecordSchema = z.object({
    record_id: idSchema,
    name: templateName,
    description: z.string().trim().max(500).nullable().optional(),
    icon: z.string().max(64).nullable().optional(),
    include: z
        .object({
            values: z.boolean().default(true),
            subtasks: z.boolean().default(true),
            checklists: z.boolean().default(true),
            description: z.boolean().default(true),
        })
        .default({}),
});
export type RecordTemplateFromRecordInput = z.infer<typeof recordTemplateFromRecordSchema>;

/** Guardar UN checklist de un registro como plantilla de checklist. */
export const checklistTemplateFromChecklistSchema = z.object({
    checklist_id: idSchema,
    name: templateName.optional(),
});
export type ChecklistTemplateFromChecklistInput = z.infer<typeof checklistTemplateFromChecklistSchema>;

/**
 * Alta desde una plantilla (`POST /lists/:l/records/from-template`). Lo que
 * viene en `data` PISA lo de la plantilla (el formulario de alta, un
 * formulario público, el asistente).
 */
export const createFromTemplateSchema = z.object({
    template_id: idSchema,
    data: recordDataSchema.default({}),
    parent_id: idSchema.nullable().optional(),
});
export type CreateFromTemplateInput = z.infer<typeof createFromTemplateSchema>;

/** Lo que crea una plantilla (respuesta del alta). */
export interface FromTemplateResult {
    record_id: number;
    subtask_ids: number[];
    checklist_ids: number[];
    /** Valores de la plantilla que no se pudieron usar (campo borrado, persona que ya no es miembro…). */
    warnings: string[];
}

// ─────────────────────────── Puro ───────────────────────────

/**
 * ¿Un campo de este tipo puede llevar un valor en una plantilla? Los que la
 * app calcula o asigna (ID automático, sistema, calculados, fórmula,
 * lookup/rollup, botón, IA, tiempo, progreso) no; tampoco relaciones ni
 * archivos: apuntan a otras entidades (un vínculo o un adjunto compartido por
 * todos los registros que nazcan de la plantilla no es lo que nadie espera).
 */
export function isTemplateValueType(type: FieldType): boolean {
    return isUserWritableType(type) && type !== 'file';
}

/** Lo mínimo de un campo que necesita la resolución. */
export interface TemplateFieldLike {
    id: number;
    type: string;
}

function baseOf(raw: unknown, tz: string): { ymd: string; minute: number | null } | null {
    if (typeof raw !== 'string' || raw === '') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { ymd: raw, minute: null };
    const at = new Date(raw);
    if (Number.isNaN(at.getTime())) return null;
    const z = zonedDayAndMinute(at, tz);
    return { ymd: z.ymd, minute: z.minute };
}

/**
 * Resuelve una fecha relativa. `withTime` = el destino lleva hora (un campo
 * fecha y hora, o un ítem con `time`). Devuelve `AAAA-MM-DD` o un instante
 * ISO UTC; null si el campo de origen está vacío.
 *
 * Hora del resultado (si lleva): la de `time`; si no, la del origen (la
 * creación o el campo fecha y hora); si el origen es una fecha sin hora, las
 * 9:00 de la empresa.
 */
export function resolveRelativeDate(
    spec: RelativeDate,
    ctx: { now: Date; timeZone: string; data: Record<string, unknown>; withTime: boolean },
): string | null {
    const tz = resolveTimeZone(ctx.timeZone);
    const base =
        spec.from_field_id === null
            ? { ymd: zonedToday(tz, ctx.now), minute: zonedDayAndMinute(ctx.now, tz).minute }
            : baseOf(ctx.data[jsonbKeyForField(spec.from_field_id)], tz);
    if (!base) return null;
    let ymd: string;
    if (spec.business_days) {
        const [y, m, d] = base.ymd.split('-').map(Number) as [number, number, number];
        ymd = msToYmd(addBusinessDaysMs(Date.UTC(y, m - 1, d), spec.days));
    } else {
        ymd = addDaysYmd(base.ymd, spec.days);
    }
    if (!ctx.withTime) return ymd;
    let minute: number;
    if (spec.time !== null) {
        const [h, mi] = spec.time.split(':').map(Number) as [number, number];
        minute = h * 60 + mi;
    } else {
        minute = base.minute ?? 9 * 60;
    }
    return zonedInstant(ymd, tz, { h: Math.floor(minute / 60), m: minute % 60 }).toISOString();
}

/** Resuelve una persona: el id, o null si no hay (sistema, campo vacío). */
export function resolveTemplatePerson(spec: TemplatePerson, ctx: { creatorId: number; data: Record<string, unknown> }): number | null {
    switch (spec.kind) {
        case 'user':
            return spec.user_id;
        case 'creator':
            return ctx.creatorId > 0 ? ctx.creatorId : null;
        case 'field': {
            const raw = ctx.data[jsonbKeyForField(spec.field_id)];
            const id = typeof raw === 'number' ? raw : Number(raw);
            return Number.isInteger(id) && id > 0 ? id : null;
        }
    }
}

/**
 * Valores de una plantilla → `data` (por `f{id}`). Primero los fijos (y lo que
 * trae `base`, que es lo del registro principal o el alta); después los
 * dinámicos, que pueden leer esos (una fecha desde otro campo, una persona
 * desde un campo Persona). Los campos que ya no existen o no admiten valor se
 * saltan con un aviso.
 */
export function resolveTemplateValues(
    values: TemplateValues,
    fields: ReadonlyArray<TemplateFieldLike & { label?: string }>,
    ctx: { now: Date; timeZone: string; creatorId: number; base: Record<string, unknown> },
): { data: Record<string, unknown>; warnings: string[] } {
    const byKey = new Map(fields.map((f) => [jsonbKeyForField(f.id), f]));
    const data: Record<string, unknown> = {};
    const warnings: string[] = [];
    const usable = (key: string): TemplateFieldLike & { label?: string } | null => {
        const f = byKey.get(key);
        if (!f) {
            warnings.push(`Un valor de la plantilla apunta a un campo que ya no existe (${key}).`);
            return null;
        }
        if (!isTemplateValueType(f.type as FieldType)) return null;
        return f;
    };
    for (const [key, v] of Object.entries(values)) {
        if (v.mode !== 'fixed' || !usable(key)) continue;
        if (v.value !== null && v.value !== undefined) data[key] = v.value;
    }
    // Lo que se va resolviendo también se puede leer (una persona tomada de
    // otro campo Persona de la misma plantilla); lo del alta siempre manda.
    const read: Record<string, unknown> = { ...data, ...ctx.base };
    const set = (key: string, value: unknown): void => {
        data[key] = value;
        if (!(key in ctx.base)) read[key] = value;
    };
    // Primero las fechas y las personas «fijas» (quien crea, una persona);
    // después las que se leen de otro campo, que pueden depender de aquéllas.
    const dynamic = Object.entries(values).filter(([, v]) => v.mode !== 'fixed');
    const order = [
        ...dynamic.filter(([, v]) => !(v.mode === 'person' && v.person.kind === 'field')),
        ...dynamic.filter(([, v]) => v.mode === 'person' && v.person.kind === 'field'),
    ];
    for (const [key, v] of order) {
        const f = usable(key);
        if (!f) continue;
        if (v.mode === 'relative_date') {
            if (f.type !== 'date' && f.type !== 'datetime') continue;
            const out = resolveRelativeDate(v.date, { now: ctx.now, timeZone: ctx.timeZone, data: read, withTime: f.type === 'datetime' });
            if (out !== null) set(key, out);
            else warnings.push(`«${f.label ?? key}» quedó vacío: su fecha de origen no tiene valor.`);
        } else if (v.mode === 'person') {
            if (f.type !== 'user') continue;
            const id = resolveTemplatePerson(v.person, { creatorId: ctx.creatorId, data: read });
            if (id !== null) set(key, id);
        }
    }
    return { data, warnings };
}

/**
 * Una fecha absoluta → relativa respecto de HOY («Guardar como plantilla»):
 * `2026-11-03` guardada el 2026-10-27 es «+7 días desde la creación». Una
 * fecha y hora conserva su hora local.
 */
export function relativeFromAbsolute(raw: unknown, ctx: { now: Date; timeZone: string }): RelativeDate | null {
    const tz = resolveTimeZone(ctx.timeZone);
    const base = baseOf(raw, tz);
    if (!base) return null;
    const today = zonedToday(tz, ctx.now);
    const days = Math.round((Date.parse(`${base.ymd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    if (Math.abs(days) > RELATIVE_DATE_MAX_DAYS) return null;
    const time =
        base.minute === null ? null : `${String(Math.floor(base.minute / 60)).padStart(2, '0')}:${String(base.minute % 60).padStart(2, '0')}`;
    return { days, from_field_id: null, business_days: false, time };
}

/** Todos los ids de campo y de persona que nombra una plantilla (validación y re-mapeo). */
export function templateRefs(content: RecordTemplateContent): { fieldIds: Set<number>; userIds: Set<number> } {
    const fieldIds = new Set<number>();
    const userIds = new Set<number>();
    const person = (p: TemplatePerson | null): void => {
        if (!p) return;
        if (p.kind === 'user') userIds.add(p.user_id);
        if (p.kind === 'field') fieldIds.add(p.field_id);
    };
    const date = (d: RelativeDate | null): void => {
        if (d?.from_field_id) fieldIds.add(d.from_field_id);
    };
    const values = (vals: TemplateValues): void => {
        for (const [key, v] of Object.entries(vals)) {
            fieldIds.add(Number(key.slice(1)));
            if (v.mode === 'relative_date') date(v.date);
            if (v.mode === 'person') person(v.person);
        }
    };
    values(content.values);
    for (const s of content.subtasks) values(s.values);
    for (const c of content.checklists) {
        for (const i of c.items) {
            person(i.assignee);
            date(i.due);
        }
    }
    return { fieldIds, userIds };
}

/**
 * Re-apunta los ids de una plantilla (plantillas de lista, migrar empresa).
 * `field`/`user` devuelven el id nuevo o null (lo que no viajó): un valor de
 * un campo que no existe se descarta; una persona que no está, también (el
 * ítem o la subtarea quedan sin responsable).
 */
export function remapTemplateContent(
    content: RecordTemplateContent,
    map: { field: (id: number) => number | null; user: (id: number) => number | null },
): RecordTemplateContent {
    const person = (p: TemplatePerson | null): TemplatePerson | null => {
        if (!p) return null;
        if (p.kind === 'user') {
            const id = map.user(p.user_id);
            return id === null ? null : { kind: 'user', user_id: id };
        }
        if (p.kind === 'field') {
            const id = map.field(p.field_id);
            return id === null ? null : { kind: 'field', field_id: id };
        }
        return p;
    };
    const date = (d: RelativeDate | null): RelativeDate | null => {
        if (!d) return null;
        if (d.from_field_id === null) return d;
        const id = map.field(d.from_field_id);
        return id === null ? null : { ...d, from_field_id: id };
    };
    const values = (vals: TemplateValues): TemplateValues => {
        const out: TemplateValues = {};
        for (const [key, v] of Object.entries(vals)) {
            const id = map.field(Number(key.slice(1)));
            if (id === null) continue;
            if (v.mode === 'relative_date') {
                const d = date(v.date);
                if (d) out[jsonbKeyForField(id)] = { mode: 'relative_date', date: d };
            } else if (v.mode === 'person') {
                const p = person(v.person);
                if (p) out[jsonbKeyForField(id)] = { mode: 'person', person: p };
            } else {
                out[jsonbKeyForField(id)] = v;
            }
        }
        return out;
    };
    return {
        values: values(content.values),
        subtasks: content.subtasks.map((s) => ({ title: s.title, values: values(s.values) })),
        checklists: content.checklists.map((c) => ({
            name: c.name,
            items: c.items.map((i) => ({ text: i.text, assignee: person(i.assignee), due: date(i.due) })),
        })),
        record_description: content.record_description,
    };
}

/** Lee el contenido guardado tolerando basura (nunca lanza). */
export function readTemplateContent(raw: unknown): RecordTemplateContent {
    const parsed = recordTemplateContentSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : recordTemplateContentSchema.parse({});
}

/** «+3 días hábiles desde «Inicio» a las 09:00» — para listas y vistas previas. */
export function describeRelativeDate(d: RelativeDate, fieldLabel?: (id: number) => string | undefined): string {
    const n = Math.abs(d.days);
    const unit = d.business_days ? (n === 1 ? 'día hábil' : 'días hábiles') : n === 1 ? 'día' : 'días';
    const from = d.from_field_id === null ? 'la creación' : `«${fieldLabel?.(d.from_field_id) ?? 'un campo'}»`;
    const when = d.days === 0 ? `el mismo día de ${from}` : `${d.days > 0 ? '+' : '−'}${n} ${unit} desde ${from}`;
    return d.time ? `${when} a las ${d.time}` : when;
}

// ─────────────────────────── Formato portable (blueprint) ───────────────────────────

/**
 * La plantilla en el formato PORTABLE de los blueprints (duplicar lista,
 * plantillas de lista): los campos por SLUG (las claves de `values` y las
 * referencias `field_id` / `from_field_id`), porque el blueprint no tiene
 * base. Una persona fija viaja por id: sólo vale dentro de la misma empresa
 * (al materializar, una que no es del equipo se descarta).
 */
export function portableTemplateContent(content: RecordTemplateContent, slugOf: (id: number) => string | undefined): Record<string, unknown> {
    const person = (p: TemplatePerson | null): unknown => {
        if (!p) return null;
        if (p.kind === 'field') {
            const slug = slugOf(p.field_id);
            return slug ? { kind: 'field', field: slug } : null;
        }
        return p;
    };
    const date = (d: RelativeDate | null): unknown => {
        if (!d) return null;
        const { from_field_id, ...rest } = d;
        if (from_field_id === null) return { ...rest, from_field: null };
        const slug = slugOf(from_field_id);
        return slug ? { ...rest, from_field: slug } : null;
    };
    const values = (vals: TemplateValues): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const [key, v] of Object.entries(vals)) {
            const slug = slugOf(Number(key.slice(1)));
            if (!slug) continue;
            if (v.mode === 'relative_date') {
                const d = date(v.date);
                if (d) out[slug] = { mode: 'relative_date', date: d };
            } else if (v.mode === 'person') {
                const p = person(v.person);
                if (p) out[slug] = { mode: 'person', person: p };
            } else {
                out[slug] = v;
            }
        }
        return out;
    };
    return {
        values: values(content.values),
        subtasks: content.subtasks.map((s) => ({ title: s.title, values: values(s.values) })),
        checklists: content.checklists.map((c) => ({
            name: c.name,
            items: c.items.map((i) => ({ text: i.text, assignee: person(i.assignee), due: date(i.due) })),
        })),
        record_description: content.record_description,
    };
}

/** Lo inverso: slugs → ids de la lista nueva. Lo que no resuelve se descarta. */
export function templateContentFromPortable(raw: unknown, idOf: (slug: string) => number | undefined): RecordTemplateContent {
    const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const person = (p: unknown): TemplatePerson | null => {
        if (!p || typeof p !== 'object') return null;
        const o = p as Record<string, unknown>;
        if (o.kind === 'field') {
            const id = typeof o.field === 'string' ? idOf(o.field) : undefined;
            return id ? { kind: 'field', field_id: id } : null;
        }
        const parsed = templatePersonSchema.safeParse(o);
        return parsed.success ? parsed.data : null;
    };
    const date = (d: unknown): RelativeDate | null => {
        if (!d || typeof d !== 'object') return null;
        const { from_field, ...rest } = d as Record<string, unknown>;
        let from: number | null = null;
        if (typeof from_field === 'string') {
            const id = idOf(from_field);
            if (!id) return null;
            from = id;
        }
        const parsed = relativeDateSchema.safeParse({ ...rest, from_field_id: from });
        return parsed.success ? parsed.data : null;
    };
    const values = (vals: unknown): TemplateValues => {
        const out: TemplateValues = {};
        for (const [slug, v] of Object.entries((vals && typeof vals === 'object' ? vals : {}) as Record<string, unknown>)) {
            const id = idOf(slug);
            if (!id || !v || typeof v !== 'object') continue;
            const o = v as Record<string, unknown>;
            const key = jsonbKeyForField(id);
            if (o.mode === 'relative_date') {
                const d = date(o.date);
                if (d) out[key] = { mode: 'relative_date', date: d };
            } else if (o.mode === 'person') {
                const p = person(o.person);
                if (p) out[key] = { mode: 'person', person: p };
            } else if (o.mode === 'fixed') {
                out[key] = { mode: 'fixed', value: o.value };
            }
        }
        return out;
    };
    const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
    return readTemplateContent({
        values: values(src.values),
        subtasks: arr(src.subtasks).map((s) => {
            const o = (s ?? {}) as Record<string, unknown>;
            return { title: o.title, values: values(o.values) };
        }),
        checklists: arr(src.checklists).map((c) => {
            const o = (c ?? {}) as Record<string, unknown>;
            return {
                name: o.name,
                items: arr(o.items).map((i) => {
                    const it = (i ?? {}) as Record<string, unknown>;
                    return { text: it.text, assignee: person(it.assignee), due: date(it.due) };
                }),
            };
        }),
        record_description: src.record_description ?? null,
    });
}
