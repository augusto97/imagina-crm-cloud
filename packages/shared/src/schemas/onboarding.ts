import { z } from 'zod';
import { idSchema } from './common';
import type { ListBlueprint, BlueprintList } from './list-template';
import { collectAutomationSlugs } from './templates';

/**
 * Fase 7, entrega 1 — «Empezar fácil» (ADR-S72).
 *
 * Tres piezas que comparten estos tipos:
 *  1. La BIENVENIDA de una empresa nueva: «Cuéntanos de tu negocio» (la IA
 *     arma una propuesta con el mismo blueprint de las plantillas), «Elegir
 *     por tipo de negocio» (plantillas del sistema combinables) o en blanco.
 *  2. Los DATOS DE EJEMPLO que esa bienvenida deja, que se borran con un clic.
 *  3. «PRIMEROS PASOS»: la lista de pasos de cada persona, que se marcan solos
 *     con datos reales.
 *
 * Lo que una empresa escribe en «Cuéntanos de tu negocio» es DATO para el
 * modelo, nunca instrucciones (mismo criterio que los campos con IA).
 */

// ── «Cuéntanos de tu negocio» ───────────────────────────────────────────────

/** Qué quiere organizar primero (chips opcionales del formulario). */
export const ONBOARDING_FOCUS_AREAS = ['clientes_ventas', 'proyectos_tareas', 'soporte', 'inventario', 'citas', 'facturacion'] as const;
export type OnboardingFocusArea = (typeof ONBOARDING_FOCUS_AREAS)[number];
export const ONBOARDING_FOCUS_LABELS: Record<OnboardingFocusArea, string> = {
    clientes_ventas: 'Clientes y ventas',
    proyectos_tareas: 'Proyectos y tareas',
    soporte: 'Soporte',
    inventario: 'Inventario',
    citas: 'Citas',
    facturacion: 'Facturación y cobros',
};

export const ONBOARDING_TEAM_SIZES = ['solo', 'small', 'medium', 'large'] as const;
export type OnboardingTeamSize = (typeof ONBOARDING_TEAM_SIZES)[number];
export const ONBOARDING_TEAM_SIZE_LABELS: Record<OnboardingTeamSize, string> = {
    solo: 'Sólo yo',
    small: '2 a 10 personas',
    medium: '11 a 50 personas',
    large: 'Más de 50',
};

/** Ejemplos clicables del cuadro de texto. */
export const ONBOARDING_EXAMPLES: readonly string[] = [
    'Agencia de marketing con clientes que pagan cada mes',
    'Clínica dental con citas y tratamientos',
    'Tienda online con inventario y pedidos',
    'Constructora con obras, proveedores y avances',
    'Academia con estudiantes, cursos y pagos',
    'Soporte técnico con tickets y tiempos de respuesta',
];

export const ONBOARDING_DESCRIPTION_MAX = 1500;

/** `POST /onboarding/ai/proposals` — armar una propuesta con IA. */
export const onboardingAiRequestSchema = z.object({
    description: z.string().trim().min(10, 'Cuéntanos un poco más (al menos 10 letras).').max(ONBOARDING_DESCRIPTION_MAX),
    focus: z.array(z.enum(ONBOARDING_FOCUS_AREAS)).max(ONBOARDING_FOCUS_AREAS.length).default([]),
    team_size: z.enum(ONBOARDING_TEAM_SIZES).optional(),
    /**
     * Consentimiento EN LÍNEA de este pedido único: lo que se escribe viaja al
     * proveedor de IA aunque la empresa no haya activado el asistente
     * (ADR-S21 exige opt-in para el asistente; esto no lo activa).
     */
    consent: z.literal(true, { errorMap: () => ({ message: 'Hace falta tu consentimiento para enviar la descripción.' }) }),
});
export type OnboardingAiRequest = z.infer<typeof onboardingAiRequestSchema>;

/** Si la opción con IA se puede usar ahora (y por qué no). */
export interface OnboardingAiStatus {
    available: boolean;
    /** Motivo legible en una línea cuando no está disponible. */
    reason: string | null;
    /** `platform` gasta un pedido de la cuota del plan; `tenant` usa la clave propia. */
    source: 'platform' | 'tenant' | null;
    /** La empresa ya tiene listas: el texto del consentimiento menciona que viajan sus nombres. */
    has_lists: boolean;
}

export type OnboardingJobStage = 'thinking' | 'checking' | 'fixing';

