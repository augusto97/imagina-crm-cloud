import { SITE_COLUMN_TYPES, type SiteColumn, type SiteColumnType, type SiteObjectKind } from '@imagina-base/shared';
import type { IntegrationCreds } from '../../connectors/integration-calls';
import { WpApiError, wpGet, wpSend } from './wp-fetch';
import type { WpJson } from './wp-map';

/**
 * El complemento «Imagina Base Connector» visto desde la app (v0.1.334,
 * ADR-S84). Rutas propias bajo `/imagina-base/v1`, con la MISMA contraseña de
 * aplicación de la conexión. Lo único que sabe hablar con ellas: el motor, el
 * descubrimiento y el tiempo real pasan por aquí.
 */

export const IBC_NS = '/imagina-base/v1';
/** Hasta 100 objetos por lectura (el tope del complemento). */
export const IBC_READ_CHUNK = 100;
export const IBC_WRITE_CHUNK = 50;

export interface IbcSeoInfo {
    plugin: string;
    name: string;
    version: string;
    terms: boolean;
    others: string[];
    problem: string | null;
}

export interface IbcHooksStatus {
    registered: boolean;
    url: string | null;
    objects: { post_types: string[]; taxonomies: string[]; media: boolean } | null;
    pending: number;
    delivered: number;
    fails: number;
    last_ok_at: string | null;
    last_error: string | null;
    disabled: string | null;
    secret_fingerprint: string | null;
    /** La huella de las columnas que la app le dijo que vigile (complemento 1.1+). */
    watch_hash: string | null;
    /** El complemento sabe vigilar columnas (1.1+): si no, no se compara la huella. */
    watch_supported: boolean;
}

/** «Dónde se usa cada imagen» (complemento 1.1+): se arma una vez, en segundo plano. */
export interface IbcMediaIndex {
    status: 'none' | 'building' | 'ready';
    done: number;
    ready_at: string | null;
}

export interface IbcInfo {
    version: string;
    seo: IbcSeoInfo | null;
    providers: { acf: boolean; metabox: boolean; jetengine: boolean };
    can_manage: boolean;
    /** Puede tener avisos en tiempo real (1.1+: también un Editor, hacia la app). Complemento viejo: `can_manage`. */
    can_hooks: boolean;
    hooks: IbcHooksStatus | null;
    updates: boolean;
    /** Las versiones del complemento se verifican con firma antes de instalarse. */
    signed: boolean;
    media_index: IbcMediaIndex | null;
}

export interface IbcColumn {
    key: string;
    label: string;
    type: string;
    provider: string;
    editable: boolean;
    options: Array<{ value: string; label: string }> | null;
    image: boolean;
    hint: string | null;
    private: boolean;
    group: string | null;
}

export interface IbcSchemaObject {
    kind: SiteObjectKind;
    object: string;
    columns: IbcColumn[];
}

/** El tipo de objeto en el idioma del complemento. */
function kindOf(kind: SiteObjectKind): 'post_type' | 'taxonomy' | 'media' {
    return kind;
}

function obj(v: unknown): WpJson {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as WpJson) : {};
}

