import { describe, expect, it } from 'vitest';

import type { FieldEntity } from '@/types/field';

import { daysFromToday, pctOf, relativeLabel } from './FieldDisplay';
import { fieldEditable, type LayoutCtx } from './LayoutContext';
import { resolveTheme } from './layoutTheme';

const field = (type: FieldEntity['type'], config: Record<string, unknown> = {}): FieldEntity =>
    ({ id: 1, list_id: 1, slug: 'x', label: 'X', type, config, is_required: false, is_unique: false, is_primary: false, is_indexed: false, position: 0 }) as FieldEntity;

const iso = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('ficha v3 — formas de mostrar y tema', () => {
    it('porcentaje de progreso según el tipo y la meta', () => {
        expect(pctOf(field('percent'), 64)).toBe(64);
        expect(pctOf(field('percent'), 140)).toBe(100);
        expect(pctOf(field('rating', { max: 5 }), 4)).toBe(80);
        expect(pctOf(field('currency'), 250, 1000)).toBe(25);
        // Sin meta: lleno si hay valor, vacío si no (no inventa una escala).
        expect(pctOf(field('number'), 12)).toBe(100);
        expect(pctOf(field('number'), 0)).toBe(0);
    });

    it('fechas relativas y cuenta regresiva', () => {
        expect(daysFromToday(iso(5))).toBe(5);
        expect(daysFromToday(iso(-3))).toBe(-3);
        expect(daysFromToday('no-es-fecha')).toBeNull();
        expect(relativeLabel(iso(0))).toBe('Hoy');
        expect(relativeLabel(iso(1))).toBe('Mañana');
        expect(relativeLabel(iso(10))).toBe('En 10 días');
        expect(relativeLabel(iso(-10))).toBe('Hace 10 días');
    });

    it('los presets de tema y lo que la plantilla pisa', () => {
        expect(resolveTheme(undefined)).toMatchObject({ accent: 'hsl(var(--imcrm-primary))', surface: 'cards' });
        expect(resolveTheme({ preset: 'fresh' }).accent).toBe('#0f9f6e');
        expect(resolveTheme({ preset: 'minimal' }).surface).toBe('flat');
        expect(resolveTheme({ preset: 'corporate', accent: '#111111', density: 'spacious', radius: 'xl' })).toEqual({
            accent: '#111111',
            radius: 18,
            gap: 24,
            surface: 'outlined',
        });
    });
});

describe('v0.1.233 — quién edita qué (ficha y portal)', () => {
    const base = { canEdit: true, lockedReasons: {} as Record<string, string | null>, preview: false } as unknown as LayoutCtx;
    it('en la ficha manda el permiso, la tienda y que no sea un derivado', () => {
        expect(fieldEditable(base, field('text'))).toBe(true);
        expect(fieldEditable({ ...base, canEdit: false }, field('text'))).toBe(false);
        expect(fieldEditable({ ...base, lockedReasons: { x: 'La tienda manda' } }, field('text'))).toBe(false);
        expect(fieldEditable(base, field('rollup'))).toBe(false);
        expect(fieldEditable({ ...base, preview: true }, field('text'))).toBe(false);
    });
    it('en el portal sólo lo que el diseño marca como editable', () => {
        const portal = { ...base, mode: 'portal' as const, canEditField: (f: FieldEntity) => f.id === 1 };
        expect(fieldEditable(portal, field('text'))).toBe(true);
        expect(fieldEditable(portal, { ...field('text'), id: 2 } as FieldEntity)).toBe(false);
        // La vista previa del editor nunca edita.
        expect(fieldEditable({ ...portal, preview: true }, field('text'))).toBe(false);
    });
});
