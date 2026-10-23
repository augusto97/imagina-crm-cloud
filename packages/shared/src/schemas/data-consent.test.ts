import { describe, expect, it } from 'vitest';
import {
    dataConsentConfigSchema,
    dataConsentMissing,
    dataConsentRecommended,
    fillDataConsentText,
    readDataConsentConfig,
    renderDataConsent,
} from './data-consent';

const full = dataConsentConfigSchema.parse({
    enabled: true,
    responsible: {
        name: 'Acme S.A.S.',
        id_number: '900.123.456-7',
        address: 'Calle 10 # 5-20',
        city: 'Bogotá',
        email: 'datos@acme.co',
        phone: '+57 601 555 0000',
    },
    policy_url: 'https://acme.co/privacidad',
});

describe('autorización de tratamiento de datos (Ley 1581)', () => {
    it('arma el texto sugerido con los datos del responsable, las finalidades y los derechos', () => {
        const r = renderDataConsent(full, { tenantName: 'Acme' });
        expect(r.text).toContain('Ley 1581 de 2012');
        expect(r.text).toContain('Decreto 1377 de 2013');
        expect(r.text).toContain('autorizo de manera previa, expresa e informada a Acme S.A.S.');
        expect(r.text).toContain('- NIT: 900.123.456-7');
        expect(r.text).toContain('- Correo electrónico: datos@acme.co');
        // Las finalidades se expanden una por renglón (y pueden usar variables).
        expect(r.text).toContain('- Atender mi solicitud y gestionar la relación comercial o contractual.');
        expect(r.text).toContain('promociones de Acme S.A.S.');
        // Derechos del titular y carácter facultativo de los datos sensibles.
        expect(r.text).toContain('Revocar la autorización');
        expect(r.text).toContain('Superintendencia de Industria y Comercio');
        expect(r.text).toContain('es facultativo responder');
        expect(r.text).toContain('puede consultarse en https://acme.co/privacidad.');
        expect(r.text).not.toMatch(/\{\{/);
        expect(r.label).toBe('He leído y acepto la autorización para el tratamiento de mis datos personales por parte de Acme S.A.S..');
        expect(r.policy_url).toBe('https://acme.co/privacidad');
    });

    it('un renglón con una variable vacía no aparece (sin «NIT: » colgando)', () => {
        const cfg = dataConsentConfigSchema.parse({
            responsible: { email: 'hola@acme.co', phone: '3001112233' },
        });
        const r = renderDataConsent(cfg, { tenantName: 'Acme' });
        // Sin nombre propio del responsable: el de la empresa en la app.
        expect(r.text).toContain('- Nombre o razón social: Acme');
        expect(r.text).not.toContain('NIT:');
        expect(r.text).not.toContain('Dirección:');
        expect(r.text).not.toContain('puede consultarse en');
        expect(r.policy_url).toBeNull();
        expect(r.text).not.toMatch(/\n{3,}/);
    });

    it('una variable desconocida queda escrita para que se corrija en la vista previa', () => {
        expect(fillDataConsentText('Hola {{empresa}} y {{otra}}', { empresa: 'Acme' })).toBe('Hola Acme y {{otra}}');
    });

    it('sin finalidades el renglón de la lista desaparece', () => {
        expect(fillDataConsentText('Finalidades:\n{{finalidades}}\nFin', { finalidades: '' })).toBe('Finalidades:\nFin');
    });

    it('exige lo que pide el art. 12: responsable, correo, teléfono y finalidades', () => {
        const empty = dataConsentConfigSchema.parse({ purposes: [] });
        const missing = dataConsentMissing(empty, { tenantName: '' });
        expect(missing).toEqual([
            'Nombre o razón social del responsable',
            'Correo para ejercer los derechos',
            'Teléfono del responsable',
            'Al menos una finalidad',
        ]);
        expect(dataConsentMissing(full, { tenantName: 'Acme' })).toEqual([]);
        expect(dataConsentRecommended(dataConsentConfigSchema.parse({}))).toHaveLength(3);
        expect(dataConsentRecommended(full)).toEqual([]);
    });

    it('la lectura de la configuración guardada nunca lanza', () => {
        expect(readDataConsentConfig({ enabled: 'sí', purposes: 5 }).enabled).toBe(false);
        expect(readDataConsentConfig(null).ask_in_portal).toBe(true);
        expect(readDataConsentConfig(undefined).purposes.length).toBeGreaterThan(0);
    });
});
