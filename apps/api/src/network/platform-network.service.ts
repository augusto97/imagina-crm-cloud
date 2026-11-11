import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
    normalizeEmbedOrigin,
    parsePlatformNetwork,
    updatePlatformNetworkSchema,
    type NetCheckProbe,
    type NetworkCheckResult,
    type NetworkCheckStep,
    type PlatformNetwork,
    type PlatformNetworkView,
    type UpdatePlatformNetworkInput,
} from '@imagina-base/shared';
import { eq, or } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { tenants } from '../db/schema';
import { safeWebhookFetch, type SafeFetchResult } from '../common/safe-fetch';
import { cloudflareTrustedNow, setCloudflareTrusted } from '../common/trust-proxy';
import { REDIS } from '../redis/redis.module';

/** Subconjunto de ioredis: se testea con un fake en memoria. */
export interface NetworkStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
}

/** `platform:*` → viaja en el snapshot del servidor (ADR-S20). */
export const PLATFORM_NETWORK_KEY = 'platform:network';
/** Cada cuánto se relee (los otros servidores se enteran solos). */
const REFRESH_MS = 60_000;
/** Un token de widget que nunca existe: su 404 se guarda 30 s y sirve para probar la caché. */
export const NET_CHECK_PROBE_TOKEN = 'netcheckcacheprobe00';

const bad = (code: string, message: string): BadRequestException => new BadRequestException({ code, message, data: { status: 400 } });

/**
 * v0.1.409 (ADR-S102) — Plataforma → Dominios → «Dirección rápida para los
 * sitios web». Guarda la dirección (y si pasa por Cloudflare) y la sirve en
 * memoria: la leen los códigos de insertar y, en CADA pedido, el
 * `trustProxy` de Fastify.
 */
