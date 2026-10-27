import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
    DEFAULT_AI_EFFORT,
    DEFAULT_AI_MODEL_CHOICE,
    FAST_AI_MODEL_FAMILY,
    aiEffortSchema,
    aiModelChoiceSchema,
    clampAiEffort,
    inferAiModelCaps,
    legacyModelToChoice,
    type AiEffort,
    type AiKeySource,
    type AiModelCaps,
    type AiModelCatalog,
    type AiModelChoice,
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
import { AiModelCatalogService } from './ai-model-catalog.service';

const PLATFORM_KEY = 'platform:ai';

/**
 * La elección de modelo guardada. v0.1.305: `model_choice` (`auto:<familia>`
 * o un id). Lo que dejaron versiones anteriores en `model` (un id de la vieja
 * lista fija) se lee como «el más reciente de esa familia». Todo tolerante:
 * un valor raro NUNCA vacía el resto de la configuración (antes, un modelo
 * fuera de la lista hacía caer la clave y los interruptores a los defaults).
 */
const lenientChoice = aiModelChoiceSchema.nullable().catch(null).default(null);
const lenientLegacy = z.string().nullable().catch(null).default(null);

/** Lo que se guarda en Redis (plataforma). La clave va cifrada (secret-box). */
const storedPlatformSchema = z.object({
    enabled: z.boolean().catch(false).default(false),
    api_key_enc: z.string().nullable().catch(null).default(null),
    model_choice: lenientChoice,
    model: lenientLegacy,
    // v0.1.306 — antes de poder elegirlo el asistente pedía `medium`.
    effort: aiEffortSchema.catch(DEFAULT_AI_EFFORT).default(DEFAULT_AI_EFFORT),
    share_platform_key: z.boolean().catch(true).default(true),
    allow_tenant_keys: z.boolean().catch(true).default(true),
});
type StoredPlatform = z.infer<typeof storedPlatformSchema>;

/** Lo que se guarda en `tenants.settings.ai`. */
const storedTenantSchema = z.object({
    enabled: z.boolean().catch(false).default(false),
    api_key_enc: z.string().nullable().catch(null).default(null),
    model_choice: lenientChoice,
    model: lenientLegacy,
    effort: aiEffortSchema.nullable().catch(null).default(null),
});
type StoredTenant = z.infer<typeof storedTenantSchema>;

function platformChoice(s: StoredPlatform): AiModelChoice {
    return s.model_choice ?? legacyModelToChoice(s.model) ?? DEFAULT_AI_MODEL_CHOICE;
}
function tenantChoice(s: StoredTenant): AiModelChoice | null {
    return s.model_choice ?? legacyModelToChoice(s.model);
}

/** Con qué hablar con el proveedor para UN pedido (clave en claro). */
export interface ResolvedAiAccess {
    apiKey: string;
    /** Id concreto que se manda al proveedor (ya resuelto). */
    model: string;
    /** Nombre legible del modelo. */
    modelName: string;
    /** Lo que se eligió (`auto:<familia>` o un id). */
    choice: AiModelChoice;
    /** Se eligió algo que esta clave no ve y se usa `model` en su lugar. */
    fallbackFrom: string | null;
    /** Lo que el modelo soporta (para armar el pedido: pensamiento, esfuerzo). */
    caps: AiModelCaps;
    /**
     * v0.1.306 — Nivel de esfuerzo que se manda, ya ajustado a lo que acepta
     * el modelo. `null` = el modelo no usa esfuerzo.
     */
    effort: AiEffort | null;
    source: AiKeySource;
}

/** Modelo para un pedido puntual (p. ej. los campos con IA en calidad «rápida»). */
export interface ResolvedAiModel {
    id: string;
    name: string;
    caps: AiModelCaps;
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

    private readonly catalogs: AiModelCatalogService;

