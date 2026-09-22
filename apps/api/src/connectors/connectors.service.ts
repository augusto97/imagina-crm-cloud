import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
    connectorSettingsSchema,
    type Connection,
    type ConnectionDraftTestInput,
    type ConnectionTestResult,
    type ConnectionUsage,
    type ConnectorAuthType,
    type ConnectorPair,
    type ConnectorSettings,
    type ConnectorVisibility,
    type ConvertInlineSecretsInput,
    type ConvertInlineSecretsResult,
    type CreateConnectionInput,
    type InlineSecretCandidate,
    type Role,
    type UpdateConnectionInput,
} from '@imagina-base/shared';
import { and, asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { safeWebhookFetch } from '../common/safe-fetch';
import { decryptSecret, encryptSecret, isEncrypted } from '../common/secret-box';
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
                'Volvé a escribirla en Ajustes → Conectores.',
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

@Injectable()
export class ConnectorsService {
    private readonly logger = new Logger(ConnectorsService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
        private readonly audit: AuditService,
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
        const row = await this.row(tenantId, connectionId);
        return this.partsFrom(row);
    }

    /**
     * Igual, pero DENTRO de la transacción del que llama. El motor de
     * automatizaciones ya corre en un `withTenant`: abrir otro acá tomaría una
     * segunda conexión del pool por cada acción, y con el pool chico eso es un
     * bloqueo esperando a sí mismo.
     */
    async resolvePartsInTx(tx: Tx, tenantId: number, connectionId: number): Promise<ConnectionParts | null> {
        const [row] = await tx
            .select(COLUMNS)
            .from(connections)
            .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
            .limit(1);
        return this.partsFrom((row as ConnectionRow | undefined) ?? null);
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
                if (action.type !== 'call_webhook') return;
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
                if (action.type !== 'call_webhook') return;
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
            const row = await this.requireEditable(tenantId, userId, role, input.connection_id);
            savedId = row.id;
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
                    'Las conexiones privadas están deshabilitadas en este workspace. El admin puede habilitarlas en Ajustes → Conectores.',
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
        },
    ): Record<string, string> {
        const out = { ...previous };
        for (const key of ['token', 'username', 'password', 'signing_secret'] as const) {
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
        return (['token', 'username', 'password', 'signing_secret'] as const).some(
            (k) => typeof patch[k] === 'string' && patch[k] !== '',
        );
    }

    /** `null` = hay secretos guardados pero no se pueden descifrar. */
    private readSecrets(row: ConnectionRow): ConnectionSecrets | null {
        try {
            const out: ConnectionSecrets = {};
            for (const key of ['token', 'username', 'password', 'signing_secret'] as const) {
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

    private toDto(
        row: ConnectionRow,
        extra: { usage: number; ownerName: string | null; canEdit: boolean },
    ): Connection {
        const secrets = this.readSecrets(row);
        const hasAny = Object.keys(row.secrets).length > 0;
        const state = !hasAny ? 'none' : secrets === null ? 'unreadable' : 'ok';
        const primary = secrets?.token ?? secrets?.password ?? '';
        return {
            id: row.id,
            provider: 'http',
            name: row.name,
            base_url: row.baseUrl,
            auth_type: row.authType as ConnectorAuthType,
            auth_key: String(row.config.auth_key ?? ''),
            headers: readConfigPairs(row.config.headers) as ConnectorPair[],
            query_params: readConfigPairs(row.config.query_params) as ConnectorPair[],
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
