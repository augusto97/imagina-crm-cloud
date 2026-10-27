import { z } from 'zod';
import type { Capability } from './membership';
import { resolveEmbed } from './embeds';

/**
 * Fase 7 · entrega 2 — guías rápidas, recorridos interactivos y el centro de
 * ayuda (ADR-S74).
 *
 * Tres cosas viven aquí, todas como DATOS:
 *  - el progreso de los recorridos de cada persona en cada empresa
 *    (`memberships.settings.guides`);
 *  - el formato de una guía «¿Cómo hago…?» — el MISMO para las del sistema
 *    (`help/system-guides.ts`) y para las que escribe el operador;
 *  - la configuración de ayuda de la plataforma (Redis `platform:help`):
 *    contacto de soporte, video por guía, guías propias y guías ocultas.
 *
 * El texto de una guía va en «formato sencillo» (`markdown-lite`): `**negrita**`,
 * `1. pasos`, `- viñetas`, `[enlace](https://…)`. La interfaz lo dibuja sin
 * `innerHTML`, así una guía del operador no puede inyectar nada.
 */

// ── Identificadores ──────────────────────────────────────────────────────

/** Id de una guía o de un recorrido: minúsculas, números y guiones. */
export const HELP_ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const helpIdSchema = z.string().regex(HELP_ID_RE, 'Identificador inválido');

/**
 * Ids canónicos de los recorridos (contrato común de la fase 7). La entrega 1
 * y la 3 los nombran como texto; si alguno no existe para esta persona,
 * `help.hasTour(id)` da false y el botón no se muestra.
 */
export const TOUR_IDS = [
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
    'my-day',
    'discover',
] as const;
export type TourId = (typeof TOUR_IDS)[number];

// ── Progreso de los recorridos (por persona y empresa) ───────────────────

const MAX_PROGRESS_IDS = 100;

export const guideProgressSchema = z.object({
    /** Recorridos terminados (llegó al último paso). */
    completed: z.array(helpIdSchema).max(MAX_PROGRESS_IDS).default([]),
    /** Recorridos que la persona saltó a mitad de camino. */
    dismissed: z.array(helpIdSchema).max(MAX_PROGRESS_IDS).default([]),
    /** Si ya se le ofreció el recorrido de bienvenida en esta empresa. */
    welcome_offered: z.boolean().default(false),
});
export type GuideProgress = z.infer<typeof guideProgressSchema>;

/**
 * PATCH que MEZCLA: `completed` y `dismissed` se SUMAN a lo guardado (no lo
 * reemplazan), `welcome_offered` se pisa. Terminar un recorrido que antes se
 * había saltado lo saca de `dismissed`.
 */
export const updateGuideProgressSchema = z
    .object({
        completed: z.array(helpIdSchema).max(20),
        dismissed: z.array(helpIdSchema).max(20),
        welcome_offered: z.boolean(),
    })
    .partial()
    .strict();
export type UpdateGuideProgressInput = z.infer<typeof updateGuideProgressSchema>;

/** Lectura tolerante: un valor raro no rompe nada, vuelve al estado vacío. */
export function parseGuideProgress(raw: unknown): GuideProgress {
    const parsed = guideProgressSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : guideProgressSchema.parse({});
}

function unionCapped(base: readonly string[], add: readonly string[]): string[] {
    const out = [...base];
    for (const id of add) if (!out.includes(id)) out.push(id);
    // Se conservan los más recientes si se pasa del tope.
    return out.slice(-MAX_PROGRESS_IDS);
}

export function mergeGuideProgress(current: GuideProgress, patch: UpdateGuideProgressInput): GuideProgress {
    const completed = unionCapped(current.completed, patch.completed ?? []);
    let dismissed = unionCapped(current.dismissed, patch.dismissed ?? []);
    if (patch.completed && patch.completed.length > 0) {
        dismissed = dismissed.filter((id) => !patch.completed!.includes(id));
    }
    return {
        completed,
        dismissed,
        welcome_offered: patch.welcome_offered ?? current.welcome_offered,
    };
}

// ── Categorías y pantallas ───────────────────────────────────────────────

export const HELP_CATEGORIES = [
    { id: 'start', label: 'Lo básico' },
    { id: 'lists', label: 'Listas y registros' },
    { id: 'views', label: 'Vistas' },
    { id: 'record', label: 'La ficha' },
    { id: 'team', label: 'Equipo y permisos' },
    { id: 'automations', label: 'Automatizaciones y agentes' },
    { id: 'dashboards', label: 'Tableros' },
    { id: 'public', label: 'Formularios, portal y citas' },
    { id: 'documents', label: 'Documentos y cobros' },
    { id: 'integrations', label: 'Integraciones y canales' },
    { id: 'mobile', label: 'Celular y avisos' },
    { id: 'account', label: 'Cuenta y seguridad' },
] as const;
export type HelpCategoryId = (typeof HELP_CATEGORIES)[number]['id'];
export const helpCategorySchema = z.enum(HELP_CATEGORIES.map((c) => c.id) as [HelpCategoryId, ...HelpCategoryId[]]);

