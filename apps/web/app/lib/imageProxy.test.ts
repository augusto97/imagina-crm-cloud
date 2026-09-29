import { describe, expect, it } from 'vitest';

import { isImageUrlField, proxiedImageUrl } from './imageProxy';

describe('proxiedImageUrl', () => {
    it('las imágenes de otro dominio van por el proxy del API (CSP img-src self)', () => {
        expect(proxiedImageUrl('https://tienda.test/wp-content/a.jpg')).toBe(
            '/api/v1/media/image?url=https%3A%2F%2Ftienda.test%2Fwp-content%2Fa.jpg',
        );
        expect(proxiedImageUrl('  http://t.test/b.png ')).toBe('/api/v1/media/image?url=http%3A%2F%2Ft.test%2Fb.png');
    });
    it('lo del propio origen va directo; lo demás no se pide', () => {
        expect(proxiedImageUrl('/api/v1/files/3/download')).toBe('/api/v1/files/3/download');
        for (const bad of ['//evil.test/a.png', 'javascript:alert(1)', 'data:image/png;base64,AA', 'tienda.test/a.jpg', '', null, 3]) {
            expect(proxiedImageUrl(bad), String(bad)).toBeNull();
        }
    });
    it('isImageUrlField', () => {
        expect(isImageUrlField({ display: 'image' })).toBe(true);
        expect(isImageUrlField({ display: 'link' })).toBe(false);
        expect(isImageUrlField({})).toBe(false);
        expect(isImageUrlField(null)).toBe(false);
    });
});
