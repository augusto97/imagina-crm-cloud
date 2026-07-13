import { Inject, Injectable, Logger } from '@nestjs/common';
import {
    smtpConfigSchema,
    type SmtpConfig,
    type SmtpConfigPublic,
} from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { tenants } from '../db/schema';

/**
 * SMTP por empresa (white-label de correo): cada tenant puede configurar su
 * propio servidor y sus correos (automatizaciones, magic links, invitaciones)
 * salen por él; sin config propia, cae al SMTP de PLATAFORMA y de ahí al
 * transporte por env — la cadena la resuelve MailService en cada envío.
 *
 * La config vive en `tenants.settings.smtp` (jsonb, sin migración) con la
 * contraseña cifrada en reposo vía el secret-box de SEC-20 (`SECRETS_KEY`;
 * sin clave configurada degrada a claro, igual que el SMTP de plataforma). El GET público jamás devuelve
 * la contraseña; en el PATCH, un `pass` vacío conserva la guardada.
 *
 * Las lecturas para ENVÍO usan la conexión base (el worker de la cola es
 * cross-tenant); las de configuración llegan con el tenant ya autenticado por
 * el controller (rol admin del workspace).
 */
@Injectable()
export class TenantSmtpService {
    private readonly logger = new Logger(TenantSmtpService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
    ) {}

    /** Vista pública (sin password) para el panel de Ajustes. */
    async get(tenantId: number): Promise<SmtpConfigPublic> {
        const stored = await this.readStored(tenantId);
        if (!stored) {
            return { configured: false, host: '', port: 587, secure: false, user: '', from: '' };
        }
        return {
            configured: true,
            host: stored.host,
            port: stored.port,
            secure: stored.secure,
            user: stored.user,
            from: stored.from,
        };
    }

    /** Guarda/actualiza la config. `pass` vacío = conservar la contraseña previa. */
    async update(tenantId: number, input: SmtpConfig): Promise<SmtpConfigPublic> {
        const previous = await this.readStored(tenantId);
        const pass = input.pass !== '' ? input.pass : (previous?.pass ?? '');
        await this.writeSettings(tenantId, {
            host: input.host,
            port: input.port,
            secure: input.secure,
            user: input.user,
            from: input.from,
            pass_enc: pass !== '' ? encryptSecret(pass, this.env.SECRETS_KEY) : null,
        });
        return this.get(tenantId);
    }

    /** Borra la config del tenant → sus correos vuelven al SMTP de plataforma. */
    async clear(tenantId: number): Promise<void> {
        await this.writeSettings(tenantId, null);
    }

    /**
     * Config lista para armar el transporte de un ENVÍO (password en claro).
     * `null` = el tenant no tiene SMTP propio (usar plataforma/env).
     */
    async getForSend(tenantId: number): Promise<SmtpConfig | null> {
        try {
            return await this.readStored(tenantId);
        } catch (err) {
            this.logger.warn(`SMTP del tenant ${tenantId} ilegible, uso fallback: ${String(err)}`);
            return null;
        }
    }

    // ── Internos ─────────────────────────────────────────────────────────

    private async readStored(tenantId: number): Promise<SmtpConfig | null> {
        const [row] = await this.db
            .select({ settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const raw = (row?.settings as Record<string, unknown> | undefined)?.smtp;
        if (!raw || typeof raw !== 'object') return null;
        const { pass_enc, ...rest } = raw as Record<string, unknown> & { pass_enc?: string | null };
        const parsed = smtpConfigSchema.safeParse({
            ...rest,
            pass: pass_enc ? decryptSecret(pass_enc, this.env.SECRETS_KEY) : '',
        });
        return parsed.success ? parsed.data : null;
    }

    private async writeSettings(tenantId: number, smtp: Record<string, unknown> | null): Promise<void> {
        const [row] = await this.db
            .select({ settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const settings = { ...(row?.settings ?? {}) } as Record<string, unknown>;
        if (smtp === null) {
            delete settings.smtp;
        } else {
            settings.smtp = smtp;
        }
        await this.db
            .update(tenants)
            .set({ settings, updatedAt: new Date() })
            .where(eq(tenants.id, tenantId));
    }


}
