import { describe, expect, it } from 'vitest';
import { keyList } from '../src/records/records-grouped.controller';

describe('claves de grupo en la query del bundle agrupado (v0.1.224)', () => {
    it('una lista JSON conserva las claves multi_select, que llevan comas', () => {
        expect(keyList('["[\\"promo\\", \\"vip\\"]","[\\"vip\\"]","__null__"]')).toEqual([
            '["promo", "vip"]',
            '["vip"]',
            '__null__',
        ]);
    });

    it('la forma separada por comas sigue valiendo para claves simples', () => {
        expect(keyList('bogota, cali,,__null__')).toEqual(['bogota', 'cali', '__null__']);
    });

    it('vacío, no-string o JSON roto no revientan', () => {
        expect(keyList(undefined)).toEqual([]);
        expect(keyList('  ')).toEqual([]);
        expect(keyList(['a'])).toEqual([]);
        expect(keyList('[roto')).toEqual(['[roto']);
        expect(keyList('[1, "a"]')).toEqual(['a']);
    });
});
