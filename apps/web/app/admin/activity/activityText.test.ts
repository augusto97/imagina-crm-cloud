import { describe, expect, it } from 'vitest';

import type { FieldEntity } from '@/types/field';
import type { ActivityEntity } from '@/types/activity';

import { actionText, actorOf, buttonPressOf, changeSentence, changesOf, checklistText, formatActivityValue, summarizeActivity, templateAppliedText } from './activityText';

const field = (over: Partial<FieldEntity> & { id: number; slug: string }): FieldEntity =>
    ({
        label: over.slug,
        type: 'text',
        config: {},
        position: 0,
        required: false,
        ...over,
    }) as FieldEntity;

const FIELDS: FieldEntity[] = [
    field({ id: 101, slug: 'estado', label: 'Estado', type: 'select', config: {
        options: [
            { value: 'activo', label: 'Activo', color: 'green' },
            { value: 'pausado', label: 'Pausado', color: 'amber' },
        ],
    } }),
    field({ id: 102, slug: 'ciudad', label: 'Ciudad' }),
    field({ id: 103, slug: 'vence', label: 'Vence', type: 'date', config: {} }),
];

const entry = (over: Partial<ActivityEntity>): ActivityEntity => ({
    id: 1,
    list_id: 1,
    record_id: 1,
    user_id: 2,
    user_name: 'Augusto Peralta',
    action: 'record_updated',
    changes: {},
    created_at: '2026-07-31 10:00:00',
    ...over,
});

describe('activityText', () => {
    it('traduce la clave f{id} del diff al campo y su etiqueta', () => {
        const changes = changesOf(
            entry({ changes: { f101: { from: 'activo', to: 'pausado' } } }),
            FIELDS,
        );
        expect(changes).toHaveLength(1);
        expect(changes[0]!.label).toBe('Estado');
        expect(changes[0]!.field?.id).toBe(101);
    });

    it('no esconde el cambio de un campo que ya no existe', () => {
        const changes = changesOf(entry({ changes: { f999: { from: 'a', to: 'b' } } }), FIELDS);
        expect(changes[0]!.label).toBe('f999');
    });

    it('distingue establecer, cambiar y vaciar', () => {
        const [set] = changesOf(entry({ changes: { f102: { from: null, to: 'Bogotá' } } }), FIELDS);
        const [changed] = changesOf(
            entry({ changes: { f102: { from: 'Bogotá', to: 'Medellín' } } }),
            FIELDS,
        );
        const [cleared] = changesOf(
            entry({ changes: { f102: { from: 'Bogotá', to: null } } }),
            FIELDS,
        );
        expect(changeSentence(set!)).toEqual({ verb: 'estableció', from: null, to: 'Bogotá' });
        expect(changeSentence(changed!).verb).toBe('cambió');
        expect(changeSentence(cleared!)).toEqual({ verb: 'vació', from: 'Bogotá', to: null });
    });

    it('usa la ETIQUETA de la opción, no su valor interno', () => {
        const [c] = changesOf(entry({ changes: { f101: { from: 'activo', to: 'pausado' } } }), FIELDS);
        expect(changeSentence(c!)).toEqual({ verb: 'cambió', from: 'Activo', to: 'Pausado' });
    });

    it('arma la frase completa con quién y qué', () => {
        const text = summarizeActivity(
            entry({ changes: { f101: { from: 'activo', to: 'pausado' } } }),
            FIELDS,
        );
        expect(text).toBe('Augusto Peralta cambió Estado de Activo a Pausado');
    });

    it('reconoce las dos ortografías de la acción y el alta sin diff', () => {
        expect(summarizeActivity(entry({ action: 'record_created' }), FIELDS)).toBe(
            'Augusto Peralta creó este registro',
        );
        expect(summarizeActivity(entry({ action: 'record.created' }), FIELDS)).toBe(
            'Augusto Peralta creó este registro',
        );
    });

    it('cae a "El sistema" cuando no hay usuario (automatización, import)', () => {
        expect(actorOf(entry({ user_id: null, user_name: null }))).toBe('El sistema');
        // Sin nombre pero con id (usuario borrado): al menos identifica cuál.
        expect(actorOf(entry({ user_id: 7, user_name: null }))).toBe('Usuario #7');
    });

    it('acepta el shape viejo before/after de las entradas del plugin', () => {
        const [c] = changesOf(
            entry({ changes: { estado: { before: 'activo', after: 'pausado' } } }),
            FIELDS,
        );
        expect(c!.label).toBe('Estado');
        expect(changeSentence(c!).to).toBe('Pausado');
    });
    it('porcentaje, duración, calificación y teléfono se leen como en la ficha (v0.1.255)', () => {
        expect(formatActivityValue(field({ id: 1, slug: 'avance', type: 'percent' }), 100)).toBe('100 %');
        expect(formatActivityValue(field({ id: 2, slug: 'tiempo', type: 'duration' }), 90)).toBe('1h 30m');
        expect(formatActivityValue(field({ id: 3, slug: 'tiempo2', type: 'duration', config: { format: 'clock' } }), 90)).toBe('1:30');
        expect(formatActivityValue(field({ id: 4, slug: 'nota', type: 'rating', config: { max: 5 } }), 4)).toBe('4 de 5');
        expect(formatActivityValue(field({ id: 5, slug: 'tel', type: 'phone' }), '+573001112233')).not.toBe('+573001112233');
    });

    it('la descripción se lee "editó la descripción", con las dos formas del diff', () => {
        const [c] = changesOf(entry({ changes: { description: { from: '', to: 'Plan de la mudanza' } } }), FIELDS);
        expect(c!.description).toBe(true);
        expect(changeSentence(c!)).toEqual({ verb: 'editó', from: null, to: 'Plan de la mudanza' });
        expect(summarizeActivity(entry({ changes: { description: { from: '', to: 'x' } } }), FIELDS)).toBe(
            'Augusto Peralta editó la descripción',
        );
        // Las entradas viejas ({old,new}) también dejan de verse vacías.
        const [old] = changesOf(entry({ changes: { description: { old: '…', new: '' } } }), FIELDS);
        expect(old!.description).toBe(true);
        expect(summarizeActivity(entry({ changes: { description: { old: '…', new: '' } } }), FIELDS)).toBe(
            'Augusto Peralta vació la descripción',
        );
    });

    it('los números llevan separador de miles, también si llegaron como texto', () => {
        const cantidad = field({ id: 9, slug: 'cantidad', type: 'number' });
        expect(formatActivityValue(cantidad, 150000)).toBe('150,000');
        expect(formatActivityValue(cantidad, '150000')).toBe('150,000');
    });
});

