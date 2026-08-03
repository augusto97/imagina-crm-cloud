import { describe, expect, it } from 'vitest';

import type { FieldEntity } from '@/types/field';
import type { ActivityEntity } from '@/types/activity';

import { actorOf, changeSentence, changesOf, summarizeActivity } from './activityText';

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
});
