import { describe, expect, it } from 'vitest';

import { filenameOf } from './PortalDocuments';

describe('v0.1.267 — nombre del PDF que baja el portal', () => {
    it('prefiere filename* (acentos) y cae al ascii', () => {
        expect(filenameOf(`attachment; filename="Cuenta CC-0007 - Beta.pdf"; filename*=UTF-8''Cuenta%20CC-0007%20-%20B%C3%A9ta.pdf`)).toBe('Cuenta CC-0007 - Béta.pdf');
        expect(filenameOf('attachment; filename="Recibo.pdf"')).toBe('Recibo.pdf');
        expect(filenameOf(null)).toBeNull();
        expect(filenameOf('attachment')).toBeNull();
    });
});
