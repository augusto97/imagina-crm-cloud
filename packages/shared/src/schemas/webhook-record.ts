/**
 * v0.1.399 — Webhook entrante con REGISTRO en contexto.
 *
 * Hasta acá el disparador «Webhook entrante» corría sin registro: los datos
 * del JSON quedaban como variables y «Actualizar un campo» decía «Sin
 * registro en contexto». Ahora el disparador decide qué hacer con el registro:
 *
 *  - `none`   — como siempre: sólo variables (`{{payload.x}}`).
 *  - `create` — crea un registro con los datos del JSON cuyo nombre coincide
 *               con el nombre interno de un campo.
 *  - `update` — busca UN registro de la lista y corre las acciones sobre él;
 *               si no existe, la corrida se cancela con el motivo.
 *  - `upsert` — lo actualiza si existe y si no, lo crea.
 *
 * Se busca por el ID del registro (único en toda la app) o por un campo
 * marcado «Sin repetidos» (o un ID automático): nunca hay que adivinar cuál
 * de varios actualizar.
 *
 * Puro y sin zod en las funciones de lectura: lo usan el motor, el editor y
 * el asistente con la MISMA interpretación.
 */

export const WEBHOOK_RECORD_MODES = ['none', 'create', 'update', 'upsert'] as const;
export type WebhookRecordMode = (typeof WEBHOOK_RECORD_MODES)[number];

/** Tipos de campo por los que se puede buscar el registro. */
export const WEBHOOK_MATCH_FIELD_TYPES = ['text', 'email', 'phone', 'number', 'url', 'autonumber'] as const;
export type WebhookMatchFieldType = (typeof WEBHOOK_MATCH_FIELD_TYPES)[number];

export type WebhookMatch = { by: 'record_id' } | { by: 'field'; field: string };

export interface WebhookRecordConfig {
    mode: WebhookRecordMode;
    match: WebhookMatch;
    /** Ruta del dato en el JSON (`record_id`, `data.id`, `cliente.telefono`). */
    matchKey: string;
    /** Al actualizar: escribir también los datos del JSON en los campos con el mismo nombre. */
    applyPayloadFields: boolean;
}

/** Ruta con puntos: hasta 5 tramos de letras, números o `_` (como las variables `{{payload.x}}`). */
const PATH_RE = /^[A-Za-z0-9_]{1,64}(\.[A-Za-z0-9_]{1,64}){0,4}$/;

export function isValidPayloadPath(path: string): boolean {
    return PATH_RE.test(path);
}

export function webhookModeUsesRecord(mode: WebhookRecordMode): boolean {
    return mode !== 'none';
}

/** ¿El modo busca un registro existente? */
export function webhookModeSearches(mode: WebhookRecordMode): boolean {
    return mode === 'update' || mode === 'upsert';
}

/** La clave por defecto: `record_id` o el nombre interno del campo. */
export function defaultMatchKey(match: WebhookMatch): string {
    return match.by === 'field' && match.field !== '' ? match.field : 'record_id';
}

/**
 * Lee la parte «registro» de un `trigger_config` de webhook entrante.
 * Tolerante: lo que no se entiende vuelve al valor de siempre (`none`).
 */
export function readWebhookRecordConfig(cfg: unknown): WebhookRecordConfig {
    const c = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : {};
    const mode = (WEBHOOK_RECORD_MODES as readonly string[]).includes(c.record_mode as string) ? (c.record_mode as WebhookRecordMode) : 'none';
    const rawMatch = c.match && typeof c.match === 'object' && !Array.isArray(c.match) ? (c.match as Record<string, unknown>) : {};
    const match: WebhookMatch =
        rawMatch.by === 'field' && typeof rawMatch.field === 'string' && rawMatch.field.trim() !== ''
            ? { by: 'field', field: rawMatch.field.trim() }
            : { by: 'record_id' };
    const rawKey = typeof c.match_key === 'string' ? c.match_key.trim() : '';
    const matchKey = rawKey !== '' && isValidPayloadPath(rawKey) ? rawKey : defaultMatchKey(match);
    return { mode, match, matchKey, applyPayloadFields: c.apply_payload_fields === true };
}

/** Lo que se guarda en `trigger_config` (sin claves de más cuando el modo es `none`). */
export function writeWebhookRecordConfig(rc: WebhookRecordConfig): Record<string, unknown> {
    if (rc.mode === 'none') return {};
    const out: Record<string, unknown> = { record_mode: rc.mode };
    if (rc.mode === 'create') {
        return out;
    }
    out.match = rc.match.by === 'field' ? { by: 'field', field: rc.match.field } : { by: 'record_id' };
    out.match_key = rc.matchKey;
    if (rc.applyPayloadFields) out.apply_payload_fields = true;
    return out;
}

/** Lee una ruta con puntos del JSON (`data.items.0.id`). */
export function readPayloadPath(payload: unknown, path: string): unknown {
    let cur: unknown = payload;
    for (const part of path.split('.')) {
        if (cur === null || cur === undefined) return undefined;
        if (Array.isArray(cur)) {
            if (!/^\d+$/.test(part)) return undefined;
            cur = cur[Number(part)];
        } else if (typeof cur === 'object') {
            cur = (cur as Record<string, unknown>)[part];
        } else {
            return undefined;
        }
    }
    return cur;
}

/** Escribe un valor en una ruta con puntos (arma los objetos intermedios). */
export function setPayloadPath(target: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let cur: Record<string, unknown> = target;
    parts.forEach((part, i) => {
        if (i === parts.length - 1) {
            cur[part] = value;
            return;
        }
        const next = cur[part];
        if (next === null || typeof next !== 'object' || Array.isArray(next)) cur[part] = {};
        cur = cur[part] as Record<string, unknown>;
    });
}

