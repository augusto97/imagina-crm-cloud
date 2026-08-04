import { Inject, Injectable } from '@nestjs/common';
import { smtpConfigSchema, type SmtpConfig } from '@imagina-base/shared';
import type Redis from 'ioredis';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';

const SMTP_KEY = 'platform:smtp';

const EMPTY: SmtpConfig = { host: '', port: 587, secure: false, user: '', pass: '', from: '' };

/** El SMTP de plataforma está configurado pero no se puede usar (v0.1.150). */
export class PlatformSmtpUnusableError extends Error {
    readonly code = 'smtp_unusable';
    constructor(reason: string) {
        super(
            `El SMTP de la plataforma está configurado pero no se puede usar: ${reason}. ` +
                'Volvé a escribir la contraseña en Plataforma → Correo.',
        );
    }
}

/**
 * Config de plataforma (superadmin) en Redis. Hoy: SMTP. El MailService la lee
 * en cada envío (con fallback al transporte por env) para que cambiar el SMTP
 * desde Ajustes no requiera reiniciar el servidor.
 *
 * SEC-20: el password SMTP se cifra en reposo si hay `SECRETS_KEY` (AES-GCM).
 * Sin clave, texto plano (actual). `decryptSecret` reconoce valores en claro
 * heredados, así habilitar el cifrado no requiere migrar los datos existentes.
 */
@Injectable()
export class PlatformSettingsService {
    constructor(
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
    ) {}

    /**
     * v0.1.150 — igual que el SMTP por empresa: se distingue "no configurado"
     * de "configurado pero inusable". Antes cualquier excepción (contraseña que
     * no descifra porque cambió `SECRETS_KEY`) devolvía `null` y el correo se
     * iba al transporte `log`: la app decía "enviado" y no salía nada.
     */
    async readSmtp(): Promise<
        { state: 'none' } | { state: 'ok'; config: SmtpConfig } | { state: 'unreadable'; reason: string; config: SmtpConfig }
    > {
        const raw = await this.redis.get(SMTP_KEY);
        if (!raw) return { state: 'none' };
        let parsed;
        try {
            parsed = smtpConfigSchema.safeParse(JSON.parse(raw));
        } catch {
            return { state: 'unreadable', reason: 'la configuración guardada está corrupta', config: EMPTY };
        }
        if (!parsed.success) {
            return { state: 'unreadable', reason: 'la configuración guardada está incompleta', config: EMPTY };
        }
        const cfg = parsed.data;
        if (cfg.pass) {
            try {
                cfg.pass = decryptSecret(cfg.pass, this.env.SECRETS_KEY);
            } catch {
                return {
                    state: 'unreadable',
                    reason: 'la contraseña guardada no se puede descifrar con la clave actual del servidor',
                    config: { ...cfg, pass: '' },
                };
            }
        }
        return { state: 'ok', config: cfg };
    }

    /** Config usable, o `null` si no hay. Lanza si hay una rota (no miente). */
    async getSmtp(): Promise<SmtpConfig | null> {
        const read = await this.readSmtp();
        if (read.state === 'unreadable') throw new PlatformSmtpUnusableError(read.reason);
        return read.state === 'ok' ? read.config : null;
    }

    async setSmtp(config: SmtpConfig): Promise<void> {
        const toStore: SmtpConfig = {
            ...config,
            ...(config.pass ? { pass: encryptSecret(config.pass, this.env.SECRETS_KEY) } : {}),
        };
        await this.redis.set(SMTP_KEY, JSON.stringify(toStore));
    }

    async clearSmtp(): Promise<void> {
        await this.redis.del(SMTP_KEY);
    }
}
