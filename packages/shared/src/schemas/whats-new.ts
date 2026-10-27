import { z } from 'zod';
import { planSchema } from './billing';
import { idSchema } from './common';
import { resolveEmbed, type ResolvedEmbed } from './embeds';

/**
 * Fase 7 · entrega 3 — «Novedades»: qué hay de nuevo en la app.
 *
 * Una NOVEDAD es de la PLATAFORMA, no de una empresa (como los planes): la
 * leen todas. Llegan de dos lados:
 *  - `release`: viene escrita en el código con la versión (`WHATS_NEW_CATALOG`)
 *    y el servidor la sincroniza al arrancar (ver `whats-new/README.md`);
 *  - `operator`: la escribe el operador desde Plataforma → Novedades.
 *
 * Lo que vio cada persona (vista, abierta, clic en el botón, descartada) vive
 * aparte, por PERSONA (no por empresa): si alguien está en tres empresas, lee
 * la novedad una vez. Lo que sí depende de la empresa activa es QUIÉN la ve
 * (rol y plan del público).
 *
 * Nada de HTML crudo: el cuerpo es texto con formato sencillo (`**negrita**`,
 * `- viñeta`, `[enlace](https://…)`) que la app dibuja con React.
 */

export const WHATS_NEW_KINDS = ['feature', 'improvement', 'fix', 'notice'] as const;
export const whatsNewKindSchema = z.enum(WHATS_NEW_KINDS);
export type WhatsNewKind = z.infer<typeof whatsNewKindSchema>;

/** Etiquetas para la persona (el front las envuelve con `__()`). */
export const WHATS_NEW_KIND_LABELS: Record<WhatsNewKind, string> = {
    feature: 'Nueva función',
    improvement: 'Mejora',
    fix: 'Corrección',
    notice: 'Aviso',
};

/**
 * Roles BASE a los que se puede dirigir una novedad. `guest` sólo cuenta para
 * los avisos: un invitado no ve funciones nuevas (no puede usarlas). El
 * cliente del portal no está: el portal es otro mundo.
 */
export const WHATS_NEW_AUDIENCE_ROLES = ['admin', 'manager', 'agent', 'viewer', 'guest'] as const;
export const whatsNewAudienceRoleSchema = z.enum(WHATS_NEW_AUDIENCE_ROLES);
export type WhatsNewAudienceRole = z.infer<typeof whatsNewAudienceRoleSchema>;

export const WHATS_NEW_STATUSES = ['draft', 'published', 'hidden'] as const;
export const whatsNewStatusSchema = z.enum(WHATS_NEW_STATUSES);
export type WhatsNewStatus = z.infer<typeof whatsNewStatusSchema>;

export const WHATS_NEW_ORIGINS = ['release', 'operator'] as const;
export type WhatsNewOrigin = (typeof WHATS_NEW_ORIGINS)[number];

export const WHATS_NEW_EVENTS = ['opened', 'clicked', 'dismissed', 'presented'] as const;
export type WhatsNewEvent = (typeof WHATS_NEW_EVENTS)[number];

export const WHATS_NEW_LIMITS = {
    title: 120,
    summary: 280,
    body: 6000,
    actionLabel: 40,
    href: 500,
} as const;

/**
 * Ids de los recorridos que se pueden nombrar en el botón (los implementa la
 * pieza de guías; si el recorrido no existe para la persona, el botón cae a su
 * ruta). Sólo sugerencias: cualquier id con el formato vale.
 */
export const WHATS_NEW_TOUR_SUGGESTIONS = [
    'welcome',
    'lists-and-records',
    'create-list',
    'import',
    'views',
    'record',
    'invite-team',
    'automation-basics',
    'dashboards',
    'forms',
    'portal',
    'branding',
    'install-app',
    'search-and-shortcuts',
    'assistant',
] as const;

