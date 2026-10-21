import type { Field } from '@imagina-base/shared';
import { describe, expect, it } from 'vitest';
import { fallbackWorkTitle } from '../src/notifications/notifications.service';

const field = (id: number, type: string, label: string, config: Record<string, unknown> = {}): Field =>
    ({ id, type, label, slug: `f_${id}`, config }) as unknown as Field;

describe('«Mi trabajo»: título de un registro de una lista sin campo de texto', () => {
    it('usa el primer dato legible en vez de «Registro #N»', () => {
        const fields = [field(1, 'relation', 'Cliente'), field(2, 'currency', 'Comisión vendedor')];
        expect(fallbackWorkTitle(fields, { f2: 777 }, 133)).toBe('Comisión vendedor: 777');
    });

    it('una opción se muestra con su etiqueta, y un texto tal cual', () => {
        const fields = [field(1, 'select', 'Estado', { options: [{ value: 'al_dia', label: 'Al día' }] })];
        expect(fallbackWorkTitle(fields, { f1: 'al_dia' }, 7)).toBe('Estado: Al día');
        expect(fallbackWorkTitle([field(3, 'email', 'Correo')], { f3: 'ana@acme.co' }, 7)).toBe('ana@acme.co');
    });

    it('sin nada legible queda el número', () => {
        expect(fallbackWorkTitle([field(1, 'relation', 'Cliente')], {}, 9)).toBe('Registro #9');
    });
});
