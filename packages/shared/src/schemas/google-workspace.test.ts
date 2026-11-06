import { describe, expect, it } from 'vitest';
import {
    googleGrantMissing,
    googleScopeLabels,
    googleWorkspaceAdminMessage,
    googleWorkspaceAdminSteps,
    isGoogleWorkspaceBlockError,
    integrationDef,
    integrationScopes,
    meetingActionKind,
} from '../index';

/** v0.1.384 — Google Workspace que bloquea la app y permisos destildados. */
describe('Google Workspace', () => {
    it('los permisos se dicen en palabras, sin repetir los de identidad', () => {
        const scopes = integrationScopes(integrationDef('google_calendar')!, { purpose: 'agenda' });
        expect(googleScopeLabels(scopes)).toEqual([
            'Ver tu nombre y tu correo',
            'Ver y editar los eventos de tus calendarios',
            'Ver la lista de tus calendarios',
        ]);
    });

    it('detecta la casilla destildada en la pantalla de Google', () => {
        const requested = integrationScopes(integrationDef('google_calendar')!);
        // Google concedió sólo la identidad: falta el calendario.
        expect(googleGrantMissing(requested, 'openid https://www.googleapis.com/auth/userinfo.email')).toEqual([
            'https://www.googleapis.com/auth/calendar.events',
        ]);
        expect(googleGrantMissing(requested, `openid email ${'https://www.googleapis.com/auth/calendar.events'}`)).toEqual([]);
        // Sin saber qué se concedió, no se bloquea nada.
        expect(googleGrantMissing(requested, '')).toEqual([]);
    });

    it('reconoce el bloqueo del administrador y arma el mensaje para TI', () => {
        expect(isGoogleWorkspaceBlockError('admin_policy_enforced')).toBe(true);
        expect(isGoogleWorkspaceBlockError('access_denied: The administrator has blocked this app')).toBe(true);
        expect(isGoogleWorkspaceBlockError('access_denied')).toBe(false);
        const help = { client_id: '123-abc.apps.googleusercontent.com', app_name: 'Acme Base', permissions: ['Ver y editar los eventos de tus calendarios'] };
        const msg = googleWorkspaceAdminMessage(help, 'Google Calendar');
        expect(msg).toContain('123-abc.apps.googleusercontent.com');
        expect(msg).toContain('Acme Base');
        expect(msg).toContain('Controles de API');
        expect(msg).toContain('De confianza');
        expect(googleWorkspaceAdminSteps(help.client_id).some((s) => s.includes(help.client_id))).toBe(true);
        // Español neutro.
        expect(msg).not.toMatch(/\b(tenés|podés|andá|mandale)\b/i);
    });

    it('«Crear reunión de Google Meet» es una acción de reunión', () => {
        expect(meetingActionKind('google_calendar', 'create_meeting')).toBe('create');
        const act = integrationDef('google_calendar')!.actions.find((a) => a.key === 'create_meeting')!;
        expect(act.params.find((p) => p.key === 'meet')!.default).toBe('true');
    });
});
