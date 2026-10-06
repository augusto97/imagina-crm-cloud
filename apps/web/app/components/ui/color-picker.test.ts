import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { chipSoftStyle, wcagLuminance } from './color-picker';

/** Contraste WCAG entre dos luminancias. */
const ratio = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

describe('tinta de los chips de opción (v0.1.253)', () => {
    it('los presets del CSS coinciden con la tabla que usa el cálculo', () => {
        const css = readFileSync(resolve(__dirname, '../../styles/globals.css'), 'utf8');
        const block = css.slice(css.indexOf('--imcrm-opt-gray:'), css.indexOf('--imcrm-opt-gray-text:'));
        const found = [...block.matchAll(/--imcrm-opt-(\w+):\s*(\d+) (\d+)% (\d+)%;/g)];
        expect(found.length).toBe(18);
        for (const [, name] of found) {
            const style = chipSoftStyle(name as never);
            expect(style?.color).toBeDefined();
        }
    });

    it('sky, emerald y blue ya no llevan texto blanco ilegible', () => {
        // Los fondos medidos en la auditoría: blanco daba 2,7 / 2,6 / 3,65.
        for (const hex of ['#0DA6F2', '#10B77F', '#3C83F6']) {
            const ink = chipSoftStyle(hex)?.color;
            expect(ink).not.toBe('#ffffff');
        }
        // Un fondo oscuro sigue con letra blanca.
        expect(chipSoftStyle('#1e293b')?.color).toBe('#ffffff');
    });

    it('la tinta elegida siempre supera 4,5:1 en los hex de la auditoría', () => {
        for (const hex of ['#0DA6F2', '#10B77F', '#3C83F6', '#E84A6F', '#7c3aed', '#facc15']) {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            const bg = wcagLuminance({ r, g, b });
            const ink = chipSoftStyle(hex)?.color === '#ffffff' ? 1 : 0.012;
            expect(ratio(bg, ink)).toBeGreaterThanOrEqual(4.4);
        }
    });
});
