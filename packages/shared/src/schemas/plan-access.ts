import { z } from 'zod';
import type { BillingStatus } from './billing';

/**
 * v0.1.338 (ADR-S87) — Prueba con fecha de fin, cuenta PAUSADA al terminar y
 * módulos que se activan por plan.
 *
 * Tres piezas que viven juntas porque las tres deciden "qué puede hacer esta
 * empresa ahora":
 *  1. La POLÍTICA de la plataforma (`billingPolicySchema`): cuánto dura la
 *     prueba, qué pasa al terminar, cuántos días de gracia tiene un plan que
 *     vence y si después pasa al plan de prueba.
 *  2. El ACCESO de una empresa (`tenantAccess`): completo, sólo lectura o
 *     pausada — una función pura que usan el guard, los procesos que corren
 *     solos, la consola y la app.
 *  3. Los MÓDULOS de un plan (`PLAN_MODULES`): lo que el operador decide que
 *     un plan incluye o no.
 *
 * Regla de oro nº 9 (ADR-S09) intacta: una cuenta pausada no pierde nada y
 * SIEMPRE puede descargar sus datos y pagar.
 */

/** El plan de prueba es el built-in `trial` (no se vende: no tiene precio). */
export const TRIAL_PLAN = 'trial';

// ─────────────────────────── Política ───────────────────────────

export const TRIAL_END_ACTIONS = ['lock', 'read_only'] as const;
export type TrialEndAction = (typeof TRIAL_END_ACTIONS)[number];

export const billingPolicySchema = z.object({
    /**
     * Días de prueba de una empresa NUEVA (registro o alta del operador en el
     * plan de prueba). `null` = la prueba no vence (el comportamiento anterior).
     */
    trial_days: z.number().int().min(1).max(365).nullable(),
    /**
     * Qué pasa cuando termina la prueba o vence un plan sin renovar:
     * `lock` = la cuenta queda PAUSADA (sólo puede elegir un plan, pagar y
     * descargar sus datos); `read_only` = ve todo pero no cambia nada.
     */
    on_end: z.enum(TRIAL_END_ACTIONS),
    /** Días de gracia después de que vence un período PAGADO por la app. */
    grace_days: z.number().int().min(0).max(60),
    /** Pasada la gracia, la empresa que no renovó pasa al plan de prueba. */
    lapse_to_trial: z.boolean(),
    /**
     * Días de prueba que recibe al pasar (0 = queda pausada al toque: ya
     * tuvo su prueba).
     */
    lapse_trial_days: z.number().int().min(0).max(90),
});
export type BillingPolicy = z.infer<typeof billingPolicySchema>;

export const DEFAULT_BILLING_POLICY: BillingPolicy = {
    trial_days: 15,
    on_end: 'lock',
    grace_days: 5,
    lapse_to_trial: true,
    lapse_trial_days: 0,
};

/** Lectura tolerante de lo guardado: un campo raro cae a su valor por defecto. */
export function readBillingPolicy(raw: unknown): BillingPolicy {
    const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const out: BillingPolicy = { ...DEFAULT_BILLING_POLICY };
    for (const key of Object.keys(DEFAULT_BILLING_POLICY) as (keyof BillingPolicy)[]) {
        if (!(key in src)) continue;
        const one = billingPolicySchema.shape[key].safeParse(src[key]);
        if (one.success) (out as Record<string, unknown>)[key] = one.data;
    }
    return out;
}

export const updateBillingPolicySchema = billingPolicySchema.partial();
export type UpdateBillingPolicyInput = z.infer<typeof updateBillingPolicySchema>;

// ─────────────────────────── Acceso ───────────────────────────

export const ACCESS_STATES = ['full', 'read_only', 'locked'] as const;
export type AccessState = (typeof ACCESS_STATES)[number];

/**
 * Por qué una empresa no tiene acceso completo:
 * - `archived`: la archivó el operador.
 * - `suspended`: estado de cobro no habilitado (la suspendió el operador o el
 *   proveedor de pago la marcó impaga).
 * - `trial_ended`: terminó su prueba.
 * - `plan_expired`: venció su plan (período pagado + gracia, o la fecha manual
 *   del operador).
 */
