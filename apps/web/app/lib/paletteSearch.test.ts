import { describe, expect, it } from 'vitest';

import { paletteMatches, paletteRank } from '@/lib/paletteSearch';
import { resolveGoChord } from '@/lib/shortcuts';

describe('paleta de comandos', () => {
    it('no distingue acentos ni mayúsculas', () => {
        expect(paletteMatches('Nómina', 'nomina')).toBe(true);
        expect(paletteMatches('Facturación 2026', 'FACTURACION')).toBe(true);
        expect(paletteMatches('Clientes', 'nomina')).toBe(false);
    });

    it('busca por palabras en cualquier orden', () => {
        expect(paletteMatches('Facturas pendientes · Ventas', 'pend fact')).toBe(true);
        expect(paletteMatches('Facturas pendientes', 'fact cobradas')).toBe(false);
        expect(paletteMatches('Lo que sea', '   ')).toBe(true);
    });

    it('ordena primero lo que empieza con lo buscado', () => {
        expect(paletteRank('Clientes', 'cli')).toBe(0);
        expect(paletteRank('Mis clientes', 'cli')).toBe(1);
        expect(paletteRank('Inclinación', 'cli')).toBe(2);
    });

    it('g + letra va a una sección; cualquier otra cosa no', () => {
        expect(resolveGoChord(true, 'l')).toBe('/lists');
        expect(resolveGoChord(true, 'D')).toBe('/dashboards');
        expect(resolveGoChord(true, 't')).toBe('/my-work');
        expect(resolveGoChord(true, 's')).toBe('/settings');
        expect(resolveGoChord(true, 'x')).toBeNull();
        expect(resolveGoChord(false, 'l')).toBeNull();
    });
});
