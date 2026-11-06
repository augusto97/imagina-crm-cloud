import { describe, expect, it } from 'vitest';

import { cleanAttribution, cleanPageUrl, pageMatchesAny, pageTerms } from './conversion-logic';
import { formSettingsSchema } from './form';
import { applyFormRecordValues, cleanFormRecordValues, formNameFor, formRecordValuesSchema } from './form-record-values';

const fields = [
    { id: 1, type: 'text' },
    { id: 2, type: 'multi_select', config: { options: [{ value: 'navidad', label: 'Navidad' }, { value: 'vip', label: 'VIP' }] } },
    { id: 3, type: 'select', config: { options: [{ value: 'web', label: 'Web' }, { value: 'tienda', label: 'Tienda' }] } },
    { id: 4, type: 'checkbox' },
    { id: 5, type: 'file' },
    { id: 6, type: 'long_text' },
    { id: 7, type: 'number' },
];

describe('v0.1.386 — origen y etiquetas del formulario', () => {
    it('lee con tolerancia (lo viejo y lo roto no tiran el formulario)', () => {
        expect(formSettingsSchema.parse({}).record_values).toEqual({ form_name_field_id: null, form_name_source: 'name', fixed: [] });
        const rv = formRecordValuesSchema.parse({ form_name_field_id: 'x', fixed: [{ field_id: 3, value: 'web' }, { nope: 1 }, { field_id: 2 }] });
        expect(rv.form_name_field_id).toBeNull();
        expect(rv.fixed).toEqual([{ field_id: 3, value: 'web' }]);
    });

    it('limpia al guardar: columnas de la lista, tipos que sirven, sin repetir y sin lo que ya se pregunta', () => {
        const rv = cleanFormRecordValues(
            {
                form_name_field_id: 6,
                form_name_source: 'title',
                fixed: [
                    { field_id: 3, value: 'web' },
                    { field_id: 3, value: 'tienda' },
                    { field_id: 2, value: ['navidad', 'nope'] },
                    { field_id: 5, value: [9] },
                    { field_id: 1, value: 'Hola' },
                    { field_id: 4, value: false },
                    { field_id: 7, value: 'abc' },
                    { field_id: 99, value: 'x' },
                ],
            },
            fields,
            { asked: new Set([1, 2]) },
        );
        // El texto que se pregunta no se fija; la «varias opciones» sí (se suman).
        expect(rv.fixed).toEqual([
            { field_id: 3, value: 'web' },
        ]);
        expect(rv.form_name_field_id).toBe(6);
    });

    it('una «varias opciones» con una opción inexistente no se guarda; con opciones válidas, sí', () => {
        const ok = cleanFormRecordValues({ form_name_field_id: null, form_name_source: 'name', fixed: [{ field_id: 2, value: ['navidad'] }] }, fields);
        expect(ok.fixed).toEqual([{ field_id: 2, value: ['navidad'] }]);
        const bad = cleanFormRecordValues({ form_name_field_id: null, form_name_source: 'name', fixed: [{ field_id: 2, value: ['nope'] }] }, fields);
        expect(bad.fixed).toEqual([]);
    });

    it('el nombre del formulario sólo en una columna de texto que nadie más escribe', () => {
        expect(cleanFormRecordValues({ form_name_field_id: 3, form_name_source: 'name', fixed: [] }, fields).form_name_field_id).toBeNull();
        expect(cleanFormRecordValues({ form_name_field_id: 1, form_name_source: 'name', fixed: [] }, fields, { asked: new Set([1]) }).form_name_field_id).toBeNull();
        expect(cleanFormRecordValues({ form_name_field_id: 1, form_name_source: 'name', fixed: [] }, fields, { taken: new Set([1]) }).form_name_field_id).toBeNull();
        expect(formNameFor('title', 'Interno', '  ')).toBe('Interno');
        expect(formNameFor('title', 'Interno', 'Público')).toBe('Público');
        expect(formNameFor('name', 'Interno', 'Público')).toBe('Interno');
    });

    it('al enviar: lo respondido gana, las etiquetas se suman y el nombre va a su columna', () => {
        const data = applyFormRecordValues(
            { f2: ['vip'], f1: 'Ana' },
            {
                form_name_field_id: 6,
                form_name_source: 'name',
                fixed: [
                    { field_id: 2, value: ['navidad', 'vip'] },
                    { field_id: 3, value: 'web' },
                    { field_id: 4, value: true },
                ],
            },
            { fields, formName: 'Landing Navidad', formTitle: 'Escríbenos' },
        );
        expect(data).toEqual({ f1: 'Ana', f2: ['vip', 'navidad'], f3: 'web', f4: true, f6: 'Landing Navidad' });
    });

    it('un valor que el campo ya no acepta se descarta sin fallar', () => {
        const data = applyFormRecordValues(
            {},
            { form_name_field_id: null, form_name_source: 'name', fixed: [{ field_id: 3, value: 'borrada' }] },
            { fields, formName: 'F', formTitle: '' },
        );
        expect(data).toEqual({});
    });
});

describe('v0.1.386 — la página desde donde se envió', () => {
    it('conserva la ruta y la consulta útil; quita el ancla, la campaña y los ids de clic', () => {
        expect(cleanPageUrl('https://tienda.co/navidad/regalos?producto=taza&utm_source=ig&gclid=Abc123&fbclid=x#form')).toBe(
            'https://tienda.co/navidad/regalos?producto=taza',
        );
        expect(cleanPageUrl('https://tienda.co/contacto/?utm_campaign=x')).toBe('https://tienda.co/contacto/');
        expect(cleanPageUrl('javascript:alert(1)')).toBe('');
        expect(cleanPageUrl('ftp://x.co/a')).toBe('');
    });

    it('cleanAttribution guarda la página limpia', () => {
        expect(cleanAttribution({ page_url: 'https://x.co/promo?_gl=1*abc&color=rojo', referrer: 'https://google.com/' })).toEqual({
            page_url: 'https://x.co/promo?color=rojo',
            referrer: 'https://google.com/',
        });
    });

    it('«la página contiene» alguna palabra, sin mayúsculas ni tildes', () => {
        expect(pageTerms(' navidad, Black Friday ,navidad\n')).toEqual(['navidad', 'black friday']);
        expect(pageMatchesAny('https://x.co/Promo-NAVIDAD/', 'navidad')).toBe(true);
        expect(pageMatchesAny('https://x.co/promoción', 'promocion')).toBe(true);
        expect(pageMatchesAny('https://x.co/promoci%C3%B3n', 'promoción')).toBe(true);
        expect(pageMatchesAny('https://x.co/contacto', 'navidad, black')).toBe(false);
        expect(pageMatchesAny('', 'navidad')).toBe(false);
        expect(pageMatchesAny(null, '')).toBe(true);
    });
});
