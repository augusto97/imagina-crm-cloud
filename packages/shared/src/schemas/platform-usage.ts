import { z } from 'zod';

import type { PlanModule } from './plan-access';

/**
 * v0.1.437 — Uso por módulo (Plataforma → Uso).
 *
 * Qué empresa usa qué y cuánto, para que el operador decida con datos qué
 * cobrar, qué marcar «beta» y qué apagar. Cada módulo mide dos cosas:
 *
 *  · CANTIDAD — lo que la empresa tiene configurado y vivo (automatizaciones
 *    activas, formularios publicados, conexiones…). Dice si lo USA.
 *  · ACTIVIDAD — lo que pasó en los últimos {@link USAGE_DAYS} días (corridas,
 *    respuestas, pedidos, citas…). Dice si lo usa DE VERDAD. Algunos módulos
 *    no tienen actividad que medir (roles propios, equipos) y otros cuentan el
 *    mes en curso porque así se guarda su contador (IA, correo).
 *
 * El servidor lo calcula con una consulta agrupada por empresa por módulo y lo
 * guarda unos minutos: nunca recorre registros, sólo tablas de configuración
 * y de actividad con su índice de fecha.
 */

export const USAGE_DAYS = 30;

export const USAGE_MODULE_KEYS = [
    'automations',
    'agents',
    'ai_assistant',
    'ai_fields',
    'documents',
    'helpdesk',
    'approvals',
    'time_tracking',
    'forms',
    'widgets',
    'booking',
    'shop',
    'portal',
    'guests',
    'public_sharing',
    'integrations',
    'whatsapp',
    'sms',
    'payments',
    'subscriptions',
    'woocommerce',
    'wordpress',
    'sql',
    'api',
    'dashboards',
    'teams',
    'custom_roles',
    'custom_domain',
    'email',
] as const;
export type UsageModuleKey = (typeof USAGE_MODULE_KEYS)[number];
export const usageModuleKeySchema = z.enum(USAGE_MODULE_KEYS);

export type UsageGroup = 'work' | 'receive' | 'connect' | 'team';

export const USAGE_GROUPS: ReadonlyArray<{ key: UsageGroup; label: string }> = [
    { key: 'work', label: 'Trabajo' },
    { key: 'receive', label: 'Recibir de afuera' },
    { key: 'connect', label: 'Conectar con otras apps' },
    { key: 'team', label: 'Equipo y marca' },
];

export interface UsageModuleInfo {
    key: UsageModuleKey;
    label: string;
    group: UsageGroup;
    /** El módulo del plan que lo enciende o apaga (null = siempre incluido). */
    plan_module: PlanModule | null;
    /** Qué cuenta la CANTIDAD («automatizaciones activas»); null = no tiene. */
    total_label: string | null;
    /** Qué cuenta la ACTIVIDAD («corridas»); null = no tiene. */
    activity_label: string | null;
    /** La actividad es del mes en curso y no de los últimos 30 días. */
    activity_month?: boolean;
}

export const USAGE_MODULES: readonly UsageModuleInfo[] = [
    { key: 'automations', group: 'work', plan_module: 'automations', label: 'Automatizaciones', total_label: 'activas', activity_label: 'corridas' },
    { key: 'agents', group: 'work', plan_module: 'ai', label: 'Agentes de IA', total_label: 'activos', activity_label: 'corridas' },
    { key: 'ai_assistant', group: 'work', plan_module: 'ai', label: 'Asistente IA', total_label: null, activity_label: 'pedidos este mes', activity_month: true },
    { key: 'ai_fields', group: 'work', plan_module: 'ai', label: 'Campos con IA', total_label: 'campos', activity_label: null },
    { key: 'documents', group: 'work', plan_module: 'documents', label: 'Documentos PDF', total_label: 'plantillas', activity_label: 'documentos emitidos' },
    { key: 'helpdesk', group: 'work', plan_module: 'helpdesk', label: 'Mesa de ayuda', total_label: 'buzones', activity_label: 'correos recibidos' },
    { key: 'approvals', group: 'work', plan_module: null, label: 'Aprobaciones', total_label: 'flujos activos', activity_label: 'solicitudes' },
    { key: 'time_tracking', group: 'work', plan_module: null, label: 'Registro de tiempo', total_label: null, activity_label: 'registros de tiempo' },
    { key: 'dashboards', group: 'work', plan_module: null, label: 'Tableros', total_label: 'tableros', activity_label: null },
    { key: 'forms', group: 'receive', plan_module: 'forms', label: 'Formularios', total_label: 'publicados', activity_label: 'respuestas' },
    { key: 'widgets', group: 'receive', plan_module: 'forms', label: 'Widget de contacto', total_label: 'publicados', activity_label: 'visitas' },
    { key: 'booking', group: 'receive', plan_module: 'booking', label: 'Agenda de citas', total_label: 'agendas publicadas', activity_label: 'citas' },
    { key: 'shop', group: 'receive', plan_module: 'shop', label: 'Tienda', total_label: 'tiendas publicadas', activity_label: 'pedidos' },
    { key: 'portal', group: 'receive', plan_module: 'portal', label: 'Portal del cliente', total_label: 'clientes con acceso', activity_label: 'clientes que entraron' },
    { key: 'guests', group: 'receive', plan_module: null, label: 'Invitados', total_label: 'invitados', activity_label: null },
    { key: 'public_sharing', group: 'receive', plan_module: 'public_sharing', label: 'Enlaces públicos', total_label: 'listas y tableros publicados', activity_label: null },
    { key: 'integrations', group: 'connect', plan_module: 'integrations', label: 'Apps conectadas', total_label: 'conexiones', activity_label: null },
    { key: 'whatsapp', group: 'connect', plan_module: 'integrations', label: 'WhatsApp', total_label: 'conexiones', activity_label: 'contactos con mensajes' },
    { key: 'sms', group: 'connect', plan_module: 'integrations', label: 'SMS', total_label: 'conexiones', activity_label: 'SMS' },
    { key: 'payments', group: 'connect', plan_module: 'integrations', label: 'Cobros (links de pago)', total_label: 'conexiones', activity_label: 'links creados' },
    { key: 'subscriptions', group: 'connect', plan_module: 'integrations', label: 'Suscripciones', total_label: 'suscripciones vivas', activity_label: 'cobros' },
    { key: 'woocommerce', group: 'connect', plan_module: 'woocommerce', label: 'Tienda WooCommerce', total_label: 'tiendas sincronizadas', activity_label: null },
    { key: 'wordpress', group: 'connect', plan_module: 'wordpress', label: 'Sitio WordPress', total_label: 'sitios sincronizados', activity_label: null },
    { key: 'sql', group: 'connect', plan_module: 'sql', label: 'Bases de datos SQL', total_label: 'sincronizaciones', activity_label: null },
    { key: 'api', group: 'connect', plan_module: 'api', label: 'API y conexión con Claude', total_label: 'tokens vigentes', activity_label: 'tokens usados' },
    { key: 'teams', group: 'team', plan_module: null, label: 'Equipos', total_label: 'equipos', activity_label: null },
    { key: 'custom_roles', group: 'team', plan_module: 'custom_roles', label: 'Roles propios', total_label: 'roles', activity_label: null },
    { key: 'custom_domain', group: 'team', plan_module: 'custom_domain', label: 'Dominio propio', total_label: 'dominios', activity_label: null },
    { key: 'email', group: 'team', plan_module: null, label: 'Correos por el servidor', total_label: null, activity_label: 'correos este mes', activity_month: true },
];

