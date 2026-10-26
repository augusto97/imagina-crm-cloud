import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type Redis from 'ioredis';
import { z } from 'zod';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';
import { generateVapidKeys, type VapidKeys } from './web-push';

/**
 * H1 — Las llaves VAPID de ESTA instalación.
 *
 * Se generan UNA vez (la primera vez que alguien las necesita) y viven en
 * `platform:push` de Redis, como el resto de los ajustes globales: así viajan
 * en el snapshot del servidor (ADR-S20). Regenerarlas mataría TODAS las
 * suscripciones (cada navegador se suscribió con la pública de este par), por
 * eso nunca se pisan: `SET NX` para que dos nodos que arrancan juntos no
 * generen dos pares distintos. La privada va cifrada con `SECRETS_KEY`.
 */
const KEY = 'platform:push';

const storedSchema = z.object({
    public_key: z.string().min(80),
    private_key_enc: z.string().min(1),
    created_at: z.string(),
});

@Injectable()
export class PushKeysService {
    private readonly logger = new Logger(PushKeysService.name);
    private cached: VapidKeys | null = null;

    constructor(
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
    ) {}

    /** Las llaves (las crea si no existen). Lanza 503 si la privada no se puede leer. */
    async keys(): Promise<VapidKeys> {
        if (this.cached) return this.cached;
        let stored = await this.read();
        if (!stored) {
            const fresh = generateVapidKeys();
            const value = JSON.stringify({
                public_key: fresh.publicKey,
                private_key_enc: encryptSecret(fresh.privateKey, this.env.SECRETS_KEY),
                created_at: new Date().toISOString(),
            });
            const won = await this.redis.set(KEY, value, 'NX');
            if (won === 'OK') this.logger.log('Llaves VAPID de push generadas para esta instalación');
            stored = await this.read();
            if (!stored) throw new ServiceUnavailableException({ code: 'push_unavailable', message: 'No se pudieron guardar las llaves de push', data: { status: 503 } });
        }
        let privateKey: string;
        try {
            privateKey = decryptSecret(stored.private_key_enc, this.env.SECRETS_KEY);
        } catch {
            // Otra SECRETS_KEY (se cambió la clave del servidor): las llaves
            // existen pero no se pueden usar. NO se regeneran solas — eso
            // dejaría muertas todas las suscripciones sin avisar.
            throw new ServiceUnavailableException({
                code: 'push_keys_unreadable',
                message: 'Las llaves de las notificaciones push no se pueden leer con la clave de cifrado actual de este servidor.',
                data: { status: 503 },
            });
        }
        if (privateKey.startsWith('enc:')) {
            throw new ServiceUnavailableException({
                code: 'push_keys_unreadable',
                message: 'Las llaves de las notificaciones push están cifradas y este servidor no tiene SECRETS_KEY.',
                data: { status: 503 },
            });
        }
        this.cached = { publicKey: stored.public_key, privateKey };
        return this.cached;
    }

    async publicKey(): Promise<string> {
        return (await this.keys()).publicKey;
    }

    /**
     * Contacto que viaja en el JWT (`sub`, RFC 8292): Apple lo exige y los
     * servicios lo usan para avisar de abusos. La URL pública de la app si es
     * https; si no, la dirección del remitente de los correos.
     */
    subject(): string {
        const base = this.env.APP_BASE_URL.replace(/\/+$/, '');
        if (base.startsWith('https://')) return base;
        const addr = /<([^>]+)>/.exec(this.env.MAIL_FROM)?.[1] ?? this.env.MAIL_FROM.trim();
        return /^[^\s@]+@[^\s@]+$/.test(addr) ? `mailto:${addr}` : 'mailto:no-reply@imagina.base';
    }

    private async read(): Promise<z.infer<typeof storedSchema> | null> {
        const raw = await this.redis.get(KEY);
        if (!raw) return null;
        try {
            const parsed = storedSchema.safeParse(JSON.parse(raw));
            return parsed.success ? parsed.data : null;
        } catch {
            return null;
        }
    }
}
