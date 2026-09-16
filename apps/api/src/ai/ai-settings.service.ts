import { Inject, Injectable, Logger } from '@nestjs/common';
import {
    DEFAULT_AI_MODEL,
    aiModelSchema,
    type AiKeySource,
    type AiModel,
    type PlatformAiSettings,
    type TenantAiSettings,
    type UpdatePlatformAiSettingsInput,
    type UpdateTenantAiSettingsInput,
} from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { z } from 'zod';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { tenants } from '../db/schema';
import { REDIS } from '../redis/redis.module';

const PLATFORM_KEY = 'platform:ai';

/** Lo que se guarda en Redis (plataforma). La clave va cifrada (secret-box). */
const storedPlatformSchema = z.object({
    enabled: z.boolean().default(false),
    api_key_enc: z.string().nullable().default(null),
    model: aiModelSchema.default(DEFAULT_AI_MODEL),
    share_platform_key: z.boolean().default(true),
    allow_tenant_keys: z.boolean().default(true),
});
type StoredPlatform = z.infer<typeof storedPlatformSchema>;

/** Lo que se guarda en `tenants.settings.ai`. */
const storedTenantSchema = z.object({
    enabled: z.boolean().default(false),
    api_key_enc: z.string().nullable().default(null),
    model: aiModelSchema.nullable().default(null),
});
type StoredTenant = z.infer<typeof storedTenantSchema>;

/** Con qué hablar con el proveedor para UN pedido (clave en claro). */
export interface ResolvedAiAccess {
    apiKey: string;
    model: AiModel;
    source: AiKeySource;
}

/** El asistente no está disponible para esta empresa; el motivo es legible. */
export class AiUnavailableError extends Error {
    readonly code = 'ai_unavailable';
    constructor(
        message: string,
        readonly reason: string,
    ) {
        super(message);
    }
}

/**
 * Configuración del asistente IA (ADR-S21) en dos niveles, mismo criterio que
 * el SMTP: la PLATAFORMA (Redis `platform:ai`, superadmin) y la EMPRESA
 * (`tenants.settings.ai`, admin del workspace). Las claves se cifran en
 * reposo con `SECRETS_KEY` y jamás salen en un GET (sólo los últimos 4).
 *
 * Resolución para un pedido: la empresa tiene que haber ACTIVADO el
 * asistente (opt-in: sus esquemas viajan a un proveedor externo); después
 * manda su clave propia si la cargó y la plataforma lo permite; si no, la de
 * la plataforma si está compartida. Sin ninguna → `AiUnavailableError` con el
 * motivo para que la UI diga qué falta, en vez de fallar en silencio.
 */
@Injectable()
export class AiSettingsService {
    private readonly logger = new Logger(AiSettingsService.name);

    constructor(
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
    ) {}

    // ── Plataforma ───────────────────────────────────────────────────────

    async getPlatform(): Promise<PlatformAiSettings> {
        const stored = await this.readPlatform();
        const key = this.decryptKey(stored.api_key_enc);
        const envKey = this.env.AI_API_KEY || null;
        const effective = key.state === 'ok' && key.value ? key.value : envKey;
        return {
            enabled: stored.enabled,
            has_key: effective !== null,
            key_hint: effective ? hint(effective) : null,
            key_unreadable: key.state === 'unreadable',
            model: stored.model,
            share_platform_key: stored.share_platform_key,
            allow_tenant_keys: stored.allow_tenant_keys,
        };
    }

    async updatePlatform(patch: UpdatePlatformAiSettingsInput): Promise<PlatformAiSettings> {
        const stored = await this.readPlatform();
        const next: StoredPlatform = { ...stored };
        if (patch.enabled !== undefined) next.enabled = patch.enabled;
        if (patch.model !== undefined) next.model = patch.model;
        if (patch.share_platform_key !== undefined) next.share_platform_key = patch.share_platform_key;
        if (patch.allow_tenant_keys !== undefined) next.allow_tenant_keys = patch.allow_tenant_keys;
        if (patch.clear_key) next.api_key_enc = null;
        if (patch.api_key) next.api_key_enc = encryptSecret(patch.api_key, this.env.SECRETS_KEY);
        await this.redis.set(PLATFORM_KEY, JSON.stringify(next));
        return this.getPlatform();
    }

    // ── Empresa ──────────────────────────────────────────────────────────

    async getTenant(tenantId: number): Promise<TenantAiSettings> {
        const [stored, platform] = await Promise.all([this.readTenant(tenantId), this.readPlatform()]);
        const key = this.decryptKey(stored.api_key_enc);
        return {
            enabled: stored.enabled,
            has_own_key: stored.api_key_enc !== null,
            key_hint: key.state === 'ok' && key.value ? hint(key.value) : null,
            key_unreadable: key.state === 'unreadable',
            model: stored.model,
            platform: {
                enabled: platform.enabled,
                share_platform_key: platform.share_platform_key,
                allow_tenant_keys: platform.allow_tenant_keys,
                default_model: platform.model,
            },
        };
    }