export const WHATS_NEW_TOUR_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * Una ruta INTERNA de la app (`/lists`, `/settings?s=papelera`). Nunca `//host`
 * (sería otro sitio), ni `\`, ni caracteres de control o espacios.
 */
export function isSafeAppRoute(value: string): boolean {
    if (value.length === 0 || value.length > 300) return false;
    if (!value.startsWith('/') || value.startsWith('//')) return false;
    return /^\/[A-Za-z0-9\-._~/?=&%#+]*$/.test(value);
}

/** Lo mínimo de `URL` que se usa (el `lib` de este paquete no trae el DOM; ver `embeds.ts`). */
interface ParsedHttpsUrl {
    protocol: string;
    hostname: string;
    username: string;
    password: string;
}
declare const URL: { new (input: string): ParsedHttpsUrl };

/** Un enlace https absoluto, sin usuario ni contraseña embebidos. */
export function isHttpsUrl(value: string): boolean {
    if (value.length > 2000) return false;
    let u: ParsedHttpsUrl;
    try {
        u = new URL(value);
    } catch {
        return false;
    }
    return u.protocol === 'https:' && u.username === '' && u.password === '' && u.hostname.length > 0;
}

/** Donde se sirven las imágenes que sube el operador (sin sesión: una novedad no es secreta). */
export const WHATS_NEW_IMAGE_PATH = '/api/v1/public/whats-new/images/';
export const WHATS_NEW_IMAGE_NAME_RE = /^[a-f0-9]{32}\.(png|jpg|webp|gif)$/;

/** Imagen: una de las subidas a la plataforma o una URL https. */
export function isWhatsNewImageUrl(value: string): boolean {
    if (value.startsWith(WHATS_NEW_IMAGE_PATH)) {
        return WHATS_NEW_IMAGE_NAME_RE.test(value.slice(WHATS_NEW_IMAGE_PATH.length));
    }
    return isHttpsUrl(value);
}

/** Video: sólo YouTube, Vimeo o Loom (lo que admite la CSP del iframe). */
export function whatsNewVideo(value: string | null | undefined): ResolvedEmbed | null {
    const r = resolveEmbed(value ?? null);
    if (r === null) return null;
    return r.provider === 'youtube' || r.provider === 'vimeo' || r.provider === 'loom' ? r : null;
}

/** Destino de un botón: ruta interna o enlace https. */
export function isWhatsNewHref(value: string): boolean {
    return isSafeAppRoute(value) || isHttpsUrl(value);
}

export const whatsNewActionSchema = z
    .object({
        label: z.string().trim().min(1).max(WHATS_NEW_LIMITS.actionLabel),
        /** Ruta interna (`/lists`) o enlace https. */
        href: z
            .string()
            .trim()
            .max(WHATS_NEW_LIMITS.href)
            .refine(isWhatsNewHref, 'Usa una ruta de la app (empieza con /) o un enlace https')
            .optional(),
        /** Recorrido interactivo: si existe para la persona, el botón lo arranca. */
        tour: z.string().trim().regex(WHATS_NEW_TOUR_ID_RE, 'Id de recorrido no válido').optional(),
    })
    .refine((a) => Boolean(a.href) || Boolean(a.tour), {
        message: 'Indica a dónde lleva el botón: una pantalla de la app, un enlace o un recorrido',
        path: ['href'],
    });
export type WhatsNewAction = z.infer<typeof whatsNewActionSchema>;

export const whatsNewAudienceSchema = z.object({
    /** Vacío = todos los roles. */
    roles: z.array(whatsNewAudienceRoleSchema).max(WHATS_NEW_AUDIENCE_ROLES.length).default([]),
    /** Vacío = todos los planes. */
    plans: z.array(planSchema).max(50).default([]),
});
export type WhatsNewAudience = z.infer<typeof whatsNewAudienceSchema>;

const imageUrlSchema = z
    .string()
    .trim()
    .max(2000)
    .refine(isWhatsNewImageUrl, 'La imagen tiene que ser un enlace https o una imagen subida');
const videoUrlSchema = z
    .string()
    .trim()
    .max(2000)
    .refine((v) => whatsNewVideo(v) !== null, 'Pega un enlace de YouTube, Vimeo o Loom');
/**
 * v0.1.325 — Lo visual de una novedad, además de la imagen y el video:
 *  - `illustration`: una ilustración ANIMADA de la app (las del centro de
 *    aprendizaje, `apps/web/app/admin/learn/illustrations/items/<clave>.tsx`):
 *    se dibuja con los colores del tema y de la marca, en claro y en oscuro;
 *  - `demo`: una captura real paso a paso (las que graba el release en
 *    `/help-media/`); si en este servidor no hay capturas, se ve la
 *    ilustración;
 *  - `slides`: un carrusel de hasta 6 diapositivas (título, texto y su propia
 *    ilustración, captura o imagen), como el «Qué hay de nuevo» de ClickUp.
 * Las claves se guardan como texto: si una ilustración deja de existir en una
 * versión futura, la novedad se ve igual sin ella (nunca un hueco).
 */
export const WHATS_NEW_MEDIA_KEY_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const WHATS_NEW_SLIDE_LIMITS = { max: 6, title: 80, text: 280 } as const;
const mediaKeySchema = z.string().trim().regex(WHATS_NEW_MEDIA_KEY_RE, 'Clave de ilustración no válida');

export const whatsNewSlideSchema = z.object({
    title: z.string().trim().min(1).max(WHATS_NEW_SLIDE_LIMITS.title),
    text: z.string().trim().max(WHATS_NEW_SLIDE_LIMITS.text).default(''),
    illustration: mediaKeySchema.nullable().default(null),
    demo: mediaKeySchema.nullable().default(null),
    image_url: imageUrlSchema.nullable().default(null),
});
export type WhatsNewSlide = z.infer<typeof whatsNewSlideSchema>;

export const whatsNewMediaSchema = z.object({
    illustration: mediaKeySchema.nullable().default(null),
    demo: mediaKeySchema.nullable().default(null),
    slides: z.array(whatsNewSlideSchema).max(WHATS_NEW_SLIDE_LIMITS.max).default([]),
});
export type WhatsNewMedia = z.infer<typeof whatsNewMediaSchema>;

export const EMPTY_WHATS_NEW_MEDIA: WhatsNewMedia = { illustration: null, demo: null, slides: [] };

/**
 * Lee lo visual guardado (jsonb) con tolerancia: un valor raro o de una
 * versión vieja nunca rompe el feed, sólo se descarta lo que no valida.
 */
export function readWhatsNewMedia(raw: unknown): WhatsNewMedia {
    const r = whatsNewMediaSchema.safeParse(raw ?? {});
    if (r.success) return r.data;
    if (raw === null || typeof raw !== 'object') return EMPTY_WHATS_NEW_MEDIA;
    const o = raw as Record<string, unknown>;
    const key = (v: unknown): string | null => (typeof v === 'string' && WHATS_NEW_MEDIA_KEY_RE.test(v) ? v : null);
    const slides = Array.isArray(o.slides)
        ? o.slides.flatMap((s) => {
              const p = whatsNewSlideSchema.safeParse(s);
              return p.success ? [p.data] : [];
          })
        : [];
    return { illustration: key(o.illustration), demo: key(o.demo), slides: slides.slice(0, WHATS_NEW_SLIDE_LIMITS.max) };
}

/** ¿Tiene algo para mostrar además del texto? */
export function whatsNewHasVisual(e: { image_url: string | null; video_url: string | null; media: WhatsNewMedia }): boolean {
    return Boolean(e.image_url || e.video_url || e.media.illustration || e.media.demo || e.media.slides.length > 0);
}

const versionSchema = z.string().trim().regex(/^\d{1,4}\.\d{1,4}\.\d{1,5}$/, 'Usa el formato 0.1.300');
const isoDateTime = z.string().datetime({ offset: true });

/** Lo que se escribe de una novedad (operador o catálogo). */
const contentShape = {
    kind: whatsNewKindSchema,
    title: z.string().trim().min(1).max(WHATS_NEW_LIMITS.title),
    summary: z.string().trim().min(1).max(WHATS_NEW_LIMITS.summary),
    body: z.string().max(WHATS_NEW_LIMITS.body).default(''),
    image_url: imageUrlSchema.nullable().default(null),
    video_url: videoUrlSchema.nullable().default(null),
    media: whatsNewMediaSchema.default(EMPTY_WHATS_NEW_MEDIA),
    action: whatsNewActionSchema.nullable().default(null),
    version: versionSchema.nullable().default(null),
    featured: z.boolean().default(false),
    audience: whatsNewAudienceSchema.default({ roles: [], plans: [] }),
    /** Sobre todo para avisos: a partir de cuándo deja de verse. */
    expires_at: isoDateTime.nullable().default(null),
};

// ─────────────────────────── Lo que ve una persona ───────────────────────────

export const whatsNewItemSchema = z.object({
    id: idSchema,
    key: z.string(),
    origin: z.enum(WHATS_NEW_ORIGINS),
    kind: whatsNewKindSchema,
    title: z.string(),
    summary: z.string(),
    body: z.string(),
    image_url: z.string().nullable(),
    video_url: z.string().nullable(),
    media: whatsNewMediaSchema,
    action: whatsNewActionSchema.nullable(),
    version: z.string().nullable(),
    published_at: z.string(),
    expires_at: z.string().nullable(),
    featured: z.boolean(),
    /** Llegó después del alta de la persona y todavía no la vio. */
    is_new: z.boolean(),
});
export type WhatsNewItem = z.infer<typeof whatsNewItemSchema>;

export const whatsNewFeedSchema = z.object({
    /** Cuántas novedades sin ver tiene la persona (no cuenta avisos vencidos ni ocultos). */
    unseen_count: z.number().int().nonnegative(),
    items: z.array(whatsNewItemSchema),
    has_more: z.boolean(),
    /** Cursor para la página siguiente (`before`). */
    next_before: z.string().nullable(),
    /** Avisos para la franja de arriba: vigentes y no cerrados por la persona. */
    notices: z.array(whatsNewItemSchema),
    /** La destacada para presentar en un diálogo (o null). */
    featured: whatsNewItemSchema.nullable(),
});
export type WhatsNewFeed = z.infer<typeof whatsNewFeedSchema>;

export const whatsNewFeedQuerySchema = z.object({
    kind: whatsNewKindSchema.optional(),
    /** Cursor de la página anterior (`next_before`). */
    before: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|\d{1,15}$/)
        .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type WhatsNewFeedQuery = z.infer<typeof whatsNewFeedQuerySchema>;

export const markWhatsNewSeenSchema = z
    .object({
        ids: z.array(idSchema).max(200).optional(),
        all: z.boolean().optional(),
    })
    .refine((v) => v.all === true || (v.ids !== undefined && v.ids.length > 0), 'Indica qué novedades');
export type MarkWhatsNewSeenInput = z.infer<typeof markWhatsNewSeenSchema>;

export const whatsNewEventSchema = z.object({ event: z.enum(WHATS_NEW_EVENTS) });
export type WhatsNewEventInput = z.infer<typeof whatsNewEventSchema>;

// ─────────────────────────── Plataforma → Novedades ───────────────────────────

export const whatsNewStatsSchema = z.object({
    seen: z.number().int().nonnegative(),
    opened: z.number().int().nonnegative(),
    clicked: z.number().int().nonnegative(),
    dismissed: z.number().int().nonnegative(),
});
export type WhatsNewStats = z.infer<typeof whatsNewStatsSchema>;

export const platformWhatsNewEntrySchema = z.object({
    id: idSchema,
    key: z.string(),
    origin: z.enum(WHATS_NEW_ORIGINS),
    status: whatsNewStatusSchema,
    kind: whatsNewKindSchema,
    title: z.string(),
    summary: z.string(),
    body: z.string(),
    image_url: z.string().nullable(),
    video_url: z.string().nullable(),
    media: whatsNewMediaSchema,
    action: whatsNewActionSchema.nullable(),
    version: z.string().nullable(),
    featured: z.boolean(),
    audience: whatsNewAudienceSchema,
    published_at: z.string().nullable(),
    /** Desde cuándo cuenta como «nueva» en este servidor (null = sólo historial). */
    announce_from: z.string().nullable(),
    expires_at: z.string().nullable(),
    /** Una novedad de versión que el operador cambió: las versiones nuevas ya no la tocan. */
    edited: z.boolean(),
    /** La novedad de versión sigue en el catálogo del código (se puede restaurar). */
    in_catalog: z.boolean(),
    created_by_name: z.string().nullable(),
    updated_by_name: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    stats: whatsNewStatsSchema,
});
export type PlatformWhatsNewEntry = z.infer<typeof platformWhatsNewEntrySchema>;

export const platformWhatsNewListSchema = z.object({
    items: z.array(platformWhatsNewEntrySchema),
    /** Cuántas personas hay en la plataforma (para leer las estadísticas). */
    people: z.number().int().nonnegative(),
});
export type PlatformWhatsNewList = z.infer<typeof platformWhatsNewListSchema>;

export const createWhatsNewSchema = z.object({
    ...contentShape,
    /** `draft` guarda sin publicar. */
    status: z.enum(['draft', 'published']).default('published'),
    /** Programar: cuándo se publica (null = ahora). */
    publish_at: isoDateTime.nullable().default(null),
});
export type CreateWhatsNewInput = z.infer<typeof createWhatsNewSchema>;

export const updateWhatsNewSchema = z
    .object({
        kind: whatsNewKindSchema,
        title: contentShape.title,
        summary: contentShape.summary,
        body: z.string().max(WHATS_NEW_LIMITS.body),
        image_url: imageUrlSchema.nullable(),
        video_url: videoUrlSchema.nullable(),
        media: whatsNewMediaSchema,
        action: whatsNewActionSchema.nullable(),
        version: versionSchema.nullable(),
        featured: z.boolean(),
        audience: whatsNewAudienceSchema,
        expires_at: isoDateTime.nullable(),
        status: whatsNewStatusSchema,
        publish_at: isoDateTime.nullable(),
    })
    .partial();
export type UpdateWhatsNewInput = z.infer<typeof updateWhatsNewSchema>;

export const whatsNewImageUploadSchema = z.object({ url: z.string() });
export type WhatsNewImageUpload = z.infer<typeof whatsNewImageUploadSchema>;

// ─────────────────────────── Catálogo en código ───────────────────────────

/** Una novedad que viaja con una versión (`packages/shared/src/whats-new/catalog.ts`). */
export const whatsNewCatalogEntrySchema = z.object({
    /** Clave ESTABLE: nunca se cambia (si se cambia, es otra novedad). */
    key: z.string().regex(/^[a-z0-9][a-z0-9.-]{2,119}$/, 'clave: minúsculas, números, punto y guion'),
    version: versionSchema,
    /** Fecha de la versión (`AAAA-MM-DD`). */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: whatsNewKindSchema,
    title: contentShape.title,
    summary: contentShape.summary,
    body: z.string().max(WHATS_NEW_LIMITS.body).optional(),
    image_url: imageUrlSchema.optional(),
    video_url: videoUrlSchema.optional(),
    /** Ilustración animada, captura real y/o carrusel (v0.1.325). */
    media: whatsNewMediaSchema.partial().optional(),
    action: whatsNewActionSchema.optional(),
    featured: z.boolean().optional(),
    audience: whatsNewAudienceSchema.partial().optional(),
    expires_at: isoDateTime.optional(),
});
export type WhatsNewCatalogEntry = z.input<typeof whatsNewCatalogEntrySchema>;

/** Compara versiones `a.b.c` (−1, 0, 1). Lo que no tiene ese formato va al final. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
    const parse = (v: string | null | undefined): number[] | null => {
        const m = /^(\d+)\.(\d+)\.(\d+)$/.exec((v ?? '').trim());
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    };
    const pa = parse(a);
    const pb = parse(b);
    if (pa === null && pb === null) return 0;
    if (pa === null) return -1;
    if (pb === null) return 1;
    for (let i = 0; i < 3; i++) {
        if (pa[i]! !== pb[i]!) return pa[i]! < pb[i]! ? -1 : 1;
    }
    return 0;
}

/**
 * ¿La ve esta persona? (rol base y plan de la empresa activa). Un invitado sólo
 * ve avisos. La misma regla se aplica en SQL en el servidor; ésta la usa la
 * vista previa de la consola.
 */
export function whatsNewVisibleTo(
    entry: { kind: WhatsNewKind; audience: { roles?: readonly string[]; plans?: readonly string[] } },
    viewer: { role: string; plan: string | null },
): boolean {
    if (viewer.role === 'client') return false;
    if (viewer.role === 'guest' && entry.kind !== 'notice') return false;
    const roles = entry.audience.roles ?? [];
    if (roles.length > 0 && !roles.includes(viewer.role)) return false;
    const plans = entry.audience.plans ?? [];
    if (plans.length > 0 && (viewer.plan === null || !plans.includes(viewer.plan))) return false;
    return true;
}
