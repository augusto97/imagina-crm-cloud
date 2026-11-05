import { describe, expect, it } from 'vitest';
import {
    INTEGRATION_SCOPES_ADDED,
    integrationDef,
    integrationMissingScopes,
    integrationScopes,
    meetingActionKind,
    missingActionScopes,
    scopesForRefresh,
} from './integrations';

/** v0.1.366 — reuniones de Teams, Outlook y Google Calendar desde automatizaciones. */
describe('reuniones y eventos', () => {
    const teams = integrationDef('teams')!;

    it('Teams crea, reprograma y cancela reuniones; Outlook y Google reprograman y cancelan', () => {
        for (const [app, keys] of [
            ['teams', ['create_meeting', 'update_event', 'cancel_event']],
            ['outlook', ['create_event', 'update_event', 'cancel_event']],
            ['google_calendar', ['create_event', 'update_event', 'cancel_event']],
        ] as const) {
            const def = integrationDef(app)!;
            for (const key of keys) {
                const act = def.actions.find((a) => a.key === key);
                expect(act, `${app}.${key}`).toBeDefined();
                expect(meetingActionKind(app, key)).toBe(key.startsWith('create') ? 'create' : key.split('_')[0]);
            }
        }
        expect(meetingActionKind('teams', 'send_channel_message')).toBeNull();
        expect(meetingActionKind('slack', 'cancel_event')).toBeNull();
        // Reprogramar: sólo el id es obligatorio (lo vacío no se toca).
        const update = teams.actions.find((a) => a.key === 'update_event')!;
        expect(update.params.filter((p) => p.required).map((p) => p.key)).toEqual(['event_id']);
        expect(update.params.find((p) => p.key === 'duration')!.default).toBe('');
        // Crear: con fin, lugar e invitados opcionales; Teams con el enlace encendido.
        const create = teams.actions.find((a) => a.key === 'create_meeting')!;
        expect(create.params.map((p) => p.key)).toEqual(
            expect.arrayContaining(['title', 'date', 'end', 'location', 'attendees', 'optional_attendees', 'teams_meeting']),
        );
        expect(create.params.find((p) => p.key === 'teams_meeting')!.default).toBe('true');
    });

    it('Teams pide el calendario; una conexión de antes sólo lo pide para las reuniones', () => {
        expect(integrationScopes(teams)).toContain('Calendars.ReadWrite');
        expect(INTEGRATION_SCOPES_ADDED.teams).toBe('Calendars.ReadWrite');

        const before = 'Channel.ReadBasic.All ChannelMessage.Send Chat.Create ChatMessage.Send email openid Team.ReadBasic.All User.Read profile';
        expect(integrationMissingScopes(teams, before)).toEqual(['Calendars.ReadWrite']);
        expect(missingActionScopes('teams', 'create_meeting', before)).toEqual(['Calendars.ReadWrite']);
        expect(missingActionScopes('teams', 'send_channel_message', before)).toEqual([]);
        // Con el recurso de Graph delante o en minúsculas, cuenta igual.
        const after = `${before} https://graph.microsoft.com/calendars.readwrite`;
        expect(integrationMissingScopes(teams, after)).toEqual([]);
        expect(missingActionScopes('teams', 'cancel_event', after)).toEqual([]);
        // Sin saber qué se concedió, no se bloquea nada.
        expect(missingActionScopes('teams', 'create_meeting', '')).toEqual([]);
    });

    it('al renovar se piden sólo los permisos que la conexión ya recibió', () => {
        const requested = integrationScopes(teams);
        const before = 'Channel.ReadBasic.All ChannelMessage.Send Chat.Create ChatMessage.Send email openid Team.ReadBasic.All User.Read profile';
        const refresh = scopesForRefresh(teams, requested, before).split(' ');
        expect(refresh).not.toContain('Calendars.ReadWrite');
        // Los de identidad y renovación van siempre (sin offline_access no hay refresh).
        expect(refresh).toEqual(expect.arrayContaining(['openid', 'email', 'offline_access', 'User.Read', 'ChatMessage.Send']));
        // Una conexión que ya lo aceptó lo sigue pidiendo; sin saber, lo de siempre.
        expect(scopesForRefresh(teams, requested, `${before} Calendars.ReadWrite`)).toBe(requested);
        expect(scopesForRefresh(teams, requested, '')).toBe(requested);
    });
});
