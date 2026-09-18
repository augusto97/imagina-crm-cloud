import { describe, expect, it } from 'vitest';

import { canSearchClientSide, clientSideSearch } from '@/lib/clientSearch';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

const fields = [
    { id: 1, slug: 'nombre', type: 'text' },
    { id: 2, slug: 'tel', type: 'phone' },
    { id: 3, slug: 'monto', type: 'number' },
] as unknown as FieldEntity[];

const rec = (id: number, f: Record<string, unknown>, hasDescription = false): RecordEntity =>
    ({ id, fields: f, relations: {}, has_description: hasDescription }) as unknown as RecordEntity;

describe('clientSideSearch — búsqueda in-memory de listas chicas', () => {
    it('busca en texto y teléfono (v0.1.188: phone como en el servidor), no en números', () => {
        const rows = [rec(1, { nombre: 'José Pérez', tel: '+573001112233', monto: 500 }), rec(2, { nombre: 'Ana', monto: 3001 })];
        expect(clientSideSearch(rows, 'jose', fields).map((r) => r.id)).toEqual([1]);
        expect(clientSideSearch(rows, '3001', fields).map((r) => r.id)).toEqual([1]);
        expect(clientSideSearch(rows, '', fields)).toBe(rows);
    });
});

describe('canSearchClientSide — v0.1.188', () => {
    it('sin descripciones la tanda se busca en el navegador', () => {
        expect(canSearchClientSide([rec(1, {}), rec(2, {})])).toBe(true);
        expect(canSearchClientSide([])).toBe(true);
    });

    it('con UNA fila con descripción hay que ir al servidor (el documento no viaja en el listado)', () => {
        // Regresión: "el buscador no busca en la descripción" — in-memory
        // sólo ve los campos, así que lo escrito en el cuerpo quedaba afuera.
        expect(canSearchClientSide([rec(1, {}), rec(2, {}, true)])).toBe(false);
    });
});
