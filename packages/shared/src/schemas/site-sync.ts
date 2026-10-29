import { z } from 'zod';
import { idSchema } from './common';
import { STORE_SYNC_INTERVALS, sourceDeleteModeSchema, sourceGoneCountSchema, storeSyncIntervalSchema } from './store-sync';

/**
 * Sincronizar un sitio WordPress (v0.1.333, ADR-S83).
 *
 * El sitio es la FUENTE y la app un espejo, igual que la tienda (ADR-S24):
 * cada tipo de contenido elegido (páginas, entradas, un tipo propio como
 * «Propiedades», o una taxonomía como «Categorías») llega a una lista, con
 * SÓLO las columnas que la empresa eligió. Nunca se trae el contenido completo
 * de una entrada: para eso están el enlace y «Editar en WordPress».
 *
 * Lo nuevo se crea en WordPress (la app no crea ni borra entradas); desde la
 * app se editan las columnas que la empresa habilitó y el cambio viaja al
 * sitio. Las piezas están pensadas para que el complemento propio (v0.1.334)
 * sume FUENTES de columnas (SEO, campos de otros plugins, medios) y un modo en
 * tiempo real, sin rehacer el motor: una columna es `fuente:clave` y viaja con
 * su tipo.
 */

export const SITE_SYNC_PROVIDER = 'wordpress';

/**
 * Un tipo de contenido (`post_type`), una taxonomía (categorías, etiquetas…) o
 * la biblioteca de medios (`media`, v0.1.334: las imágenes con su texto
 * alternativo, título y leyenda).
 */
export const SITE_OBJECT_KINDS = ['post_type', 'taxonomy', 'media'] as const;
export type SiteObjectKind = (typeof SITE_OBJECT_KINDS)[number];

/**
 * De dónde sale una columna. `core` = lo de WordPress (título, estado…),
 * `acf` = un campo de Advanced Custom Fields con «Mostrar en la API REST»,
 * `meta` = un campo personalizado registrado en la API. Con el complemento
 * «Imagina Base Connector» (v0.1.334, ADR-S84) se suman `seo` (el SEO del
 * plugin que use el sitio) y `plugin` (los campos de ACF, Meta Box, JetEngine
 * y otros con su tipo, el número de palabras, dónde se usa cada imagen).
 */
export const SITE_COLUMN_SOURCES = ['core', 'acf', 'meta', 'seo', 'plugin'] as const;
export type SiteColumnSource = (typeof SITE_COLUMN_SOURCES)[number];

/** Tipos de campo en los que puede llegar una columna del sitio. */
export const SITE_COLUMN_TYPES = ['text', 'long_text', 'number', 'date', 'datetime', 'checkbox', 'url', 'select', 'multi_select'] as const;
export type SiteColumnType = (typeof SITE_COLUMN_TYPES)[number];

/**
 * Clave de una columna: `title`, `tax:category`, `acf:precio`, `meta:referencia`,
 * y con el complemento `seo:title`, `cf:acf.precio`, `plugin:words`.
 */
export const siteColumnKeySchema = z.string().min(1).max(200).regex(/^[a-z_]+(:[A-Za-z0-9_.-]{1,190})?$/, 'Columna inválida');

export const siteColumnSchema = z.object({
    key: z.string(),
    label: z.string(),
    source: z.enum(SITE_COLUMN_SOURCES),
    type: z.enum(SITE_COLUMN_TYPES),
    /** Se puede habilitar para editar desde la app (y viajar al sitio). */
    can_edit: z.boolean(),
    /** Viene marcada al elegir el tipo de contenido. */
    default_on: z.boolean(),
    /** Viene habilitada para editar (conservador: título, extracto y términos). */
    default_edit: z.boolean(),
    /** No se puede quitar (título, estado, «Editar en WordPress»). */
    always: z.boolean(),
    hint: z.string().nullable(),
    /** Un valor de ejemplo visto en el sitio (campos de ACF y personalizados). */
    sample: z.string().nullable(),
    /** Empieza con `_`: casi siempre interno de un plugin (se muestra plegado). */
    private: z.boolean(),
    /** Opciones de un select/multi_select que declara el plugin (ACF, Meta Box). */
    options: z.array(z.object({ value: z.string(), label: z.string() })).nullable().default(null),
    /** Es una imagen: la columna se muestra como miniatura. */
    image: z.boolean().default(false),
    /** Quién la da (`acf`, `metabox`, `jetengine`, `meta`, `seo`…): para agrupar en la pantalla. */
    provider: z.string().nullable().default(null),
});
export type SiteColumn = z.infer<typeof siteColumnSchema>;

