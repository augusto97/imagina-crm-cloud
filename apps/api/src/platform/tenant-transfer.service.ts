import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
    createReadStream,
    createWriteStream,
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
    TENANT_TRANSFER_FORMAT,
    tenantTransferManifestSchema,
    type ExportTenantInput,
    type ExportTenantResult,
    type ImportTenantInput,
    type ImportTenantResult,
    type TenantTransferFile,
    type TenantTransferManifest,
    type TenantTransferStatus,
} from '@imagina-base/shared';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import * as argon2 from 'argon2';
import { isEncrypted } from '../common/secret-box';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import {
    activity,
    aiUsage,
    attachments,
    auditLog,
    automationHooks,
    automationRuns,
    automations,
    comments,
    connections,
    connectionSyncs,
    sqlSyncs,
    dashboards,
    emailUsage,
    fields,
    listGroups,
    listSlugHistory,
    lists,
    memberships,
    mentions,
    portalLinks,
    publicLists,
    records,
    recurrences,
    relations,
    savedFilters,
    savedViews,
    documentNumbers,
    documentTemplates,
    forms,
    templates,
    tenants,
    users,
    syncLinks,
} from '../db/schema';
import { FILE_STORAGE, TENANT_STORAGE, type FileStorage, type TenantStorageResolver } from '../files/file-storage';
import {
    emptyMaps,
    mapId,
    remapAutomation,
    remapJson,
    remapListSettings,
    remapRecordData,
    remapRichDoc,
    type IdMaps,
    remapSyncSettings,
} from './tenant-transfer.remap';

/**
 * Migración de UNA empresa entre instancias (v0.1.197, ADR-S23).
 *
 * El snapshot de ADR-S20 mueve el SERVIDOR entero; esto mueve un CLIENTE: se
 * empaqueta su empresa en un archivo portable y se importa en otra
 * instalación, donde todos los ids se regeneran.
 *
 * Corre sobre la conexión BASE (superusuario, sin RLS) porque es una operación
 * de PLATAFORMA: el operador mueve un cliente entero, no un usuario moviendo
 * sus datos. Todo el filtrado es por `tenant_id` explícito.
 *
 * El archivo es un tar con `manifest.json`, una NDJSON por tabla y los bytes
 * de los adjuntos. NDJSON y no un JSON gigante a propósito: una empresa con
 * 200k registros no entra en memoria como una sola cadena.
 */

const BATCH = 500;
const PAGE = 1000;

/** Lo que NO viaja, y por qué. Se copia tal cual al manifest. */
const EXCLUDED = [
    'Tokens de acceso personal y conexiones MCP/OAuth: se guardan sólo hasheados, hay que volver a emitirlos.',
    'El enlace público de cada lista y la URL del webhook entrante: son credenciales de la instancia de origen; el import emite unos nuevos.',
    'El dominio propio: es único global y apunta al servidor anterior.',
    'Sesiones abiertas: cada persona vuelve a iniciar sesión en la instancia nueva.',
];

/** Fila cruda leída de una NDJSON (o de un `select()` sin tipar). */
type Row = Record<string, unknown>;
/** Tabla con `tenant_id` (todas las de datos: regla de oro nº 3). */
type TenantTable = PgTable & { tenantId: PgColumn };
/** Tabla con `tenant_id` y clave primaria `id` numérica. */
type KeyedTable = TenantTable & { id: PgColumn };

@Injectable()
export class TenantTransferService {
    private readonly logger = new Logger(TenantTransferService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
        @Inject(FILE_STORAGE) private readonly storage: FileStorage,
        // v0.1.268 (ADR-S36) — para leer los adjuntos que quedaron en el
        // almacenamiento propio de la empresa (al importar van al servidor).
        @Optional() @Inject(TENANT_STORAGE) private readonly tenantStorage?: TenantStorageResolver,
    ) {}

    // ── Archivos ─────────────────────────────────────────────────────────

    get dir(): string {
        if (this.env.TRANSFERS_DIR) return path.resolve(this.env.TRANSFERS_DIR);
        if (this.env.BACKUPS_DIR) return path.join(path.resolve(this.env.BACKUPS_DIR), 'transfers');
        return this.env.UPDATER_BASE_PATH
            ? path.join(this.env.UPDATER_BASE_PATH, 'shared', 'transfers')
            : '';
    }

    async status(): Promise<TenantTransferStatus> {
        const dir = this.dir;
        if (!dir) {
            return {
                available: false,
                reason: 'Falta UPDATER_BASE_PATH (o TRANSFERS_DIR): no hay dónde guardar los archivos.',
                files: [],
            };
        }
        mkdirSync(dir, { recursive: true });
        const names = readdirSync(dir).filter((n) => n.endsWith('.tar'));
        const files: TenantTransferFile[] = [];
        for (const name of names) {
            const full = path.join(dir, name);
            const st = statSync(full);
            files.push({
                name,
                size: st.size,
                created_at: st.mtime.toISOString(),
                manifest: await this.readManifest(full),
            });
        }
        files.sort((a, b) => b.created_at.localeCompare(a.created_at));
        return { available: true, reason: null, files };
    }

    /** Resuelve un nombre a ruta REAL dentro del directorio, sin traversal. */
    resolve(name: string): string {
        if (!/^[A-Za-z0-9._-]+\.tar$/.test(name)) {
            throw new BadRequestException({
                code: 'bad_name',
                message: 'Nombre inválido',
                data: { status: 400 },
            });
        }
        const dir = this.dir;
        const full = path.join(dir, name);
        if (!dir || path.dirname(full) !== dir || !existsSync(full)) {
            throw new NotFoundException({
                code: 'not_found',
                message: 'Archivo no encontrado',
                data: { status: 404 },
            });
        }
        return full;
    }

    remove(name: string): void {
        rmSync(this.resolve(name), { force: true });
    }

    /** Guarda un archivo subido por el operador (multipart) en el directorio. */
    async receive(filename: string, source: Readable): Promise<string> {
        const dir = this.requireDir();
        const safe = path.basename(filename).replace(/[^A-Za-z0-9._-]/g, '_');
        const name = safe.endsWith('.tar') ? safe : `${safe}.tar`;
        await pipeline(source, createWriteStream(path.join(dir, name)));
        return name;
    }

    private requireDir(): string {
        const dir = this.dir;
        if (!dir) {
            throw new BadRequestException({
                code: 'unavailable',
                message: 'Sin directorio de transferencias',
                data: { status: 400 },
            });
        }
        mkdirSync(dir, { recursive: true });
        return dir;
    }

    private async readManifest(file: string): Promise<TenantTransferManifest | null> {
        try {
            const raw = await this.tarRead(file, 'manifest.json');
            const parsed = tenantTransferManifestSchema.safeParse(JSON.parse(raw));
            return parsed.success ? parsed.data : null;
        } catch {
            return null;
        }
    }

    // ── Exportar ─────────────────────────────────────────────────────────

