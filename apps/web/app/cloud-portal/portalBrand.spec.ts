// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyPortalBrand, PORTAL_NEUTRAL_ICON, PORTAL_NEUTRAL_TITLE, portalTitle } from './portalBrand';

/** v0.1.245 — el portal no muestra nada de la plataforma, sólo la marca de la empresa. */
describe('applyPortalBrand', () => {
    const icons = () => Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'));

    it('sin empresa (dominio de la plataforma): portal neutro, ni marca ni nombre de la app', () => {
        applyPortalBrand(null);
        expect(document.title).toBe(PORTAL_NEUTRAL_TITLE);
        expect(document.title).not.toMatch(/imagina/i);
        expect(icons().map((l) => l.getAttribute('href'))).toEqual([PORTAL_NEUTRAL_ICON]);
        expect(document.documentElement.style.getPropertyValue('--imcrm-primary')).toBe('');
    });

    it('con empresa: su nombre en la pestaña, su logo como ícono y su color', () => {
        applyPortalBrand({ name: 'Acme', logoUrl: '/api/v1/files/7/signed?x=1', primaryColor: '#16a34a' });
        expect(document.title).toBe('Acme — Portal de clientes');
        expect(icons().map((l) => l.getAttribute('href'))).toEqual(['/api/v1/files/7/signed?x=1']);
        expect(document.documentElement.style.getPropertyValue('--imcrm-primary')).not.toBe('');
    });

    it('al salir de la sesión vuelve a la marca del dominio (o neutro) sin acumular íconos', () => {
        applyPortalBrand({ name: 'Acme', logoUrl: '/logo.png', primaryColor: '#16a34a' });
        applyPortalBrand({ name: 'Acme', logoUrl: null, primaryColor: null });
        expect(icons()).toHaveLength(1);
        expect(icons()[0]!.getAttribute('href')).toBe(PORTAL_NEUTRAL_ICON);
        expect(document.documentElement.style.getPropertyValue('--imcrm-primary')).toBe('');
    });

    it('portalTitle ignora un nombre vacío', () => {
        expect(portalTitle({ name: '  ', logoUrl: null, primaryColor: null })).toBe(PORTAL_NEUTRAL_TITLE);
    });
});
