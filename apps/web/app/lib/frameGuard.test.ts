import { describe, expect, it } from 'vitest';

import { isFramedCrossOrigin, type FrameWindow } from './frameGuard';

const ORIGIN = 'https://app.ejemplo.com';

function win(top: FrameWindow['top'] | 'self'): FrameWindow {
    const w: FrameWindow = { self: {}, top: null, location: { origin: ORIGIN } };
    w.top = top === 'self' ? (w.self as FrameWindow['top']) : top;
    return w;
}

describe('isFramedCrossOrigin', () => {
    it('no encuadrada → false', () => {
        expect(isFramedCrossOrigin(win('self'))).toBe(false);
        expect(isFramedCrossOrigin(win(null))).toBe(false);
    });

    it('encuadrada por el MISMO origen → false (como SAMEORIGIN)', () => {
        expect(isFramedCrossOrigin(win({ location: { origin: ORIGIN } }))).toBe(false);
    });

    it('encuadrada por otro origen legible → true', () => {
        expect(isFramedCrossOrigin(win({ location: { origin: 'https://atacante.test' } }))).toBe(true);
    });

    it('el navegador bloquea leer el top (SecurityError) → true', () => {
        const top = {
            get location(): { origin: string } {
                throw new Error('SecurityError');
            },
        };
        expect(isFramedCrossOrigin(win(top))).toBe(true);
    });
});
