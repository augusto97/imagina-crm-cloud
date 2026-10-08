import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
    BadRequestException,
    ForbiddenException,
    Inject,
    Injectable,
    NotFoundException,
    Optional,
    ServiceUnavailableException,
} from '@nestjs/common';
import { roleHasCapability, type Role } from '@imagina-base/shared';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { attachments, dashboards, fields, lists, records } from '../db/schema';
import type { Tx } from '../db/client';
import { effectivePermissions, resolvePermissions, scopeWhere } from '../lists/list-acl';
import { TenantDb } from '../tenancy/tenant-db.service';
import {
    FILE_STORAGE,
    TENANT_STORAGE,
    storeBytes,
    type FileStorage,
    type PresignableStorage,
    type TenantStorageResolver,
} from './file-storage';
import { describeS3Error } from './s3-file-storage';
import { safeDisposition, contentDispositionHeader } from './safe-content-type';

export interface AttachmentDto {
    id: number;
    /** URL de descarga servida por el API (auth + tenant check). */
    url: string;
    thumb_url?: string;
    title: string;
    mime_type: string;
    size_bytes: number;
    created_at: string;
    /**
     * v0.1.268 (ADR-S36) — quedó en el almacenamiento propio de la empresa:
     * no cuenta para el límite del plan.
     */
    external?: boolean;
}

/** Lo que devuelve abrir un archivo: los bytes, o un enlace directo al bucket. */
export type OpenedFile =
    | { kind: 'stream'; stream: Readable; filename: string; mime: string; size: number }
    | { kind: 'redirect'; url: string; filename: string; mime: string; size: number };

/** Dónde está guardado un archivo (para leerlo desde otro módulo). */
export interface StoredFileRef {
    storageKey: string;
    storageConnectionId: number | null;
}

/** El enlace directo al bucket dura poco: la URL propia es la que se comparte. */
const PRESIGN_TTL = 15 * 60;
/** Archivos por tanda al mover entre almacenamientos. */
const MOVE_BATCH = 20;

const MAX_BATCH = 100;

/** Quién pide un archivo (SEC-25). Sin actor = uso interno (sin recorte). */
export interface FileActor {
    userId: number;
    role: Role;
}

/**
 * SEC-25 (v0.1.226) — qué adjuntos puede ver alguien. Los ids son
 * secuenciales: sin esto, un agente que sólo ve SUS registros bajaba todos
 * los archivos de la empresa probando `/files/1`, `/files/2`… Quien ve todos
 * los registros (`view_records`) ve todos los archivos.
 *
 * v0.1.253 — el resto (el agente) sigue el ACL de CADA LISTA, no su rol
 * global: antes sólo veía lo que subió y lo de registros que CREÓ, así que si
 * el admin le daba "Colaborar" en una lista (o le asignaba un registro), veía
 * el registro pero sus archivos daban 404. Ahora ve lo que subió, lo que cuelga
 * de un registro que alcanza en esa lista (campo de archivo no oculto para él,
 * o un bloque de la descripción), las imágenes del diseño de esas listas y las
 * de los tableros que puede abrir.
 */
