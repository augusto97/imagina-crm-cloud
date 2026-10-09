import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
    MAIL_ACCOUNT_LIMITS,
    MAIL_ACCOUNT_NOTES,
    mailAccountKind,
    type MailAccountCandidate,
    type TenantMailStatus,
} from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { safeWebhookFetch } from '../common/safe-fetch';
import { DRIZZLE, type Db } from '../db/client';
import { tenants } from '../db/schema';
import {
    MailAccountLimitError,
    MailAccountUnusableError,
    type MailMessage,
    type MailTransport,
    type TenantMailAccountSender,
} from '../mail/mail.types';
import { REDIS } from '../redis/redis.module';
import { ConnectorsService, type MailCapableConnection } from './connectors.service';
import {
    accountMailParts,
    accountRecipientCount,
    buildAccountMailRequest,
    readAccountMailResponse,
} from './mail-account-request';

/** Subconjunto de ioredis que usa el contador diario (fake en memoria en los specs). */
export interface MailAccountCounterStore {
    incrby(key: string, n: number): Promise<number>;
    expire(key: string, seconds: number): Promise<unknown>;
    get(key: string): Promise<string | null>;
}

/** El día del proveedor: los dos cuentan por ventanas de 24 h; se aproxima con el día UTC. */
function dayKey(tenantId: number, now = new Date()): string {
    return `mailacct:${tenantId}:${now.toISOString().slice(0, 10)}`;
}

interface StoredChoice {
    connection_id: number;
}

/**
 * El correo de la EMPRESA por su cuenta de Google o Microsoft (v0.1.249,
 * ADR-S29). La elección vive en `tenants.settings.mail_account` y es la
 * primera vía que mira el MailService; guardar un SMTP propio la borra (una
 * sola forma de envío activa a la vez).
 *
 * Lleva un contador de destinatarios por día: el proveedor no nos dice cuánto
 * cupo queda, y la tarjeta tiene que poder mostrar "hoy van 37 de ~500".
 */
@Injectable()
export class MailAccountService implements TenantMailAccountSender {
    private readonly logger = new Logger(MailAccountService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(REDIS) private readonly counter: MailAccountCounterStore,
        private readonly connectors: ConnectorsService,
    ) {}

    // ── Envío ────────────────────────────────────────────────────────────

    async resolve(tenantId: number): Promise<MailTransport | null> {
        const choice = (await this.read(tenantId)).choice;
        if (!choice) return null;
        return {
            name: 'mail_account',
            send: (message) => this.send(tenantId, choice.connection_id, message),
        };
    }

    private async send(tenantId: number, connectionId: number, message: MailMessage): Promise<void> {
        let access;
        try {
            access = await this.connectors.mailAccountAccess(tenantId, connectionId);
        } catch (err) {
            throw new MailAccountUnusableError(err instanceof Error ? err.message : String(err));
        }
        const parts = accountMailParts(message, access.address);
        const req = buildAccountMailRequest(access.integration, message, access.accessToken, access.address);
        const who = access.integration === 'gmail' ? 'Google' : 'Microsoft';
        let res;
        try {
            res = await safeWebhookFetch(req.url, {
                method: req.method,
                headers: req.headers,
                body: req.body,
                captureBody: true,
            });
        } catch (err) {
            // Red caída o rechazada antes de llegar al proveedor: se dice dónde.
            throw new Error(`No se pudo conectar con ${who} para enviar el correo: ${err instanceof Error ? err.message : String(err)}`);
        }
        const failure = readAccountMailResponse(access.integration, res.status, res.body ?? '');
        if (failure) {
            if (failure.limit) throw new MailAccountLimitError(failure.message);
            throw new Error(failure.message);
        }
        // Best-effort: el correo YA salió; un contador caído no lo deshace.
        await this.count(tenantId, accountRecipientCount(parts)).catch((err: unknown) =>
            this.logger.warn(`No se pudo contar el envío del tenant ${tenantId}: ${String(err)}`),
        );
    }

    private async count(tenantId: number, n: number): Promise<void> {
        const key = dayKey(tenantId);
        await this.counter.incrby(key, n);
        await this.counter.expire(key, 2 * 24 * 60 * 60);
    }

