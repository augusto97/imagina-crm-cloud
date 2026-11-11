import type { WhatsLookupKind } from '@imagina-base/shared';
import type { IntegrationRequest } from '../connectors/integration-calls';
import type { WaWebCreds } from './whatsapp-web';

/**
 * v0.1.401 — Los pedidos del conector completo de Whats (API v1). PURO: arma
 * cada pedido y lee cada respuesta. El servicio, el motor y el «Probar ahora»
 * del editor usan estas MISMAS funciones, así lo que se prueba es lo que sale.
 *
 * Lo que dice la documentación de la API:
 * - Las listas devuelven `data`, `links` y `meta.next_cursor` (hasta 100 por página).
 * - `GET /contacts/lookup?phone=` busca un contacto existente por teléfono (404 si no está).
 * - `PUT /contacts` crea o actualiza por teléfono o correo (sólo cambia lo que se manda).
 * - Etiquetas y grupos se ponen y se quitan por id, de a muchos a la vez.
 * - Activar un flujo y reanudarlo responden 202 con la ejecución.
 * - Las respuestas de error son siempre `{ error: { code, message, details } }`.
 */

function headers(c: WaWebCreds, json: boolean): Record<string, string> {
    return {
        authorization: `Bearer ${c.key}`,
        accept: 'application/json',
        ...(json ? { 'content-type': 'application/json' } : {}),
    };
}

const api = (c: WaWebCreds, path: string): string => `${c.server}/api/v1${path}`;

function get(c: WaWebCreds, path: string): IntegrationRequest {
    return { url: api(c, path), method: 'GET', headers: headers(c, false) };
}

function send(c: WaWebCreds, method: IntegrationRequest['method'], path: string, body: unknown): IntegrationRequest {
    return { url: api(c, path), method, headers: headers(c, true), body: JSON.stringify(body) };
}

const e164 = (digits: string): string => (digits.startsWith('+') ? digits : `+${digits}`);

// ── Contactos ─────────────────────────────────────────────────────────

export function waWebLookupContactRequest(c: WaWebCreds, phoneDigits: string): IntegrationRequest {
    return get(c, `/contacts/lookup?phone=${encodeURIComponent(e164(phoneDigits))}`);
}

export interface WaWebContactInput {
    phone: string;
    name?: string;
    email?: string;
    language?: string;
    fields?: Record<string, string>;
}

/** Crea o actualiza por teléfono: sólo viaja lo que se completó (vacío = no se toca). */
export function waWebUpsertContactRequest(c: WaWebCreds, input: WaWebContactInput): IntegrationRequest {
    const body: Record<string, unknown> = { phone: e164(input.phone) };
    if (input.name && input.name.trim() !== '') body.name = input.name.trim().slice(0, 255);
    if (input.email && input.email.trim() !== '') body.email = input.email.trim();
    if (input.language && input.language.trim() !== '') body.language = input.language.trim();
    if (input.fields && Object.keys(input.fields).length > 0) body.fields = input.fields;
    return send(c, 'PUT', '/contacts', body);
}

export function waWebContactTagsRequest(c: WaWebCreds, contactId: number, tagIds: number[], attach: boolean): IntegrationRequest {
    return send(c, attach ? 'POST' : 'DELETE', `/contacts/${contactId}/tags`, { tag_ids: tagIds });
}

export function waWebGroupContactsRequest(c: WaWebCreds, groupId: number, contactIds: number[], add: boolean): IntegrationRequest {
    return send(c, add ? 'POST' : 'DELETE', `/groups/${groupId}/contacts`, { contact_ids: contactIds });
}

export function waWebContactNoteRequest(c: WaWebCreds, contactId: number, note: string): IntegrationRequest {
    return send(c, 'POST', `/contacts/${contactId}/notes`, { body: note.slice(0, 10000) });
}

export function waWebConsentRequest(c: WaWebCreds, contactId: number, input: { text: string; source: string; grantedAt: string }): IntegrationRequest {
    return send(c, 'POST', `/contacts/${contactId}/consent`, {
        channel: 'wa',
        source: input.source.slice(0, 191),
        text: input.text.slice(0, 5000),
        granted_at: input.grantedAt,
    });
}

