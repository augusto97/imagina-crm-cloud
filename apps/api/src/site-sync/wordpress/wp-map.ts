import {
    humanizeSiteKey,
    isScalarSiteValue,
    isSitePluginColumn,
    suggestSiteValueType,
    WP_MEDIA_STATUS_OPTIONS,
    WP_POST_STATUS_OPTIONS,
    WP_TERM_STATUS_OPTIONS,
    type SiteColumn,
    type SiteObjectKind,
} from '@imagina-base/shared';
import { decodeEntities, stripTags, wpEditLink } from '../../connectors/wordpress/wp-api';
import type { SiteColumnSettings, SiteObjectSettings } from '../site-sync.types';

/**
 * WordPress → filas de la app (v0.1.333, ADR-S83). PURO: el motor, el envío
 * de lo editado y las pruebas usan estas funciones, así lo que se prueba es lo
 * que corre.
 *
 * Las columnas se identifican por su CLAVE (`title`, `tax:category`,
 * `acf:precio`), nunca por su nombre: la empresa puede renombrar la columna en
 * la app sin romper nada (regla de oro nº 1).
 */

export type WpJson = Record<string, unknown>;

export interface WpTerm {
    slug: string;
    name: string;
}

/** Lo que hace falta para traducir ids de WordPress en algo legible. */
export interface WpLookups {
    /** taxonomía → (id del término → slug y nombre). */
    terms: Map<string, Map<number, WpTerm>>;
    /** id del medio → URL de la miniatura. */
    media: Map<number, string>;
    /** id del autor → nombre. */
    users: Map<number, string>;
    /** id de la entrada o término padre → título o nombre. */
    parents: Map<number, string>;
}

export function emptyLookups(): WpLookups {
    return { terms: new Map(), media: new Map(), users: new Map(), parents: new Map() };
}

export interface MappedSiteItem {
    externalId: string;
    /** clave de columna → valor (ya con la forma del campo de la app). */
    values: Record<string, unknown>;
    /** clave de columna → opciones que tiene que tener el select (estados, términos). */
    options: Record<string, Array<{ value: string; label: string }>>;
}

function obj(v: unknown): WpJson {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as WpJson) : {};
}

function str(v: unknown): string {
    return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}

/** Un texto de WordPress con su versión cruda (`raw`, en contexto de edición) o la renderizada. */
function rawText(v: unknown): string {
    if (typeof v === 'string') return decodeEntities(v);
    const o = obj(v);
    if (typeof o.raw === 'string') return o.raw;
    if (typeof o.rendered === 'string') return stripTags(o.rendered);
    return '';
}

/** `2026-10-29T04:38:34` (GMT de WordPress) → ISO con zona. */
export function wpGmt(v: unknown): string | null {
    const s = str(v);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s) || s.startsWith('0000')) return null;
    return `${s.slice(0, 19)}Z`;
}

