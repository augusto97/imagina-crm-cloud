import { describe, expect, it } from 'vitest';
import {
    fieldConfigSchemas,
    fieldSchema,
    FIELD_TYPES,
    jsonbKeyForField,
    optionColorSchema,
    resolveTitleFieldId,
    selectOptionSchema,
} from './field';

describe('tipos de campo (CONTRACT.md §3)', () => {
    it('todo tipo tiene su schema de config', () => {
        for (const type of FIELD_TYPES) {
            expect(fieldConfigSchemas[type]).toBeDefined();
        }
    });

    it('colores: preset nombrado o hex custom', () => {
        expect(optionColorSchema.safeParse('emerald').success).toBe(true);
        expect(optionColorSchema.safeParse('#1a2b3c').success).toBe(true);
        expect(optionColorSchema.safeParse('verde').success).toBe(false);
        expect(optionColorSchema.safeParse('#12345').success).toBe(false);
    });

    it('opciones de select validan shape {value, label, color}', () => {
        expect(
            selectOptionSchema.safeParse({ value: 'activo', label: 'Activo', color: 'green' }).success,
        ).toBe(true);
        expect(selectOptionSchema.safeParse({ value: '', label: 'X' }).success).toBe(false);
    });

    it('la clave JSONB es f{field_id}, nunca el slug (ADR-S02)', () => {
        expect(jsonbKeyForField(101)).toBe('f101');
    });

    it('fieldSchema rechaza slugs reservados', () => {
        const base = {
            id: 1,
            list_id: 1,
            label: 'X',
            type: 'text',
            config: {},
        };
        expect(fieldSchema.safeParse({ ...base, slug: 'estado' }).success).toBe(true);
        expect(fieldSchema.safeParse({ ...base, slug: 'created_at' }).success).toBe(false);
    });
});

describe('campo de título del registro (v0.1.136)', () => {
    const fields = [
        { id: 10, type: 'number' as const },
        { id: 11, type: 'text' as const },
        { id: 12, type: 'text' as const },
        { id: 13, type: 'long_text' as const },
    ];

    it('sin elección, cae al primer campo de texto (lo que la UI adivinaba)', () => {
        expect(resolveTitleFieldId(fields, {})).toBe(11);
        expect(resolveTitleFieldId(fields, null)).toBe(11);
    });

    it('respeta el campo elegido por la lista', () => {
        expect(resolveTitleFieldId(fields, { title_field_id: 13 })).toBe(13);
    });

    it('ignora una elección que ya no existe o no es texto', () => {
        expect(resolveTitleFieldId(fields, { title_field_id: 999 })).toBe(11);
        expect(resolveTitleFieldId(fields, { title_field_id: 10 })).toBe(11);
    });

    it('una lista sin campos de texto no tiene título editable', () => {
        expect(resolveTitleFieldId([{ id: 1, type: 'number' }], {})).toBeNull();
    });
});