async function readableBy(
    tx: Tx,
    tenantId: number,
    actor: FileActor | undefined,
): Promise<SQL | undefined> {
    if (!actor || roleHasCapability(actor.role, 'view_records')) return undefined;
    const vars = sql`jsonb_build_object('x', ${attachments.id})`;
    const listRows = await tx
        .select({ id: lists.id, settings: lists.settings })
        .from(lists)
        .where(eq(lists.tenantId, tenantId));
    const fileFields = await tx
        .select({ id: fields.id, listId: fields.listId, slug: fields.slug })
        .from(fields)
        .where(and(eq(fields.tenantId, tenantId), eq(fields.type, 'file')));

    const perList: SQL[] = [];
    const visibleLists: number[] = [];
    for (const l of listRows) {
        const settings = (l.settings ?? {}) as Record<string, unknown>;
        const perms = effectivePermissions(settings, actor.role, actor.userId);
        if (perms.view === 'none') continue;
        visibleLists.push(l.id);
        const hidden = new Set(perms.fields_hidden);
        const refs: SQL[] = fileFields
            .filter((f) => f.listId === l.id && !hidden.has(f.slug))
            .map((f) => sql`jsonb_path_exists(${records.data} -> ${`f${f.id}`}, 'lax $[*] ? (@ == $x)', ${vars}, true)`);
        refs.push(sql`jsonb_path_exists(coalesce(${records.description}, 'null'::jsonb), 'lax $.**.fileId ? (@ == $x)', ${vars}, true)`);
        const assignmentId = resolvePermissions(settings).assignment_field_id;
        const scope = scopeWhere(perms.view, actor.userId, assignmentId ? `f${assignmentId}` : null);
        perList.push(and(eq(records.listId, l.id), scope, or(...refs))!);
    }

    const conds: SQL[] = [sql`${attachments.createdBy} = ${actor.userId}`];
    if (perList.length > 0) {
        conds.push(sql`EXISTS (
            SELECT 1 FROM ${records}
            WHERE ${records.tenantId} = ${tenantId} AND ${records.deletedAt} IS NULL AND (${or(...perList)})
        )`);
    }
    if (visibleLists.length > 0) {
        // Imágenes y galerías del diseño de la ficha (record_layout_v3 y
        // compañía): viven en `settings` con `file_id` / `image_file_id`.
        conds.push(sql`EXISTS (
            SELECT 1 FROM ${lists}
            WHERE ${lists.tenantId} = ${tenantId} AND ${inArray(lists.id, visibleLists)}
              AND (jsonb_path_exists(${lists.settings}, 'lax $.**.file_id ? (@ == $x)', ${vars}, true)
                OR jsonb_path_exists(${lists.settings}, 'lax $.**.image_file_id ? (@ == $x)', ${vars}, true))
        )`);
    }
    // Bloques de imagen de los tableros que puede abrir (misma regla que el
    // listado de tableros: del workspace, privados suyos o de su rol).
    conds.push(sql`EXISTS (
        SELECT 1 FROM ${dashboards}
        WHERE ${dashboards.tenantId} = ${tenantId}
          AND (${dashboards.visibility} = 'workspace'
            OR (${dashboards.visibility} = 'private' AND ${dashboards.createdBy} = ${actor.userId})
            OR (${dashboards.visibility} = 'roles' AND ${dashboards.allowedRoles} ? ${actor.role}))
          AND (jsonb_path_exists(${dashboards.widgets}, 'lax $.**.file_id ? (@ == $x)', ${vars}, true)
            OR jsonb_path_exists(${dashboards.widgets}, 'lax $.**.image_file_id ? (@ == $x)', ${vars}, true))
    )`);
    return or(...conds);
}

/**
 * Archivos propios (ADR-S16). Metadata en `attachments` (RLS); bytes detrás
 * de `FileStorage`. El valor de un campo `file` es el ID del attachment.
 */
/** Imágenes que pueden ir en un correo (se sirven inline, no ejecutan nada). */
const EMAIL_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);
/** 5 años: un correo se relee mucho después de enviado. */
const EMAIL_IMAGE_TTL = 5 * 365 * 24 * 3600;

