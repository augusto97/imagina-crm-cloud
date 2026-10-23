import {
    BUTTON_COLOR_PRESETS,
    BUTTON_ICONS,
    BUTTON_ROLES,
    BUTTON_SET_MODES,
    buttonSetModesFor,
    fieldSlugSchema,
    filterOperatorSchema,
    validateFieldValue,
    type FieldType,
} from '@imagina-base/shared';
import { z } from 'zod';
import { AiToolError } from './registry';

/**
 * Campo «Botón» en el vocabulario del asistente / MCP: los campos van por
 * SLUG (nunca ids) y la herramienta los traduce a la config que guarda el
 * editor (`field.config`, ver `buttonConfigSchema`).
 */
export const buttonSpec = z
    .object({
        label: z.string().max(60).optional().describe('Texto del botón (default: el nombre del campo)'),
        color: z.enum(BUTTON_COLOR_PRESETS).optional().describe('Color del botón'),
        icon: z.enum(BUTTON_ICONS).optional().describe('Icono (check, send, message, phone, map_pin, file_text, dollar…)'),
        confirm: z.string().max(200).optional().describe('Si se indica, pide confirmación con ese texto antes de ejecutar («¿Marcar como pagado?»)'),
        actions: z
            .array(
                z.discriminatedUnion('type', [
                    z.object({
                        type: z.literal('open_url'),
                        url: z
                            .string()
                            .min(1)
                            .max(2000)
                            .describe(
                                'Enlace con variables {{slug}} del registro: https://wa.me/{{telefono}}?text=Hola {{nombre}} (el teléfono va solo con indicativo y el texto se codifica solo), https://www.google.com/maps/search/?api=1&query={{direccion}}, mailto:{{email}}, tel:{{telefono}}. Sólo https, mailto o tel.',
                            ),
                    }),
                    z.object({
                        type: z.literal('update_fields'),
                        values: z
                            .array(
                                z.object({
                                    field: fieldSlugSchema.describe('Slug del campo a cambiar'),
                                    mode: z
                                        .enum(BUTTON_SET_MODES)
                                        .optional()
                                        .describe('set = poner value (default); clear = vaciar; today = hoy/ahora (fechas); me = quien presiona (persona); toggle = invertir (casilla); add = sumar value (números)'),
                                    value: z.unknown().optional().describe('set: el valor (en select, el `value` o la etiqueta de la opción; en texto se pueden usar {{slug}}); add: el número a sumar'),
                                }),
                            )
                            .min(1)
                            .max(20),
                    }),
                    z.object({
                        type: z.literal('run_automation'),
                        automation_id: z
                            .number()
                            .int()
                            .positive()
                            .optional()
                            .describe('Id de una automatización de la lista con trigger button_pressed; sin él corren TODAS las que escuchan este botón'),
                    }),
                    z.object({
                        type: z.literal('generate_pdf'),
                        document_template_id: z.number().int().positive().describe('Id de una de las `document_templates` de get_list_schema'),
                        mode: z.enum(['download', 'save']).optional().describe('download = lo baja quien presiona (default); save = lo guarda en save_field'),
                        save_field: fieldSlugSchema.optional().describe('save: slug de un campo Archivo'),
                        save_mode: z.enum(['append', 'replace']).optional(),
                    }),
                ]),
            )
            .min(1)
            .max(5)
            .describe('Lo que hace al presionarlo, en orden'),
        disabled_if: z
            .array(z.object({ field: fieldSlugSchema, op: filterOperatorSchema, value: z.unknown().optional() }))
            .max(10)
            .optional()
            .describe('Deshabilitado si el registro cumple estas condiciones (AND), p. ej. [{field:"estado", op:"eq", value:"pagado"}]'),
        disabled_reason: z.string().max(200).optional().describe('Motivo que se ve cuando está deshabilitado («Ya está pagado»)'),
        roles: z.array(z.enum(BUTTON_ROLES)).max(3).optional().describe('Quién puede presionarlo además de los admins (default: todo el equipo)'),
        portal_run_automation: z.boolean().optional().describe('Si está en el portal del cliente: permitir que el cliente inicie la automatización (corre con permisos del equipo)'),
    })
    .describe('Sólo button: botón que se presiona en la tabla, la ficha o el portal y ejecuta acciones sobre el registro (no guarda valor)');
