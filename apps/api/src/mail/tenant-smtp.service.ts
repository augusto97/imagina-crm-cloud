import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
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
/** Config vacía de respaldo cuando ni los campos no-secretos parsean. */
const FALLBACK_CONFIG: SmtpConfig = { host: '', port: 587, secure: false, user: '', pass: '', from: '' };

/** Estado de lo guardado: sin configurar / usable / configurado pero roto. */
type StoredSmtp =
    | { state: 'none' }
    | { state: 'ok'; config: SmtpConfig }
    | { state: 'unreadable'; reason: string; config: SmtpConfig };

/**
 * La empresa TIENE SMTP propio configurado pero no se puede usar (la
 * contraseña no descifra con la `SECRETS_KEY` actual). Es un error explícito
 * a propósito (v0.1.150): antes se caía al SMTP de plataforma —y de ahí al
 * transporte `log`— así que el correo se daba por enviado y no salía nunca.
 */
export class SmtpUnusableError extends Error {
    readonly code = 'smtp_unusable';
    constructor(reason: string) {
        super(
            `El SMTP de la empresa está configurado pero no se puede usar: ${reason}. ` +
                'Volvé a escribir la contraseña en Ajustes → Correo (SMTP).',
        );
    }
}

@Injectable()
export class TenantSmtpService {
    private readonly logger = new Logger(TenantSmtpService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
    ) {}

    /** Vista pública (sin password) para el panel de Ajustes. */
    async get(tenantId: number): Promise<SmtpConfigPublic> {
        const read = await this.read(tenantId);
        if (read.state === 'none') {
            return {
                configured: false,
                host: '',
                port: 587,
                secure: false,
                user: '',
                from: '',
                password_unreadable: false,
            };
        }
        // Con la contraseña ilegible el panel NO desaparece: muestra el resto
        // de la config y avisa que hay que reescribirla (v0.1.150).
        return {
            configured: true,
            host: read.config.host,
            port: read.config.port,
            secure: read.config.secure,
            user: read.config.user,
            from: read.config.from,
            password_unreadable: read.state === 'unreadable',
        };
    }

    /** Guarda/actualiza la config. `pass` vacío = conservar la contraseña previa. */
    async update(tenantId: number, input: SmtpConfig): Promise<SmtpConfigPublic> {
        const previous = await this.read(tenantId);
        if (input.pass === '' && previous.state === 'unreadable') {
            // No hay contraseña que conservar: la guardada no se puede leer.
            // Guardar igual dejaría el SMTP roto en silencio otra vez.
            throw new BadRequestException({
                code: 'smtp_password_required',
                message:
                    'No se puede leer la contraseña guardada (cambió la clave de cifrado del servidor). Escribila de nuevo para volver a habilitar el envío.',
                data: { status: 400 },
            });
        }
        const pass = input.pass !== '' ? input.pass : previous.state === 'ok' ? previous.config.pass : '';
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
     *
     * Si TIENE config propia pero es inusable, LANZA (v0.1.150). Antes devolvía
     * null y el correo terminaba en el transporte `log`: la app decía "enviado"
     * y no salía nada. Un fallo ruidoso es la única forma de que se note.
     */
    async getForSend(tenantId: number): Promise<SmtpConfig | null> {
        const read = await this.read(tenantId);
        if (read.state === 'unreadable') {
            this.logger.error(`SMTP del tenant ${tenantId} inusable: ${read.reason}`);
            throw new SmtpUnusableError(read.reason);
        }
        return read.state === 'ok' ? read.config : null;
    }

    // ── Internos ─────────────────────────────────────────────────────────

    /**
     * Lee la config guardada distinguiendo TRES estados — es lo que permite no
     * mentir: `none` (no configuró), `ok` (usable) y `unreadable` (configuró,
     * pero hoy no se puede armar el transporte).
     */
    private async read(tenantId: number): Promise<StoredSmtp> {
        const [row] = await this.db
            .select({ settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const raw = (row?.settings as Record<string, unknown> | undefined)?.smtp;
        if (!raw || typeof raw !== 'object') return { state: 'none' };
        const { pass_enc, ...rest } = raw as Record<string, unknown> & { pass_enc?: string | null };
        const partial = smtpConfigSchema.safeParse({ ...rest, pass: '' });
        let pass = '';
        try {
            pass = pass_enc ? decryptSecret(pass_enc, this.env.SECRETS_KEY) : '';
        } catch {
            return {
                state: 'unreadable',
                reason: 'la contraseña guardada no se puede descifrar con la clave actual del servidor',
                config: partial.success ? partial.data : FALLBACK_CONFIG,
            };
        }
        const parsed = smtpConfigSchema.safeParse({ ...rest, pass });
        if (!parsed.success) {
            return {
                state: 'unreadable',
                reason: 'la configuración guardada está incompleta',
                config: partial.success ? partial.data : FALLBACK_CONFIG,
            };
        }
        return { state: 'ok', config: parsed.data };
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