    async updateTenant(tenantId: number, patch: UpdateTenantAiSettingsInput): Promise<TenantAiSettings> {
        const stored = await this.readTenant(tenantId);
        const next: StoredTenant = { ...stored };
        if (patch.enabled !== undefined) next.enabled = patch.enabled;
        if (patch.model !== undefined) next.model = patch.model;
        if (patch.clear_key) next.api_key_enc = null;
        if (patch.api_key) next.api_key_enc = encryptSecret(patch.api_key, this.env.SECRETS_KEY);
        await this.writeTenant(tenantId, next);
        return this.getTenant(tenantId);
    }

    /** Clave de la plataforma en claro (guardada, o del env). Sólo para el botón "Probar". */
    async platformKey(): Promise<string | null> {
        const stored = await this.readPlatform();
        const key = this.decryptKey(stored.api_key_enc);
        if (key.state === 'ok' && key.value) return key.value;
        return this.env.AI_API_KEY || null;
    }

    /** La empresa tiene clave propia USABLE → sus pedidos no consumen cuota. */
    async tenantHasOwnKey(tenantId: number): Promise<boolean> {
        const [stored, platform] = await Promise.all([this.readTenant(tenantId), this.readPlatform()]);
        if (!platform.allow_tenant_keys) return false;
        return this.decryptKey(stored.api_key_enc).state === 'ok' && stored.api_key_enc !== null;
    }

    // ── Resolución para un pedido ────────────────────────────────────────

    /**
     * Decide con qué clave y modelo se habla. Lanza `AiUnavailableError` con
     * un motivo accionable cuando no se puede.
     */
    async resolve(tenantId: number): Promise<ResolvedAiAccess> {
        const [tenant, platform] = await Promise.all([this.readTenant(tenantId), this.readPlatform()]);
        if (!platform.enabled) {
            throw new AiUnavailableError('El asistente está desactivado en la plataforma.', 'platform_disabled');
        }
        if (!tenant.enabled) {
            throw new AiUnavailableError(
                'El asistente no está activado para esta empresa. Un administrador puede activarlo en Ajustes → Asistente IA.',
                'tenant_disabled',
            );
        }
        const model = tenant.model ?? platform.model;
        if (platform.allow_tenant_keys && tenant.api_key_enc) {
            const key = this.decryptKey(tenant.api_key_enc);
            if (key.state === 'unreadable') {
                throw new AiUnavailableError(
                    'La clave IA de la empresa no se puede descifrar con la clave actual del servidor. Volvé a escribirla en Ajustes → Asistente IA.',
                    'tenant_key_unreadable',
                );
            }
            if (key.value) return { apiKey: key.value, model, source: 'tenant' };
        }
        if (!platform.share_platform_key) {
            throw new AiUnavailableError(
                'La plataforma no comparte su clave IA: la empresa tiene que cargar la suya en Ajustes → Asistente IA.',
                'own_key_required',
            );
        }
        const pk = this.decryptKey(platform.api_key_enc);
        if (pk.state === 'unreadable') {
            throw new AiUnavailableError(
                'La clave IA de la plataforma no se puede descifrar con la clave actual del servidor.',
                'platform_key_unreadable',
            );
        }
        const apiKey = pk.value || this.env.AI_API_KEY;
        if (!apiKey) {
            throw new AiUnavailableError(
                'La plataforma no tiene una clave IA configurada (Plataforma → Asistente IA).',
                'platform_key_missing',
            );
        }
        return { apiKey, model, source: 'platform' };
    }

    // ── Internos ─────────────────────────────────────────────────────────

    private async readPlatform(): Promise<StoredPlatform> {
        const raw = await this.redis.get(PLATFORM_KEY);
        if (!raw) return storedPlatformSchema.parse({});
        try {
            return storedPlatformSchema.parse(JSON.parse(raw));
        } catch (err) {
            this.logger.warn(`platform:ai corrupto, se usan defaults: ${err instanceof Error ? err.message : String(err)}`);
            return storedPlatformSchema.parse({});
        }
    }

    private async readTenant(tenantId: number): Promise<StoredTenant> {
        const [row] = await this.db
            .select({ settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const raw = (row?.settings as Record<string, unknown> | undefined)?.ai;
        const parsed = storedTenantSchema.safeParse(raw ?? {});
        return parsed.success ? parsed.data : storedTenantSchema.parse({});
    }

    private async writeTenant(tenantId: number, ai: StoredTenant): Promise<void> {
        const [row] = await this.db
            .select({ settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const settings = { ...(row?.settings ?? {}) } as Record<string, unknown>;
        settings.ai = ai;
        await this.db.update(tenants).set({ settings, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
    }

    private decryptKey(enc: string | null): { state: 'ok'; value: string | null } | { state: 'unreadable' } {
        if (!enc) return { state: 'ok', value: null };
        try {
            return { state: 'ok', value: decryptSecret(enc, this.env.SECRETS_KEY) };
        } catch {
            return { state: 'unreadable' };
        }
    }
}

/** Últimos 4 caracteres, para reconocer la clave sin exponerla. */
function hint(key: string): string {
    return `…${key.slice(-4)}`;
}
