import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
    INTEGRATION_SCOPES_ADDED,
    MS_ADMIN_CONSENT_STATE_PREFIX,
    MS_ADMIN_CONSENT_TTL_DAYS,
    buildMsAdminConsentUrl,
    integrationDef,
    integrationScopes,
    msScopeLabels,
    type IntegrationKey,
    type MsAdminConsentStatus,
} from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { users } from '../db/schema';
import { REDIS } from '../redis/redis.module';
import { IntegrationAppsService } from './integration-apps.service';

/**
 * v0.1.363 — Enlace de aprobación para el administrador de Microsoft 365 (ver
 * `ms-admin-consent.ts` en shared). Quien conecta Outlook o Teams y se topa
 * con «Se necesita la aprobación del administrador» crea aquí el enlace y se
 * lo manda a su administrador de TI; el administrador lo abre en SU
 * navegador (no tiene por qué tener cuenta en la app), aprueba en Microsoft
 * y vuelve a nuestra URI de redirección, donde se le muestra el resultado y
 * se anota para que quien lo pidió lo vea al volver a Integraciones.
 *
 * No hay credenciales en juego: la vuelta de una aprobación no trae código ni
 * tokens, sólo `admin_consent=True`. Por eso se acepta sin sesión.
 */

const DAY = 24 * 60 * 60;
const stateKey = (state: string): string => `msadmin:state:${state}`;
const statusKey = (tenantId: number, key: string): string => `msadmin:status:${tenantId}:${key}`;

interface StateRecord {
    tenantId: number;
    userId: number;
    integration: IntegrationKey;
}

interface StatusRecord {
    state: string;
    url: string;
    requested_by: number;
    requested_at: string;
    expires_at: string;
    approved_at: string | null;
    error: string | null;
    /**
     * v0.1.366 — los permisos del enlace (lo que el administrador aprueba). Un
     * registro de antes no lo tiene: se toma como los de entonces (los de hoy
     * menos los que la app sumó después).
     */
    scopes?: string;
}

/** Los permisos de `want` que no están en `have` (comparados sin mayúsculas). */
function scopesMissing(want: string, have: string): string[] {
    const norm = (s: string): string => s.trim().replace(/^https:\/\/graph\.microsoft\.com\//i, '').toLowerCase();
    const got = new Set(have.split(/[\s,]+/).map(norm).filter(Boolean));
    return want.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s !== '' && !got.has(norm(s)));
}

/** Subconjunto de ioredis que se usa (los tests pasan uno real). */
interface KeyValue {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

export interface AdminConsentOutcome {
    tone: 'ok' | 'error';
    title: string;
    message: string;
}

@Injectable()
export class MsAdminConsentService {
    constructor(
        @Inject(REDIS) private readonly redis: KeyValue,
        @Inject(ENV) private readonly env: Env,
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly apps: IntegrationAppsService,
    ) {}

    /** La integración tiene que ser de Microsoft con autorización OAuth. */
    private requireMicrosoft(key: IntegrationKey): NonNullable<ReturnType<typeof integrationDef>> {
        const def = integrationDef(key);
        if (!def || def.auth.kind !== 'oauth' || def.auth.provider !== 'microsoft') {
            throw new BadRequestException({
                code: 'admin_consent_not_microsoft',
                message: 'La aprobación del administrador sólo aplica a las apps de Microsoft 365 (Outlook y Teams).',
                data: { status: 400 },
            });
        }
        return def;
    }

    private redirectUri(): string {
        return `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/api/v1/connections/oauth/callback`;
    }

    private async read(tenantId: number, key: IntegrationKey): Promise<StatusRecord | null> {
        const raw = await this.redis.get(statusKey(tenantId, key));
        if (!raw) return null;
        try {
            return JSON.parse(raw) as StatusRecord;
        } catch {
            return null;
        }
    }

    private async userName(userId: number): Promise<string | null> {
        const [row] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
        return row?.name ?? null;
    }

    async status(tenantId: number, key: IntegrationKey): Promise<MsAdminConsentStatus> {
        const def = this.requireMicrosoft(key);
        const rec = await this.read(tenantId, key);
        const live = rec !== null && Date.parse(rec.expires_at) > Date.now();
        const current = integrationScopes(def);
        // v0.1.366 — ¿lo aprobado cubre lo que la app pide HOY? Teams sumó el
        // calendario: una aprobación de antes sirve para los mensajes, no para
        // las reuniones.
        let missing: string[] = [];
        if (rec?.approved_at) {
            // Un registro de antes no guardó los permisos: se aprobó lo de
            // entonces, o sea lo de hoy menos lo que la app sumó después.
            const approvedScopes = rec.scopes ?? scopesMissing(current, INTEGRATION_SCOPES_ADDED[key] ?? '').join(' ');
            missing = scopesMissing(current, approvedScopes);
        }
        return {
            integration: key,
            url: live && rec.approved_at === null ? rec.url : null,
            requested_at: rec?.requested_at ?? null,
            requested_by_name: rec ? await this.userName(rec.requested_by) : null,
            expires_at: live ? rec.expires_at : null,
            approved_at: rec?.approved_at ?? null,
            error: rec?.error ?? null,
            permissions: msScopeLabels(current),
            outdated: missing.length > 0,
            missing_permissions: msScopeLabels(missing.join(' ')),
        };
    }

