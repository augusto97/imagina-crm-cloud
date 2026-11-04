import { describe, expect, it } from 'vitest';
import { INTEGRATIONS, integrationScopes } from './integrations';
import { buildMsAdminConsentUrl, isMsConsentError, msAdminConsentScopes, msScopeLabels } from './ms-admin-consent';

const teams = INTEGRATIONS.find((d) => d.key === 'teams')!;
const outlook = INTEGRATIONS.find((d) => d.key === 'outlook')!;

describe('aprobación del administrador de Microsoft 365', () => {
    it('los permisos de Graph van con su recurso completo y los de OpenID quedan como son', () => {
        const s = msAdminConsentScopes(integrationScopes(teams));
        const list = s.split(' ');
        expect(list).toContain('openid');
        expect(list).toContain('offline_access');
        expect(list).toContain('https://graph.microsoft.com/User.Read');
        expect(list).toContain('https://graph.microsoft.com/ChannelMessage.Send');
        expect(list).toContain('https://graph.microsoft.com/Chat.Create');
        expect(list.filter((x) => x.includes('ChannelMessage.Send')).length).toBe(1);
        // Un permiso que ya trae su recurso no se duplica.
        expect(msAdminConsentScopes('https://graph.microsoft.com/Mail.Send Mail.Send')).toBe('https://graph.microsoft.com/Mail.Send');
    });

    it('el enlace apunta a /v2.0/adminconsent de «organizations» con la URI de siempre y el state', () => {
        const url = new URL(
            buildMsAdminConsentUrl({
                clientId: 'abc-123',
                scopes: integrationScopes(outlook),
                redirectUri: 'https://base.example.com/api/v1/connections/oauth/callback',
                state: 'ac_xyz',
            }),
        );
        expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/organizations/v2.0/adminconsent');
        expect(url.searchParams.get('client_id')).toBe('abc-123');
        expect(url.searchParams.get('redirect_uri')).toBe('https://base.example.com/api/v1/connections/oauth/callback');
        expect(url.searchParams.get('state')).toBe('ac_xyz');
        expect(url.searchParams.get('scope')).toContain('https://graph.microsoft.com/Mail.Send');
        expect(url.searchParams.get('scope')).toContain('https://graph.microsoft.com/Calendars.ReadWrite');
    });

    it('los permisos se leen en palabras, sin repetir', () => {
        const labels = msScopeLabels(integrationScopes(teams));
        expect(labels).toContain('Publicar mensajes en canales de Teams');
        expect(labels).toContain('Enviar mensajes en chats de Teams');
        expect(labels.filter((l) => l === 'Iniciar sesión con la cuenta de Microsoft').length).toBe(1);
        expect(msScopeLabels('https://graph.microsoft.com/Mail.Send')).toEqual(['Enviar correos en nombre de quien conecta']);
    });

    it('reconoce las vueltas de Microsoft que pueden ser «Se necesita la aprobación del administrador»', () => {
        expect(isMsConsentError('access_denied: AADSTS65004: User declined to consent')).toBe(true);
        expect(isMsConsentError('consent_required: AADSTS65001')).toBe(true);
        expect(isMsConsentError('AADSTS90094: Admin consent is required')).toBe(true);
        expect(isMsConsentError('invalid_client: AADSTS7000215: Invalid client secret')).toBe(false);
        expect(isMsConsentError('El proveedor no devolvió el código de autorización.')).toBe(false);
    });
});