export const ACCESS_REASONS = ['archived', 'suspended', 'trial_ended', 'plan_expired'] as const;
export type AccessReason = (typeof ACCESS_REASONS)[number];

export const tenantAccessSchema = z.object({
    state: z.enum(ACCESS_STATES),
    reason: z.enum(ACCESS_REASONS).nullable(),
    /**
     * Cuándo termina (o terminó) el acceso: fin de la prueba, o vencimiento +
     * gracia de un plan pagado. `null` = no vence.
     */
    ends_at: z.string().nullable(),
    /** La empresa está en el plan de prueba. */
    trial: z.boolean(),
});
export type TenantAccess = z.infer<typeof tenantAccessSchema>;

export interface TenantAccessInput {
    plan: string;
    status: BillingStatus | string;
    archived_at?: string | Date | null;
    trial_ends_at?: string | Date | null;
    subscription_ends_at?: string | Date | null;
    paid_until?: string | Date | null;
    now?: Date;
}

const DAY = 24 * 60 * 60 * 1000;

function asTime(v: string | Date | null | undefined): number | null {
    if (!v) return null;
    const t = (v instanceof Date ? v : new Date(v)).getTime();
    return Number.isNaN(t) ? null : t;
}

/** Desde cuándo un período pagado deja de dar acceso (vencimiento + gracia). */
export function paidCutAt(paidUntil: string | Date, graceDays: number): Date {
    const d = paidUntil instanceof Date ? paidUntil : new Date(paidUntil);
    return new Date(d.getTime() + graceDays * DAY);
}

/**
 * El acceso EFECTIVO de una empresa. Una sola fuente de verdad (ver arriba).
 *
 * - Archivada o con un estado de cobro no habilitado → sólo lectura (lo
 *   decide el operador o el proveedor, no el reloj).
 * - En el plan de prueba manda `trial_ends_at` (y la fecha manual del
 *   operador si la puso): el período pagado no aplica a una prueba.
 * - En un plan pagado mandan el vencimiento + gracia y la fecha manual
 *   (corte exacto, sin gracia).
 * - Al terminar, `policy.on_end` decide: pausada o sólo lectura.
 */
export function tenantAccess(input: TenantAccessInput, policy: Pick<BillingPolicy, 'on_end' | 'grace_days'>): TenantAccess {
    const trial = input.plan === TRIAL_PLAN;
    const now = (input.now ?? new Date()).getTime();
    const manual = asTime(input.subscription_ends_at);
    let endsAt: number | null;
    if (trial) {
        const t = asTime(input.trial_ends_at);
        endsAt = t === null ? manual : manual === null ? t : Math.min(t, manual);
    } else {
        const paid = asTime(input.paid_until);
        const cut = paid === null ? null : paid + policy.grace_days * DAY;
        endsAt = cut === null ? manual : manual === null ? cut : Math.min(cut, manual);
    }
    const ends_at = endsAt === null ? null : new Date(endsAt).toISOString();
    if (input.archived_at) return { state: 'read_only', reason: 'archived', ends_at, trial };
    if (input.status !== 'trialing' && input.status !== 'active') {
        return { state: 'read_only', reason: 'suspended', ends_at, trial };
    }
    if (endsAt !== null && endsAt <= now) {
        return {
            state: policy.on_end === 'lock' ? 'locked' : 'read_only',
            reason: trial ? 'trial_ended' : 'plan_expired',
            ends_at,
            trial,
        };
    }
    return { state: 'full', reason: null, ends_at, trial };
}

/** Días que faltan para `ends_at` (redondeado hacia arriba; 0 si ya pasó). */
export function daysLeft(endsAt: string | null, now = new Date()): number | null {
    const t = asTime(endsAt);
    if (t === null) return null;
    return Math.max(0, Math.ceil((t - now.getTime()) / DAY));
}

// ─────────────────────────── Módulos ───────────────────────────