export function waWebUnsubscribeRequest(c: WaWebCreds, phoneDigits: string, reason: string): IntegrationRequest {
    const body: Record<string, unknown> = { phone: e164(phoneDigits), scope: 'all' };
    if (reason.trim() !== '') body.reason = reason.trim().slice(0, 255);
    return send(c, 'POST', '/unsubscribed', body);
}

export function waWebCreateTagRequest(c: WaWebCreds, name: string): IntegrationRequest {
    return send(c, 'POST', '/tags', { name: name.slice(0, 100) });
}

export function waWebCreateGroupRequest(c: WaWebCreds, name: string): IntegrationRequest {
    return send(c, 'POST', '/groups', { name: name.slice(0, 120) });
}

// ── Flujos y goteos ───────────────────────────────────────────────────

export function waWebTriggerFlowRequest(c: WaWebCreds, flowId: number, contactId: number, variables: Record<string, string>): IntegrationRequest {
    const body: Record<string, unknown> = { contact_id: contactId };
    if (Object.keys(variables).length > 0) body.variables = variables;
    return send(c, 'POST', `/flows/${flowId}/trigger`, body);
}

export function waWebResumeFlowRequest(c: WaWebCreds, runId: number, token: string, variables: Record<string, string>): IntegrationRequest {
    const body: Record<string, unknown> = { resume_token: token };
    if (Object.keys(variables).length > 0) body.variables = variables;
    return send(c, 'POST', `/flow-runs/${runId}/resume`, body);
}

export function waWebEnrollDripRequest(c: WaWebCreds, dripId: number, contactId: number): IntegrationRequest {
    return send(c, 'POST', `/drips/${dripId}/enroll`, { contact_id: contactId });
}

// ── Bandeja ───────────────────────────────────────────────────────────

/** Las conversaciones de WhatsApp de un teléfono (la búsqueda de Whats mira el contacto). */
export function waWebFindConversationsRequest(c: WaWebCreds, phoneDigits: string): IntegrationRequest {
    const q = new URLSearchParams({ search: e164(phoneDigits), channel: 'wa', status: 'all', limit: '25' });
    return get(c, `/conversations?${q.toString()}`);
}

export function waWebReplyRequest(c: WaWebCreds, conversationId: number, message: string): IntegrationRequest {
    return send(c, 'POST', `/conversations/${conversationId}/reply`, { body: message.slice(0, 4096) });
}

export function waWebConversationStatusRequest(c: WaWebCreds, conversationId: number, operation: 'resolve' | 'reopen'): IntegrationRequest {
    return { url: api(c, `/conversations/${conversationId}/${operation}`), method: 'POST', headers: headers(c, true), body: '{}' };
}

// ── Listas de la cuenta ───────────────────────────────────────────────

const LIST_PATH: Record<WhatsLookupKind, string> = {
    tags: '/tags',
    groups: '/groups',
    flows: '/flows',
    drips: '/drips',
    contact_fields: '/contacts/fields',
};

export function waWebListRequest(c: WaWebCreds, kind: WhatsLookupKind, cursor?: string | null): IntegrationRequest {
    const q = new URLSearchParams({ limit: '100' });
    if (cursor) q.set('cursor', cursor);
    return get(c, `${LIST_PATH[kind]}?${q.toString()}`);
}

// ── Respuestas ────────────────────────────────────────────────────────

function parseJson(body: string): unknown {
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
}

function rec(v: unknown): Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function posInt(v: unknown): number | null {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
}

/** `data` de una respuesta (o el objeto mismo, si viene sin el sobre). */
function dataOf(body: string): Record<string, unknown> {
    const root = rec(parseJson(body));
    const data = rec(root.data);
    return Object.keys(data).length > 0 ? data : root;
}

export interface WaWebContact {
    id: number;
    phone: string | null;
    name: string | null;
    email: string | null;
}

export function parseWaWebContact(body: string): WaWebContact | null {
    const d = dataOf(body);
    const id = posInt(d.id);
    if (id === null) return null;
    const s = (v: unknown) => (str(v).trim() === '' ? null : str(v).trim());
    return { id, phone: s(d.phone), name: s(d.name), email: s(d.email) };
}

