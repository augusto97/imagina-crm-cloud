import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import {
    BULK_HISTORY_DAYS,
    readPlatformRetention,
    type DbTableSize,
    type PlatformRetention,
    type PlatformRetentionStatus,
    type RetentionRunResult,
    type UpdatePlatformRetentionInput,
} from '@imagina-base/shared';
import { sql, type SQL } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { REDIS } from '../redis/redis.module';
import { withRedisLock } from '../redis/redis-lock';
import { workersEnabled } from '../redis/queue-runtime';

/**
 * v0.1.393 — Retención de las tablas que crecían sin tope. Con miles de
 * empresas, cada aviso, cada recordatorio, cada SMS y cada corrida de un
 * agente es una fila más para siempre: las consultas no se ponen lentas (van
 * por índice) pero la base y sus copias sí crecen sin parar.
 *
 * Qué se borra (por tandas, una vez por hora, en UN nodo):
 *  - avisos leídos de más de 90 días y cualquiera de más de 180;
 *  - recordatorios ya disparados o hechos de más de 180 días;
 *  - Problemas resueltos hace más de 90 días;
 *  - corridas de agentes terminadas de más de 90 días (las propuestas quedan);
 *  - SMS de más de 180 días que ya terminaron (el estado queda en el registro);
 *  - clientes OAuth registrados hace más de 30 días que nunca pidieron un
 *    token (y no tienen ninguno);
 *  - el historial de ediciones masivas pasado su plazo (antes sólo se podaba
 *    cuando la misma empresa hacía otra edición masiva).
 *
 * Lo que NO se borra a propósito: la bitácora de la empresa (seguridad).
 *
 * v0.1.439 — Lo que elige el operador (Plataforma → Diagnóstico → «Tamaño de
 * la base»), en Redis `platform:retention`:
 *  - el historial de corridas de automatizaciones (90 días de fábrica): era la
 *    tabla que más crecía y nunca se podaba;
 *  - la actividad de los registros (de fábrica, para siempre: es la historia
 *    de los datos del cliente, se ve en la ficha y se restaura desde ahí).
 */
export interface RetentionRule {
    table: string;
    /** Condición de las filas que se pueden borrar (sobre la tabla sin alias). */
    where: SQL;
    /** Columna de la clave primaria (por defecto `id`). */
    key?: string;
}

/** Días que se conserva un cliente OAuth registrado que nunca llegó a pedir un token. */
export const OAUTH_UNUSED_CLIENT_DAYS = 30;

export const RETENTION_RULES: readonly RetentionRule[] = [
    {
        table: 'notifications',
        where: sql`created_at < now() - interval '180 days' OR (read_at IS NOT NULL AND created_at < now() - interval '90 days')`,
    },
    { table: 'reminders', where: sql`(fired_at IS NOT NULL OR done_at IS NOT NULL) AND created_at < now() - interval '180 days'` },
    { table: 'incidents', where: sql`resolved_at IS NOT NULL AND resolved_at < now() - interval '90 days'` },
    { table: 'ai_agent_runs', where: sql`status NOT IN ('queued', 'running') AND created_at < now() - interval '90 days'` },
    // v0.1.456 — los lotes de agentes terminados, con el mismo plazo que sus corridas.
    { table: 'ai_agent_batches', where: sql`status <> 'running' AND created_at < now() - interval '90 days'` },
    { table: 'sms_messages', where: sql`status NOT IN ('programado', 'en_cola', 'enviando') AND created_at < now() - interval '180 days'` },
    { table: 'bulk_edits', where: sql`created_at < now() - make_interval(days => ${BULK_HISTORY_DAYS})` },
    // v0.1.442 — el historial de entregas de los webhooks de eventos: 30 días
    // (lo que todavía espera un reintento nunca).
    { table: 'webhook_deliveries', where: sql`status <> 'pending' AND created_at < now() - interval '30 days'` },
    // El registro dinámico de clientes OAuth (para el MCP) es abierto: un
    // cliente que se registró y nunca se usó para un token, y que no tiene
    // ningún token, no le sirve a nadie (un cliente real se registra otra vez).
    {
        table: 'oauth_clients',
        key: 'client_id',
        where: sql`last_used_at IS NULL AND created_at < now() - make_interval(days => ${OAUTH_UNUSED_CLIENT_DAYS}) AND NOT EXISTS (SELECT 1 FROM personal_access_tokens t WHERE t.client_id = oauth_clients.client_id)`,
    },
];