/** Una propuesta lista para revisar (el blueprint completo, para la vista previa). */
export interface OnboardingProposal {
    business_name: string;
    summary: string;
    blueprint: ListBlueprint;
}

/** Estado de un pedido a la IA (se consulta mientras trabaja). */
export interface OnboardingAiJob {
    id: string;
    state: 'running' | 'done' | 'error' | 'applied';
    stage: OnboardingJobStage | null;
    proposal: OnboardingProposal | null;
    error: { code: string; message: string } | null;
}

// ── Aplicar ─────────────────────────────────────────────────────────────────

/** Lo que la persona quitó o cambió en la vista previa. */
export const blueprintEditsSchema = z.object({
    /** Keys de listas que no se crean. */
    exclude_lists: z.array(z.string().min(1).max(63)).max(20).default([]),
    /** key de la lista → slugs de campos que no se crean. */
    exclude_fields: z.record(z.array(z.string().min(1).max(63)).max(100)).default({}),
    /** key de la lista → índices de sus vistas que no se crean. */
    exclude_views: z.record(z.array(z.number().int().min(0).max(50)).max(50)).default({}),
    /** key de la lista → índices de sus automatizaciones que no se crean. */
    exclude_automations: z.record(z.array(z.number().int().min(0).max(50)).max(50)).default({}),
    /** Índices de los tableros que no se crean. */
    exclude_dashboards: z.array(z.number().int().min(0).max(20)).max(20).default([]),
    /** key de la lista → nombre nuevo. */
    rename_lists: z.record(z.string().trim().min(1).max(190)).default({}),
});
export type BlueprintEdits = z.infer<typeof blueprintEditsSchema>;

const folderNameSchema = z.string().trim().min(1).max(190);

/** Plantillas del sistema (`sys:<key>`): las únicas que se combinan en la bienvenida. */
export const systemTemplateIdSchema = z.string().regex(/^sys:[a-z0-9-]{1,63}$/);

export const onboardingApplySchema = z.discriminatedUnion('source', [
    z.object({
        source: z.literal('ai'),
        proposal_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
        folder_name: folderNameSchema.optional(),
        include_samples: z.boolean().default(true),
        edits: blueprintEditsSchema.default({}),
    }),
    z.object({
        source: z.literal('templates'),
        template_ids: z.array(systemTemplateIdSchema).min(1).max(6),
        folder_name: folderNameSchema.optional(),
        include_samples: z.boolean().default(true),
    }),
]);
export type OnboardingApplyInput = z.infer<typeof onboardingApplySchema>;

export interface OnboardingApplyResult {
    lists: Array<{ id: number; slug: string; name: string }>;
    dashboard_ids: number[];
    group_id: number | null;
    /** Cuántos registros de ejemplo quedaron. */
    samples: number;
    warnings: string[];
}

// ── Datos de ejemplo ────────────────────────────────────────────────────────

export const onboardingSamplesDeleteSchema = z.object({
    /** Sin lista: los de TODAS las listas. */
    list_id: idSchema.optional(),
});
export type OnboardingSamplesDeleteInput = z.infer<typeof onboardingSamplesDeleteSchema>;

/** Lo que dejó un borrado de ejemplos, para «Deshacer». */
export const onboardingSampleEditSchema = z.object({ list_id: idSchema, edit_id: idSchema });
export type OnboardingSampleEdit = z.infer<typeof onboardingSampleEditSchema>;

export interface OnboardingSamplesDeleteResult {
    deleted: number;
    edits: OnboardingSampleEdit[];
}

export const onboardingSamplesRestoreSchema = z.object({
    edits: z.array(onboardingSampleEditSchema).min(1).max(30),
});
export type OnboardingSamplesRestoreInput = z.infer<typeof onboardingSamplesRestoreSchema>;

// ── «Primeros pasos» ────────────────────────────────────────────────────────

export const ONBOARDING_STEP_IDS = [
    // Admin
    'create_list',
    'add_records',
    'create_view',
    'invite_team',
    'automation',
    'branding',
    'company_mail',
    'install_app',
    'assistant',
    // Resto del equipo
    'comment_record',
    'my_work',
    'save_view',
] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

/** Los pasos de quien administra la empresa, en orden. */
export const ONBOARDING_ADMIN_STEPS: readonly OnboardingStepId[] = [
    'create_list',
    'add_records',
    'create_view',
    'invite_team',
    'automation',
    'branding',
    'company_mail',
    'install_app',
    'assistant',
];
/** Los pasos del resto del equipo. */
export const ONBOARDING_TEAM_STEPS: readonly OnboardingStepId[] = ['comment_record', 'my_work', 'save_view', 'install_app'];

