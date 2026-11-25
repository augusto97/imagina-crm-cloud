import { describe, expect, it } from 'vitest';

import type { ActionSpec } from '@/types/automation';
import type { FieldEntity } from '@/types/field';

import { actionMetaFor, onErrorBadge, summarizeAction } from './automationMeta';
import { isAutomationComment } from '@/hooks/useComments';
import type { CommentEntity } from '@/types/comment';

const field = (id: number, slug: string, label: string, type = 'text', config: Record<string, unknown> = {}): FieldEntity =>
    ({ id, slug, label, type, list_id: 1, config, is_required: false, is_unique: false, is_primary: false, position: id }) as unknown as FieldEntity;

const fields = [
    field(1, 'titulo', 'Título'),
    field(2, 'estado', 'Estado', 'select', { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'hecho', label: 'Hecho' }] }),
    field(3, 'monto', 'Monto', 'number'),
];

describe('v0.1.466 — «Comprobar y detener» y «Agregar un comentario» en el editor', () => {
    it('resume «Comprobar y detener» con las reglas en palabras (opciones por su etiqueta)', () => {
        const one: ActionSpec = { type: 'stop_unless', config: { condition: [{ field: 'estado', op: 'eq', value: 'pendiente' }] } };
        expect(summarizeAction(one, fields, [])).toBe('Sigue sólo si «Estado» es «Pendiente»; si no, se detiene');
        const two: ActionSpec = {
            type: 'stop_unless',
            config: { condition: [{ field: 'monto', op: 'gt', value: 100 }, { field: 'titulo', op: 'is_not_null' }] },
        };
        expect(summarizeAction(two, fields, [])).toBe('Sigue sólo si «Monto» es mayor que «100» y 1 regla más; si no, se detiene');
        expect(summarizeAction({ type: 'stop_unless', config: {} }, fields, [])).toBe('Falta elegir la condición');
        // No lleva «Si este paso falla»: nunca falla.
        expect(onErrorBadge({ type: 'stop_unless', config: {}, on_error: { mode: 'continue' } } as ActionSpec)).toBeNull();
        expect(actionMetaFor('stop_unless').title).toBe('Comprobar y detener');
    });

    it('resume «Agregar un comentario» con quién lo ve y el comienzo del texto', () => {
        expect(summarizeAction({ type: 'add_comment', config: { body: 'Llamar a {{titulo}}\nmañana' } }, fields, [])).toBe('Deja una nota interna: «Llamar a {{titulo}} mañana»');
        expect(summarizeAction({ type: 'add_comment', config: { body: 'Recibimos tu pago', visibility: 'client', target: 'item' } }, fields, [])).toBe(
            'Comenta (visible para el cliente) en el registro vinculado: «Recibimos tu pago»',
        );
        expect(summarizeAction({ type: 'add_comment', config: { body: 'x'.repeat(80) } }, fields, [])).toBe(`Deja una nota interna: «${'x'.repeat(60)}…»`);
        expect(actionMetaFor('add_comment').title).toBe('Agregar un comentario');
    });

    it('reconoce un comentario que dejó una automatización (sólo con la marca y sin persona detrás)', () => {
        const base = { id: 1, list_id: 1, record_id: 1, parent_id: null, content: 'x', created_at: '', updated_at: '' } as unknown as CommentEntity;
        expect(isAutomationComment({ ...base, user_id: 0, metadata: { automation: { id: 4, name: 'Aviso' } } })).toBe(true);
        expect(isAutomationComment({ ...base, user_id: 7, metadata: { automation: { id: 4, name: 'Aviso' } } })).toBe(false);
        expect(isAutomationComment({ ...base, user_id: 0, metadata: {} })).toBe(false);
    });
});