describe('actividad del campo «Botón»', () => {
    it('dice qué botón se presionó y, si falló, por qué', () => {
        const ok = entry({ action: 'button_pressed', changes: { button: { field_id: 9, label: 'Marcar como pagado', ok: true, actions: ['update_fields'] } } });
        expect(actionText(ok, changesOf(ok, FIELDS).length)).toBe('presionó «Marcar como pagado»');
        const bad = entry({ action: 'button_pressed', changes: { button: { label: 'Enviar', ok: false, error: 'Falta el enlace.' } } });
        expect(actionText(bad, 0)).toBe('presionó «Enviar» · falló: Falta el enlace.');
        expect(buttonPressOf(entry({ action: 'button_pressed', changes: {} })).label).toBe('un botón');
        // El diff del botón no se lee como cambios de campos.
        expect(changesOf(ok, FIELDS)).toEqual([]);
    });
});

describe('A9 / C6 · actividad de checklists y plantillas', () => {
    const e = (action: string, changes: Record<string, unknown>): ActivityEntity => entry({ action, changes });

    it('cada acción de checklist se lee en lenguaje claro', () => {
        expect(checklistText(e('checklist_created', { checklist: { id: 1, name: 'Arranque' }, count: 3 }))).toBe('agregó el checklist «Arranque» con 3 ítems');
        expect(checklistText(e('checklist_item_checked', { checklist: { id: 1, name: 'Arranque' }, item: { id: 2, text: 'Firmar' } }))).toBe('marcó «Firmar» como hecho en «Arranque»');
        expect(checklistText(e('checklist_items_added', { checklist: { id: 1, name: 'Arranque' }, count: 1, items: ['Llamar'] }))).toBe('agregó «Llamar» al checklist «Arranque»');
        expect(checklistText(e('checklist_item_updated', { checklist: { id: 1, name: 'A' }, item: { id: 2, text: 'X' }, changes: { text: { from: 'X', to: 'Y' } } }))).toBe('cambió el ítem «X» a «Y»');
        expect(checklistText(e('checklist_item_to_subtask', { checklist: { id: 1, name: 'A' }, item: { id: 2, text: 'Diseño' }, subtask_id: 9 }))).toBe('convirtió «Diseño» en subtarea');
    });

    it('actionText las enruta (y no cae en «actualizó este registro»)', () => {
        const x = e('checklist_item_unchecked', { checklist: { id: 1, name: 'A' }, item: { id: 2, text: 'B' } });
        expect(changesOf(x, FIELDS)).toEqual([]);
        expect(actionText(x, 0)).toBe('desmarcó «B» en «A»');
    });

    it('el registro que nació de una plantilla dice cuál y qué trajo', () => {
        expect(templateAppliedText(e('record_template_applied', { template: { id: 4, name: 'Nuevo cliente' }, subtasks: 3, checklists: 1 }))).toBe(
            'aplicó la plantilla «Nuevo cliente» (3 subtareas, 1 checklist)',
        );
    });
});