/**
 * Lo que se guarda por persona y empresa en `memberships.settings.onboarding`.
 * Todo tolerante: un valor raro nunca rompe el resto.
 */
export const onboardingPrefsSchema = z.object({
    /** «Ocultar primeros pasos» (se vuelve desde el menú de la persona). */
    hidden: z.boolean().catch(false).default(false),
    /** Pasos que la persona decidió saltar. */
    skipped: z.array(z.enum(ONBOARDING_STEP_IDS)).catch([]).default([]),
    /** Pasos que se marcaron por algo que la persona HIZO y no deja datos (abrir «Mi trabajo»). */
    marks: z.array(z.enum(ONBOARDING_STEP_IDS)).catch([]).default([]),
    /** Ya se celebró que terminó todo (y el widget se ocultó solo). */
    celebrated: z.boolean().catch(false).default(false),
    /** Eligió «Empezar en blanco»: la bienvenida no vuelve a ocupar el índice. */
    welcome_dismissed: z.boolean().catch(false).default(false),
});
export type OnboardingPrefs = z.infer<typeof onboardingPrefsSchema>;

/** `PATCH /onboarding` — cambios PARCIALES (se mezclan con lo guardado). */
export const onboardingPrefsPatchSchema = z
    .object({
        hidden: z.boolean(),
        skip: z.enum(ONBOARDING_STEP_IDS),
        unskip: z.enum(ONBOARDING_STEP_IDS),
        /** Sólo los pasos que no dejan datos se pueden marcar a mano. */
        mark: z.enum(['my_work', 'install_app']),
        celebrated: z.boolean(),
        welcome_dismissed: z.boolean(),
    })
    .partial();
export type OnboardingPrefsPatch = z.infer<typeof onboardingPrefsPatchSchema>;

export interface OnboardingStep {
    id: OnboardingStepId;
    done: boolean;
    skipped: boolean;
}

/** `GET /onboarding` — lo que «Primeros pasos» y la bienvenida necesitan. */
export interface OnboardingStatus {
    /** Qué lista de pasos ve esta persona (`none`: invitados, clientes). */
    audience: 'admin' | 'team' | 'none';
    steps: OnboardingStep[];
    prefs: OnboardingPrefs;
    /** Todos los pasos hechos o saltados. */
    complete: boolean;
    /** La empresa tiene listas (en la papelera no cuentan). */
    has_lists: boolean;
    /** Una lista para llevar a la persona («Hacerlo»): la más reciente. */
    first_list: { id: number; slug: string; name: string } | null;
    /** La bienvenida ocupa el índice de listas: sin listas, puede crearlas y no la descartó. */
    welcome: boolean;
    /** Datos de ejemplo que todavía quedan, por lista. */
    samples: Array<{ list_id: number; list_slug: string; list_name: string; count: number }>;
    /** Automatizaciones que creó la bienvenida (no cuentan como «tu» automatización). */
    seeded_automations: number;
    /** El asistente IA se puede usar o activar en esta empresa. */
    assistant_possible: boolean;
    /** Nombre de quien administra (para «Pídele a … que cree la primera lista»). */
    admin_name: string | null;
}

// ── Tipos de negocio (camino 2) ─────────────────────────────────────────────

export interface OnboardingBusinessType {
    id: string;
    label: string;
    description: string;
    /** Clave del catálogo de iconos de listas. */
    icon: string;
    color: string;
    /** Plantillas del sistema (`key` sin el prefijo `sys:`), en orden de utilidad. */
    templates: readonly string[];
}