export const siteObjectSchema = z.object({
    kind: z.enum(SITE_OBJECT_KINDS),
    /** Nombre interno en WordPress: `post`, `page`, `propiedad`, `category`. */
    object: z.string(),
    label: z.string(),
    rest_base: z.string(),
    rest_namespace: z.string(),
    /** Cuántos hay (lo que informa el sitio; null si no lo dijo). */
    count: z.number().int().nonnegative().nullable(),
    hierarchical: z.boolean(),
    columns: z.array(siteColumnSchema),
    /** Ya se sincroniza (en una lista de esta conexión). */
    synced: z.boolean(),
});
export type SiteObject = z.infer<typeof siteObjectSchema>;

/**
 * El complemento «Imagina Base Connector» en el sitio (ADR-S84). `installed`
 * false = el sitio no lo tiene (o no responde su ruta): la página del sitio
 * ofrece instalarlo y dice qué no se puede sin él.
 */
export const sitePluginInfoSchema = z.object({
    installed: z.boolean(),
    version: z.string().nullable(),
    /** La versión que reparte la app (para avisar que hay una más nueva). */
    latest: z.string().nullable(),
    outdated: z.boolean(),
    seo: z
        .object({ plugin: z.string(), name: z.string(), version: z.string(), terms: z.boolean(), problem: z.string().nullable() })
        .nullable(),
    providers: z.object({ acf: z.boolean(), metabox: z.boolean(), jetengine: z.boolean() }),
    /** El usuario conectado es administrador. */
    can_manage: z.boolean(),
    /**
     * El usuario conectado puede tener avisos en tiempo real: un Administrador
     * siempre; un Editor, con el complemento 1.1+ descargado desde la app (los
     * avisos sólo pueden ir a ella). Ausente = complemento viejo: decide `can_manage`.
     */
    can_hooks: z.boolean().optional(),
    /** Las actualizaciones del complemento llegan firmadas y se verifican antes de instalarse. */
    signed: z.boolean().optional(),
    /** Se actualiza solo desde la app (lo instalaron con el zip de la app). */
    updates: z.boolean(),
    /** Si no se pudo leer (instalado pero con un error). */
    error: z.string().nullable(),
});
export type SitePluginInfo = z.infer<typeof sitePluginInfoSchema>;

export const SITE_SYNC_MODES = ['interval', 'realtime'] as const;
export type SiteSyncMode = (typeof SITE_SYNC_MODES)[number];

export const siteDiscoverySchema = z.object({
    site_name: z.string(),
    site_url: z.string(),
    user: z.object({
        login: z.string(),
        name: z.string(),
        roles: z.array(z.string()),
        /** Puede editar entradas (sin esto no hay borradores ni edición). */
        can_edit: z.boolean(),
        /** Puede crear y editar categorías y etiquetas. */
        can_manage_terms: z.boolean(),
    }),
    objects: z.array(siteObjectSchema),
    /** ACF está instalado y expone campos en la API. */
    acf: z.boolean(),
    plugin: sitePluginInfoSchema,
    warnings: z.array(z.string()),
});
export type SiteDiscovery = z.infer<typeof siteDiscoverySchema>;

export const SITE_SYNC_INTERVALS = STORE_SYNC_INTERVALS;

const objectChoiceSchema = z.object({
    kind: z.enum(SITE_OBJECT_KINDS),
    object: z.string().min(1).max(32).regex(/^[a-z0-9_-]+$/),
    /** Columnas a traer (las obligatorias se agregan solas). */
    columns: z.array(siteColumnKeySchema).max(80),
    /** De esas, cuáles se editan desde la app. */
    editable: z.array(siteColumnKeySchema).max(80).default([]),
});
export type SiteObjectChoice = z.infer<typeof objectChoiceSchema>;

