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
    remapFormulaConfig,
    readTemplateContent,
    remapTemplateContent,
    tenantTransferManifestSchema,
    type ExportTenantInput,
    type ExportTenantResult,
    type ImportTenantInput,
    type ImportTenantResult,
    type TenantTransferFile,
    type TenantTransferManifest,
    type TenantTransferStatus,
} from '@imagina-base/shared';
import { and, asc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import * as argon2 from 'argon2';
import { isEncrypted } from '../common/secret-box';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db, type Tx, withoutTimeouts } from '../db/client';
import {
    activity,
    aiUsage,
    attachments,
    auditLog,
    automationHooks,
    automationRuns,
    automations,
    automationVersions,
    commentReactions,
    comments,
    connections,
    dataConsents,
    dataConsentVersions,
    connectionSyncs,
    sqlSyncs,
    dashboards,
    dashboardSubscriptions,
    publicDashboards,
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
    autonumberCounters,
    documentTemplates,
    forms,
    bookingPages,
    bookingAppointments,
    templates,
    tenants,
    timeEntries,
    users,
    syncLinks,
    recordDependencies,
    recordChecklists,
    recordChecklistItems,
    recordTemplates,
    teamMembers,
    teams,
    customRoles,
    recordShares,
    ganttBaselines,
    ganttBaselineItems,
    approvalFlows,
    approvalRequests,
    approvalDecisions,
} from '../db/schema';
import { FILE_STORAGE, TENANT_STORAGE, type FileStorage, type TenantStorageResolver } from '../files/file-storage';
import {
    emptyMaps,
    mapId,
    remapAutomation,
    remapButtonConfig,
    remapJson,
    remapListSettings,
    remapRecordData,
    remapRichDoc,
    type IdMaps,
    remapSyncSettings,
    remapViewConfig,
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
    'Los dispositivos con notificaciones push: el navegador se suscribió con las llaves del servidor de origen; cada persona las vuelve a activar en Ajustes → Cuenta → Avisos.',
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

    async readManifest(file: string): Promise<TenantTransferManifest | null> {
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
            // C2 — roles propios (antes que las membresías que los usan).
            await dump('custom_roles', await this.byTenant(customRoles, tenantId));
            // C1 — equipos y sus personas (sólo las que viajan: miembros de ésta).
            await dump('teams', await this.byTenant(teams, tenantId));
            await dump('team_members', await this.byTenant(teamMembers, tenantId));
            await dump('list_groups', await this.byTenant(listGroups, tenantId));
            // Papelera: lo que está en la papelera NO viaja (ni lo que cuelga
            // de ello). La conexión base no pasa por la RLS: el filtro va a mano.
            await dump('lists', await this.byTenant(lists, tenantId, sql`${lists.deletedAt} IS NULL`));
            await dump('list_slug_history', await this.byTenant(listSlugHistory, tenantId, liveList(listSlugHistory.listId)));
            await dump('fields', await this.byTenant(fields, tenantId, sql`${fields.deletedAt} IS NULL`));
            await dump('templates', await this.byTenant(templates, tenantId));
            await dump('connections', await this.byTenant(connections, tenantId));
            await dump('attachments', attachRows);
            await dump('saved_views', await this.byTenant(savedViews, tenantId, sql`${savedViews.deletedAt} IS NULL`));
            // v0.1.266 — plantillas de documentos PDF.
            await dump('document_templates', await this.byTenant(documentTemplates, tenantId, liveList(documentTemplates.listId)));
            // v0.1.267 — números ya emitidos (el consecutivo sigue donde iba).
            await dump('document_numbers', await this.byTenant(documentNumbers, tenantId, liveRecord(documentNumbers.recordId)));
            // v0.1.300 — contadores del ID automático (el consecutivo sigue donde iba).
            await dump('autonumber_counters', await this.byTenant(autonumberCounters, tenantId, liveField(autonumberCounters.fieldId)));
            // v0.1.275 — formularios públicos (el diseño apunta a campos por id).
            await dump('forms', await this.byTenant(forms, tenantId, liveList(forms.listId)));
            // D5 — páginas de agenda (la configuración apunta a campos y personas por id).
            await dump('booking_pages', await this.byTenant(bookingPages, tenantId, liveList(bookingPages.listId)));
            // Autorización de tratamiento de datos (Ley 1581): las versiones
            // del texto (la evidencia va abajo, por páginas).
            await dump('data_consent_versions', await this.byTenant(dataConsentVersions, tenantId));
            await dump('saved_filters', await this.byTenant(savedFilters, tenantId, liveList(savedFilters.listId)));
            await dump('automations', await this.byTenant(automations, tenantId, sql`${automations.deletedAt} IS NULL`));
            // v0.1.288 — historial de versiones (fotos sin secretos).
            await dump('automation_versions', await this.byTenant(automationVersions, tenantId, liveAutomation(automationVersions.automationId)));
            await dump('dashboards', await this.byTenant(dashboards, tenantId, sql`${dashboards.deletedAt} IS NULL`));
            // v0.1.292 — envíos programados y enlaces públicos de los tableros.
            // El TOKEN del enlace no viaja (es la credencial de ESTE servidor):
            // el destino emite uno nuevo, igual que con las listas públicas.
            await dump('dashboard_subscriptions', await this.byTenant(dashboardSubscriptions, tenantId, liveDashboard(dashboardSubscriptions.dashboardId)));
            await dump(
                'public_dashboards',
                (await this.byTenant(publicDashboards, tenantId, liveDashboard(publicDashboards.dashboardId))).map(({ token: _token, ...rest }) => rest),
            );
            await dump('recurrences', await this.byTenant(recurrences, tenantId, and(liveRecord(recurrences.recordId), liveField(recurrences.dateFieldId))));
            await dump('portal_links', await this.byTenant(portalLinks, tenantId, liveRecord(portalLinks.recordId)));
            await dump('public_lists', await this.byTenant(publicLists, tenantId, liveList(publicLists.listId)));
            await dump(
                'relations',
                await this.byTenant(relations, tenantId, and(liveRecord(relations.sourceRecordId), liveRecord(relations.targetRecordId), liveField(relations.fieldId))),
            );
            await dump('mentions', await this.byTenant(mentions, tenantId, liveRecord(mentions.recordId)));
            // C3 — registros sueltos compartidos con invitados de afuera.
            await dump('record_shares', await this.byTenant(recordShares, tenantId, liveRecord(recordShares.recordId)));
            await dump('email_usage', await this.byTenant(emailUsage, tenantId));
            await dump('ai_usage', await this.byTenant(aiUsage, tenantId));
            // v0.1.206 — sincronizaciones con tiendas y sus vínculos: sin
            // ellos, reactivarla en el destino DUPLICARÍA todo lo traído.
            await dump('connection_syncs', await this.byTenant(connectionSyncs, tenantId));
            await dump('sync_links', await this.byTenant(syncLinks, tenantId, liveRecord(syncLinks.recordId)));
            // v0.1.243 — sincronizaciones desde SQL Server.
            await dump('sql_syncs', await this.byTenant(sqlSyncs, tenantId, liveList(sqlSyncs.listId)));
            // A8 — dependencias entre registros (las dos puntas vivas).
            await dump(
                'record_dependencies',
                await this.byTenant(
                    recordDependencies,
                    tenantId,
                    and(liveRecord(recordDependencies.blockerRecordId), liveRecord(recordDependencies.blockedRecordId)),
                ),
            );
            // C6 — plantillas de registro y de checklist (de listas vivas).
            await dump('record_templates', await this.byTenant(recordTemplates, tenantId, liveList(recordTemplates.listId)));
            // A9 — checklists de los registros vivos, con sus ítems.
            await dump('record_checklists', await this.byTenant(recordChecklists, tenantId, liveRecord(recordChecklists.recordId)));
            await dump('record_checklist_items', await this.byTenant(recordChecklistItems, tenantId, liveRecord(recordChecklistItems.recordId)));
            // B1 — líneas base del Gantt (la de una vista en la papelera no viaja).
            await dump('gantt_baselines', await this.byTenant(ganttBaselines, tenantId, liveView(ganttBaselines.viewId)));
            await dump(
                'gantt_baseline_items',
                await this.byTenant(
                    ganttBaselineItems,
                    tenantId,
                    and(
                        liveRecord(ganttBaselineItems.recordId),
                        sql`EXISTS (SELECT 1 FROM gantt_baselines b JOIN saved_views v ON v.id = b.view_id WHERE b.id = ${ganttBaselineItems.baselineId} AND v.deleted_at IS NULL)`,
                    ),
                ),
            );

            // C5 — aprobaciones: los flujos de cada lista, las solicitudes (de
            // registros vivos) y sus decisiones.
            await dump('approval_flows', await this.byTenant(approvalFlows, tenantId, liveList(approvalFlows.listId)));
            await dump('approval_requests', await this.byTenant(approvalRequests, tenantId, liveRecord(approvalRequests.recordId)));
            await dump(
                'approval_decisions',
                await this.byTenant(
                    approvalDecisions,
                    tenantId,
                    sql`EXISTS (SELECT 1 FROM approval_requests ar JOIN records r ON r.id = ar.record_id WHERE ar.id = ${approvalDecisions.requestId} AND r.deleted_at IS NULL)`,
                ),
            );

            // Tablas grandes: por páginas keyset, escribiendo a medida (las de
            // una empresa con cientos de miles de filas no entran en memoria).
            counts.records = await this.dumpPaged(work, 'records', records, tenantId, sql`${records.deletedAt} IS NULL`);
            counts.comments = await this.dumpPaged(work, 'comments', comments, tenantId, liveRecord(comments.recordId));
            // v0.1.291 — reacciones de los comentarios y registro de tiempo.
            counts.comment_reactions = await this.dumpPaged(
                work,
                'comment_reactions',
                commentReactions,
                tenantId,
                sql`NOT EXISTS (SELECT 1 FROM comments c JOIN records r ON r.id = c.record_id WHERE c.id = ${commentReactions.commentId} AND r.deleted_at IS NOT NULL)`,
            );
            counts.time_entries = await this.dumpPaged(work, 'time_entries', timeEntries, tenantId, liveRecord(timeEntries.recordId));
            // D5 — las citas de la agenda (cada una cuelga de su registro).
            counts.booking_appointments = await this.dumpPaged(work, 'booking_appointments', bookingAppointments, tenantId, liveRecord(bookingAppointments.recordId));
            counts.activity = await this.dumpPaged(work, 'activity', activity, tenantId, and(liveList(activity.listId), liveRecord(activity.recordId)));
            // La EVIDENCIA de cada autorización de datos: es prueba legal de la
            // empresa (la tiene que conservar), así que viaja con ella — también
            // la de registros en la papelera (su referencia queda en blanco).
            counts.data_consents = await this.dumpPaged(work, 'data_consents', dataConsents, tenantId);
            counts.audit_log = await this.dumpPaged(work, 'audit_log', auditLog, tenantId);
            counts.automation_runs = input.include_runs
                ? await this.dumpPaged(work, 'automation_runs', automationRuns, tenantId, liveAutomation(automationRuns.automationId))
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
            // adentro no significan nada aquí.
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
                return await this.db.transaction(async (tx) => {
                    // Una empresa grande tarda: sin los topes de tiempo de la conexión.
                    await withoutTimeouts(tx);
                    // v0.1.300 — los registros traen su ID automático: el trigger
                    // los respeta (sin esto los renumeraría al insertarlos).
                    await tx.execute(sql`select set_config('app.keep_autonumber', 'on', true)`);
                    return this.runImport(tx, work, manifest, input, writtenKeys);
                });
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
                message: `El archivo usa el formato ${parsed.data.format} y esta instalación entiende hasta el ${TENANT_TRANSFER_FORMAT}. Actualiza antes de importar.`,
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
                'La empresa guardaba sus archivos en un almacenamiento propio: llegaron al servidor (cuentan para el plan). Elige de nuevo el almacenamiento en Ajustes → Almacenamiento y mueve los archivos.',
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

        // 2. Usuarios: se reusa la cuenta si el email ya existe aquí (la misma
        //    persona puede estar ya en el servidor destino por otra empresa).
        const userRows = await this.readAll(rows('users'));
        // SEC-30 (v0.1.228): la contraseña (hash), el email verificado y el
        // segundo factor de una cuenta NUEVA salen del archivo. Si el archivo
        // no lo armó un servidor de confianza, quien lo armó elige la
        // contraseña de cualquier email que todavía no exista aquí — y cuando
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

        // C2 — roles propios (antes que las membresías: `custom_role_id`).
        counts.custom_roles = await this.insertMapped(tx, await this.readAll(rows('custom_roles')), customRoles, maps.customRole, (r) => ({
            tenantId,
            name: String(r.name).slice(0, 60),
            description: (r.description as string | null) ?? null,
            color: (r.color as string | null) ?? null,
            baseRole: ['manager', 'agent', 'viewer'].includes(String(r.baseRole)) ? String(r.baseRole) : 'viewer',
            capabilities: Array.isArray(r.capabilities) ? (r.capabilities as string[]) : [],
            createdBy: mapId(maps.user, r.createdBy),
        }));

        // 3. Membresías
        const memberRows = await this.readAll(rows('memberships'));
        const memberValues = memberRows
            .map((m) => ({
                userId: maps.user.get(Number(m.userId)),
                tenantId,
                role: String(m.role),
                settings: (m.settings as Row | null) ?? {},
                customRoleId: mapId(maps.customRole, m.customRoleId),
            }))
            .filter((m) => m.userId !== undefined);
        if (memberValues.length) await this.insertValues(tx, memberships, memberValues);
        counts.memberships = memberValues.length;

        // C1 — equipos (antes que los registros: el campo «Equipo» guarda sus ids).
        counts.teams = await this.insertMapped(tx, await this.readAll(rows('teams')), teams, maps.team, (t) => ({
            tenantId,
            name: String(t.name).slice(0, 80),
            description: (t.description as string | null) ?? null,
            icon: (t.icon as string | null) ?? null,
            color: (t.color as string | null) ?? null,
            createdBy: mapId(maps.user, t.createdBy),
        }));
        counts.team_members = await this.insertPlain(tx, rows('team_members'), teamMembers, (m) => {
            const teamId = mapId(maps.team, m.teamId);
            const userId = mapId(maps.user, m.userId);
            if (teamId === null || userId === null) return null;
            return { tenantId, teamId, userId, isLead: Boolean(m.isLead) };
        });

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
        // C5 — flujos de aprobación ANTES de la segunda pasada de los campos:
        // la config de un campo «Aprobación» nombra su flujo, y el flujo nombra
        // campos (aprobador por campo Persona, qué poner al aprobar).
        counts.approval_flows = await this.insertMapped(
            tx,
            await this.readAll(rows('approval_flows')),
            approvalFlows,
            maps.approval_flow,
            (a) => ({
                tenantId,
                listId: maps.list.get(Number(a.listId))!,
                name: String(a.name ?? 'Aprobación'),
                description: String(a.description ?? ''),
                config: remapJson((a.config as Row | null) ?? {}, maps) as Row,
                isActive: a.isActive !== false,
                position: Number(a.position ?? 0),
                createdBy: mapId(maps.user, a.createdBy),
            }),
            (a) => maps.list.has(Number(a.listId)),
        );
        for (const f of fieldRows) {
            const newId = maps.field.get(Number(f.id));
            if (newId === undefined) continue;
            let config = remapJson((f.config as Row | null) ?? {}, maps) as Row;
            // Fórmulas (A1): los ids viven DENTRO del texto (`{#12}`).
            if (String(f.type) === 'formula') config = remapFormulaConfig(config, (id) => mapId(maps.field, id)) as Row;
            // C1 — el valor por defecto de un campo «Equipo» son ids de equipo.
            if (String(f.type) === 'team' && config.default_value && typeof config.default_value === 'object') {
                const d = config.default_value as { kind?: unknown; value?: unknown };
                const ids = (Array.isArray(d.value) ? d.value : []).map((v) => mapId(maps.team, v)).filter((v): v is number => v !== null);
                config = { ...config, default_value: ids.length > 0 ? { ...d, value: ids } : null };
            }
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
                    // v0.1.300 — «Modificado por» (0 = el sistema se conserva).
                    updatedBy: Number(r.updatedBy) === 0 ? 0 : mapId(maps.user, r.updatedBy),
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

        // C5 — solicitudes de aprobación (con la COPIA de los pasos re-mapeada)
        // y sus decisiones.
        counts.approval_requests = await this.insertMapped(
            tx,
            await this.readAll(rows('approval_requests')),
            approvalRequests,
            maps.approval_request,
            (q) => ({
                tenantId,
                listId: maps.list.get(Number(q.listId))!,
                recordId: maps.record.get(Number(q.recordId))!,
                flowId: mapId(maps.approval_flow, q.flowId),
                flowName: String(q.flowName ?? 'Aprobación'),
                config: remapJson((q.config as Row | null) ?? {}, maps) as Row,
                status: String(q.status ?? 'cancelled'),
                currentStep: Number(q.currentStep ?? 0) || 0,
                stepStartedAt: this.date(q.stepStartedAt) ?? new Date(),
                note: String(q.note ?? ''),
                source: q.source === 'automation' ? 'automation' : 'user',
                // La automatización que la pidió: el id cambia (no hay FK);
                // queda el nombre para mostrar.
                automationId: null,
                automationName: (q.automationName as string | null) ?? null,
                requestedBy: mapId(maps.user, q.requestedBy),
                requestedAt: this.date(q.requestedAt) ?? new Date(),
                resolvedAt: this.date(q.resolvedAt),
                resolvedBy: mapId(maps.user, q.resolvedBy),
                reason: String(q.reason ?? ''),
                updatedAt: this.date(q.updatedAt) ?? new Date(),
            }),
            (q) => maps.list.has(Number(q.listId)) && maps.record.has(Number(q.recordId)),
        );
        counts.approval_decisions = await this.insertPlain(tx, rows('approval_decisions'), approvalDecisions, (d) => {
            const requestId = mapId(maps.approval_request, d.requestId);
            if (requestId === null) return null;
            return {
                tenantId,
                requestId,
                step: Number(d.step ?? 0) || 0,
                userId: mapId(maps.user, d.userId),
                decision: String(d.decision ?? 'approve'),
                reason: String(d.reason ?? ''),
                createdAt: this.date(d.createdAt) ?? new Date(),
            };
        });

        // C3 — registros compartidos con invitados (la persona tiene que haber viajado).
        counts.record_shares = await this.insertPlain(tx, rows('record_shares'), recordShares, (r) => {
            const listId = mapId(maps.list, r.listId);
            const recordId = mapId(maps.record, r.recordId);
            const userId = mapId(maps.user, r.userId);
            if (listId === null || recordId === null || userId === null) return null;
            const level = ['view', 'comment', 'edit'].includes(String(r.level)) ? String(r.level) : 'view';
            return { tenantId, listId, recordId, userId, level, createdBy: mapId(maps.user, r.createdBy) };
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
                // v0.1.297 — además de los ids de campo, las columnas/carriles por persona del kanban.
                config: remapViewConfig((v.config as Row | null) ?? {}, fieldTypeByOldId, maps) as Row,
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

        // A8 — dependencias (las dos puntas re-mapeadas; una que no viajó se descarta).
        counts.record_dependencies = await this.insertPlain(tx, rows('record_dependencies'), recordDependencies, (d) => {
            const blockerListId = mapId(maps.list, d.blockerListId);
            const blockedListId = mapId(maps.list, d.blockedListId);
            const blockerRecordId = mapId(maps.record, d.blockerRecordId);
            const blockedRecordId = mapId(maps.record, d.blockedRecordId);
            if (blockerListId === null || blockedListId === null || blockerRecordId === null || blockedRecordId === null) return null;
            return {
                tenantId,
                blockerListId,
                blockerRecordId,
                blockedListId,
                blockedRecordId,
                lagDays: Number(d.lagDays ?? 0) || 0,
                createdBy: mapId(maps.user, d.createdBy),
                createdAt: this.date(d.createdAt) ?? new Date(),
            };
        });

        // A9 — checklists (el registro y la lista re-mapeados) y sus ítems
        //      (responsable y quién lo marcó: una persona que no viajó queda vacía).
        const checklistMap = new Map<number, number>();
        counts.record_checklists = await this.insertMapped(
            tx,
            await this.readAll(rows('record_checklists')),
            recordChecklists,
            checklistMap,
            (c) => ({
                tenantId,
                listId: maps.list.get(Number(c.listId))!,
                recordId: maps.record.get(Number(c.recordId))!,
                name: String(c.name ?? 'Checklist').slice(0, 120),
                position: Number(c.position ?? 0) || 0,
                createdBy: mapId(maps.user, c.createdBy),
                createdAt: this.date(c.createdAt) ?? new Date(),
                updatedAt: this.date(c.updatedAt) ?? new Date(),
            }),
            (c) => maps.list.has(Number(c.listId)) && maps.record.has(Number(c.recordId)),
        );
        counts.record_checklist_items = await this.insertPlain(tx, rows('record_checklist_items'), recordChecklistItems, (it) => {
            const checklistId = mapId(checklistMap, it.checklistId);
            const recordId = mapId(maps.record, it.recordId);
            const listId = mapId(maps.list, it.listId);
            if (checklistId === null || recordId === null || listId === null) return null;
            const dueAt = this.date(it.dueAt);
            return {
                tenantId,
                listId,
                recordId,
                checklistId,
                text: String(it.text ?? '').slice(0, 500) || '—',
                done: it.done === true,
                doneBy: mapId(maps.user, it.doneBy),
                doneAt: this.date(it.doneAt),
                assigneeId: mapId(maps.user, it.assigneeId),
                dueDate: dueAt ? null : typeof it.dueDate === 'string' ? it.dueDate.slice(0, 10) : null,
                dueAt,
                position: Number(it.position ?? 0) || 0,
                createdBy: mapId(maps.user, it.createdBy),
                createdAt: this.date(it.createdAt) ?? new Date(),
                updatedAt: this.date(it.updatedAt) ?? new Date(),
            };
        });

        // B1 — líneas base del Gantt: la vista, los campos de inicio/fin y
        // cada registro congelado se re-mapean (las fechas viajan tal cual).
        const baselineMap = new Map<number, number>();
        counts.gantt_baselines = await this.insertMapped(
            tx,
            await this.readAll(rows('gantt_baselines')),
            ganttBaselines,
            baselineMap,
            (b) => ({
                tenantId,
                listId: maps.list.get(Number(b.listId))!,
                viewId: maps.view.get(Number(b.viewId))!,
                name: String(b.name ?? ''),
                startFieldId: maps.field.get(Number(b.startFieldId))!,
                endFieldId: mapId(maps.field, b.endFieldId),
                itemCount: Number(b.itemCount ?? 0) || 0,
                createdBy: mapId(maps.user, b.createdBy),
                createdAt: this.date(b.createdAt) ?? new Date(),
            }),
            (b) => maps.list.has(Number(b.listId)) && maps.view.has(Number(b.viewId)) && maps.field.has(Number(b.startFieldId)),
        );
        counts.gantt_baseline_items = await this.insertPlain(tx, rows('gantt_baseline_items'), ganttBaselineItems, (it) => {
            const baselineId = mapId(baselineMap, it.baselineId);
            const recordId = mapId(maps.record, it.recordId);
            if (baselineId === null || recordId === null) return null;
            return {
                tenantId,
                baselineId,
                recordId,
                startValue: typeof it.startValue === 'string' ? it.startValue : null,
                endValue: typeof it.endValue === 'string' ? it.endValue : null,
            };
        });

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
                    // Lo interno sigue interno al migrar (default del archivo viejo).
                    visibility: c.visibility === 'client' ? 'client' : 'internal',
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

        // v0.1.291 — reacciones (las de una persona que no viajó se descartan:
        // una reacción sin autor no se puede quitar).
        counts.comment_reactions = await this.insertPlain(tx, rows('comment_reactions'), commentReactions, (r) => {
            const commentId = mapId(commentMap, r.commentId);
            const userId = mapId(maps.user, r.userId);
            if (commentId === null || userId === null) return null;
            return {
                tenantId,
                commentId,
                userId,
                emoji: String(r.emoji ?? ''),
                createdAt: this.date(r.createdAt) ?? new Date(),
            };
        });

        // v0.1.291 — registro de tiempo. Un cronómetro que estaba corriendo en
        // el origen llega DETENIDO (con lo que llevaba hasta exportar): en el
        // destino nadie lo inició.
        counts.time_entries = await this.insertPlain(tx, rows('time_entries'), timeEntries, (t) => {
            const listId = mapId(maps.list, t.listId);
            const recordId = mapId(maps.record, t.recordId);
            if (listId === null || recordId === null) return null;
            const startedAt = this.date(t.startedAt);
            const endedAt = this.date(t.endedAt);
            const wasRunning = t.source === 'timer' && endedAt === null;
            const exportedAt = new Date();
            return {
                tenantId,
                listId,
                recordId,
                userId: mapId(maps.user, t.userId),
                source: t.source === 'timer' ? 'timer' : 'manual',
                workDate: String(t.workDate ?? exportedAt.toISOString().slice(0, 10)).slice(0, 10),
                startedAt,
                endedAt: wasRunning ? exportedAt : endedAt,
                seconds:
                    wasRunning && startedAt
                        ? Math.max(0, Math.floor((exportedAt.getTime() - startedAt.getTime()) / 1000))
                        : Math.max(0, Number(t.seconds) || 0),
                note: String(t.note ?? '').slice(0, 500),
                createdAt: this.date(t.createdAt) ?? exportedAt,
                updatedAt: this.date(t.updatedAt) ?? exportedAt,
            };
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
                    diff: remapActivityDiff(String(a.action), (a.diff as Row | null) ?? {}, maps),
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

        // 7b2. C6 — Plantillas de registro y de checklist (antes que los
        //      formularios y las automatizaciones, que las nombran por id). Su
        //      contenido apunta a campos y personas por id: se re-apuntan (una
        //      persona que no viajó se descarta, el ítem queda sin responsable).
        counts.record_templates = await this.insertMapped(
            tx,
            await this.readAll(rows('record_templates')),
            recordTemplates,
            maps.recordTemplate,
            (t) => {
                const content = remapTemplateContent(readTemplateContent(t.content), {
                    field: (id) => maps.field.get(id) ?? null,
                    user: (id) => maps.user.get(id) ?? null,
                });
                if (content.record_description) content.record_description = remapRichDoc(content.record_description, maps);
                return {
                    tenantId,
                    listId: maps.list.get(Number(t.listId))!,
                    kind: t.kind === 'checklist' ? 'checklist' : 'record',
                    name: String(t.name ?? 'Plantilla').slice(0, 120),
                    description: typeof t.description === 'string' ? t.description.slice(0, 500) : null,
                    icon: typeof t.icon === 'string' ? t.icon : null,
                    color: typeof t.color === 'string' ? t.color : null,
                    content: content as unknown as Row,
                    position: Number(t.position ?? 0) || 0,
                    createdBy: mapId(maps.user, t.createdBy),
                    createdAt: this.date(t.createdAt) ?? new Date(),
                    updatedAt: this.date(t.updatedAt) ?? new Date(),
                };
            },
            (t) => maps.list.has(Number(t.listId)),
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

        // 7c-bis. Páginas de agenda (D5), antes que las automatizaciones: el
        //     disparador «Cuando se agenda…» las nombra por id. Igual que un
        //     formulario, la dirección pública es nueva; las citas se traen con
        //     su registro, su persona y el evento de su calendario.
        const bookingRows = await this.readAll(rows('booking_pages'));
        counts.booking_pages = await this.insertMapped(
            tx,
            bookingRows,
            bookingPages,
            maps.bookingPage,
            (b) => ({
                tenantId,
                listId: maps.list.get(Number(b.listId))!,
                name: String(b.name),
                token: randomBytes(18).toString('base64url'),
                enabled: b.enabled === true,
                config: remapJson((b.config as Row | null) ?? {}, maps) as Row,
                bookingsCount: Number(b.bookingsCount ?? 0),
                lastBookedAt: this.date(b.lastBookedAt),
                createdBy: mapId(maps.user, b.createdBy),
            }),
            (b) => maps.list.has(Number(b.listId)),
        );
        counts.booking_appointments = await this.insertPlain(tx, rows('booking_appointments'), bookingAppointments, (a) => {
            const pageId = mapId(maps.bookingPage, a.pageId);
            const listId = mapId(maps.list, a.listId);
            const recordId = mapId(maps.record, a.recordId);
            if (pageId === null || listId === null || recordId === null) return null;
            const status = ['confirmed', 'rescheduled', 'cancelled'].includes(String(a.status)) ? String(a.status) : 'confirmed';
            return {
                tenantId,
                pageId,
                listId,
                recordId,
                staffId: String(a.staffId ?? '').slice(0, 32),
                staffUserId: mapId(maps.user, a.staffUserId),
                serviceId: String(a.serviceId ?? '').slice(0, 32),
                startAt: this.date(a.startAt) ?? new Date(),
                endAt: this.date(a.endAt) ?? new Date(),
                status,
                clientName: (a.clientName as string | null) ?? null,
                clientEmail: (a.clientEmail as string | null) ?? null,
                clientTz: (a.clientTz as string | null) ?? null,
                externalEvent: a.externalEvent ? (remapJson(a.externalEvent as Row, maps) as Row) : null,
                remindersSent: Array.isArray(a.remindersSent) ? a.remindersSent : [],
                cancelledAt: this.date(a.cancelledAt),
                createdAt: this.date(a.createdAt) ?? new Date(),
                updatedAt: this.date(a.updatedAt) ?? new Date(),
            };
        });

        // 7d. Autorización de tratamiento de datos (Ley 1581). Las versiones y
        //     la EVIDENCIA de cada aceptación viajan: son la prueba que la
        //     empresa tiene que conservar. El número de versión se conserva
        //     (`settings.data_consent.current_version` apunta a él) y cada
        //     referencia (formulario, lista, registro, persona) se traduce; la
        //     que no viajó queda en NULL, igual que si se hubiera borrado. El
        //     enlace para retirarla que ya se mandó por correo NO: apunta al
        //     servidor de origen y lleva su firma.
        counts.data_consent_versions = await this.insertPlain(tx, rows('data_consent_versions'), dataConsentVersions, (v) => {
            const version = Number(v.version);
            if (!Number.isInteger(version) || version <= 0) return null;
            return {
                tenantId,
                version,
                text: String(v.text ?? ''),
                checkboxLabel: String(v.checkboxLabel ?? ''),
                policyUrl: (v.policyUrl as string | null) ?? null,
                textHash: String(v.textHash ?? ''),
                createdBy: mapId(maps.user, v.createdBy),
                createdAt: this.date(v.createdAt) ?? new Date(),
            };
        });
        counts.data_consents = await this.insertPlain(tx, rows('data_consents'), dataConsents, (c) => {
            const version = Number(c.version);
            if (!Number.isInteger(version) || version <= 0) return null;
            const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v !== '' ? v.slice(0, max) : null);
            return {
                tenantId,
                version,
                textHash: String(c.textHash ?? ''),
                source: c.source === 'portal' ? 'portal' : c.source === 'booking' ? 'booking' : 'form',
                sourceLabel: String(c.sourceLabel ?? '').slice(0, 300),
                formId: mapId(maps.form, c.formId),
                listId: mapId(maps.list, c.listId),
                recordId: mapId(maps.record, c.recordId),
                userId: mapId(maps.user, c.userId),
                subjectEmail: str(c.subjectEmail, 320),
                subjectName: str(c.subjectName, 300),
                acceptedAt: this.date(c.acceptedAt) ?? new Date(),
                ip: str(c.ip, 64),
                userAgent: str(c.userAgent, 400),
                withdrawRef: null,
                withdrawnAt: this.date(c.withdrawnAt),
                withdrawnVia: str(c.withdrawnVia, 12),
                withdrawnIp: str(c.withdrawnIp, 64),
                withdrawnUserAgent: str(c.withdrawnUserAgent, 400),
                withdrawnBy: mapId(maps.user, c.withdrawnBy),
                withdrawnNote: str(c.withdrawnNote, 500),
                createdAt: this.date(c.createdAt) ?? new Date(),
            };
        });

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

        // Campo «Botón»: su plantilla de PDF y su automatización recién existen
        // ahora (la segunda pasada de los campos las dejó en null).
        for (const f of fieldRows) {
            if (String(f.type) !== 'button') continue;
            const newId = maps.field.get(Number(f.id));
            if (newId === undefined) continue;
            const config = remapButtonConfig((f.config as Row | null) ?? {}, maps, autoMap) as Row;
            await tx.update(fields).set({ config }).where(eq(fields.id, newId));
        }

        counts.automation_runs = await this.streamInsert(rows('automation_runs'), async (batch) => {
            const values = batch
                .filter((r) => autoMap.has(Number(r.automationId)))
                .map((r) => {
                    // v0.1.288 — una corrida EN ESPERA no se migra viva: su
                    // contexto guarda datos y punteros de la instancia de
                    // origen. Llega cancelada, con el motivo.
                    const waiting = String(r.status) === 'waiting' || String(r.status) === 'running';
                    const reason = 'Migrada desde otro servidor: la espera no se conserva.';
                    return {
                        tenantId,
                        automationId: autoMap.get(Number(r.automationId))!,
                        recordId: mapId(maps.record, r.recordId),
                        status: waiting ? 'cancelled' : String(r.status),
                        actionsLog: r.actionsLog ?? [],
                        error: waiting ? reason : ((r.error as string | null) ?? null),
                        startedAt: this.date(r.startedAt),
                        finishedAt: waiting ? new Date() : this.date(r.finishedAt),
                        createdAt: this.date(r.createdAt) ?? new Date(),
                    };
                });
            if (!values.length) return 0;
            await this.insertValues(tx, automationRuns, values);
            return values.length;
        });

        // v0.1.288 — versiones: las mismas traducciones de ids que la automatización.
        counts.automation_versions = await this.insertPlain(tx, rows('automation_versions'), automationVersions, (v) => {
            const automationId = mapId(autoMap, v.automationId);
            if (automationId === null) return null;
            const { triggerConfig, actions } = remapAutomation((v.triggerConfig as Row | null) ?? {}, v.actions ?? [], maps);
            return {
                tenantId,
                automationId,
                name: String(v.name),
                description: (v.description as string | null) ?? null,
                triggerType: String(v.triggerType),
                triggerConfig,
                actions,
                isActive: Boolean(v.isActive),
                authorId: mapId(maps.user, v.authorId),
                note: (v.note as string | null) ?? null,
                createdAt: this.date(v.createdAt) ?? new Date(),
            };
        });

        // v0.1.292 — con mapa (los envíos programados y los enlaces públicos
        // apuntan al tablero). `settings` también se re-mapea: sus filtros de
        // tablero (`filters: [{list_id, field_id}]`) apuntan a campos por id —
        // antes viajaban con los ids del origen.
        const dashboardMap = new Map<number, number>();
        counts.dashboards = await this.insertMapped(tx, await this.readAll(rows('dashboards')), dashboards, dashboardMap, (d) => ({
            tenantId,
            userId: mapId(maps.user, d.userId),
            name: String(d.name),
            description: (d.description as string | null) ?? null,
            widgets: remapJson(d.widgets ?? [], maps),
            settings: remapJson((d.settings as Row | null) ?? {}, maps) as Row,
            isDefault: Boolean(d.isDefault),
            position: Number(d.position ?? 0),
            visibility: String(d.visibility ?? 'workspace'),
            allowedRoles: d.allowedRoles ?? [],
            createdBy: mapId(maps.user, d.createdBy) ?? fallbackUser ?? 0,
        }));

        // Los envíos programados llegan PAUSADOS: si no, el servidor de origen y
        // éste mandarían el mismo resumen mientras dura la mudanza.
        counts.dashboard_subscriptions = await this.insertPlain(tx, rows('dashboard_subscriptions'), dashboardSubscriptions, (s) => {
            const dashboardId = mapId(dashboardMap, s.dashboardId);
            const ownerId = mapId(maps.user, s.ownerId);
            if (dashboardId === null || ownerId === null) return null;
            return {
                tenantId,
                dashboardId,
                ownerId,
                enabled: false,
                frequency: String(s.frequency ?? 'weekly'),
                weekdays: Array.isArray(s.weekdays) ? s.weekdays : [1],
                monthDay: Number(s.monthDay ?? 1),
                hour: Number(s.hour ?? 8),
                minute: Number(s.minute ?? 0),
                timeZone: (s.timeZone as string | null) ?? null,
                recipientUserIds: (Array.isArray(s.recipientUserIds) ? s.recipientUserIds : [])
                    .map((id) => mapId(maps.user, id))
                    .filter((id): id is number => id !== null),
                recipientEmails: Array.isArray(s.recipientEmails) ? s.recipientEmails : [],
                subject: String(s.subject ?? ''),
                message: String(s.message ?? ''),
                attachPdf: Boolean(s.attachPdf),
            };
        });

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

        // v0.1.300 — contadores del ID automático, con el campo nuevo. El trigger ya
        // pudo crear alguno (un registro que llegó sin número): gana el mayor.
        counts.autonumber_counters = await this.streamInsert(rows('autonumber_counters'), async (batch) => {
            let n = 0;
            for (const c of batch) {
                const fieldId = mapId(maps.field, c.fieldId);
                if (fieldId === null) continue;
                await tx.execute(sql`
                    INSERT INTO autonumber_counters (tenant_id, field_id, period, next_value)
                    VALUES (${tenantId}, ${fieldId}, ${Number(c.period ?? 0)}, ${Number(c.nextValue ?? 1)})
                    ON CONFLICT (field_id, period) DO UPDATE SET next_value = GREATEST(autonumber_counters.next_value, EXCLUDED.next_value)`);
                n++;
            }
            return n;
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
                // v0.1.290 — el PDF congelado viaja como un adjunto más (sus
                // bytes ya están en el archivo): se re-mapea su id. Si no
                // viajó, el número queda sin congelar (no apunta a nada ajeno).
                fileId: mapId(maps.attachment, n.fileId),
                frozenAt: this.date(n.frozenAt),
                frozenBy: mapId(maps.user, n.frozenBy),
                voidedAt: this.date(n.voidedAt),
                voidedBy: mapId(maps.user, n.voidedBy),
                voidReason: typeof n.voidReason === 'string' ? n.voidReason : null,
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

        // v0.1.292 — enlaces públicos de tableros: token NUEVO. Quien publicó
        // sigue siendo quien publicó (su acceso decide qué se ve); si esa
        // persona no viajó, el enlace no se recrea.
        let publicDashboardsCount = 0;
        for (const p of await this.readAll(rows('public_dashboards'))) {
            const dashboardId = mapId(dashboardMap, p.dashboardId);
            const publishedBy = mapId(maps.user, p.publishedBy);
            if (dashboardId === null || publishedBy === null) continue;
            await tx.insert(publicDashboards).values({
                token: randomBytes(24).toString('base64url'),
                tenantId,
                dashboardId,
                publishedBy,
                expiresAt: (p.expiresAt as string | null) ?? null,
                allowedDomains: Array.isArray(p.allowedDomains) ? (p.allowedDomains as string[]) : [],
                allowPeriod: Boolean(p.allowPeriod),
            });
            publicDashboardsCount++;
        }
        counts.public_dashboards = publicDashboardsCount;

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
            // registran de nuevo aquí cuando corre (fase 3).
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
        // la marca de la lista lleva ids de sincronización, que se rearma aquí.
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
            warnings.push('La contraseña de la base de datos SQL no viajó (otra clave de cifrado): vuelve a cargarla en Integraciones → SQL Server.');
        }

        if (syncMap.size > 0 && !sameKey) {
            warnings.push(
                'La clave de la tienda no viajó (otra clave de cifrado): vuelve a cargarla en Integraciones → WooCommerce. La sincronización sigue donde estaba, sin duplicar nada.',
            );
        }

        if (!trustCredentials && usersCreated > 0) {
            warnings.push(
                `${usersCreated} cuenta(s) nueva(s) se crearon SIN contraseña: cada persona entra con «¿Olvidaste tu contraseña?» (así se comprueba que el correo es suyo). Para conservar las contraseñas, importa marcando que el archivo viene de un servidor de confianza.`,
            );
        }
        if (publicTokens.size > 0) {
            warnings.push(
                `${publicTokens.size} lista(s) pública(s) tienen un enlace NUEVO: hay que volver a repartirlo.`,
            );
        }
        if (publicDashboardsCount > 0) {
            warnings.push(`${publicDashboardsCount} tablero(s) público(s) tienen un enlace NUEVO: hay que volver a repartirlo (y a insertarlo en los sitios que lo usan).`);
        }
        if ((counts.dashboard_subscriptions ?? 0) > 0) {
            warnings.push(
                `${counts.dashboard_subscriptions} envío(s) programado(s) de tableros llegaron PAUSADOS (para no duplicar correos con el servidor anterior): actívalos en cada tablero → Compartir → Envío por correo.`,
            );
        }
        if ((counts.data_consents ?? 0) > 0) {
            warnings.push(
                `${counts.data_consents} autorización(es) de tratamiento de datos viajaron como evidencia. Los enlaces para retirarlas que ya se mandaron por correo apuntan al servidor anterior: si un titular pide el retiro, regístralo en Ajustes → Datos personales.`,
            );
        }
        if (formRows.length > 0) {
            warnings.push(
                `${formRows.length} formulario(s) tienen una dirección NUEVA: hay que volver a repartirla (y a insertarla en los sitios que lo usan).`,
            );
        }
        if (bookingRows.length > 0) {
            warnings.push(
                `${bookingRows.length} página(s) de agenda tienen una dirección NUEVA: hay que volver a repartirla (y a insertarla en los sitios que la usan). Los enlaces para cambiar o cancelar citas que ya se mandaron por correo apuntan al servidor anterior.`,
            );
        }
        const hooks = autoRows.filter((a) => String(a.triggerType) === 'incoming_webhook').length;
        if (hooks > 0) {
            warnings.push(
                `${hooks} automatización(es) con webhook entrante tienen una URL nueva: actualiza el sistema que las llama.`,
            );
        }
        if (tenantRow.customDomain) {
            warnings.push(
                `El dominio propio «${String(tenantRow.customDomain)}» no viajó: apunta al servidor anterior y hay que configurarlo aquí.`,
            );
        }
        // v0.1.289 — las contraseñas del portal y las respuestas de formularios
        // sin confirmar no viajan: son credenciales/enlaces de ESTE servidor
        // (el correo de confirmación apunta al de origen).
        const portalAuth = (srcSettings.portal_auth ?? null) as { password_enabled?: unknown } | null;
        if (portalAuth?.password_enabled === true) {
            warnings.push(
                'Las contraseñas del portal de clientes no viajaron: cada cliente entra con un enlace por correo y crea una nueva desde su menú.',
            );
        }
        if (tenantRow.portalDomain) {
            warnings.push(
                `El dominio del portal de clientes «${String(tenantRow.portalDomain)}» no viajó: apunta al servidor anterior y hay que configurarlo aquí.`,
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
                'Cobros (Mercado Pago / Wompi): la conexión viajó, pero el historial de links de pago no — y la URL de avisos es nueva. En Wompi pega la nueva en Desarrolladores → «URL de Eventos» (la ves en Integraciones → Cobros).',
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
    private async byTenant(table: TenantTable, tenantId: number, extra?: SQL): Promise<Row[]> {
        const rows = await this.db.select().from(table).where(and(eq(table.tenantId, tenantId), extra));
        return rows as Row[];
    }

    /** Vuelca una tabla grande por páginas keyset, sin cargarla en memoria. */
    private async dumpPaged(
        work: string,
        name: string,
        table: KeyedTable,
        tenantId: number,
        extra?: SQL,
    ): Promise<number> {
        const out = createWriteStream(path.join(work, 'rows', `${name}.ndjson`));
        let cursor = 0;
        let total = 0;
        try {
            for (;;) {
                const page = (await this.db
                    .select()
                    .from(table)
                    .where(and(eq(table.tenantId, tenantId), gt(table.id, cursor), extra))
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
        // `id` es `bigint`: sin el parser de la columna (que aquí no se puede
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

    /** Quita del `settings` de la empresa lo que no se puede descifrar aquí. */
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
        // v0.1.289 — las llaves de captcha de la empresa: sin su secreto no
        // verifican nada; se sacan y sus formularios usan las de la plataforma.
        const captcha = out.captcha;
        if (captcha !== null && typeof captcha === 'object' && isEncrypted(String((captcha as { secret_enc?: string }).secret_enc ?? ''))) {
            delete out.captcha;
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

// ── Papelera: lo borrado no viaja ────────────────────────────────────────
// Condiciones "lo que cuelga de algo VIVO" para el export (conexión base, sin
// RLS). Un id nulo (columna opcional) no excluye la fila.

function liveList(col: PgColumn): SQL {
    return sql`NOT EXISTS (SELECT 1 FROM lists x WHERE x.id = ${col} AND x.deleted_at IS NOT NULL)`;
}

function liveRecord(col: PgColumn): SQL {
    return sql`NOT EXISTS (SELECT 1 FROM records x WHERE x.id = ${col} AND x.deleted_at IS NOT NULL)`;
}

function liveField(col: PgColumn): SQL {
    return sql`NOT EXISTS (SELECT 1 FROM fields x WHERE x.id = ${col} AND x.deleted_at IS NOT NULL)`;
}

function liveAutomation(col: PgColumn): SQL {
    return sql`NOT EXISTS (SELECT 1 FROM automations x WHERE x.id = ${col} AND x.deleted_at IS NOT NULL)`;
}

function liveView(col: PgColumn): SQL {
    return sql`NOT EXISTS (SELECT 1 FROM saved_views x WHERE x.id = ${col} AND x.deleted_at IS NOT NULL)`;
}

/**
 * El diff de una entrada de actividad. Los cambios de campos tienen claves
 * `f{field_id}` (se traducen sólo las claves); una dependencia (A8) guarda
 * `{dependency: {kind, record_id, title}}`: el registro del otro lado se
 * re-mapea (o queda en null si no viajó).
 */
function remapActivityDiff(action: string, diff: Row, maps: IdMaps): Row {
    if (action === 'dependency_added' || action === 'dependency_removed') {
        const dep = (diff.dependency ?? null) as Row | null;
        if (!dep || typeof dep !== 'object') return diff;
        return { ...diff, dependency: { ...dep, record_id: mapId(maps.record, dep.record_id) } };
    }
    // C5 — la actividad de una aprobación nombra la solicitud por id.
    if (action === 'approval') {
        const ap = (diff.approval ?? null) as Row | null;
        if (!ap || typeof ap !== 'object') return diff;
        return { ...diff, approval: { ...ap, request_id: mapId(maps.approval_request, ap.request_id) } };
    }
    return remapRecordData(diff, new Map(), maps);
}

function liveDashboard(col: PgColumn): SQL {
    return sql`NOT EXISTS (SELECT 1 FROM dashboards x WHERE x.id = ${col} AND x.deleted_at IS NOT NULL)`;
}
