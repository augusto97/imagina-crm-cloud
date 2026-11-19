import { z } from 'zod';
import { integrationDef } from './integrations';
import { mapFlowChildLists } from './automation-flow';

/**
 * v0.1.400 — Reemplazar la conexión que usan las acciones de las
 * automatizaciones («pasar mis envíos de WAS a Whats»).
 *
 * Antes la única forma era abrir cada automatización, elegir otra vez la
 * acción en «Tipo de acción» y volver a escribir el número y el mensaje: la
 * acción arrancaba vacía. Con 18 acciones repartidas en varias listas eso es
 * una tarde de trabajo y un error de tipeo en cada una.
 *
 * Dos orígenes posibles:
 *  - una CONEXIÓN de la galería (otra cuenta de la misma app, o WAS ↔ Whats):
 *    se cambia la conexión y se conservan los datos que la otra app entiende;
 *  - las LLAMADAS DIRECTAS a la API de WAS (`/api/send/whatsapp` armado a mano
 *    en «Llamar webhook externo», con la cuenta y la clave en la llamada): se
 *    convierten en la acción con nombre de la app elegida («Enviar mensaje de
 *    WhatsApp»), con su número y su mensaje.
 *
 * PURO a propósito: la vista previa del servidor, el cambio en lote y el
 * selector del editor usan la MISMA traducción, así lo que se muestra antes es
 * exactamente lo que queda guardado.
 */

const WHATSAPP_APPS = new Set(['whatsapp', 'whatsapp_web']);

/** ¿Las acciones de una conexión de `from` se pueden pasar a una de `to`? */
export function swapAppsCompatible(from: string | null | undefined, to: string | null | undefined): boolean {
    if (!from || !to) return false;
    if (from === to) return integrationDef(to) !== null;
    return WHATSAPP_APPS.has(from) && WHATSAPP_APPS.has(to);
}

/** ¿A una conexión de esta app se le pueden pasar las llamadas directas a la API de WAS? */
export function acceptsWasApiCalls(app: string | null | undefined): boolean {
    return app === 'whatsapp_web' || app === 'whatsapp';
}

export type MediaKind = 'image' | 'video' | 'audio' | 'document';

const KIND_LABEL: Record<MediaKind, string> = { image: 'Imagen', video: 'Video', audio: 'Audio', document: 'Documento PDF' };

/** El tipo de archivo por el enlace (WAS lo pide; Whats lo reconoce solo). */
export function guessMediaKind(url: string): MediaKind {
    const u = url.toLowerCase();
    if (/\.pdf(\b|$)|pdf\.link|\bpdf\b/.test(u)) return 'document';
    if (/\.(mp4|mov|webm|3gp)(\b|$)/.test(u)) return 'video';
    if (/\.(mp3|ogg|oga|opus|aac|m4a|amr|wav)(\b|$)/.test(u)) return 'audio';
    return 'image';
}

export type SwapOutcome =
    | { ok: true; action_key: string; values: Record<string, string>; notes: string[] }
    | { ok: false; reason: string };

function paramLabel(app: string, actionKey: string, key: string): string {
    const p = integrationDef(app)?.actions.find((a) => a.key === actionKey)?.params.find((x) => x.key === key);
    return p?.label ?? key;
}

/**
 * Los datos de una acción de conector al pasarla a una conexión de otra app (o
 * de la misma). Se conservan los que la acción de destino entiende; lo que no,
 * se quita y se dice. Si falta algo obligatorio, NO se pasa: quedaría una
 * acción que falla en cada corrida.
 */
export function carryConnectorValues(
    fromApp: string,
    toApp: string,
    actionKey: string,
    values: Record<string, unknown> | null | undefined,
): SwapOutcome {
    const target = integrationDef(toApp);
    const action = target?.actions.find((a) => a.key === actionKey);
    if (!target || !action) {
        return { ok: false, reason: `«${target?.name ?? toApp}» no tiene la acción «${paramLabel(fromApp, actionKey, actionKey)}».` };
    }
    const keys = new Set(action.params.map((p) => p.key));
    const out: Record<string, string> = {};
    const dropped: string[] = [];
    for (const [k, v] of Object.entries(values ?? {})) {
        if (v === undefined || v === null) continue;
        const s = typeof v === 'string' ? v : String(v);
        if (keys.has(k)) out[k] = s;
        else if (s.trim() !== '') dropped.push(k);
    }
    const notes: string[] = [];
    // WAS pide el tipo de archivo; Whats lo reconoce por el enlace.
    if (actionKey === 'send_media' && toApp === 'whatsapp' && fromApp !== 'whatsapp' && !(out.kind ?? '').trim()) {
        const kind = guessMediaKind(out.url ?? '');
        out.kind = kind;
        notes.push(`El tipo de archivo quedó en «${KIND_LABEL[kind]}»: revísalo si no es ese.`);
    }
    for (const k of dropped) {
        if (k === 'kind' && toApp === 'whatsapp_web') notes.push('El tipo de archivo ya no hace falta: Whats lo reconoce por el enlace.');
        else notes.push(`Se quitó «${paramLabel(fromApp, actionKey, k)}»: «${target.name}» no lo usa.`);
    }
    for (const p of action.params) {
        if (p.required && !(out[p.key] ?? '').trim()) return { ok: false, reason: `Le falta «${p.label}».` };
    }
    return { ok: true, action_key: actionKey, values: out, notes };
}

