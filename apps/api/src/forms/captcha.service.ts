import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
    CAPTCHA_PROVIDER_INFO,
    captchaProviderSchema,
    type CaptchaAvailability,
    type CaptchaKeysInput,
    type CaptchaKeysStatus,
    type CaptchaProvider,
    type Role,
} from '@imagina-base/shared';
import { eq, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { z } from 'zod';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { safeWebhookFetch } from '../common/safe-fetch';
import { ENV, type Env } from '../config/env';
import { secretHint } from '../connectors/connection-parts';
import { DRIZZLE, type Db } from '../db/client';
import { tenants } from '../db/schema';
import { REDIS } from '../redis/redis.module';

/**
 * v0.1.290 — Verificación anti-robots (captcha) de los formularios públicos.
 *
 * Las llaves se cargan en DOS lugares y gana la de la empresa:
 *  - Plataforma (superadmin): `platform:captcha` en Redis, como el resto de
 *    los ajustes globales (`platform:*`) — así viajan solas en el snapshot de
 *    ADR-S20. El secreto va cifrado con `SECRETS_KEY`.
 *  - Empresa (admin): `tenants.settings.captcha`, secreto cifrado igual.
 *
 * El secreto jamás vuelve en un GET: sólo sus últimos caracteres.
 *
 * Verificar = UNA llamada al `siteverify` del proveedor por el fetch con el
 * guard anti-SSRF. Cada token se acepta UNA sola vez (marca en Redis antes de
 * preguntar): aunque el proveedor lo vuelva a aprobar, no sirve para dos
 * respuestas.
 */

const PLATFORM_KEY = 'platform:captcha';
/** Un token usado se recuerda un rato: los proveedores los vencen en ~2–5 min. */
const USED_TTL_S = 15 * 60;
const VERIFY_TIMEOUT_MS = 8000;

const storedSchema = z.object({
    provider: captchaProviderSchema,
    site_key: z.string().min(1),
    secret_enc: z.string().nullable().default(null),
});
type Stored = z.infer<typeof storedSchema>;

/** Llaves listas para usar (secreto en claro). */
export interface ResolvedCaptcha {
    provider: CaptchaProvider;
    siteKey: string;
    secret: string;
    source: 'tenant' | 'platform';
}

export type CaptchaVerdict = { ok: true } | { ok: false; reason: 'missing' | 'reused' | 'rejected' | 'unavailable'; detail?: string };

@Injectable()
export class CaptchaService {
    private readonly logger = new Logger(CaptchaService.name);

    constructor(
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
        @Inject(DRIZZLE) private readonly db: Db,
    ) {}

    // ── Plataforma ───────────────────────────────────────────────────────

    async platformStatus(): Promise<CaptchaKeysStatus> {
        return this.status(await this.readPlatform());
    }

    async setPlatform(input: CaptchaKeysInput): Promise<CaptchaKeysStatus> {
        const prev = await this.readPlatform();
        const next = this.merge(prev, input);
        await this.redis.set(PLATFORM_KEY, JSON.stringify(next));
        return this.status(next);
    }

    async clearPlatform(): Promise<void> {
        await this.redis.del(PLATFORM_KEY);
    }

    // ── Empresa ──────────────────────────────────────────────────────────

    async tenantStatus(tenantId: number): Promise<CaptchaKeysStatus> {
        return this.status(await this.readTenant(tenantId));
    }

    async setTenant(tenantId: number, input: CaptchaKeysInput): Promise<CaptchaKeysStatus> {
        const prev = await this.readTenant(tenantId);
        const next = this.merge(prev, input);
        // `||` sobre jsonb: no pisa el resto de los ajustes de la empresa
        // aunque otra pestaña los esté guardando a la vez.
        await this.db
            .update(tenants)
            .set({
                settings: sql`coalesce(${tenants.settings}, '{}'::jsonb) || jsonb_build_object('captcha', ${JSON.stringify(next)}::jsonb)`,
                updatedAt: new Date(),
            })
            .where(eq(tenants.id, tenantId));
        return this.status(next);
    }

    async clearTenant(tenantId: number): Promise<void> {
        await this.db
            .update(tenants)
            .set({ settings: sql`coalesce(${tenants.settings}, '{}'::jsonb) - 'captcha'`, updatedAt: new Date() })
            .where(eq(tenants.id, tenantId));
    }

    // ── Resolución y verificación ────────────────────────────────────────

    /**
     * Las llaves con las que trabaja un formulario de esta empresa: las suyas
     * si las cargó y se pueden usar, si no las de la plataforma, si no null.
     * `tenantSettings` evita releer la empresa cuando el llamador ya la tiene.
     */
    async resolve(tenantId: number, tenantSettings?: Record<string, unknown>): Promise<ResolvedCaptcha | null> {
        const own = tenantSettings !== undefined ? parseStored(tenantSettings.captcha) : await this.readTenant(tenantId);
        const mine = this.usable(own, 'tenant', tenantId);
        if (mine) return mine;
        return this.usable(await this.readPlatform(), 'platform', null);
    }

    /** Para el constructor: ¿se puede pedir captcha y con qué llaves? */
    async availability(tenantId: number, role: Role): Promise<CaptchaAvailability> {
        const r = await this.resolve(tenantId);
        return { provider: r?.provider ?? null, source: r?.source ?? null, can_configure: role === 'admin' };
    }

    /**
     * Verifica el token con el proveedor. Una sola vez por token: la marca en
     * Redis se pone ANTES de preguntar, así dos envíos simultáneos con el mismo
     * token no pasan los dos.
     */
    async verify(keys: ResolvedCaptcha, token: string | undefined, ip: string): Promise<CaptchaVerdict> {
        const t = (token ?? '').trim();
        if (t === '') return { ok: false, reason: 'missing' };
        const usedKey = `captcha:used:${createHash('sha256').update(`${keys.provider}:${t}`).digest('hex')}`;
        let fresh: string | null = 'OK';
        try {
            fresh = await this.redis.set(usedKey, '1', 'EX', USED_TTL_S, 'NX');
        } catch {
            // Redis caído: el proveedor igual rechaza los tokens repetidos.
            fresh = 'OK';
        }
        if (fresh !== 'OK') return { ok: false, reason: 'reused' };

        const body = new URLSearchParams({ secret: keys.secret, response: t });
        if (ip) body.set('remoteip', ip);
        if (keys.provider === 'hcaptcha') body.set('sitekey', keys.siteKey);
        let res: { status: number; body: string };
        try {
            res = await this.post(this.verifyUrl(keys.provider), body.toString());
        } catch (err) {
            this.logger.warn(`Verificación ${keys.provider} no respondió: ${err instanceof Error ? err.message : String(err)}`);
            return { ok: false, reason: 'unavailable' };
        }
        let parsed: { success?: unknown; 'error-codes'?: unknown };
        try {
            parsed = JSON.parse(res.body) as typeof parsed;
        } catch {
            return { ok: false, reason: 'unavailable', detail: `respuesta ${res.status}` };
        }
        if (parsed.success === true) return { ok: true };
        const codes = Array.isArray(parsed['error-codes']) ? parsed['error-codes'].map(String).join(', ') : '';
        return { ok: false, reason: 'rejected', ...(codes ? { detail: codes } : {}) };
    }

    /** Endpoint de verificación (en desarrollo puede apuntar a uno simulado). */
    verifyUrl(provider: CaptchaProvider): string {
        if (this.env.NODE_ENV !== 'production' && this.env.CAPTCHA_SITEVERIFY_URL) return this.env.CAPTCHA_SITEVERIFY_URL;
        return CAPTCHA_PROVIDER_INFO[provider].verify_url;
    }

    /** POST al proveedor. Los tests lo reemplazan por un `siteverify` simulado. */
    protected async post(url: string, form: string): Promise<{ status: number; body: string }> {
        const res = await safeWebhookFetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
            body: form,
            timeoutMs: VERIFY_TIMEOUT_MS,
            captureBody: true,
        });
        return { status: res.status, body: res.body ?? '' };
    }

    // ── Internos ─────────────────────────────────────────────────────────

    private async readPlatform(): Promise<Stored | null> {
        let raw: string | null = null;
        try {
            raw = await this.redis.get(PLATFORM_KEY);
        } catch {
            return null;
        }
        if (!raw) return null;
        try {
            return parseStored(JSON.parse(raw));
        } catch {
            return null;
        }
    }

    private async readTenant(tenantId: number): Promise<Stored | null> {
        const [row] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        return parseStored((row?.settings as Record<string, unknown> | undefined)?.captcha);
    }

    /** Guardar: un secreto vacío CONSERVA el anterior (si es del mismo proveedor y sitio). */
    private merge(prev: Stored | null, input: CaptchaKeysInput): Stored {
        const keep = prev && prev.provider === input.provider && prev.site_key === input.site_key ? prev.secret_enc : null;
        const secretEnc = input.secret !== '' ? encryptSecret(input.secret, this.env.SECRETS_KEY) : keep;
        if (!secretEnc) {
            throw new CaptchaKeysError('Escribe la llave secreta: sin ella no se puede verificar a quien responde.');
        }
        return { provider: input.provider, site_key: input.site_key, secret_enc: secretEnc };
    }

    private secretOf(stored: Stored | null): { secret: string | null; unreadable: boolean } {
        if (!stored?.secret_enc) return { secret: null, unreadable: false };
        try {
            const secret = decryptSecret(stored.secret_enc, this.env.SECRETS_KEY);
            // Sin SECRETS_KEY `decryptSecret` devuelve el texto cifrado tal cual: eso no es una llave.
            if (secret.startsWith('enc:v1:')) return { secret: null, unreadable: true };
            return { secret, unreadable: false };
        } catch {
            return { secret: null, unreadable: true };
        }
    }

    private usable(stored: Stored | null, source: 'tenant' | 'platform', tenantId: number | null): ResolvedCaptcha | null {
        if (!stored) return null;
        const { secret, unreadable } = this.secretOf(stored);
        if (!secret) {
            if (unreadable) {
                this.logger.warn(
                    `Las llaves de captcha de ${source === 'tenant' ? `la empresa ${tenantId}` : 'la plataforma'} no se pueden descifrar con la SECRETS_KEY actual`,
                );
            }
            return null;
        }
        return { provider: stored.provider, siteKey: stored.site_key, secret, source };
    }

    private status(stored: Stored | null): CaptchaKeysStatus {
        if (!stored) return { configured: false, provider: null, site_key: null, secret_hint: null, secret_unreadable: false };
        const { secret, unreadable } = this.secretOf(stored);
        return {
            configured: true,
            provider: stored.provider,
            site_key: stored.site_key,
            secret_hint: secret ? secretHint(secret) : null,
            secret_unreadable: unreadable,
        };
    }
}

/** Error de configuración con un motivo legible (el controller lo vuelve 400). */
export class CaptchaKeysError extends Error {}

function parseStored(raw: unknown): Stored | null {
    if (!raw || typeof raw !== 'object') return null;
    const parsed = storedSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}