export const setupSiteSyncSchema = z.object({
    objects: z.array(objectChoiceSchema).min(1).max(10),
    /** «Editar desde la app»: sin esto, todas las columnas del sitio son de sólo lectura. */
    write_back: z.boolean().default(true),
    interval_minutes: storeSyncIntervalSchema.default(60),
    /** En tiempo real (necesita el complemento): el sitio avisa cada cambio y se revisa todo cada hora. */
    mode: z.enum(SITE_SYNC_MODES).default('interval'),
    /** v0.1.336 — lo que se borre en WordPress: conservarlo marcado o quitarlo de la app. */
    on_source_delete: sourceDeleteModeSchema.default('keep'),
});
export type SetupSiteSyncInput = z.infer<typeof setupSiteSyncSchema>;

/** Sumar tipos de contenido a una sincronización que ya existe. */
export const addSiteObjectsSchema = z.object({
    objects: z.array(objectChoiceSchema).min(1).max(10),
});
export type AddSiteObjectsInput = z.infer<typeof addSiteObjectsSchema>;

export const updateSiteSyncSchema = z.object({
    interval_minutes: storeSyncIntervalSchema.optional(),
    /** v0.1.336 — lo que se borra en WordPress: conservarlo marcado o quitarlo de la app. */
    on_source_delete: sourceDeleteModeSchema.optional(),
    mode: z.enum(SITE_SYNC_MODES).optional(),
    enabled: z.boolean().optional(),
    write_back: z.boolean().optional(),
    /**
     * Prender o apagar UNA columna editable, aplicado en el servidor sobre lo
     * guardado (la lección de v0.1.214: una caché vieja no pisa la elección).
     */
    editable_toggle: z
        .object({ resource: z.string().min(1).max(64), key: siteColumnKeySchema, on: z.boolean() })
        .optional(),
});
export type UpdateSiteSyncInput = z.infer<typeof updateSiteSyncSchema>;

/** Traer una columna más (o dejar de traerla: el campo y lo que tiene QUEDAN). */
export const siteColumnChangeSchema = z.object({
    resource: z.string().min(1).max(64),
    key: siteColumnKeySchema,
});
export type SiteColumnChangeInput = z.infer<typeof siteColumnChangeSchema>;

export const runSiteSyncSchema = z.object({ full: z.boolean().default(false) });

/**
 * Armar en una lista del sitio un «kit» listo para usar (ADR-S84):
 *  - `seo_audit`: largos del título y la descripción que ve Google, vistas
 *    «Sin descripción», «Título de más de 60 caracteres» y «Sin palabra clave»,
 *    y un campo con IA que propone la meta descripción;
 *  - `alt_text`: en la biblioteca de medios, la vista «Sin texto alternativo» y
 *    un campo con IA que lo propone mirando la imagen.
 */
export const SITE_KITS = ['seo_audit', 'alt_text'] as const;
export type SiteKit = (typeof SITE_KITS)[number];
export const applySiteKitSchema = z.object({ resource: z.string().min(1).max(64), kit: z.enum(SITE_KITS) });
export type ApplySiteKitInput = z.infer<typeof applySiteKitSchema>;
export const siteKitResultSchema = z.object({
    list: z.object({ id: idSchema, slug: z.string(), name: z.string() }),
    views: z.array(z.object({ id: idSchema, name: z.string() })),
    fields: z.array(z.object({ id: idSchema, label: z.string() })),
    /** Columnas del sitio que el kit sumó (se llenan en la próxima vuelta). */
    added_columns: z.array(z.string()),
    /** La columna con IA del kit (nueva o la que ya estaba), para calcular las sugerencias. */
    ai_field: z.object({ id: idSchema, label: z.string() }).nullable(),
    warnings: z.array(z.string()),
});
export type SiteKitResult = z.infer<typeof siteKitResultSchema>;
export type RunSiteSyncInput = z.infer<typeof runSiteSyncSchema>;

/** «Conectar en un clic»: la persona sólo escribe la dirección del sitio. */
export const startWordpressConnectSchema = z.object({
    site_url: z.string().trim().min(3).max(500),
    visibility: z.enum(['workspace', 'private']).default('workspace'),
    /** Reconectar una conexión que ya existe (la contraseña se revocó). */
    connection_id: idSchema.nullish(),
});
export type StartWordpressConnectInput = z.infer<typeof startWordpressConnectSchema>;

export const startWordpressConnectResultSchema = z.object({
    /** La pantalla «Autorizar aplicación» del propio WordPress. */
    authorize_url: z.string(),
    site_name: z.string(),
});
export type StartWordpressConnectResult = z.infer<typeof startWordpressConnectResultSchema>;