export type ButtonSpec = z.infer<typeof buttonSpec>;

/** Lo que la traducción necesita saber de un campo (existente o del mismo pedido). */
export interface ButtonFieldRef {
    /** id del campo, o `{ $field: slug }` cuando se arma un blueprint. */
    id: unknown;
    type: FieldType;
    config: Record<string, unknown>;
}

/**
 * La config del botón (ids, o tokens `{$field}` en un blueprint). Valida que
 * cada campo exista y acepte la forma de escritura; una opción de select se
 * acepta por su value o su etiqueta.
 */
export function buildButtonConfig(
    spec: ButtonSpec | undefined,
    slug: string,
    resolve: (slug: string) => ButtonFieldRef | undefined,
    opts: { forBlueprint: boolean; automationIds?: ReadonlySet<number>; templateIds?: ReadonlySet<number> },
): Record<string, unknown> {
    if (!spec) throw new AiToolError(`El campo «${slug}» (button) necesita button {actions: [...]}.`);
    const need = (s: string, where: string): ButtonFieldRef => {
        if (s === slug) throw new AiToolError(`Botón «${slug}»: no se puede referir a sí mismo (${where}).`);
        const f = resolve(s);
        if (!f) throw new AiToolError(`Botón «${slug}»: el campo «${s}» no existe en la lista (${where}).`);
        return f;
    };
    const config: Record<string, unknown> = {};
    if (spec.label) config.label = spec.label;
    if (spec.color) config.color = spec.color;
    if (spec.icon) config.icon = spec.icon;
    if (spec.confirm) config.confirm = spec.confirm;
    if (spec.roles) config.roles = spec.roles;
    if (spec.portal_run_automation) config.portal_run_automation = true;
    config.actions = spec.actions.map((a) => {
        switch (a.type) {
            case 'open_url':
                if (!/^(https:\/\/|mailto:|tel:|\{\{)/i.test(a.url.trim())) {
                    throw new AiToolError(`Botón «${slug}»: el enlace tiene que empezar con https://, mailto: o tel:.`);
                }
                return { type: 'open_url', url: a.url.trim() };
            case 'update_fields':
                return {
                    type: 'update_fields',
                    values: a.values.map((v) => {
                        const f = need(v.field, 'cambiar campos');
                        const mode = v.mode ?? 'set';
                        const modes = buttonSetModesFor(f.type);
                        if (modes.length === 0) throw new AiToolError(`Botón «${slug}»: «${v.field}» (${f.type}) no se puede cambiar con un botón.`);
                        if (!modes.includes(mode)) throw new AiToolError(`Botón «${slug}»: «${v.field}» (${f.type}) admite ${modes.join(', ')}.`);
                        let value = v.value;
                        if (mode === 'set' && value !== undefined && value !== null && !(typeof value === 'string' && value.includes('{{'))) {
                            const options = (f.config.options as Array<{ value: string; label: string }> | undefined) ?? [];
                            const pick = (x: unknown): unknown =>
                                options.find((o) => o.value === x || o.label.toLowerCase() === String(x).toLowerCase())?.value ?? x;
                            if (f.type === 'select') value = pick(value);
                            if (f.type === 'multi_select') value = (Array.isArray(value) ? value : [value]).map(pick);
                            const res = validateFieldValue({ type: f.type, config: f.config, is_required: false }, value);
                            if (!res.ok) throw new AiToolError(`Botón «${slug}», «${v.field}»: ${res.error}`);
                            value = res.value;
                        }
                        if (mode === 'add' && !Number.isFinite(Number(value))) throw new AiToolError(`Botón «${slug}», «${v.field}»: add necesita un número.`);
                        return { field_id: f.id, mode, ...(value !== undefined && mode !== 'clear' ? { value } : {}) };
                    }),
                };
            case 'run_automation':
                if (a.automation_id !== undefined) {
                    if (opts.forBlueprint) throw new AiToolError(`Botón «${slug}»: en una lista nueva no hay automatizaciones todavía; omite automation_id (corren las que escuchan el botón).`);
                    if (opts.automationIds && !opts.automationIds.has(a.automation_id)) {
                        throw new AiToolError(`Botón «${slug}»: la automatización ${a.automation_id} no existe en la lista o no usa el disparador button_pressed.`);
                    }
                }
                return { type: 'run_automation', ...(a.automation_id ? { automation_id: a.automation_id } : {}) };
            case 'generate_pdf': {
                if (opts.forBlueprint) throw new AiToolError(`Botón «${slug}»: una lista nueva no tiene plantillas de documento todavía. Crea la plantilla primero.`);
                if (opts.templateIds && !opts.templateIds.has(a.document_template_id)) {
                    throw new AiToolError(`Botón «${slug}»: la plantilla ${a.document_template_id} no es de esta lista (mira document_templates en get_list_schema).`);
                }
                const mode = a.mode ?? 'download';
                let saveFieldId: unknown = null;
                if (mode === 'save') {
                    if (!a.save_field) throw new AiToolError(`Botón «${slug}»: save necesita save_field (un campo Archivo).`);
                    const f = need(a.save_field, 'guardar el PDF');
                    if (f.type !== 'file') throw new AiToolError(`Botón «${slug}»: «${a.save_field}» no es un campo Archivo.`);
                    saveFieldId = f.id;
                }
                return {
                    type: 'generate_pdf',
                    document_template_id: a.document_template_id,
                    mode,
                    ...(saveFieldId !== null ? { save_field_id: saveFieldId } : {}),
                    ...(a.save_mode ? { save_mode: a.save_mode } : {}),
                };
            }
            default:
                throw new AiToolError(`Botón «${slug}»: acción desconocida.`);
        }
    });
    if (spec.disabled_if?.length) {
        config.disabled_if = {
            type: 'group',
            logic: 'and',
            children: spec.disabled_if.map((r) => ({
                type: 'condition',
                field_id: need(r.field, 'deshabilitado si').id,
                op: r.op,
                ...(r.value !== undefined ? { value: r.value } : {}),
            })),
        };
        if (spec.disabled_reason) config.disabled_reason = spec.disabled_reason;
    }
    return config;
}

/** La config de un botón en el vocabulario del modelo (lo inverso de `buildButtonConfig`). */
export function describeButtonForModel(config: Record<string, unknown>, slugOf: (id: unknown) => string | null): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of ['label', 'color', 'icon', 'confirm', 'roles', 'portal_run_automation', 'disabled_reason'] as const) {
        if (config[k] !== undefined) out[k] = config[k];
    }
    const actions = Array.isArray(config.actions) ? (config.actions as Array<Record<string, unknown>>) : [];
    out.actions = actions.map((a) => {
        if (a.type === 'update_fields') {
            return {
                type: 'update_fields',
                values: ((a.values as Array<Record<string, unknown>>) ?? []).map((v) => ({ field: slugOf(v.field_id), mode: v.mode ?? 'set', ...(v.value !== undefined ? { value: v.value } : {}) })),
            };
        }
        if (a.type === 'generate_pdf') {
            return { type: 'generate_pdf', document_template_id: a.document_template_id ?? null, mode: a.mode ?? 'download', ...(a.save_field_id ? { save_field: slugOf(a.save_field_id) } : {}) };
        }
        return a;
    });
    const tree = config.disabled_if as { children?: Array<Record<string, unknown>> } | undefined;
    if (tree && Array.isArray(tree.children)) {
        out.disabled_if = tree.children
            .filter((c) => c.type === 'condition')
            .map((c) => ({ field: slugOf(c.field_id), op: c.op, ...(c.value !== undefined ? { value: c.value } : {}) }));
    }
    return out;
}