/**
 * Lo que un plan puede incluir o no. Cada clave tiene su puerta en el API
 * (los endpoints de ese módulo responden 403 `plan_module_disabled`), en lo
 * que corre solo (no se ejecuta) y en lo público (no se sirve), y en la app
 * se ve con candado y "Tu plan no incluye…". Lo configurado NO se borra:
 * al pasar a un plan que lo incluye, vuelve tal cual estaba.
 *
 * Se guardan los DESACTIVADOS (`plans.disabled_modules`): un módulo nuevo de
 * una versión futura queda incluido en todos los planes hasta que el
 * operador diga lo contrario (nada desaparece en una actualización).
 */
export const PLAN_MODULES = [
    'automations',
    'ai',
    'integrations',
    'woocommerce',
    'wordpress',
    'sql',
    'portal',
    'forms',
    'booking',
    'helpdesk',
    'documents',
    'public_sharing',
    'api',
    'custom_domain',
    'custom_roles',
] as const;
export type PlanModule = (typeof PLAN_MODULES)[number];
export const planModuleSchema = z.enum(PLAN_MODULES);

export interface PlanModuleInfo {
    key: PlanModule;
    label: string;
    description: string;
    group: 'work' | 'connect' | 'share' | 'admin';
}

export const PLAN_MODULE_GROUPS: Record<PlanModuleInfo['group'], string> = {
    work: 'Trabajo',
    connect: 'Conectar con otras apps',
    share: 'Hacia afuera',
    admin: 'Administración',
};

export const PLAN_MODULE_CATALOG: readonly PlanModuleInfo[] = [
    { key: 'automations', group: 'work', label: 'Automatizaciones', description: 'Reglas que trabajan solas: correos, avisos, cambios de campos, esperas.' },
    { key: 'ai', group: 'work', label: 'Inteligencia artificial', description: 'Asistente, campos con IA y agentes de IA.' },
    { key: 'documents', group: 'work', label: 'Documentos PDF', description: 'Cotizaciones, cuentas de cobro y facturas en PDF.' },
    { key: 'helpdesk', group: 'work', label: 'Mesa de ayuda por correo', description: 'Un buzón que convierte cada correo en un ticket, con SLA.' },
    { key: 'integrations', group: 'connect', label: 'Integraciones', description: 'Apps conectadas: WhatsApp, SMS, Gmail, Slack, cobros y API personalizada.' },
    { key: 'woocommerce', group: 'connect', label: 'Tienda WooCommerce', description: 'Productos, pedidos y clientes de la tienda sincronizados.' },
    { key: 'wordpress', group: 'connect', label: 'Sitio WordPress', description: 'Entradas, páginas, SEO y medios del sitio en listas.' },
    { key: 'sql', group: 'connect', label: 'Bases de datos SQL', description: 'Sincronizar consultas de SQL Server con una lista.' },
    { key: 'api', group: 'connect', label: 'API y conexión con Claude', description: 'Tokens de acceso y servidor MCP.' },
    { key: 'portal', group: 'share', label: 'Portal del cliente', description: 'Un acceso para que tus clientes vean y editen lo suyo.' },
    { key: 'forms', group: 'share', label: 'Formularios públicos', description: 'Formularios que crean registros desde un enlace o tu sitio.' },
    { key: 'booking', group: 'share', label: 'Agenda de citas', description: 'Una página para que tus clientes reserven horarios.' },
    { key: 'public_sharing', group: 'share', label: 'Enlaces públicos', description: 'Publicar listas y tableros con un enlace o insertados en un sitio.' },
    { key: 'custom_domain', group: 'admin', label: 'Dominio propio', description: 'Entrar a la app y al portal con el dominio de la empresa.' },
    { key: 'custom_roles', group: 'admin', label: 'Roles propios', description: 'Roles con permisos a medida además de los cuatro fijos.' },
];

export function planModuleLabel(key: PlanModule): string {
    return PLAN_MODULE_CATALOG.find((m) => m.key === key)?.label ?? key;
}

/** Lectura tolerante de `plans.disabled_modules`: sólo claves conocidas, sin repetidos. */
export function readDisabledModules(raw: unknown): PlanModule[] {
    if (!Array.isArray(raw)) return [];
    const known = new Set<string>(PLAN_MODULES);
    return [...new Set(raw.filter((k): k is PlanModule => typeof k === 'string' && known.has(k)))];
}

export const disabledModulesSchema = z.array(planModuleSchema).max(PLAN_MODULES.length);