    async exportTenant(tenantId: number, input: ExportTenantInput): Promise<ExportTenantResult> {
        const dir = this.requireDir();
        const [tenant] = await this.db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        if (!tenant) {
            throw new NotFoundException({
                code: 'tenant_not_found',
                message: 'Empresa no encontrada',
                data: { status: 404 },
            });
        }

        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const work = path.join(dir, `.work-${stamp}-${randomBytes(4).toString('hex')}`);
        mkdirSync(path.join(work, 'rows'), { recursive: true });

        const counts: Record<string, number> = {};
        const dump = async (name: string, rows: unknown[]): Promise<void> => {
            counts[name] = rows.length;
            await this.writeNdjson(path.join(work, 'rows', `${name}.ndjson`), rows);
        };

        try {
            // Los usuarios que viajan son los MIEMBROS de esta empresa: una
            // cuenta que además pertenece a otra empresa viaja igual (es la
            // misma persona), pero sólo con la membresía de ésta.
            const members = await this.db
                .select()
                .from(memberships)
                .where(eq(memberships.tenantId, tenantId));
            const userIds = [...new Set(members.map((m) => m.userId))];
            const userRows = userIds.length
                ? await this.db.select().from(users).where(inArray(users.id, userIds))
                : [];

            const attachRows = await this.byTenant(attachments, tenantId);

            await dump('tenant', [tenant]);
            await dump('users', userRows);
            await dump('memberships', members);
            await dump('list_groups', await this.byTenant(listGroups, tenantId));
            await dump('lists', await this.byTenant(lists, tenantId));
            await dump('list_slug_history', await this.byTenant(listSlugHistory, tenantId));
            await dump('fields', await this.byTenant(fields, tenantId));
            await dump('templates', await this.byTenant(templates, tenantId));
            await dump('connections', await this.byTenant(connections, tenantId));
            await dump('attachments', attachRows);
            await dump('saved_views', await this.byTenant(savedViews, tenantId));
            // v0.1.266 — plantillas de documentos PDF.
            await dump('document_templates', await this.byTenant(documentTemplates, tenantId));
            // v0.1.267 — números ya emitidos (el consecutivo sigue donde iba).
            await dump('document_numbers', await this.byTenant(documentNumbers, tenantId));
            // v0.1.275 — formularios públicos (el diseño apunta a campos por id).
            await dump('forms', await this.byTenant(forms, tenantId));
            await dump('saved_filters', await this.byTenant(savedFilters, tenantId));
            await dump('automations', await this.byTenant(automations, tenantId));
            await dump('dashboards', await this.byTenant(dashboards, tenantId));
            await dump('recurrences', await this.byTenant(recurrences, tenantId));
            await dump('portal_links', await this.byTenant(portalLinks, tenantId));
            await dump('public_lists', await this.byTenant(publicLists, tenantId));
            await dump('relations', await this.byTenant(relations, tenantId));
            await dump('mentions', await this.byTenant(mentions, tenantId));
            await dump('email_usage', await this.byTenant(emailUsage, tenantId));
            await dump('ai_usage', await this.byTenant(aiUsage, tenantId));
            // v0.1.206 — sincronizaciones con tiendas y sus vínculos: sin
            // ellos, reactivarla en el destino DUPLICARÍA todo lo traído.
            await dump('connection_syncs', await this.byTenant(connectionSyncs, tenantId));
            await dump('sync_links', await this.byTenant(syncLinks, tenantId));
            // v0.1.243 — sincronizaciones desde SQL Server.
            await dump('sql_syncs', await this.byTenant(sqlSyncs, tenantId));

            // Tablas grandes: por páginas keyset, escribiendo a medida (las de
            // una empresa con cientos de miles de filas no entran en memoria).
            counts.records = await this.dumpPaged(work, 'records', records, tenantId);
            counts.comments = await this.dumpPaged(work, 'comments', comments, tenantId);
            counts.activity = await this.dumpPaged(work, 'activity', activity, tenantId);
            counts.audit_log = await this.dumpPaged(work, 'audit_log', auditLog, tenantId);
            counts.automation_runs = input.include_runs
                ? await this.dumpPaged(work, 'automation_runs', automationRuns, tenantId)
                : 0;
            if (!input.include_runs) {
                await this.writeNdjson(path.join(work, 'rows', 'automation_runs.ndjson'), []);
            }

            // Bytes de los adjuntos.
            const files = { count: 0, bytes: 0 };
            if (input.include_files) {
                mkdirSync(path.join(work, 'files'), { recursive: true });
                for (const row of attachRows) {
                    const key = String(row.storageKey ?? '');
                    const dest = path.join(work, 'files', this.fileEntry(key));
                    try {
                        const conn = row.storageConnectionId == null ? null : Number(row.storageConnectionId);
                        const source =
                            conn !== null && this.tenantStorage
                                ? await this.tenantStorage.forConnection(tenantId, conn)
                                : this.storage;
                        await pipeline(source.read(key), createWriteStream(dest));
                        files.count += 1;
                        files.bytes += Number(row.sizeBytes) || 0;
                    } catch {
                        // Bytes perdidos (uploads huérfanos de releases viejos,
                        // v0.1.88): el export sigue y el import lo reporta.
                        this.logger.warn(`Adjunto sin bytes al exportar: ${key}`);
                    }
                }
            }

            const manifest: TenantTransferManifest = {
                format: TENANT_TRANSFER_FORMAT,
                app_version: this.appVersion(),
                exported_at: new Date().toISOString(),
                secrets_fingerprint: this.secretsFingerprint(),
                tenant: {
                    slug: tenant.slug,
                    name: tenant.name,
                    plan: tenant.plan,
                    status: tenant.status,
                },
                counts,
                files,
                excluded: EXCLUDED,
            };
            await this.writeText(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2));

            const name = `imagina-tenant-${tenant.slug}-${stamp}.tar`;
            // Se arma con otro nombre y se renombra al final (atómico en el
            // mismo filesystem): si la request se corta a mitad del empaquetado
            // nunca queda un `.tar` a medias en el listado.
            const partial = path.join(work, 'archive.tar');
            await this.tar(['-cf', partial, '-C', work, '--exclude=./archive.tar', '.']);
            renameSync(partial, path.join(dir, name));
            const size = statSync(path.join(dir, name)).size;
            return { file: name, size, manifest };
        } finally {
            rmSync(work, { recursive: true, force: true });
        }
    }

    // ── Importar ─────────────────────────────────────────────────────────

    async importTenant(input: ImportTenantInput): Promise<ImportTenantResult> {
        const file = this.resolve(input.file);
        const work = path.join(this.dir, `.import-${randomBytes(6).toString('hex')}`);
        mkdirSync(work, { recursive: true });

        try {
            // `--no-same-owner`: el tar viene de otro servidor, los uid/gid de
            // adentro no significan nada acá.
            await this.tar(['-xf', file, '--no-same-owner', '-C', work]);
            // SEC-30 (v0.1.228): un archivo armado a mano puede traer un
            // symlink (`files/x → /opt/imagina-base/shared/.env`); al leer los
            // bytes del adjunto se seguiría el enlace y un archivo del SERVIDOR
            // terminaría como adjunto descargable de la empresa. Una
            // exportación nuestra sólo tiene carpetas y archivos comunes.
            assertOnlyRegularFiles(work);
            const manifest = await this.parseManifest(work);
            const writtenKeys: string[] = [];

            try {
                // TODA la importación en una transacción: si algo falla a
                // mitad, no queda una empresa a medio armar que el operador
                // tenga que limpiar a mano.
                return await this.db.transaction((tx) =>
                    this.runImport(tx, work, manifest, input, writtenKeys),
                );
            } catch (err) {
                // Los bytes de los adjuntos viven fuera de la transacción: si
                // ésta revierte hay que borrarlos o quedan huérfanos ocupando
                // disco para siempre.
                for (const key of writtenKeys) {
                    await this.storage.delete(key).catch(() => undefined);
                }
                throw err;
            }
        } finally {
            rmSync(work, { recursive: true, force: true });
        }
    }

    private async parseManifest(work: string): Promise<TenantTransferManifest> {
        const raw = await readFile(path.join(work, 'manifest.json'), 'utf8').catch(() => null);
        const parsed = raw ? tenantTransferManifestSchema.safeParse(JSON.parse(raw)) : null;
        if (!parsed?.success) {
            throw new BadRequestException({
                code: 'bad_archive',
                message: 'El archivo no es una exportación de empresa válida.',
                data: { status: 400 },
            });
        }
        if (parsed.data.format > TENANT_TRANSFER_FORMAT) {
            throw new BadRequestException({
                code: 'format_too_new',
                message: `El archivo usa el formato ${parsed.data.format} y esta instalación entiende hasta el ${TENANT_TRANSFER_FORMAT}. Actualizá antes de importar.`,
                data: { status: 400 },
            });
        }
        return parsed.data;
    }

    private async runImport(
        tx: Tx,
        work: string,
        manifest: TenantTransferManifest,
        input: ImportTenantInput,
        writtenKeys: string[],
    ): Promise<ImportTenantResult> {
        const warnings: string[] = [];
        const rows = (name: string): string => path.join(work, 'rows', `${name}.ndjson`);
        const maps = emptyMaps();
        const counts: Record<string, number> = {};

        // Los secretos viajan cifrados con la clave del ORIGEN: sin la misma
        // clave no se pueden descifrar, así que se descartan en vez de guardar
        // basura que fallaría recién al mandar un correo.
        const sameKey =
            manifest.secrets_fingerprint !== null &&
            manifest.secrets_fingerprint === this.secretsFingerprint();
        if (!sameKey) {
            warnings.push(
                'La clave de cifrado de este servidor es otra: no viajaron la contraseña SMTP, la clave de IA, las credenciales de los conectores ni los segundos factores. Hay que volver a cargarlos.',
            );
        }

        // 1. Empresa
        const [tenantRow] = await this.readAll(rows('tenant'));
        if (!tenantRow) {
            throw new BadRequestException({
                code: 'bad_archive',
                message: 'El archivo no trae la empresa.',
                data: { status: 400 },
            });
        }
        const srcSettings = (tenantRow.settings ?? {}) as Row;
        if (srcSettings.storage && typeof srcSettings.storage === 'object') {
            warnings.push(
                'La empresa guardaba sus archivos en un almacenamiento propio: llegaron al servidor (cuentan para el plan). Elegí de nuevo el almacenamiento en Ajustes → Almacenamiento y mové los archivos.',
            );
        }
        const slug = await this.freeSlug(tx, input.slug ?? String(tenantRow.slug));
        const name = input.name ?? String(tenantRow.name);
        const [createdTenant] = await tx
            .insert(tenants)
            .values({
                slug,
                name,
                plan: String(tenantRow.plan ?? 'trial'),
                status: String(tenantRow.status ?? 'trialing'),
                settings: this.cleanTenantSettings(tenantRow.settings as Row | null, sameKey),
                // El dominio propio es único GLOBAL y sigue apuntando al
                // servidor viejo: se reconfigura después de migrar.
                customDomain: null,
                subscriptionEndsAt: this.date(tenantRow.subscriptionEndsAt),
                // v0.1.250 — el período pagado viaja (el historial de pagos no:
                // sus ids son de la cuenta de cobro del servidor de origen).
                paidUntil: this.date(tenantRow.paidUntil),
            })
            .returning({ id: tenants.id });
        const tenantId = createdTenant!.id;
        counts.tenant = 1;

        // 2. Usuarios: se reusa la cuenta si el email ya existe acá (la misma
        //    persona puede estar ya en el servidor destino por otra empresa).
        const userRows = await this.readAll(rows('users'));
        // SEC-30 (v0.1.228): la contraseña (hash), el email verificado y el
        // segundo factor de una cuenta NUEVA salen del archivo. Si el archivo
        // no lo armó un servidor de confianza, quien lo armó elige la
        // contraseña de cualquier email que todavía no exista acá — y cuando
        // otra empresa invite a esa persona, la invitación cae en una cuenta
        // que controla él. Por defecto las cuentas nuevas nacen SIN contraseña
        // utilizable ni verificación: la persona entra con "olvidé mi
        // contraseña", que prueba que el correo es suyo.
        const trustCredentials = input.trust_credentials === true;
        const unusableHash = trustCredentials ? null : await argon2.hash(randomBytes(32).toString('hex'));
        let usersCreated = 0;
        let usersLinked = 0;
        for (const u of userRows) {
            const email = String(u.email ?? '').toLowerCase();
            const [existing] = await tx
                .select({ id: users.id })
                .from(users)
                .where(sql`lower(${users.email}) = ${email}`)
                .limit(1);
            if (existing) {
                maps.user.set(Number(u.id), existing.id);
                usersLinked += 1;
                continue;
            }
            const [ins] = await tx
                .insert(users)
                .values({
                    email: String(u.email),
                    // El hash de argon2 se describe a sí mismo: es portable,
                    // así que la persona conserva su contraseña.
                    passwordHash: unusableHash ?? String(u.passwordHash),
                    name: String(u.name ?? ''),
                    locale: String(u.locale ?? 'es'),
                    emailVerifiedAt: trustCredentials ? this.date(u.emailVerifiedAt) : null,
                    emailSignature: (u.emailSignature as string | null) ?? null,
                    totpSecret: trustCredentials && sameKey ? ((u.totpSecret as string | null) ?? null) : null,
                    totpEnabledAt: trustCredentials && sameKey ? this.date(u.totpEnabledAt) : null,
                    totpBackupCodes: trustCredentials && sameKey ? ((u.totpBackupCodes as string[] | null) ?? null) : null,
                })
                .returning({ id: users.id });
            maps.user.set(Number(u.id), ins!.id);
            usersCreated += 1;
        }
        counts.users = userRows.length;
        // Autor de respaldo para las filas cuyo `created_by` es NOT NULL y
        // apunta a alguien que ya no viajó.
        const fallbackUser = maps.user.values().next().value ?? null;

        // 3. Membresías
        const memberRows = await this.readAll(rows('memberships'));
        const memberValues = memberRows
            .map((m) => ({
                userId: maps.user.get(Number(m.userId)),
                tenantId,
                role: String(m.role),
                settings: (m.settings as Row | null) ?? {},
            }))
            .filter((m) => m.userId !== undefined);
        if (memberValues.length) await this.insertValues(tx, memberships, memberValues);
        counts.memberships = memberValues.length;

        // 4. Carpetas → listas → campos
        const groupMap = new Map<number, number>();
        counts.list_groups = await this.insertMapped(
            tx,
            await this.readAll(rows('list_groups')),
            listGroups,
            groupMap,
            (g) => ({
                tenantId,
                name: String(g.name),
                icon: (g.icon as string | null) ?? null,
                color: (g.color as string | null) ?? null,
                position: Number(g.position ?? 0),
            }),
        );

        const listRows = await this.readAll(rows('lists'));
        counts.lists = await this.insertMapped(tx, listRows, lists, maps.list, (l) => ({
            tenantId,
            slug: String(l.slug),
            name: String(l.name),
            icon: (l.icon as string | null) ?? null,
            color: (l.color as string | null) ?? null,
            // `settings` se reescribe al final: sus ids todavía no existen.
            settings: {},
            position: Number(l.position ?? 0),
            groupId: groupMap.get(Number(l.groupId)) ?? null,
        }));

        counts.list_slug_history = await this.insertPlain(
            tx,
            rows('list_slug_history'),
            listSlugHistory,
            (h) => {
                const listId = mapId(maps.list, h.listId);
                return listId === null ? null : { tenantId, listId, slug: String(h.slug) };
            },
        );

        const fieldRows = await this.readAll(rows('fields'));
        const fieldTypeByOldId = new Map<number, string>();
        for (const f of fieldRows) fieldTypeByOldId.set(Number(f.id), String(f.type));
        counts.fields = await this.insertMapped(
            tx,
            fieldRows,
            fields,
            maps.field,
            (f) => ({
                tenantId,
                listId: maps.list.get(Number(f.listId))!,
                slug: String(f.slug),
                label: String(f.label),
                type: String(f.type),
                // La config de los derivados (computed/lookup/rollup) apunta a
                // OTROS campos: se reescribe en una segunda pasada, cuando ya
                // existen todos.
                config: {},
                isRequired: Boolean(f.isRequired),
                isUnique: Boolean(f.isUnique),
                isIndexed: Boolean(f.isIndexed),
                description: (f.description as string | null) ?? null,
                position: Number(f.position ?? 0),
            }),
            (f) => maps.list.has(Number(f.listId)),
        );
        for (const f of fieldRows) {
            const newId = maps.field.get(Number(f.id));
            if (newId === undefined) continue;
            const config = remapJson((f.config as Row | null) ?? {}, maps) as Row;
            await tx.update(fields).set({ config }).where(eq(fields.id, newId));
        }

        counts.templates = await this.insertMapped(
            tx,
            await this.readAll(rows('templates')),
            templates,
            maps.template,
            (t) => ({
                tenantId,
                kind: String(t.kind ?? 'list'),
                name: String(t.name),
                description: (t.description as string | null) ?? null,
                icon: (t.icon as string | null) ?? null,
                color: (t.color as string | null) ?? null,
                category: String(t.category ?? 'otros'),
                // El blueprint viaja tokenizado por slug: no lleva ids.
                blueprint: (t.blueprint as Row | null) ?? {},
                createdBy: mapId(maps.user, t.createdBy),
            }),
        );

        counts.connections = await this.insertMapped(
            tx,
            await this.readAll(rows('connections')),
            connections,
            maps.connection,
            (c) => ({
                tenantId,
                provider: String(c.provider ?? 'http'),
                name: String(c.name),
                baseUrl: String(c.baseUrl ?? ''),
                authType: String(c.authType ?? 'none'),
                config: (c.config as Row | null) ?? {},
                secrets: sameKey ? ((c.secrets as Record<string, string> | null) ?? {}) : {},
                visibility: String(c.visibility ?? 'workspace'),
                ownerUserId: mapId(maps.user, c.ownerUserId),
                createdBy: mapId(maps.user, c.createdBy),
            }),
        );

        // 5. Adjuntos ANTES que los registros: `data` los referencia por id.
        const attachRows = await this.readAll(rows('attachments'));
        let missingFiles = 0;
        for (const a of attachRows) {
            const owner = mapId(maps.user, a.createdBy) ?? fallbackUser;
            // `attachments.created_by` tiene FK a users: sin un autor válido
            // la fila no puede existir.
            if (owner === null) continue;
            const oldKey = String(a.storageKey ?? '');
            const ext = path.extname(oldKey);
            const newKey = `t${tenantId}/${randomBytes(16).toString('hex')}${ext}`;
            const src = path.join(work, 'files', this.fileEntry(oldKey));
            if (existsSync(src)) {
                await this.storage.write(newKey, createReadStream(src));
                writtenKeys.push(newKey);
            } else {
                missingFiles += 1;
            }
            const [ins] = await tx
                .insert(attachments)
                .values({
                    tenantId,
                    filename: String(a.filename ?? 'archivo'),
                    mime: String(a.mime ?? 'application/octet-stream'),
                    sizeBytes: Number(a.sizeBytes ?? 0),
                    storageKey: newKey,
                    createdBy: owner,
                })
                .returning({ id: attachments.id });
            maps.attachment.set(Number(a.id), ins!.id);
        }
        counts.attachments = maps.attachment.size;
        if (missingFiles > 0) {
            warnings.push(
                `${missingFiles} adjunto(s) llegaron sin sus bytes: la ficha los muestra pero la descarga da 404.`,
            );
        }

        // 6. Registros. Dos pasadas: el padre (subtareas) y la descripción
        //    referencian a otros registros que en la primera todavía no
        //    existen.
        counts.records = await this.streamInsert(rows('records'), async (batch) => {
            const usable = batch.filter((r) => maps.list.has(Number(r.listId)));
            if (!usable.length) return 0;
            const ids = await this.insertReturningIds(
                tx,
                records,
                usable.map((r) => ({
                    tenantId,
                    listId: maps.list.get(Number(r.listId))!,
                    data: remapRecordData((r.data as Row | null) ?? {}, fieldTypeByOldId, maps),
                    parentId: null,
                    description: null,
                    createdBy: mapId(maps.user, r.createdBy) ?? fallbackUser ?? 0,
                    createdAt: this.date(r.createdAt) ?? new Date(),
                    updatedAt: this.date(r.updatedAt) ?? new Date(),
                    deletedAt: this.date(r.deletedAt),
                })),
            );
            usable.forEach((r, i) => maps.record.set(Number(r.id), ids[i]!));
            return usable.length;
        });
        await this.streamInsert(rows('records'), async (batch) => {
            for (const r of batch) {
                const newId = maps.record.get(Number(r.id));
                if (newId === undefined) continue;
                const parentId = mapId(maps.record, r.parentId);
                const description = r.description ? remapRichDoc(r.description, maps) : null;
                if (parentId === null && description === null) continue;
                await tx
                    .update(records)
                    .set({ parentId, description: description as never })
                    .where(eq(records.id, newId));
            }
            return 0;
        });

        counts.relations = await this.insertPlain(tx, rows('relations'), relations, (r) => {
            const fieldId = mapId(maps.field, r.fieldId);
            const sourceRecordId = mapId(maps.record, r.sourceRecordId);
            const targetRecordId = mapId(maps.record, r.targetRecordId);
            if (fieldId === null || sourceRecordId === null || targetRecordId === null) return null;
            return {
                tenantId,
                fieldId,
                sourceRecordId,
                targetRecordId,
                position: Number(r.position ?? 0),
            };
        });

        counts.saved_views = await this.insertMapped(
            tx,
            await this.readAll(rows('saved_views')),
            savedViews,
            maps.view,
            (v) => ({
                tenantId,
                listId: maps.list.get(Number(v.listId))!,
                name: String(v.name),
                type: String(v.type),
                config: remapJson((v.config as Row | null) ?? {}, maps) as Row,
                isDefault: Boolean(v.isDefault),
                position: Number(v.position ?? 0),
                icon: typeof v.icon === 'string' ? v.icon : null,
                color: typeof v.color === 'string' ? v.color : null,
                createdBy: mapId(maps.user, v.createdBy),
                // Una privada cuyo autor no viajó quedaría invisible para todos.
                isPrivate: Boolean(v.isPrivate) && mapId(maps.user, v.createdBy) !== null,
                isLocked: Boolean(v.isLocked),
                autosave: Boolean(v.autosave),
            }),
            (v) => maps.list.has(Number(v.listId)),
        );

        counts.saved_filters = await this.insertPlain(tx, rows('saved_filters'), savedFilters, (f) => {
            const listId = mapId(maps.list, f.listId);
            if (listId === null) return null;
            return {
                tenantId,
                listId,
                userId: mapId(maps.user, f.userId),
                name: String(f.name),
                filterTree: remapJson((f.filterTree as Row | null) ?? {}, maps) as Row,
            };
        });

        // 7. Comentarios (el padre del hilo, en segunda pasada), menciones y
        //    actividad.
        const commentMap = new Map<number, number>();
        counts.comments = await this.streamInsert(rows('comments'), async (batch) => {
            const usable = batch.filter(
                (c) => maps.list.has(Number(c.listId)) && maps.record.has(Number(c.recordId)),
            );
            if (!usable.length) return 0;
            const ids = await this.insertReturningIds(
                tx,
                comments,
                usable.map((c) => ({
                    tenantId,
                    listId: maps.list.get(Number(c.listId))!,
                    recordId: maps.record.get(Number(c.recordId))!,
                    userId: mapId(maps.user, c.userId) ?? fallbackUser ?? 0,
                    body: String(c.body ?? ''),
                    kind: String(c.kind ?? 'note'),
                    parentId: null,
                    metadata: (c.metadata as Row | null) ?? {},
                    createdAt: this.date(c.createdAt) ?? new Date(),
                    updatedAt: this.date(c.updatedAt) ?? new Date(),
                    deletedAt: this.date(c.deletedAt),
                })),
            );
            usable.forEach((c, i) => commentMap.set(Number(c.id), ids[i]!));
            return usable.length;
        });
        await this.streamInsert(rows('comments'), async (batch) => {
            for (const c of batch) {
                const newId = commentMap.get(Number(c.id));
                const parentId = mapId(commentMap, c.parentId);
                if (newId === undefined || parentId === null) continue;
                await tx.update(comments).set({ parentId }).where(eq(comments.id, newId));
            }
            return 0;
        });

        counts.mentions = await this.insertPlain(tx, rows('mentions'), mentions, (m) => {
            const listId = mapId(maps.list, m.listId);
            const recordId = mapId(maps.record, m.recordId);
            const mentionedUserId = mapId(maps.user, m.mentionedUserId);
            const authorUserId = mapId(maps.user, m.authorUserId);
            if (listId === null || recordId === null || mentionedUserId === null) return null;
            if (authorUserId === null) return null;
            return {
                tenantId,
                commentId: mapId(commentMap, m.commentId),
                listId,
                recordId,
                mentionedUserId,
                authorUserId,
                source: String(m.source ?? 'comment'),
                snippet: String(m.snippet ?? ''),
            };
        });

        counts.activity = await this.streamInsert(rows('activity'), async (batch) => {
            const values = batch
                .filter((a) => maps.list.has(Number(a.listId)))
                .map((a) => ({
                    tenantId,
                    listId: maps.list.get(Number(a.listId))!,
                    recordId: mapId(maps.record, a.recordId),
                    userId: mapId(maps.user, a.userId),
                    action: String(a.action),
                    // El diff tiene claves `f{field_id}` pero sus VALORES son
                    // `{from,to}`, no valores de campo: se traducen sólo las
                    // claves (mapa de tipos vacío) para que el feed siga
                    // nombrando el campo correcto sin tocar el contenido.
                    diff: remapRecordData((a.diff as Row | null) ?? {}, new Map(), maps),
                    createdAt: this.date(a.createdAt) ?? new Date(),
                }));
            if (!values.length) return 0;
            await this.insertValues(tx, activity, values);
            return values.length;
        });

        // 7b. Plantillas de documentos PDF (antes que las automatizaciones,
        //     que las referencian por id). El diseño lleva la relación de la
        //     tabla de ítems, su lista y las imágenes subidas.
        counts.document_templates = await this.insertMapped(
            tx,
            await this.readAll(rows('document_templates')),
            documentTemplates,
            maps.document,
            (d) => ({
                tenantId,
                listId: maps.list.get(Number(d.listId))!,
                name: String(d.name),
                filename: String(d.filename ?? ''),
                design: remapJson((d.design as Row | null) ?? {}, maps) as Row,
                nextNumber: Number(d.nextNumber ?? 1),
                portalVisible: d.portalVisible === true,
                createdBy: mapId(maps.user, d.createdBy),
            }),
            (d) => maps.list.has(Number(d.listId)),
        );

        // 7c. Formularios públicos (antes que las automatizaciones: el
        //     disparador «Cuando se envía un formulario» los nombra por id).
        //     La dirección pública es una credencial del servidor de origen:
        //     cada uno recibe una nueva.
        const formRows = await this.readAll(rows('forms'));
        counts.forms = await this.insertMapped(
            tx,
            formRows,
            forms,
            maps.form,
            (f) => ({
                tenantId,
                listId: maps.list.get(Number(f.listId))!,
                name: String(f.name),
                token: randomBytes(18).toString('base64url'),
                enabled: f.enabled === true,
                config: remapJson((f.config as Row | null) ?? {}, maps) as Row,
                submissionsCount: Number(f.submissionsCount ?? 0),
                lastSubmittedAt: this.date(f.lastSubmittedAt),
                createdBy: mapId(maps.user, f.createdBy),
            }),
            (f) => maps.list.has(Number(f.listId)),
        );

        // 8. Automatizaciones (+ URL nueva del webhook entrante).
        const autoRows = await this.readAll(rows('automations'));
        const autoMap = new Map<number, number>();
        for (const a of autoRows) {
            const listId = mapId(maps.list, a.listId);
            if (listId === null) continue;
            const { triggerConfig, actions } = remapAutomation(
                (a.triggerConfig as Row | null) ?? {},
                a.actions ?? [],
                maps,
            );
            if (String(a.triggerType) === 'incoming_webhook') {
                triggerConfig.webhook_token = randomBytes(24).toString('base64url');
            }
            const [ins] = await tx
                .insert(automations)
                .values({
                    tenantId,
                    listId,
                    name: String(a.name),
                    description: (a.description as string | null) ?? null,
                    triggerType: String(a.triggerType),
                    triggerConfig: triggerConfig as never,
                    actions: actions as never,
                    isActive: Boolean(a.isActive),
                })
                .returning({ id: automations.id });
            autoMap.set(Number(a.id), ins!.id);
            const token = triggerConfig.webhook_token;
            if (typeof token === 'string') {
                await tx.insert(automationHooks).values({ token, tenantId, automationId: ins!.id });
            }
        }
        counts.automations = autoMap.size;

        counts.automation_runs = await this.streamInsert(rows('automation_runs'), async (batch) => {
            const values = batch
                .filter((r) => autoMap.has(Number(r.automationId)))
                .map((r) => ({
                    tenantId,
                    automationId: autoMap.get(Number(r.automationId))!,
                    recordId: mapId(maps.record, r.recordId),
                    status: String(r.status),
                    actionsLog: r.actionsLog ?? [],
                    error: (r.error as string | null) ?? null,
                    startedAt: this.date(r.startedAt),
                    finishedAt: this.date(r.finishedAt),
                    createdAt: this.date(r.createdAt) ?? new Date(),
                }));
            if (!values.length) return 0;
            await this.insertValues(tx, automationRuns, values);
            return values.length;
        });

        counts.dashboards = await this.insertPlain(tx, rows('dashboards'), dashboards, (d) => ({
            tenantId,
            userId: mapId(maps.user, d.userId),
            name: String(d.name),
            description: (d.description as string | null) ?? null,
            widgets: remapJson(d.widgets ?? [], maps),
            settings: (d.settings as Row | null) ?? {},
            isDefault: Boolean(d.isDefault),
            position: Number(d.position ?? 0),
            visibility: String(d.visibility ?? 'workspace'),
            allowedRoles: d.allowedRoles ?? [],
            createdBy: mapId(maps.user, d.createdBy) ?? fallbackUser ?? 0,
        }));

        counts.recurrences = await this.insertPlain(tx, rows('recurrences'), recurrences, (r) => {
            const listId = mapId(maps.list, r.listId);
            const recordId = mapId(maps.record, r.recordId);
            const dateFieldId = mapId(maps.field, r.dateFieldId);
            if (listId === null || recordId === null || dateFieldId === null) return null;
            return {
                tenantId,
                listId,
                recordId,
                dateFieldId,
                frequency: String(r.frequency),
                intervalN: Number(r.intervalN ?? 1),
                monthlyPattern: (r.monthlyPattern as string | null) ?? null,
                triggerType: String(r.triggerType ?? 'schedule'),
                triggerStatusFieldId: mapId(maps.field, r.triggerStatusFieldId),
                triggerStatusValue: (r.triggerStatusValue as string | null) ?? null,
                actionType: String(r.actionType ?? 'update'),
                updateStatusFieldId: mapId(maps.field, r.updateStatusFieldId),
                updateStatusValue: (r.updateStatusValue as string | null) ?? null,
                repeatUntil: (r.repeatUntil as string | null) ?? null,
                lastFiredAt: (r.lastFiredAt as string | null) ?? null,
            };
        });

        // v0.1.267 — números de documento emitidos (plantilla + registro nuevos).
        counts.document_numbers = await this.insertPlain(tx, rows('document_numbers'), documentNumbers, (n) => {
            const templateId = mapId(maps.document, n.templateId);
            const recordId = mapId(maps.record, n.recordId);
            if (templateId === null || recordId === null) return null;
            return {
                tenantId,
                templateId,
                recordId,
                number: Number(n.number),
                label: String(n.label ?? ''),
                createdAt: this.date(n.createdAt) ?? new Date(),
            };
        });

        counts.portal_links = await this.insertPlain(tx, rows('portal_links'), portalLinks, (p) => {
            const userId = mapId(maps.user, p.userId);
            const listId = mapId(maps.list, p.listId);
            const recordId = mapId(maps.record, p.recordId);
            if (userId === null || listId === null || recordId === null) return null;
            return { tenantId, userId, listId, recordId, lastAccessAt: this.date(p.lastAccessAt) };
        });

        // 9. Enlaces públicos: token NUEVO (el viejo es del otro servidor).
        const publicRows = await this.readAll(rows('public_lists'));
        const publicTokens = new Map<number, string>();
        for (const p of publicRows) {
            const listId = mapId(maps.list, p.listId);
            if (listId === null) continue;
            const token = randomBytes(24).toString('base64url');
            publicTokens.set(Number(p.listId), token);
            await tx.insert(publicLists).values({ token, tenantId, listId });
        }
        counts.public_lists = publicTokens.size;

        // 10. `lists.settings` al final: recién ahora existen todos los ids que
        //     referencia (campos, vistas, plantillas, otras listas, personas).
        for (const l of listRows) {
            const newId = maps.list.get(Number(l.id));
            if (newId === undefined) continue;
            const settings = remapListSettings(
                (l.settings as Row | null) ?? {},
                maps,
                publicTokens.get(Number(l.id)) ?? null,
            );
            await tx.update(lists).set({ settings }).where(eq(lists.id, newId));
        }

        counts.audit_log = await this.insertPlain(tx, rows('audit_log'), auditLog, (a) => ({
            tenantId,
            userId: mapId(maps.user, a.userId),
            action: String(a.action),
            targetType: String(a.targetType ?? ''),
            // El id del objeto es polimórfico: se traduce lo que se puede y el
            // resto queda en null — el NOMBRE guardado sigue siendo lo que se
            // lee en pantalla.
            targetId: this.mapAuditTarget(String(a.targetType ?? ''), a.targetId, maps),
            targetLabel: String(a.targetLabel ?? ''),
            meta: (a.meta as Row | null) ?? {},
            createdAt: this.date(a.createdAt) ?? new Date(),
        }));

        counts.email_usage = await this.insertPlain(tx, rows('email_usage'), emailUsage, (u) => ({
            tenantId,
            period: String(u.period),
            sent: Number(u.sent ?? 0),
        }));
        counts.ai_usage = await this.insertPlain(tx, rows('ai_usage'), aiUsage, (u) => ({
            tenantId,
            period: String(u.period),
            requests: Number(u.requests ?? 0),
            inputTokens: Number(u.inputTokens ?? 0),
            outputTokens: Number(u.outputTokens ?? 0),
        }));

        // v0.1.206 — sincronizaciones con tiendas (después de registros y
        // conexiones: los vínculos apuntan a los dos).
        const syncMap = new Map<number, number>();
        for (const sRow of await this.readAll(rows('connection_syncs'))) {
            const connectionId = mapId(maps.connection, sRow.connectionId);
            if (connectionId === null) continue;
            const state: Row = { ...((sRow.state as Row | null) ?? {}), running: false };
            // Los avisos en tiempo real apuntan a la instancia de ORIGEN: se
            // registran de nuevo acá cuando corre (fase 3).
            if (state.realtime && typeof state.realtime === 'object') {
                state.realtime = { ...(state.realtime as Row), webhook_ids: [] };
            }
            const [ins] = await tx
                .insert(connectionSyncs)
                .values({
                    tenantId,
                    connectionId,
                    provider: String(sRow.provider ?? 'woocommerce'),
                    settings: remapSyncSettings(sRow.settings, maps, groupMap),
                    state,
                    enabled: Boolean(sRow.enabled),
                    nextRunAt: new Date(),
                    createdBy: mapId(maps.user, sRow.createdBy),
                })
                .returning({ id: connectionSyncs.id });
            syncMap.set(Number(sRow.id), ins!.id);
        }
        counts.connection_syncs = syncMap.size;
        counts.sync_links = await this.streamInsert(rows('sync_links'), async (batch) => {
            const values = batch
                .map((l) => {
                    const syncId = syncMap.get(Number(l.syncId));
                    const recordId = mapId(maps.record, l.recordId);
                    if (syncId === undefined || recordId === null) return null;
                    return {
                        tenantId,
                        syncId,
                        resource: String(l.resource),
                        externalId: String(l.externalId),
                        parentExternalId: (l.parentExternalId as string | null) ?? null,
                        recordId,
                    };
                })
                .filter((v): v is NonNullable<typeof v> => v !== null);
            if (!values.length) return 0;
            await this.insertValues(tx, syncLinks, values);
            return values.length;
        });
        // v0.1.243 — sincronizaciones desde SQL Server. `remapJson` traduce los
        // campos de la configuración (`key_field_id`, `columns[].field_id`…);
        // la marca de la lista lleva ids de sincronización, que se rearma acá.
        const sqlByList = new Map<number, Array<Record<string, unknown>>>();
        let sqlCount = 0;
        for (const q of await this.readAll(rows('sql_syncs'))) {
            const connectionId = mapId(maps.connection, q.connectionId);
            const listId = mapId(maps.list, q.listId);
            if (connectionId === null || listId === null) continue;
            const settings = remapJson((q.settings as Row | null) ?? {}, maps) as Row;
            const [ins] = await tx
                .insert(sqlSyncs)
                .values({
                    tenantId,
                    connectionId,
                    listId,
                    name: String(q.name ?? 'SQL'),
                    settings,
                    state: { ...((q.state as Row | null) ?? {}), running: false, queued: false },
                    enabled: Boolean(q.enabled),
                    nextRunAt: q.enabled ? new Date() : null,
                    createdBy: mapId(maps.user, q.createdBy),
                })
                .returning({ id: sqlSyncs.id });
            sqlCount++;
            const columns = Array.isArray(settings.columns) ? (settings.columns as Row[]) : [];
            const flag = settings.on_missing === 'flag' && settings.flag_field_id ? [Number(settings.flag_field_id)] : [];
            sqlByList.set(listId, [
                ...(sqlByList.get(listId) ?? []),
                {
                    sync_id: ins!.id,
                    connection_id: connectionId,
                    name: String(q.name ?? ''),
                    key_field_id: Number(settings.key_field_id) || 0,
                    field_ids: [Number(settings.key_field_id) || 0, ...columns.map((c) => Number(c.field_id) || 0), ...flag].filter((n) => n > 0),
                },
            ]);
        }
        counts.sql_syncs = sqlCount;
        for (const l of listRows) {
            const newId = maps.list.get(Number(l.id));
            if (newId === undefined) continue;
            const syncs = sqlByList.get(newId);
            await tx
                .update(lists)
                .set({
                    settings: syncs
                        ? sql`${lists.settings} || ${JSON.stringify({ sql_sync: { syncs } })}::jsonb`
                        : sql`${lists.settings} - 'sql_sync'`,
                })
                .where(eq(lists.id, newId));
        }
        if (sqlCount > 0 && !sameKey) {
            warnings.push('La contraseña de la base de datos SQL no viajó (otra clave de cifrado): volvé a cargarla en Integraciones → SQL Server.');
        }

        if (syncMap.size > 0 && !sameKey) {
            warnings.push(
                'La clave de la tienda no viajó (otra clave de cifrado): volvé a cargarla en Integraciones → WooCommerce. La sincronización sigue donde estaba, sin duplicar nada.',
            );
        }

        if (!trustCredentials && usersCreated > 0) {
            warnings.push(
                `${usersCreated} cuenta(s) nueva(s) se crearon SIN contraseña: cada persona entra con «¿Olvidaste tu contraseña?» (así se comprueba que el correo es suyo). Para conservar las contraseñas, importá marcando que el archivo viene de un servidor de confianza.`,
            );
        }
        if (publicTokens.size > 0) {
            warnings.push(
                `${publicTokens.size} lista(s) pública(s) tienen un enlace NUEVO: hay que volver a repartirlo.`,
            );
        }
        if (formRows.length > 0) {
            warnings.push(
                `${formRows.length} formulario(s) tienen una dirección NUEVA: hay que volver a repartirla (y a insertarla en los sitios que lo usan).`,
            );
        }
        const hooks = autoRows.filter((a) => String(a.triggerType) === 'incoming_webhook').length;
        if (hooks > 0) {
            warnings.push(
                `${hooks} automatización(es) con webhook entrante tienen una URL nueva: actualizá el sistema que las llama.`,
            );
        }
        if (tenantRow.customDomain) {
            warnings.push(
                `El dominio propio «${String(tenantRow.customDomain)}» no viajó: apunta al servidor anterior y hay que configurarlo acá.`,
            );
        }
        if (tenantRow.portalDomain) {
            warnings.push(
                `El dominio del portal de clientes «${String(tenantRow.portalDomain)}» no viajó: apunta al servidor anterior y hay que configurarlo acá.`,
            );
        }
        // v0.1.251 — cobros: la conexión viaja, el historial de links no (cada
        // link tiene su URL de avisos en el servidor de origen).
        const [collections] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(connections)
            .where(and(eq(connections.tenantId, tenantId), inArray(connections.provider, ['mercadopago', 'wompi'])));
        if (Number(collections?.n ?? 0) > 0) {
            warnings.push(
                'Cobros (Mercado Pago / Wompi): la conexión viajó, pero el historial de links de pago no — y la URL de avisos es nueva. En Wompi pegá la nueva en Desarrolladores → «URL de Eventos» (la ves en Integraciones → Cobros).',
            );
        }

        return {
            tenant_id: tenantId,
            slug,
            name,
            counts,
            users_created: usersCreated,
            users_linked: usersLinked,
            warnings,
        };
    }

    // ── Internos ─────────────────────────────────────────────────────────

    /**
     * `select * from <t> where tenant_id = …` sobre una tabla resuelta en
     * runtime. Drizzle no puede inferir el shape de una tabla genérica, así
     * que la fila sale como `Row` y cada caller construye sus valores
     * explícitamente (no hay copia ciega de columnas).
     */
    private async byTenant(table: TenantTable, tenantId: number): Promise<Row[]> {
        const rows = await this.db.select().from(table).where(eq(table.tenantId, tenantId));
        return rows as Row[];
    }

    /** Vuelca una tabla grande por páginas keyset, sin cargarla en memoria. */
    private async dumpPaged(
        work: string,
        name: string,
        table: KeyedTable,
        tenantId: number,
    ): Promise<number> {
        const out = createWriteStream(path.join(work, 'rows', `${name}.ndjson`));
        let cursor = 0;
        let total = 0;
        try {
            for (;;) {
                const page = (await this.db
                    .select()
                    .from(table)
                    .where(and(eq(table.tenantId, tenantId), gt(table.id, cursor)))
                    .orderBy(asc(table.id))
                    .limit(PAGE)) as Row[];
                if (page.length === 0) break;
                for (const row of page) out.write(`${JSON.stringify(row)}\n`);
                cursor = Number(page[page.length - 1]!.id);
                total += page.length;
                if (page.length < PAGE) break;
            }
        } finally {
            await new Promise<void>((res, rej) => out.end((err?: Error) => (err ? rej(err) : res())));
        }
        return total;
    }

    private async writeNdjson(file: string, rows: unknown[]): Promise<void> {
        const body = rows.map((r) => `${JSON.stringify(r)}\n`).join('');
        await this.writeText(file, body);
    }

    private async writeText(file: string, body: string): Promise<void> {
        await pipeline(Readable.from([body]), createWriteStream(file));
    }

    private async readAll(file: string): Promise<Row[]> {
        if (!existsSync(file)) return [];
        const out: Row[] = [];
        const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
        for await (const line of rl) {
            if (line.trim() !== '') out.push(JSON.parse(line) as Row);
        }
        return out;
    }

    /** Lee una NDJSON en lotes y delega el insert; devuelve filas insertadas. */
    private async streamInsert(
        file: string,
        onBatch: (batch: Row[]) => Promise<number>,
    ): Promise<number> {
        if (!existsSync(file)) return 0;
        let batch: Row[] = [];
        let total = 0;
        const flush = async (): Promise<void> => {
            if (batch.length === 0) return;
            total += await onBatch(batch);
            batch = [];
        };
        const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
        for await (const line of rl) {
            if (line.trim() === '') continue;
            batch.push(JSON.parse(line) as Row);
            if (batch.length >= BATCH) await flush();
        }
        await flush();
        return total;
    }

    /** `INSERT` sobre una tabla resuelta en runtime, sin leer nada de vuelta. */
    private async insertValues(tx: Tx, table: PgTable, values: Row[]): Promise<void> {
        await tx.insert(table).values(values as never);
    }

    /**
     * `INSERT … RETURNING id`. Postgres devuelve las filas de un VALUES
     * múltiple en el mismo orden en que se enviaron, que es lo que permite
     * armar el mapa viejo→nuevo por índice. Sólo para tablas CON `id`
     * (`memberships` y las de uso mensual tienen clave compuesta).
     */
    private async insertReturningIds(tx: Tx, table: PgTable, values: Row[]): Promise<number[]> {
        const ins = (await tx
            .insert(table)
            .values(values as never)
            .returning({ id: sql<string>`id` })) as Array<{ id: string }>;
        // `id` es `bigint`: sin el parser de la columna (que acá no se puede
        // nombrar, la tabla se resuelve en runtime) el driver lo devuelve como
        // CADENA. Un id que quede en string envenena todos los mapas y las
        // referencias salen como `"3"` en vez de `3`.
        return ins.map((r) => Number(r.id));
    }

    /** Insert por lotes que además guarda el mapa viejo→nuevo por `id`. */
    private async insertMapped(
        tx: Tx,
        rows: Row[],
        table: PgTable,
        map: Map<number, number>,
        build: (row: Row) => Row,
        keep?: (row: Row) => boolean,
    ): Promise<number> {
        const usable = keep ? rows.filter(keep) : rows;
        let total = 0;
        for (let i = 0; i < usable.length; i += BATCH) {
            const slice = usable.slice(i, i + BATCH);
            const ids = await this.insertReturningIds(tx, table, slice.map(build));
            slice.forEach((r, k) => map.set(Number(r.id), ids[k]!));
            total += slice.length;
        }
        return total;
    }

    /** Insert de filas hoja (sin mapa). `null` = fila descartada. */
    private async insertPlain(
        tx: Tx,
        file: string,
        table: PgTable,
        build: (row: Row) => Row | null,
    ): Promise<number> {
        return this.streamInsert(file, async (batch) => {
            const values = batch.map(build).filter((v): v is Row => v !== null);
            if (!values.length) return 0;
            await this.insertValues(tx, table, values);
            return values.length;
        });
    }

    private mapAuditTarget(type: string, raw: unknown, maps: IdMaps): number | null {
        if (type === 'list') return mapId(maps.list, raw);
        if (type === 'field') return mapId(maps.field, raw);
        if (type === 'connection') return mapId(maps.connection, raw);
        if (type === 'user' || type === 'member') return mapId(maps.user, raw);
        return null;
    }

    /** Quita del `settings` de la empresa lo que no se puede descifrar acá. */
    private cleanTenantSettings(settings: Row | null, sameKey: boolean): Row {
        const out = { ...(settings ?? {}) };
        // v0.1.268 (ADR-S36) — los adjuntos llegan al servidor de la
        // plataforma, y el id de la conexión de almacenamiento cambia al
        // importar: la empresa vuelve a elegirlo en Ajustes → Almacenamiento.
        delete out.storage;
        if (sameKey) return out;
        const smtp = out.smtp;
        if (smtp !== null && typeof smtp === 'object') {
            const pass = String((smtp as { pass_enc?: string }).pass_enc ?? '');
            // Un SMTP cuya contraseña no se puede leer manda al transporte de
            // plataforma en silencio (v0.1.150): mejor sacarlo entero.
            if (isEncrypted(pass)) delete out.smtp;
        }
        const ai = out.ai;
        if (ai !== null && typeof ai === 'object') {
            const next = { ...(ai as Row) };
            delete next.api_key_enc;
            out.ai = next;
        }
        return out;
    }

    private async freeSlug(tx: Tx, desired: string): Promise<string> {
        const base =
            desired
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, '-')
                .slice(0, 55) || 'empresa';
        for (let n = 0; n < 200; n++) {
            const slug = n === 0 ? base : `${base}-${n + 1}`;
            const [row] = await tx
                .select({ id: tenants.id })
                .from(tenants)
                .where(eq(tenants.slug, slug))
                .limit(1);
            if (!row) return slug;
        }
        throw new BadRequestException({
            code: 'slug_taken',
            message: 'No se pudo elegir un slug libre',
            data: { status: 400 },
        });
    }

    private date(raw: unknown): Date | null {
        if (raw === null || raw === undefined) return null;
        const d = new Date(String(raw));
        return Number.isNaN(d.getTime()) ? null : d;
    }

    /** Nombre plano del archivo dentro del tar (la clave de storage lleva `/`). */
    private fileEntry(storageKey: string): string {
        return storageKey.replace(/[^A-Za-z0-9._-]/g, '_');
    }

    private secretsFingerprint(): string | null {
        if (!this.env.SECRETS_KEY) return null;
        return createHash('sha256').update(this.env.SECRETS_KEY).digest('hex').slice(0, 16);
    }

    private appVersion(): string {
        for (const rel of ['../../VERSION', '../../../VERSION', 'VERSION']) {
            const file = path.resolve(process.cwd(), rel);
            try {
                if (existsSync(file)) return readFileSync(file, 'utf8').trim();
            } catch {
                // Sin VERSION legible el manifest sale con 0.0.0: es
                // informativo, no bloquea la migración.
            }
        }
        return '0.0.0';
    }

    private tar(args: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const p = spawn('tar', args, { stdio: ['ignore', 'ignore', 'pipe'] });
            let err = '';
            p.stderr.on('data', (d: Buffer) => (err += d.toString()));
            p.on('error', reject);
            p.on('close', (code) =>
                code === 0 ? resolve() : reject(new Error(`tar falló (${code}): ${err.slice(0, 300)}`)),
            );
        });
    }

    private tarRead(file: string, entry: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const p = spawn('tar', ['-xOf', file, `./${entry}`], { stdio: ['ignore', 'pipe', 'pipe'] });
            let out = '';
            let err = '';
            p.stdout.on('data', (d: Buffer) => (out += d.toString()));
            p.stderr.on('data', (d: Buffer) => (err += d.toString()));
            p.on('error', reject);
            p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.slice(0, 200)))));
        });
    }
}

/**
 * SEC-30 (v0.1.228): recorre lo extraído y rechaza cualquier cosa que no sea
 * carpeta o archivo común (symlinks, dispositivos, FIFOs). `lstat` para NO
 * seguir el enlace al mirarlo.
 */
export function assertOnlyRegularFiles(root: string): void {
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            const st = lstatSync(full);
            if (st.isDirectory()) {
                stack.push(full);
            } else if (!st.isFile()) {
                throw new BadRequestException({
                    code: 'bad_archive',
                    message: `El archivo trae una entrada que no es un archivo común (${path.relative(root, full)}): no es una exportación de empresa válida.`,
                    data: { status: 400 },
                });
            }
        }
    }
}
