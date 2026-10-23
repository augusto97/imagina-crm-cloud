import { describe, expect, it } from 'vitest';
import { formatAutonumber, suggestAutonumberPrefix } from './autonumber';

describe('ID automático', () => {
    it('arma el texto con prefijo, año y número rellenado', () => {
        expect(formatAutonumber({ prefix: 'TCK' }, 1)).toBe('TCK-0001');
        expect(formatAutonumber({ prefix: 'PED', yearly: true }, 42, 2026)).toBe('PED-2026-0042');
        expect(formatAutonumber({ prefix: 'PED', separator: '/', digits: 6 }, 42)).toBe('PED/000042');
        expect(formatAutonumber({ prefix: '' }, 7)).toBe('0007');
        expect(formatAutonumber({ prefix: '', yearly: true }, 7, 2026)).toBe('2026-0007');
        expect(formatAutonumber({ prefix: 'A', separator: '' }, 3)).toBe('A0003');
    });

    it('nunca corta un número más largo que los dígitos', () => {
        expect(formatAutonumber({ prefix: 'TCK', digits: 4 }, 12345)).toBe('TCK-12345');
    });

    it('sugiere el prefijo con el nombre de la lista', () => {
        expect(suggestAutonumberPrefix('Tickets')).toBe('TIC');
        expect(suggestAutonumberPrefix('Pedidos')).toBe('PED');
        expect(suggestAutonumberPrefix('Órdenes de compra')).toBe('OC');
        expect(suggestAutonumberPrefix('Mesa de ayuda técnica')).toBe('MAT');
        expect(suggestAutonumberPrefix('¡!')).toBe('ID');
    });
});
