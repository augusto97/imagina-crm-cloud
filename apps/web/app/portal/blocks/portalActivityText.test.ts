import { describe, expect, it } from 'vitest';

import { publicDefaultSort, publicFieldIds } from '@/admin/lists/publicListFields';
import type { FieldEntity } from '@/types/field';
import { portalActivityText } from './ActivityTimelineBlock';

const fields = [
    { id: 1, slug: 'estado', label: 'Estado', type: 'select', config: { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'pagado', label: 'Pagado' }] } },
    { id: 2, slug: 'email', label: 'Email', type: 'email', config: {} },
] as unknown as FieldEntity[];

describe('portalActivityText — la actividad del portal en lenguaje humano', () => {
    it('lo que hizo el equipo se firma con la empresa y usa las etiquetas', () => {
        const t = portalActivityText(
            { id: 1, action: 'record_updated', created_at: '', user_id: null, diff: { f1: { from: 'pendiente', to: 'pagado' } } },
            fields,
            { mine: false, company: 'Acme' },
        );
        expect(t.title).toBe('Acme cambió Estado de Pendiente a Pagado');
        expect(t.title).not.toContain('record_updated');
    });

    it('lo que hizo el cliente, en segunda persona', () => {
        const t = portalActivityText(
            { id: 2, action: 'record_updated', created_at: '', user_id: 7, diff: { f2: { from: null, to: 'yo@x.com' } } },
            fields,
            { mine: true, company: 'Acme' },
        );
        expect(t.title).toBe('Estableciste Email en yo@x.com');
    });

    it('alta y varios cambios', () => {
        expect(portalActivityText({ id: 3, action: 'record_created', created_at: '', user_id: null, diff: {} }, fields, { mine: false, company: 'Acme' }).title).toBe(
            'Acme creó este registro',
        );
        const many = portalActivityText(
            { id: 4, action: 'record_updated', created_at: '', user_id: null, diff: { f1: { from: null, to: 'pagado' }, f2: { from: 'a@x.com', to: null } } },
            fields,
            { mine: false, company: 'Acme' },
        );
        expect(many.title).toBe('Acme cambió 2 datos');
        expect(many.lines).toEqual(['Estableció Estado en Pagado', 'Vació Email']);
    });
});

describe('lista pública — campos por id', () => {
    const f = [
        { id: 10, slug: 'nombre' },
        { id: 11, slug: 'monto' },
    ];
    it('traduce slugs a ids (los desconocidos se descartan)', () => {
        expect(publicFieldIds(['monto', 'nada', 'nombre'], f)).toEqual([11, 10]);
        expect(publicDefaultSort('monto:desc', f)).toEqual({ default_sort_field_id: 11, default_sort_dir: 'desc' });
        expect(publicDefaultSort('', f)).toEqual({ default_sort_field_id: null, default_sort_dir: 'asc' });
    });
});