/**
 * v0.1.439 — Las corridas terminadas de más de `days` días. Nunca:
 *  - una que espera o está corriendo;
 *  - la última de cada automatización («Corrió / Falló hace…» del índice);
 *  - en una automatización «por fecha de vencimiento», la corrida que impide
 *    volver a dispararla: su escaneo mira si hay una corrida (no fallida)
 *    desde el momento de disparo, así que una corrida se borra sólo si hay
 *    OTRA más nueva y no fallida del mismo registro (cubre lo mismo), o si el
 *    registro ya no existe.
 */
export function automationRunsRule(days: number): RetentionRule {
    return {
        table: 'automation_runs',
        where: sql`status NOT IN ('waiting', 'running', 'queued')
            AND created_at < now() - make_interval(days => ${days})
            AND EXISTS (SELECT 1 FROM automation_runs n
                WHERE n.tenant_id = automation_runs.tenant_id AND n.automation_id = automation_runs.automation_id AND n.id > automation_runs.id)
            AND (
                automation_runs.record_id IS NULL
                OR NOT EXISTS (SELECT 1 FROM automations a WHERE a.id = automation_runs.automation_id AND a.trigger_type = 'due_date_reached')
                OR NOT EXISTS (SELECT 1 FROM records r WHERE r.id = automation_runs.record_id)
                OR EXISTS (SELECT 1 FROM automation_runs n
                    WHERE n.tenant_id = automation_runs.tenant_id AND n.automation_id = automation_runs.automation_id
                      AND n.record_id = automation_runs.record_id AND n.id > automation_runs.id AND n.status <> 'failed')
            )`,
    };
}

/** v0.1.439 — La actividad de los registros de más de `days` días (sólo si el operador lo elige). */
export function activityRule(days: number): RetentionRule {
    return { table: 'activity', where: sql`created_at < now() - make_interval(days => ${days})` };
}

/** Las reglas de una vuelta: las fijas + lo que eligió el operador. */
export function retentionRules(settings: PlatformRetention): RetentionRule[] {
    const rules = [...RETENTION_RULES];
    if (settings.automation_runs_days !== null) rules.push(automationRunsRule(settings.automation_runs_days));
    if (settings.activity_days !== null) rules.push(activityRule(settings.activity_days));
    return rules;
}

export const PLATFORM_RETENTION_KEY = 'platform:retention';
/** El resultado de la última vuelta (no viaja en las copias: no es `platform:`). */
const LAST_KEY = 'diag:retention:last';