    constructor(
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
        // v0.1.305 — catálogo de modelos del proveedor (por clave).
        @Optional() catalogs?: AiModelCatalogService,
    ) {
        this.catalogs = catalogs ?? new AiModelCatalogService(redis);
    }

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
            model: platformChoice(stored),
            effort: stored.effort,
            share_platform_key: stored.share_platform_key,
            allow_tenant_keys: stored.allow_tenant_keys,
        };
    }

    async updatePlatform(patch: UpdatePlatformAiSettingsInput): Promise<PlatformAiSettings> {
        const stored = await this.readPlatform();
        const next: StoredPlatform = { ...stored };
        if (patch.enabled !== undefined) next.enabled = patch.enabled;
        if (patch.model !== undefined) {
            next.model_choice = patch.model;
            next.model = null;
        }
        if (patch.effort !== undefined) next.effort = patch.effort;
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
            model: tenantChoice(stored),
            effort: stored.effort,
            effort_editable: this.usesOwnKey(stored, platform),
            platform: {
                enabled: platform.enabled,
                share_platform_key: platform.share_platform_key,
                allow_tenant_keys: platform.allow_tenant_keys,
                default_model: platformChoice(platform),
                default_effort: platform.effort,
            },
        };
    }

    async updateTenant(tenantId: number, patch: UpdateTenantAiSettingsInput): Promise<TenantAiSettings> {
        const stored = await this.readTenant(tenantId);
        const next: StoredTenant = { ...stored };
        if (patch.enabled !== undefined) next.enabled = patch.enabled;
        if (patch.model !== undefined) {
            next.model_choice = patch.model;
            next.model = null;
        }
        if (patch.clear_key) next.api_key_enc = null;
        if (patch.api_key) next.api_key_enc = encryptSecret(patch.api_key, this.env.SECRETS_KEY);
        if (patch.effort !== undefined) {
            // v0.1.306 — con la clave de la plataforma el costo es del
            // operador: el esfuerzo lo decide la plataforma. Se valida contra
            // el estado RESULTANTE (cargar la clave y elegir el esfuerzo en el
            // mismo guardado vale).
            if (patch.effort !== null && !this.usesOwnKey(next, await this.readPlatform())) {
                throw new BadRequestException({
                    code: 'ai_effort_requires_own_key',
                    message:
                        'El nivel de esfuerzo sólo se puede elegir cuando la empresa usa su propia clave. Con la clave de la plataforma se usa el que fija la plataforma.',
                    data: { status: 400 },
                });
            }
            next.effort = patch.effort;
        }
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

    // ── Catálogo de modelos (v0.1.305) ───────────────────────────────────

    /** Modelos que ve la clave de la plataforma (guardada o del env). */
    async platformCatalog(refresh = false): Promise<AiModelCatalog> {
        return this.catalogs.catalog(await this.platformKey(), { refresh });
    }

    /**
     * Modelos para elegir en los Ajustes de una empresa: los que ve SU clave
     * si tiene una usable; si no, los de la plataforma (la lista es sólo de
     * nombres — consultarla no gasta cuota).
     */
    async tenantCatalog(tenantId: number, refresh = false): Promise<AiModelCatalog> {
        const [stored, platform] = await Promise.all([this.readTenant(tenantId), this.readPlatform()]);
        if (platform.allow_tenant_keys && stored.api_key_enc) {
            const key = this.decryptKey(stored.api_key_enc);
            if (key.state === 'ok' && key.value) return this.catalogs.catalog(key.value, { refresh });
        }
        return this.platformCatalog(refresh);
    }

    /** Modelos que ve una clave cualquiera (el botón «Probar» antes de guardarla). */
    catalogFor(apiKey: string, refresh = false): Promise<AiModelCatalog> {
        return this.catalogs.catalog(apiKey, { refresh });
    }

    /** Resuelve una elección contra lo que ve una clave. Lanza si no se puede. */
    async resolveModel(apiKey: string, choice: AiModelChoice): Promise<ResolvedAiModel & { fallbackFrom: string | null }> {
        const { model, error } = await this.catalogs.resolve(apiKey, choice);
        if (!model) {
            throw new AiUnavailableError(
                `No se pudo consultar qué modelos ofrece el proveedor${error ? `: ${error}` : ''}. Intenta de nuevo en un momento.`,
                'models_unavailable',
            );
        }
        return { id: model.id, name: model.display_name, caps: model.caps ?? inferAiModelCaps(model.id), fallbackFrom: model.fallback_from };
    }

    /** El modelo de calidad «rápida» de los campos con IA: el más reciente de la familia económica. */
    async fastModel(apiKey: string): Promise<ResolvedAiModel> {
        const m = await this.resolveModel(apiKey, `auto:${FAST_AI_MODEL_FAMILY}`);
        return { id: m.id, name: m.name, caps: m.caps };
    }

    /** La empresa tiene clave propia USABLE → sus pedidos no consumen cuota. */
    async tenantHasOwnKey(tenantId: number): Promise<boolean> {
        const [stored, platform] = await Promise.all([this.readTenant(tenantId), this.readPlatform()]);
        return this.usesOwnKey(stored, platform);
    }

    /** La empresa habla con SU clave: la cargó, se lee y la plataforma lo permite. */
    private usesOwnKey(stored: StoredTenant, platform: StoredPlatform): boolean {
        if (!platform.allow_tenant_keys || stored.api_key_enc === null) return false;
        const key = this.decryptKey(stored.api_key_enc);
        return key.state === 'ok' && !!key.value;
    }

    // ── Resolución para un pedido ────────────────────────────────────────

    /**
     * Decide con qué clave y modelo se habla. Lanza `AiUnavailableError` con
     * un motivo accionable cuando no se puede.
     */
    async resolve(tenantId: number, opts: { requireOptIn?: boolean } = {}): Promise<ResolvedAiAccess> {
        const [tenant, platform] = await Promise.all([this.readTenant(tenantId), this.readPlatform()]);
        if (!platform.enabled) {
            throw new AiUnavailableError('El asistente está desactivado en la plataforma.', 'platform_disabled');
        }
        // F7 (ADR-S72) — la bienvenida de una empresa nueva hace UN pedido con
        // su propio consentimiento en línea (la empresa todavía no activó el
        // asistente): pasa `requireOptIn: false`. Todo lo demás exige el opt-in.
        if (opts.requireOptIn !== false && !tenant.enabled) {
            throw new AiUnavailableError(
                'El asistente no está activado para esta empresa. Un administrador puede activarlo en Ajustes → Asistente IA.',
                'tenant_disabled',
            );
        }
        const choice = tenantChoice(tenant) ?? platformChoice(platform);
        if (platform.allow_tenant_keys && tenant.api_key_enc) {
            const key = this.decryptKey(tenant.api_key_enc);
            if (key.state === 'unreadable') {
                throw new AiUnavailableError(
                    'La clave IA de la empresa no se puede descifrar con la clave actual del servidor. Vuelve a escribirla en Ajustes → Asistente IA.',
                    'tenant_key_unreadable',
                );
            }
            // Con clave propia la empresa elige su esfuerzo (o hereda el de la plataforma).
            if (key.value) return this.withModel(key.value, choice, tenant.effort ?? platform.effort, 'tenant');
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
        // Con la clave de la plataforma manda su esfuerzo, aunque la empresa haya guardado otro.
        return this.withModel(apiKey, choice, platform.effort, 'platform');
    }

    private async withModel(apiKey: string, choice: AiModelChoice, effort: AiEffort, source: AiKeySource): Promise<ResolvedAiAccess> {
        const m = await this.resolveModel(apiKey, choice);
        return {
            apiKey,
            model: m.id,
            modelName: m.name,
            choice,
            fallbackFrom: m.fallbackFrom,
            caps: m.caps,
            effort: clampAiEffort(effort, m.caps),
            source,
        };
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
