import { describe, expect, it } from 'vitest';
import { appBranding, brandingResponseSchema, publicBootSchema } from '../index';

/**
 * v0.1.450 (ADR-S108) — La marca de la APP: la propia de la empresa o, si es
 * cliente de una agencia, la de la agencia (nunca la de la plataforma).
 */
describe('marca de la app de una empresa cliente', () => {
    const own = { app_name: 'Café Luna', primary_color: '#16a34a', sidebar_color: null, app_bar_color: null, logo_url: '/logo-cafe' };

    it('sin agencia: la propia, sin white-label', () => {
        expect(appBranding({ ...own, inherited: null })).toEqual({ ...own, white_label: false, agency_name: null });
    });

    it('con agencia: la de la agencia; sin nombre de app, el nombre de la agencia', () => {
        const inherited = { source: 'agency' as const, name: 'Agencia Norte', app_name: null, primary_color: '#2563eb', sidebar_color: '#111827', app_bar_color: 'brand', logo_url: null };
        expect(appBranding({ ...own, inherited })).toEqual({
            app_name: 'Agencia Norte',
            primary_color: '#2563eb',
            sidebar_color: '#111827',
            app_bar_color: 'brand',
            logo_url: null,
            white_label: true,
            agency_name: 'Agencia Norte',
        });
        expect(appBranding({ ...own, inherited: { ...inherited, app_name: 'Norte Suite' } }).app_name).toBe('Norte Suite');
    });

    it('una respuesta de antes (sin «inherited» ni la llave del manifiesto) se lee igual', () => {
        const parsed = brandingResponseSchema.parse({ primary_color: '#16a34a', logo_file_id: null, app_name: 'Café Luna', logo_url: null });
        expect(parsed.inherited).toBeNull();
        expect(parsed.manifest_brand).toBeNull();
        const boot = publicBootSchema.parse({ tenant: { id: 1, slug: 'cafe', name: 'Café', app_name: null, primary_color: null, logo_url: null } });
        expect(boot.tenant).toMatchObject({ is_agency: false, white_label: false });
    });
});