    async sentToday(tenantId: number): Promise<number> {
        const raw = await this.counter.get(dayKey(tenantId)).catch(() => null);
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    // ── Configuración ────────────────────────────────────────────────────

    async status(tenantId: number): Promise<TenantMailStatus> {
        const [{ choice, smtpConfigured }, connections] = await Promise.all([
            this.read(tenantId),
            this.connectors.mailCapableConnections(tenantId),
        ]);
        const candidates = connections.map(toCandidate);
        let account: TenantMailStatus['account'] = null;
        if (choice) {
            const conn = connections.find((c) => c.id === choice.connection_id) ?? null;
            const limits = conn ? MAIL_ACCOUNT_LIMITS[mailAccountKind(conn.integration, conn.address)] : null;
            account = {
                connection_id: choice.connection_id,
                name: conn?.name ?? null,
                integration: conn?.integration ?? null,
                address: conn?.address ?? null,
                limits: limits ? { ...limits } : null,
                sent_today: await this.sentToday(tenantId),
                problem: conn
                    ? conn.problem
                    : 'La cuenta elegida ya no existe: los correos de la empresa no están saliendo. Elige otra o vuelve al correo de la plataforma.',
            };
        }
        return {
            mode: choice ? 'account' : smtpConfigured ? 'smtp' : 'platform',
            smtp_configured: smtpConfigured,
            account,
            candidates,
            notes: [...MAIL_ACCOUNT_NOTES],
        };
    }

    /**
     * Elegir la cuenta. Tiene que ser del EQUIPO (no privada: el correo de la
     * empresa no puede depender de una conexión que los demás admins ni ven) y
     * estar autorizada — si no, el primer correo fallaría.
     */
    async set(tenantId: number, connectionId: number): Promise<{ name: string; address: string | null }> {
        const conn = (await this.connectors.mailCapableConnections(tenantId)).find((c) => c.id === connectionId);
        if (!conn) {
            throw new BadRequestException({
                code: 'mail_account_not_found',
                message: 'Esa conexión no existe o no es de Gmail ni de Outlook.',
                data: { status: 400 },
            });
        }
        if (conn.visibility !== 'workspace') {
            throw new BadRequestException({
                code: 'mail_account_private',
                message: `«${conn.name}» es una conexión privada. Para el correo de la empresa usa una conexión del equipo (visible para los demás administradores).`,
                data: { status: 400 },
            });
        }
        if (conn.problem) {
            throw new BadRequestException({
                code: 'mail_account_not_ready',
                message: conn.problem,
                data: { status: 400 },
            });
        }
        await this.write(tenantId, (settings) => {
            settings.mail_account = { connection_id: connectionId } satisfies StoredChoice;
        });
        return { name: conn.name, address: conn.address };
    }

    async clear(tenantId: number): Promise<void> {
        await this.write(tenantId, (settings) => {
            delete settings.mail_account;
        });
    }

    // ── Internos ─────────────────────────────────────────────────────────

    private async read(tenantId: number): Promise<{ choice: StoredChoice | null; smtpConfigured: boolean }> {
        const [row] = await this.db
            .select({ settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const settings = (row?.settings ?? {}) as Record<string, unknown>;
        const raw = settings.mail_account as { connection_id?: unknown } | undefined;
        const id = Number(raw?.connection_id);
        return {
            choice: Number.isInteger(id) && id > 0 ? { connection_id: id } : null,
            smtpConfigured: typeof settings.smtp === 'object' && settings.smtp !== null,
        };
    }

    private async write(tenantId: number, mutate: (settings: Record<string, unknown>) => void): Promise<void> {
        const [row] = await this.db
            .select({ settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const settings = { ...((row?.settings ?? {}) as Record<string, unknown>) };
        mutate(settings);
        await this.db.update(tenants).set({ settings, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
    }
}

function toCandidate(c: MailCapableConnection): MailAccountCandidate {
    return {
        connection_id: c.id,
        name: c.name,
        integration: c.integration,
        address: c.address,
        shared: c.visibility === 'workspace',
        ready: c.problem === null,
        problem: c.problem,
    };
}
