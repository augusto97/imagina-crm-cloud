import { describe, expect, it } from 'vitest';

import { duplicateOutcome, failureReasons, undoDuplicateOutcome } from './quickDuplicate';

const base = { succeeded: [] as number[], unchanged: [] as number[], failed: [] as Array<{ id: number; message: string }>, created: 0, edit_id: 7 as number | null };

describe('duplicar en un clic — el aviso', () => {
    it('un registro sin subtareas: verde, sin descripción y con Deshacer', () => {
        const out = duplicateOutcome(1, { ...base, succeeded: [10], created: 1 });
        expect(out).toEqual({ variant: 'success', title: 'Registro duplicado', canUndo: true });
    });

    it('cuenta las subtareas copiadas aparte de los registros', () => {
        const out = duplicateOutcome(1, { ...base, succeeded: [10], created: 4 });
        expect(out.title).toBe('Registro duplicado');
        expect(out.description).toBe('Con sus 3 subtareas.');
        expect(duplicateOutcome(1, { ...base, succeeded: [10], created: 2 }).description).toBe('Con 1 subtarea.');
    });

    it('varios registros: el título dice cuántos', () => {
        expect(duplicateOutcome(3, { ...base, succeeded: [1, 2, 3], created: 3 }).title).toBe('3 registros duplicados');
    });

    it('si nada salió: rojo con el motivo y sin Deshacer', () => {
        const out = duplicateOutcome(1, { ...base, failed: [{ id: 5, message: 'Llegaste al límite de registros de tu plan.' }], edit_id: null });
        expect(out.variant).toBe('error');
        expect(out.title).toBe('No se pudo duplicar el registro');
        expect(out.description).toBe('Llegaste al límite de registros de tu plan.');
        expect(out.canUndo).toBe(false);
    });

    it('si salió una parte: ámbar, cuántos de cuántos y los motivos sin repetir', () => {
        const out = duplicateOutcome(3, {
            ...base,
            succeeded: [1],
            created: 1,
            failed: [
                { id: 2, message: 'El registro ya no existe o no lo puedes tocar.' },
                { id: 3, message: 'El registro ya no existe o no lo puedes tocar.' },
            ],
        });
        expect(out.variant).toBe('warning');
        expect(out.title).toBe('Se duplicaron 1 de 3 registros');
        expect(out.description).toBe('El registro ya no existe o no lo puedes tocar.');
        expect(out.canUndo).toBe(true);
    });

    it('una subtarea que va con su padre no cuenta como falla', () => {
        const out = duplicateOutcome(2, { ...base, succeeded: [1], unchanged: [2], created: 2 });
        expect(out.variant).toBe('success');
        expect(out.title).toBe('Registro duplicado');
        expect(out.description).toBe('Con 1 subtarea.');
    });

    it('los motivos: hasta dos y «y N más»', () => {
        expect(failureReasons([])).toBeUndefined();
        expect(failureReasons([{ message: 'a' }, { message: 'b' }, { message: 'c' }, { message: 'a' }, { message: 'd' }])).toBe('a · b · y 2 motivos más');
    });
});

describe('deshacer un duplicado — el aviso', () => {
    it('quitó la copia', () => {
        expect(undoDuplicateOutcome({ reverted: 1, conflicts: 0, failed: [] }, 0)).toEqual({ variant: 'success', title: 'Se quitó la copia' });
        expect(undoDuplicateOutcome({ reverted: 3, conflicts: 0, failed: [] }, 0).title).toBe('Se quitaron 3 copias');
    });

    it('una copia que alguien editó queda, y se dice', () => {
        const out = undoDuplicateOutcome({ reverted: 2, conflicts: 0, failed: [] }, 1);
        expect(out.variant).toBe('warning');
        expect(out.description).toBe('1 quedó porque alguien la editó.');
        expect(undoDuplicateOutcome({ reverted: 0, conflicts: 0, failed: [] }, 1).title).toBe('No se quitó la copia');
    });

    it('si falló: rojo con el motivo', () => {
        const out = undoDuplicateOutcome({ reverted: 0, conflicts: 0, failed: [{ item_id: 1, title: 'X', message: 'No tienes permiso para borrar.' }] }, 0);
        expect(out).toEqual({ variant: 'error', title: 'No se pudo deshacer', description: 'No tienes permiso para borrar.' });
    });
});
