import { z } from 'zod';

import { INTEGRATION_KEYS, type IntegrationKey } from './integration-keys';

/**
 * v0.1.438 — Qué apps de la galería se ofrecen a las empresas y con qué
 * marca, decidido por el operador en Plataforma → Integraciones.
 *
 *  · BETA: la integración está hecha y probada contra la documentación y un
 *    proveedor simulado, pero todavía nadie la usó con una cuenta real. La
 *    galería lo dice para que nadie la tome por probada.
 *  · OCULTA: no se ofrece para conectar una NUEVA (las conexiones que ya
 *    existen siguen funcionando y se pueden actualizar). Sirve para mostrar
 *    sólo uno o dos proveedores de SMS, o para no ofrecer una versión vieja.
 *  · EN RETIRO: la versión anterior de algo que tiene reemplazo; la galería y
 *    la conexión llevan a la herramienta que pasa las automatizaciones.
 *
 * Lo que guarda el operador son sólo las DIFERENCIAS con lo de fábrica, así
 * una versión que cambia un valor de fábrica (una integración ya probada deja
 * de ser beta) llega a todos los servidores sin pisar lo que se eligió a mano.
 */

export type IntegrationStage = 'stable' | 'beta' | 'retiring';

/** De fábrica en beta: sin usar todavía con una cuenta real del proveedor. */
export const INTEGRATION_DEFAULT_BETA: readonly IntegrationKey[] = [
    'whatsapp_cloud',
    'telegram',
    'sms_twilio',
    'sms_bulkgate',
    'sms_infobip',
    'sms_labsmobile',
    'sms_onurix',
    'slack',
    'google_calendar',
    'wompi',
    'paypal',
];

/**
 * De fábrica ocultas: tres de los cinco proveedores de SMS (con dos alcanza
 * para elegir: uno global y uno de Colombia) y la versión anterior de WAS.
 */
export const INTEGRATION_DEFAULT_HIDDEN: readonly IntegrationKey[] = ['whatsapp', 'sms_bulkgate', 'sms_infobip', 'sms_labsmobile'];

/** Las que se retiran, con su reemplazo. */
export const INTEGRATION_RETIRING: Partial<Record<IntegrationKey, { replacement: IntegrationKey }>> = {
    whatsapp: { replacement: 'whatsapp_web' },
};

export const integrationOverrideSchema = z.object({
    hidden: z.boolean().optional(),
    beta: z.boolean().optional(),
});
export type IntegrationOverride = z.infer<typeof integrationOverrideSchema>;
export type IntegrationOverrides = Partial<Record<IntegrationKey, IntegrationOverride>>;

/** Lo guardado en Redis, leído con tolerancia: una clave desconocida o un valor raro se ignoran. */
export function readIntegrationOverrides(raw: unknown): IntegrationOverrides {
    if (!raw || typeof raw !== 'object') return {};
    const src = (raw as { overrides?: unknown }).overrides;
    if (!src || typeof src !== 'object') return {};
    const out: IntegrationOverrides = {};
    for (const [key, value] of Object.entries(src as Record<string, unknown>)) {
        if (!(INTEGRATION_KEYS as readonly string[]).includes(key)) continue;
        const parsed = integrationOverrideSchema.safeParse(value);
        if (!parsed.success) continue;
        const clean: IntegrationOverride = {};
        if (parsed.data.hidden !== undefined) clean.hidden = parsed.data.hidden;
        if (parsed.data.beta !== undefined) clean.beta = parsed.data.beta;
        if (Object.keys(clean).length > 0) out[key as IntegrationKey] = clean;
    }
    return out;
}

export interface IntegrationPolicy {
    stage: IntegrationStage;
    hidden: boolean;
}

export const integrationPolicySchema = z.object({
    stage: z.enum(['stable', 'beta', 'retiring']),
    hidden: z.boolean(),
});

/** La política vigente de una app: lo de fábrica con lo que eligió el operador encima. */
export function integrationPolicy(key: IntegrationKey, overrides: IntegrationOverrides = {}): IntegrationPolicy {
    const o = overrides[key] ?? {};
    const hidden = o.hidden ?? INTEGRATION_DEFAULT_HIDDEN.includes(key);
    if (INTEGRATION_RETIRING[key]) return { stage: 'retiring', hidden };
    const beta = o.beta ?? INTEGRATION_DEFAULT_BETA.includes(key);
    return { stage: beta ? 'beta' : 'stable', hidden };
}

export function integrationPolicies(overrides: IntegrationOverrides = {}): Record<IntegrationKey, IntegrationPolicy> {
    const out = {} as Record<IntegrationKey, IntegrationPolicy>;
    for (const key of INTEGRATION_KEYS) out[key] = integrationPolicy(key, overrides);
    return out;
}

/**
 * Aplica un cambio del operador. `null` vuelve a lo de fábrica, y un valor
 * igual al de fábrica no se guarda (así una versión futura puede cambiarlo).
 */
export function applyIntegrationOverride(
    overrides: IntegrationOverrides,
    key: IntegrationKey,
    patch: { hidden?: boolean | null; beta?: boolean | null },
): IntegrationOverrides {
    const current: IntegrationOverride = { ...(overrides[key] ?? {}) };
    if (patch.hidden !== undefined) {
        if (patch.hidden === null || patch.hidden === INTEGRATION_DEFAULT_HIDDEN.includes(key)) delete current.hidden;
        else current.hidden = patch.hidden;
    }
    if (patch.beta !== undefined && !INTEGRATION_RETIRING[key]) {
        if (patch.beta === null || patch.beta === INTEGRATION_DEFAULT_BETA.includes(key)) delete current.beta;
        else current.beta = patch.beta;
    }
    const next = { ...overrides };
    if (Object.keys(current).length === 0) delete next[key];
    else next[key] = current;
    return next;
}

export const updateIntegrationCatalogSchema = z
    .object({
        hidden: z.boolean().nullable().optional(),
        beta: z.boolean().nullable().optional(),
    })
    .refine((v) => v.hidden !== undefined || v.beta !== undefined, { message: 'Nada para cambiar.' });
export type UpdateIntegrationCatalogInput = z.infer<typeof updateIntegrationCatalogSchema>;

export const platformIntegrationCatalogItemSchema = z.object({
    key: z.enum(INTEGRATION_KEYS),
    stage: z.enum(['stable', 'beta', 'retiring']),
    hidden: z.boolean(),
    hidden_default: z.boolean(),
    beta_default: z.boolean(),
    /** Lo eligió el operador (distinto de lo de fábrica). */
    customized: z.boolean(),
    replacement: z.enum(INTEGRATION_KEYS).nullable(),
    /** Empresas (vivas) con al menos una conexión de esta app, y cuántas conexiones. */
    tenants: z.number().int(),
    connections: z.number().int(),
});
export type PlatformIntegrationCatalogItem = z.infer<typeof platformIntegrationCatalogItemSchema>;