    /**
     * Crea el enlace (o devuelve el vigente: copiarlo dos veces no debe dejar
     * varios enlaces sueltos). Uno ya aprobado se puede pedir de nuevo — p. ej.
     * si el administrador revocó la app.
     */
    async create(tenantId: number, userId: number, key: IntegrationKey): Promise<MsAdminConsentStatus> {
        const def = this.requireMicrosoft(key);
        const current = await this.read(tenantId, key);
        if (current && current.approved_at === null && Date.parse(current.expires_at) - Date.now() > DAY * 1000) {
            return this.status(tenantId, key);
        }
        const app = await this.apps.resolve('microsoft');
        const state = MS_ADMIN_CONSENT_STATE_PREFIX + randomBytes(24).toString('base64url');
        const ttl = MS_ADMIN_CONSENT_TTL_DAYS * DAY;
        const now = new Date();
        const record: StatusRecord = {
            state,
            url: buildMsAdminConsentUrl({ clientId: app.clientId, scopes: integrationScopes(def), redirectUri: this.redirectUri(), state }),
            requested_by: userId,
            requested_at: now.toISOString(),
            expires_at: new Date(now.getTime() + ttl * 1000).toISOString(),
            approved_at: null,
            error: null,
            scopes: integrationScopes(def),
        };
        await this.redis.set(stateKey(state), JSON.stringify({ tenantId, userId, integration: key } satisfies StateRecord), 'EX', ttl);
        // El estado se recuerda más que el enlace: «aprobado el …» sigue sirviendo.
        await this.redis.set(statusKey(tenantId, key), JSON.stringify(record), 'EX', 120 * DAY);
        return this.status(tenantId, key);
    }

    /**
     * La vuelta de Microsoft en el navegador del administrador. Nunca lanza:
     * devuelve qué mostrarle.
     */
    async complete(q: { state: string; adminConsent?: string; error?: string; errorDescription?: string }): Promise<AdminConsentOutcome> {
        let pending: StateRecord | null = null;
        const raw = await this.redis.get(stateKey(q.state));
        if (raw) {
            try {
                pending = JSON.parse(raw) as StateRecord;
            } catch {
                pending = null;
            }
        }
        const approved = (q.adminConsent ?? '').toLowerCase() === 'true' && !q.error;
        const appLabel = pending ? (integrationDef(pending.integration)?.name ?? 'la app') : 'la app';

        if (pending) {
            const rec = await this.read(pending.tenantId, pending.integration);
            if (rec && rec.state === q.state) {
                const next: StatusRecord = approved
                    ? { ...rec, approved_at: new Date().toISOString(), error: null }
                    : { ...rec, error: describeError(q.error, q.errorDescription) };
                await this.redis.set(statusKey(pending.tenantId, pending.integration), JSON.stringify(next), 'EX', 120 * DAY);
            }
        }

        if (approved) {
            const who = pending ? await this.userName(pending.userId) : null;
            return {
                tone: 'ok',
                title: 'Listo: aprobaste la app para tu organización',
                message:
                    `Microsoft 365 ya deja que las personas de tu organización conecten ${appLabel}. ` +
                    (who ? `Avísale a ${who} que vuelva a tocar «Conectar». ` : 'Avísale a quien te mandó el enlace que vuelva a tocar «Conectar». ') +
                    'Puedes cerrar esta ventana.',
            };
        }
        if (!pending && !q.error) {
            return {
                tone: 'error',
                title: 'Este enlace ya no sirve',
                message: `Venció (dura ${MS_ADMIN_CONSENT_TTL_DAYS} días). Pídele a quien te lo mandó que cree uno nuevo desde la app.`,
            };
        }
        return {
            tone: 'error',
            title: 'Microsoft no registró la aprobación',
            message:
                `${describeError(q.error, q.errorDescription)} ` +
                'La aprobación la tiene que dar una cuenta con rol de administrador global, administrador de aplicaciones o administrador de aplicaciones en la nube de Microsoft 365. Puedes volver a abrir el enlace con esa cuenta.',
        };
    }
}

/** El motivo de Microsoft en palabras (con el texto original, que sirve para buscar). */
export function describeError(error?: string, description?: string): string {
    const text = `${error ?? ''} ${description ?? ''}`;
    let reason = 'Microsoft devolvió un error.';
    if (/AADSTS65004|access_denied/i.test(text)) reason = 'Se canceló la aprobación.';
    if (/AADSTS90094|AADSTS90008|AADSTS90095|admin/i.test(text)) reason = 'La cuenta con la que se abrió el enlace no es administradora de la organización.';
    if (/AADSTS50011|redirect/i.test(text)) reason = 'La dirección de regreso no está registrada en la app de Microsoft (Plataforma → Integraciones → Microsoft 365).';
    if (/AADSTS700016|AADSTS50020|unauthorized_client/i.test(text)) reason = 'La app de Microsoft no está disponible para esa organización (revisa que sea multiinquilino).';
    const detail = (description ?? error ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    return detail ? `${reason} (${detail})` : reason;
}