// --- Novedades del sitio (v0.1.336) ----------------------------------------

/**
 * Lo que apareció en el sitio desde la última vez que se miró: tipos de
 * contenido nuevos (un CPT recién creado) y columnas nuevas de los tipos que
 * ya se sincronizan (un campo de ACF, un campo personalizado). Se compara con
 * lo que el sitio ofrecía la última vez (`seen`), no con lo que se trae: una
 * columna que la persona decidió no traer no vuelve a aparecer como novedad.
 * Las internas de los plugins (empiezan con `_`) no cuentan.
 */
export const siteNoveltySchema = z.object({
    resource: z.string(),
    kind: z.enum(SITE_OBJECT_KINDS),
    object: z.string(),
    /** El tipo de contenido («Propiedades»). */
    object_label: z.string(),
    /** null = el tipo de contenido entero es nuevo; si no, la columna nueva. */
    column: z
        .object({ key: z.string(), label: z.string(), source: z.enum(SITE_COLUMN_SOURCES), provider: z.string().nullable() })
        .nullable(),
});
export type SiteNovelty = z.infer<typeof siteNoveltySchema>;

export const siteNoveltiesSchema = z.object({
    checked_at: z.string().nullable(),
    items: z.array(siteNoveltySchema),
    /** Si la última revisión no pudo leer el sitio. */
    error: z.string().nullable(),
});
export type SiteNovelties = z.infer<typeof siteNoveltiesSchema>;

/** «Ya lo vi»: dejar de mostrar estas novedades (o todas, sin lista). */
export const dismissSiteNoveltiesSchema = z.object({
    items: z
        .array(z.object({ resource: z.string().min(1).max(64), key: siteColumnKeySchema.nullable() }))
        .max(500)
        .optional(),
});
export type DismissSiteNoveltiesInput = z.infer<typeof dismissSiteNoveltiesSchema>;

// --- Estado de una sincronización ----------------------------------------

const listRefSchema = z.object({ id: idSchema, slug: z.string(), name: z.string() }).nullable();

export const siteSyncColumnStateSchema = z.object({
    key: z.string(),
    label: z.string(),
    source: z.enum(SITE_COLUMN_SOURCES),
    type: z.enum(SITE_COLUMN_TYPES),
    field_id: idSchema.nullable(),
    can_edit: z.boolean(),
    editable: z.boolean(),
    always: z.boolean(),
    hint: z.string().nullable(),
    /** La da el complemento y el sitio ya no lo tiene: queda con lo último que llegó. */
    needs_plugin: z.boolean().default(false),
});
export type SiteSyncColumnState = z.infer<typeof siteSyncColumnStateSchema>;

export const siteSyncObjectStateSchema = z.object({
    /** Identificador del recurso dentro de la sincronización (`post:propiedad`). */
    resource: z.string(),
    kind: z.enum(SITE_OBJECT_KINDS),
    object: z.string(),
    label: z.string(),
    list: listRefSchema,
    /** Registros vinculados hoy en la app. */
    count: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().nullable(),
    columns: z.array(siteSyncColumnStateSchema),
});
export type SiteSyncObjectState = z.infer<typeof siteSyncObjectStateSchema>;

