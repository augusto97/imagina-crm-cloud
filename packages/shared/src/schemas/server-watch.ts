import { z } from 'zod';

/**
 * v0.1.431 (ADR-S104) — Vigilancia del servidor: el guardián (un servicio de
 * root que revisa y repara cada minuto), los avisos al operador por correo y
 * el monitoreo externo (heartbeat).
 *
 * Nació de una caída real: ServerAvatar reescribió el archivo de Nginx al
 * emitir un certificado, la app quedó con «403 Forbidden» y sólo se pudo
 * arreglar por consola, como root.
 */

/** Versión del guardián que trae ESTA versión de la app (`deploy/guardian`). */
export const GUARDIAN_VERSION = 3;

/** Lo que suma cada versión del guardián (para el aviso «hay una versión nueva»). */
export const GUARDIAN_VERSION_NOTES: Readonly<Record<number, string>> = {
    2: 'los comandos por SSH (imagina-estado, imagina-reparar) y la página de rescate en su propio puerto.',
    3: 'separa la app de los trabajos en segundo plano en dos procesos: si un trabajo pesado (un Excel grande, una sincronización) se traba, la app sigue atendiendo, y el guardián vigila y reinicia cada uno por su lado.',
};

/** Qué se gana actualizando desde `from` (las notas de las versiones siguientes, juntas). */
export function guardianUpgradeNote(from: number): string | null {
    const notes: string[] = [];
    for (let v = from + 1; v <= GUARDIAN_VERSION; v++) {
        const n = GUARDIAN_VERSION_NOTES[v];
        if (n) notes.push(n);
    }
    return notes.length ? notes.join(' Además, ') : null;
}

export const GUARDIAN_CHECK_STATES = ['ok', 'down', 'updating', 'unknown', 'skipped', 'cert'] as const;
export type GuardianCheckState = (typeof GUARDIAN_CHECK_STATES)[number];

const checkState = z.enum(GUARDIAN_CHECK_STATES).catch('unknown');

export const guardianEventSchema = z.object({
    id: z.string(),
    at: z.string(),
    kind: z.string(),
    ok: z.boolean(),
    message: z.string(),
});
export type GuardianEvent = z.infer<typeof guardianEventSchema>;

/** Lo que escribe el guardián en `status.json` (leído con tolerancia). */
export const guardianReportSchema = z.object({
    version: z.number().int().catch(0),
    updated_at: z.string(),
    domain: z.string().catch(''),
    web_mode: z.string().catch('none'),
    requested: z.boolean().catch(false),
    current_release: z.string().catch(''),
    checks: z.object({
        api: checkState,
        database: checkState,
        redis: checkState,
        web_server: checkState,
        front: checkState,
        disk: z
            .object({
                ok: z.boolean().catch(true),
                free_bytes: z.number().catch(0),
                total_bytes: z.number().catch(0),
                free_inodes: z.number().catch(0),
                total_inodes: z.number().catch(0),
            })
            .catch({ ok: true, free_bytes: 0, total_bytes: 0, free_inodes: 0, total_inodes: 0 }),
    }),
    /**
     * v0.1.435 — El proceso de los trabajos en segundo plano (imagina-worker),
     * aparte del que atiende a las personas. `enabled` false = un solo proceso.
     */
    worker: z
        .object({
            enabled: z.boolean().catch(false),
            port: z.number().int().catch(0),
            check: checkState,
        })
        .catch({ enabled: false, port: 0, check: 'skipped' as const }),
    /** v0.1.432 — La página de rescate (puerto propio, con clave). */
    rescue: z
        .object({
            enabled: z.boolean().catch(false),
            port: z.number().int().catch(0),
            /** domain = el certificado del dominio; self = uno propio (el navegador avisa). */
            cert: z.enum(['domain', 'self', 'none']).catch('none'),
            active: z.boolean().catch(false),
        })
        .catch({ enabled: false, port: 0, cert: 'none' as const, active: false }),
    last_action: guardianEventSchema.omit({ id: true }).nullable().catch(null),
});
export type GuardianReport = z.infer<typeof guardianReportSchema>;

export const guardianStatusSchema = z.object({
    /** El servidor usa el layout de releases (producción): el guardián aplica. */
    applicable: z.boolean(),
    installed: z.boolean(),
    /** Revisó en los últimos 5 minutos. */
    fresh: z.boolean(),
    outdated: z.boolean(),
    expected_version: z.number().int(),
    report: guardianReportSchema.nullable(),
    events: z.array(guardianEventSchema),
    /** Hay un pedido de revisión esperando que el guardián lo tome. */
    request_pending: z.boolean(),
    /** El comando para instalarlo o actualizarlo (como root). */
    install_command: z.string(),
    /**
     * v0.1.435 — Cómo corre la app: `api` = sólo atiende (los trabajos los hace
     * otro proceso), `all` = las dos cosas en uno. `workers` = procesos tomando
     * trabajos en segundo plano ahora (null si no se pudo saber).
     */
    processes: z
        .object({
            role: z.enum(['api', 'worker', 'all']),
            workers: z.number().int().nullable(),
        })
        .optional(),
});
export type GuardianStatus = z.infer<typeof guardianStatusSchema>;