/** Nombres para mostrar de las tablas que más pesan. */
const TABLE_LABELS: Record<string, string> = {
    records: 'Registros',
    activity: 'Actividad de los registros',
    automation_runs: 'Historial de corridas de automatizaciones',
    attachments: 'Archivos (datos de cada archivo)',
    notifications: 'Avisos',
    audit_log: 'Bitácora de las empresas',
    comments: 'Comentarios',
    relations: 'Vínculos entre registros',
    sms_messages: 'SMS enviados',
    webhook_deliveries: 'Entregas de webhooks',
    ai_agent_runs: 'Corridas de agentes de IA',
    ai_agent_batches: 'Lotes de agentes de IA',
    bulk_edit_items: 'Historial de ediciones masivas',
    form_stats: 'Estadísticas de formularios',
    shop_orders: 'Pedidos de las tiendas',
    sync_links: 'Vínculos con tiendas y sitios',
    mentions: 'Menciones',
    reminders: 'Recordatorios',
    incidents: 'Problemas',
    whatsapp_contacts: 'Contactos de WhatsApp',
    fields: 'Campos de las listas',
    lists: 'Listas',
    saved_views: 'Vistas guardadas',
    record_follows: 'Seguimiento de registros',
    automations: 'Automatizaciones',
    automation_versions: 'Versiones de automatizaciones',
    dashboards: 'Tableros',
    forms: 'Formularios',
    form_stats_daily: 'Estadísticas de formularios',
    shops: 'Tiendas',
    shop_stats: 'Estadísticas de las tiendas',
    whats_new_entries: 'Novedades',
    whats_new_views: 'Novedades vistas',
    users: 'Cuentas',
    tenants: 'Empresas',
    memberships: 'Miembros de las empresas',
    connections: 'Apps conectadas',
    templates: 'Plantillas',
    document_templates: 'Plantillas de documentos',
    document_numbers: 'Documentos emitidos',
    payment_links: 'Links de pago',
    subscriptions: 'Suscripciones',
    subscription_charges: 'Cobros de suscripciones',
    booking_appointments: 'Citas',
    time_entries: 'Registro de tiempo',
    record_checklist_items: 'Ítems de checklists',
    helpdesk_messages: 'Correos de la mesa de ayuda',
    email_usage: 'Uso de correo',
    widget_stats: 'Estadísticas del widget',
};

const BATCH = 5000;
const MAX_ROUNDS = 20;
const EVERY_MS = 60 * 60_000;
const LOCK_KEY = 'retention:lock';
const LOCK_TTL_S = 30 * 60;

@Injectable()
export class RetentionService implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(RetentionService.name);
    private timer: NodeJS.Timeout | null = null;
    /** Una limpieza pedida a mano que todavía corre (en este proceso). */
    private manual: Promise<unknown> | null = null;

    constructor(
        @Inject(ENV) private readonly env: Env,
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(REDIS) private readonly redis: Redis,
    ) {}

    onModuleInit(): void {
        if (this.env.NODE_ENV === 'test' || !workersEnabled()) return;
        this.timer = setInterval(() => {
            this.tick().catch((err) => this.logger.warn(`Retención de tablas falló: ${String(err)}`));
        }, EVERY_MS);
        this.timer.unref();
    }

    onApplicationShutdown(): void {
        if (this.timer) clearInterval(this.timer);
    }

    /** Lo que eligió el operador (de fábrica si no hay nada o está roto). */
    async settings(): Promise<PlatformRetention> {
        let raw: unknown;
        try {
            const text = await this.redis.get(PLATFORM_RETENTION_KEY);
            raw = text ? JSON.parse(text) : undefined;
        } catch {
            raw = undefined;
        }
        return readPlatformRetention(raw);
    }

    async setSettings(patch: UpdatePlatformRetentionInput): Promise<PlatformRetentionStatus> {
        const next = { ...(await this.settings()), ...patch };
        await this.redis.set(PLATFORM_RETENTION_KEY, JSON.stringify(readPlatformRetention(next)));
        return this.status();
    }

    /** Plataforma → Diagnóstico: lo elegido, lo que pesa cada tabla y la última limpieza. */
    async status(): Promise<PlatformRetentionStatus> {
        const [settings, sizes, lastRaw] = await Promise.all([
            this.settings(),
            tableSizes(this.db).catch(() => ({ db_bytes: null, tables: [] as DbTableSize[] })),
            this.redis.get(LAST_KEY).catch(() => null),
        ]);
        let last: RetentionRunResult | null = null;
        try {
            last = lastRaw ? (JSON.parse(lastRaw) as RetentionRunResult) : null;
        } catch {
            last = null;
        }
        return { settings, ...sizes, last, running: this.manual !== null };
    }

    /** «Limpiar ahora»: una vuelta en segundo plano (la respuesta no la espera). */
    runNow(): void {
        if (this.manual) return;
        this.manual = this.tick()
            .catch((err) => this.logger.warn(`Limpieza pedida falló: ${String(err)}`))
            .finally(() => {
                this.manual = null;
            });
    }

    /** Una vuelta (en un solo nodo). Devuelve cuántas filas se borraron por tabla. */
    async tick(): Promise<Record<string, number> | null> {
        // Candado con dueño y renovado: un error de Redis no cuenta como tomado
        // (antes, con Redis fallando, todos los nodos borraban a la vez).
        const out = await withRedisLock(this.redis, LOCK_KEY, LOCK_TTL_S, async () => {
            let result: RetentionRunResult;
            try {
                const { deleted, more } = await pruneWithInfo(this.db, retentionRules(await this.settings()));
                result = { at: new Date().toISOString(), deleted, more, error: null };
            } catch (err) {
                result = { at: new Date().toISOString(), deleted: {}, more: false, error: err instanceof Error ? err.message : String(err) };
            }
            await this.redis.set(LAST_KEY, JSON.stringify(result), 'EX', 60 * 60 * 24 * 30).catch(() => undefined);
            if (result.error) throw new Error(result.error);
            const total = Object.values(result.deleted).reduce((a, b) => a + b, 0);
            if (total > 0) this.logger.log(`Retención: ${Object.entries(result.deleted).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(', ')}.`);
            return result.deleted;
        });
        return out.ran ? out.result : null;
    }
}

