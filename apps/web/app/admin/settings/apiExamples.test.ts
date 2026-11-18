import { describe, expect, it } from 'vitest';

import { apiExamples } from './apiExamples';

describe('ejemplos de la API', () => {
    it('usan la dirección real, el token y la clave f{id} en data', () => {
        const ex = apiExamples('https://app.ejemplo.com/api/v1', 'ib_pat_x');
        expect(ex.map((e) => e.key)).toEqual(['whoami', 'lists', 'fields', 'records', 'create', 'update']);
        expect(ex.every((e) => e.text.includes('Authorization: Bearer ib_pat_x'))).toBe(true);
        expect(ex[0]!.text).toContain('https://app.ejemplo.com/api/v1/whoami');
        const create = ex.find((e) => e.key === 'create')!.text;
        expect(create).toContain('-X POST');
        expect(JSON.parse(/-d '([^']+)'/.exec(create)![1]!)).toEqual({ data: { f12: 'Ana Gómez', f13: 'ana@ejemplo.com' } });
    });

    it('sin token muestra un marcador, nunca un secreto', () => {
        const ex = apiExamples('/api/v1', '<tu token>');
        expect(ex[0]!.text).toContain('Bearer <tu token>');
    });
});
