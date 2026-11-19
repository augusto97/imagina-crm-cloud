import { describe, expect, it } from 'vitest';

import type { FieldEntity } from '@/types/field';

import { aiDraftExamples, draftToFormState, formStateAsVersion, formStateToCurrent, hasAutomationContent } from './aiDraft';
import { describeVersionChanges } from './automationMeta';

const field = (id: number, slug: string, label: string, type = 'text', config: Record<string, unknown> = {}): FieldEntity =>
    ({ id, slug, label, type, list_id: 1, config, is_required: false, is_unique: false, is_primary: false, position: id }) as unknown as FieldEntity;

const facturas: FieldEntity[] = [
    field(1, 'titulo', 'Título'),
    field(2, 'estado', 'Estado', 'select', {
        options: [
            { value: 'pendiente', label: 'Pendiente' },
            { value: 'pagada', label: 'Pagada' },
            { value: 'vencida', label: 'Vencida' },
        ],
    }),
    field(3, 'correo', 'Correo del cliente', 'email'),
    field(4, 'vence', 'Vence', 'date'),
    field(5, 'responsable', 'Responsable', 'user'),
];

describe('«Describir con IA»: ejemplos con los campos de la lista (v0.1.463)', () => {
    it('arma 3-4 ejemplos con los nombres reales y la opción que pide atención', () => {
        const ex = aiDraftExamples(facturas);
        expect(ex.length).toBeGreaterThanOrEqual(3);
        expect(ex.length).toBeLessThanOrEqual(4);
        expect(ex[0]).toContain('«Estado»');
        // «Pendiente» va antes que «Vencida» en la lista: gana la primera que suena a atender.
        expect(ex[0]).toContain('«Pendiente»');
        expect(ex[0]).toContain('«Correo del cliente»');
        expect(ex.some((e) => e.includes('«Vence»') && e.includes('«Responsable»'))).toBe(true);
    });

    it('sin campos especiales igual ofrece ejemplos genéricos', () => {
        const ex = aiDraftExamples([field(1, 'nombre', 'Nombre')]);
        expect(ex.length).toBeGreaterThanOrEqual(2);
        expect(ex.every((e) => e.trim().length > 10)).toBe(true);
    });

    it('al pedir un cambio, los ejemplos hablan de cambiar lo que hay', () => {
        const ex = aiDraftExamples(facturas, 'change');
        expect(ex).toHaveLength(4);
        expect(ex.some((e) => e.includes('«Correo del cliente»'))).toBe(true);
    });
});

describe('«Describir con IA»: ida y vuelta con el editor', () => {
    const draft = {
        name: 'Aviso de vencidas',
        description: null,
        trigger_type: 'record_updated',
        trigger_config: { changed_fields: ['estado'] },
        actions: [
            { type: 'send_email', config: { to: '{{correo}}', subject: 'Tu factura venció' } },
            { type: 'wait', config: { mode: 'duration', amount: 2, unit: 'days' } },
        ],
        is_active: false,
    };

    it('lo que vuelve del servidor entra al editor sin compartir referencias', () => {
        const s = draftToFormState(draft);
        expect(s).toMatchObject({ name: 'Aviso de vencidas', description: '', triggerType: 'record_updated', isActive: false });
        expect(s.actions).toHaveLength(2);
        (s.actions[0]!.config as Record<string, unknown>).subject = 'otro';
        expect(draft.actions[0]!.config.subject).toBe('Tu factura venció');
    });

    it('lo del editor viaja como «la automatización actual» (sin nombre, uno por defecto)', () => {
        const s = { ...draftToFormState(draft), name: '  ', description: ' nota ' };
        const cur = formStateToCurrent(s, 12);
        expect(cur).toMatchObject({ id: 12, description: 'nota', trigger_type: 'record_updated', is_active: false });
        expect(cur.name.length).toBeGreaterThan(0);
        expect(formStateToCurrent(draftToFormState(draft))).not.toHaveProperty('id');
    });

    it('«qué cambió» usa la misma comparación del historial de versiones', () => {
        const before = draftToFormState(draft);
        const after = {
            ...before,
            actions: [...before.actions, { type: 'notify_in_app', config: { title: 'Sigue vencida' } }],
        };
        const lines = describeVersionChanges(formStateAsVersion(before), formStateAsVersion(after), facturas, []);
        expect(lines.some((l) => l.startsWith('Agregó'))).toBe(true);
        expect(describeVersionChanges(formStateAsVersion(before), formStateAsVersion(before), facturas, [])).toEqual([
            'Sin cambios respecto de la versión anterior.',
        ]);
    });

    it('con pasos o con un disparador ya elegido, la IA cambia lo que hay en vez de armar de cero', () => {
        const empty = { name: '', description: '', triggerType: 'record_created', triggerConfig: {}, actions: [], isActive: true };
        expect(hasAutomationContent(empty)).toBe(false);
        expect(hasAutomationContent({ ...empty, triggerConfig: { field_filters: {}, changed_fields: [] } })).toBe(false);
        expect(hasAutomationContent({ ...empty, triggerType: 'button_pressed' })).toBe(true);
        expect(hasAutomationContent({ ...empty, triggerConfig: { button_field_id: 4 } })).toBe(true);
        expect(hasAutomationContent({ ...empty, actions: [{ type: 'wait', config: {} }] })).toBe(true);
    });
});
