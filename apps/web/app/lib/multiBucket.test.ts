import { describe, expect, it } from 'vitest';

import { orderByCatalog, parseMultiBucket } from '@/lib/multiBucket';

describe('multiBucket — grupos por combinación de un multi_select (v0.1.190)', () => {
    it('parsea la clave JSON del bucket y rechaza lo que no es un array', () => {
        expect(parseMultiBucket('["promo", "vip"]')).toEqual(['promo', 'vip']);
        expect(parseMultiBucket('vip')).toBeNull();
        expect(parseMultiBucket('{"a":1}')).toBeNull();
        expect(parseMultiBucket('[no json')).toBeNull();
        expect(parseMultiBucket(null)).toBeNull();
    });

    it('ordena las opciones como el catálogo del campo, desconocidas al final', () => {
        const catalog = [{ value: 'elementor' }, { value: 'astra' }, { value: 'starter' }];
        expect(orderByCatalog(['starter', 'astra', 'zzz', 'elementor'], catalog)).toEqual(['elementor', 'astra', 'starter', 'zzz']);
    });
});