@Injectable()
export class FilesService {
    private readonly signingSecret: string;
    private readonly publicBase: string;

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(FILE_STORAGE) private readonly storage: FileStorage,
        @Inject(ENV) env: Env,
        // v0.1.268 (ADR-S36) — lo provee el módulo de conectores (@Global).
        // Opcional: los specs que arman el service a mano no lo necesitan.
        @Optional() @Inject(TENANT_STORAGE) private readonly tenantStorage?: TenantStorageResolver,
    ) {
        // Vacío = secreto efímero por proceso (las URLs firmadas mueren al
        // reiniciar). En producción se fija FILES_SIGNING_SECRET.
        this.signingSecret = env.FILES_SIGNING_SECRET || randomBytes(32).toString('hex');
        this.publicBase = (env.APP_BASE_URL ?? '').replace(/\/+$/, '');
    }

    // --- URLs firmadas (portal del cliente — ADR-S16) -----------------------
    // El rol client no tiene capabilities de records, así que la descarga va
    // por una URL de vida corta firmada con HMAC: quien tiene el link accede
    // a ESE archivo hasta el vencimiento, sin sesión.

    /** URL relativa firmada, válida por `ttlSeconds`. */
    signedUrl(tenantId: number, id: number, ttlSeconds = 3600): string {
        // v0.1.252 — el vencimiento se redondea a la HORA siguiente: así la
        // misma URL sirve durante esa hora y el navegador la cachea (antes
        // cada consulta daba otra URL y las imágenes se bajaban de nuevo).
        // Nunca vence ANTES de lo pedido.
        const now = Math.floor(Date.now() / 1000);
        const exp = Math.ceil((now + Math.max(60, ttlSeconds)) / 3600) * 3600;
        const sig = this.sign(tenantId, id, exp);
        return `/api/v1/files/${id}/signed?tenant=${tenantId}&exp=${exp}&sig=${sig}`;
    }

    /**
     * v0.1.265 (ADR-S34) — URL PÚBLICA y de vida larga para una imagen que va
     * dentro de un correo o de una firma. Un correo queda años en la bandeja:
     * una URL de horas se rompería. Sólo imágenes que se sirven inline sin
     * ejecutar nada (png/jpeg/gif/webp — nada de SVG) y que quien pide puede
     * ver. Absoluta con el dominio de la PLATAFORMA (el de una empresa puede
     * cambiar o desaparecer y la imagen quedaría rota en todos los correos).
     */
    async publicImageUrl(tenantId: number, id: number, actor?: FileActor): Promise<string> {
        const [row] = await this.tenantDb.withTenant(tenantId, async (tx) =>
            tx
                .select({ id: attachments.id, mime: attachments.mime })
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), eq(attachments.id, id), await readableBy(tx, tenantId, actor)))
                .limit(1),
        );
        if (!row) throw fileNotFound(id);
        if (!EMAIL_IMAGE_MIMES.has(row.mime.toLowerCase())) {
            throw new BadRequestException({
                code: 'not_an_image',
                message: 'Para un correo sólo sirven imágenes PNG, JPG, GIF o WebP.',
                data: { status: 400 },
            });
        }
        return `${this.publicBase}${this.signedUrl(tenantId, id, EMAIL_IMAGE_TTL)}`;
    }

    /**
     * v0.1.266 — URL firmada ABSOLUTA (con el dominio de la plataforma) de un
     * archivo cualquiera: el enlace a un PDF generado que una automatización
     * manda por WhatsApp (`{{pdf.link}}`). Sin `APP_BASE_URL` queda relativa.
     */
    absoluteSignedUrl(tenantId: number, id: number, ttlSeconds: number): string {
        return `${this.publicBase}${this.signedUrl(tenantId, id, ttlSeconds)}`;
    }

    /** Valida tenant/exp/sig y abre el stream (para la ruta pública). */
    async openSigned(
        id: number,
        tenantId: number,
        exp: number,
        sig: string,
    ): Promise<OpenedFile> {
        const now = Math.floor(Date.now() / 1000);
        const expected = this.sign(tenantId, id, exp);
        const a = Buffer.from(sig, 'utf8');
        const b = Buffer.from(expected, 'utf8');
        if (exp < now || a.length !== b.length || !timingSafeEqual(a, b)) {
            throw fileNotFound(id); // 404 opaco: no filtramos si existe.
        }
        return this.openDownload(tenantId, id);
    }

    private sign(tenantId: number, id: number, exp: number): string {
        return createHmac('sha256', this.signingSecret)
            .update(`${tenantId}.${id}.${exp}`)
            .digest('hex');
    }

    /**
     * v0.1.268 — firma genérica con el MISMO secreto, para otros enlaces sin
     * sesión (el PDF que se arma al abrirlo). El `scope` separa los usos: una
     * firma de un documento nunca vale como la de un archivo.
     */
    signParts(scope: string, ...parts: Array<string | number>): string {
        return createHmac('sha256', this.signingSecret).update([scope, ...parts].join('.')).digest('hex');
    }

    verifyParts(sig: string, scope: string, ...parts: Array<string | number>): boolean {
        const a = Buffer.from(sig, 'utf8');
        const b = Buffer.from(this.signParts(scope, ...parts), 'utf8');
        return a.length === b.length && timingSafeEqual(a, b);
    }

    /** El dominio de la plataforma (sin barra final); vacío si no está configurado. */
    get baseUrl(): string {
        return this.publicBase;
    }

    // --- Dónde se guardan los bytes (v0.1.268, ADR-S36) ---------------------

    /** El storage de un archivo ya guardado: la plataforma o la conexión donde quedó. */
    private async storageOf(tenantId: number, connectionId: number | null): Promise<PresignableStorage> {
        if (connectionId === null || connectionId === undefined) return this.storage;
        if (!this.tenantStorage) throw storageUnavailable('El almacenamiento propio no está disponible en este servidor.');
        try {
            return await this.tenantStorage.forConnection(tenantId, connectionId);
        } catch (err) {
            throw storageUnavailable(err instanceof Error ? err.message : String(err));
        }
    }

    /**
     * Dónde va lo que se sube ahora. Con un almacenamiento propio elegido que
     * no se puede usar, FALLA con el motivo: subirlo en silencio al servidor
     * de la plataforma se comería el cupo del plan sin que nadie lo sepa.
     */
    async uploadTarget(tenantId: number): Promise<{ connectionId: number | null; storage: PresignableStorage }> {
        if (!this.tenantStorage) return { connectionId: null, storage: this.storage };
        let active;
        try {
            active = await this.tenantStorage.active(tenantId);
        } catch (err) {
            throw storageUnavailable(err instanceof Error ? err.message : String(err));
        }
        return active ? { connectionId: active.connectionId, storage: active.storage } : { connectionId: null, storage: this.storage };
    }

    /** ¿Lo próximo que se suba va a un almacenamiento propio? (no cuenta para el plan). */
    async uploadsExternally(tenantId: number): Promise<boolean> {
        if (!this.tenantStorage) return false;
        return (await this.tenantStorage.choice(tenantId)) !== null;
    }

    /** Los bytes de un archivo, esté donde esté (lecturas internas: PDF, exportar empresa). */
    async readStream(tenantId: number, ref: StoredFileRef): Promise<Readable> {
        const storage = await this.storageOf(tenantId, ref.storageConnectionId);
        return storage.read(ref.storageKey) as Readable;
    }

    /** Sube un archivo: bytes al storage + metadata en el mismo flujo. */
    async upload(
        tenantId: number,
        userId: number,
        filename: string,
        mime: string,
        source: Readable,
    ): Promise<AttachmentDto> {
        const clean = sanitizeFilename(filename);
        if (clean === '') {
            throw new BadRequestException({
                code: 'invalid_filename',
                message: 'Nombre de archivo inválido',
                data: { status: 400 },
            });
        }
        // Clave opaca por tenant — el nombre humano vive solo en la metadata.
        const ext = extOf(clean);
        const key = `t${tenantId}/${randomBytes(16).toString('hex')}${ext}`;
        const target = await this.uploadTarget(tenantId);
        let size: number;
        let storedKey = key;
        try {
            ({ size, key: storedKey } = await storeBytes(target.storage, key, source, clean));
        } catch (err) {
            if (target.connectionId === null) throw err;
            throw storageUnavailable(`No se pudo guardar el archivo en el almacenamiento de la empresa: ${describeStorageError(err)}`);
        }

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [inserted] = await tx
                .insert(attachments)
                .values({
                    tenantId,
                    filename: clean,
                    mime: mime || 'application/octet-stream',
                    sizeBytes: size,
                    storageKey: storedKey,
                    storageConnectionId: target.connectionId,
                    // v0.1.266 — 0 = el sistema (un PDF de una automatización): sin autor.
                    createdBy: userId > 0 ? userId : null,
                })
                .returning();
            return inserted!;
        }).catch(async (err: unknown) => {
            // Sin metadata los bytes quedarían huérfanos en el bucket.
            await target.storage.delete(storedKey).catch(() => undefined);
            throw err;
        });
        return toDto(row, this.signedUrl(tenantId, row.id, 4 * 3600));
    }

    /** Resuelve un batch de IDs (para tarjetas/galerías — 1 request). */
    async resolve(tenantId: number, ids: number[], actor?: FileActor): Promise<AttachmentDto[]> {
        const unique = Array.from(new Set(ids.filter((n) => Number.isInteger(n) && n > 0))).slice(
            0,
            MAX_BATCH,
        );
        if (unique.length === 0) return [];
        const rows = await this.tenantDb.withTenant(tenantId, async (tx) =>
            tx
                .select()
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), inArray(attachments.id, unique), await readableBy(tx, tenantId, actor)))
                .orderBy(desc(attachments.id)),
        );
        // v0.1.252 — URL FIRMADA: la descarga con sesión exige el header
        // X-Tenant-Id, que un <a href> o un <img> nunca mandan (el enlace de
        // un archivo en la tabla/ficha daba 400). La lectura ya pasó el ACL.
        return rows.map((r) => toDto(r, this.signedUrl(tenantId, r.id, 4 * 3600)));
    }

    /** Stream de descarga. 404 si no existe EN ESTE tenant (RLS + explícito). */
    async openDownload(
        tenantId: number,
        id: number,
        actor?: FileActor,
    ): Promise<OpenedFile> {
        const [row] = await this.tenantDb.withTenant(tenantId, async (tx) =>
            tx
                .select()
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), eq(attachments.id, id), await readableBy(tx, tenantId, actor)))
                .limit(1),
        );
        if (!row) throw fileNotFound(id);
        const meta = { filename: row.filename, mime: row.mime, size: row.sizeBytes };
        const storage = await this.storageOf(tenantId, row.storageConnectionId);
        // v0.1.268 — en el bucket de la empresa el archivo sale DIRECTO de ahí
        // con un enlace de pocos minutos: ni disco ni ancho de banda del
        // servidor. Mismo tipo y disposición que si lo sirviera el API.
        if (row.storageConnectionId !== null && storage.presignedGet) {
            const { contentType, disposition } = safeDisposition(row.mime);
            const url = await storage.presignedGet(row.storageKey, {
                ttlSeconds: PRESIGN_TTL,
                contentType,
                contentDisposition: contentDispositionHeader(disposition, row.filename),
            });
            return { kind: 'redirect', url, ...meta };
        }
        // Bytes perdidos (ej. uploads huérfanos de un release viejo,
        // pre-fix de shared/uploads): 404 rápido — dejar que el stream
        // falle a mitad de respuesta colgaba la request hasta el 504
        // del proxy (el logo "roto" que nunca cargaba).
        if (storage.probe && !(await storage.probe(row.storageKey))) {
            throw fileNotFound(id);
        }
        return { kind: 'stream', stream: storage.read(row.storageKey) as Readable, ...meta };
    }

    async remove(tenantId: number, id: number, actor?: FileActor): Promise<void> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [found] = await tx
                .select()
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), eq(attachments.id, id), await readableBy(tx, tenantId, actor)))
                .limit(1);
            if (!found) return null;
            // SEC-25: borrar un archivo es irreversible (se van los bytes). Lo
            // borra quien lo subió o quien puede editar TODOS los registros —
            // antes un agente con "sólo lo suyo" borraba adjuntos ajenos y el
            // logo de la empresa recorriendo ids.
            if (actor && found.createdBy !== actor.userId && !roleHasCapability(actor.role, 'edit_records')) {
                throw new ForbiddenException({
                    code: 'file_not_yours',
                    message: 'Sólo quien subió el archivo (o quien edita todos los registros) puede borrarlo',
                    data: { status: 403 },
                });
            }
            await tx.delete(attachments).where(eq(attachments.id, found.id));
            return found;
        });
        if (!row) throw fileNotFound(id);
        // Bytes después del commit de la metadata (best-effort).
        try {
            const storage = await this.storageOf(tenantId, row.storageConnectionId);
            await storage.delete(row.storageKey);
        } catch {
            // Un bucket caído no impide borrar el archivo de la app.
        }
    }

    // --- Almacenamiento de la empresa: estado y mudanza (ADR-S36) -----------

    /** Archivos y bytes por lugar: `null` = el servidor de la plataforma. */
    async usageByLocation(tenantId: number): Promise<Map<number | null, { files: number; bytes: number }>> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    conn: attachments.storageConnectionId,
                    files: sql<number>`count(*)::int`,
                    bytes: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)::bigint`,
                })
                .from(attachments)
                .where(eq(attachments.tenantId, tenantId))
                .groupBy(attachments.storageConnectionId),
        );
        return new Map(rows.map((r) => [r.conn, { files: Number(r.files), bytes: Number(r.bytes) }]));
    }

    /**
     * Una TANDA de la mudanza: a la conexión elegida (todo lo que no esté ahí)
     * o de vuelta a la plataforma (todo lo que esté afuera). Por archivo: leer
     * del origen → escribir en el destino → cambiar la fila (condicional: si
     * otro proceso ya lo movió, no se pisa) → borrar del origen. Un archivo
     * que falla queda donde estaba y se informa; la interfaz llama tanda tras
     * tanda hasta `remaining` 0 o una tanda sin avances.
     *
     * `roomBytes`: lo que todavía entra en el plan (sólo al volver a la
     * plataforma; null = ilimitado).
     */
    async moveBatch(
        tenantId: number,
        to: 'connection' | 'platform',
        roomBytes: number | null,
    ): Promise<{ moved: number; bytes: number; failed: Array<{ id: number; name: string; error: string }>; remaining: number }> {
        let destId: number | null = null;
        let dest: PresignableStorage = this.storage;
        if (to === 'connection') {
            const active = await this.uploadTarget(tenantId);
            if (active.connectionId === null) {
                throw new BadRequestException({
                    code: 'storage_not_chosen',
                    message: 'Primero elegí dónde guardar los archivos.',
                    data: { status: 400 },
                });
            }
            destId = active.connectionId;
            dest = active.storage;
        }
        const pending = (): SQL =>
            destId === null
                ? isNotNull(attachments.storageConnectionId)
                : or(isNull(attachments.storageConnectionId), ne(attachments.storageConnectionId, destId))!;
        const batch = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), pending()))
                .orderBy(asc(attachments.id))
                .limit(MOVE_BATCH),
        );
        let moved = 0;
        let bytes = 0;
        let room = roomBytes;
        const failed: Array<{ id: number; name: string; error: string }> = [];
        for (const row of batch) {
            if (room !== null && row.sizeBytes > room) {
                failed.push({
                    id: row.id,
                    name: row.filename,
                    error: 'No entra en el espacio de tu plan en el servidor.',
                });
                continue;
            }
            try {
                const source = await this.storageOf(tenantId, row.storageConnectionId);
                if (source.probe && !(await source.probe(row.storageKey))) {
                    throw new Error('El archivo ya no estaba donde se guardó.');
                }
                // La clave original viaja como nombre: en un bucket queda
                // igual; Google Drive devuelve su propio id.
                const baseKey = row.storageKey.startsWith('gdrive:') ? `t${tenantId}/${row.id}${extOf(row.filename)}` : row.storageKey;
                const stored = await storeBytes(dest, baseKey, source.read(row.storageKey) as Readable, row.filename);
                const updated = await this.tenantDb.withTenant(tenantId, (tx) =>
                    tx
                        .update(attachments)
                        .set({ storageConnectionId: destId, storageKey: stored.key })
                        .where(
                            and(
                                eq(attachments.tenantId, tenantId),
                                eq(attachments.id, row.id),
                                row.storageConnectionId === null
                                    ? isNull(attachments.storageConnectionId)
                                    : eq(attachments.storageConnectionId, row.storageConnectionId),
                            ),
                        )
                        .returning({ id: attachments.id }),
                );
                if (updated.length === 0) {
                    // Ya lo movió otro: se descarta la copia recién escrita.
                    if (stored.key !== row.storageKey || destId !== row.storageConnectionId) {
                        await dest.delete(stored.key).catch(() => undefined);
                    }
                    continue;
                }
                await source.delete(row.storageKey).catch(() => undefined);
                moved += 1;
                bytes += row.sizeBytes;
                if (room !== null) room -= row.sizeBytes;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                failed.push({ id: row.id, name: row.filename, error: /S3|bucket|Access|Signature|ENOTFOUND|ECONN/i.test(msg) ? describeStorageError(err) : msg });
            }
        }
        const [left] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ n: sql<number>`count(*)::int` })
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), pending())),
        );
        return { moved, bytes, failed, remaining: Number(left?.n ?? 0) };
    }
}

/** Los errores del driver de Drive ya vienen legibles; los de S3 se traducen. */
function describeStorageError(err: unknown): string {
    if (err instanceof Error && err.name === 'DriveStorageError') return err.message;
    return describeS3Error(err);
}

function storageUnavailable(reason: string): ServiceUnavailableException {
    return new ServiceUnavailableException({
        code: 'storage_unavailable',
        message: reason,
        data: { status: 503 },
    });
}

function toDto(row: typeof attachments.$inferSelect, url: string): AttachmentDto {
    return {
        id: row.id,
        url,
        title: row.filename,
        mime_type: row.mime,
        size_bytes: row.sizeBytes,
        created_at: row.createdAt.toISOString(),
        external: row.storageConnectionId !== null,
    };
}

/** Solo el basename, sin caracteres de control ni separadores de path. */
function sanitizeFilename(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? '';
    // eslint-disable-next-line no-control-regex
    return base.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200);
}

function extOf(name: string): string {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return '';
    const ext = name.slice(dot).toLowerCase();
    return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

function fileNotFound(id: number): NotFoundException {
    return new NotFoundException({
        code: 'file_not_found',
        message: `Archivo ${id} no encontrado`,
        data: { status: 404 },
    });
}
