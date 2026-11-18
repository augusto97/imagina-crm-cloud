/**
 * v0.1.444 — Tres piezas nuevas de las automatizaciones (E1 + E2 en parte):
 *
 *  - «Buscar registros» (`find_records`): busca en una lista (la misma u otra)
 *    con condiciones cuyos valores aceptan variables, y deja lo encontrado
 *    para los pasos siguientes (`{{respuestas.<nombre>.cantidad}}`,
 *    `{{respuestas.<nombre>.primero.<campo>}}`).
 *  - «Crear o actualizar un registro» (`upsert_record`): busca UN registro por
 *    su id o por un campo «Sin repetidos» y lo actualiza; si no existe, lo
 *    crea (o sólo actualiza, o sólo crea si no existe).
 *  - «Cuando se agrega un comentario» (`comment_added`): del equipo o del
 *    cliente (portal o correo), interno o visible para el cliente.
 *
 * Todo puro y sin zod: lo usan el motor, el editor y el asistente.
 */
import { RESPONSE_NAME_RE } from './automation-flow';
import { isDataField, type FieldType } from './field';

export const FIND_RECORDS_ACTION = 'find_records';
export const UPSERT_RECORD_ACTION = 'upsert_record';
export const COMMENT_ADDED_TRIGGER = 'comment_added';

/** Tope de registros que trae una búsqueda (los pasos siguientes leen hasta aquí). */
export const FIND_RECORDS_MAX = 50;
export const FIND_RECORDS_DEFAULT_LIMIT = 10;