export const siteSyncStatusSchema = z.object({
    configured: z.boolean(),
    connection_id: idSchema,
    site_name: z.string(),
    site_url: z.string(),
    enabled: z.boolean(),
    interval_minutes: z.number().int(),
    /** Lo elegido. */
    mode: z.enum(SITE_SYNC_MODES),
    /** Lo que corre de verdad: en tiempo real sin el complemento vuelve a intervalos. */
    effective_mode: z.enum(SITE_SYNC_MODES),
    write_back: z.boolean(),
    /** v0.1.336 — lo que se borra en WordPress: conservarlo marcado o quitarlo de la app. */
    on_source_delete: sourceDeleteModeSchema.default('keep'),
    /** v0.1.336 — por lista: cuántas filas ya se borraron en WordPress. */
    gone: z.array(sourceGoneCountSchema).default([]),
    /** v0.1.336 — tipos de contenido y columnas que aparecieron en el sitio desde la última vez. */
    novelties: siteNoveltiesSchema.nullable().default(null),
    folder_id: idSchema.nullable(),
    objects: z.array(siteSyncObjectStateSchema),
    /** Lo último que se supo del complemento (en cada vuelta). */
    plugin: z
        .object({
            installed: z.boolean(),
            version: z.string().nullable(),
            seo_name: z.string().nullable(),
            checked_at: z.string().nullable(),
            /** Estuvo y ya no está (lo desinstalaron o lo desactivaron). */
            missing_since: z.string().nullable(),
        })
        .nullable(),
    /** La versión del complemento que reparte la app (para avisar «hay una más nueva»). */
    plugin_latest: z.string().nullable().default(null),
    realtime: z.object({
        registered: z.boolean(),
        received: z.number().int().nonnegative(),
        last_at: z.string().nullable(),
        error: z.string().nullable(),
    }),
    running: z.boolean(),
    current: z.string().nullable(),
    initial_done: z.boolean(),
    last_run_at: z.string().nullable(),
    last_success_at: z.string().nullable(),
    next_run_at: z.string().nullable(),
    last_error: z.string().nullable(),
    warnings: z.array(z.string()),
    write_back_status: z.object({
        pushed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        last_at: z.string().nullable(),
        last_error: z.string().nullable(),
    }),
});
export type SiteSyncStatus = z.infer<typeof siteSyncStatusSchema>;

// --- Marca de la lista ----------------------------------------------------

/**
 * Marca que deja la sincronización en `lists.settings.site_sync` (como la de
 * la tienda en `store_sync`). Con ella el backend rechaza lo que WordPress no
 * aceptaría —crear o borrar entradas, cambiar una columna de sólo lectura— y
 * la interfaz lo bloquea antes, con el motivo. NO viaja al duplicar una lista
 * ni en una plantilla (la copia no es del sitio).
 */
export const siteListMarkerSchema = z.object({
    connection_id: idSchema,
    /** `post:propiedad`, `term:category`. */
    resource: z.string(),
    kind: z.enum(SITE_OBJECT_KINDS),
    object: z.string(),
    object_label: z.string().default(''),
    site_name: z.string().default(''),
    site_url: z.string().default(''),
    /** «Editar desde la app» activado. */
    write_back: z.boolean().default(false),
    /** clave de columna → id del campo: las columnas que vienen del sitio. */
    fields: z.record(z.string(), idSchema).default({}),
    /** Columnas que se PUEDEN habilitar para editar. */
    can_edit: z.array(z.string()).default([]),
    /** Columnas habilitadas para editar desde la app. */
    editable: z.array(z.string()).default([]),
    /**
     * Columnas que da el complemento cuando el sitio ya no lo tiene: quedan con
     * lo último que llegó, bloqueadas con el motivo (no se pueden mandar).
     */
    needs_plugin: z.array(z.string()).default([]),
    /** v0.1.336 — columnas nuevas en el sitio para esta lista (sus nombres): el aviso las ofrece. */
    new_columns: z.array(z.string()).default([]),
});
export type SiteListMarker = z.infer<typeof siteListMarkerSchema>;

/** Lectura tolerante de la marca (un settings viejo o ajeno no rompe nada). */
export function readSiteListMarker(settings: unknown): SiteListMarker | null {
    const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).site_sync : null;
    const parsed = siteListMarkerSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

/** `post:propiedad` / `term:category` / `media:attachment`. */
export function siteResourceKey(kind: SiteObjectKind, object: string): string {
    return `${kind === 'taxonomy' ? 'term' : kind === 'media' ? 'media' : 'post'}:${object}`;
}

export function parseSiteResourceKey(resource: string): { kind: SiteObjectKind; object: string } | null {
    const m = /^(post|term|media):([a-z0-9_-]{1,32})$/.exec(resource);
    if (!m) return null;
    return { kind: m[1] === 'term' ? 'taxonomy' : m[1] === 'media' ? 'media' : 'post_type', object: m[2]! };
}

/** Las columnas que da el complemento (`seo:…`, `cf:…`, `plugin:…`). */
export function isSitePluginColumn(key: string): boolean {
    return /^(seo|cf|plugin):/.test(key);
}

// --- Catálogo de columnas de WordPress ------------------------------------

