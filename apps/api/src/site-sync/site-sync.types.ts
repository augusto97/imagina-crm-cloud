import {
    SITE_COLUMN_SOURCES,
    SITE_COLUMN_TYPES,
    SITE_OBJECT_KINDS,
    type SiteColumnSource,
    type SiteColumnType,
    type SiteObjectKind,
} from '@imagina-base/shared';

/**
 * Lo que guarda la sincronización de un sitio (v0.1.333, ADR-S83). `settings`
 * lo escribe la persona (vía el service) y `state` el motor; los lectores son
 * TOLERANTES —un jsonb viejo o a medio escribir nunca tira el motor—.
 *
 * `lists` y `fields` tienen la MISMA forma que en la tienda (recurso → lista,
 * recurso → (columna → campo)): así migrar una empresa (ADR-S23) los traduce
 * con el mismo `remapSyncSettings`.
 */

/** Una columna elegida, con lo que hay que saber para leerla y escribirla. */
export interface SiteColumnSettings {
    key: string;
    label: string;
    source: SiteColumnSource;
    type: SiteColumnType;
    can_edit: boolean;
    /** La ayuda que dio el sitio (las del complemento: «lo calcula tu plugin de SEO»…). */
    hint?: string | null;
}

/** Una taxonomía de un tipo de contenido: la clave del post y el nombre del término. */
export interface SiteTaxonomyRef {
    taxonomy: string;
    label: string;
    rest_base: string;
    rest_namespace: string;
}

export interface SiteObjectSettings {
    kind: SiteObjectKind;
    object: string;
    label: string;
    rest_base: string;
    rest_namespace: string;
    hierarchical: boolean;
    columns: SiteColumnSettings[];
    /** Claves de columna habilitadas para editar. */
    editable: string[];
    /** Taxonomías del tipo (para leer y escribir sus términos). */
    taxonomies: SiteTaxonomyRef[];
}

export interface SiteSyncSettings {
    site_url: string;
    site_name: string;
    interval_minutes: number;
    /**
     * `realtime` (v0.1.334, ADR-S84): el complemento avisa cada cambio y se
     * revisa todo cada hora. Sin el complemento corre como `interval` (con el
     * intervalo elegido) y vuelve solo cuando el complemento aparece.
     */
    mode: 'interval' | 'realtime';
    write_back: boolean;
    folder_id: number | null;
    /** Recurso (`post:propiedad`) → lo elegido. */
    objects: Record<string, SiteObjectSettings>;
    /** Recurso → lista. */
    lists: Record<string, number>;
    /** Recurso → (columna → campo). Por ID: renombrar un campo no rompe nada. */
    fields: Record<string, Record<string, number>>;
}

export interface SiteKeysetCursor {
    /** `modified` (hora del sitio, sin zona) más alto ya procesado. */
    at: string;
    /** Ids con exactamente ese `at` (la API compara por segundo). */
    ids: string[];
}

export interface SiteSyncState {
    running: boolean;
    current: string | null;
    progress: Record<string, { done: number; total: number | null }>;
    /** Recurso (y `recurso|trash` para la papelera) → cursor. */
    cursors: Record<string, SiteKeysetCursor | null>;
    /** Último barrido completo por recurso (lo borrado se detecta ahí). */
    full_at: Record<string, string | null>;
    initial_done: boolean;
    last_run_at: string | null;
    last_success_at: string | null;
    last_error: string | null;
    warnings: string[];
    write_back: { pushed: number; failed: number; last_at: string | null; last_error: string | null };
    /** Lo último que se supo del complemento (se revisa al empezar cada vuelta). */
    plugin: SitePluginState | null;
    realtime: { registered: boolean; received: number; last_at: string | null; error: string | null };
}

export interface SitePluginState {
    installed: boolean;
    version: string | null;
    seo_name: string | null;
    checked_at: string | null;
    /** Estuvo y ya no está: desde cuándo. */
    missing_since: string | null;
}

function obj(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function strOrNull(v: unknown): string | null {
    return typeof v === 'string' && v !== '' ? v : null;
}

function idMap(v: unknown): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, raw] of Object.entries(obj(v))) {
        const n = Number(raw);
        if (Number.isInteger(n) && n > 0) out[k] = n;
    }
    return out;
}

function readColumn(v: unknown): SiteColumnSettings | null {
    const c = obj(v);
    if (typeof c.key !== 'string' || c.key === '') return null;
    return {
        key: c.key,
        label: typeof c.label === 'string' ? c.label : c.key,
        source: (SITE_COLUMN_SOURCES as readonly string[]).includes(String(c.source)) ? (c.source as SiteColumnSource) : 'core',
        type: (SITE_COLUMN_TYPES as readonly string[]).includes(String(c.type)) ? (c.type as SiteColumnType) : 'text',
        can_edit: c.can_edit === true,
        hint: typeof c.hint === 'string' && c.hint !== '' ? c.hint : null,
    };
}

