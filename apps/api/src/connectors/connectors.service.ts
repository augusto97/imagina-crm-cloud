import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
    INTEGRATION_PROVIDER_DEFS,
    connectorSettingsSchema,
    integrationDef,
    integrationScopes,
    isIntegrationKey,
    oauthConfigSchema,
    type AuthorizeIntegrationInput,
    type ConnectIntegrationKeyInput,
    type Connection,
    type ConnectionDraftTestInput,
    type ConnectionTestResult,
    type ConnectionUsage,
    type ConnectorAction,
    type ConnectorAuthType,
    type ConnectorPair,
    type ConnectorSettings,
    type ConnectorVisibility,
    type ConvertInlineSecretsInput,
    type ConvertInlineSecretsResult,
    type CreateConnectionInput,
    type InlineSecretCandidate,
    type IntegrationDef,
    type IntegrationKey,
    type IntegrationProvider,
    type IntegrationsOverview,
    type OAuthConfig,
    type OAuthStartResult,
    type OAuthStatus,
    type Role,
    type UpdateConnectionInput,
    type VerifyIntegrationInput,
    type VerifyIntegrationResult,
} from '@imagina-base/shared';
import { and, asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { safeWebhookFetch } from '../common/safe-fetch';
import { decryptSecret, encryptSecret, isEncrypted } from '../common/secret-box';
import { findConnectorAction, readConnectorActions } from './connector-actions';
import { IntegrationAppsService } from './integration-apps.service';
import {
    identityLabel,
    identityRequest,
    parseVerify,
    verifyRequest,
    type IntegrationCreds,
} from './integration-calls';
import {
    buildAuthorizeUrl,
    buildRefreshBody,
    buildTokenExchangeBody,
    createPkce,
    needsRefresh,
    parseTokenResponse,
    type TokenResponse,
} from './oauth-client';
import { REDIS } from '../redis/redis.module';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { automations, connections, lists, tenants, users } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';
import {
    connectionParts,
    joinUrl,
    maskHeaders,
    redactValues,
    secretHint,
    type ConnectionParts,
    type ConnectionSecrets,
} from './connection-parts';
import {
    credentialFingerprint,
    detectInlineCredential,
    hostOf,
    originOf,
    readConfigPairs,
    rewriteActionConfig,
    walkActions,
    type DetectedCredential,
} from './inline-scan';

/**
 * Conectores (v0.1.196, ADR-S22) — fase 1.
 *
 * Una conexión guarda la credencial de un servicio externo UNA vez; las
 * acciones la referencian por id. Eso da lo que hoy no existe: rotar en un
 * solo lugar, revocar, auditar y saber qué se rompe antes de borrar.
 *
 * Reglas de acceso, decididas con el usuario:
 *  - Las credenciales son de la EMPRESA. No hay conectores de plataforma:
 *    compartir la cuenta del operador entre clientes no tiene sentido para un
 *    gateway de WhatsApp o un CRM ajeno.
 *  - Crear o editar una conexión del equipo es del ADMIN, igual que el SMTP,
 *    el dominio o los miembros: es configuración de empresa y la credencial
 *    puede gastar plata o mandar mensajes en su nombre.
 *  - Una conexión PRIVADA (sólo su dueño) existe únicamente si el admin
 *    habilitó la opción en los ajustes del workspace.
 */

/** Fila cruda con los secretos todavía cifrados. */
interface ConnectionRow {
    id: number;
    provider: string;
    name: string;
    baseUrl: string;
    authType: string;
    config: Record<string, unknown>;
    secrets: Record<string, string>;
    visibility: string;
    ownerUserId: number | null;
    lastCheckAt: Date | null;
    lastCheckOk: boolean | null;
    lastCheckError: string | null;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * La conexión existe pero no se puede usar (la `SECRETS_KEY` del servidor
 * cambió). Es un error RUIDOSO a propósito: la alternativa sería mandar la
 * petición sin credencial, que es la clase de fallo silencioso que costó el
 * release v0.1.150 con el SMTP.
 */
export class ConnectionUnusableError extends Error {
    readonly code = 'connection_unusable';
    constructor(name: string) {
        super(
            `La conexión «${name}» está configurada pero su credencial no se puede descifrar con la clave actual del servidor. ` +
                'Volvé a escribirla en Ajustes → Integraciones.',
        );
    }
}

const COLUMNS = {
    id: connections.id,
    provider: connections.provider,
    name: connections.name,
    baseUrl: connections.baseUrl,
    authType: connections.authType,
    config: connections.config,
    secrets: connections.secrets,
    visibility: connections.visibility,
    ownerUserId: connections.ownerUserId,
    lastCheckAt: connections.lastCheckAt,
    lastCheckOk: connections.lastCheckOk,
    lastCheckError: connections.lastCheckError,
    createdAt: connections.createdAt,
    updatedAt: connections.updatedAt,
} as const;

const MAX_TEST_BODY = 2000;

/** Una autorización a medio hacer no puede quedar viva indefinidamente. */
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
/** Lock del refresh: más que un canje de token no puede tardar. */
const OAUTH_LOCK_SECONDS = 20;
/** Cuánto se espera al que está renovando antes de rendirse. */
const OAUTH_WAIT_MS = 8000;

const oauthStateKey = (state: string): string => `connoauth:${state}`;
const oauthLockKey = (tenantId: number, id: number): string => `connoauthlock:${tenantId}:${id}`;

/**
 * Subconjunto de ioredis que necesita el flujo OAuth. Se declara acá —mismo
 * criterio que el `HookCaptureStore` de v0.1.111— para poder ejercitar el
 * canje y el lock con un fake en memoria, sin levantar Redis en cada spec.
 */
export interface OAuthStateStore {
    set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
    set(key: string, value: string, mode: 'EX', seconds: number, nx: 'NX'): Promise<unknown>;
    getdel(key: string): Promise<string | null>;
    del(key: string): Promise<unknown>;
}

/** Lo que se guarda mientras la persona está en el proveedor autorizando. */
interface PendingOAuth {
    tenantId: number;
    userId: number;
    /** `null` = conectar una app de la galería por primera vez (la fila nace al volver). */
    connectionId: number | null;
    verifier: string;
    /** v0.1.203 — app de la galería que se está autorizando. */
    integration?: IntegrationKey;
    visibility?: ConnectorVisibility;
}

/** Con qué app del proveedor se autoriza y renueva una conexión. */
interface OAuthApp {
    clientId: string;
    clientSecret: string;
    authorizeUrl: string;
    tokenUrl: string;
    scopes: string;
    extraParams: ConnectorPair[];
    /** Microsoft exige repetir los scopes en el canje y en la renovación. */
    scopeOnToken: boolean;
    providerKey: string;
}

/** Lo que el motor necesita para ejecutar una acción de una app de la galería. */
export interface ResolvedIntegration {
    key: IntegrationKey;
    def: IntegrationDef;
    creds: IntegrationCreds;
}

/** Estado de la autorización, en `config.oauth_state` (sin tokens). */
interface StoredOAuthState {
    expiresAt: number | null;
    scope: string;
    error: string | null;
}

function readOAuthConfig(raw: unknown): OAuthConfig {
    const parsed = oauthConfigSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : oauthConfigSchema.parse({});
}

function readOAuthState(raw: unknown): StoredOAuthState {
    const obj = (raw ?? {}) as Record<string, unknown>;
    const expires = Number(obj.expiresAt);
    return {
        expiresAt: Number.isFinite(expires) && expires > 0 ? expires : null,
        scope: typeof obj.scope === 'string' ? obj.scope : '',
        error: typeof obj.error === 'string' && obj.error !== '' ? obj.error : null,
    };
}

/** Acción de un conector lista para ejecutar. */
export interface ResolvedAction {
    parts: ConnectionParts;
    action: ConnectorAction | null;
    name: string;
    /** Sólo para las apps de la galería: con qué y cómo se arma la petición. */
    integration: ResolvedIntegration | null;
}

/** Datos NO secretos de una app de la galería (`config.fields`). */
function readFields(raw: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (raw === null || typeof raw !== 'object') return out;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === 'string') out[key] = value;
    }
    return out;
}

@Injectable()
export class ConnectorsService {
    private readonly logger = new Logger(ConnectorsService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
        @Inject(REDIS) private readonly redis: OAuthStateStore,
        private readonly audit: AuditService,
        private readonly apps: IntegrationAppsService,
    ) {}

    // ── Ajustes del workspace ────────────────────────────────────────────