export const ONBOARDING_BUSINESS_TYPES: readonly OnboardingBusinessType[] = [
    {
        id: 'servicios',
        label: 'Servicios y agencias',
        description: 'Clientes que pagan cada mes, proyectos y contratos.',
        icon: 'briefcase',
        color: '#0ea5e9',
        templates: ['crm-clientes', 'proyectos-tareas', 'facturacion', 'contratos-suscripciones', 'calendario-contenidos'],
    },
    {
        id: 'ventas',
        label: 'Ventas',
        description: 'Prospectos, oportunidades y seguimiento comercial.',
        icon: 'target',
        color: '#a855f7',
        templates: ['pipeline-ventas', 'crm-clientes', 'contactos-whatsapp', 'inmuebles'],
    },
    {
        id: 'proyectos',
        label: 'Proyectos',
        description: 'Tareas, entregas, objetivos y errores por resolver.',
        icon: 'kanban',
        color: '#eab308',
        templates: ['proyectos-tareas', 'okrs', 'incidencias-bugs', 'calendario-contenidos'],
    },
    {
        id: 'soporte',
        label: 'Soporte',
        description: 'Tickets, incidencias y conversaciones con clientes.',
        icon: 'headset',
        color: '#f97316',
        templates: ['soporte-tickets', 'incidencias-bugs', 'contactos-whatsapp'],
    },
    {
        id: 'comercio',
        label: 'Comercio',
        description: 'Inventario, proveedores, compras y gastos.',
        icon: 'storefront',
        color: '#14b8a6',
        templates: ['inventario', 'proveedores-compras', 'gastos', 'facturacion'],
    },
    {
        id: 'salud',
        label: 'Salud y citas',
        description: 'Pacientes o clientes, agenda y cobros.',
        icon: 'stethoscope',
        color: '#ec4899',
        templates: ['agenda-citas', 'crm-clientes', 'facturacion'],
    },
    {
        id: 'personas',
        label: 'Recursos humanos',
        description: 'Vacantes, candidatos y equipos de la empresa.',
        icon: 'users_three',
        color: '#22c55e',
        templates: ['reclutamiento', 'activos-equipos', 'okrs'],
    },
    {
        id: 'eventos',
        label: 'Eventos',
        description: 'Eventos, invitados y contenidos.',
        icon: 'confetti',
        color: '#f43f5e',
        templates: ['eventos', 'calendario-contenidos', 'gastos'],
    },
];

/**
 * Iconos del catálogo que se le ofrecen a la IA (las claves existen en el
 * catálogo de listas; una clave fuera de esta lista se descarta).
 */
export const ONBOARDING_ICON_KEYS: readonly string[] = [
    'users', 'user', 'users_three', 'building', 'building_office', 'briefcase', 'receipt', 'invoice', 'wallet', 'money',
    'coins', 'credit_card', 'calendar', 'calendar_check', 'clock', 'target', 'flag', 'rocket', 'kanban', 'check_square',
    'clipboard', 'list_checks', 'headset', 'lifebuoy', 'chat', 'mail', 'phone', 'whatsapp', 'package', 'boxes', 'truck',
    'storefront', 'shopping_cart', 'tag', 'ticket', 'star', 'heart', 'stethoscope', 'tooth', 'first_aid', 'graduation_cap',
    'student', 'home', 'house_line', 'warehouse', 'factory', 'chart_bar', 'megaphone', 'handshake', 'contract', 'certificate',
    'file_text', 'gear', 'wrench', 'toolbox', 'bug', 'lightbulb', 'trophy', 'confetti', 'map_pin', 'car', 'fork_knife',
    'paw_print', 'scales', 'percent', 'note', 'book', 'camera', 'palette', 'globe',
];

// ── Quitar lo que la persona no quiere (puro, front y back) ─────────────────

export interface PruneReport {
    /** Lo que se quitó por arrastre (no lo eligió la persona: dependía de algo quitado). */
    fields: Array<{ list: string; slug: string; label: string }>;
    views: Array<{ list: string; name: string }>;
    automations: Array<{ list: string; name: string }>;
    dashboards: string[];
    /** Widgets quitados de los tableros que quedan. */
    widgets: number;
}

