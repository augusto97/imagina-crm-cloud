import { describe, expect, it } from 'vitest';

import type { FieldEntity } from '@/types/field';

import { relationIds, relationTarget } from './useRelationTitles';

const field = (config: Record<string, unknown>): FieldEntity => ({ id: 1, slug: 'cliente', type: 'relation', config }) as unknown as FieldEntity;

describe('relationIds', () => {
    it('acepta el array, un id suelto o nada', () => {
        expect(relationIds([3, 5])).toEqual([3, 5]);
        expect(relationIds(7)).toEqual([7]);
        expect(relationIds('9')).toEqual([9]);
        expect(relationIds(null)).toEqual([]);
        expect(relationIds(undefined)).toEqual([]);
        expect(relationIds('')).toEqual([]);
    });
    it('descarta basura y repetidos', () => {
        expect(relationIds([3, '3', 0, -1, 'x', 4.5, 8])).toEqual([3, 8]);
    });
});

describe('relationTarget', () => {
    it('la lista destino o null si no se configuró', () => {
        expect(relationTarget(field({ target_list_id: 12 }))).toBe(12);
        expect(relationTarget(field({}))).toBeNull();
        expect(relationTarget(field({ target_list_id: 0 }))).toBeNull();
    });
});
