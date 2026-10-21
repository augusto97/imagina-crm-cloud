import { validateFieldValue } from '@imagina-base/shared';
import { describe, expect, it } from 'vitest';

import { maxFilesOf, normalizeFileIds } from './fileIds';

describe('valor del campo Archivo', () => {
    it('siempre es una lista de ids (lo que exige el validador)', () => {
        expect(normalizeFileIds([3, 7])).toEqual([3, 7]);
        // Lo que dejaba el control viejo (un número suelto) no se pierde.
        expect(normalizeFileIds(12)).toEqual([12]);
        expect(normalizeFileIds('12')).toEqual([12]);
        expect(normalizeFileIds(null)).toEqual([]);
        expect(normalizeFileIds([4, 4, 'x', 0, -1, '9'])).toEqual([4, 9]);
    });

    it('lo que arma el control pasa la validación compartida', () => {
        const spec = { type: 'file' as const, config: { max_files: 2 }, is_required: false };
        expect(validateFieldValue(spec, normalizeFileIds([5, 6])).ok).toBe(true);
        // El número suelto de antes es justo lo que se rechazaba.
        expect(validateFieldValue(spec, 5).ok).toBe(false);
        expect(validateFieldValue(spec, normalizeFileIds([5, 6, 7])).ok).toBe(false);
    });

    it('lee max_files del campo', () => {
        expect(maxFilesOf({ max_files: 3 })).toBe(3);
        expect(maxFilesOf({})).toBeUndefined();
        expect(maxFilesOf(null)).toBeUndefined();
    });
});