function isPlain(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Todos los tokens de campo `{ $field, $list? }` de un valor, resueltos a «key:slug». */
function fieldTokenRefs(value: unknown, ownKey: string): Set<string> {
    const out = new Set<string>();
    const walk = (v: unknown): void => {
        if (Array.isArray(v)) {
            for (const item of v) walk(item);
            return;
        }
        if (!isPlain(v)) return;
        if (typeof v.$field === 'string') {
            const list = typeof v.$list === 'string' ? v.$list : ownKey;
            const keys = Object.keys(v).length;
            if (keys === 1 || (keys === 2 && typeof v.$list === 'string')) {
                out.add(`${list}:${v.$field}`);
                return;
            }
        }
        for (const inner of Object.values(v)) walk(inner);
    };
    walk(value);
    return out;
}

/** Keys de listas del pack referenciadas con `{ $list }` (sin `$field`). */
function listTokenRefs(value: unknown): Set<string> {
    const out = new Set<string>();
    const walk = (v: unknown): void => {
        if (Array.isArray(v)) {
            for (const item of v) walk(item);
            return;
        }
        if (!isPlain(v)) return;
        if (typeof v.$list === 'string' && Object.keys(v).length === 1) {
            out.add(v.$list);
            return;
        }
        for (const inner of Object.values(v)) walk(inner);
    };
    walk(value);
    return out;
}

/** `{@slug}` de una fórmula de plantilla. */
function formulaSlugs(formula: unknown): string[] {
    if (typeof formula !== 'string') return [];
    return [...formula.matchAll(/\{@([a-z][a-z0-9_]*)\}/g)].map((m) => m[1]!);
}

/** Acciones `create_record` (también anidadas): lista destino → claves de `values`. */
function createRecordTargets(actions: unknown): Array<{ list: string | null; slugs: string[] }> {
    const out: Array<{ list: string | null; slugs: string[] }> = [];
    const walk = (v: unknown): void => {
        if (Array.isArray(v)) {
            for (const item of v) walk(item);
            return;
        }
        if (!isPlain(v)) return;
        if (v.type === 'create_record' && isPlain(v.config)) {
            const cfg = v.config;
            const target = cfg.target_list ?? cfg.list_id;
            const list = isPlain(target) && typeof target.$list === 'string' ? target.$list : null;
            out.push({ list, slugs: isPlain(cfg.values) ? Object.keys(cfg.values) : [] });
        }
        for (const inner of Object.values(v)) walk(inner);
    };
    walk(actions);
    return out;
}

/**
 * Aplica a un blueprint lo que la persona quitó en la vista previa y quita
 * EN CASCADA lo que dependía de eso: una relación hacia una lista quitada, un
 * lookup/rollup sobre un campo quitado, una vista agrupada por él, una
 * automatización que lo usa, un widget que lo grafica. La vista previa usa la
 * MISMA función para mostrar qué más se va (y el servidor, para crear).
 */
export function pruneBlueprint(source: ListBlueprint, edits: Partial<BlueprintEdits>): { blueprint: ListBlueprint; report: PruneReport } {
    const report: PruneReport = { fields: [], views: [], automations: [], dashboards: [], widgets: 0 };
    const excludedLists = new Set(edits.exclude_lists ?? []);
    const removedLists = new Set(source.lists.filter((l) => excludedLists.has(l.key)).map((l) => l.key));
    const lists: BlueprintList[] = source.lists.filter((l) => !removedLists.has(l.key)).map((l) => ({ ...l, fields: [...l.fields] }));

    // «key:slug» de cada campo quitado (los de las listas quitadas también).
    const removed = new Set<string>();
    for (const l of source.lists) {
        if (removedLists.has(l.key)) for (const f of l.fields) removed.add(`${l.key}:${f.slug}`);
    }
    for (const l of lists) {
        const chosen = new Set(edits.exclude_fields?.[l.key] ?? []);
        for (const f of l.fields) if (chosen.has(f.slug)) removed.add(`${l.key}:${f.slug}`);
    }

    // Cascada hasta que no cambie nada (un rollup sobre una relación quitada…).
    const explicit = new Set(removed);
    for (let changed = true; changed; ) {
        changed = false;
        for (const l of lists) {
            for (const f of l.fields) {
                const id = `${l.key}:${f.slug}`;
                if (removed.has(id)) continue;
                const deadList = [...listTokenRefs(f.config)].some((k) => removedLists.has(k));
                const deadField = [...fieldTokenRefs(f.config, l.key)].some((r) => removed.has(r));
                const deadFormula = f.type === 'formula' && formulaSlugs((f.config as { formula?: unknown }).formula).some((s) => removed.has(`${l.key}:${s}`));
                if (deadList || deadField || deadFormula) {
                    removed.add(id);
                    changed = true;
                }
            }
        }
    }
    for (const l of lists) {
        for (const f of l.fields) {
            const id = `${l.key}:${f.slug}`;
            if (removed.has(id) && !explicit.has(id)) report.fields.push({ list: l.key, slug: f.slug, label: f.label });
        }
    }

    const isDead = (value: unknown, ownKey: string): boolean =>
        [...fieldTokenRefs(value, ownKey)].some((r) => removed.has(r)) || [...listTokenRefs(value)].some((k) => removedLists.has(k));

    const out: BlueprintList[] = lists.map((l) => {
        const ownRemoved = (slug: string): boolean => removed.has(`${l.key}:${slug}`);
        const fields = l.fields.filter((f) => !ownRemoved(f.slug));

        const settings: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(l.settings)) if (!isDead(v, l.key)) settings[k] = v;

        const exViews = new Set(edits.exclude_views?.[l.key] ?? []);
        const views = l.views.filter((v, i) => {
            if (exViews.has(i)) return false;
            if (isDead(v.config, l.key)) {
                report.views.push({ list: l.key, name: v.name });
                return false;
            }
            return true;
        });

        const exAutos = new Set(edits.exclude_automations?.[l.key] ?? []);
        const automations = l.automations.filter((a, i) => {
            if (exAutos.has(i)) return false;
            const usesRemoved =
                collectAutomationSlugs({ trigger_config: a.trigger_config, actions: a.actions }).some((s) => ownRemoved(s))
                || isDead(a.trigger_config, l.key)
                || isDead(a.actions, l.key)
                || createRecordTargets(a.actions).some(
                    (t) => t.list !== null && (removedLists.has(t.list) || t.slugs.some((s) => removed.has(`${t.list}:${s}`))),
                );
            if (usesRemoved) {
                report.automations.push({ list: l.key, name: a.name });
                return false;
            }
            return true;
        });

        const fieldBySlug = new Map(fields.map((f) => [f.slug, f]));
        const records = l.records.map((r) => {
            const data: Record<string, unknown> = {};
            for (const [slug, v] of Object.entries(r.data)) if (fieldBySlug.has(slug)) data[slug] = v;
            const next = { ...r, data };
            if (r.relations) {
                const rel: Record<string, Array<string | number>> = {};
                for (const [slug, targets] of Object.entries(r.relations)) if (fieldBySlug.get(slug)?.type === 'relation') rel[slug] = targets;
                if (Object.keys(rel).length > 0) next.relations = rel;
                else delete next.relations;
            }
            return next;
        });

        const rename = edits.rename_lists?.[l.key]?.trim();
        return { ...l, name: rename ? rename.slice(0, 190) : l.name, fields, settings, views, automations, records };
    });

    const exDash = new Set(edits.exclude_dashboards ?? []);
    const dashboards = source.dashboards.flatMap((d, i) => {
        if (exDash.has(i)) return [];
        const widgets = d.widgets.filter((w) => {
            if (w.list === 0) return true;
            const key = w.list.$list;
            const dead = removedLists.has(key) || isDead(w.config, key);
            if (dead) report.widgets += 1;
            return !dead;
        });
        if (!widgets.some((w) => w.list !== 0)) {
            report.dashboards.push(d.name);
            return [];
        }
        return [{ ...d, widgets }];
    });

    return { blueprint: { ...source, lists: out, dashboards }, report };
}

