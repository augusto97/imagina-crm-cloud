import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
    INTEGRATION_PROVIDERS,
    INTEGRATION_PROVIDER_DEFS,
    type IntegrationProvider,
    type PlatformIntegrationApp,
    type UpdatePlatformIntegrationAppInput,
} from '@imagina-base/shared';
import { z } from 'zod';
import { decryptSecret, encryptSecret, isEncrypted } from '../common/secret-box';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';
import { secretHint } from './connection-parts';

/** Subconjunto de ioredis: se testea con un fake en memoria. */
export interface KeyValueStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
}

const KEY = 'platform:integrations';

const storedAppSchema = z.object({
    client_id: z.string().default(''),
    client_secret_enc: z.string().nullable().default(null),
});
const storedSchema = z.record(storedAppSchema);
type StoredApp = z.infer<typeof storedAppSchema>;

/** App del proveedor lista para usar (secreto en claro). */
export interface ResolvedProviderApp {
    provider: IntegrationProvider;
    clientId: string;
    clientSecret: string;
    authorizeUrl: string;
    tokenUrl: string;
}

/**
 * Apps OAuth que el OPERADOR registró en cada proveedor (v0.1.203, ADR-S22
 * fase 4). Viven en Redis como el resto de los ajustes de plataforma
 * (`platform:*`), así viajan solas en el snapshot de ADR-S20. El secreto va
 * cifrado con `SECRETS_KEY` y jamás sale en un GET.
 *
 * El client id identifica a la APP, no a una cuenta: cada empresa conecta su
 * propia cuenta de Google o Slack y sus tokens se guardan separados en su
 * conexión. Es exactamente lo que hace ClickUp con su app registrada.
 */
@Injectable()
export class IntegrationAppsService {
    private readonly logger = new Logger(IntegrationAppsService.name);

    constructor(
        @Inject(REDIS) private readonly redis: KeyValueStore,
        @Inject(ENV) private readonly env: Env,
    ) {}

    /** Vista para la consola (sin secretos). */
    async list(counts: Map<IntegrationProvider, number>): Promise<PlatformIntegrationApp[]> {
        const stored = await this.read();
        return INTEGRATION_PROVIDERS.map((provider) => this.view(provider, stored[provider], counts));
    }

    async configured(): Promise<Record<IntegrationProvider, boolean>> {
        const stored = await this.read();
        const out = {} as Record<IntegrationProvider, boolean>;
        for (const provider of INTEGRATION_PROVIDERS) {
            const app = stored[provider];
            out[provider] = this.readSecret(app) !== null && (app?.client_id ?? '') !== '';
        }
        return out;
    }

    async update(
        provider: IntegrationProvider,
        patch: UpdatePlatformIntegrationAppInput,
        counts: Map<IntegrationProvider, number>,
    ): Promise<PlatformIntegrationApp> {
        const stored = await this.read();
        if (patch.clear) {
            delete stored[provider];
        } else {
            const current: StoredApp = stored[provider] ?? { client_id: '', client_secret_enc: null };
            const next: StoredApp = { ...current };
            if (patch.client_id !== undefined) next.client_id = patch.client_id.trim();
            if (patch.client_secret !== undefined && patch.client_secret.trim() !== '') {
                next.client_secret_enc = encryptSecret(patch.client_secret.trim(), this.env.SECRETS_KEY);
            }
            stored[provider] = next;
        }
        await this.redis.set(KEY, JSON.stringify(stored));
        return this.view(provider, stored[provider], counts);
    }

    /**
     * La app lista para autorizar o renovar. Falla con un motivo LEGIBLE: la
     * empresa ve «Google no está disponible todavía», no un 500.
     */
    async resolve(provider: IntegrationProvider): Promise<ResolvedProviderApp> {
        const stored = await this.read();
        const app = stored[provider];
        const def = INTEGRATION_PROVIDER_DEFS[provider];
        const secret = this.readSecret(app);
        if (!app || app.client_id === '' || secret === null) {
            throw new BadRequestException({
                code: 'integration_provider_missing',
                message: `La conexión con ${def.label} no está disponible en esta plataforma todavía. El administrador de la plataforma tiene que configurarla en Plataforma → Integraciones.`,
                data: { status: 400 },
            });
        }
        return {
            provider,
            clientId: app.client_id,
            clientSecret: secret,
            authorizeUrl: def.authorize_url,
            tokenUrl: def.token_url,
        };
    }

    // ── Internos ─────────────────────────────────────────────────────────

    private view(
        provider: IntegrationProvider,
        app: StoredApp | undefined,
        counts: Map<IntegrationProvider, number>,
    ): PlatformIntegrationApp {
        const secret = this.readSecret(app);
        const unreadable = app?.client_secret_enc != null && secret === null;
        return {
            provider,
            configured: (app?.client_id ?? '') !== '' && secret !== null,
            client_id: app?.client_id ?? '',
            has_secret: app?.client_secret_enc != null,
            secret_hint: secret !== null ? secretHint(secret) : null,
            secret_unreadable: unreadable,
            connections: counts.get(provider) ?? 0,
        };
    }

    /** `null` = no hay secreto, o hay pero no se descifra (cambió la clave). */
    private readSecret(app: StoredApp | undefined): string | null {
        const raw = app?.client_secret_enc;
        if (!raw) return null;
        // Sin clave `decryptSecret` devuelve el texto cifrado tal cual: se
        // trata como ilegible, no como un secreto válido (lección de v0.1.150).
        if (isEncrypted(raw) && !this.env.SECRETS_KEY) return null;
        try {
            return decryptSecret(raw, this.env.SECRETS_KEY);
        } catch {
            return null;
        }
    }

    private async read(): Promise<Record<string, StoredApp>> {
        const raw = await this.redis.get(KEY);
        if (!raw) return {};
        try {
            return storedSchema.parse(JSON.parse(raw));
        } catch (err) {
            this.logger.warn(`${KEY} corrupto, se ignora: ${err instanceof Error ? err.message : String(err)}`);
            return {};
        }
    }
}