export const PLATFORM_ALERT_SOURCES = ['guardian', 'backups', 'drive', 'update', 'certificate', 'disk', 'database', 'front', 'monitoring', 'workers'] as const;
export type PlatformAlertSource = (typeof PLATFORM_ALERT_SOURCES)[number];
export const PLATFORM_ALERT_SEVERITIES = ['critical', 'warning', 'info'] as const;
export type PlatformAlertSeverity = (typeof PLATFORM_ALERT_SEVERITIES)[number];

export const platformAlertSchema = z.object({
    key: z.string(),
    source: z.enum(PLATFORM_ALERT_SOURCES),
    severity: z.enum(PLATFORM_ALERT_SEVERITIES),
    title: z.string(),
    detail: z.string(),
    /** Dónde se arregla (ruta de la app, p. ej. `/platform?tab=backups`). */
    action_path: z.string().nullable(),
    action_label: z.string().nullable(),
    opened_at: z.string(),
    last_at: z.string(),
    count: z.number().int(),
    notified_at: z.string().nullable(),
    /** Null mientras sigue abierto. Un aviso de una sola vez nace resuelto. */
    resolved_at: z.string().nullable(),
});
export type PlatformAlert = z.infer<typeof platformAlertSchema>;

export const platformAlertsSchema = z.object({
    open: z.array(platformAlertSchema),
    recent: z.array(platformAlertSchema),
    /** A quién le llegan los correos (PLATFORM_SUPERADMINS). */
    recipients: z.array(z.string()),
    mail_available: z.boolean(),
    mail_reason: z.string().nullable(),
    checked_at: z.string().nullable(),
});
export type PlatformAlerts = z.infer<typeof platformAlertsSchema>;

/**
 * Monitoreo externo: la app «late» (GET) cada minuto contra una URL de
 * heartbeat (Better Stack, Healthchecks.io, Cronitor…) mientras todo está
 * bien. Si el servidor se apaga o algo falla, deja de latir y el servicio de
 * afuera avisa — lo único que avisa cuando el servidor entero no responde.
 */
export const monitoringSettingsSchema = z.object({
    heartbeat_url: z
        .string()
        .trim()
        .max(500)
        .url()
        .refine((u) => u.startsWith('https://'), 'La dirección tiene que empezar con https://')
        .nullable()
        .catch(null),
    enabled: z.boolean().catch(true),
});
export type MonitoringSettings = z.infer<typeof monitoringSettingsSchema>;

export const updateMonitoringSchema = z.object({
    heartbeat_url: z
        .string()
        .trim()
        .max(500)
        .url('Pega la dirección completa del heartbeat')
        .refine((u) => u.startsWith('https://'), 'La dirección tiene que empezar con https://')
        .nullable()
        .optional(),
    enabled: z.boolean().optional(),
});
export type UpdateMonitoringInput = z.infer<typeof updateMonitoringSchema>;

export const heartbeatPingSchema = z.object({
    at: z.string(),
    ok: z.boolean(),
    /** Se avisó «falla» (`/fail`) en vez de latir. */
    failed: z.boolean(),
    status: z.number().int().nullable(),
    message: z.string().nullable(),
});
export type HeartbeatPing = z.infer<typeof heartbeatPingSchema>;

export const monitoringStatusSchema = z.object({
    settings: monitoringSettingsSchema,
    last_ping: heartbeatPingSchema.nullable(),
    /** Por qué no está latiendo ahora (null = late normal). */
    holding_reason: z.string().nullable(),
    health_url: z.string(),
});
export type MonitoringStatus = z.infer<typeof monitoringStatusSchema>;

/**
 * Proveedores de heartbeat que entienden `<url>/fail` para avisar una falla al
 * momento (los demás simplemente dejan de recibir latidos).
 */
export function heartbeatSupportsFail(url: string): boolean {
    const m = /^https:\/\/([^/:?#]+)/i.exec(url.trim());
    if (!m) return false;
    const host = m[1]!.toLowerCase();
    return host === 'uptime.betterstack.com' || host === 'betteruptime.com' || host.endsWith('.betteruptime.com') || host === 'hc-ping.com';
}