function readObject(v: unknown): SiteObjectSettings | null {
    const o = obj(v);
    if (typeof o.object !== 'string' || o.object === '') return null;
    return {
        kind: (SITE_OBJECT_KINDS as readonly string[]).includes(String(o.kind)) ? (o.kind as SiteObjectKind) : 'post_type',
        object: o.object,
        label: typeof o.label === 'string' ? o.label : o.object,
        rest_base: typeof o.rest_base === 'string' && o.rest_base !== '' ? o.rest_base : o.object,
        rest_namespace: typeof o.rest_namespace === 'string' && o.rest_namespace !== '' ? o.rest_namespace : 'wp/v2',
        hierarchical: o.hierarchical === true,
        columns: (Array.isArray(o.columns) ? o.columns : []).map(readColumn).filter((c): c is SiteColumnSettings => c !== null),
        editable: Array.isArray(o.editable) ? o.editable.filter((x): x is string => typeof x === 'string') : [],
        taxonomies: (Array.isArray(o.taxonomies) ? o.taxonomies : [])
            .map((t) => {
                const r = obj(t);
                return typeof r.taxonomy === 'string' && typeof r.rest_base === 'string'
                    ? {
                          taxonomy: r.taxonomy,
                          label: typeof r.label === 'string' ? r.label : r.taxonomy,
                          rest_base: r.rest_base,
                          rest_namespace: typeof r.rest_namespace === 'string' && r.rest_namespace !== '' ? r.rest_namespace : 'wp/v2',
                      }
                    : null;
            })
            .filter((t): t is SiteTaxonomyRef => t !== null),
    };
}

export function readSiteSettings(raw: unknown): SiteSyncSettings {
    const s = obj(raw);
    const objects: Record<string, SiteObjectSettings> = {};
    for (const [k, v] of Object.entries(obj(s.objects))) {
        const o = readObject(v);
        if (o) objects[k] = o;
    }
    const fields: Record<string, Record<string, number>> = {};
    for (const [k, v] of Object.entries(obj(s.fields))) fields[k] = idMap(v);
    const interval = Number(s.interval_minutes);
    return {
        site_url: typeof s.site_url === 'string' ? s.site_url : '',
        site_name: typeof s.site_name === 'string' ? s.site_name : '',
        interval_minutes: Number.isInteger(interval) && interval > 0 ? interval : 60,
        mode: s.mode === 'realtime' ? 'realtime' : 'interval',
        write_back: s.write_back === true,
        folder_id: Number(s.folder_id) > 0 ? Number(s.folder_id) : null,
        objects,
        lists: idMap(s.lists),
        fields,
    };
}

function readCursor(v: unknown): SiteKeysetCursor | null {
    const c = obj(v);
    if (typeof c.at !== 'string' || c.at === '') return null;
    return { at: c.at, ids: Array.isArray(c.ids) ? c.ids.map(String).slice(0, 500) : [] };
}

export function readSiteState(raw: unknown): SiteSyncState {
    const s = obj(raw);
    const progress: SiteSyncState['progress'] = {};
    for (const [k, v] of Object.entries(obj(s.progress))) {
        const p = obj(v);
        progress[k] = {
            done: Number(p.done) || 0,
            total: Number.isFinite(Number(p.total)) && p.total !== null ? Number(p.total) : null,
        };
    }
    const cursors: SiteSyncState['cursors'] = {};
    for (const [k, v] of Object.entries(obj(s.cursors))) cursors[k] = readCursor(v);
    const fullAt: SiteSyncState['full_at'] = {};
    for (const [k, v] of Object.entries(obj(s.full_at))) fullAt[k] = strOrNull(v);
    const wb = obj(s.write_back);
    const pl = obj(s.plugin);
    const rt = obj(s.realtime);
    return {
        running: s.running === true,
        current: strOrNull(s.current),
        progress,
        cursors,
        full_at: fullAt,
        initial_done: s.initial_done === true,
        last_run_at: strOrNull(s.last_run_at),
        last_success_at: strOrNull(s.last_success_at),
        last_error: strOrNull(s.last_error),
        warnings: Array.isArray(s.warnings) ? s.warnings.map(String).slice(0, 20) : [],
        write_back: {
            pushed: Number(wb.pushed) || 0,
            failed: Number(wb.failed) || 0,
            last_at: strOrNull(wb.last_at),
            last_error: strOrNull(wb.last_error),
        },
        plugin:
            typeof pl.installed === 'boolean'
                ? {
                      installed: pl.installed,
                      version: strOrNull(pl.version),
                      seo_name: strOrNull(pl.seo_name),
                      checked_at: strOrNull(pl.checked_at),
                      missing_since: strOrNull(pl.missing_since),
                  }
                : null,
        realtime: {
            registered: rt.registered === true,
            received: Number(rt.received) || 0,
            last_at: strOrNull(rt.last_at),
            error: strOrNull(rt.error),
        },
    };
}
