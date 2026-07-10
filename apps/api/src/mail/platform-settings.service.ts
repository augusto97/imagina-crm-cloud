import { Inject, Injectable } from '@nestjs/common';
import { smtpConfigSchema, type SmtpConfig } from '@imagina-base/shared';
import type Redis from 'ioredis';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';

const SMTP_KEY = 'platform:smtp';

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

    async getSmtp(): Promise<SmtpConfig | null> {
        const raw = await this.redis.get(SMTP_KEY);
        if (!raw) return null;
        try {
            const parsed = smtpConfigSchema.safeParse(JSON.parse(raw));
            if (!parsed.success) return null;
            const cfg = parsed.data;
            if (cfg.pass) cfg.pass = decryptSecret(cfg.pass, this.env.SECRETS_KEY);
            return cfg;
        } catch {
            return null;
        }
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