/** Estados de una entrada en WordPress (los del núcleo). */
export const WP_POST_STATUS_OPTIONS: Array<{ value: string; label: string; color: string }> = [
    { value: 'publish', label: 'Publicado', color: 'emerald' },
    { value: 'draft', label: 'Borrador', color: 'slate' },
    { value: 'pending', label: 'Pendiente de revisión', color: 'amber' },
    { value: 'private', label: 'Privado', color: 'violet' },
    { value: 'future', label: 'Programado', color: 'sky' },
    { value: 'trash', label: 'Papelera', color: 'rose' },
];
/** Un medio tampoco: está en la biblioteca o se borró. */
export const WP_MEDIA_STATUS_OPTIONS: Array<{ value: string; label: string; color: string }> = [
    { value: 'publish', label: 'En la biblioteca', color: 'emerald' },
    { value: 'trash', label: 'Borrado en WordPress', color: 'rose' },
];
/** Un término no tiene estado: se marca si se borró en el sitio. */
export const WP_TERM_STATUS_OPTIONS: Array<{ value: string; label: string; color: string }> = [
    { value: 'publish', label: 'En el sitio', color: 'emerald' },
    { value: 'trash', label: 'Borrado en WordPress', color: 'rose' },
];
/** Estados que se pueden ELEGIR desde la app (programar y la papelera se hacen en WordPress). */
export const WP_SETTABLE_POST_STATUSES = ['publish', 'draft', 'pending', 'private'] as const;

/** Lo que el catálogo necesita saber de un tipo de contenido. */
export interface SiteObjectInfo {
    supports: string[];
    hierarchical: boolean;
    /** Taxonomías del tipo que se ven en la API (con su `rest_base`). */
    taxonomies: Array<{ taxonomy: string; label: string; rest_base: string }>;
}

function col(
    def: Pick<SiteColumn, 'key' | 'label' | 'type'> & Partial<Omit<SiteColumn, 'key' | 'label' | 'type'>>,
): SiteColumn {
    return {
        source: 'core',
        can_edit: false,
        default_on: false,
        default_edit: false,
        always: false,
        hint: null,
        sample: null,
        private: false,
        options: null,
        image: false,
        provider: null,
        ...def,
    };
}

const SLUG_HINT = 'Es la parte final del enlace. Si la cambias, WordPress actualiza el enlace y redirige el viejo al nuevo.';
const TERM_SLUG_HINT = 'Es la parte final del enlace del término. Si la cambias, el enlace viejo deja de funcionar.';

/**
 * Las columnas de WordPress (núcleo) que se pueden traer de un tipo de
 * contenido o una taxonomía. PURO: lo usan el descubrimiento (qué ofrecer), el
 * alta (qué tipo tiene cada columna) y las pruebas.
 */
