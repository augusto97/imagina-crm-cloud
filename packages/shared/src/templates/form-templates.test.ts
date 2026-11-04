import { describe, expect, it } from 'vitest';

import { buildPublicFormItems, formConfigSchema } from '../schemas/form';
import { PUBLIC_THEME_PRESET_IDS, publicThemePresets } from '../schemas/public-theme-presets';
import {
    FORM_TEMPLATES,
    buildFormFromTemplate,
    formTemplateById,
    mapTemplateOption,
    missingTemplateRoles,
    type FormTemplate,
    type FormTemplateField,
    type FormTemplateMapping,
} from './form-templates';

/** Campos «creados» para cada rol, como los crearía la app. */
function createdMapping(tpl: FormTemplate): FormTemplateMapping {
    const out: FormTemplateMapping = {};
    tpl.roles.forEach((r, i) => {
        out[r.key] = { id: 100 + i, type: r.create.type, slug: r.key, config: r.create.config ?? {} };
    });
    return out;
}

describe('v0.1.359 — plantillas de formularios', () => {
    it('cada plantilla está bien armada: roles únicos, preguntas con rol, diseño que existe', () => {
        const ids = new Set<string>();
        for (const t of FORM_TEMPLATES) {
            expect(ids.has(t.id)).toBe(false);
            ids.add(t.id);
            const keys = new Set(t.roles.map((r) => r.key));
            expect(keys.size).toBe(t.roles.length);
            for (const r of t.roles) expect(r.types).toContain(r.create.type);
            for (const it of t.items) {
                if ('q' in it) {
                    expect(keys.has(it.q)).toBe(true);
                    if (it.show_if) expect(keys.has(it.show_if.q)).toBe(true);
                }
            }
            if (t.settings.theme) expect(PUBLIC_THEME_PRESET_IDS).toContain(t.settings.theme as (typeof PUBLIC_THEME_PRESET_IDS)[number]);
            if (t.settings.email_role) expect(keys.has(t.settings.email_role)).toBe(true);
        }
        expect(FORM_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    });

    it('con todos los campos creados, cada plantilla arma un formulario válido que el visitante puede ver', () => {
        for (const t of FORM_TEMPLATES) {
            const mapping = createdMapping(t);
            const theme = publicThemePresets('#0e7490').find((p) => p.id === t.settings.theme)?.theme ?? null;
            const config = buildFormFromTemplate(t, mapping, { theme, slugs: t.roles.map((r) => r.key) });
            expect(formConfigSchema.safeParse(config).success).toBe(true);
            const asked = config.items.filter((i) => i.type === 'field');
            expect(asked.length).toBeGreaterThanOrEqual(3);
            const fields = Object.values(mapping).map((f) => ({
                id: f!.id,
                slug: f!.slug,
                label: f!.slug,
                type: f!.type,
                is_required: false,
                config: f!.config ?? {},
            }));
            const items = buildPublicFormItems(config, fields as never, { fileUrl: () => null } as never);
            expect(items.length).toBeGreaterThan(0);
            if (t.settings.theme) expect(config.settings.theme?.preset).toBe(t.settings.theme);
        }
    });

    it('cotización: condiciones por «Empresa», dos páginas y el correo de quien responde', () => {
        const tpl = formTemplateById('quote')!;
        const mapping = createdMapping(tpl);
        const config = buildFormFromTemplate(tpl, mapping);
        expect(config.items.filter((i) => i.type === 'page_break')).toHaveLength(1);
        const nit = config.items.find((i) => i.type === 'field' && i.field_id === mapping.nit!.id);
        expect(nit && 'show_if' in nit ? nit.show_if : null).toEqual({ field_id: mapping.tipo_cliente!.id, op: 'eq', value: 'empresa' });
        expect(config.settings.respondent_email_field_id).toBe(mapping.correo!.id);
    });

    it('con campos que YA existen: las opciones se reconocen por la etiqueta y {{nombre}} pasa a su nombre real', () => {
        const tpl = formTemplateById('quote')!;
        const mapping = createdMapping(tpl);
        // La lista ya tenía «Tipo» con otros valores y el nombre en «nombre_completo».
        mapping.tipo_cliente = {
            id: 7,
            type: 'select',
            slug: 'tipo',
            config: { options: [{ value: 'pn', label: 'Persona' }, { value: 'pj', label: 'Empresa' }] },
        };
        mapping.nombre = { id: 8, type: 'text', slug: 'nombre_completo', config: {} };
        const config = buildFormFromTemplate(tpl, mapping);
        const nit = config.items.find((i) => i.type === 'field' && i.field_id === mapping.nit!.id);
        expect(nit && 'show_if' in nit ? nit.show_if : null).toEqual({ field_id: 7, op: 'eq', value: 'pj' });
        expect(config.settings.success_title).toBe('¡Listo, {{nombre_completo}}!');
        expect(mapTemplateOption(tpl.roles.find((r) => r.key === 'tipo_cliente')!, mapping.tipo_cliente as FormTemplateField, 'nada')).toBeUndefined();
    });

    it('sin un campo para un rol opcional, la pregunta y lo que dependía de ella no se incluyen', () => {
        const tpl = formTemplateById('nps')!;
        const mapping = createdMapping(tpl);
        mapping.que_gusto = null;
        mapping.correo = null;
        const config = buildFormFromTemplate(tpl, mapping);
        const ids = config.items.flatMap((i) => (i.type === 'field' ? [i.field_id] : []));
        expect(ids).toEqual([mapping.nps!.id, mapping.que_mejorar!.id]);
        expect(config.settings.layout).toBe('conversational');
        expect(config.settings.welcome.enabled).toBe(true);
        expect(missingTemplateRoles(tpl, mapping)).toEqual([]);
        mapping.nps = null;
        expect(missingTemplateRoles(tpl, mapping).map((r) => r.key)).toEqual(['nps']);
    });

    it('test con puntaje: puntos por opción y Sí/No, finales por puntaje, y un cálculo que no choca con un campo', () => {
        const tpl = formTemplateById('quiz')!;
        const mapping = createdMapping(tpl);
        const config = buildFormFromTemplate(tpl, mapping, { slugs: ['puntos', 'puntaje'] });
        const calc = config.settings.calcs[0]!;
        // «puntos» ya es un campo de la lista: el cálculo pasa a «puntos_2» y los textos lo siguen.
        expect(calc.key).toBe('puntos_2');
        expect(calc.save_field_id).toBe(mapping.puntaje!.id);
        expect(calc.parts.find((p) => p.field_id === mapping.urgente!.id)?.points).toEqual({ true: 3, false: 0 });
        expect(config.settings.endings[0]!.when).toEqual({ calc: 'puntos_2', op: 'gt', value: 6 });
        expect(config.settings.endings[0]!.message).toContain('{{puntos_2}}');
    });
});