/**
 * El id de registro que trae el JSON: entero positivo (también como texto,
 * «5134»). Devuelve null si no hay uno usable.
 */
export function parseRecordIdValue(v: unknown): number | null {
    if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER) return v;
    if (typeof v === 'string' && /^\s*\d{1,15}\s*$/.test(v)) {
        const n = Number(v.trim());
        return n > 0 ? n : null;
    }
    return null;
}

/** Valor del JSON como texto para mostrar en un mensaje (corto). */
export function describePayloadValue(v: unknown): string {
    if (v === undefined) return '(no viene)';
    if (v === null) return 'null';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

export interface WebhookMatchFieldLike {
    slug: string;
    type: string;
    label?: string;
    is_unique?: boolean;
}

/**
 * ¿Se puede buscar el registro por este campo? Sólo por uno que no se repite:
 * un ID automático (único por construcción) o uno marcado «Sin repetidos».
 * Devuelve el motivo si no, o null.
 */
export function webhookMatchFieldError(field: WebhookMatchFieldLike | undefined): string | null {
    if (!field) return 'El campo para buscar el registro ya no existe en la lista.';
    const name = field.label ? `«${field.label}»` : `«${field.slug}»`;
    if (!(WEBHOOK_MATCH_FIELD_TYPES as readonly string[]).includes(field.type)) {
        return `No se puede buscar por ${name}: sólo por un campo de texto, correo, teléfono, número, enlace o ID automático.`;
    }
    if (field.type !== 'autonumber' && field.is_unique !== true) {
        return `Para buscar por ${name} márcalo como «Sin repetidos»: así nunca hay dos registros con el mismo valor.`;
    }
    return null;
}

/** Valor de ejemplo por tipo de campo (para el JSON de muestra del editor). */
export function exampleValueForField(field: { type: string; config?: unknown }): unknown {
    switch (field.type) {
        case 'email':
            return 'cliente@ejemplo.com';
        case 'phone':
            return '+57 300 123 4567';
        case 'number':
        case 'rating':
        case 'percent':
            return 10;
        case 'currency':
            return 250000;
        case 'duration':
            return 90;
        case 'date':
            return '2026-12-01';
        case 'datetime':
            return '2026-12-01T15:00:00Z';
        case 'checkbox':
            return true;
        case 'url':
            return 'https://ejemplo.com';
        case 'autonumber':
            return 'TCK-0001';
        case 'long_text':
            return 'Un texto más largo';
        case 'select':
        case 'multi_select': {
            const opts = (field.config as { options?: Array<{ value?: unknown }> } | undefined)?.options;
            const first = Array.isArray(opts) ? opts.find((o) => typeof o?.value === 'string')?.value : undefined;
            const v = typeof first === 'string' ? first : 'opcion';
            return field.type === 'multi_select' ? [v] : v;
        }
        default:
            return 'Texto';
    }
}

/** Tipos que un JSON puede escribir en un campo (crear o actualizar). */
const PAYLOAD_WRITABLE_TYPES = new Set([
    'text', 'long_text', 'number', 'currency', 'select', 'multi_select', 'date', 'datetime', 'checkbox',
    'url', 'email', 'phone', 'rating', 'percent', 'duration',
]);

export interface WebhookExampleField {
    slug: string;
    type: string;
    label?: string;
    config?: unknown;
    is_primary?: boolean;
}

/**
 * El JSON de ejemplo que se arma solo con la configuración: la clave para
 * buscar en su ruta y, cuando se escriben datos, un par de campos reales de
 * la lista con un valor de muestra. `extra` suma claves propias (lo que
 * después se usa como `{{payload.x}}`).
 */
export function webhookExamplePayload(
    rc: WebhookRecordConfig,
    fields: readonly WebhookExampleField[],
    opts: { recordId?: number; extra?: Record<string, unknown> } = {},
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const writable = fields.filter((f) => PAYLOAD_WRITABLE_TYPES.has(f.type));
    const ordered = [...writable.filter((f) => f.is_primary), ...writable.filter((f) => !f.is_primary)];
    if (webhookModeSearches(rc.mode)) {
        const matchField = rc.match.by === 'field' ? fields.find((f) => f.slug === (rc.match as { field: string }).field) : undefined;
        const value = rc.match.by === 'record_id' ? (opts.recordId ?? 5134) : matchField ? exampleValueForField(matchField) : 'valor';
        setPayloadPath(out, rc.matchKey, value);
    }
    const writes = rc.mode === 'create' || rc.mode === 'upsert' || (rc.mode === 'update' && rc.applyPayloadFields) || rc.mode === 'none';
    if (writes) {
        const taken = new Set(Object.keys(out));
        for (const f of ordered) {
            if (taken.has(f.slug)) continue;
            out[f.slug] = exampleValueForField(f);
            taken.add(f.slug);
            if (Object.keys(out).length >= 3) break;
        }
    }
    for (const [k, v] of Object.entries(opts.extra ?? {})) if (!(k in out)) out[k] = v;
    return out;
}

/**
 * En lenguaje claro, qué hace el disparador con el registro (para el resumen
 * del editor y la tarjeta del asistente). Vacío si no usa registro.
 */
export function describeWebhookRecord(rc: WebhookRecordConfig, labelOf: (slug: string) => string = (s) => s): string {
    if (rc.mode === 'none') return '';
    if (rc.mode === 'create') return 'crea un registro';
    const by = rc.match.by === 'record_id' ? `su id en «${rc.matchKey}»` : `«${labelOf(rc.match.field)}»`;
    return rc.mode === 'update' ? `actualiza el registro (busca por ${by})` : `actualiza o crea el registro (busca por ${by})`;
}