/** Los operadores de una condición de búsqueda (los de siempre, sin rangos relativos). */
export const FIND_OPERATORS = ['eq', 'neq', 'contains', 'not_contains', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'] as const;
export type FindOperator = (typeof FIND_OPERATORS)[number];

export const FIND_OPERATOR_LABELS: Record<FindOperator, string> = {
    eq: 'es',
    neq: 'no es',
    contains: 'contiene',
    not_contains: 'no contiene',
    gt: 'es mayor que',
    gte: 'es mayor o igual que',
    lt: 'es menor que',
    lte: 'es menor o igual que',
    is_null: 'está vacío',
    is_not_null: 'tiene valor',
};

/**
 * Los campos por los que se puede buscar o filtrar: los que guardan su valor en
 * el registro (también el ID automático y un campo con IA) y las relaciones.
 * Los calculados, los de sistema y los archivos no.
 */
export function isFindableFieldType(type: string): boolean {
    if (type === 'relation') return true;
    if (type === 'file') return false;
    return isDataField(type as FieldType);
}

export function findOperatorIsNullary(op: FindOperator): boolean {
    return op === 'is_null' || op === 'is_not_null';
}

/** Ordenar por un campo (slug) o por la fecha de alta del registro (`created_at`). */
export const FIND_SORT_SYSTEM = ['created_at'] as const;

export interface FindCondition {
    /** Slug del campo en la lista donde se busca. */
    field: string;
    op: FindOperator;
    /** Acepta variables (`{{correo}}`); se resuelven al correr. */
    value: unknown;
}

export interface FindRecordsConfig {
    /** La lista donde se busca; `null` = la de la automatización. */
    listId: number | null;
    conditions: FindCondition[];
    logic: 'and' | 'or';
    /** Slug, `created_at` o `null` (por fecha de alta; con `desc`, los más nuevos primero). */
    sortField: string | null;
    sortDir: 'asc' | 'desc';
    limit: number;
    /** En la misma lista, no contar al registro que disparó la automatización. */
    excludeSelf: boolean;
    /** Si no encuentra nada: seguir o detener la automatización. */
    ifNone: 'continue' | 'stop';
    /** Con qué nombre quedan los resultados (`{{respuestas.<nombre>…}}`). */
    responseName: string;
}

export const FIND_RECORDS_DEFAULT_NAME = 'busqueda';
export const UPSERT_RECORD_DEFAULT_NAME = 'registro';

function positiveInt(v: unknown): number | null {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function responseNameOf(v: unknown, fallback: string): string {
    const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
    return s === '' ? fallback : s;
}

/** Lectura tolerante de la config de «Buscar registros». */
export function readFindRecordsConfig(cfg: Record<string, unknown> | null | undefined): FindRecordsConfig {
    const c = cfg ?? {};
    const conditions: FindCondition[] = [];
    if (Array.isArray(c.conditions)) {
        for (const raw of c.conditions.slice(0, 20)) {
            if (!raw || typeof raw !== 'object') continue;
            const r = raw as Record<string, unknown>;
            const field = typeof r.field === 'string' ? r.field.trim() : typeof r.slug === 'string' ? r.slug.trim() : '';
            const op = (FIND_OPERATORS as readonly string[]).includes(String(r.op)) ? (r.op as FindOperator) : 'eq';
            if (field === '') continue;
            conditions.push({ field, op, value: r.value ?? '' });
        }
    }
    const limitRaw = Number(c.limit);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, FIND_RECORDS_MAX) : FIND_RECORDS_DEFAULT_LIMIT;
    const sortField = typeof c.sort_field === 'string' && c.sort_field.trim() !== '' ? c.sort_field.trim() : null;
    return {
        listId: positiveInt(c.list_id ?? c.target_list),
        conditions,
        logic: c.logic === 'or' ? 'or' : 'and',
        sortField,
        sortDir: c.sort_dir === 'asc' ? 'asc' : 'desc',
        limit,
        excludeSelf: c.exclude_self !== false,
        ifNone: c.if_none === 'stop' ? 'stop' : 'continue',
        responseName: responseNameOf(c.response_name, FIND_RECORDS_DEFAULT_NAME),
    };
}

export const UPSERT_MODES = ['upsert', 'update_only', 'create_only'] as const;
export type UpsertMode = (typeof UPSERT_MODES)[number];

export const UPSERT_MODE_LABELS: Record<UpsertMode, string> = {
    upsert: 'Actualizarlo si existe y crearlo si no',
    update_only: 'Sólo actualizarlo si existe',
    create_only: 'Sólo crearlo si no existe',
};

export type UpsertMatch = { by: 'record_id' } | { by: 'field'; field: string };

export interface UpsertRecordConfig {
    listId: number | null;
    mode: UpsertMode;
    match: UpsertMatch;
    /** El dato con el que se busca (acepta variables: `{{correo}}`, `{{payload.nit}}`). */
    matchValue: string;
    /** Valores por slug (aceptan variables), como «Crear un registro». */
    values: Record<string, unknown>;
    responseName: string;
}

export function readUpsertRecordConfig(cfg: Record<string, unknown> | null | undefined): UpsertRecordConfig {
    const c = cfg ?? {};
    const mode = (UPSERT_MODES as readonly string[]).includes(String(c.mode)) ? (c.mode as UpsertMode) : 'upsert';
    const field = typeof c.match_field === 'string' ? c.match_field.trim() : '';
    // Por un campo sólo si se eligió uno; si no, por el id del registro.
    const match: UpsertMatch = c.match_by !== 'record_id' && field !== '' ? { by: 'field', field } : { by: 'record_id' };
    const values: Record<string, unknown> = {};
    if (c.values && typeof c.values === 'object' && !Array.isArray(c.values)) {
        for (const [k, v] of Object.entries(c.values as Record<string, unknown>)) if (k.trim() !== '') values[k.trim()] = v;
    }
    return {
        listId: positiveInt(c.list_id ?? c.target_list),
        mode,
        match,
        matchValue: typeof c.match_value === 'string' ? c.match_value : c.match_value === undefined || c.match_value === null ? '' : String(c.match_value),
        values,
        responseName: responseNameOf(c.response_name, UPSERT_RECORD_DEFAULT_NAME),
    };
}

/** Problemas de la config (al guardar y en el editor). `at` = ruta de la acción. */
export function automationRecordActionIssues(type: string, cfg: Record<string, unknown>, at: string): Array<{ path: string; message: string }> {
    const out: Array<{ path: string; message: string }> = [];
    if (type === FIND_RECORDS_ACTION) {
        const f = readFindRecordsConfig(cfg);
        if (!RESPONSE_NAME_RE.test(f.responseName)) {
            out.push({ path: `${at}.config.response_name`, message: 'El nombre de los resultados usa sólo minúsculas, números y guion bajo, y empieza con una letra (por ejemplo «cliente»).' });
        }
        if (Array.isArray(cfg.conditions) && cfg.conditions.length > 20) {
            out.push({ path: `${at}.config.conditions`, message: 'Una búsqueda admite hasta 20 condiciones.' });
        }
        const raw = Number(cfg.limit);
        if (cfg.limit !== undefined && cfg.limit !== null && cfg.limit !== '' && (!Number.isInteger(raw) || raw < 1 || raw > FIND_RECORDS_MAX)) {
            out.push({ path: `${at}.config.limit`, message: `Elige cuántos registros traer: de 1 a ${FIND_RECORDS_MAX}.` });
        }
    }
    if (type === UPSERT_RECORD_ACTION) {
        const u = readUpsertRecordConfig(cfg);
        if (!RESPONSE_NAME_RE.test(u.responseName)) {
            out.push({ path: `${at}.config.response_name`, message: 'El nombre del resultado usa sólo minúsculas, números y guion bajo, y empieza con una letra (por ejemplo «cliente»).' });
        }
        if (cfg.match_by === 'field' && (typeof cfg.match_field !== 'string' || cfg.match_field.trim() === '')) {
            out.push({ path: `${at}.config.match_field`, message: 'Elige el campo «Sin repetidos» con el que se busca el registro.' });
        }
        if (u.matchValue.trim() === '') {
            out.push({ path: `${at}.config.match_value`, message: 'Escribe con qué dato se busca el registro (por ejemplo {{correo}}).' });
        }
        if (u.mode !== 'create_only' && Object.keys(u.values).length === 0) {
            out.push({ path: `${at}.config.values`, message: 'Elige al menos un campo para escribir en el registro.' });
        }
    }
    return out;
}

/** Nombre del resultado que deja la acción (para que dos pasos no se pisen). */
export function recordActionResponseName(type: string, cfg: Record<string, unknown>): string | null {
    if (type === FIND_RECORDS_ACTION) return readFindRecordsConfig(cfg).responseName;
    if (type === UPSERT_RECORD_ACTION) return readUpsertRecordConfig(cfg).responseName;
    return null;
}

/** Lo que deja cada acción, para el selector de variables y el asistente. */
export const FIND_RECORDS_OUTPUTS: ReadonlyArray<{ key: string; label: string }> = [
    { key: 'cantidad', label: 'Cuántos encontró' },
    { key: 'ids', label: 'Los ids encontrados (separados por coma)' },
    { key: 'primero.id', label: 'Id del primero' },
    { key: 'primero.titulo', label: 'Título del primero' },
];

export const UPSERT_RECORD_OUTPUTS: ReadonlyArray<{ key: string; label: string }> = [
    { key: 'id', label: 'Id del registro' },
    { key: 'titulo', label: 'Título del registro' },
    { key: 'accion', label: 'Qué hizo (creado, actualizado, sin_cambios, ya_existia, no_encontrado)' },
];

// --- «Cuando se agrega un comentario» ---

export const COMMENT_TRIGGER_AUTHORS = ['any', 'team', 'client'] as const;
export type CommentAuthorFilter = (typeof COMMENT_TRIGGER_AUTHORS)[number];
export const COMMENT_TRIGGER_AUTHOR_LABELS: Record<CommentAuthorFilter, string> = {
    any: 'Cualquiera',
    team: 'Alguien del equipo',
    client: 'El cliente (portal o correo)',
};

export const COMMENT_TRIGGER_VISIBILITIES = ['any', 'internal', 'client'] as const;
export type CommentVisibilityFilter = (typeof COMMENT_TRIGGER_VISIBILITIES)[number];
export const COMMENT_TRIGGER_VISIBILITY_LABELS: Record<CommentVisibilityFilter, string> = {
    any: 'Interna o visible para el cliente',
    internal: 'Sólo notas internas',
    client: 'Sólo visibles para el cliente',
};

export const COMMENT_TRIGGER_REPLY_FILTERS = ['any', 'top', 'replies'] as const;
export type CommentReplyFilter = (typeof COMMENT_TRIGGER_REPLY_FILTERS)[number];
export const COMMENT_TRIGGER_REPLY_LABELS: Record<CommentReplyFilter, string> = {
    any: 'Comentarios y respuestas',
    top: 'Sólo comentarios nuevos (no respuestas)',
    replies: 'Sólo respuestas en un hilo',
};

export interface CommentTriggerConfig {
    from: CommentAuthorFilter;
    visibility: CommentVisibilityFilter;
    replies: CommentReplyFilter;
    /** Palabras (separadas por coma): basta con que aparezca una. Vacío = cualquiera. */
    contains: string;
}

export function readCommentTriggerConfig(cfg: Record<string, unknown> | null | undefined): CommentTriggerConfig {
    const c = cfg ?? {};
    return {
        from: (COMMENT_TRIGGER_AUTHORS as readonly string[]).includes(String(c.comment_from)) ? (c.comment_from as CommentAuthorFilter) : 'any',
        visibility: (COMMENT_TRIGGER_VISIBILITIES as readonly string[]).includes(String(c.comment_visibility))
            ? (c.comment_visibility as CommentVisibilityFilter)
            : 'any',
        replies: (COMMENT_TRIGGER_REPLY_FILTERS as readonly string[]).includes(String(c.comment_replies)) ? (c.comment_replies as CommentReplyFilter) : 'any',
        contains: typeof c.comment_contains === 'string' ? c.comment_contains.slice(0, 300) : '',
    };
}

/** El comentario que disparó la automatización (viaja en el evento y en una espera). */
export interface CommentEventInfo {
    id: number;
    text: string;
    author_id: number;
    author_name: string;
    /** Quién lo escribió: alguien del equipo o el cliente. */
    from: 'team' | 'client';
    /** Por dónde llegó: la app, el portal del cliente o un correo a la mesa de ayuda. */
    source: 'app' | 'portal' | 'email';
    visibility: 'internal' | 'client';
    parent_id: number | null;
}

function foldText(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/** Si el comentario coincide con lo elegido en el disparador, y por qué no si no. */
export function commentTriggerMatches(cfg: CommentTriggerConfig, ev: CommentEventInfo): { ok: true } | { ok: false; reason: string } {
    if (cfg.from !== 'any' && ev.from !== cfg.from) {
        return { ok: false, reason: cfg.from === 'team' ? 'Lo escribió el cliente y el disparador espera a alguien del equipo.' : 'Lo escribió alguien del equipo y el disparador espera al cliente.' };
    }
    if (cfg.visibility !== 'any' && ev.visibility !== cfg.visibility) {
        return { ok: false, reason: cfg.visibility === 'internal' ? 'Es visible para el cliente y el disparador espera una nota interna.' : 'Es una nota interna y el disparador espera un comentario visible para el cliente.' };
    }
    if (cfg.replies === 'top' && ev.parent_id !== null) return { ok: false, reason: 'Es una respuesta en un hilo y el disparador espera un comentario nuevo.' };
    if (cfg.replies === 'replies' && ev.parent_id === null) return { ok: false, reason: 'Es un comentario nuevo y el disparador espera una respuesta en un hilo.' };
    const terms = cfg.contains
        .split(',')
        .map((t) => foldText(t))
        .filter((t) => t !== '');
    if (terms.length > 0) {
        const text = foldText(ev.text);
        if (!terms.some((t) => text.includes(t))) return { ok: false, reason: `El comentario no contiene ${terms.map((t) => `«${t}»`).join(' ni ')}.` };
    }
    return { ok: true };
}

/** Variables `{{comentario.x}}` del disparador. */
export const COMMENT_VARIABLES: ReadonlyArray<{ key: string; label: string }> = [
    { key: 'texto', label: 'Texto del comentario' },
    { key: 'autor', label: 'Quién lo escribió' },
    { key: 'de', label: 'De quién (equipo o cliente)' },
    { key: 'origen', label: 'Por dónde llegó (app, portal o correo)' },
    { key: 'visibilidad', label: 'Interna o visible para el cliente' },
    { key: 'es_respuesta', label: '¿Es una respuesta? (Sí o No)' },
    { key: 'id', label: 'Id del comentario' },
];

export function commentEventValue(ev: CommentEventInfo, key: string): string | undefined {
    switch (key) {
        case 'texto':
            return ev.text;
        case 'autor':
            return ev.author_name;
        case 'de':
            return ev.from === 'client' ? 'cliente' : 'equipo';
        case 'origen':
            return ev.source === 'portal' ? 'portal' : ev.source === 'email' ? 'correo' : 'app';
        case 'visibilidad':
            return ev.visibility === 'client' ? 'visible para el cliente' : 'interna';
        case 'es_respuesta':
            return ev.parent_id !== null ? 'Sí' : 'No';
        case 'id':
            return String(ev.id);
        default:
            return undefined;
    }
}

/** Resumen en palabras del disparador («Cuando el cliente agrega un comentario visible…»). */
export function describeCommentTrigger(cfg: CommentTriggerConfig): string {
    const who = cfg.from === 'team' ? 'alguien del equipo' : cfg.from === 'client' ? 'el cliente' : 'alguien';
    const what = cfg.replies === 'replies' ? 'responde en un hilo' : 'agrega un comentario';
    const vis = cfg.visibility === 'internal' ? ' (nota interna)' : cfg.visibility === 'client' ? ' visible para el cliente' : '';
    const words = cfg.contains.trim() !== '' ? ` con «${cfg.contains.trim().slice(0, 60)}»` : '';
    return `Cuando ${who} ${what}${vis}${words}`;
}
