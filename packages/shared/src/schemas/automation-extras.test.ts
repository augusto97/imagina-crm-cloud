import { describe, expect, it } from 'vitest';
import {
    addedFileIds,
    autoMapCopyFields,
    automationExtraActionIssues,
    automationExtraTriggerIssues,
    copyTypesCompatible,
    countFilterConditions,
    describeFileTrigger,
    describeRecordMatchesTrigger,
    extraActionResponseName,
    fileEventValue,
    fileKindMatches,
    filterFieldIds,
    humanFileSize,
    humanFileType,
    pickLeastOpen,
    pickRoundRobin,
    readAssignRoundRobinConfig,
    readCopyRecordConfig,
    readFileAddedConfig,
    readNotifyInAppConfig,
    readRecordMatchesConfig,
} from './automation-extras';

const tree = {
    type: 'group',
    logic: 'and',
    children: [
        { type: 'condition', field_id: 4, op: 'eq', value: 'urgente' },
        { type: 'group', logic: 'or', children: [{ type: 'condition', field_id: 5, op: 'is_null' }, { type: 'condition', field_id: 4, op: 'neq', value: 'x' }] },
    ],
};

describe('v0.1.455 — disparadores y acciones nuevas (puro)', () => {
    it('«empieza a cumplir»: lectura tolerante, conteo y resumen', () => {
        expect(readRecordMatchesConfig(undefined)).toEqual({ filter: null, onCreate: true });
        expect(readRecordMatchesConfig({ match_filter: [1], match_on_create: false })).toEqual({ filter: null, onCreate: false });
        const c = readRecordMatchesConfig({ match_filter: tree });
        expect(countFilterConditions(c.filter)).toBe(3);
        expect(filterFieldIds(c.filter)).toEqual([4, 5]);
        expect(describeRecordMatchesTrigger(c)).toBe('Cuando un registro empieza a cumplir 3 condiciones');
        expect(describeRecordMatchesTrigger({ filter: null, onCreate: true })).toBe('Cuando un registro empieza a cumplir una condición');
        expect(automationExtraTriggerIssues('record_matches', {})).toHaveLength(1);
        expect(automationExtraTriggerIssues('record_matches', { match_filter: tree })).toEqual([]);
        expect(automationExtraTriggerIssues('record_updated', {})).toEqual([]);
    });

    it('«se sube un archivo»: tipo, ids que llegaron y variables', () => {
        expect(readFileAddedConfig({ file_field_id: '9', file_kind: 'raro' })).toEqual({ fieldId: 9, kind: 'any' });
        expect(fileKindMatches('pdf', 'application/pdf', 'x')).toBe(true);
        expect(fileKindMatches('pdf', '', 'Factura.PDF')).toBe(true);
        expect(fileKindMatches('image', 'image/png', 'a.png')).toBe(true);
        expect(fileKindMatches('image', 'application/pdf', 'a.pdf')).toBe(false);
        expect(addedFileIds([1, 2], [2, 3, 4])).toEqual([3, 4]);
        expect(addedFileIds(null, [7])).toEqual([7]);
        expect(addedFileIds([7], [])).toEqual([]);
        expect(humanFileSize(245_000)).toBe('239 KB');
        expect(humanFileSize(2_500_000)).toBe('2.4 MB');
        expect(humanFileType('application/pdf', 'a.pdf')).toBe('PDF');
        expect(humanFileType('', 'hoja.xlsx')).toBe('XLSX');
        const ev = { id: 3, name: 'cot.pdf', mime: 'application/pdf', size: 1024, field_id: 2, field_label: 'Adjuntos', link: 'https://x', count: 2 };
        expect(fileEventValue(ev, 'nombre')).toBe('cot.pdf');
        expect(fileEventValue(ev, 'campo')).toBe('Adjuntos');
        expect(fileEventValue(ev, 'cantidad')).toBe('2');
        expect(fileEventValue(ev, 'otro')).toBeUndefined();
        expect(fileEventValue(undefined, 'nombre')).toBe('');
        expect(describeFileTrigger({ fieldId: 2, kind: 'image' }, 'Fotos')).toBe('Cuando se sube una imagen a «Fotos»');
    });

    it('«Avisar en la app» y «Asignar por turno»: validación y elección', () => {
        expect(readNotifyInAppConfig({ notify_user_ids: [3, 3, 'x', -1, 4] }).userIds).toEqual([3, 4]);
        expect(automationExtraActionIssues('notify_in_app', {}, 'actions[0]').map((i) => i.path)).toEqual(['actions[0].config.title', 'actions[0].config.notify_user_ids']);
        expect(automationExtraActionIssues('notify_in_app', { title: 'Hola', include_actor: true }, 'a')).toEqual([]);
        expect(readAssignRoundRobinConfig({}).onlyIfEmpty).toBe(true);
        expect(readAssignRoundRobinConfig({ assign_mode: 'x' }).mode).toBe('round_robin');
        expect(automationExtraActionIssues('assign_round_robin', { person_field_id: 3 }, 'a')).toHaveLength(1);
        expect(automationExtraActionIssues('assign_round_robin', { person_field_id: 3, team_id: 8 }, 'a')).toEqual([]);
        expect(pickRoundRobin(['a', 'b', 'c'], 4)).toBe('b');
        expect(pickRoundRobin([], 1)).toBeNull();
        expect(pickLeastOpen([{ id: 1, open: 3 }, { id: 2, open: 1 }, { id: 3, open: 1 }])).toEqual({ id: 2, open: 1 });
    });

    it('«Copiar a otra lista»: compatibilidad, mapeo por nombre y nombre del resultado', () => {
        expect(readCopyRecordConfig({ target_list_id: 5 })).toMatchObject({ listId: 5, autoMap: true, copyFiles: true, responseName: 'copia' });
        expect(copyTypesCompatible({ id: 1, label: 'a', type: 'select' }, { id: 2, label: 'a', type: 'text' })).toBe(true);
        expect(copyTypesCompatible({ id: 1, label: 'a', type: 'text' }, { id: 2, label: 'a', type: 'number' })).toBe(false);
        expect(copyTypesCompatible({ id: 1, label: 'a', type: 'currency' }, { id: 2, label: 'a', type: 'number' })).toBe(true);
        expect(copyTypesCompatible({ id: 1, label: 'a', type: 'computed' }, { id: 2, label: 'a', type: 'number' })).toBe(false);
        const rel = (id: number, target: number) => ({ id, label: 'Cliente', type: 'relation', config: { target_list_id: target } });
        expect(copyTypesCompatible(rel(1, 9), rel(2, 9))).toBe(true);
        expect(copyTypesCompatible(rel(1, 9), rel(2, 8))).toBe(false);
        const source = [
            { id: 1, label: 'Título', type: 'text' },
            { id: 2, label: 'Monto', type: 'currency' },
            { id: 3, label: 'Archivos', type: 'file' },
            { id: 4, label: 'Notas', type: 'number' },
        ];
        const target = [
            { id: 11, label: 'titulo', type: 'text' },
            { id: 12, label: 'MONTO', type: 'number' },
            { id: 13, label: 'Archivos', type: 'file' },
            { id: 14, label: 'Notas', type: 'long_text' },
        ];
        expect(autoMapCopyFields(source, target, { copyFiles: true }).map((p) => [p.from.id, p.to.id])).toEqual([[1, 11], [2, 12], [3, 13]]);
        expect(autoMapCopyFields(source, target, { copyFiles: false }).map((p) => p.to.id)).toEqual([11, 12]);
        expect(automationExtraActionIssues('copy_record', {}, 'a')).toHaveLength(1);
        expect(automationExtraActionIssues('copy_record', { target_list_id: 5, auto_map: false }, 'a')).toHaveLength(1);
        expect(automationExtraActionIssues('copy_record', { target_list_id: 5, response_name: '9mal' }, 'a')).toHaveLength(1);
        expect(extraActionResponseName('copy_record', { response_name: 'Pedido' })).toBe('pedido');
        expect(extraActionResponseName('notify_in_app', {})).toBeNull();
    });
});
