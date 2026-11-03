/**
 * Microsoft Teams (v0.1.348) — leer los vínculos que copia la persona.
 *
 * Teams no muestra los identificadores de un canal ni de un chat: lo que la
 * persona tiene a mano es un VÍNCULO («…» junto al canal → «Obtener vínculo
 * al canal», o «Copiar vínculo» sobre un mensaje). Estos lectores sacan de ahí
 * lo que la API necesita, y los usan el servidor (para armar el envío) y el
 * editor (para mostrar a qué canal apunta lo pegado). PUROS.
 *
 * Formas que se aceptan:
 *  - canal: `https://teams.microsoft.com/l/channel/19%3A…%40thread.tacv2/General?groupId=<equipo>&tenantId=…`
 *  - mensaje de un canal: `https://teams.microsoft.com/l/message/19%3A…%40thread.tacv2/1700…?groupId=<equipo>&…`
 *  - chat: `https://teams.microsoft.com/l/chat/19%3A…%40thread.v2/conversations?…`
 *  - mensaje de un chat: `https://teams.microsoft.com/l/message/19%3A…%40unq.gbl.spaces/1700…?context=…`
 *  - a mano: `<id del equipo>/<id del canal>` o el id de un chat (`19:…`).
 */

export interface TeamsChannelRef {
    teamId: string;
    channelId: string;
    /** El nombre que trae el vínculo (`/General`), si lo trae. */
    channelName: string | null;
    /** `teamName=` de los vínculos de mensajes, si lo trae. */
    teamName: string | null;
}

/**
 * El paquete compartido no carga los tipos del DOM ni de Node (igual que
 * `embeds.ts`): se declara lo mínimo que se usa de `URL`.
 */
interface ParsedUrl {
    hostname: string;
    pathname: string;
    searchParams: { get(key: string): string | null };
}
declare const URL: { new (input: string): ParsedUrl };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ids de conversación de Teams: `19:` + algo + `@thread.…` o `@unq.gbl.spaces`. */
const CONVERSATION_ID = /^19:[^\s/?#]+@(thread\.[a-z0-9]+|unq\.gbl\.spaces)$/i;

function safeDecode(raw: string): string {
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

function parseUrl(raw: string): ParsedUrl | null {
    const text = raw.trim();
    if (!/^https?:\/\//i.test(text)) return null;
    try {
        const url = new URL(text);
        return /(^|\.)(teams\.microsoft\.com|teams\.live\.com|teams\.cloud\.microsoft)$/i.test(url.hostname) ? url : null;
    } catch {
        return null;
    }
}

/** `/l/<tipo>/<id>/<resto>` → [tipo, id decodificado, resto decodificado]. */
function linkParts(url: ParsedUrl): { kind: string; id: string; rest: string | null } | null {
    const m = /\/l\/(channel|chat|message)\/([^/]+)(?:\/([^/?#]*))?/i.exec(url.pathname);
    if (!m) return null;
    return { kind: m[1]!.toLowerCase(), id: safeDecode(m[2]!), rest: m[3] ? safeDecode(m[3]) : null };
}

/** El canal al que apunta un vínculo (o el par `equipo/canal`), o `null` si no se entiende. */
export function parseTeamsChannelRef(raw: string): TeamsChannelRef | null {
    const text = (raw ?? '').trim();
    if (text === '') return null;
    const url = parseUrl(text);
    if (!url) {
        const [team, channel, ...more] = text.split('/');
        if (more.length === 0 && team && channel && GUID.test(team) && CONVERSATION_ID.test(safeDecode(channel))) {
            return { teamId: team, channelId: safeDecode(channel), channelName: null, teamName: null };
        }
        return null;
    }
    const parts = linkParts(url);
    const teamId = url.searchParams.get('groupId') ?? '';
    if (!parts || (parts.kind !== 'channel' && parts.kind !== 'message') || !GUID.test(teamId)) return null;
    if (!CONVERSATION_ID.test(parts.id)) return null;
    const channelName =
        parts.kind === 'channel'
            ? parts.rest && parts.rest !== '' ? parts.rest : null
            : url.searchParams.get('channelName');
    return {
        teamId,
        channelId: parts.id,
        channelName: channelName && channelName.trim() !== '' ? channelName : null,
        teamName: url.searchParams.get('teamName'),
    };
}

/** El chat al que apunta un vínculo (o el id pegado a mano), o `null`. Un canal NO es un chat. */
export function parseTeamsChatRef(raw: string): { chatId: string } | null {
    const text = (raw ?? '').trim();
    if (text === '') return null;
    const url = parseUrl(text);
    if (!url) {
        const id = safeDecode(text);
        return CONVERSATION_ID.test(id) && !/@thread\.tacv2$/i.test(id) ? { chatId: id } : null;
    }
    const parts = linkParts(url);
    if (!parts || (parts.kind !== 'chat' && parts.kind !== 'message')) return null;
    // Un vínculo a un mensaje de un CANAL trae el equipo: eso es un canal.
    if (url.searchParams.get('groupId')) return null;
    if (!CONVERSATION_ID.test(parts.id) || /@thread\.tacv2$/i.test(parts.id)) return null;
    return { chatId: parts.id };
}

/** El vínculo de un canal, con la misma forma que el que da Teams («Obtener vínculo al canal»). */
export function teamsChannelLink(teamId: string, channelId: string, channelName: string): string {
    return (
        `https://teams.microsoft.com/l/channel/${encodeURIComponent(channelId)}/` +
        `${encodeURIComponent(channelName || 'canal')}?groupId=${encodeURIComponent(teamId)}`
    );
}

/** Lo que se listó para elegir un canal (`GET /connections/:id/teams/channels`). */
export interface TeamsChannelOption {
    team_id: string;
    team_name: string;
    channels: Array<{ id: string; name: string; link: string; private: boolean }>;
}
