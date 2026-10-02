import { describe, expect, it } from 'vitest';
import { INTEGRATIONS, integrationScopes } from './integrations';
import { DEFAULT_PRIVACY_MD, fillLegalTemplate, legalMissing, platformLegalSchema } from './legal-pages';
import { PROVIDER_GUIDES, SCOPE_JUSTIFICATIONS, registrableDomain, scopeJustificationText } from './provider-guides';

describe('guías de proveedores (v0.1.247)', () => {
    it('Google cubre publicar y verificar, con el aviso de los 7 días', () => {
        const keys = PROVIDER_GUIDES.google.phases.map((p) => p.key);
        expect(keys).toEqual(['project', 'branding', 'client', 'publish', 'verify']);
        const all = JSON.stringify(PROVIDER_GUIDES.google);
        expect(all).toMatch(/7 días/);
        expect(all).toMatch(/Publicar app/);
        expect(all).toMatch(/Search Console/);
        expect(all).toMatch(/Centro de verificación/);
    });

    it('Microsoft avisa del vencimiento del secreto y Slack de la distribución pública', () => {
        expect(JSON.stringify(PROVIDER_GUIDES.microsoft)).toMatch(/VENCE/);
        expect(JSON.stringify(PROVIDER_GUIDES.slack)).toMatch(/Activate Public Distribution/);
    });

    it('cada paso con enlace apunta a https', () => {
        for (const guide of Object.values(PROVIDER_GUIDES)) {
            for (const phase of guide.phases) {
                for (const step of phase.steps) {
                    if (step.link) expect(step.link.url).toMatch(/^https:\/\//);
                }
            }
        }
    });

    it('hay justificación para cada permiso de Google que la app pide', () => {
        const googleScopes = INTEGRATIONS.filter((i) => i.auth.kind === 'oauth' && i.auth.provider === 'google')
            .flatMap((i) => integrationScopes(i).split(' '))
            .filter((s) => s.startsWith('https://'));
        expect(googleScopes.length).toBeGreaterThan(0);
        for (const s of googleScopes) expect(SCOPE_JUSTIFICATIONS[s]).toBeTruthy();
        expect(scopeJustificationText(['openid', ...googleScopes]).split('\n\n')).toHaveLength(new Set(googleScopes).size);
    });

    it('registrableDomain', () => {
        expect(registrableDomain('base.imagina.cloud')).toBe('imagina.cloud');
        expect(registrableDomain('imagina.cloud')).toBe('imagina.cloud');
        expect(registrableDomain('app.empresa.com.co')).toBe('empresa.com.co');
        expect(registrableDomain('crm.acme.co.uk')).toBe('acme.co.uk');
        expect(registrableDomain('a.b.example.io')).toBe('example.io');
    });
});

describe('páginas legales (v0.1.247)', () => {
    it('la política sugerida trae la cláusula de uso limitado de Google', () => {
        expect(DEFAULT_PRIVACY_MD).toMatch(/Limited Use requirements/);
        expect(DEFAULT_PRIVACY_MD).toMatch(/api-services-user-data-policy/);
    });

    it('fillLegalTemplate reemplaza marcadores y marca los vacíos', () => {
        const out = fillLegalTemplate('{{app_name}} de {{company}} — {{email}} {{otro}}', {
            app_name: 'Base',
            company: 'Acme SAS',
            email: '',
            app_url: 'https://x',
            website: '',
            updated: '2026-10-02',
        });
        expect(out).toBe('Base de Acme SAS — — {{otro}}');
    });

    it('defaults y faltantes', () => {
        const s = platformLegalSchema.parse({});
        expect(s.app_name).toBe('Imagina Base');
        expect(legalMissing(s)).toHaveLength(2);
        expect(legalMissing({ ...s, company_name: 'Acme', contact_email: 'a@b.co' })).toEqual([]);
        expect(platformLegalSchema.safeParse({ website_url: 'http://inseguro.com' }).success).toBe(false);
    });
});
