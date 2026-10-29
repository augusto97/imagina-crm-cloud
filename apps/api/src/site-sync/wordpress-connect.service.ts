import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Role, StartWordpressConnectInput, StartWordpressConnectResult } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { PlatformBrandService } from '../brand/platform-brand.service';
import { ENV, type Env } from '../config/env';
import { ConnectorsService } from '../connectors/connectors.service';
import { IntegrationInputError } from '../connectors/integration-errors';
import { IMAGINA_WP_APP_ID, wpAuthorizeUrl, type WpApiStyle } from '../connectors/wordpress/wp-api';
import { discoverWpSite, rotateWpAppPassword, wpSiteProblem } from '../connectors/wordpress/wp-verify';
import { DRIZZLE, type Db } from '../db/client';
import { tenants } from '../db/schema';

/** Lo mínimo de ioredis que usa el flujo (un fake en memoria en los tests). */
export interface WpConnectStateStore {
    set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
    getdel(key: string): Promise<string | null>;
}

export const WP_CONNECT_STATE = Symbol('WP_CONNECT_STATE');

/** Cuánto puede tardar la persona en aprobar en WordPress. */
const STATE_TTL_SECONDS = 15 * 60;
const stateKey = (state: string): string => `wpconnect:${state}`;

interface PendingWpConnect {
    tenantId: number;
    userId: number;
    role: Role;
    visibility: 'workspace' | 'private';
    connectionId: number | null;
    /** La dirección descubierta al empezar: es la que se guarda (no la que vuelve en la URL). */
    base: string;
    /** Cómo habla la API del sitio (enlaces permanentes o `?rest_route=`). */
    style?: WpApiStyle;
    /** Con qué nombre aparece la contraseña en el perfil de WordPress. */
    appName?: string;
}

export interface WpConnectOutcome {
    ok: boolean;
    connectionId: number | null;
    error: string | null;
    warning: string | null;
}

/**
 * «Conectar en un clic» (v0.1.333, ADR-S83). La persona escribe la dirección
 * de su sitio y la mandamos a la pantalla «Autorizar aplicación» del PROPIO
 * WordPress (contraseñas de aplicación, WP 5.6+): ahí ve el nombre de la app,
 * aprueba, y WordPress la devuelve a nuestra URL con un usuario y una
 * contraseña de aplicación recién creada. Nadie copia ni pega nada.
 *
 * El `state` es de UN solo uso (`GETDEL`, como el OAuth de ADR-S22 fase 3) y
 * tiene que canjearlo la MISMA persona que lo pidió. La dirección que se
 * guarda es la descubierta al empezar: la que viene en la vuelta la arma el
 * navegador y no se le cree. Al volver se prueba todo de nuevo (el usuario
 * puede editar) con la misma verificación que el alta manual.
 */
@Injectable()
export class WordpressConnectService {
    constructor(
        private readonly connectors: ConnectorsService,
        private readonly brand: PlatformBrandService,
        @Inject(WP_CONNECT_STATE) private readonly store: WpConnectStateStore,
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
    ) {}

    callbackUrl(state: string): string {
        return `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/api/v1/connections/wordpress/callback?state=${encodeURIComponent(state)}`;
    }

    async start(tenantId: number, userId: number, role: Role, input: StartWordpressConnectInput): Promise<StartWordpressConnectResult> {
        const connectionId = input.connection_id ?? null;
        await this.connectors.assertCanConnectKey(tenantId, userId, role, 'wordpress', input.visibility, connectionId);
        let site;
        try {
            site = await discoverWpSite(input.site_url);
        } catch (err) {
            throw bad(err instanceof Error ? err.message : String(err));
        }
        const problem = wpSiteProblem(site);
        if (problem) throw bad(problem);
        const state = randomBytes(24).toString('base64url');
        const appName = await this.appName(tenantId);
        const pending: PendingWpConnect = { tenantId, userId, role, visibility: input.visibility, connectionId, base: site.base, style: site.style, appName };
        await this.store.set(stateKey(state), JSON.stringify(pending), 'EX', STATE_TTL_SECONDS);
        const back = this.callbackUrl(state);
        return {
            authorize_url: wpAuthorizeUrl(site.index.authorizeUrl!, {
                appName,
                appId: IMAGINA_WP_APP_ID,
                successUrl: back,
                rejectUrl: `${back}&success=false`,
            }),
            site_name: site.index.name ?? new URL(site.base).host,
        };
    }

    /** La vuelta de WordPress (aprobada o rechazada). */
    async complete(
        sessionUserId: number,
        q: { state?: string; success?: string; user_login?: string; password?: string },
    ): Promise<WpConnectOutcome> {
        const fail = (error: string): WpConnectOutcome => ({ ok: false, connectionId: null, error, warning: null });
        const state = (q.state ?? '').trim();
        if (state === '') return fail('WordPress no devolvió la autorización. Vuelve a empezar desde Ajustes → Integraciones.');
        const raw = await this.store.getdel(stateKey(state));
        if (!raw) return fail('La autorización venció o ya se usó. Vuelve a empezar desde Ajustes → Integraciones.');
        let pending: PendingWpConnect;
        try {
            pending = JSON.parse(raw) as PendingWpConnect;
        } catch {
            return fail('La autorización quedó en un estado inválido.');
        }
        if (pending.userId !== sessionUserId) return fail('Esta autorización la inició otra persona.');
        if (q.success === 'false') {
            return fail('No se autorizó la conexión en WordPress. Si fue sin querer, vuelve a tocar «Conectar».');
        }
        const login = (q.user_login ?? '').trim();
        const password = (q.password ?? '').trim();
        if (login === '' || password === '') {
            return fail('WordPress no devolvió la contraseña de aplicación. Si tu sitio tiene un plugin de seguridad, revisa que permita las contraseñas de aplicación.');
        }
        // La contraseña de la URL se cambia por otra antes de guardarla (ver
        // `rotateWpAppPassword`): la recibida pudo quedar en algún registro.
        const { password: kept } = await rotateWpAppPassword(
            { base: pending.base, style: pending.style ?? 'pretty' },
            login,
            password,
            pending.appName ?? 'Imagina Base',
            IMAGINA_WP_APP_ID,
        );
        try {
            const { connection, warning } = await this.connectors.connectIntegrationKey(pending.tenantId, pending.userId, pending.role, 'wordpress', {
                fields: { site_url: pending.base, user_login: login, app_password: kept },
                visibility: pending.visibility,
                connection_id: pending.connectionId,
            });
            return { ok: true, connectionId: connection.id, error: null, warning };
        } catch (err) {
            return fail(messageOf(err));
        }
    }

    /** «Imagina Base · Acme»: así queda nombrada la contraseña en el perfil de WordPress. */
    private async appName(tenantId: number): Promise<string> {
        const brand = await this.brand.get().catch(() => null);
        const [t] = await this.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        const app = (brand?.app_name ?? '').trim() || 'Imagina Base';
        const company = (t?.name ?? '').trim();
        return (company ? `${app} · ${company}` : app).slice(0, 80);
    }
}

function bad(message: string): BadRequestException {
    return new BadRequestException({ code: 'wordpress_unreachable', message, data: { status: 400 } });
}

function messageOf(err: unknown): string {
    if (err instanceof IntegrationInputError) return err.message;
    const response = (err as { getResponse?: () => unknown }).getResponse?.();
    if (response && typeof response === 'object' && typeof (response as { message?: unknown }).message === 'string') {
        return (response as { message: string }).message;
    }
    return err instanceof Error ? err.message : String(err);
}
