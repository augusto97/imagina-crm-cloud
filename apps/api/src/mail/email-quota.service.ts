import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { PlansService } from '../billing/plans.service';
import { DRIZZLE, type Db } from '../db/client';
import { emailUsage, tenants } from '../db/schema';

/**
 * La empresa agotó su cuota mensual de correos por el SMTP de la PLATAFORMA
 * (ADR-S18). Es un error explícito: el envío NO se hace y quien lo disparó se
 * entera (el run de la automatización queda `failed` con el motivo, el botón
 * del portal avisa). Configurar SMTP propio lo levanta al instante.
 */
export class EmailQuotaExceededError extends Error {
    readonly code = 'email_quota_reached';
    constructor(
        readonly used: number,
        readonly limit: number,
    ) {
        super(
            `Se alcanzó el límite de correos del plan para este mes (${used}/${limit}). ` +
                'Configurá el SMTP propio de tu empresa en Ajustes → Correo (SMTP) para enviar sin límite, o pasá a un plan mayor.',
        );
    }
}

/** Mes en curso en UTC (`YYYY-MM`) — el mismo criterio naive-UTC de toda la app. */
export function periodOf(now: Date = new Date()): string {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Cuota mensual de correos por empresa (ADR-S18).
 *
 * Sólo cuentan los correos que salen por el SMTP DE LA PLATAFORMA: son los que
 * paga el operador (envío + reputación del dominio remitente). Si la empresa
 * configuró su propio SMTP, sus correos no pasan por acá — ni se cuentan ni se
 * limitan. Los correos de CUENTA (reset de contraseña, verificación de email,
 * invitaciones de plataforma) no tienen tenant y por eso nunca se bloquean:
 * frenarlos dejaría a alguien afuera de su propia cuenta.
 *
 * Corre sobre la conexión base (el worker de la cola es cross-tenant).
 */
@Injectable()
export class EmailQuotaService {
    private readonly logger = new Logger(EmailQuotaService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly plans: PlansService,
    ) {}

    /** Correos ya enviados por la plataforma en el mes en curso. */
    async usedThisMonth(tenantId: number, now: Date = new Date()): Promise<number> {
        const [row] = await this.db
            .select({ sent: emailUsage.sent })
            .from(emailUsage)
            .where(and(eq(emailUsage.tenantId, tenantId), eq(emailUsage.period, periodOf(now))))
            .limit(1);
        return row?.sent ?? 0;
    }

    /** Límite del plan de la empresa. `null` = ilimitado. */
    async limitFor(tenantId: number): Promise<number | null> {
        const [row] = await this.db
            .select({ plan: tenants.plan })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        if (!row) return null;
        const limits = await this.plans.limits(row.plan);
        return limits.max_emails_month;
    }

    /** Lanza si la empresa ya agotó su cuota del mes. */
    async assertWithinQuota(tenantId: number, now: Date = new Date()): Promise<void> {
        const limit = await this.limitFor(tenantId);
        if (limit === null) return;
        const used = await this.usedThisMonth(tenantId, now);
        if (used >= limit) throw new EmailQuotaExceededError(used, limit);
    }

    /**
     * Suma un correo al mes en curso. Se llama DESPUÉS de un envío exitoso: un
     * correo que no salió no consume cuota.
     */
    async record(tenantId: number, now: Date = new Date()): Promise<void> {
        const period = periodOf(now);
        await this.db
            .insert(emailUsage)
            .values({ tenantId, period, sent: 1 })
            .onConflictDoUpdate({
                target: [emailUsage.tenantId, emailUsage.period],
                set: { sent: sql`${emailUsage.sent} + 1`, updatedAt: new Date() },
            });
    }

    /** Uso + límite para el resumen de facturación y la consola de operador. */
    async summary(tenantId: number, now: Date = new Date()): Promise<{ used: number; limit: number | null }> {
        const [limit, used] = await Promise.all([this.limitFor(tenantId), this.usedThisMonth(tenantId, now)]);
        return { used, limit };
    }
}
