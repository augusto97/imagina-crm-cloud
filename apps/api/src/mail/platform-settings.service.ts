import { Inject, Injectable } from '@nestjs/common';
import { smtpConfigSchema, type SmtpConfig } from '@imagina-base/shared';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

const SMTP_KEY = 'platform:smtp';

/**
 * Config de plataforma (superadmin) en Redis. Hoy: SMTP. El MailService la lee
 * en cada envío (con fallback al transporte por env) para que cambiar el SMTP
 * desde Ajustes no requiera reiniciar el servidor.
 */
@Injectable()
export class PlatformSettingsService {
    constructor(@Inject(REDIS) private readonly redis: Redis) {}

    async getSmtp(): Promise<SmtpConfig | null> {
        const raw = await this.redis.get(SMTP_KEY);
        if (!raw) return null;
        try {
            const parsed = smtpConfigSchema.safeParse(JSON.parse(raw));
            return parsed.success ? parsed.data : null;
        } catch {
            return null;
        }
    }

    async setSmtp(config: SmtpConfig): Promise<void> {
        await this.redis.set(SMTP_KEY, JSON.stringify(config));
    }

    async clearSmtp(): Promise<void> {
        await this.redis.del(SMTP_KEY);
    }
}