    async settings(tenantId: number): Promise<ConnectorSettings> {
        const [row] = await this.db
            .select({ settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const raw = (row?.settings as Record<string, unknown> | undefined)?.connectors;
        const parsed = connectorSettingsSchema.safeParse(raw ?? {});
        return parsed.success ? parsed.data : { allow_private: false };
    }

    async updateSettings(tenantId: number, input: ConnectorSettings): Promise<ConnectorSettings> {
        const [row] = await this.db
            .select({ settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);
        const settings = { ...(row?.settings ?? {}) } as Record<string, unknown>;
        settings.connectors = { allow_private: input.allow_private };
        await this.db
            .update(tenants)
            .set({ settings, updatedAt: new Date() })
            .where(eq(tenants.id, tenantId));
        return { allow_private: input.allow_private };
    }

    // ── Listado y detalle ────────────────────────────────────────────────

    /** Conexiones que esta persona puede ver: las del equipo y las suyas. */
    async list(tenantId: number, userId: number, role: Role): Promise<Connection[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select(COLUMNS)
                .from(connections)
                .where(eq(connections.tenantId, tenantId))
                .orderBy(asc(connections.name)),
        );
        const visible = rows.filter((r) => this.canSee(r as ConnectionRow, userId));
        const usage = await this.usageCounts(tenantId);
        const names = await this.ownerNames(visible.map((r) => r.ownerUserId));
        return visible.map((r) =>
            this.toDto(r as ConnectionRow, {
                usage: usage.get(r.id) ?? 0,
                ownerName: r.ownerUserId !== null ? (names.get(r.ownerUserId) ?? null) : null,
                canEdit: this.canEdit(r as ConnectionRow, userId, role),
            }),
        );
    }

    /**
     * Partes resueltas para EJECUTAR. La usa el motor de automatizaciones y el
     * probador de la acción, sin pasar por el ACL de visibilidad: una conexión
     * privada usada en una automatización compartida tiene que seguir
     * funcionando para todo el equipo, como en n8n. Quién puede EDITARLA es
     * otra pregunta, y esa sí se filtra.
     */
    async resolveParts(tenantId: number, connectionId: number): Promise<ConnectionParts | null> {
        const row = await this.ensureFreshToken(tenantId, await this.row(tenantId, connectionId));
        return this.partsFrom(row);
    }

    /**
     * Igual, pero DENTRO de la transacción del que llama. El motor de
     * automatizaciones ya corre en un `withTenant`: abrir otro acá tomaría una
     * segunda conexión del pool por cada acción, y con el pool chico eso es un
     * bloqueo esperando a sí mismo.
     */
    async resolvePartsInTx(tx: Tx, tenantId: number, connectionId: number): Promise<ConnectionParts | null> {
        const [raw] = await tx
            .select(COLUMNS)
            .from(connections)
            .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
            .limit(1);
        const row = await this.ensureFreshToken(tenantId, (raw as ConnectionRow | undefined) ?? null);
        return this.partsFrom(row);
    }

    /**
     * v0.1.198 — partes resueltas MÁS la acción con nombre pedida. Un solo
     * viaje a la base: el motor necesita las dos cosas juntas para ejecutar.
     * `action` viene en `null` cuando la clave ya no existe (la acción se
     * renombró o se borró del conector) y el motor lo reporta como fallo:
     * mandar la petición "a lo que haya" sería peor que no mandarla.
     */
    /** Igual que `resolveActionInTx`, abriendo su propia transacción (probador). */
    async resolveAction(
        tenantId: number,
        connectionId: number,
        actionKey: unknown,
    ): Promise<ResolvedAction | null> {
        return this.tenantDb.withTenant(tenantId, (tx) =>
            this.resolveActionInTx(tx, tenantId, connectionId, actionKey),
        );
    }

    async resolveActionInTx(
        tx: Tx,
        tenantId: number,
        connectionId: number,
        actionKey: unknown,
    ): Promise<ResolvedAction | null> {
        const [raw] = await tx
            .select(COLUMNS)
            .from(connections)
            .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
            .limit(1);
        const row = await this.ensureFreshToken(tenantId, (raw as ConnectionRow | undefined) ?? null);
        const parts = this.partsFrom(row);
        if (!row || !parts) return null;
        // v0.1.203 — una app de la galería trae sus acciones del CATÁLOGO (no
        // de la fila): así una mejora de la acción llega a todas las empresas
        // con el release, sin migrar conexiones.
        const def = integrationDef(row.provider);
        if (def && isIntegrationKey(row.provider)) {
            const secrets = this.readSecrets(row);
            if (secrets === null) throw new ConnectionUnusableError(row.name);
            return {
                parts,
                action: findConnectorAction(def.actions, actionKey),
                name: row.name,
                integration: {
                    key: row.provider,
                    def,
                    creds: {
                        secret: secrets.token ?? '',
                        accessToken: secrets.access_token ?? '',
                        fields: readFields(row.config.fields),
                    },
                },
            };
        }
        return {
            parts,
            action: findConnectorAction(readConnectorActions(row.config.actions), actionKey),
            name: row.name,
            integration: null,
        };
    }

    private partsFrom(row: ConnectionRow | null): ConnectionParts | null {
        if (!row) return null;
        const secrets = this.readSecrets(row);
        if (secrets === null) throw new ConnectionUnusableError(row.name);
        return connectionParts(
            {
                baseUrl: row.baseUrl,
                authType: row.authType as ConnectorAuthType,
                authKey: String(row.config.auth_key ?? ''),
                headers: readConfigPairs(row.config.headers),
                queryParams: readConfigPairs(row.config.query_params),
            },
            secrets,
        );
    }

    // ── OAuth 2.0 como cliente (v0.1.199, ADR-S22 fase 3) ────────────────

    /**
     * UNA URI de redirección por instalación. Tiene que estar registrada en la
     * consola del proveedor, así que no puede variar por tenant (un dominio
     * propio obligaría a registrar uno por empresa): el panel la muestra lista
     * para copiar.
     */
    oauthRedirectUri(): string {
        return `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/api/v1/connections/oauth/callback`;
    }

    /**
     * Con qué app del proveedor se habla. Una app de la GALERÍA usa la que el
     * operador registró en Plataforma → Integraciones; una API personalizada,
     * la que cargó la propia empresa en su formulario.
     */
    private async oauthAppFor(row: ConnectionRow, secrets: ConnectionSecrets): Promise<OAuthApp> {
        const def = integrationDef(row.provider);
        if (def && def.auth.kind === 'oauth') {
            const app = await this.apps.resolve(def.auth.provider);
            const provider = INTEGRATION_PROVIDER_DEFS[def.auth.provider];
            return {
                clientId: app.clientId,
                clientSecret: app.clientSecret,
                authorizeUrl: app.authorizeUrl,
                tokenUrl: app.tokenUrl,
                scopes: integrationScopes(def),
                extraParams: provider.extra_params,
                scopeOnToken: provider.scope_on_token,
                providerKey: def.auth.provider,
            };
        }
        const cfg = readOAuthConfig(row.config.oauth);
        return {
            clientId: cfg.client_id,
            clientSecret: secrets.client_secret ?? '',
            authorizeUrl: cfg.authorize_url,
            tokenUrl: cfg.token_url,
            scopes: cfg.scopes,
            extraParams: cfg.extra_params,
            scopeOnToken: false,
            providerKey: cfg.provider_key,
        };
    }

    /** Guarda el `state` + el verifier y arma la URL del proveedor. */
    private async beginOAuth(app: OAuthApp, pending: Omit<PendingOAuth, 'verifier'>): Promise<OAuthStartResult> {
        const pkce = createPkce();
        const state = randomBytes(24).toString('base64url');
        await this.redis.set(
            oauthStateKey(state),
            JSON.stringify({ ...pending, verifier: pkce.verifier } satisfies PendingOAuth),
            'EX',
            OAUTH_STATE_TTL_SECONDS,
        );
        return {
            authorize_url: buildAuthorizeUrl(
                {
                    client_id: app.clientId,
                    authorize_url: app.authorizeUrl,
                    token_url: app.tokenUrl,
                    scopes: app.scopes,
                    extra_params: app.extraParams,
                    provider_key: app.providerKey,
                },
                { redirectUri: this.oauthRedirectUri(), state, challenge: pkce.challenge },
            ),
        };
    }

    /** Arranca la autorización de una API personalizada con OAuth2. */
    async startOAuth(
        tenantId: number,
        userId: number,
        role: Role,
        id: number,
    ): Promise<OAuthStartResult> {
        const row = await this.requireEditable(tenantId, userId, role, id);
        if (integrationDef(row.provider)) {
            return this.startIntegrationOAuth(tenantId, userId, role, row.provider as IntegrationKey, {
                visibility: row.visibility as ConnectorVisibility,
                connection_id: id,
            });
        }
        const cfg = readOAuthConfig(row.config.oauth);
        for (const [field, label] of [
            ['client_id', 'el Client ID'],
            ['authorize_url', 'la URL de autorización'],
            ['token_url', 'la URL de tokens'],
        ] as const) {
            if (cfg[field].trim() === '') {
                throw new BadRequestException({
                    code: 'oauth_incomplete',
                    message: `Falta ${label} de la app registrada en el proveedor.`,
                    data: { status: 400 },
                });
            }
        }
        const secrets = this.readSecrets(row) ?? {};
        return this.beginOAuth(await this.oauthAppFor(row, secrets), {
            tenantId,
            userId,
            connectionId: id,
        });
    }

    /**
     * v0.1.203 — «Conectar» una app de la galería. La fila de la conexión NO se
     * crea acá sino al volver con la autorización: si la persona cancela en el
     * proveedor no queda una conexión a medias ensuciando la lista.
     */
    async startIntegrationOAuth(
        tenantId: number,
        userId: number,
        role: Role,
        key: IntegrationKey,
        input: AuthorizeIntegrationInput,
    ): Promise<OAuthStartResult> {
        const def = integrationDef(key);
        if (!def || def.auth.kind !== 'oauth') {
            throw new BadRequestException({
                code: 'integration_not_oauth',
                message: 'Esa app no se conecta con autorización.',
                data: { status: 400 },
            });
        }
        let visibility = input.visibility;
        let connectionId: number | null = null;
        if (input.connection_id) {
            const row = await this.requireEditable(tenantId, userId, role, input.connection_id);
            if (row.provider !== key) {
                throw new BadRequestException({
                    code: 'integration_mismatch',
                    message: 'Esa conexión es de otra app.',
                    data: { status: 400 },
                });
            }
            connectionId = row.id;
            visibility = row.visibility as ConnectorVisibility;
        } else {
            await this.assertMayUseVisibility(tenantId, role, visibility);
        }
        const app = await this.apps.resolve(def.auth.provider);
        const provider = INTEGRATION_PROVIDER_DEFS[def.auth.provider];
        return this.beginOAuth(
            {
                clientId: app.clientId,
                clientSecret: app.clientSecret,
                authorizeUrl: app.authorizeUrl,
                tokenUrl: app.tokenUrl,
                scopes: integrationScopes(def),
                extraParams: provider.extra_params,
                scopeOnToken: provider.scope_on_token,
                providerKey: def.auth.provider,
            },
            { tenantId, userId, connectionId, integration: key, visibility },
        );
    }

    /**
     * Vuelta del proveedor. El `state` se consume con `GETDEL` —de un solo uso,
     * el mismo criterio que el magic link del portal (SEC-15)— y además se
     * exige que lo canjee la MISMA persona que lo pidió: un código robado no
     * sirve en otra sesión.
     */
    async completeOAuth(
        sessionUserId: number,
        code: string,
        state: string,
    ): Promise<{ ok: boolean; error: string | null }> {
        if (code.trim() === '' || state.trim() === '') {
            return { ok: false, error: 'El proveedor no devolvió el código de autorización.' };
        }
        const raw = await this.redis.getdel(oauthStateKey(state));
        if (!raw) {
            return {
                ok: false,
                error: 'La autorización venció o ya se usó. Volvé a empezar desde Ajustes → Integraciones.',
            };
        }
        let pending: PendingOAuth;
        try {
            pending = JSON.parse(raw) as PendingOAuth;
        } catch {
            return { ok: false, error: 'La autorización quedó en un estado inválido.' };
        }
        if (pending.userId !== sessionUserId) {
            return { ok: false, error: 'Esta autorización la inició otra persona.' };
        }

        // Primera conexión de una app de la galería: todavía no hay fila.
        if (pending.connectionId === null) {
            if (!pending.integration) return { ok: false, error: 'La autorización quedó en un estado inválido.' };
            return this.completeNewIntegration(pending, code);
        }

        const row = await this.row(pending.tenantId, pending.connectionId);
        if (!row) return { ok: false, error: 'La conexión ya no existe.' };
        const secrets = this.readSecrets(row);
        if (secrets === null) {
            return { ok: false, error: new ConnectionUnusableError(row.name).message };
        }

        try {
            const app = await this.oauthAppFor(row, secrets);
            const token = await this.exchangeCode(app, code, pending.verifier);
            await this.storeTokens(pending.tenantId, row, token, {
                // Un proveedor que no rota el refresh no lo reenvía en el canje;
                // conservar el anterior evita romper una re-autorización.
                keepRefresh: true,
            });
            const def = integrationDef(row.provider);
            if (def && def.auth.kind === 'oauth') {
                const label = await this.fetchIdentity(def.auth.provider, token.accessToken);
                if (label) await this.setAccountLabel(pending.tenantId, row.id, label);
            }
            await this.audit.log({
                tenantId: pending.tenantId,
                userId: sessionUserId,
                action: 'connection.oauth_connect',
                targetType: 'connection',
                targetId: row.id,
                targetLabel: row.name,
                meta: {
                    provider_key: app.providerKey,
                    has_refresh: token.refreshToken !== null,
                    scope: token.scope,
                },
            });
            return { ok: true, error: null };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await this.setOAuthError(pending.tenantId, row.id, message);
            return { ok: false, error: message };
        }
    }

    /** Canje del código. Microsoft pide repetir los scopes; el resto los ignora. */
    private async exchangeCode(app: OAuthApp, code: string, verifier: string): Promise<TokenResponse> {
        let body = buildTokenExchangeBody({
            code,
            redirectUri: this.oauthRedirectUri(),
            clientId: app.clientId,
            clientSecret: app.clientSecret,
            verifier,
        });
        if (app.scopeOnToken && app.scopes !== '') body += `&scope=${encodeURIComponent(app.scopes)}`;
        return this.postToken(app.tokenUrl, body);
    }

    private async completeNewIntegration(
        pending: PendingOAuth,
        code: string,
    ): Promise<{ ok: boolean; error: string | null }> {
        const key = pending.integration!;
        const def = integrationDef(key);
        if (!def || def.auth.kind !== 'oauth') return { ok: false, error: 'Esa app ya no existe.' };
        try {
            const app = await this.apps.resolve(def.auth.provider);
            const provider = INTEGRATION_PROVIDER_DEFS[def.auth.provider];
            const token = await this.exchangeCode(
                {
                    clientId: app.clientId,
                    clientSecret: app.clientSecret,
                    authorizeUrl: app.authorizeUrl,
                    tokenUrl: app.tokenUrl,
                    scopes: integrationScopes(def),
                    extraParams: provider.extra_params,
                    scopeOnToken: provider.scope_on_token,
                    providerKey: def.auth.provider,
                },
                code,
                pending.verifier,
            );
            const label = await this.fetchIdentity(def.auth.provider, token.accessToken);
            const secrets: Record<string, string> = {
                access_token: encryptSecret(token.accessToken, this.env.SECRETS_KEY),
            };
            if (token.refreshToken !== null) {
                secrets.refresh_token = encryptSecret(token.refreshToken, this.env.SECRETS_KEY);
            }
            const oauthState: StoredOAuthState = {
                expiresAt: token.expiresAt,
                scope: token.scope,
                error: null,
            };
            await this.tenantDb.withTenant(pending.tenantId, async (tx) => {
                const name = await this.uniqueName(tx, pending.tenantId, def.name, label);
                const [created] = await tx
                    .insert(connections)
                    .values({
                        tenantId: pending.tenantId,
                        provider: key,
                        name,
                        baseUrl: '',
                        authType: 'oauth2',
                        config: { account_label: label, oauth_state: oauthState },
                        secrets,
                        visibility: pending.visibility ?? 'workspace',
                        ownerUserId: pending.userId,
                        createdBy: pending.userId,
                    })
                    .returning({ id: connections.id });
                await this.audit.logInTx(tx, {
                    tenantId: pending.tenantId,
                    userId: pending.userId,
                    action: 'connection.create',
                    targetType: 'connection',
                    targetId: created!.id,
                    targetLabel: name,
                    meta: { integration: key, account: label, has_refresh: token.refreshToken !== null },
                });
            });
            return { ok: true, error: null };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    }

    /**
     * Con qué cuenta quedó conectada. Best-effort: si el proveedor no contesta,
     * la conexión igual sirve; sólo se muestra sin el correo.
     */
    private async fetchIdentity(provider: IntegrationProvider, accessToken: string): Promise<string | null> {
        try {
            const req = identityRequest(provider, accessToken);
            const res = await safeWebhookFetch(req.url, {
                method: req.method,
                headers: req.headers,
                captureBody: true,
                timeoutMs: 8000,
            });
            if (res.status >= 400) return null;
            return identityLabel(provider, res.body ?? '');
        } catch {
            return null;
        }
    }

    private async setAccountLabel(tenantId: number, id: number, label: string): Promise<void> {
        await this.tenantDb
            .withTenant(tenantId, async (tx) => {
                const [current] = await tx
                    .select({ config: connections.config })
                    .from(connections)
                    .where(and(eq(connections.tenantId, tenantId), eq(connections.id, id)))
                    .limit(1);
                const config = { ...((current?.config ?? {}) as Record<string, unknown>), account_label: label };
                await tx
                    .update(connections)
                    .set({ config })
                    .where(and(eq(connections.tenantId, tenantId), eq(connections.id, id)));
            })
            .catch(() => undefined);
    }

    /** «Slack · Acme»; si ya existe, «Slack · Acme (2)». El nombre es único por empresa. */
    private async uniqueName(tx: Tx, tenantId: number, base: string, label: string | null): Promise<string> {
        const wanted = label ? `${base} · ${label}` : base;
        const rows = await tx
            .select({ name: connections.name })
            .from(connections)
            .where(eq(connections.tenantId, tenantId));
        const taken = new Set(rows.map((r) => r.name.toLowerCase()));
        if (!taken.has(wanted.toLowerCase())) return wanted.slice(0, 120);
        for (let n = 2; n < 100; n += 1) {
            const candidate = `${wanted} (${n})`;
            if (!taken.has(candidate.toLowerCase())) return candidate.slice(0, 120);
        }
        return `${wanted} ${Date.now()}`.slice(0, 120);
    }

    /** Revoca localmente: borra los tokens y deja la app registrada intacta. */
    async disconnectOAuth(
        tenantId: number,
        userId: number,
        role: Role,
        id: number,
    ): Promise<Connection> {
        const row = await this.requireEditable(tenantId, userId, role, id);
        const secrets = { ...row.secrets };
        delete secrets.access_token;
        delete secrets.refresh_token;
        const config = { ...row.config, oauth_state: null };
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            await tx
                .update(connections)
                .set({ secrets, config, updatedAt: new Date() })
                .where(and(eq(connections.tenantId, tenantId), eq(connections.id, id)));
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'connection.oauth_disconnect',
                targetType: 'connection',
                targetId: id,
                targetLabel: row.name,
                meta: {},
            });
        });
        const fresh = await this.row(tenantId, id);
        const usage = await this.usageCounts(tenantId);
        return this.toDto(fresh!, { usage: usage.get(id) ?? 0, ownerName: null, canEdit: true });
    }

    /**
     * Renueva el access token si hace falta, ANTES de armar las partes.
     *
     * Dos cuidados que no son opcionales:
     *  - **Transacción propia**: si la automatización que pidió la conexión
     *    falla después y revierte, un proveedor que ROTA el refresh token
     *    dejaría la conexión muerta para siempre (guardamos uno que el
     *    proveedor ya invalidó). Por eso el token se escribe en su propia
     *    transacción y no en la del que llama.
     *    El costo es una segunda conexión del pool mientras dura el canje,
     *    pero sólo pasa cuando de verdad hay que renovar —una vez por hora por
     *    conexión—, no en cada acción.
     *  - **Un solo renovador a la vez**: dos acciones en paralelo canjeando el
     *    mismo refresh rotativo hacen que el segundo reciba `invalid_grant`.
     *    Se toma un lock corto en Redis y, si lo tiene otro, se espera a que
     *    aparezca el token nuevo en vez de pedir uno por las nuestras.
     */
    private async ensureFreshToken(
        tenantId: number,
        row: ConnectionRow | null,
    ): Promise<ConnectionRow | null> {
        if (!row || row.authType !== 'oauth2') return row;
        const state = readOAuthState(row.config.oauth_state);
        if (!needsRefresh(state.expiresAt, Date.now())) return row;

        const secrets = this.readSecrets(row);
        if (secrets === null) throw new ConnectionUnusableError(row.name);
        const refresh = secrets.refresh_token ?? '';
        if (refresh === '') {
            throw new BadRequestException({
                code: 'oauth_expired',
                message: `La autorización de «${row.name}» venció y el proveedor no entregó un token de renovación. Volvé a conectarla en Ajustes → Integraciones.`,
                data: { status: 400 },
            });
        }

        const lock = oauthLockKey(tenantId, row.id);
        const mine = await this.redis.set(lock, '1', 'EX', OAUTH_LOCK_SECONDS, 'NX');
        if (mine === null) {
            const updated = await this.waitForRefresh(tenantId, row);
            if (updated) return updated;
            throw new ConflictException({
                code: 'oauth_refresh_busy',
                message: `Otra ejecución está renovando la autorización de «${row.name}». Reintentá en unos segundos.`,
                data: { status: 409 },
            });
        }

        try {
            const app = await this.oauthAppFor(row, secrets);
            let body = buildRefreshBody({
                refreshToken: refresh,
                clientId: app.clientId,
                clientSecret: app.clientSecret,
            });
            if (app.scopeOnToken && app.scopes !== '') body += `&scope=${encodeURIComponent(app.scopes)}`;
            const token = await this.postToken(app.tokenUrl, body);
            await this.storeTokens(tenantId, row, token, { keepRefresh: true });
            return await this.row(tenantId, row.id);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await this.setOAuthError(tenantId, row.id, message);
            throw new BadRequestException({
                code: 'oauth_refresh_failed',
                message: `No se pudo renovar la autorización de «${row.name}»: ${message}`,
                data: { status: 400 },
            });
        } finally {
            await this.redis.del(lock).catch(() => undefined);
        }
    }

    /** Espera a que el que tiene el lock publique el token nuevo. */
    private async waitForRefresh(
        tenantId: number,
        row: ConnectionRow,
    ): Promise<ConnectionRow | null> {
        const deadline = Date.now() + OAUTH_WAIT_MS;
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            const fresh = await this.row(tenantId, row.id);
            if (!fresh) return null;
            const state = readOAuthState(fresh.config.oauth_state);
            if (!needsRefresh(state.expiresAt, Date.now())) return fresh;
        }
        return null;
    }

    /** POST al endpoint de tokens, por el guard de egreso (SEC-03). */
    private async postToken(tokenUrl: string, body: string): Promise<TokenResponse> {
        const res = await safeWebhookFetch(tokenUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                accept: 'application/json',
            },
            body,
            captureBody: true,
        });
        // `parseTokenResponse` propaga el error del proveedor tal cual
        // ("invalid_grant" es exactamente lo que hay que leer), así que el
        // status sólo se usa cuando el cuerpo no dice nada.
        const parsed = parseTokenResponse(res.body ?? '', res.contentType ?? '', Date.now());
        if (res.status >= 400) {
            throw new Error(`El proveedor respondió ${res.status}.`);
        }
        return parsed;
    }

    private async storeTokens(
        tenantId: number,
        row: ConnectionRow,
        token: TokenResponse,
        opts: { keepRefresh: boolean },
    ): Promise<void> {
        const secrets = { ...row.secrets };
        secrets.access_token = encryptSecret(token.accessToken, this.env.SECRETS_KEY);
        if (token.refreshToken !== null) {
            secrets.refresh_token = encryptSecret(token.refreshToken, this.env.SECRETS_KEY);
        } else if (!opts.keepRefresh) {
            delete secrets.refresh_token;
        }
        const state: StoredOAuthState = {
            expiresAt: token.expiresAt,
            scope: token.scope,
            error: null,
        };
        const config = { ...row.config, oauth_state: state };
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(connections)
                .set({ secrets, config, updatedAt: new Date() })
                .where(and(eq(connections.tenantId, tenantId), eq(connections.id, row.id))),
        );
    }

    /** Deja el motivo a la vista en el panel en vez de sólo en los logs. */
    private async setOAuthError(tenantId: number, id: number, message: string): Promise<void> {
        await this.tenantDb
            .withTenant(tenantId, async (tx) => {
                const [current] = await tx
                    .select({ config: connections.config })
                    .from(connections)
                    .where(and(eq(connections.tenantId, tenantId), eq(connections.id, id)))
                    .limit(1);
                const cfg = { ...((current?.config ?? {}) as Record<string, unknown>) };
                const state = readOAuthState(cfg.oauth_state);
                cfg.oauth_state = { ...state, error: message.slice(0, 400) } satisfies StoredOAuthState;
                await tx
                    .update(connections)
                    .set({ config: cfg })
                    .where(and(eq(connections.tenantId, tenantId), eq(connections.id, id)));
            })
            .catch(() => undefined);
    }

    // ── Galería de apps (v0.1.203, ADR-S22 fase 4) ───────────────────────

    /** Qué puede conectar esta persona y qué proveedores configuró el operador. */
    async integrationsOverview(tenantId: number, userId: number, role: Role): Promise<IntegrationsOverview> {
        const [configured, settings, email] = await Promise.all([
            this.apps.configured(),
            this.settings(tenantId),
            this.userEmail(userId),
        ]);
        const providers: Record<string, { configured: boolean }> = {};
        for (const [provider, ok] of Object.entries(configured)) providers[provider] = { configured: ok };
        const superadmins = new Set(this.env.PLATFORM_SUPERADMINS.map((e) => e.toLowerCase()));
        return {
            providers,
            can_connect_workspace: role === 'admin',
            can_connect_private: role === 'admin' || settings.allow_private,
            is_platform_admin: email !== null && superadmins.has(email),
        };
    }

    /**
     * Prueba los datos de una app por clave ANTES de guardarlos: si Telegram no
     * reconoce el token, la persona lo sabe en el mismo diálogo. También lista
     * lo que se puede elegir (las cuentas de WhatsApp de la clave).
     */
    async verifyIntegration(
        tenantId: number,
        userId: number,
        role: Role,
        key: IntegrationKey,
        input: VerifyIntegrationInput,
    ): Promise<VerifyIntegrationResult> {
        const { def, creds } = await this.keyCreds(tenantId, userId, role, key, input.fields, input.connection_id ?? null);
        if (creds.secret === '') {
            return {
                ok: false,
                account_label: null,
                error: `Falta «${secretField(def)?.label ?? 'la clave'}».`,
                warning: null,
                options: {},
            };
        }
        const outcome = await this.runVerify(key, creds);
        return {
            ok: outcome.ok,
            account_label: outcome.label,
            error: outcome.error,
            warning: outcome.warning,
            options: outcome.options,
        };
    }

    /** Conecta (o actualiza) una app por clave. Una clave rechazada NO se guarda. */
    async connectIntegrationKey(
        tenantId: number,
        userId: number,
        role: Role,
        key: IntegrationKey,
        input: ConnectIntegrationKeyInput,
    ): Promise<{ connection: Connection; warning: string | null }> {
        const existingId = input.connection_id ?? null;
        const { def, creds, row } = await this.keyCreds(tenantId, userId, role, key, input.fields, existingId);
        if (def.auth.kind !== 'key') throw new BadRequestException({ code: 'integration_not_key', message: 'Esa app se conecta con «Conectar», no con una clave.', data: { status: 400 } });

        for (const f of def.auth.fields) {
            const value = f.secret ? creds.secret : (creds.fields[f.key] ?? '');
            if (f.required && value.trim() === '') {
                throw new BadRequestException({
                    code: 'integration_field_missing',
                    message: `Falta «${f.label}».`,
                    data: { status: 400 },
                });
            }
        }
        if (!row) await this.assertMayUseVisibility(tenantId, role, input.visibility);

        const outcome = await this.runVerify(key, creds);
        if (!outcome.ok) {
            throw new BadRequestException({
                code: 'integration_rejected',
                message: outcome.error ?? 'El servicio rechazó los datos.',
                data: { status: 400 },
            });
        }

        const secretKey = secretField(def);
        const provided = secretKey ? (input.fields[secretKey.key] ?? '').trim() : '';
        const secrets = { ...(row?.secrets ?? {}) };
        if (provided !== '') secrets.token = encryptSecret(provided, this.env.SECRETS_KEY);
        const config: Record<string, unknown> = {
            ...(row?.config ?? {}),
            fields: creds.fields,
            account_label: outcome.label ?? (row?.config.account_label as string | undefined) ?? null,
        };

        const id = await this.tenantDb.withTenant(tenantId, async (tx) => {
            if (row) {
                await tx
                    .update(connections)
                    .set({ config, secrets, updatedAt: new Date(), lastCheckAt: new Date(), lastCheckOk: true, lastCheckError: null })
                    .where(and(eq(connections.tenantId, tenantId), eq(connections.id, row.id)));
                await this.audit.logInTx(tx, {
                    tenantId,
                    userId,
                    action: 'connection.update',
                    targetType: 'connection',
                    targetId: row.id,
                    targetLabel: row.name,
                    meta: { integration: key, secret_rotated: provided !== '' },
                });
                return row.id;
            }
            const name = await this.uniqueName(tx, tenantId, def.name, outcome.label);
            const [created] = await tx
                .insert(connections)
                .values({
                    tenantId,
                    provider: key,
                    name,
                    baseUrl: '',
                    authType: 'none',
                    config,
                    secrets,
                    visibility: input.visibility,
                    ownerUserId: userId,
                    createdBy: userId,
                    lastCheckAt: new Date(),
                    lastCheckOk: true,
                })
                .returning({ id: connections.id });
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'connection.create',
                targetType: 'connection',
                targetId: created!.id,
                targetLabel: name,
                // Nunca el secreto: la bitácora la lee cualquier admin.
                meta: { integration: key, account: outcome.label, visibility: input.visibility },
            });
            return created!.id;
        });

        const fresh = await this.row(tenantId, id);
        const usage = await this.usageCounts(tenantId);
        return {
            connection: this.toDto(fresh!, { usage: usage.get(id) ?? 0, ownerName: null, canEdit: true }),
            warning: outcome.warning,
        };
    }

    /**
     * Conexiones activas por proveedor en TODA la plataforma, para la consola
     * del operador («Google: 12 empresas conectadas»). Corre sobre la conexión
     * base (sin RLS), igual que el resto de la consola.
     */
    async providerUsage(): Promise<Map<IntegrationProvider, number>> {
        const rows = await this.db.select({ provider: connections.provider }).from(connections);
        const out = new Map<IntegrationProvider, number>();
        for (const r of rows) {
            const def = integrationDef(r.provider);
            if (def && def.auth.kind === 'oauth') {
                out.set(def.auth.provider, (out.get(def.auth.provider) ?? 0) + 1);
            }
        }
        return out;
    }

    /** Arma las credenciales de una app por clave: lo tipeado + lo ya guardado. */
    private async keyCreds(
        tenantId: number,
        userId: number,
        role: Role,
        key: IntegrationKey,
        fields: Record<string, string>,
        connectionId: number | null,
    ): Promise<{ def: IntegrationDef; creds: IntegrationCreds; row: ConnectionRow | null }> {
        const def = integrationDef(key);
        if (!def || def.auth.kind !== 'key') {
            throw new BadRequestException({
                code: 'integration_not_key',
                message: 'Esa app se conecta con «Conectar», no con una clave.',
                data: { status: 400 },
            });
        }
        let row: ConnectionRow | null = null;
        let stored: ConnectionSecrets = {};
        let storedFields: Record<string, string> = {};
        if (connectionId) {
            row = await this.requireEditable(tenantId, userId, role, connectionId);
            if (row.provider !== key) {
                throw new BadRequestException({
                    code: 'integration_mismatch',
                    message: 'Esa conexión es de otra app.',
                    data: { status: 400 },
                });
            }
            const secrets = this.readSecrets(row);
            if (secrets === null) {
                // Ilegible: se exige la clave de nuevo, que es justamente el arreglo.
                stored = {};
            } else {
                stored = secrets;
            }
            storedFields = readFields(row.config.fields);
        }
        const secretDef = secretField(def);
        const out: Record<string, string> = {};
        for (const f of def.auth.fields) {
            if (f.secret) continue;
            const typed = fields[f.key];
            const value = typed !== undefined ? typed.trim() : (storedFields[f.key] ?? '');
            out[f.key] = value !== '' ? value : f.default;
        }
        const typedSecret = secretDef ? (fields[secretDef.key] ?? '').trim() : '';
        return {
            def,
            row,
            creds: {
                secret: typedSecret !== '' ? typedSecret : (stored.token ?? ''),
                accessToken: '',
                fields: out,
            },
        };
    }

    private async runVerify(key: IntegrationKey, creds: IntegrationCreds) {
        const req = verifyRequest(key, creds);
        if (!req) return { ok: true, label: null, error: null, warning: null, options: {} };
        try {
            const res = await safeWebhookFetch(req.url, {
                method: req.method,
                headers: req.headers,
                captureBody: true,
                timeoutMs: 10_000,
            });
            return parseVerify(key, res.status, res.body ?? '', creds);
        } catch (err) {
            // Sin red hasta el servicio no se sabe si la clave sirve: se deja
            // guardar, avisando, en vez de bloquear por un problema pasajero.
            const message = redactValues(err instanceof Error ? err.message : String(err), [creds.secret]);
            return {
                ok: true,
                label: null,
                error: null,
                warning: `No pudimos comprobar la conexión ahora (${message}). Se puede guardar igual.`,
                options: {},
            };
        }
    }

    private async userEmail(userId: number): Promise<string | null> {
        const [row] = await this.db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        return row?.email ? row.email.toLowerCase() : null;
    }

    // ── Alta, edición y baja ─────────────────────────────────────────────

    async create(
        tenantId: number,
        userId: number,
        role: Role,
        input: CreateConnectionInput,
    ): Promise<Connection> {
        await this.assertMayUseVisibility(tenantId, role, input.visibility);
        const secrets = this.encryptAll({}, input);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [created] = await tx
                .insert(connections)
                .values({
                    tenantId,
                    provider: input.provider,
                    name: input.name,
                    baseUrl: input.base_url,
                    authType: input.auth_type,
                    config: {
                        auth_key: input.auth_key,
                        headers: input.headers,
                        query_params: input.query_params,
                        actions: input.actions,
                        oauth: input.oauth ?? oauthConfigSchema.parse({}),
                    },
                    secrets,
                    visibility: input.visibility,
                    ownerUserId: userId,
                    createdBy: userId,
                })
                .returning(COLUMNS);
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'connection.create',
                targetType: 'connection',
                targetId: created!.id,
                targetLabel: input.name,
                // Nunca el secreto: la bitácora la lee cualquier admin.
                meta: { auth_type: input.auth_type, visibility: input.visibility, base_url: input.base_url },
            });
            return created!;
        }).catch((err: unknown) => {
            throw this.mapDuplicate(err, input.name);
        });
        return this.toDto(row as ConnectionRow, { usage: 0, ownerName: null, canEdit: true });
    }

    async update(
        tenantId: number,
        userId: number,
        role: Role,
        id: number,
        patch: UpdateConnectionInput,
    ): Promise<Connection> {
        const current = await this.requireEditable(tenantId, userId, role, id);
        if (patch.visibility !== undefined && patch.visibility !== current.visibility) {
            await this.assertMayUseVisibility(tenantId, role, patch.visibility);
        }
        const config = { ...current.config };
        if (patch.auth_key !== undefined) config.auth_key = patch.auth_key;
        if (patch.headers !== undefined) config.headers = patch.headers;
        if (patch.query_params !== undefined) config.query_params = patch.query_params;
        if (patch.actions !== undefined) config.actions = patch.actions;
        if (patch.oauth !== undefined) config.oauth = patch.oauth;

        const changes: Record<string, unknown> = { config, updatedAt: new Date() };
        if (patch.name !== undefined) changes.name = patch.name;
        if (patch.base_url !== undefined) changes.baseUrl = patch.base_url;
        if (patch.auth_type !== undefined) changes.authType = patch.auth_type;
        if (patch.visibility !== undefined) changes.visibility = patch.visibility;
        changes.secrets = this.encryptAll(current.secrets, patch);

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [updated] = await tx
                .update(connections)
                .set(changes)
                .where(and(eq(connections.tenantId, tenantId), eq(connections.id, id)))
                .returning(COLUMNS);
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'connection.update',
                targetType: 'connection',
                targetId: id,
                targetLabel: updated?.name ?? current.name,
                meta: { fields: Object.keys(patch), secret_rotated: this.touchesSecret(patch) },
            });
            return updated!;
        }).catch((err: unknown) => {
            throw this.mapDuplicate(err, patch.name ?? current.name);
        });
        const usage = await this.usageCounts(tenantId);
        return this.toDto(row as ConnectionRow, {
            usage: usage.get(id) ?? 0,
            ownerName: null,
            canEdit: true,
        });
    }

    /**
     * Borrar una conexión en uso rompe automatizaciones, así que por defecto
     * se rechaza diciendo EXACTAMENTE cuáles. Es la pregunta que las
     * plataformas grandes contestan mal y acá sale gratis.
     */
    async remove(
        tenantId: number,
        userId: number,
        role: Role,
        id: number,
        force: boolean,
    ): Promise<void> {
        const current = await this.requireEditable(tenantId, userId, role, id);
        const usage = await this.usage(tenantId, id);
        if (usage.length > 0 && !force) {
            throw new ConflictException({
                code: 'connection_in_use',
                message: `La conexión «${current.name}» la usan ${usage.length} automatización(es).`,
                data: { status: 409, usage },
            });
        }
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            await tx
                .delete(connections)
                .where(and(eq(connections.tenantId, tenantId), eq(connections.id, id)));
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'connection.delete',
                targetType: 'connection',
                targetId: id,
                targetLabel: current.name,
                meta: { in_use: usage.length, forced: force },
            });
        });
    }

    // ── Dónde se usa ─────────────────────────────────────────────────────

    async usage(tenantId: number, connectionId: number): Promise<ConnectionUsage[]> {
        const rows = await this.automationRows(tenantId);
        const out: ConnectionUsage[] = [];
        for (const row of rows) {
            let count = 0;
            walkActions(row.actions, (action) => {
                // v0.1.203 — también las acciones con nombre (`connector_action`):
                // antes sólo se contaban los webhooks y borrar una conexión usada
                // por «Enviar WhatsApp» no avisaba nada.
                if (!usesConnection(action.type)) return;
                const cfg = (action.config ?? {}) as Record<string, unknown>;
                if (Number(cfg.connection_id) === connectionId) count += 1;
            });
            if (count > 0) {
                out.push({
                    automation_id: row.id,
                    automation_name: row.name,
                    list_id: row.listId,
                    list_slug: row.listSlug,
                    list_name: row.listName,
                    actions: count,
                });
            }
        }
        return out;
    }

    private async usageCounts(tenantId: number): Promise<Map<number, number>> {
        const rows = await this.automationRows(tenantId);
        const counts = new Map<number, number>();
        for (const row of rows) {
            walkActions(row.actions, (action) => {
                if (!usesConnection(action.type)) return;
                const cfg = (action.config ?? {}) as Record<string, unknown>;
                const id = Number(cfg.connection_id);
                if (Number.isFinite(id) && id > 0) counts.set(id, (counts.get(id) ?? 0) + 1);
            });
        }
        return counts;
    }

    // ── Probar la conexión ───────────────────────────────────────────────

    /**
     * Pega a la API con la credencial puesta y devuelve lo que se envió y lo
     * que contestaron, con el secreto tapado. Cualquier fallo de red es un
     * RESULTADO, no un 500: el usuario tiene que poder leer "host inexistente"
     * o "401" en la misma tarjeta donde está configurando.
     */
    async test(
        tenantId: number,
        userId: number,
        role: Role,
        input: ConnectionDraftTestInput,
    ): Promise<ConnectionTestResult> {
        let parts: ConnectionParts;
        let savedId: number | null = null;
        if (input.connection_id) {
            // Probar una conexión guardada: los secretos salen de la base, así
            // no hay que volver a tipearlos para verificar que siguen sirviendo.
            const saved = await this.requireEditable(tenantId, userId, role, input.connection_id);
            savedId = saved.id;
            // Con OAuth2, probar con un access token vencido daría un 401 que
            // parece un problema de configuración y no lo es: se renueva igual
            // que al ejecutar una automatización.
            const row = (await this.ensureFreshToken(tenantId, saved)) ?? saved;
            const secrets = this.readSecrets(row);
            if (secrets === null) {
                return {
                    ok: false,
                    status: null,
                    sent_headers: {},
                    url: '',
                    body: null,
                    error: new ConnectionUnusableError(row.name).message,
                };
            }
            parts = connectionParts(
                {
                    baseUrl: input.base_url !== '' ? input.base_url : row.baseUrl,
                    authType: (input.auth_type !== 'none' ? input.auth_type : row.authType) as ConnectorAuthType,
                    authKey: input.auth_key !== '' ? input.auth_key : String(row.config.auth_key ?? ''),
                    headers: input.headers.length > 0 ? input.headers : readConfigPairs(row.config.headers),
                    queryParams:
                        input.query_params.length > 0
                            ? input.query_params
                            : readConfigPairs(row.config.query_params),
                },
                secrets,
            );
        } else {
            parts = connectionParts(
                {
                    baseUrl: input.base_url,
                    authType: input.auth_type,
                    authKey: input.auth_key,
                    headers: input.headers,
                    queryParams: input.query_params,
                },
                {
                    token: input.token ?? '',
                    username: input.username ?? '',
                    password: input.password ?? '',
                    signing_secret: input.signing_secret ?? '',
                },
            );
        }

        let url = joinUrl(parts.baseUrl, input.path);
        if (parts.query.length > 0) {
            const qs = parts.query
                .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
                .join('&');
            url += (url.includes('?') ? '&' : '?') + qs;
        }
        const headers = { ...parts.headers };
        let body: string | undefined;
        if (input.method === 'POST' && parts.body.length > 0) {
            // Con auth en el cuerpo, un GET no prueba nada: hay que mandarlo.
            body = parts.body
                .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
                .join('&');
            headers['content-type'] ??= 'application/x-www-form-urlencoded';
        }

        const shown = {
            sent_headers: maskHeaders(headers),
            url: redactValues(url, parts.redact),
        };
        if (url.trim() === '') {
            return {
                ok: false,
                status: null,
                ...shown,
                body: null,
                error: 'Falta la URL base de la conexión.',
            };
        }
        try {
            const res = await safeWebhookFetch(url, {
                method: input.method,
                headers,
                body,
                captureBody: true,
            });
            const ok = res.status >= 200 && res.status < 400;
            await this.recordCheck(tenantId, savedId, ok, ok ? null : `HTTP ${res.status}`);
            return {
                ok,
                status: res.status,
                ...shown,
                body: redactValues((res.body ?? '').slice(0, MAX_TEST_BODY), parts.redact),
                error: ok ? null : `El servidor respondió ${res.status}.`,
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await this.recordCheck(tenantId, savedId, false, message);
            return { ok: false, status: null, ...shown, body: null, error: redactValues(message, parts.redact) };
        }
    }

    // ── Conversión de los secretos escritos dentro de las acciones ───────

    /**
     * Agrupa por host + huella de la credencial. Dos credenciales distintas
     * contra el mismo host son DOS conexiones: fusionarlas rompería una.
     */
    async scanInline(tenantId: number): Promise<InlineSecretCandidate[]> {
        const groups = await this.inlineGroups(tenantId);
        return [...groups.values()].map((g) => ({
            host: g.key,
            suggested_name: g.suggestedName,
            base_url: g.baseUrl,
            auth_type: g.detected.authType,
            auth_key: g.detected.authKey,
            found: g.detected.found.filter(
                (f): f is 'auth_header' | 'auth_query' | 'signing_secret' => f !== 'auth_body',
            ),
            secret_hint: secretHint(g.detected.token || g.detected.password || g.detected.signingSecret),
            automations: [...g.automations.values()].map((a) => ({
                id: a.id,
                name: a.name,
                list_slug: a.listSlug,
                actions: a.actions,
            })),
        }));
    }

    async convertInline(
        tenantId: number,
        userId: number,
        role: Role,
        input: ConvertInlineSecretsInput,
    ): Promise<ConvertInlineSecretsResult> {
        // Se re-escanea del lado del servidor: el cliente elige QUÉ convertir,
        // nunca aporta el contenido de la credencial.
        const groups = await this.inlineGroups(tenantId);
        const result: ConvertInlineSecretsResult = {
            created: [],
            actions_rewritten: 0,
            automations_updated: 0,
            warnings: [],
        };

        for (const item of input.items) {
            const group = groups.get(item.host);
            if (!group) {
                result.warnings.push(`Ya no hay secretos escritos para «${item.host}»: se omitió.`);
                continue;
            }
            await this.assertMayUseVisibility(tenantId, role, item.visibility);
            const detected = group.detected;
            const secrets = this.encryptAll(
                {},
                {
                    token: detected.token,
                    username: detected.username,
                    password: detected.password,
                    signing_secret: detected.signingSecret,
                },
            );

            await this.tenantDb.withTenant(tenantId, async (tx) => {
                const [created] = await tx
                    .insert(connections)
                    .values({
                        tenantId,
                        provider: 'http',
                        name: item.name,
                        baseUrl: group.baseUrl,
                        authType: detected.authType,
                        config: { auth_key: detected.authKey, headers: [], query_params: [] },
                        secrets,
                        visibility: item.visibility,
                        ownerUserId: userId,
                        createdBy: userId,
                    })
                    .returning({ id: connections.id });
                const connectionId = created!.id;

                let rewritten = 0;
                let touchedAutomations = 0;
                for (const auto of group.automations.values()) {
                    // `auto.actions` es el CONTADOR de acciones del grupo; el
                    // árbol real es `actionsJson`. Se clona antes de tocarlo
                    // para no mutar lo que ya leímos.
                    const actions = JSON.parse(JSON.stringify(auto.actionsJson)) as unknown;
                    let changed = 0;
                    walkActions(actions, (action) => {
                        if (action.type !== 'call_webhook') return;
                        const cfg = (action.config ?? {}) as Record<string, unknown>;
                        if (hostOf(cfg.url) !== group.host) return;
                        const found = detectInlineCredential(cfg);
                        if (!found || credentialFingerprint(found) !== group.fingerprint) return;
                        action.config = rewriteActionConfig(cfg, connectionId, found);
                        changed += 1;
                    });
                    if (changed === 0) continue;
                    await tx
                        .update(automations)
                        .set({ actions: actions as never, updatedAt: new Date() })
                        .where(and(eq(automations.tenantId, tenantId), eq(automations.id, auto.id)));
                    rewritten += changed;
                    touchedAutomations += 1;
                }

                await this.audit.logInTx(tx, {
                    tenantId,
                    userId,
                    action: 'connection.convert',
                    targetType: 'connection',
                    targetId: connectionId,
                    targetLabel: item.name,
                    meta: { host: group.host, actions: rewritten, automations: touchedAutomations },
                });

                result.created.push({ connection_id: connectionId, name: item.name, host: group.host });
                result.actions_rewritten += rewritten;
                result.automations_updated += touchedAutomations;
            }).catch((err: unknown) => {
                throw this.mapDuplicate(err, item.name);
            });
        }
        return result;
    }

    // ── Internos ─────────────────────────────────────────────────────────

    private async inlineGroups(tenantId: number): Promise<Map<string, InlineGroup>> {
        const rows = await this.automationRows(tenantId);
        const groups = new Map<string, InlineGroup>();
        const byHost = new Map<string, number>();
        for (const row of rows) {
            walkActions(row.actions, (action) => {
                if (action.type !== 'call_webhook') return;
                const cfg = (action.config ?? {}) as Record<string, unknown>;
                // Ya convertida: no vuelve a ofrecerse.
                if (cfg.connection_id) return;
                const host = hostOf(cfg.url);
                if (host === null) return;
                const detected = detectInlineCredential(cfg);
                if (!detected) return;
                const fingerprint = credentialFingerprint(detected);
                let key: string | undefined;
                for (const [k, g] of groups) {
                    if (g.host === host && g.fingerprint === fingerprint) key = k;
                }
                if (key === undefined) {
                    const seen = (byHost.get(host) ?? 0) + 1;
                    byHost.set(host, seen);
                    // Mismo host con credenciales distintas: claves distintas.
                    key = seen === 1 ? host : `${host}#${seen}`;
                    groups.set(key, {
                        key,
                        host,
                        fingerprint,
                        detected,
                        baseUrl: originOf(cfg.url),
                        suggestedName: seen === 1 ? host : `${host} (${seen})`,
                        automations: new Map(),
                    });
                }
                const group = groups.get(key)!;
                const existing = group.automations.get(row.id);
                if (existing) {
                    existing.actions += 1;
                } else {
                    group.automations.set(row.id, {
                        id: row.id,
                        name: row.name,
                        listSlug: row.listSlug,
                        actions: 1,
                        actionsJson: row.actions,
                    });
                }
            });
        }
        return groups;
    }

    private async automationRows(tenantId: number): Promise<AutomationRow[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    id: automations.id,
                    name: automations.name,
                    actions: automations.actions,
                    listId: automations.listId,
                    listSlug: lists.slug,
                    listName: lists.name,
                })
                .from(automations)
                .innerJoin(lists, eq(lists.id, automations.listId))
                .where(eq(automations.tenantId, tenantId)),
        );
        return rows.map((r) => ({
            id: r.id,
            name: r.name,
            actions: r.actions as unknown,
            listId: r.listId,
            listSlug: r.listSlug,
            listName: r.listName,
        }));
    }

    private async row(tenantId: number, id: number): Promise<ConnectionRow | null> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select(COLUMNS)
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), eq(connections.id, id)))
                .limit(1),
        );
        return (row as ConnectionRow | undefined) ?? null;
    }

    private async requireEditable(
        tenantId: number,
        userId: number,
        role: Role,
        id: number,
    ): Promise<ConnectionRow> {
        const row = await this.row(tenantId, id);
        if (!row || !this.canSee(row, userId)) {
            throw new NotFoundException({
                code: 'connection_not_found',
                message: 'Conexión no encontrada',
                data: { status: 404 },
            });
        }
        if (!this.canEdit(row, userId, role)) {
            throw new ForbiddenException({
                code: 'connection_forbidden',
                message: 'Sólo el admin del workspace puede editar las conexiones del equipo',
                data: { status: 403 },
            });
        }
        return row;
    }

    private canSee(row: ConnectionRow, userId: number): boolean {
        return row.visibility !== 'private' || row.ownerUserId === userId;
    }

    /** El admin manda sobre las del equipo; una privada es de su dueño. */
    private canEdit(row: ConnectionRow, userId: number, role: Role): boolean {
        if (row.visibility === 'private') return row.ownerUserId === userId;
        return role === 'admin';
    }

    private async assertMayUseVisibility(
        tenantId: number,
        role: Role,
        visibility: ConnectorVisibility,
    ): Promise<void> {
        if (visibility === 'workspace') {
            if (role !== 'admin') {
                throw new ForbiddenException({
                    code: 'connection_admin_only',
                    message:
                        'Sólo el admin del workspace puede crear conexiones del equipo. Pedile que la cree, o usá una conexión privada si están habilitadas.',
                    data: { status: 403 },
                });
            }
            return;
        }
        const settings = await this.settings(tenantId);
        if (!settings.allow_private && role !== 'admin') {
            throw new ForbiddenException({
                code: 'private_connections_disabled',
                message:
                    'Las conexiones privadas están deshabilitadas en este workspace. El admin puede habilitarlas en Ajustes → Integraciones.',
                data: { status: 403 },
            });
        }
    }

    /** Cifra lo que venga con valor; cadena vacía o ausente CONSERVA. */
    private encryptAll(
        previous: Record<string, string>,
        input: {
            token?: string | null;
            username?: string | null;
            password?: string | null;
            signing_secret?: string | null;
            client_secret?: string | null;
        },
    ): Record<string, string> {
        const out = { ...previous };
        for (const key of ['token', 'username', 'password', 'signing_secret', 'client_secret'] as const) {
            const value = input[key];
            if (value === undefined) continue;
            if (value === null) {
                delete out[key];
                continue;
            }
            if (value === '') continue;
            out[key] = encryptSecret(value, this.env.SECRETS_KEY);
        }
        return out;
    }

    private touchesSecret(patch: UpdateConnectionInput): boolean {
        return (['token', 'username', 'password', 'signing_secret', 'client_secret'] as const).some(
            (k) => typeof patch[k] === 'string' && patch[k] !== '',
        );
    }

    /** `null` = hay secretos guardados pero no se pueden descifrar. */
    private readSecrets(row: ConnectionRow): ConnectionSecrets | null {
        try {
            const out: ConnectionSecrets = {};
            for (const key of [
                'token',
                'username',
                'password',
                'signing_secret',
                'access_token',
                'refresh_token',
                'client_secret',
            ] as const) {
                const raw = row.secrets[key];
                if (typeof raw !== 'string' || raw === '') continue;
                // Sin clave, `decryptSecret` devuelve el texto cifrado TAL CUAL
                // y mandaríamos esa basura como credencial. Eso es el fallo
                // silencioso que v0.1.113 cerró para el SMTP: acá se reporta.
                if (isEncrypted(raw) && !this.env.SECRETS_KEY) return null;
                out[key] = decryptSecret(raw, this.env.SECRETS_KEY);
            }
            return out;
        } catch {
            this.logger.error(`Conexión ${row.id} con secretos ilegibles (cambió SECRETS_KEY)`);
            return null;
        }
    }

    private async ownerNames(ids: (number | null)[]): Promise<Map<number, string>> {
        const wanted = [...new Set(ids.filter((id): id is number => id !== null))];
        if (wanted.length === 0) return new Map();
        const rows = await this.db.select({ id: users.id, name: users.name }).from(users);
        return new Map(rows.filter((r) => wanted.includes(r.id)).map((r) => [r.id, r.name ?? '']));
    }

    private async recordCheck(
        tenantId: number,
        id: number | null,
        ok: boolean,
        error: string | null,
    ): Promise<void> {
        if (id === null) return;
        await this.tenantDb
            .withTenant(tenantId, (tx) =>
                tx
                    .update(connections)
                    .set({ lastCheckAt: new Date(), lastCheckOk: ok, lastCheckError: error })
                    .where(and(eq(connections.tenantId, tenantId), eq(connections.id, id))),
            )
            .catch(() => undefined);
    }

    private mapDuplicate(err: unknown, name: string): unknown {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('connections_tenant_name_ux')) {
            return new BadRequestException({
                code: 'connection_name_taken',
                message: `Ya existe una conexión llamada «${name}».`,
                data: { status: 400 },
            });
        }
        return err;
    }

    /**
     * Estado de la autorización para la UI. `null` si la conexión no usa
     * OAuth2 — así el panel no tiene que adivinar si la tarjeta aplica.
     */
    private oauthStatus(row: ConnectionRow, secrets: ConnectionSecrets | null): OAuthStatus | null {
        if (row.authType !== 'oauth2') return null;
        const state = readOAuthState(row.config.oauth_state);
        const connected = typeof row.secrets.access_token === 'string';
        return {
            connected,
            expires_at: state.expiresAt !== null ? new Date(state.expiresAt).toISOString() : null,
            // Sin refresh token la conexión deja de funcionar cuando vence, y
            // eso hay que DECIRLO al autorizar, no descubrirlo a la hora.
            has_refresh: typeof row.secrets.refresh_token === 'string',
            granted_scopes: state.scope,
            last_error:
                secrets === null ? new ConnectionUnusableError(row.name).message : state.error,
        };
    }

    private toDto(
        row: ConnectionRow,
        extra: { usage: number; ownerName: string | null; canEdit: boolean },
    ): Connection {
        const secrets = this.readSecrets(row);
        const hasAny = Object.keys(row.secrets).length > 0;
        const state = !hasAny ? 'none' : secrets === null ? 'unreadable' : 'ok';
        // En OAuth2 el secreto que la persona pegó es el de la APP registrada;
        // el token del proveedor no es suyo y no se le muestra ni enmascarado.
        const primary =
            row.authType === 'oauth2'
                ? (secrets?.client_secret ?? '')
                : (secrets?.token ?? secrets?.password ?? '');
        const def = integrationDef(row.provider);
        const account = row.config.account_label;
        return {
            id: row.id,
            provider: row.provider,
            integration_key: def ? def.key : null,
            account_label: typeof account === 'string' && account !== '' ? account : null,
            name: row.name,
            base_url: row.baseUrl,
            auth_type: row.authType as ConnectorAuthType,
            auth_key: String(row.config.auth_key ?? ''),
            headers: readConfigPairs(row.config.headers) as ConnectorPair[],
            query_params: readConfigPairs(row.config.query_params) as ConnectorPair[],
            // Las apps de la galería traen sus acciones del catálogo.
            actions: def ? [...def.actions] : readConnectorActions(row.config.actions),
            oauth: readOAuthConfig(row.config.oauth),
            oauth_status: this.oauthStatus(row, secrets),
            oauth_redirect_uri: this.oauthRedirectUri(),
            visibility: row.visibility as ConnectorVisibility,
            owner_user_id: row.ownerUserId,
            owner_name: extra.ownerName,
            secret_hint: state === 'ok' ? secretHint(primary) : null,
            secret_state: state,
            has_signing_secret: typeof row.secrets.signing_secret === 'string',
            last_check_at: row.lastCheckAt ? row.lastCheckAt.toISOString() : null,
            last_check_ok: row.lastCheckOk,
            last_check_error: row.lastCheckError,
            usage_count: extra.usage,
            can_edit: extra.canEdit,
            created_at: row.createdAt.toISOString(),
            updated_at: row.updatedAt.toISOString(),
        };
    }
}

/** El único campo secreto de una app por clave (va a `secrets.token`). */
function secretField(def: IntegrationDef): { key: string; label: string } | null {
    if (def.auth.kind !== 'key') return null;
    return def.auth.fields.find((f) => f.secret) ?? null;
}

/** Acciones que referencian una conexión por id. */
function usesConnection(type: unknown): boolean {
    return type === 'call_webhook' || type === 'connector_action';
}

interface AutomationRow {
    id: number;
    name: string;
    actions: unknown;
    listId: number;
    listSlug: string;
    listName: string;
}

interface InlineGroup {
    key: string;
    host: string;
    fingerprint: string;
    detected: DetectedCredential;
    baseUrl: string;
    suggestedName: string;
    automations: Map<number, { id: number; name: string; listSlug: string; actions: number; actionsJson: unknown }>;
}