function str(v: unknown): string | null {
    return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * ¿Está el complemento? `installed: false` sin `error` = la ruta no existe
 * (no lo instalaron, o lo desactivaron). Con `error` = está pero no se pudo
 * leer (un permiso, el sitio caído).
 */
export async function ibcInfo(creds: IntegrationCreds): Promise<{ installed: true; info: IbcInfo } | { installed: false; error: string | null }> {
    let json: unknown;
    try {
        json = (await wpGet(creds, `${IBC_NS}/info`)).json;
    } catch (err) {
        if (err instanceof WpApiError && (err.status === 404 || err.wp.code === 'rest_no_route')) return { installed: false, error: null };
        return { installed: false, error: err instanceof Error ? err.message : String(err) };
    }
    const j = obj(json);
    if (j.plugin !== 'imagina-base-connector' || typeof j.version !== 'string') return { installed: false, error: null };
    const seo = obj(j.seo);
    const providers = obj(j.providers);
    return {
        installed: true,
        info: {
            version: j.version,
            seo:
                typeof seo.plugin === 'string'
                    ? {
                          plugin: seo.plugin,
                          name: typeof seo.name === 'string' ? seo.name : seo.plugin,
                          version: typeof seo.version === 'string' ? seo.version : '',
                          terms: seo.terms === true,
                          others: Array.isArray(seo.others) ? seo.others.map(String) : [],
                          problem: str(seo.problem),
                      }
                    : null,
            providers: { acf: providers.acf === true, metabox: providers.metabox === true, jetengine: providers.jetengine === true },
            can_manage: j.can_manage === true,
            can_hooks: typeof j.can_hooks === 'boolean' ? j.can_hooks : j.can_manage === true,
            hooks: j.hooks ? readHooksStatus(j.hooks) : null,
            updates: j.updates === true,
            signed: j.signed === true,
            media_index: readMediaIndex(j.media_index),
        },
    };
}

export function readMediaIndex(v: unknown): IbcMediaIndex | null {
    const m = obj(v);
    if (m.status !== 'none' && m.status !== 'building' && m.status !== 'ready') return null;
    return { status: m.status, done: Number(m.done) || 0, ready_at: str(m.ready_at) };
}

export function readHooksStatus(v: unknown): IbcHooksStatus {
    const h = obj(v);
    const o = obj(h.objects);
    return {
        registered: h.registered === true,
        url: str(h.url),
        objects: h.objects
            ? {
                  post_types: Array.isArray(o.post_types) ? o.post_types.map(String) : [],
                  taxonomies: Array.isArray(o.taxonomies) ? o.taxonomies.map(String) : [],
                  media: o.media === true,
              }
            : null,
        pending: Number(h.pending) || 0,
        delivered: Number(h.delivered) || 0,
        fails: Number(h.fails) || 0,
        last_ok_at: str(h.last_ok_at),
        last_error: str(h.last_error),
        disabled: str(h.disabled),
        secret_fingerprint: str(h.secret_fingerprint),
        watch_hash: str(h.watch_hash),
        watch_supported: Object.prototype.hasOwnProperty.call(h, 'watch_hash'),
    };
}

/** Las columnas extra por tipo de objeto. */
export async function ibcSchema(creds: IntegrationCreds): Promise<IbcSchemaObject[]> {
    const j = obj((await wpGet(creds, `${IBC_NS}/schema`)).json);
    const out: IbcSchemaObject[] = [];
    for (const raw of Array.isArray(j.objects) ? j.objects : []) {
        const o = obj(raw);
        const kind = o.kind === 'taxonomy' || o.kind === 'media' ? o.kind : o.kind === 'post_type' ? 'post_type' : null;
        if (!kind || typeof o.object !== 'string') continue;
        const columns: IbcColumn[] = [];
        for (const c of Array.isArray(o.columns) ? o.columns : []) {
            const col = obj(c);
            if (typeof col.key !== 'string' || typeof col.label !== 'string') continue;
            columns.push({
                key: col.key,
                label: col.label,
                type: typeof col.type === 'string' ? col.type : 'text',
                provider: typeof col.provider === 'string' ? col.provider : 'plugin',
                editable: col.editable === true,
                options: Array.isArray(col.options)
                    ? col.options
                          .map((x) => obj(x))
                          .filter((x) => typeof x.value === 'string')
                          .map((x) => ({ value: String(x.value), label: typeof x.label === 'string' && x.label !== '' ? x.label : String(x.value) }))
                    : null,
                image: col.image === true,
                hint: str(col.hint),
                private: col.private === true,
                group: str(col.group),
            });
        }
        out.push({ kind, object: o.object, columns });
    }
    return out;
}

/** Columnas que vienen marcadas al elegir el tipo de contenido. */
const DEFAULT_ON = new Set(['seo:title', 'seo:description', 'seo:focus_keyword', 'seo:google_title', 'seo:google_description', 'plugin:words', 'plugin:used_in', 'plugin:used_count']);

/** Una columna del complemento → la forma del descubrimiento. */
export function ibcColumnToSite(c: IbcColumn): SiteColumn {
    const type = (SITE_COLUMN_TYPES as readonly string[]).includes(c.type) ? (c.type as SiteColumnType) : 'text';
    return {
        key: c.key,
        label: c.label,
        source: c.provider === 'seo' || c.key.startsWith('seo:') ? 'seo' : 'plugin',
        type,
        can_edit: c.editable,
        default_on: DEFAULT_ON.has(c.key),
        default_edit: false,
        always: false,
        hint: c.hint,
        sample: null,
        private: c.private,
        options: c.options,
        image: c.image,
        provider: c.provider,
    };
}

/**
 * Lee en lote: `id → (clave → valor)`. Los que el complemento salteó (no
 * existen o el usuario no puede editarlos) no aparecen. `meta.mediaIndexBuilding`
 * = «Dónde se usa» todavía se está calculando en el sitio: esas columnas no
 * vinieron (se vuelven a leer cuando termine).
 */
export async function ibcRead(
    creds: IntegrationCreds,
    kind: SiteObjectKind,
    object: string,
    ids: number[],
    fields: string[],
    meta?: { mediaIndexBuilding?: boolean },
): Promise<Map<number, Record<string, unknown>>> {
    const out = new Map<number, Record<string, unknown>>();
    if (ids.length === 0 || fields.length === 0) return out;
    for (let i = 0; i < ids.length; i += IBC_READ_CHUNK) {
        const chunk = ids.slice(i, i + IBC_READ_CHUNK);
        const res = obj(await wpSend(creds, 'POST', `${IBC_NS}/items/read`, { kind: kindOf(kind), object, ids: chunk, fields }, [], { idempotent: true, timeoutMs: 60_000 }));
        if (meta && readMediaIndex(res.media_index)?.status === 'building') meta.mediaIndexBuilding = true;
        for (const [id, values] of Object.entries(obj(res.items))) {
            const n = Number(id);
            if (Number.isInteger(n) && n > 0) out.set(n, obj(values));
        }
    }
    return out;
}

export interface IbcWriteResult {
    id: number;
    ok: boolean;
    errors: Record<string, string>;
}

export async function ibcWrite(
    creds: IntegrationCreds,
    kind: SiteObjectKind,
    object: string,
    items: Array<{ id: number; values: Record<string, unknown> }>,
): Promise<IbcWriteResult[]> {
    const out: IbcWriteResult[] = [];
    for (let i = 0; i < items.length; i += IBC_WRITE_CHUNK) {
        const res = obj(await wpSend(creds, 'POST', `${IBC_NS}/items/write`, { kind: kindOf(kind), object, items: items.slice(i, i + IBC_WRITE_CHUNK) }));
        for (const raw of Array.isArray(res.items) ? res.items : []) {
            const r = obj(raw);
            const errors: Record<string, string> = {};
            for (const [k, v] of Object.entries(obj(r.errors))) errors[k] = String(v);
            out.push({ id: Number(r.id) || 0, ok: r.ok === true, errors });
        }
    }
    return out;
}

export async function ibcHooksStatus(creds: IntegrationCreds): Promise<IbcHooksStatus> {
    return readHooksStatus((await wpGet(creds, `${IBC_NS}/hooks`)).json);
}

export interface IbcRegisterResult {
    registered: boolean;
    ping: { ok: boolean; status: number; error: string | null };
}

export async function ibcHooksRegister(
    creds: IntegrationCreds,
    body: {
        url: string;
        secret: string;
        objects: {
            post_types: string[];
            taxonomies: string[];
            media: boolean;
            /** Las columnas que la app trae por objeto (`post_type:post` → claves): el complemento sólo avisa por esas. */
            fields?: Record<string, string[]>;
            watch_hash?: string;
        };
    },
): Promise<IbcRegisterResult> {
    const r = obj(await wpSend(creds, 'POST', `${IBC_NS}/hooks`, body, [], { timeoutMs: 45_000 }));
    const p = obj(r.ping);
    return { registered: r.registered === true, ping: { ok: p.ok === true, status: Number(p.status) || 0, error: str(p.error) } };
}

export async function ibcHooksDelete(creds: IntegrationCreds): Promise<void> {
    await wpSend(creds, 'DELETE', `${IBC_NS}/hooks`, null);
}
