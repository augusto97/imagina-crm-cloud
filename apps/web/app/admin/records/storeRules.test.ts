import { describe, expect, it } from 'vitest';
import type { StoreListMarker } from '@imagina-base/shared';

import type { FieldEntity } from '@/types/field';

import { lockedReasonsFor, storeColumnKind, type StoreRules } from './storeRules';

const field = (id: number, slug: string): FieldEntity => ({ id, slug, label: slug, type: 'text' }) as unknown as FieldEntity;
const fields = [field(1, 'nombre'), field(2, 'precio_normal'), field(3, 'tipo'), field(4, 'controla_stock'), field(9, 'nota')];
const marker = (write_back: boolean): StoreListMarker => ({
    connection_id: 7,
    role: 'products',
    store_name: 'Demo',
    store_url: 'https://tienda.test',
    write_back,
    fields: { nombre: 1, precio_normal: 2, tipo: 3, controla_stock: 4 },
    meta_fields: [],
});
const rules = (wb: boolean): StoreRules => ({ marker: marker(wb), fields });

describe('reglas de una lista de tienda en la UI', () => {
    it('marca cada columna: de la tienda, que viaja, o propia', () => {
        expect(storeColumnKind(null, 1)).toBeNull();
        expect(storeColumnKind(rules(false), 2)).toBe('store_locked');
        expect(storeColumnKind(rules(true), 2)).toBe('store_sync');
        expect(storeColumnKind(rules(true), 1)).toBe('store_locked');
        expect(storeColumnKind(rules(true), 9)).toBe('own');
    });

    it('bloquea en el formulario lo que la tienda no permitiría, con el motivo', () => {
        const off = lockedReasonsFor(rules(false), fields, { tipo: 'simple' });
        expect(Object.keys(off).sort()).toEqual(['controla_stock', 'nombre', 'precio_normal', 'tipo']);
        const on = lockedReasonsFor(rules(true), fields, { tipo: 'simple' });
        expect(on.precio_normal).toBeUndefined();
        expect(on.nombre).toMatch(/WooCommerce/);
        // Un producto con variaciones no tiene precio propio.
        const variable = lockedReasonsFor(rules(true), fields, { tipo: 'variable' });
        expect(variable.precio_normal).toMatch(/variaciones/);
        // Fuera de una tienda no se bloquea nada.
        expect(lockedReasonsFor(null, fields, {})).toEqual({});
    });
});