// ── Llamadas directas a la API de WAS ───────────────────────────────────

/**
 * `URL` existe en Node y en el navegador, pero el paquete compila sin el DOM:
 * se declara aquí lo mínimo que se usa (como en `embeds.ts`).
 */
interface ParsedUrl {
    protocol: string;
    host: string;
    pathname: string;
    searchParams: { forEach(cb: (value: string, key: string) => void): void };
}
declare const URL: { new (input: string): ParsedUrl };

/** La ruta de envío de la API de WAS (la anterior y la que se arma a mano). */
export const WAS_API_SEND_PATH = '/api/send/whatsapp';

function joinBase(base: string | null, url: string): string {
    if (/^https?:\/\//i.test(url) || !base) return url;
    return `${base.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
}

function readRows(raw: unknown): Array<[string, string]> {
    if (Array.isArray(raw)) {
        return raw
            .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
            .map((r) => [String(r.key ?? '').trim(), r.value === undefined || r.value === null ? '' : String(r.value)] as [string, string])
            .filter(([k]) => k !== '');
    }
    if (raw !== null && typeof raw === 'object') {
        return Object.entries(raw as Record<string, unknown>)
            .map(([k, v]) => [k.trim(), v === undefined || v === null ? '' : String(v)] as [string, string])
            .filter(([k]) => k !== '');
    }
    return [];
}

/** Un cuerpo escrito a mano: `a=1&b=2` o un objeto JSON plano. */
function parseTemplate(raw: string): Array<[string, string]> | null {
    const t = raw.trim();
    if (t === '') return [];
    if (t.startsWith('{')) {
        try {
            const obj = JSON.parse(t) as unknown;
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
            const out: Array<[string, string]> = [];
            for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
                if (v !== null && typeof v === 'object') return null;
                out.push([k, v === undefined || v === null ? '' : String(v)]);
            }
            return out;
        } catch {
            return null;
        }
    }
    if (!t.includes('=') || /\s/.test(t.split('&')[0] ?? '')) return null;
    const out: Array<[string, string]> = [];
    for (const part of t.split('&')) {
        if (part === '') continue;
        const i = part.indexOf('=');
        const k = i < 0 ? part : part.slice(0, i);
        const v = i < 0 ? '' : part.slice(i + 1);
        try {
            out.push([decodeURIComponent(k.replace(/\+/g, ' ')), decodeURIComponent(v.replace(/\+/g, ' '))]);
        } catch {
            out.push([k, v]);
        }
    }
    return out;
}

export interface WasApiCall {
    host: string;
    /** La cuenta de WAS escrita en la llamada (`account`), si tiene. */
    account: string | null;
    fields: Record<string, string>;
    /** El cuerpo está escrito a mano y no se entiende como datos. */
    unreadable: boolean;
}

/**
 * ¿Esta «Llamar webhook externo» es un envío a la API de WAS? `baseUrl` es la
 * de la conexión que usa la llamada (si la ruta es relativa).
 */
export function readWasApiCall(cfg: Record<string, unknown> | null | undefined, baseUrl: string | null = null): WasApiCall | null {
    if (!cfg) return null;
    const raw = typeof cfg.url === 'string' ? cfg.url.trim() : '';
    if (raw === '') return null;
    let parsed: ParsedUrl;
    try {
        parsed = new URL(joinBase(baseUrl, raw));
    } catch {
        return null;
    }
    if (!/^https?:$/.test(parsed.protocol)) return null;
    if (parsed.pathname.replace(/\/+$/, '').toLowerCase() !== WAS_API_SEND_PATH) return null;
    const rows: Array<[string, string]> = [];
    parsed.searchParams.forEach((v, k) => rows.push([k, v]));
    rows.push(...readRows(cfg.query_params));
    const bodyRows = readRows(cfg.body_params);
    let unreadable = false;
    if (bodyRows.length > 0) rows.push(...bodyRows);
    else if (typeof cfg.body_template === 'string' && cfg.body_template.trim() !== '') {
        const tpl = parseTemplate(cfg.body_template);
        if (tpl === null) unreadable = true;
        else rows.push(...tpl);
    }
    const fields: Record<string, string> = {};
    for (const [k, v] of rows) fields[k.toLowerCase()] = v;
    const account = (fields.account ?? '').trim();
    return { host: parsed.host.toLowerCase(), account: account === '' ? null : account, fields, unreadable };
}

/** Clave con la que se agrupan las llamadas directas (una por servidor y cuenta). */
export function wasApiSourceKey(call: Pick<WasApiCall, 'host' | 'account'>): string {
    return `was:${call.host}|${call.account ?? ''}`;
}

const WAS_KNOWN = new Set([
    'secret',
    'account',
    'type',
    'recipient',
    'phone',
    'message',
    'media_url',
    'media_type',
    'media_file',
    'document_url',
    'document_name',
    'document_type',
    'document_file',
]);

/**
 * Convierte una llamada directa a la API de WAS en la acción con nombre de
 * `toApp` (Whats o WAS). La clave y la cuenta de la llamada no pasan: salen de
 * la conexión elegida.
 */
export function convertWasApiCall(call: WasApiCall, cfg: Record<string, unknown> | null | undefined, toApp: string): SwapOutcome {
    if (!acceptsWasApiCalls(toApp)) return { ok: false, reason: 'Esa conexión no manda WhatsApp.' };
    const responseName = typeof cfg?.response_name === 'string' ? cfg.response_name.trim() : '';
    if (responseName !== '') {
        return { ok: false, reason: `Los pasos siguientes leen su respuesta («respuestas.${responseName}»): cámbiala desde el editor.` };
    }
    if (call.unreadable) return { ok: false, reason: 'El cuerpo de la llamada está escrito a mano: cámbiala desde el editor.' };
    const f = call.fields;
    const recipient = (f.recipient ?? f.phone ?? '').trim();
    if (recipient === '') return { ok: false, reason: 'La llamada no tiene el número de destino.' };
    const type = (f.type ?? 'text').trim().toLowerCase() || 'text';
    const message = f.message ?? '';
    const notes: string[] = [];
    if (call.account) notes.push('Sale del número de la conexión elegida: la cuenta escrita en la llamada ya no se usa.');
    const ignored = Object.keys(f).filter((k) => !WAS_KNOWN.has(k) && (f[k] ?? '').trim() !== '');
    if (ignored.length > 0) notes.push(`Se quitó ${ignored.map((k) => `«${k}»`).join(', ')}: la acción no lo usa.`);

    if (type === 'text') {
        if (message.trim() === '') return { ok: false, reason: 'La llamada no tiene el mensaje.' };
        return { ok: true, action_key: 'send_text', values: { recipient, message }, notes };
    }
    if (type === 'media' || type === 'document') {
        const url = (type === 'media' ? f.media_url : f.document_url) ?? '';
        if (url.trim() === '') {
            return {
                ok: false,
                reason: (f.media_file ?? f.document_file) ? 'La llamada sube el archivo en vez de usar un enlace: cámbiala desde el editor.' : 'La llamada no tiene el enlace del archivo.',
            };
        }
        const values: Record<string, string> = { recipient, url };
        if (message.trim() !== '') values.caption = message;
        if (toApp === 'whatsapp') {
            const mt = (f.media_type ?? '').trim().toLowerCase();
            values.kind = type === 'document' ? 'document' : mt === 'video' || mt === 'audio' || mt === 'image' ? mt : guessMediaKind(url);
        }
        return { ok: true, action_key: 'send_media', values, notes };
    }
    return { ok: false, reason: `La llamada usa un tipo de envío que la acción no tiene («${type}»): cámbiala desde el editor.` };
}

// ── El recorrido de las acciones ────────────────────────────────────────

/** Lo que se sabe de cada conexión de la empresa (app y dirección base). */
export type SwapConnectionInfo = ReadonlyMap<number, { app: string | null; baseUrl: string | null }>;

export interface SwapFinding {
    /** Lugar de la acción en el flujo: `2`, `1.then.0`, `0.each.1`. */
    path: string;
    /** `conn:<id>` o `was:<servidor>|<cuenta>`. */
    source: string;
    /** La acción que queda: `send_text`, `send_media`… */
    action_key: string;
    ok: boolean;
    notes: string[];
    reason: string | null;
}

/**
 * Recorre las acciones (con sus ramas «Si / sino» y «Repetir por cada
 * vinculado») y devuelve qué se podría pasar a la conexión `target`. Con
 * `apply`, además devuelve las acciones ya cambiadas para los orígenes
 * elegidos; lo demás queda IGUAL (incluida la condición de cada acción).
 */
export function swapConnectionInActions(
    actions: unknown,
    target: { id: number; app: string },
    connections: SwapConnectionInfo,
    apply: ReadonlySet<string> | null = null,
): { actions: unknown[]; findings: SwapFinding[] } {
    const findings: SwapFinding[] = [];
    const visit = (list: unknown, prefix: string): unknown[] => {
        if (!Array.isArray(list)) return [];
        return list.map((raw, i) => {
            if (raw === null || typeof raw !== 'object') return raw;
            const action = raw as Record<string, unknown>;
            const path = prefix === '' ? String(i) : `${prefix}.${i}`;
            const cfg = action.config && typeof action.config === 'object' && !Array.isArray(action.config) ? (action.config as Record<string, unknown>) : {};
            let next: Record<string, unknown> = action;

            if (action.type === 'connector_action') {
                const id = Number(cfg.connection_id);
                const info = Number.isFinite(id) ? connections.get(id) : undefined;
                const key = typeof cfg.action_key === 'string' ? cfg.action_key : '';
                if (info && id !== target.id && swapAppsCompatible(info.app, target.app)) {
                    const source = `conn:${id}`;
                    const responseName = typeof cfg.response_name === 'string' ? cfg.response_name.trim() : '';
                    const out: SwapOutcome =
                        responseName !== '' && info.app !== target.app
                            ? { ok: false, reason: `Los pasos siguientes leen su respuesta («respuestas.${responseName}»): cámbiala desde el editor.` }
                            : carryConnectorValues(info.app ?? '', target.app, key, cfg.values as Record<string, unknown>);
                    findings.push({
                        path,
                        source,
                        action_key: key,
                        ok: out.ok,
                        notes: out.ok ? out.notes : [],
                        reason: out.ok ? null : out.reason,
                    });
                    if (out.ok && apply?.has(source)) {
                        next = { ...action, config: { ...cfg, connection_id: target.id, action_key: out.action_key, values: out.values } };
                    }
                }
            } else if (action.type === 'call_webhook' && acceptsWasApiCalls(target.app)) {
                const conn = Number(cfg.connection_id);
                const base = Number.isFinite(conn) ? (connections.get(conn)?.baseUrl ?? null) : null;
                const call = readWasApiCall(cfg, base);
                if (call) {
                    const source = wasApiSourceKey(call);
                    const out = convertWasApiCall(call, cfg, target.app);
                    findings.push({
                        path,
                        source,
                        action_key: out.ok ? out.action_key : 'send_text',
                        ok: out.ok,
                        notes: out.ok ? out.notes : [],
                        reason: out.ok ? null : out.reason,
                    });
                    if (out.ok && apply?.has(source)) {
                        // Se conserva lo que no es de la llamada (la condición de la acción, su id…).
                        const rest = { ...action };
                        delete rest.config;
                        next = { ...rest, type: 'connector_action', config: { connection_id: target.id, action_key: out.action_key, values: out.values } };
                    }
                }
            }

            // Las ramas (si/sino, el bucle, «Según el valor de…» y «Si falla»).
            return mapFlowChildLists(next, (list, branch) => visit(list, `${path}.${branch}`));
        });
    };
    const out = visit(actions, '');
    return { actions: out, findings };
}

// ── API: vista previa y cambio en lote ──────────────────────────────────

export const applyConnectionSwapSchema = z.object({
    /** Los orígenes elegidos (`conn:12`, `was:servidor|cuenta`). */
    sources: z.array(z.string().trim().min(1).max(400)).min(1).max(50),
});
export type ApplyConnectionSwapInput = z.infer<typeof applyConnectionSwapSchema>;

export interface ConnectionSwapAutomation {
    id: number;
    name: string;
    list_id: number;
    list_slug: string;
    list_name: string;
    is_active: boolean;
    /** Acciones que se pasan. */
    actions: number;
    /** Las que no se pueden pasar solas, con el motivo. */
    skipped: Array<{ path: string; reason: string }>;
}

export interface ConnectionSwapSource {
    key: string;
    kind: 'connection' | 'was_api';
    /** «WhatsApp (WAS) · Ventas» o «Llamadas directas a la API de WAS». */
    label: string;
    /** «Cuenta …e878 · was.imagina.cloud», el número… */
    detail: string | null;
    connection_id: number | null;
    app: string | null;
    actions: number;
    skipped: number;
    automations: ConnectionSwapAutomation[];
    /** Lo que cambia al pasarlas (sin repetir). */
    notes: string[];
}

export interface ConnectionSwapPreview {
    target: { id: number; name: string; app: string; app_name: string };
    sources: ConnectionSwapSource[];
}

export interface ConnectionSwapResult {
    automations: number;
    actions: number;
    /** Automatizaciones que no se pudieron guardar (con el motivo); las demás quedaron. */
    failed: Array<{ automation_id: number; automation_name: string; reason: string }>;
}