/** El slug como lo lee una persona (WordPress guarda `caf%c3%a9`). */
export function wpSlug(v: unknown): string {
    const s = str(v);
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

/**
 * Los valores que trajo el complemento para este objeto (`seo:…`, `cf:…`,
 * `plugin:…`), pegados a la fila por el motor antes de mapearla.
 */
export const IBC_VALUES = '__ibc';

/** Las opciones de estado según el tipo de objeto. */
function statusOptionsOf(kind: SiteObjectKind): Array<{ value: string; label: string }> {
    return kind === 'taxonomy' ? WP_TERM_STATUS_OPTIONS : kind === 'media' ? WP_MEDIA_STATUS_OPTIONS : WP_POST_STATUS_OPTIONS;
}

/** Una clave de ACF o meta, con su fuente. */
export function columnPath(key: string): { source: 'acf' | 'meta'; name: string } | null {
    const m = /^(acf|meta):(.+)$/.exec(key);
    return m ? { source: m[1] as 'acf' | 'meta', name: m[2]! } : null;
}

/**
 * `_fields` de la API: SÓLO lo que se va a mostrar. Nunca `content` — el
 * contenido completo de una entrada no se trae (para eso están el enlace y
 * «Editar en WordPress»).
 */
export function wpFieldsParam(o: SiteObjectSettings): string {
    const out = new Set<string>(['id', 'modified', 'modified_gmt']);
    const keys = new Set(o.columns.map((c) => c.key));
    // El estado siempre: con él se marca lo que está en la papelera.
    if (o.kind === 'post_type' || o.kind === 'media') out.add('status');
    const add = (k: string, ...fields: string[]) => {
        if (keys.has(k)) for (const f of fields) out.add(f);
    };
    if (o.kind === 'media') {
        add('title', 'title');
        add('alt_text', 'alt_text');
        add('caption', 'caption');
        add('description', 'description');
        add('thumbnail', 'media_details', 'source_url');
        add('source_url', 'source_url');
        add('mime_type', 'mime_type');
        add('dimensions', 'media_details');
        add('filesize', 'media_details');
        add('link', 'link');
        add('date', 'date_gmt');
        add('author', 'author');
    } else if (o.kind === 'taxonomy') {
        add('name', 'name');
        add('slug', 'slug');
        add('description', 'description');
        add('parent', 'parent');
        add('count', 'count');
        add('link', 'link');
    } else {
        add('title', 'title');
        add('link', 'link');
        add('slug', 'slug');
        add('date', 'date_gmt');
        add('author', 'author');
        add('excerpt', 'excerpt');
        add('featured_image', 'featured_media');
        add('parent', 'parent');
        add('menu_order', 'menu_order');
        add('template', 'template');
        for (const t of o.taxonomies) add(`tax:${t.taxonomy}`, t.rest_base);
    }
    for (const c of o.columns) {
        const p = columnPath(c.key);
        if (p) out.add(`${p.source}.${p.name}`);
    }
    return [...out].join(',');
}

/** Un valor de ACF o meta llevado al tipo de la columna. `undefined` = no se puede (se deja como está). */
export function coerceSiteValue(v: unknown, type: string): unknown {
    if (v === null || v === undefined || v === '' || (v === false && type !== 'checkbox')) {
        return type === 'checkbox' ? false : null;
    }
    switch (type) {
        case 'number': {
            if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
            const n = Number(str(v).trim().replace(',', '.'));
            return Number.isFinite(n) && str(v).trim() !== '' ? n : undefined;
        }
        case 'checkbox':
            if (typeof v === 'boolean') return v;
            return /^(1|yes|si|sí|true|on)$/i.test(str(v).trim());
        case 'date': {
            const m = /^(\d{4}-\d{2}-\d{2})/.exec(str(v));
            if (m) return m[1];
            const ymd = /^(\d{4})(\d{2})(\d{2})$/.exec(str(v));
            return ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}` : undefined;
        }
        case 'datetime':
            return wpGmt(v) ?? undefined;
        case 'url':
            return /^https?:\/\//i.test(str(v)) ? str(v) : undefined;
        case 'multi_select': {
            const list = Array.isArray(v) ? v : str(v).split(',');
            return list.map((x) => str(x).trim()).filter((x) => x !== '').slice(0, 200);
        }
        case 'select':
            return Array.isArray(v) ? (v.length ? str(v[0]) : null) : str(v) || null;
        default: {
            const text = typeof v === 'object' ? JSON.stringify(v) : str(v);
            return text.slice(0, 8000);
        }
    }
}

/** Ids que hay que traducir en una tanda (medios, autores, padres). */
export function wpLookupIds(o: SiteObjectSettings, rows: WpJson[]): { media: number[]; users: number[]; parents: number[] } {
    const keys = new Set(o.columns.map((c) => c.key));
    const ids = (field: string) =>
        [...new Set(rows.map((r) => Number(r[field])).filter((n) => Number.isInteger(n) && n > 0))];
    return {
        media: keys.has('featured_image') ? ids('featured_media') : [],
        users: keys.has('author') ? ids('author') : [],
        parents: keys.has('parent') ? ids('parent') : [],
    };
}

/** La URL de la miniatura de un medio (`media_details.sizes`), o la original. */
export function wpMediaThumb(m: WpJson): string | null {
    const sizes = obj(obj(m.media_details).sizes);
    for (const size of ['medium', 'thumbnail', 'medium_large', 'large']) {
        const url = obj(sizes[size]).source_url;
        if (typeof url === 'string' && url !== '') return url;
    }
    return typeof m.source_url === 'string' && m.source_url !== '' ? m.source_url : null;
}

/** Una entrada o un término de WordPress → la fila de la app. */
export function mapWpItem(o: SiteObjectSettings, json: WpJson, siteUrl: string, lookups: WpLookups): MappedSiteItem {
    const id = Number(json.id);
    const values: Record<string, unknown> = {};
    const options: MappedSiteItem['options'] = {};
    // Un medio no tiene estado propio (`inherit`): está en la biblioteca o en la papelera.
    const rawStatus = str(json.status);
    const status = o.kind === 'taxonomy' ? 'publish' : o.kind === 'media' ? (rawStatus === 'trash' ? 'trash' : 'publish') : rawStatus || 'publish';
    const plugin = obj(json[IBC_VALUES]);
    const details = obj(json.media_details);
    for (const c of o.columns) {
        switch (c.key) {
            case 'wp_id':
                values.wp_id = id;
                break;
            case 'edit_link':
                values.edit_link = wpEditLink(siteUrl, o.kind, o.object, id);
                break;
            case 'status': {
                values.status = status;
                const known = statusOptionsOf(o.kind).find((s) => s.value === status);
                // Un estado que agrega un plugin («pedido-en-revisión») se suma como opción.
                if (!known) options.status = [{ value: status, label: humanizeSiteKey(status) }];
                break;
            }
            case 'title':
                values.title = rawText(json.title);
                break;
            case 'name':
                values.name = decodeEntities(str(json.name));
                break;
            case 'description':
                values.description = o.kind === 'media' ? rawText(json.description) || null : str(json.description);
                break;
            case 'alt_text':
                values.alt_text = str(json.alt_text).trim() || null;
                break;
            case 'caption':
                values.caption = rawText(json.caption).trim() || null;
                break;
            case 'thumbnail':
                values.thumbnail = wpMediaThumb(json);
                break;
            case 'source_url':
                values.source_url = str(json.source_url) || null;
                break;
            case 'mime_type':
                values.mime_type = str(json.mime_type) || null;
                break;
            case 'dimensions': {
                const w = Number(details.width);
                const h = Number(details.height);
                values.dimensions = w > 0 && h > 0 ? `${w} × ${h}` : null;
                break;
            }
            case 'filesize': {
                const bytes = Number(details.filesize);
                values.filesize = bytes > 0 ? Math.max(1, Math.round(bytes / 1024)) : null;
                break;
            }
            case 'excerpt':
                values.excerpt = rawText(json.excerpt);
                break;
            case 'slug':
                values.slug = wpSlug(json.slug);
                break;
            case 'link':
                values.link = str(json.link) || null;
                break;
            case 'date':
                values.date = wpGmt(json.date_gmt);
                break;
            case 'modified':
                values.modified = wpGmt(json.modified_gmt);
                break;
            case 'author': {
                const a = Number(json.author);
                values.author = a > 0 ? (lookups.users.get(a) ?? `#${a}`) : null;
                break;
            }
            case 'featured_image': {
                const m = Number(json.featured_media);
                values.featured_image = m > 0 ? (lookups.media.get(m) ?? null) : null;
                break;
            }
            case 'parent': {
                const p = Number(json.parent);
                values.parent = p > 0 ? (lookups.parents.get(p) ?? `#${p}`) : null;
                break;
            }
            case 'menu_order':
                values.menu_order = Number.isFinite(Number(json.menu_order)) ? Number(json.menu_order) : null;
                break;
            case 'template':
                values.template = str(json.template) || null;
                break;
            case 'count':
                values.count = Number.isFinite(Number(json.count)) ? Number(json.count) : null;
                break;
            default: {
                if (c.key.startsWith('tax:')) {
                    const tax = o.taxonomies.find((t) => `tax:${t.taxonomy}` === c.key);
                    if (!tax) break;
                    const map = lookups.terms.get(tax.taxonomy) ?? new Map<number, WpTerm>();
                    const ids = Array.isArray(json[tax.rest_base]) ? (json[tax.rest_base] as unknown[]).map(Number) : [];
                    const terms = ids.map((tid) => map.get(tid)).filter((t): t is WpTerm => t !== undefined);
                    values[c.key] = terms.map((t) => t.slug);
                    options[c.key] = terms.map((t) => ({ value: t.slug, label: t.name }));
                    break;
                }
                if (isSitePluginColumn(c.key)) {
                    // Sin el valor (el complemento no está o no lo mandó) queda lo que había.
                    if (!(c.key in plugin)) break;
                    const v = coerceSiteValue(plugin[c.key], c.type);
                    if (v === undefined) break;
                    values[c.key] = v;
                    if (c.type === 'select' && typeof v === 'string' && v !== '') options[c.key] = [{ value: v, label: v }];
                    if (c.type === 'multi_select' && Array.isArray(v)) options[c.key] = (v as string[]).map((x) => ({ value: x, label: x }));
                    break;
                }
                const p = columnPath(c.key);
                if (!p) break;
                const bag = obj(json[p.source]);
                if (!(p.name in bag)) break;
                const v = coerceSiteValue(bag[p.name], c.type);
                if (v !== undefined) values[c.key] = v;
            }
        }
    }
    return { externalId: String(id), values, options };
}