/**
 * Pantallas de la app a las que se puede asociar una guía (la sección «En esta
 * pantalla» del panel). Las que el operador elige para sus guías propias son
 * las de esta lista; las del sistema pueden además apuntar a una sección
 * concreta (`settings:miembros`, `list-settings:permisos`).
 */
export const HELP_SCREENS = [
    { id: 'lists-index', label: 'Índice de listas' },
    { id: 'records', label: 'Registros de una lista' },
    { id: 'record', label: 'Ficha de un registro' },
    { id: 'list-settings', label: 'Configuración de una lista' },
    { id: 'automations', label: 'Automatizaciones' },
    { id: 'layout-editor', label: 'Editor de la ficha y del portal' },
    { id: 'my-work', label: 'Mi trabajo' },
    { id: 'favorites', label: 'Favoritos' },
    { id: 'dashboards', label: 'Tableros' },
    { id: 'agents', label: 'Agentes de IA' },
    { id: 'settings', label: 'Ajustes' },
] as const;
export type HelpScreenId = (typeof HELP_SCREENS)[number]['id'];

/** `pantalla` o `pantalla:sección` (p. ej. `settings:miembros`). */
export const HELP_SCREEN_RE = /^[a-z][a-z-]{1,30}(:[a-z][a-z0-9-]{1,30})?$/;
export const helpScreenSchema = z.string().regex(HELP_SCREEN_RE, 'Pantalla inválida');

/**
 * Las pantallas que corresponden a una ubicación de la app (ruta del router
 * + query). Devuelve la pantalla y, si la hay, su sección: una guía marcada
 * con cualquiera de las dos aparece en «En esta pantalla».
 */
export function helpScreensFor(pathname: string, search = ''): string[] {
    const params = parseQuery(search);
    const out: string[] = [];
    const path = pathname.replace(/\/+$/, '') || '/';
    if (path === '/lists' || /^\/folders\/[^/]+$/.test(path)) out.push('lists-index');
    if (/^\/lists\/[^/]+\/records$/.test(path)) {
        out.push('records');
        if (params.record) out.push('record');
    }
    if (/^\/lists\/[^/]+\/records\/[^/]+$/.test(path)) out.push('record');
    if (/^\/lists\/[^/]+\/edit$/.test(path)) {
        out.push('list-settings');
        out.push(`list-settings:${params.s ?? 'campos'}`);
    }
    if (/^\/lists\/[^/]+\/automations(\/.*)?$/.test(path)) out.push('automations');
    if (/^\/lists\/[^/]+\/(template-editor|portal-editor)$/.test(path)) out.push('layout-editor');
    if (path === '/my-work') out.push('my-work');
    if (path === '/favorites') out.push('favorites');
    if (/^\/dashboards(\/.*)?$/.test(path)) out.push('dashboards');
    if (/^\/agents(\/.*)?$/.test(path)) out.push('agents');
    if (/^\/settings(\/.*)?$/.test(path)) {
        out.push('settings');
        if (params.s) out.push(`settings:${params.s}`);
        if (/^\/settings\/(stores|sql|whatsapp|collections)\//.test(path)) out.push('settings:conectores');
    }
    return out;
}

function parseQuery(search: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of search.replace(/^\?/, '').split('&')) {
        if (!part) continue;
        const [k, v = ''] = part.split('=');
        if (!k) continue;
        try {
            out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
        } catch {
            out[k] = v;
        }
    }
    return out;
}

// ── Guías ────────────────────────────────────────────────────────────────

/** Roles del equipo a los que se dirige una guía propia (vacío = todos). */
export const HELP_AUDIENCE_ROLES = ['admin', 'manager', 'agent', 'viewer'] as const;
export type HelpAudienceRole = (typeof HELP_AUDIENCE_ROLES)[number];

/** Sólo YouTube, Vimeo y Loom (los marcos que permite la CSP de la app). */
export function helpVideoEmbed(url: string): string | null {
    const e = resolveEmbed(url);
    if (e === null) return null;
    return e.provider === 'youtube' || e.provider === 'vimeo' || e.provider === 'loom' ? e.src : null;
}

export const helpVideoUrlSchema = z
    .string()
    .trim()
    .max(300)
    .refine((u) => helpVideoEmbed(u) !== null, 'Pega un enlace de YouTube, Vimeo o Loom');

/**
 * Una guía rápida «¿Cómo hago…?». El mismo formato para las del sistema y las
 * del operador; las del sistema además saben a qué recorrido llevan
 * («Muéstrame»), a qué pantalla («Ir ahí») y quién las puede usar.
 */
