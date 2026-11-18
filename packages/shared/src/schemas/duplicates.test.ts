import { describe, expect, it } from 'vitest';
import {
    DUP_FOLD_FROM,
    DUP_FOLD_TO,
    MERGE_CHOICE_UNION,
    duplicateKey,
    duplicateRuleKey,
    foldDuplicateText,
    mergeResolveValue,
    mergeSuggestedChoice,
    mergeValuesDiffer,
    readDuplicateSettings,
    suggestDuplicateRules,
} from './duplicates';

const f = (id: number, type: string, label: string, slug = label.toLowerCase()) => ({ id, type: type as never, label, slug });

describe('duplicados — claves comparables', () => {
    it('la tabla de letras tiene el mismo largo (translate en SQL)', () => {
        expect([...DUP_FOLD_FROM].length).toBe([...DUP_FOLD_TO].length);
    });

    it('texto sin mayúsculas, tildes ni puntuación', () => {
        expect(foldDuplicateText('  ACME S.A.S. ')).toBe('acme s a s');
        expect(duplicateKey('text', 'José  Pérez')).toBe(duplicateKey('text', 'jose perez'));
        expect(duplicateKey('text', 'Ñandú')).toBe('nandu');
        expect(duplicateKey('text', '   ')).toBe('');
        expect(duplicateKey('text', null)).toBe('');
        expect(duplicateKey('text', ['a'])).toBe('');
    });

    it('teléfono con o sin indicativo, correo y enlace', () => {
        expect(duplicateKey('phone', '+57 300 111 2233')).toBe('3001112233');
        expect(duplicateKey('phone', '3001112233')).toBe('3001112233');
        expect(duplicateKey('phone', '123')).toBe('');
        expect(duplicateKey('email', ' Ana@Acme.co ')).toBe('ana@acme.co');
        expect(duplicateKey('url', 'https://www.Acme.co/')).toBe('acme.co');
        expect(duplicateKey('number', '1500,50')).toBe('1500.5');
        expect(duplicateKey('number', 'abc')).toBe('');
        expect(duplicateKey('date', '2026-07-30T10:00:00Z')).toBe('2026-07-30');
    });

    it('regla de varios campos: todos tienen que tener valor', () => {
        const byId = new Map([
            [1, { type: 'text' as const }],
            [2, { type: 'text' as const }],
        ]);
        expect(duplicateRuleKey([1, 2], byId, { f1: 'Ana', f2: 'Cali' })).not.toBe('');
        expect(duplicateRuleKey([1, 2], byId, { f1: 'Ana' })).toBe('');
        expect(duplicateRuleKey([1, 2], byId, { f1: 'ANA', f2: 'cali' })).toBe(duplicateRuleKey([1, 2], byId, { f1: 'ana', f2: 'Cali ' }));
    });
});

describe('duplicados — reglas', () => {
    const fields = [f(1, 'text', 'Nombre'), f(2, 'email', 'Correo'), f(3, 'phone', 'Celular'), f(4, 'text', 'NIT'), f(5, 'text', 'Ciudad')];

    it('sugiere correo, teléfono y documento; sin ellos, el título', () => {
        expect(suggestDuplicateRules(fields)).toEqual([[2], [3], [4]]);
        expect(suggestDuplicateRules([f(1, 'text', 'Nombre'), f(5, 'text', 'Ciudad')])).toEqual([[1]]);
        expect(suggestDuplicateRules([f(9, 'number', 'Monto')])).toEqual([]);
    });

    it('lectura tolerante: reglas propias limpias, apagado y avisos', () => {
        const s = readDuplicateSettings({ duplicates: { rules: [{ fields: [1, 5, 99] }, { fields: [77] }], warn_on_create: false } }, fields);
        expect(s.custom).toBe(true);
        expect(s.rules).toEqual([[1, 5]]);
        expect(s.warn_on_create).toBe(false);
        expect(s.enabled).toBe(true);
        expect(readDuplicateSettings({ duplicates: { rules: [] } }, fields).rules).toEqual([]);
        expect(readDuplicateSettings({ duplicates: 'x' }, fields).rules).toEqual([[2], [3], [4]]);
        expect(readDuplicateSettings({ duplicates: { enabled: false } }, fields).enabled).toBe(false);
    });
});

describe('fusionar — elegir valores', () => {
    const ids = [10, 20, 30];

    it('sugiere el del que queda, el primero con algo o juntar', () => {
        expect(mergeSuggestedChoice('text', null, ids, ['Acme', 'ACME SAS', null])).toBe(10);
        expect(mergeSuggestedChoice('text', null, ids, ['', 'ACME SAS', 'x'])).toBe(20);
        expect(mergeSuggestedChoice('multi_select', null, ids, [['a'], ['b'], ['a']])).toBe(MERGE_CHOICE_UNION);
        expect(mergeSuggestedChoice('multi_select', null, ids, [['a'], ['a'], []])).toBe(10);
        expect(mergeSuggestedChoice('team', { multiple: false }, ids, [[1], [2], null])).toBe(10);
    });

    it('juntar sin repetir y respetando el máximo de archivos', () => {
        expect(mergeResolveValue('multi_select', null, ids, [['a', 'b'], ['b', 'c'], null], MERGE_CHOICE_UNION)).toEqual(['a', 'b', 'c']);
        expect(mergeResolveValue('file', { max_files: 2 }, ids, [[1], [2, 3], [4]], MERGE_CHOICE_UNION)).toEqual([1, 2]);
        expect(mergeResolveValue('text', null, ids, ['a', 'b', 'c'], 30)).toBe('c');
        expect(mergeResolveValue('text', null, ids, ['a', 'b', 'c'], 99)).toBe('a');
        expect(mergeResolveValue('text', null, ids, ['a', 'b', 'c'], MERGE_CHOICE_UNION)).toBe('a');
    });

    it('detecta si los valores difieren', () => {
        expect(mergeValuesDiffer(['a', 'a', null])).toBe(false);
        expect(mergeValuesDiffer(['a', 'b'])).toBe(true);
        expect(mergeValuesDiffer([['x'], ['x']])).toBe(false);
    });
});