export function usageModuleInfo(key: UsageModuleKey): UsageModuleInfo {
    return USAGE_MODULES.find((m) => m.key === key)!;
}

const isoDate = z.string();

export const platformUsageModuleSchema = z.object({
    key: usageModuleKeySchema,
    /** Empresas (vivas) con CANTIDAD > 0, o con actividad si el módulo no tiene cantidad. */
    tenants_using: z.number().int(),
    /** Empresas con actividad en el período. */
    tenants_active: z.number().int(),
    total: z.number().int(),
    activity: z.number().int().nullable(),
    last_at: isoDate.nullable(),
    /** Planes que lo apagan (para leer «nadie lo usa» con contexto). */
    disabled_in_plans: z.array(z.string()),
});
export type PlatformUsageModule = z.infer<typeof platformUsageModuleSchema>;

export const platformUsageAppSchema = z.object({
    /** La clave de la integración (`whatsapp_web`, `sms_twilio`…) o `http` (API personalizada). */
    key: z.string(),
    tenants: z.number().int(),
    connections: z.number().int(),
});
export type PlatformUsageApp = z.infer<typeof platformUsageAppSchema>;

export const platformUsageSchema = z.object({
    generated_at: isoDate,
    days: z.number().int(),
    /** Empresas sin archivar (la base de los porcentajes). */
    tenants_live: z.number().int(),
    modules: z.array(platformUsageModuleSchema),
    apps: z.array(platformUsageAppSchema),
    /** Módulos que no se pudieron medir esta vez (su consulta falló: salen en cero). */
    unmeasured: z.array(usageModuleKeySchema),
});
export type PlatformUsage = z.infer<typeof platformUsageSchema>;

export const platformUsageRowSchema = z.object({
    tenant_id: z.number().int(),
    name: z.string(),
    slug: z.string(),
    plan: z.string(),
    total: z.number().int(),
    activity: z.number().int().nullable(),
    last_at: isoDate.nullable(),
});
export type PlatformUsageRow = z.infer<typeof platformUsageRowSchema>;

export const platformUsageModuleDetailSchema = z.object({
    key: usageModuleKeySchema,
    generated_at: isoDate,
    rows: z.array(platformUsageRowSchema),
    /** Hay más empresas de las que se muestran. */
    truncated: z.boolean(),
});
export type PlatformUsageModuleDetail = z.infer<typeof platformUsageModuleDetailSchema>;

export const platformTenantUsageSchema = z.object({
    tenant_id: z.number().int(),
    generated_at: isoDate,
    modules: z.array(
        z.object({
            key: usageModuleKeySchema,
            total: z.number().int(),
            activity: z.number().int().nullable(),
            last_at: isoDate.nullable(),
        }),
    ),
});
export type PlatformTenantUsage = z.infer<typeof platformTenantUsageSchema>;

/**
 * Una celda del cálculo: [cantidad, actividad, última vez (segundos epoch)].
 * Puro y compartido: el servidor arma los totales con esto y las pruebas lo
 * verifican sin base.
 */
export type UsageCell = [total: number, activity: number | null, lastAt: number | null];

/** Si una empresa USA el módulo: tiene algo configurado, o actividad si el módulo no mide cantidad. */
export function usageCellUsing(info: Pick<UsageModuleInfo, 'total_label'>, cell: UsageCell | undefined): boolean {
    if (!cell) return false;
    if (info.total_label === null) return (cell[1] ?? 0) > 0;
    return cell[0] > 0;
}

/** Ordena las empresas de un módulo: más actividad, después más cantidad, después la más reciente. */
export function compareUsageCells(a: UsageCell, b: UsageCell): number {
    return (b[1] ?? 0) - (a[1] ?? 0) || b[0] - a[0] || (b[2] ?? 0) - (a[2] ?? 0);
}
