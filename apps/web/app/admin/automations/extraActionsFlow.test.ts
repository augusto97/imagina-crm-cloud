import { describe, expect, it } from 'vitest';

import type { ActionSpec } from '@/types/automation';
import type { FieldEntity } from '@/types/field';

import { summarizeAction, summarizeTrigger } from './automationMeta';
import { variablesAt } from './flowVariables';

const field = (id: number, slug: string, label: string, type = 'text'): FieldEntity =>
    ({ id, slug, label, type, list_id: 1, config: {}, is_required: false, is_unique: false, is_primary: false, position: id }) as unknown as FieldEntity;

const fields = [field(3, 'responsable', 'Responsable', 'user'), field(5, 'archivos', 'Archivos', 'file')];

const flow = (): ActionSpec[] => [
    { type: 'assign_round_robin', config: { person_field_id: 3, team_id: 8, assign_mode: 'least_open' } },
    { type: 'copy_record', config: { target_list_id: 4, response_name: 'proyecto' } },
    { type: 'notify_in_app', config: { title: 'Nuevo: {{titulo}}', person_field_ids: [3], notify_user_ids: [7, 8] } },
];

describe('v0.1.455 — avisar, asignar por turno y copiar en el editor', () => {
    it('los pasos siguientes ven a la persona asignada y la copia, con su nombre', () => {
        expect(variablesAt(flow(), [0], {}, null)).toEqual([]);
        const after = variablesAt(flow(), [2], {}, null);
        expect(after.map((s) => s.title)).toEqual(['Copia «proyecto»', 'Persona asignada']);
        expect(after[0]!.items.map((i) => i.tag)).toEqual(['respuestas.proyecto.id', 'respuestas.proyecto.titulo', 'respuestas.proyecto.lista']);
        expect(after[1]!.items.map((i) => i.tag)).toEqual(['asignado.nombre', 'asignado.email', 'asignado.id']);
    });

    it('resume las acciones y los disparadores en palabras', () => {
        const lists = [{ id: 4, name: 'Proyectos' } as never];
        expect(summarizeAction(flow()[0]!, fields, lists)).toBe('Asigna «Responsable» entre un equipo · a quien tenga menos registros abiertos en esta lista');
        expect(summarizeAction(flow()[1]!, fields, lists)).toBe('Copia el registro a «Proyectos» · {{respuestas.proyecto.id}}');
        expect(summarizeAction(flow()[2]!, fields, lists)).toBe('Avisa en la app a «Responsable», 2 personas: «Nuevo: {{titulo}}»');
        expect(summarizeTrigger('file_added', { file_field_id: 5, file_kind: 'pdf' }, fields)).toBe('Cuando se sube un PDF a «Archivos»');
        expect(
            summarizeTrigger('record_matches', { match_filter: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: 3, op: 'is_null' }] } }, fields),
        ).toBe('Cuando un registro empieza a cumplir la condición');
    });
});