export interface HelpGuide {
    id: string;
    /** Como pregunta: «¿Cómo importo un Excel?». */
    title: string;
    category: HelpCategoryId;
    /** Minutos que toma («1 min»). */
    minutes: number;
    /** Pasos en formato sencillo (`1. Abre **Ajustes**…`). */
    body: string;
    /** Un consejo opcional, en formato sencillo. */
    tip?: string | null;
    /** Pantallas donde se sugiere (`records`, `settings:miembros`…). */
    screens: string[];
    /** Palabras extra para el buscador (sinónimos, sin acentos da igual). */
    keywords?: string;
    /** Recorrido que la muestra en la app («Muéstrame»). */
    tour?: string | null;
    /**
     * Pantalla a la que lleva «Ir ahí». `{list}` = una lista que la persona
     * puede ver (si no tiene ninguna, va al índice de listas).
     */
    route?: string | null;
    related: string[];
    /** Hace falta AL MENOS UNA de estas capacidades. */
    requires?: Capability[];
    /** Sólo administradores de la empresa (rol admin). */
    admin_only?: boolean;
    /**
     * Si la persona no puede hacerlo: `hide` la oculta; `note` la muestra con
     * «Lo hace un administrador» (vale la pena saber que existe).
     */
    if_restricted?: 'hide' | 'note';
    /** Guías propias: roles a los que se muestra (vacío = todos). */
    roles?: HelpAudienceRole[];
    /** Guías propias: video propio. Las del sistema lo toman de la config. */
    video_url?: string | null;
    /** De dónde sale la guía. */
    source?: 'system' | 'custom';
}

// ── Configuración de ayuda de la plataforma (Redis `platform:help`) ──────

const httpsUrl = z
    .string()
    .trim()
    .max(300)
    .regex(/^https:\/\/[^\s]+$/i, 'Debe empezar con https://');

export const helpSupportSchema = z.object({
    email: z.string().trim().email('Correo inválido').max(190).nullable().default(null),
    /** Número con indicativo; la ayuda arma el enlace de WhatsApp. */
    whatsapp: z
        .string()
        .trim()
        .regex(/^\+?[0-9][0-9 ()-]{6,22}$/, 'Número inválido: usa el indicativo, p. ej. +57 300 123 4567')
        .nullable()
        .default(null),
    /** Centro de ayuda externo (https). */
    url: httpsUrl.nullable().default(null),
    /** Una línea: horario, tiempo de respuesta… */
    note: z.string().trim().max(240).nullable().default(null),
});
export type HelpSupport = z.infer<typeof helpSupportSchema>;

export const CUSTOM_GUIDE_ID_RE = /^op-[a-z0-9]{4,24}$/;

export const customGuideSchema = z.object({
    id: z.string().regex(CUSTOM_GUIDE_ID_RE, 'Identificador inválido'),
    title: z.string().trim().min(3, 'Escribe un título').max(140),
    category: helpCategorySchema,
    minutes: z.number().int().min(1).max(60).default(2),
    body: z.string().trim().min(1, 'Escribe el contenido').max(5000),
    video_url: helpVideoUrlSchema.nullable().default(null),
    screens: z.array(helpScreenSchema).max(12).default([]),
    roles: z.array(z.enum(HELP_AUDIENCE_ROLES)).max(4).default([]),
});
export type CustomGuide = z.infer<typeof customGuideSchema>;

const MAX_VIDEOS = 200;

export const platformHelpSchema = z.object({
    support: helpSupportSchema.default({}),
    /** Video por guía del sistema: id de la guía → enlace. */
    videos: z
        .record(helpIdSchema, helpVideoUrlSchema)
        .refine((v) => Object.keys(v).length <= MAX_VIDEOS, 'Demasiados videos')
        .default({}),
    /** Guías del sistema que el operador ocultó. */
    hidden: z.array(helpIdSchema).max(200).default([]),
    /** Guías propias del operador. */
    custom: z
        .array(customGuideSchema)
        .max(60)
        .refine((list) => new Set(list.map((g) => g.id)).size === list.length, 'Hay guías repetidas')
        .default([]),
});
export type PlatformHelp = z.infer<typeof platformHelpSchema>;

/** Cada clave presente REEMPLAZA a la guardada (el panel manda la sección entera). */
export const updatePlatformHelpSchema = z
    .object({
        support: helpSupportSchema,
        videos: platformHelpSchema.shape.videos,
        hidden: platformHelpSchema.shape.hidden,
        custom: platformHelpSchema.shape.custom,
    })
    .partial()
    .strict();
export type UpdatePlatformHelpInput = z.input<typeof updatePlatformHelpSchema>;

/**
 * Lo que recibe cualquier miembro (`GET /help`): no hay secretos, y las guías
 * propias ya vienen filtradas por su rol.
 */
export interface HelpConfigView {
    support: HelpSupport;
    videos: Record<string, string>;
    hidden: string[];
    custom: CustomGuide[];
}

/** Lectura tolerante del valor guardado. */
export function parsePlatformHelp(raw: unknown): PlatformHelp {
    const parsed = platformHelpSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : platformHelpSchema.parse({});
}

/** `+57 300 123-4567` → `573001234567` (para `https://wa.me/…`). */
export function whatsappDigits(phone: string): string {
    return phone.replace(/\D+/g, '');
}

/** Guía propia → el formato común de guía. */
export function customGuideToHelpGuide(g: CustomGuide): HelpGuide {
    return {
        id: g.id,
        title: g.title,
        category: g.category,
        minutes: g.minutes,
        body: g.body,
        screens: g.screens,
        related: [],
        roles: g.roles,
        video_url: g.video_url,
        source: 'custom',
    };
}