// ── Combinar plantillas (camino 2) ──────────────────────────────────────────

function renameListTokens(value: unknown, map: ReadonlyMap<string, string>): unknown {
    if (Array.isArray(value)) return value.map((v) => renameListTokens(v, map));
    if (!isPlain(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
        out[k] = k === '$list' && typeof v === 'string' ? map.get(v) ?? v : renameListTokens(v, map);
    }
    return out;
}

/**
 * Junta varias plantillas en UN blueprint. Las keys de lista que chocan se
 * renombran (y con ellas cada `$list` de esa plantilla); los NOMBRES
 * repetidos («Clientes» en el CRM y en Facturación) se distinguen con el de
 * la plantilla, así no quedan dos listas iguales en el menú.
 */
export function combineBlueprints(parts: Array<{ name: string; blueprint: ListBlueprint }>): ListBlueprint {
    const usedKeys = new Set<string>();
    const usedNames = new Set<string>();
    const lists: BlueprintList[] = [];
    const dashboards: ListBlueprint['dashboards'] = [];
    for (const part of parts) {
        const map = new Map<string, string>();
        for (const l of part.blueprint.lists) {
            let key = l.key;
            for (let i = 2; usedKeys.has(key); i++) key = `${l.key}_${i}`.slice(0, 63);
            usedKeys.add(key);
            map.set(l.key, key);
        }
        for (const l of part.blueprint.lists) {
            const renamed = renameListTokens(l, map) as BlueprintList;
            const norm = l.name.trim().toLowerCase();
            const name = usedNames.has(norm) ? `${l.name} · ${part.name}`.slice(0, 190) : l.name;
            usedNames.add(name.trim().toLowerCase());
            lists.push({ ...renamed, key: map.get(l.key)!, name });
        }
        for (const d of part.blueprint.dashboards) dashboards.push(renameListTokens(d, map) as ListBlueprint['dashboards'][number]);
    }
    return { version: parts[0]?.blueprint.version ?? 1, lists, dashboards } as ListBlueprint;
}
