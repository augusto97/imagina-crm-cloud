import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { BULK_HISTORY_DAYS } from '@imagina-base/shared';
import { sql, type SQL } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { REDIS } from '../redis/redis.module';

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
 * Lo que NO se borra a propósito: la actividad de los registros (es la
 * historia de los datos del cliente: se ve en la ficha y se restaura desde
 * ahí) y la bitácora de la empresa (seguridad).
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
    { table: 'sms_messages', where: sql`status NOT IN ('programado', 'en_cola', 'enviando') AND created_at < now() - interval '180 days'` },
    { table: 'bulk_edits', where: sql`created_at < now() - make_interval(days => ${BULK_HISTORY_DAYS})` },
    // El registro dinámico de clientes OAuth (para el MCP) es abierto: un
    // cliente que se registró y nunca se usó para un token, y que no tiene
    // ningún token, no le sirve a nadie (un cliente real se registra otra vez).
    {
        table: 'oauth_clients',
        key: 'client_id',
        where: sql`last_used_at IS NULL AND created_at < now() - make_interval(days => ${OAUTH_UNUSED_CLIENT_DAYS}) AND NOT EXISTS (SELECT 1 FROM personal_access_tokens t WHERE t.client_id = oauth_clients.client_id)`,
    },
];

const BATCH = 5000;
const MAX_ROUNDS = 20;
const EVERY_MS = 60 * 60_000;
const LOCK_KEY = 'retention:lock';
const LOCK_TTL_S = 30 * 60;

@Injectable()
export class RetentionService implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(RetentionService.name);
    private timer: NodeJS.Timeout | null = null;

    constructor(
        @Inject(ENV) private readonly env: Env,
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(REDIS) private readonly redis: Redis,
    ) {}

    onModuleInit(): void {
        if (this.env.NODE_ENV === 'test') return;
        this.timer = setInterval(() => {
            this.tick().catch((err) => this.logger.warn(`Retención de tablas falló: ${String(err)}`));
        }, EVERY_MS);
        this.timer.unref();
    }

    onApplicationShutdown(): void {
        if (this.timer) clearInterval(this.timer);
    }

    /** Una vuelta (en un solo nodo). Devuelve cuántas filas se borraron por tabla. */
    async tick(): Promise<Record<string, number> | null> {
        const got = await this.redis.set(LOCK_KEY, String(process.pid), 'EX', LOCK_TTL_S, 'NX').catch(() => 'OK');
        if (got !== 'OK') return null;
        try {
            const out = await pruneTables(this.db);
            const total = Object.values(out).reduce((a, b) => a + b, 0);
            if (total > 0) this.logger.log(`Retención: ${Object.entries(out).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(', ')}.`);
            return out;
        } finally {
            await this.redis.del(LOCK_KEY).catch(() => undefined);
        }
    }
}

/** Borra por tandas lo que cada regla permite (conexión base: todas las empresas). */
export async function pruneTables(db: Db, rules: readonly RetentionRule[] = RETENTION_RULES): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const rule of rules) {
        let n = 0;
        for (let i = 0; i < MAX_ROUNDS; i++) {
            const key = sql.identifier(rule.key ?? 'id');
            const res = await db.execute(sql`DELETE FROM ${sql.identifier(rule.table)} WHERE ${key} IN (SELECT ${key} FROM ${sql.identifier(rule.table)} WHERE ${rule.where} LIMIT ${BATCH})`);
            const count = res.rowCount ?? 0;
            n += count;
            if (count < BATCH) break;
        }
        out[rule.table] = n;
    }
    return out;
}