// --- Descubrimiento: campos de ACF y personalizados -----------------------

export function siteSample(v: unknown): string | null {
    if (v === null || v === undefined || v === '' || v === false) return null;
    const text = typeof v === 'string' ? v : JSON.stringify(v);
    return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/**
 * Las columnas de ACF (`acf`) y de campos personalizados registrados en la API
 * (`meta`) que aparecen en una muestra de entradas o términos. Lo estructurado
 * (un repetidor, una galería) se trae como texto y NO se edita: no hay forma
 * segura de escribirlo desde una celda.
 */
/** Campos registrados en la API que son del propio WordPress o de ACF, no del sitio. */
const INTERNAL_META = new Set(['_acf_changed', 'footnotes']);

export function discoverExtraColumns(rows: WpJson[]): SiteColumn[] {
    const seen = new Map<string, { value: unknown; scalar: boolean }>();
    for (const r of rows) {
        for (const source of ['acf', 'meta'] as const) {
            const bag = r[source];
            if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
            for (const [name, value] of Object.entries(bag as WpJson)) {
                // `_acf_changed`: bandera interna de ACF; `footnotes`: las notas al
                // pie del editor de bloques (un JSON del propio editor). No son datos.
                if (source === 'meta' && INTERNAL_META.has(name)) continue;
                const key = `${source}:${name}`;
                const prev = seen.get(key);
                const scalar = isScalarSiteValue(value);
                // Se queda con un ejemplo con contenido (el primero vacío no dice nada).
                if (!prev || (siteSample(prev.value) === null && siteSample(value) !== null)) {
                    seen.set(key, { value, scalar: (prev?.scalar ?? true) && scalar });
                } else if (!scalar) {
                    prev.scalar = false;
                }
            }
        }
    }
    const out: SiteColumn[] = [];
    for (const [key, { value, scalar }] of seen) {
        if (seen.size > 200 && out.length >= 200) break;
        const name = key.slice(key.indexOf(':') + 1);
        const type = scalar ? suggestSiteValueType(value) : 'long_text';
        out.push({
            key,
            label: humanizeSiteKey(name),
            source: key.startsWith('acf:') ? 'acf' : 'meta',
            type,
            can_edit: scalar,
            default_on: false,
            default_edit: false,
            always: false,
            hint: scalar ? null : 'Tiene varias partes (una lista o un grupo): se trae como texto y se edita en WordPress.',
            sample: siteSample(value),
            private: name.startsWith('_'),
            options: null,
            image: false,
            provider: key.startsWith('acf:') ? 'acf' : 'meta',
        });
    }
    return out.sort((a, b) => Number(a.private) - Number(b.private) || a.key.localeCompare(b.key));
}

// --- Edición: de la app al sitio -----------------------------------------

export interface WpWriteBack {
    route: string;
    body: Record<string, unknown>;
    /** Las claves que viajaron (para la bitácora del estado). */
    keys: string[];
}

/**
 * El cuerpo del POST con SÓLO lo que cambió y está habilitado. `termIds` trae
 * los ids de WordPress de los términos (`tax:x` → ids), ya buscados o creados.
 * `null` = no hay nada que mandar.
 */
export function buildWpWriteBack(
    o: SiteObjectSettings,
    externalId: string,
    changed: Record<string, unknown>,
    termIds: Record<string, number[]>,
): WpWriteBack | null {
    const body: Record<string, unknown> = {};
    const keys: string[] = [];
    const editable = new Set(o.editable);
    const col = new Map<string, SiteColumnSettings>(o.columns.map((c) => [c.key, c]));
    for (const [key, value] of Object.entries(changed)) {
        const c = col.get(key);
        // Lo del complemento viaja por SU ruta (`ibcWrite`), no por la de WordPress.
        if (!c || !c.can_edit || !editable.has(key) || isSitePluginColumn(key)) continue;
        const text = value === null || value === undefined ? '' : String(value);
        switch (key) {
            case 'title':
            case 'excerpt':
            case 'name':
            case 'description':
            case 'alt_text':
            case 'caption':
                body[key] = text;
                break;
            case 'slug':
                body.slug = text.trim();
                break;
            case 'status':
                if (o.kind === 'taxonomy') continue;
                body.status = text;
                break;
            case 'date':
                if (text === '') continue;
                body.date_gmt = text.replace(/\.\d+Z?$|Z$/, '').slice(0, 19);
                break;
            case 'menu_order':
                body.menu_order = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0;
                break;
            default: {
                if (key.startsWith('tax:')) {
                    const tax = o.taxonomies.find((t) => `tax:${t.taxonomy}` === key);
                    if (!tax || !termIds[key]) continue;
                    body[tax.rest_base] = termIds[key];
                    break;
                }
                const p = columnPath(key);
                if (!p) continue;
                const bag = (body[p.source] as Record<string, unknown> | undefined) ?? {};
                bag[p.name] = siteWriteValue(value, c.type);
                body[p.source] = bag;
            }
        }
        keys.push(key);
    }
    if (keys.length === 0) return null;
    return { route: `/${o.rest_namespace}/${o.rest_base}/${externalId}`, body, keys };
}

/** Un valor de la app como lo espera ACF / un campo personalizado. */
export function siteWriteValue(value: unknown, type: string): unknown {
    if (value === undefined) return null;
    if (type === 'checkbox') return value === true;
    if (type === 'number') return value === null || value === '' ? null : Number(value);
    return value === null ? '' : value;
}

/** Recurso (`post:propiedad`) → la ruta de la colección. */
export function wpCollectionRoute(o: Pick<SiteObjectSettings, 'rest_namespace' | 'rest_base'>): string {
    return `/${o.rest_namespace}/${o.rest_base}`;
}

/** Tipo de objeto → si usa `title` o `name` como título. */
export function titleColumnOf(kind: SiteObjectKind): 'title' | 'name' {
    return kind === 'taxonomy' ? 'name' : 'title';
}
