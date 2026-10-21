import { describe, expect, it } from 'vitest';

import { applyDraftChange, draftPatch, editsAfterSave } from './recordDraft';

describe('recordDraft', () => {
    it('sólo registra lo que la persona tocó', () => {
        const base = { nombre: 'Acme', estado: 'activo', monto: 10 };
        const edits = applyDraftChange(base, {}, { ...base, nombre: 'Acme SA' });
        expect(edits).toEqual({ nombre: 'Acme SA' });
        expect(draftPatch(base, edits)).toEqual({ nombre: 'Acme SA' });
    });

    it('un cambio externo en otro campo NO ensucia el borrador ni se revierte al guardar', () => {
        const base = { nombre: 'Acme', estado: 'activo' };
        const edits = applyDraftChange(base, {}, { ...base, nombre: 'Acme SA' });
        // Llega del servidor: alguien pasó el estado a inactivo.
        const fresh = { nombre: 'Acme', estado: 'inactivo' };
        const patch = draftPatch(fresh, edits);
        expect(patch).toEqual({ nombre: 'Acme SA' });
        expect(patch).not.toHaveProperty('estado');
    });

    it('volver al valor del servidor deja de ser una edición', () => {
        const base = { nombre: 'Acme' };
        let edits = applyDraftChange(base, {}, { nombre: 'X' });
        edits = applyDraftChange(base, edits, { nombre: 'Acme' });
        expect(edits).toEqual({});
    });

    it('si el servidor ya tiene lo editado, no hay nada que mandar', () => {
        const edits = { nombre: 'Acme SA' };
        expect(draftPatch({ nombre: 'Acme SA' }, edits)).toEqual({});
    });

    it('tras guardar, lo tipeado durante el guardado sigue pendiente', () => {
        const sent = { nombre: 'Acme S' };
        const edits = { nombre: 'Acme SA', ciudad: 'Bogotá' };
        expect(editsAfterSave(edits, sent)).toEqual({ nombre: 'Acme SA', ciudad: 'Bogotá' });
        expect(editsAfterSave({ nombre: 'Acme S' }, sent)).toEqual({});
    });
});