/** El id de lo que se acaba de crear (etiqueta, grupo). */
export function parseWaWebCreatedId(body: string): number | null {
    return posInt(dataOf(body).id);
}

export interface WaWebListItem {
    id: number | null;
    /** La clave de un campo personalizado (para los campos, el id no sirve). */
    key: string | null;
    name: string;
    status: string | null;
    type: string | null;
}

export function parseWaWebList(body: string): { items: WaWebListItem[]; next: string | null } {
    const root = rec(parseJson(body));
    const data = Array.isArray(root.data) ? root.data : [];
    const items: WaWebListItem[] = [];
    for (const raw of data) {
        const r = rec(raw);
        const name = str(r.name).trim() || str(r.label).trim() || str(r.key).trim();
        if (name === '') continue;
        items.push({
            id: posInt(r.id),
            key: str(r.key).trim() || null,
            name,
            status: str(r.status).trim() || null,
            type: str(r.type).trim() || null,
        });
    }
    const next = str(rec(root.meta).next_cursor).trim();
    return { items, next: next === '' ? null : next };
}

export function parseWaWebFlowRun(body: string): { id: number | null; status: string | null } {
    const d = dataOf(body);
    return { id: posInt(d.id), status: str(d.status).trim() || null };
}

export function parseWaWebEnroll(body: string): { enrolled: number; refused: number } {
    const d = dataOf(body);
    return { enrolled: Number(d.enrolled) || 0, refused: Number(d.refused) || 0 };
}

export interface WaWebConversation {
    id: number;
    contactId: number | null;
    channel: string | null;
    status: string | null;
    lastMessageAt: string | null;
}

export function parseWaWebConversations(body: string): WaWebConversation[] {
    const data = rec(parseJson(body)).data;
    if (!Array.isArray(data)) return [];
    const out: WaWebConversation[] = [];
    for (const raw of data) {
        const r = rec(raw);
        const id = posInt(r.id);
        if (id === null) continue;
        out.push({
            id,
            contactId: posInt(r.contact_id),
            channel: str(r.channel).trim() || null,
            status: str(r.status).trim() || null,
            lastMessageAt: str(r.last_message_at).trim() || null,
        });
    }
    return out;
}

/**
 * La conversación de WhatsApp de ESE contacto (la búsqueda de Whats es por
 * texto: puede traer otras). La más reciente; una abierta gana a una resuelta.
 */
export function pickConversation(list: WaWebConversation[], contactId: number | null): WaWebConversation | null {
    const mine = list.filter((c) => (c.channel === null || c.channel === 'wa') && (contactId === null || c.contactId === contactId));
    if (mine.length === 0) return null;
    const score = (c: WaWebConversation) => (c.status === 'open' ? 1 : 0);
    return [...mine].sort((a, b) => score(b) - score(a) || (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '') || b.id - a.id)[0]!;
}

/** El id del mensaje de una respuesta en la bandeja. */
export function parseWaWebMessageId(body: string): string | null {
    const id = str(dataOf(body).id).trim();
    return id === '' ? null : id;
}

// ── El plan de una acción (sin red) ───────────────────────────────────

/**
 * Lo que va a hacer una acción, con las variables ya resueltas y los datos
 * validados. Se arma DENTRO de la transacción (sin red) y se ejecuta después
 * (v0.1.392: la red nunca espera con la transacción abierta).
 */
export type WhatsPlan =
    | { action: 'upsert_contact'; phone: string; name: string; email: string; language: string; fields: Record<string, string>; fallbackName: string }
    | { action: 'add_tags' | 'remove_tags'; phone: string; tags: string[]; createMissing: boolean; createName: string }
    | { action: 'add_to_group' | 'remove_from_group'; phone: string; group: string; createMissing: boolean; createName: string }
    | { action: 'add_note'; phone: string; note: string; createName: string }
    | { action: 'record_consent'; phone: string; text: string; source: string; grantedAt: string; createName: string }
    | { action: 'unsubscribe'; phone: string; reason: string }
    | { action: 'trigger_flow'; phone: string; flowId: number; flowLabel: string; variables: Record<string, string>; createName: string }
    | { action: 'resume_flow'; runId: number; token: string; variables: Record<string, string> }
    | { action: 'enroll_drip'; phone: string; dripId: number; dripLabel: string; createName: string }
    | { action: 'reply_conversation'; phone: string; message: string; conversationId: number | null }
    | { action: 'conversation_status'; phone: string; operation: 'resolve' | 'reopen'; conversationId: number | null };