@Injectable()
export class PlatformNetworkService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PlatformNetworkService.name);
    private value: PlatformNetwork = { embed_origin: null, cloudflare: false };
    private timer: NodeJS.Timeout | null = null;

    constructor(
        @Inject(REDIS) private readonly redis: NetworkStore,
        @Inject(ENV) private readonly env: Env,
        @Inject(DRIZZLE) private readonly db: Db,
    ) {}

    async onModuleInit(): Promise<void> {
        await this.refresh();
        this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
        this.timer.unref?.();
    }

    onModuleDestroy(): void {
        if (this.timer) clearInterval(this.timer);
    }

    /** http sólo en desarrollo (una «dirección rápida» local para probar). */
    private get allowHttp(): boolean {
        return this.env.NODE_ENV !== 'production';
    }

    async refresh(): Promise<void> {
        let raw: string | null;
        try {
            raw = await this.redis.get(PLATFORM_NETWORK_KEY);
        } catch (err) {
            // Sin Redis se queda con lo último que sabía (nunca rompe un pedido).
            this.logger.warn(`No se pudo leer ${PLATFORM_NETWORK_KEY}: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        let value: unknown = {};
        try {
            value = raw ? (JSON.parse(raw) as unknown) : {};
        } catch {
            // Un valor roto vuelve al de fábrica (los códigos con la dirección de la app).
        }
        this.apply(parsePlatformNetwork(value, { allowHttp: this.allowHttp }));
    }

    private apply(next: PlatformNetwork): void {
        this.value = next;
        setCloudflareTrusted(next.cloudflare);
    }

    get(): PlatformNetwork {
        return this.value;
    }

    view(): PlatformNetworkView {
        return { ...this.value, app_origin: this.appOrigin(), cloudflare_trusted: cloudflareTrustedNow() };
    }

    appOrigin(): string {
        try {
            return new URL(this.env.APP_BASE_URL).origin;
        } catch {
            return this.env.APP_BASE_URL.replace(/\/+$/, '');
        }
    }

    /** La dirección rápida, o null (los códigos usan la de la app). */
    embedOrigin(): string | null {
        return this.value.embed_origin;
    }

    /**
     * La dirección rápida para los códigos de una empresa, según por dónde
     * comparte: si sale por su DOMINIO PROPIO, manda el dominio (white-label)
     * y no hay dirección rápida.
     */
    embedOriginFor(base: string | null | undefined): string | null {
        const embed = this.value.embed_origin;
        if (!embed) return null;
        if (base) {
            let origin = base;
            try {
                origin = new URL(base).origin;
            } catch {
                // se compara tal cual
            }
            if (origin !== this.appOrigin()) return null;
        }
        return embed;
    }

    /** Huella de esta instalación (la misma en todos sus servidores). */
    fingerprint(): string {
        return createHash('sha256').update(`imagina-net:${this.appOrigin()}`).digest('hex').slice(0, 16);
    }

    async update(input: UpdatePlatformNetworkInput): Promise<PlatformNetworkView> {
        const parsed = updatePlatformNetworkSchema.parse(input);
        const origin = parsed.embed_origin ? await this.validate(parsed.embed_origin) : null;
        const next: PlatformNetwork = { embed_origin: origin, cloudflare: parsed.cloudflare };
        await this.redis.set(PLATFORM_NETWORK_KEY, JSON.stringify(next));
        this.apply(next);
        return this.view();
    }

    /** Lo escrito → el origen, o 400 con el motivo. */
    async validate(raw: string): Promise<string> {
        const origin = normalizeEmbedOrigin(raw, { allowHttp: this.allowHttp });
        if (!origin) {
            throw bad('embed_origin_invalid', 'Escribe sólo la dirección, por ejemplo w.tudominio.com (sin rutas ni espacios).');
        }
        const host = new URL(origin).hostname;
        const appHost = new URL(this.appOrigin()).hostname;
        if (host === appHost) {
            throw bad('embed_origin_is_app', 'Usa una dirección distinta a la de la app (por ejemplo w.tudominio.com): la de la app sigue sin Cloudflare.');
        }
        const base = this.env.PUBLIC_BASE_DOMAIN.toLowerCase();
        if (base !== '' && (host === base || host.endsWith(`.${base}`))) {
            throw bad('embed_origin_under_base', `Las direcciones bajo ${base} son de las empresas (sus subdominios). Usa otra, por ejemplo una al mismo nivel que la app.`);
        }
        const [taken] = await this.db
            .select({ id: tenants.id })
            .from(tenants)
            .where(or(eq(tenants.customDomain, host), eq(tenants.portalDomain, host)))
            .limit(1);
        if (taken) throw bad('embed_origin_is_tenant_domain', 'Esa dirección es el dominio propio de una empresa. Elige otra.');
        return origin;
    }

    /**
     * «Comprobar»: se le pregunta a la dirección (sin guardar nada) si llega a
     * esta app, si pasa por Cloudflare, si el servidor vería la IP real y si
     * Cloudflare ya guarda el script y la página del widget.
     */
    async check(input: UpdatePlatformNetworkInput): Promise<NetworkCheckResult> {
        const parsed = updatePlatformNetworkSchema.parse(input);
        if (!parsed.embed_origin) throw bad('embed_origin_invalid', 'Escribe la dirección que quieres comprobar.');
        const origin = await this.validate(parsed.embed_origin);
        const steps: NetworkCheckStep[] = [];
        const done = (): NetworkCheckResult => ({ origin, ok: steps.every((s) => s.ok !== false), steps });

        let probe: NetCheckProbe | null = null;
        let res: SafeFetchResult | null = null;
        try {
            res = await this.fetch(`${origin}/api/v1/public/net-check`);
        } catch (err) {
            steps.push({ id: 'reach', ok: false, detail: unreachableText(origin, err) });
            return done();
        }
        if (res.status !== 200) {
            steps.push({ id: 'reach', ok: false, detail: statusText(res.status) });
            return done();
        }
        try {
            probe = JSON.parse(res.body ?? '') as NetCheckProbe;
        } catch {
            probe = null;
        }
        if (!probe || probe.ok !== true || typeof probe.app !== 'string') {
            steps.push({ id: 'reach', ok: false, detail: 'La dirección responde, pero no con esta app. Revisa que esté agregada en el servidor (alias de la aplicación en ServerAvatar).' });
            return done();
        }
        steps.push({ id: 'reach', ok: true, detail: 'La dirección responde.' });
        if (probe.app !== this.fingerprint()) {
            steps.push({ id: 'same_app', ok: false, detail: 'Responde OTRA instalación de la app: revisa a qué servidor apunta la dirección en el DNS.' });
            return done();
        }
        steps.push({ id: 'same_app', ok: true, detail: 'Llega a esta app.' });

        const viaCf = probe.via_cloudflare || Boolean(res.headers?.['cf-ray']);
        if (parsed.cloudflare) {
            steps.push(
                viaCf
                    ? { id: 'via_cloudflare', ok: true, detail: 'Pasa por Cloudflare.' }
                    : { id: 'via_cloudflare', ok: false, detail: 'No pasa por Cloudflare: en el DNS de Cloudflare, pon esa dirección con la nube en naranja (Proxied).' },
            );
        } else {
            steps.push(
                viaCf
                    ? { id: 'via_cloudflare', ok: false, detail: 'Pasa por Cloudflare: marca «Las visitas llegan por Cloudflare» para que el servidor vea la IP real de cada visitante.' }
                    : { id: 'via_cloudflare', ok: null, detail: 'No pasa por Cloudflare: los códigos funcionan igual, pero sin la caché de Cloudflare.' },
            );
        }

        if (viaCf) {
            if (!probe.peer_is_cloudflare) {
                steps.push({ id: 'real_ip', ok: false, detail: 'El servidor no ve llegar el pedido desde una dirección de Cloudflare: revisa que no haya otro proxy en medio.' });
            } else if (!parsed.cloudflare) {
                steps.push({ id: 'real_ip', ok: false, detail: 'Hoy el servidor vería la IP de Cloudflare y no la del visitante.' });
            } else if (!cloudflareTrustedNow()) {
                steps.push({ id: 'real_ip', ok: null, detail: 'Al guardar, el servidor va a ver la IP real de cada visitante.' });
            } else {
                steps.push(
                    probe.ip_is_cloudflare
                        ? { id: 'real_ip', ok: false, detail: 'El servidor sigue viendo la IP de Cloudflare: revisa que el proxy del servidor pase la cabecera X-Forwarded-For.' }
                        : { id: 'real_ip', ok: true, detail: 'El servidor ve la IP real de cada visitante.' },
                );
            }
            steps.push(await this.cacheStep('cache_script', `${origin}/api/v1/public/f/embed.js`, 'el script'));
            steps.push(await this.cacheStep('cache_page', `${origin}/api/v1/public/w/${NET_CHECK_PROBE_TOKEN}`, 'la página del widget'));
        }
        return done();
    }

    private async cacheStep(id: 'cache_script' | 'cache_page', url: string, what: string): Promise<NetworkCheckStep> {
        let status = '';
        for (let i = 0; i < 3; i++) {
            try {
                const r = await this.fetch(url);
                status = (r.headers?.['cf-cache-status'] ?? '').toUpperCase();
            } catch {
                return { id, ok: null, detail: `No se pudo pedir ${what} para comprobar la caché.` };
            }
            if (status === 'HIT' || status === 'REVALIDATED' || status === 'UPDATING') return { id, ok: true, detail: `Cloudflare guarda ${what}.` };
        }
        if (status === '') return { id, ok: null, detail: `No se pudo saber si Cloudflare guarda ${what}.` };
        if (status === 'DYNAMIC' || status === 'BYPASS') {
            return { id, ok: false, detail: `Cloudflare no guarda ${what} («${status}»): falta la regla de caché de abajo, o no incluye esta dirección.` };
        }
        return { id, ok: false, detail: `Cloudflare todavía no guarda ${what} («${status}»). Vuelve a comprobar en unos segundos; si sigue igual, revisa la regla de caché.` };
    }

    private fetch(url: string): Promise<SafeFetchResult> {
        return safeWebhookFetch(url, {
            method: 'GET',
            timeoutMs: 8000,
            captureBody: true,
            maxCaptureBytes: 4096,
            headers: { 'user-agent': 'ImaginaNetCheck/1', accept: 'application/json, */*' },
        });
    }
}

function unreachableText(origin: string, err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    return `No se pudo abrir ${origin} (${msg}). Revisa que exista el registro en el DNS y que el servidor atienda esa dirección (alias de la aplicación en ServerAvatar, con su certificado).`;
}

/** Los códigos de Cloudflare y del servidor, en palabras. */
export function statusText(status: number): string {
    switch (status) {
        case 521:
            return 'Cloudflare no logra conectarse con el servidor (error 521): revisa que la dirección apunte a la IP del servidor y que el servidor esté encendido.';
        case 522:
        case 524:
            return `Cloudflare no recibe respuesta del servidor a tiempo (error ${status}).`;
        case 525:
        case 526:
            return `Cloudflare no acepta el certificado del servidor para esta dirección (error ${status}). Emite el certificado en ServerAvatar con la nube en gris y después pásala a naranja, o pon el modo SSL de Cloudflare en «Full».`;
        case 404:
            return 'El servidor no reconoce esta dirección (404): agrégala como alias de la aplicación en ServerAvatar.';
        default:
            return `La dirección responde, pero no con esta app (código ${status}). Revisa que esté agregada en el servidor (alias de la aplicación en ServerAvatar).`;
    }
}
