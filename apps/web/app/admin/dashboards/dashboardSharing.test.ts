import { describe, expect, it } from 'vitest';

import { periodFromQuery, publicThemeFromQuery, tokenFromPath } from '@/public-dashboard/publicDashboard';

import { parseEmails } from './EmailSubscriptionsPanel';
import { embedSnippet, parseDomains } from './PublicLinkPanel';
import { hslTripletToHex } from './widgets/widgetExport';

describe('v0.1.292 — compartir un tablero', () => {
    it('el token sale sólo de la dirección pública', () => {
        expect(tokenFromPath('/api/v1/public/d/h-1V3NJFw9JOGAFi8SYXQehZQN2B8wJT')).toBe('h-1V3NJFw9JOGAFi8SYXQehZQN2B8wJT');
        expect(tokenFromPath('/api/v1/public/d/h-1V3NJFw9JOGAFi8SYXQehZQN2B8wJT/')).toBe('h-1V3NJFw9JOGAFi8SYXQehZQN2B8wJT');
        expect(tokenFromPath('/api/v1/public/d/corto')).toBeNull();
        expect(tokenFromPath('/api/v1/public/l/h-1V3NJFw9JOGAFi8SYXQehZQN2B8wJT')).toBeNull();
        expect(tokenFromPath('/api/v1/public/d/../../etc/passwd')).toBeNull();
    });

    it('tema y período desde la dirección', () => {
        expect(publicThemeFromQuery('?theme=dark', false)).toBe('dark');
        expect(publicThemeFromQuery('?theme=light', true)).toBe('light');
        expect(publicThemeFromQuery('?theme=rosa', true)).toBe('dark');
        expect(publicThemeFromQuery('', false)).toBe('light');
        expect(periodFromQuery('?period=this_month')).toBe('this_month');
        expect(periodFromQuery('?period=custom:2026-01-01:2026-03-31')).toBe('custom:2026-01-01:2026-03-31');
        expect(periodFromQuery('?period=<script>')).toBe('');
    });

    it('dominios y correos escritos a mano → listas limpias sin repetidos', () => {
        expect(parseDomains('Ejemplo.com\n*.ejemplo.com, ejemplo.com\n\n')).toEqual(['ejemplo.com', '*.ejemplo.com']);
        expect(parseEmails('Ana@x.test; bob@x.test,\nana@x.test  carla@x.test')).toEqual(['ana@x.test', 'bob@x.test', 'carla@x.test']);
    });

    it('el código para insertar escapa la dirección', () => {
        const snippet = embedSnippet('https://app.ejemplo.com/api/v1/public/d/abc?theme=dark&period=today');
        expect(snippet).toContain('src="https://app.ejemplo.com/api/v1/public/d/abc?theme=dark&amp;period=today"');
        expect(embedSnippet('https://x.test/"onload="alert(1)')).not.toContain('"onload="');
    });

    it('los tokens HSL del tema → hex para la imagen exportada', () => {
        expect(hslTripletToHex('0 0% 100%')).toBe('#ffffff');
        expect(hslTripletToHex('0 0% 0%')).toBe('#000000');
        expect(hslTripletToHex('0 100% 50% / 0.5')).toBe('#ff0000');
        expect(hslTripletToHex('no')).toBeNull();
    });
});
