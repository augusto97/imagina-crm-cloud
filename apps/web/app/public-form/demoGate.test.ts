import { describe, expect, it } from 'vitest';

import { isDemoFrame, type DemoGateWindow } from './demoGate';

const ORIGIN = 'https://app.acme.test';

function win(search: string, parent: 'self' | 'same-origin' | 'cross-origin'): DemoGateWindow {
    const w: DemoGateWindow = { location: { search, origin: ORIGIN } };
    if (parent === 'self') w.parent = w;
    else if (parent === 'same-origin') w.parent = { location: { origin: ORIGIN } };
    else {
        // Un padre de otro sitio: el navegador lanza al leerle `location.origin`.
        w.parent = {
            get location(): never {
                throw new Error('SecurityError');
            },
        };
    }
    return w;
}

describe('isDemoFrame — la demostración sólo vale dentro de la app', () => {
    it('el enlace abierto directo con ?imb_demo=1 NO es una demostración (se envía de verdad)', () => {
        expect(isDemoFrame(win('?imb_demo=1', 'self'))).toBe(false);
        expect(isDemoFrame({ location: { search: '?imb_demo=1', origin: ORIGIN } })).toBe(false);
    });

    it('insertado en OTRO sitio con ?imb_demo=1 tampoco', () => {
        expect(isDemoFrame(win('?imb_demo=1&v=abc', 'cross-origin'))).toBe(false);
        expect(isDemoFrame({ location: { search: '?imb_demo=1', origin: ORIGIN }, parent: { location: { origin: 'https://evil.test' } } })).toBe(false);
    });

    it('dentro de un marco de la propia app sí (la demostración de «Compartir»)', () => {
        expect(isDemoFrame(win('?imb_demo=1&v=abc&imb_style=bare', 'same-origin'))).toBe(true);
    });

    it('sin el parámetro nunca', () => {
        expect(isDemoFrame(win('', 'same-origin'))).toBe(false);
        expect(isDemoFrame(win('?imb_demo=0', 'same-origin'))).toBe(false);
    });
});