export type WhatsPlanResult = { ok: true; plan: WhatsPlan } | { ok: false; error: string };

/** Lo que hará el plan, en palabras («Pondría…»: la prueba y la simulación lo muestran así). */
export function describeWhatsPlan(p: WhatsPlan): string {
    const to = 'phone' in p ? `+${p.phone}` : '';
    const list = (xs: string[]) => xs.map((x) => `«${x}»`).join(', ');
    switch (p.action) {
        case 'upsert_contact':
            return `Crearía o actualizaría el contacto ${to} en Whats${p.name ? ` como «${p.name}»` : ''}.`;
        case 'add_tags':
            return `Pondría ${p.tags.length === 1 ? 'la etiqueta' : 'las etiquetas'} ${list(p.tags)} al contacto ${to}.`;
        case 'remove_tags':
            return `Quitaría ${p.tags.length === 1 ? 'la etiqueta' : 'las etiquetas'} ${list(p.tags)} al contacto ${to}.`;
        case 'add_to_group':
            return `Agregaría el contacto ${to} al grupo «${p.group}».`;
        case 'remove_from_group':
            return `Sacaría el contacto ${to} del grupo «${p.group}».`;
        case 'add_note':
            return `Agregaría una nota al contacto ${to}.`;
        case 'record_consent':
            return `Registraría el consentimiento del contacto ${to} («${p.source}»).`;
        case 'unsubscribe':
            return `Daría de baja el número ${to} en Whats.`;
        case 'trigger_flow':
            return `Activaría el flujo «${p.flowLabel}» para el contacto ${to}.`;
        case 'resume_flow':
            return `Reanudaría la ejecución ${p.runId} del flujo.`;
        case 'enroll_drip':
            return `Inscribiría el contacto ${to} en el goteo «${p.dripLabel}».`;
        case 'reply_conversation':
            return `Respondería en la conversación de ${to}.`;
        case 'conversation_status':
            return `${p.operation === 'resolve' ? 'Resolvería' : 'Reabriría'} la conversación de ${to}.`;
    }
}

/**
 * Arma el plan con los datos ya resueltos. `phoneOf` normaliza el teléfono
 * (con el indicativo del número de la empresa); `labelOf` da el nombre de un
 * flujo o goteo elegido de la lista (para los mensajes).
 */