/** Borra por tandas lo que cada regla permite (conexión base: todas las empresas). */
export async function pruneTables(db: Db, rules: readonly RetentionRule[] = RETENTION_RULES): Promise<Record<string, number>> {
    return (await pruneWithInfo(db, rules)).deleted;
}

/** Igual que `pruneTables`, y dice si quedó trabajo (una tabla llegó al tope de tandas). */
export async function pruneWithInfo(db: Db, rules: readonly RetentionRule[]): Promise<{ deleted: Record<string, number>; more: boolean }> {
    const deleted: Record<string, number> = {};
    let more = false;
    for (const rule of rules) {
        let n = 0;
        let full = true;
        for (let i = 0; i < MAX_ROUNDS; i++) {
            const key = sql.identifier(rule.key ?? 'id');
            const res = await db.execute(sql`DELETE FROM ${sql.identifier(rule.table)} WHERE ${key} IN (SELECT ${key} FROM ${sql.identifier(rule.table)} WHERE ${rule.where} LIMIT ${BATCH})`);
            const count = res.rowCount ?? 0;
            n += count;
            if (count < BATCH) {
                full = false;
                break;
            }
        }
        if (full) more = true;
        deleted[rule.table] = (deleted[rule.table] ?? 0) + n;
    }
    return { deleted, more };
}

/** Las tablas que más pesan (datos + índices + TOAST) y el total de la base. */
export async function tableSizes(db: Db, limit = 12): Promise<{ db_bytes: number | null; tables: DbTableSize[] }> {
    const auto = new Set(RETENTION_RULES.map((r) => r.table));
    const [dbRow] = (await db.execute(sql`SELECT pg_database_size(current_database())::bigint AS bytes`)).rows as Array<{ bytes: string | number }>;
    const rows = (
        await db.execute(sql`SELECT c.relname AS table_name,
                pg_total_relation_size(c.oid)::bigint AS bytes,
                GREATEST(c.reltuples, 0)::bigint AS rows
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r', 'p') AND n.nspname = 'public'
            ORDER BY pg_total_relation_size(c.oid) DESC
            LIMIT ${limit}`)
    ).rows as Array<{ table_name: string; bytes: string | number; rows: string | number }>;
    return {
        db_bytes: dbRow ? Number(dbRow.bytes) : null,
        tables: rows.map((r) => ({
            table: r.table_name,
            label: TABLE_LABELS[r.table_name] ?? null,
            bytes: Number(r.bytes),
            rows: Number(r.rows),
            pruned:
                r.table_name === 'automation_runs' || r.table_name === 'activity' ? 'setting' : auto.has(r.table_name) ? 'auto' : 'never',
        })),
    };
}
