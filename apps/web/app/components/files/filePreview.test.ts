// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { downloadUrlOf, formatBytes, isSameOriginUrl, previewKind, previewUrlOf } from './filePreview';

describe('vista previa de adjuntos', () => {
    it('elige el visor por tipo', () => {
        expect(previewKind('image/png')).toBe('image');
        expect(previewKind('image/svg+xml')).toBe('svg');
        expect(previewKind('application/octet-stream', 'logo.svg')).toBe('svg');
        expect(previewKind('application/pdf')).toBe('pdf');
        expect(previewKind('video/mp4')).toBe('video');
        expect(previewKind('audio/mpeg')).toBe('audio');
        expect(previewKind('text/csv; charset=utf-8')).toBe('text');
        expect(previewKind('application/json')).toBe('text');
        expect(previewKind('application/octet-stream', 'datos.csv')).toBe('text');
        expect(previewKind('application/zip', 'pack.zip')).toBe('other');
        expect(previewKind('text/html')).toBe('text');
    });

    it('agrega preview=1 / dl=1 sólo a las URLs propias', () => {
        expect(previewUrlOf('/api/v1/files/7/signed?tenant=1&exp=2&sig=x')).toBe('/api/v1/files/7/signed?tenant=1&exp=2&sig=x&preview=1');
        expect(downloadUrlOf('/api/v1/files/7/download')).toBe('/api/v1/files/7/download?dl=1');
        expect(previewUrlOf('/api/v1/files/7/signed?preview=1')).toBe('/api/v1/files/7/signed?preview=1');
        expect(previewUrlOf('https://otro.example.com/a.png')).toBe('https://otro.example.com/a.png');
        expect(isSameOriginUrl('//evil.example/x')).toBe(false);
    });

    it('formatea tamaños', () => {
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(2048)).toBe('2 KB');
        expect(formatBytes(1.5 * 1024 * 1024)).toBe('1,5 MB');
        expect(formatBytes(undefined)).toBe('');
    });
});