export function planWhatsAction(
    actionKey: string,
    v: Record<string, string>,
    deps: {
        phoneOf: (raw: string) => { ok: true; digits: string } | { ok: false; error: string };
        names: (raw: string) => string[];
        keyValues: (raw: string) => Record<string, string>;
        flag: (raw: string, fallback: boolean) => boolean;
        /** El título del registro: el nombre con que se crea un contacto que no existe. */
        title: string;
        nowIso: string;
    },
): WhatsPlanResult {
    const need = (key: string, what: string): string | null => ((v[key] ?? '').trim() === '' ? what : null);
    const phone = (): { ok: true; digits: string } | { ok: false; error: string } => {
        const raw = (v.recipient ?? '').trim();
        if (raw === '') return { ok: false, error: 'Falta el teléfono del contacto.' };
        const r = deps.phoneOf(raw);
        return r.ok ? r : { ok: false, error: `El teléfono del contacto no sirve: ${r.error}` };
    };
    const createName = (v.name ?? '').trim() || deps.title;
    const intOf = (raw: string): number | null => {
        const n = Number(raw.trim().replace(/^#/, ''));
        return Number.isInteger(n) && n > 0 ? n : null;
    };
    const conv = (): number | null => intOf(v.conversation ?? '');

    if (actionKey === 'resume_flow') {
        const runId = intOf(v.run_id ?? '');
        if (runId === null) return { ok: false, error: (v.run_id ?? '').trim() === '' ? 'Falta la ejecución del flujo.' : `«${v.run_id}» no es el número de una ejecución.` };
        const token = (v.resume_token ?? '').trim();
        if (token === '') return { ok: false, error: 'Falta el token para reanudar.' };
        return { ok: true, plan: { action: 'resume_flow', runId, token, variables: deps.keyValues(v.variables ?? '') } };
    }

    const p = phone();
    if (!p.ok) return { ok: false, error: p.error };
    const digits = p.digits;

    switch (actionKey) {
        case 'upsert_contact': {
            const email = (v.email ?? '').trim();
            if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: `«${email}» no es un correo válido.` };
            return {
                ok: true,
                plan: {
                    action: 'upsert_contact',
                    phone: digits,
                    name: (v.name ?? '').trim(),
                    email,
                    language: (v.language ?? '').trim(),
                    fields: deps.keyValues(v.fields ?? ''),
                    fallbackName: deps.title,
                },
            };
        }
        case 'add_tags':
        case 'remove_tags': {
            const tags = deps.names(v.tags ?? '');
            if (tags.length === 0) return { ok: false, error: 'Elige al menos una etiqueta.' };
            return { ok: true, plan: { action: actionKey, phone: digits, tags, createMissing: actionKey === 'add_tags' && deps.flag(v.create_missing ?? '', true), createName } };
        }
        case 'add_to_group':
        case 'remove_from_group': {
            const group = deps.names(v.group ?? '')[0] ?? '';
            if (group === '') return { ok: false, error: 'Elige el grupo.' };
            return { ok: true, plan: { action: actionKey, phone: digits, group, createMissing: actionKey === 'add_to_group' && deps.flag(v.create_missing ?? '', true), createName } };
        }
        case 'add_note': {
            const miss = need('note', 'Falta la nota.');
            if (miss) return { ok: false, error: miss };
            return { ok: true, plan: { action: 'add_note', phone: digits, note: (v.note ?? '').trim(), createName } };
        }
        case 'record_consent': {
            const miss = need('consent_text', 'Falta el texto que aceptó.') ?? need('source', 'Falta dónde lo aceptó.');
            if (miss) return { ok: false, error: miss };
            const rawAt = (v.granted_at ?? '').trim();
            let grantedAt = deps.nowIso;
            if (rawAt !== '') {
                const d = new Date(rawAt);
                if (Number.isNaN(d.getTime())) return { ok: false, error: `«${rawAt}» no es una fecha válida.` };
                grantedAt = d.toISOString();
            }
            return { ok: true, plan: { action: 'record_consent', phone: digits, text: (v.consent_text ?? '').trim(), source: (v.source ?? '').trim(), grantedAt, createName } };
        }
        case 'unsubscribe':
            return { ok: true, plan: { action: 'unsubscribe', phone: digits, reason: (v.reason ?? '').trim() } };
        case 'trigger_flow': {
            const flowId = intOf(v.flow ?? '');
            if (flowId === null) return { ok: false, error: 'Elige el flujo.' };
            return { ok: true, plan: { action: 'trigger_flow', phone: digits, flowId, flowLabel: (v.flow_label ?? '').trim() || `#${flowId}`, variables: deps.keyValues(v.variables ?? ''), createName } };
        }
        case 'enroll_drip': {
            const dripId = intOf(v.drip ?? '');
            if (dripId === null) return { ok: false, error: 'Elige el goteo.' };
            return { ok: true, plan: { action: 'enroll_drip', phone: digits, dripId, dripLabel: (v.drip_label ?? '').trim() || `#${dripId}`, createName } };
        }
        case 'reply_conversation': {
            const miss = need('message', 'El mensaje está vacío.');
            if (miss) return { ok: false, error: miss };
            return { ok: true, plan: { action: 'reply_conversation', phone: digits, message: v.message ?? '', conversationId: conv() } };
        }
        case 'conversation_status': {
            const op = (v.operation ?? '').trim() || 'resolve';
            if (op !== 'resolve' && op !== 'reopen') return { ok: false, error: 'Elige si resolver o reabrir la conversación.' };
            return { ok: true, plan: { action: 'conversation_status', phone: digits, operation: op, conversationId: conv() } };
        }
        default:
            return { ok: false, error: `La acción «${actionKey}» no existe en Whats.` };
    }
}
