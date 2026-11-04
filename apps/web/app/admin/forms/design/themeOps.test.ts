import { describe, expect, it } from 'vitest';
import { DEFAULT_PUBLIC_THEME, formConfigSchema, publicThemePresets, type FormConfig, type FormFieldItem } from '@imagina-base/shared';

import {
    activePresetId,
    applyTheme,
    effectiveChoiceDisplay,
    effectiveTheme,
    formImageIds,
    normalizeForSave,
    patchDarkColor,
    patchTheme,
    patchThemeSection,
    resetThemeSection,
    resolvedAccent,
    sameTheme,
    setOptionImage,
    stableEqual,
    themeSectionModified,
} from './themeOps';

function classic(extra: Record<string, unknown> = {}): FormConfig {
    return formConfigSchema.parse({
        items: [{ id: 'aaaa1', type: 'field', field_id: 1 }],
        settings: { title: 'Contacto', ...extra },
    });
}

const presets = publicThemePresets('#0e7490');
const preset = (id: string) => presets.find((p) => p.id === id)!.theme;

describe('diseño del formulario', () => {
    it('sin tema es el «Clásico»: se ve el de fábrica y la galería marca el clásico', () => {
        const c = classic();
        expect(c.settings.theme).toBeNull();
        expect(effectiveTheme(c.settings)).toEqual(DEFAULT_PUBLIC_THEME);
        expect(activePresetId(c.settings)).toBe('classic');
        expect(themeSectionModified(c.settings, 'layout')).toBe(false);
    });

    it('el primer cambio arranca del de fábrica y lleva el color viejo al acento del tema', () => {
        const c = classic({ accent_color: '#aa3300' });
        expect(resolvedAccent(c.settings, '#0e7490')).toBe('#aa3300');
        const out = patchThemeSection(c, 'layout', { width: 820 });
        expect(out.settings.accent_color).toBeNull();
        expect(out.settings.theme?.colors.accent).toBe('#aa3300');
        expect(out.settings.theme?.layout.width).toBe(820);
        expect(out.settings.theme?.typography).toEqual(DEFAULT_PUBLIC_THEME.typography);
        expect(resolvedAccent(out.settings, '#0e7490')).toBe('#aa3300');
    });

    it('tocar un ajuste suelta la plantilla', () => {
        const withPreset = applyTheme(classic(), preset('minimal'), { keepCustomCss: false, carryImages: true });
        expect(activePresetId(withPreset.settings)).toBe('minimal');
        const tweaked = patchThemeSection(withPreset, 'button', { uppercase: true });
        expect(activePresetId(tweaked.settings)).toBeNull();
        expect(tweaked.settings.theme?.typography.font).toBe('inter');
    });

    it('aplicar una plantilla reemplaza el tema, pero conserva las imágenes ya subidas', () => {
        let c = patchThemeSection(classic(), 'cover', { enabled: true, file_id: 41 });
        c = patchThemeSection(c, 'typography', { title_size: 40 });
        const out = applyTheme(c, preset('cover'), { keepCustomCss: false, carryImages: true });
        expect(out.settings.theme?.typography.title_size).toBe(preset('cover').typography.title_size);
        expect(out.settings.theme?.cover).toMatchObject({ enabled: true, file_id: 41 });
        // Un tema guardado no hereda imágenes: se aplica tal cual.
        const saved = applyTheme(c, preset('cover'), { keepCustomCss: false });
        expect(saved.settings.theme?.cover.file_id).toBeNull();
    });

    it('quien no es administrador no borra el CSS propio al aplicar, pero sí toma el de un tema guardado', () => {
        const withCss = patchTheme(classic(), { custom_css: '.ib-title{letter-spacing:2px}' });
        const kept = applyTheme(withCss, preset('soft'), { keepCustomCss: true });
        expect(kept.settings.theme?.custom_css).toBe('.ib-title{letter-spacing:2px}');
        const replaced = applyTheme(withCss, { ...preset('soft'), custom_css: '.ib-card{border-width:3px}' }, { keepCustomCss: true });
        expect(replaced.settings.theme?.custom_css).toBe('.ib-card{border-width:3px}');
        const admin = applyTheme(withCss, preset('soft'), { keepCustomCss: false });
        expect(admin.settings.theme?.custom_css).toBe('');
    });

    it('restablecer vuelve una sección a fábrica (los colores incluyen el modo y el oscuro)', () => {
        let c = patchThemeSection(classic(), 'colors', { background: '#000000' });
        c = patchTheme(c, { mode: 'auto' });
        c = patchDarkColor(c, 'card', '#222222');
        c = patchThemeSection(c, 'card', { radius: 30 });
        expect(themeSectionModified(c.settings, 'colors')).toBe(true);
        const r = resetThemeSection(c, 'colors');
        expect(r.settings.theme?.colors).toEqual(DEFAULT_PUBLIC_THEME.colors);
        expect(r.settings.theme?.mode).toBe('light');
        expect(r.settings.theme?.dark_colors).toBeNull();
        expect(r.settings.theme?.card.radius).toBe(30);
        expect(themeSectionModified(r.settings, 'colors')).toBe(false);
        expect(themeSectionModified(resetThemeSection(r, 'card').settings, 'card')).toBe(false);
    });

    it('un color oscuro vacío vuelve al calculado', () => {
        const c = patchDarkColor(patchTheme(classic(), { mode: 'auto', dark_colors: {} }), 'text', '#eeeeee');
        expect(c.settings.theme?.dark_colors).toEqual({ text: '#eeeeee' });
        expect(patchDarkColor(c, 'text', null).settings.theme?.dark_colors).toEqual({});
    });

    it('al guardar, un color viejo que quedó junto a un tema pasa al acento', () => {
        const raw = formConfigSchema.parse({ settings: { accent_color: '#123456', theme: {} } });
        const out = normalizeForSave(raw);
        expect(out.settings.accent_color).toBeNull();
        expect(out.settings.theme?.colors.accent).toBe('#123456');
        // Sin tema, no se toca nada.
        const c = classic({ accent_color: '#123456' });
        expect(normalizeForSave(c)).toBe(c);
    });

    it('compara temas sin importar el orden de las claves ni la plantilla', () => {
        expect(stableEqual({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
        expect(sameTheme(preset('minimal'), { ...preset('minimal'), preset: null })).toBe(true);
        expect(sameTheme(preset('minimal'), preset('soft'))).toBe(false);
    });

    it('junta las imágenes del tema, de los ítems de imagen y de las opciones', () => {
        let c = formConfigSchema.parse({
            items: [
                { id: 'aaaa1', type: 'image', file_id: 7 },
                { id: 'aaaa2', type: 'field', field_id: 2, option_images: { a: 9, b: 7 } },
            ],
        });
        c = patchThemeSection(c, 'background', { kind: 'image', file_id: 3 });
        c = patchThemeSection(c, 'cover', { file_id: 12 });
        expect(formImageIds(c)).toEqual([3, 7, 9, 12]);
        // Una imagen de fondo que no se usa (el fondo es de color) no se pide.
        expect(formImageIds(patchThemeSection(c, 'background', { kind: 'color' }))).toEqual([7, 9, 12]);
    });

    it('cómo se ven las opciones: igual que la página pública', () => {
        expect(effectiveChoiceDisplay('auto', 'cards', 3, false)).toBe('cards');
        expect(effectiveChoiceDisplay('auto', 'cards', 8, false)).toBe('dropdown');
        expect(effectiveChoiceDisplay('auto', 'cards', 8, true)).toBe('cards');
        expect(effectiveChoiceDisplay('radio', 'cards', 3, false)).toBe('list');
        expect(effectiveChoiceDisplay('dropdown', 'list', 3, true)).toBe('list');
        expect(effectiveChoiceDisplay('buttons', 'list', 3, false)).toBe('buttons');
    });

    it('«Redondo» (999) se guarda tal cual y las plantillas redondas conservan su botón y sus opciones', () => {
        const round = patchThemeSection(classic(), 'button', { radius: 999 });
        expect(round.settings.theme?.button.radius).toBe(999);
        const pills = applyTheme(classic(), preset('pills'), { keepCustomCss: false, carryImages: true });
        expect(pills.settings.theme?.choices).toMatchObject({ style: 'buttons', radius: 999 });
        expect(pills.settings.theme?.button).toMatchObject({ radius: 999, full_width: true });
        expect(normalizeForSave(pills).settings.theme?.button.radius).toBe(999);
    });

    it('imagen por opción: poner y quitar', () => {
        const item = { option_images: { a: 1 } } as unknown as FormFieldItem;
        expect(setOptionImage(item, 'b', 2)).toEqual({ option_images: { a: 1, b: 2 } });
        expect(setOptionImage(item, 'a', null)).toEqual({ option_images: {} });
    });
});
