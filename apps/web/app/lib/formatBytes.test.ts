import { afterEach, describe, expect, it } from 'vitest';

import { formatBytes } from './formatBytes';
import { setTenantFormat } from './tenantFormat';

describe('formatBytes', () => {
    afterEach(() => setTenantFormat(null));

    it('elige la unidad y redondea', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(900)).toBe('900 B');
        expect(formatBytes(1536)).toBe('1.5 KB');
        expect(formatBytes(30 * 1024 * 1024)).toBe('30 MB');
        expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB');
        expect(formatBytes(2.5 * 1024 ** 4)).toBe('2.5 TB');
    });

    it('usa los separadores de la empresa', () => {
        setTenantFormat({ number_format: 'dot_comma' });
        expect(formatBytes(1536)).toBe('1,5 KB');
        expect(formatBytes(1500 * 1024 ** 4)).toBe('1.500 TB');
    });
});
