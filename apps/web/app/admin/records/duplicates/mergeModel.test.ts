import { describe, expect, it } from 'vitest';

import { mergeValueOptions } from './mergeModel';

describe('mergeValueOptions (v0.1.445)', () => {
    it('agrupa valores iguales, respeta el orden y deja «(vacío)» al final', () => {
        const out = mergeValueOptions({ values: ['b@x.co', null, 'a@x.co', 'b@x.co', ''] }, [10, 20, 30, 40, 50]);
        expect(out.map((o) => [o.choice, o.ids, o.empty])).toEqual([
            [10, [10, 40], false],
            [30, [30], false],
            [20, [20, 50], true],
        ]);
    });

    it('listas iguales cuentan como el mismo valor; una lista vacía es vacío', () => {
        const out = mergeValueOptions({ values: [['vip'], ['vip'], []] }, [1, 2, 3]);
        expect(out).toEqual([
            { choice: 1, ids: [1, 2], value: ['vip'], empty: false },
            { choice: 3, ids: [3], value: null, empty: true },
        ]);
    });
});
