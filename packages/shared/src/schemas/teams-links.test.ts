import { describe, expect, it } from 'vitest';
import { parseTeamsChannelRef, parseTeamsChatRef, teamsChannelLink } from './teams-links';

const TEAM = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';
const CHANNEL = '19:a1b2c3d4e5f6@thread.tacv2';
const CHAT = '19:9f8e7d6c5b4a@thread.v2';

describe('vínculos de Teams (v0.1.348)', () => {
    it('lee el vínculo de un canal tal como lo da Teams', () => {
        const link = `https://teams.microsoft.com/l/channel/${encodeURIComponent(CHANNEL)}/Ventas%20Colombia?groupId=${TEAM}&tenantId=11111111-2222-3333-4444-555555555555`;
        expect(parseTeamsChannelRef(link)).toEqual({ teamId: TEAM, channelId: CHANNEL, channelName: 'Ventas Colombia', teamName: null });
    });

    it('un vínculo a un mensaje de un canal también sirve, con el nombre del canal', () => {
        const link = `https://teams.microsoft.com/l/message/${encodeURIComponent(CHANNEL)}/1700000000000?tenantId=x&groupId=${TEAM}&parentMessageId=1700000000000&teamName=Comercial&channelName=General`;
        expect(parseTeamsChannelRef(link)).toEqual({ teamId: TEAM, channelId: CHANNEL, channelName: 'General', teamName: 'Comercial' });
        // …y no se confunde con un chat.
        expect(parseTeamsChatRef(link)).toBeNull();
    });

    it('acepta «equipo/canal» a mano y el vínculo que arma la app', () => {
        expect(parseTeamsChannelRef(`${TEAM}/${CHANNEL}`)?.channelId).toBe(CHANNEL);
        const own = teamsChannelLink(TEAM, CHANNEL, 'General');
        expect(parseTeamsChannelRef(own)).toMatchObject({ teamId: TEAM, channelId: CHANNEL, channelName: 'General' });
    });

    it('rechaza lo que no es un canal de Teams', () => {
        expect(parseTeamsChannelRef('')).toBeNull();
        expect(parseTeamsChannelRef('General')).toBeNull();
        expect(parseTeamsChannelRef(`https://evil.example.com/l/channel/${encodeURIComponent(CHANNEL)}/x?groupId=${TEAM}`)).toBeNull();
        expect(parseTeamsChannelRef(`https://teams.microsoft.com/l/channel/${encodeURIComponent(CHANNEL)}/x`)).toBeNull();
        expect(parseTeamsChannelRef(`https://teams.microsoft.com/l/chat/${encodeURIComponent(CHAT)}/conversations`)).toBeNull();
    });

    it('lee el vínculo de un chat o de un mensaje del chat', () => {
        expect(parseTeamsChatRef(`https://teams.microsoft.com/l/chat/${encodeURIComponent(CHAT)}/conversations?context=%7B%7D`)).toEqual({ chatId: CHAT });
        const dm = '19:abc_def@unq.gbl.spaces';
        expect(parseTeamsChatRef(`https://teams.microsoft.com/l/message/${encodeURIComponent(dm)}/1700000000000?context=%7B%22contextType%22%3A%22chat%22%7D`)).toEqual({ chatId: dm });
        expect(parseTeamsChatRef(CHAT)).toEqual({ chatId: CHAT });
        // Un canal NO es un chat.
        expect(parseTeamsChatRef(CHANNEL)).toBeNull();
        expect(parseTeamsChatRef('hola')).toBeNull();
    });
});
