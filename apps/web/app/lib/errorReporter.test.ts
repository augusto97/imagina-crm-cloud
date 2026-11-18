import { describe, expect, it } from 'vitest';

import { buildPayload, currentRoute, shouldReport } from './errorReporter';

describe('errorReporter (v0.1.435)', () => {
    it('no manda los errores del API, la red caída, un pedido cancelado ni un despliegue nuevo', () => {
        const apiErr = Object.assign(new Error('No encontrado'), { status: 404 });
        expect(shouldReport(apiErr, 'No encontrado')).toBe(false);
        expect(shouldReport(new DOMException('aborted', 'AbortError'), 'AbortError: aborted')).toBe(false);
        for (const m of ['Script error.', 'ResizeObserver loop limit exceeded', 'Failed to fetch dynamically imported module: x', 'Failed to fetch', 'Load failed', '']) {
            expect(shouldReport(new Error(m), m)).toBe(false);
        }
        const ext = new Error('boom');
        ext.stack = 'Error: boom\n    at x (chrome-extension://abc/content.js:1:2)';
        expect(shouldReport(ext, 'boom')).toBe(false);
        expect(shouldReport(new TypeError("Cannot read properties of undefined (reading 'x')"), "TypeError: Cannot read properties of undefined (reading 'x')")).toBe(true);
    });

    it('arma el mensaje con el tipo, el stack y la primera línea del componente', () => {
        const err = new TypeError('x is not a function');
        const p = buildPayload('render', err, '/lists/3/records', { component: '\n    at Cell\n    at Row' })!;
        expect(p).toMatchObject({ kind: 'render', surface: 'app', message: 'TypeError: x is not a function', route: '/lists/3/records', component: 'at Cell' });
        expect(p.stack).toContain('x is not a function');
        expect(buildPayload('rejection', 'algo salió mal', '/')).toMatchObject({ message: 'algo salió mal' });
        expect(buildPayload('rejection', { status: 500 }, '/')).toBeNull();
    });

    it('la pantalla va sin consulta; si la app navega por el ancla, es la del ancla', () => {
        expect(currentRoute({ pathname: '/portal/acceso' })).toBe('/portal/acceso');
        expect(currentRoute({ pathname: '' })).toBe('/');
        expect(currentRoute({ pathname: '/login', hash: '#/lists/3/records?view=2&token=x' })).toBe('/lists/3/records');
        expect(currentRoute({ pathname: '/portal', hash: '#seccion' })).toBe('/portal');
    });
});
