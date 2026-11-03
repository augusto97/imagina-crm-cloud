import { describe, expect, it } from 'vitest';
import { INTEGRATIONS, integrationScopes } from './integrations';
import { DEFAULT_PRIVACY_MD, fillLegalTemplate, legalMissing, platformLegalSchema } from './legal-pages';
import { PROVIDER_GUIDES, SCOPE_JUSTIFICATIONS, credentialWarning, registrableDomain, scopeJustificationText } from './provider-guides';

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

    it('cada proveedor dice dónde está el Client ID y el secreto (v0.1.348)', () => {
        for (const guide of Object.values(PROVIDER_GUIDES)) {
            expect(guide.credentials.client_id.where.length).toBeGreaterThan(20);
            expect(guide.credentials.client_secret.where.length).toBeGreaterThan(20);
        }
        expect(PROVIDER_GUIDES.microsoft.credentials.client_id.where).toMatch(/Id\. de aplicación \(cliente\)/);
        expect(PROVIDER_GUIDES.microsoft.credentials.client_secret.where).toMatch(/«Valor»/);
    });

    it('la guía de Microsoft pide los permisos de Teams que la app usa', () => {
        const ms = INTEGRATIONS.filter((i) => i.auth.kind === 'oauth' && i.auth.provider === 'microsoft');
        expect(ms.map((i) => i.key)).toEqual(['outlook', 'teams']);
        const text = JSON.stringify(PROVIDER_GUIDES.microsoft);
        for (const scope of ms.flatMap((i) => (i.auth.kind === 'oauth' ? i.auth.scopes.split(' ') : []))) {
            expect(text).toContain(scope);
        }
    });

    it('credentialWarning atrapa las confusiones de siempre sin bloquear lo correcto', () => {
        const guid = 'a1b2c3d4-1234-5678-9abc-def012345678';
        expect(credentialWarning('microsoft', 'client_id', guid)).toBeNull();
        expect(credentialWarning('microsoft', 'client_id', 'mi-app')).toMatch(/Id\. de aplicación/);
        // El «Id. de secreto» tiene forma de GUID; el «Valor», no.
        expect(credentialWarning('microsoft', 'client_secret', guid)).toMatch(/Id\. de secreto/);
        expect(credentialWarning('microsoft', 'client_secret', 'Abc8Q~xYz0123456789abcdefghijklmnopqrstu')).toBeNull();
        expect(credentialWarning('microsoft', 'client_secret', 'Abc***')).toMatch(/tapado/);
        expect(credentialWarning('microsoft', 'client_secret', guid, guid)).toMatch(/Id\. de secreto|igual/);
        expect(credentialWarning('google', 'client_id', '123-abc.apps.googleusercontent.com')).toBeNull();
        expect(credentialWarning('google', 'client_id', 'GOCSPX-abc')).toMatch(/googleusercontent/);
        expect(credentialWarning('google', 'client_secret', '123-abc.apps.googleusercontent.com')).toMatch(/ID de cliente/);
        expect(credentialWarning('slack', 'client_id', '1234567890.0987654321')).toBeNull();
        expect(credentialWarning('slack', 'client_secret', 'xoxb-123')).toMatch(/token/);
        expect(credentialWarning('google', 'client_id', '')).toBeNull();
        expect(credentialWarning('google', 'client_id', 'abc def.apps.googleusercontent.com')).toMatch(/espacios/);
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
