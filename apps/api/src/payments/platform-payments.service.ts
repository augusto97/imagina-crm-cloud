import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PlatformPaymentsView, UpdatePlatformPaymentsInput } from '@imagina-base/shared';
import { z } from 'zod';
import { decryptSecret, encryptSecret, isEncrypted } from '../common/secret-box';
import { ENV, type Env } from '../config/env';
import { secretHint } from '../connectors/connection-parts';
import { REDIS } from '../redis/redis.module';

/** Subconjunto de ioredis: se testea con un fake en memoria. */
export interface PaymentsSettingsStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
    del(key: string): Promise<unknown>;
}

const KEY = 'platform:payments';

const storedSchema = z.object({
    mercadopago: z
        .object({
            access_token_enc: z.string().nullable().default(null),
            webhook_secret_enc: z.string().nullable().default(null),
        })
        .default({}),
});
type Stored = z.infer<typeof storedSchema>;

/** Credenciales de Mercado Pago listas para usar. */
export interface MercadoPagoCreds {
    accessToken: string;
    webhookSecret: string;
}

/**
 * Credenciales con las que la PLATAFORMA cobra sus planes (v0.1.250). Se
 * cargan desde Plataforma → Cobros (Redis `platform:payments`, cifradas con
 * `SECRETS_KEY`: viajan en el snapshot de ADR-S20) y el `.env` queda como
 * respaldo — así el operador no tiene que entrar al servidor para empezar a
 * cobrar ni para rotar una clave.
 */
@Injectable()
export class PlatformPaymentsService {
    private readonly logger = new Logger(PlatformPaymentsService.name);

    constructor(
        @Inject(REDIS) private readonly redis: PaymentsSettingsStore,
        @Inject(ENV) private readonly env: Env,
    ) {}

    webhookUrl(): string {
        return `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/api/v1/billing/webhook/mercadopago`;
    }

    /** Las de la consola si están; si no, las del `.env`. `null` = sin configurar. */
    async mercadoPago(): Promise<MercadoPagoCreds | null> {
        const stored = (await this.read()).mercadopago;
        const token = this.open(stored.access_token_enc);
        if (token) return { accessToken: token, webhookSecret: this.open(stored.webhook_secret_enc) ?? '' };
        if (this.env.MERCADOPAGO_ACCESS_TOKEN) {
            return {
                accessToken: this.env.MERCADOPAGO_ACCESS_TOKEN,
                webhookSecret: this.env.MERCADOPAGO_WEBHOOK_SECRET,
            };
        }
        return null;
    }

    async view(): Promise<PlatformPaymentsView> {
        const stored = (await this.read()).mercadopago;
        const consoleToken = this.open(stored.access_token_enc);
        const creds = await this.mercadoPago();
        return {
            mercadopago: {
                configured: creds !== null,
                from_env: consoleToken === null && creds !== null,
                mode: creds ? (creds.accessToken.startsWith('TEST-') ? 'test' : 'live') : null,
                access_token_hint: creds ? secretHint(creds.accessToken) : null,
                webhook_secret_set: Boolean(creds?.webhookSecret),
                webhook_url: this.webhookUrl(),
            },
            paypal: { configured: this.env.PAYPAL_CLIENT_ID !== '' && this.env.PAYPAL_CLIENT_SECRET !== '' },
        };
    }

    async update(input: UpdatePlatformPaymentsInput): Promise<PlatformPaymentsView> {
        if (input.clear_mercadopago) {
            await this.redis.del(KEY);
            return this.view();
        }
        const stored = await this.read();
        const mp = { ...stored.mercadopago };
        if (input.mercadopago_access_token) {
            mp.access_token_enc = encryptSecret(input.mercadopago_access_token, this.env.SECRETS_KEY);
        }
        if (input.mercadopago_webhook_secret) {
            mp.webhook_secret_enc = encryptSecret(input.mercadopago_webhook_secret, this.env.SECRETS_KEY);
        }
        await this.redis.set(KEY, JSON.stringify({ ...stored, mercadopago: mp } satisfies Stored));
        return this.view();
    }

    private async read(): Promise<Stored> {
        try {
            const raw = await this.redis.get(KEY);
            const parsed = storedSchema.safeParse(raw ? JSON.parse(raw) : {});
            return parsed.success ? parsed.data : storedSchema.parse({});
        } catch {
            return storedSchema.parse({});
        }
    }

    /** Descifra; ilegible (cambió `SECRETS_KEY`) o sin clave para descifrar → null, con aviso. */
    private open(enc: string | null): string | null {
        if (!enc) return null;
        if (isEncrypted(enc) && !this.env.SECRETS_KEY) return null;
        try {
            return decryptSecret(enc, this.env.SECRETS_KEY);
        } catch {
            this.logger.error('Credencial de cobro ilegible (cambió SECRETS_KEY): volvé a cargarla en Plataforma → Cobros.');
            return null;
        }
    }
}
