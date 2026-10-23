import { describe, expect, it } from 'vitest';

import {
    applyCompletion,
    completionContext,
    functionInsertText,
    highlightSegments,
    signatureContext,
} from './formulaEditing';
import { findFormulaFunction } from '@imagina-base/shared';

describe('fórmulas — autocompletar (A1)', () => {
    it('después de { sugiere campos con lo que se escribió', () => {
        const text = 'SI({Tot';
        const ctx = completionContext(text, text.length);
        expect(ctx).toEqual({ kind: 'field', query: 'Tot', start: 3, end: text.length });
    });

    it('si la llave ya está cerrada, la sugerencia la reemplaza entera', () => {
        const text = '{Pre} * 2';
        const ctx = completionContext(text, 3);
        expect(ctx).toMatchObject({ kind: 'field', query: 'Pr', start: 0, end: 5 });
        const next = applyCompletion(text, ctx!, '{Precio}');
        expect(next.text).toBe('{Precio} * 2');
        expect(next.caret).toBe(8);
    });

    it('letras sueltas fuera de un texto sugieren funciones; dentro de un texto, nada', () => {
        expect(completionContext('red', 3)).toEqual({ kind: 'function', query: 'red', start: 0, end: 3 });
        expect(completionContext('SI({A} > 1, "gra', 16)).toBeNull();
        expect(completionContext('1.5', 3)).toBeNull();
        expect(completionContext('{A} + ', 6)).toBeNull();
    });

    it('elegir una función abre su paréntesis (y la sin argumentos lo cierra)', () => {
        const si = findFormulaFunction('SI')!;
        const hoy = findFormulaFunction('HOY')!;
        expect(functionInsertText(si, undefined)).toEqual({ insert: 'SI(', caretOffset: 3 });
        expect(functionInsertText(hoy, undefined)).toEqual({ insert: 'HOY()', caretOffset: 5 });
        // Si ya hay un paréntesis después, no se duplica.
        expect(functionInsertText(si, '(')).toEqual({ insert: 'SI', caretOffset: 3 });
    });
});

describe('fórmulas — firma de la función (A1)', () => {
    it('dice en qué argumento está el cursor, también anidado', () => {
        const text = 'SI({Total} > 10, REDONDEAR({Precio}, ';
        const sig = signatureContext(text, text.length);
        expect(sig?.fn.name).toBe('REDONDEAR');
        expect(sig?.argIndex).toBe(1);
        const outer = 'SI({Total} > 10, ';
        expect(signatureContext(outer, outer.length)).toMatchObject({ argIndex: 1 });
        expect(signatureContext(outer, outer.length)?.fn.name).toBe('SI');
    });

    it('las comas dentro de un texto o de un campo no cuentan', () => {
        const text = 'CONCATENAR("a, b", {Ciudad, país}, ';
        expect(signatureContext(text, text.length)?.argIndex).toBe(2);
    });

    it('fuera de una función no hay firma', () => {
        expect(signatureContext('{A} + 1', 7)).toBeNull();
    });
});

describe('fórmulas — resaltado (A1)', () => {
    it('separa funciones, campos, textos, números y operadores', () => {
        const text = 'SI({Total} > 1000, "Grande", "Chico")';
        const kinds = highlightSegments(text).map((s) => [s.kind, text.slice(s.start, s.end)]);
        expect(kinds).toContainEqual(['fn', 'SI']);
        expect(kinds).toContainEqual(['ref', '{Total}']);
        expect(kinds).toContainEqual(['num', '1000']);
        expect(kinds).toContainEqual(['str', '"Grande"']);
        expect(kinds).toContainEqual(['op', '>']);
    });

    it('el texto a medio escribir se pinta igual y cubre todo', () => {
        const text = 'SI({Tot';
        const segs = highlightSegments(text);
        expect(segs.at(-1)?.end).toBe(text.length);
        expect(segs.map((s) => text.slice(s.start, s.end)).join('')).toBe(text);
    });
});