export function siteCoreColumns(kind: SiteObjectKind, info: SiteObjectInfo): SiteColumn[] {
    if (kind === 'media') {
        return [
            col({ key: 'title', label: 'Título', type: 'text', can_edit: true, default_on: true, default_edit: true, always: true }),
            col({ key: 'status', label: 'Estado', type: 'select', always: true, hint: 'Se marca «Borrado en WordPress» si el medio deja de existir.' }),
            col({ key: 'wp_id', label: 'ID en WordPress', type: 'number', always: true }),
            col({ key: 'edit_link', label: 'Editar en WordPress', type: 'url', always: true }),
            col({ key: 'thumbnail', label: 'Imagen', type: 'url', default_on: true, image: true }),
            col({
                key: 'alt_text',
                label: 'Texto alternativo',
                type: 'text',
                can_edit: true,
                default_on: true,
                default_edit: true,
                hint: 'Lo que leen los lectores de pantalla y Google cuando no ve la imagen. Una frase corta que la describa.',
            }),
            col({ key: 'caption', label: 'Leyenda', type: 'long_text', can_edit: true, default_on: true, default_edit: true }),
            col({ key: 'description', label: 'Descripción', type: 'long_text', can_edit: true }),
            col({ key: 'mime_type', label: 'Tipo de archivo', type: 'text', default_on: true }),
            col({ key: 'dimensions', label: 'Medidas', type: 'text', default_on: true }),
            col({ key: 'filesize', label: 'Peso (KB)', type: 'number', default_on: true }),
            col({ key: 'source_url', label: 'Archivo', type: 'url' }),
            col({ key: 'link', label: 'Página del medio', type: 'url' }),
            col({ key: 'date', label: 'Fecha de subida', type: 'datetime', default_on: true }),
            col({ key: 'modified', label: 'Última modificación', type: 'datetime' }),
            col({ key: 'author', label: 'Subido por', type: 'text' }),
        ];
    }
    if (kind === 'taxonomy') {
        return [
            col({ key: 'name', label: 'Nombre', type: 'text', can_edit: true, default_on: true, default_edit: true, always: true }),
            col({ key: 'status', label: 'Estado', type: 'select', always: true, hint: 'Se marca «Borrado en WordPress» si el término deja de existir.' }),
            col({ key: 'wp_id', label: 'ID en WordPress', type: 'number', always: true }),
            col({ key: 'edit_link', label: 'Editar en WordPress', type: 'url', always: true }),
            col({ key: 'slug', label: 'Dirección', type: 'text', can_edit: true, hint: TERM_SLUG_HINT }),
            col({ key: 'description', label: 'Descripción', type: 'long_text', can_edit: true, default_on: true, default_edit: true }),
            ...(info.hierarchical ? [col({ key: 'parent', label: 'Superior', type: 'text', default_on: true })] : []),
            col({ key: 'count', label: 'Cantidad de entradas', type: 'number', default_on: true }),
            col({ key: 'link', label: 'Enlace', type: 'url', default_on: true }),
        ];
    }
    const has = (s: string) => info.supports.includes(s);
    return [
        col({ key: 'title', label: 'Título', type: 'text', can_edit: true, default_on: true, default_edit: true, always: true }),
        col({
            key: 'status',
            label: 'Estado',
            type: 'select',
            can_edit: true,
            default_on: true,
            always: true,
            hint: 'Publicado, borrador, pendiente o privado. Programar y la papelera se hacen en WordPress.',
        }),
        col({ key: 'wp_id', label: 'ID en WordPress', type: 'number', always: true }),
        col({ key: 'edit_link', label: 'Editar en WordPress', type: 'url', always: true }),
        col({ key: 'link', label: 'Enlace', type: 'url', default_on: true }),
        col({ key: 'slug', label: 'Dirección', type: 'text', can_edit: true, hint: SLUG_HINT }),
        col({ key: 'date', label: 'Fecha de publicación', type: 'datetime', can_edit: true, default_on: true }),
        col({ key: 'modified', label: 'Última modificación', type: 'datetime', default_on: true }),
        ...(has('author') ? [col({ key: 'author', label: 'Autor', type: 'text' })] : []),
        ...(has('excerpt') ? [col({ key: 'excerpt', label: 'Extracto', type: 'long_text', can_edit: true, default_on: true, default_edit: true })] : []),
        ...(has('thumbnail') ? [col({ key: 'featured_image', label: 'Imagen destacada', type: 'url', default_on: true })] : []),
        ...(info.hierarchical ? [col({ key: 'parent', label: 'Página madre', type: 'text', default_on: true })] : []),
        ...(has('page-attributes') ? [col({ key: 'menu_order', label: 'Orden', type: 'number', can_edit: true })] : []),
        ...(has('page-attributes') ? [col({ key: 'template', label: 'Plantilla', type: 'text' })] : []),
        ...info.taxonomies.map((t) =>
            col({
                key: `tax:${t.taxonomy}`,
                label: t.label,
                type: 'multi_select',
                can_edit: true,
                default_on: true,
                default_edit: true,
                hint: 'Una nueva se crea en WordPress al guardar.',
            }),
        ),
    ];
}

/** Qué tipo de campo sugerir para un valor de ACF o un campo personalizado. */
export function suggestSiteValueType(value: unknown): SiteColumnType {
    if (typeof value === 'boolean') return 'checkbox';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') {
        if (/^https?:\/\/\S+$/i.test(value.trim())) return 'url';
        if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return 'date';
        if (value.length > 120 || value.includes('\n')) return 'long_text';
        return 'text';
    }
    return 'long_text';
}

/** Un valor estructurado (un repetidor de ACF, una lista) se trae como texto y NO se edita. */
export function isScalarSiteValue(value: unknown): boolean {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

/** «garantia_meses» → «Garantia meses». */
export function humanizeSiteKey(key: string): string {
    const t = key.replace(/^_+/, '').replace(/[_-]+/g, ' ').trim();
    return t === '' ? key : t.charAt(0).toUpperCase() + t.slice(1);
}

/** Los intervalos que ofrece la pantalla del sitio. */
export const siteSyncIntervalSchema = storeSyncIntervalSchema;
