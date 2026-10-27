import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
    WHATS_NEW_CATALOG,
    WHATS_NEW_IMAGE_NAME_RE,
    WHATS_NEW_IMAGE_PATH,
    type CreateWhatsNewInput,
    type PlatformWhatsNewEntry,
    type PlatformWhatsNewList,
    type UpdateWhatsNewInput,
    type WhatsNewAction,
    type WhatsNewAudienceRole,
    type WhatsNewKind,
    type WhatsNewStatus,
} from '@imagina-base/shared';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DRIZZLE, type Db } from '../db/client';
import { memberships, users, whatsNewEntries, whatsNewViews, type WhatsNewEntryRow } from '../db/schema';
import { FILE_STORAGE, type FileStorage } from '../files/file-storage';
import { parseCatalog } from './catalog-sync';
import { sniffImage } from './image-sniff';

/** Tope de una imagen de novedad (una captura o una ilustración). */
export const MAX_WHATS_NEW_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_KEY_PREFIX = 'platform/whats-new/';

const notFound = (): NotFoundException =>
    new NotFoundException({ code: 'whats_new_not_found', message: 'Esa novedad no existe', data: { status: 404 } });
const bad = (code: string, message: string): BadRequestException =>
    new BadRequestException({ code, message, data: { status: 400 } });

/** El nombre del archivo de una imagen subida, si la URL es nuestra. */
export function ownImageName(url: string | null | undefined): string | null {
    if (!url || !url.startsWith(WHATS_NEW_IMAGE_PATH)) return null;
    const name = url.slice(WHATS_NEW_IMAGE_PATH.length);
    return WHATS_NEW_IMAGE_NAME_RE.test(name) ? name : null;
}

/**
 * Plataforma → Novedades: lo que hace el operador. Todo por la conexión base
 * (tabla global; las estadísticas cuentan lo de todas las personas). La
 * autoría queda en la propia novedad (`created_by` / `updated_by`) y en el log
 * del servidor: la consola no tiene bitácora propia para la configuración de
 * plataforma (planes, correo, IA), y ésta sigue el mismo criterio.
 */
@Injectable()
export class WhatsNewAdminService {
    private readonly logger = new Logger('WhatsNew');

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    ) {}

    private catalogByKey(now = new Date()) {
        return new Map(parseCatalog(WHATS_NEW_CATALOG, now).entries.map((e) => [e.key, e]));
    }

    async list(): Promise<PlatformWhatsNewList> {
        const creator = alias(users, 'creator');
        const editor = alias(users, 'editor');
        const rows = await this.db
            .select({ entry: whatsNewEntries, creatorName: creator.name, editorName: editor.name })
            .from(whatsNewEntries)
            .leftJoin(creator, eq(creator.id, whatsNewEntries.createdBy))
            .leftJoin(editor, eq(editor.id, whatsNewEntries.updatedBy))
            .orderBy(sql`${whatsNewEntries.publishedAt} DESC NULLS FIRST`, desc(whatsNewEntries.id));
        const stats = await this.db
            .select({
                entryId: whatsNewViews.entryId,
                seen: sql<number>`count(${whatsNewViews.seenAt})::int`,
                opened: sql<number>`count(${whatsNewViews.openedAt})::int`,
                clicked: sql<number>`count(${whatsNewViews.clickedAt})::int`,
                dismissed: sql<number>`count(${whatsNewViews.dismissedAt})::int`,
            })
            .from(whatsNewViews)
            .groupBy(whatsNewViews.entryId);
        const byEntry = new Map(stats.map((s) => [s.entryId, s]));
        const [people] = await this.db
            .select({ n: sql<number>`count(DISTINCT ${memberships.userId})::int` })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(ne(memberships.role, 'client'), sql`${users.disabledAt} IS NULL`));
        const catalog = this.catalogByKey();
        return {
            items: rows.map((r) => this.toDto(r.entry, byEntry.get(r.entry.id), r.creatorName, r.editorName, catalog.has(r.entry.key))),
            people: people?.n ?? 0,
        };
    }

    private async one(id: number): Promise<PlatformWhatsNewEntry> {
        const all = await this.list();
        const found = all.items.find((i) => i.id === id);
        if (!found) throw notFound();
        return found;
    }

    private toDto(
        r: WhatsNewEntryRow,
        s: { seen: number; opened: number; clicked: number; dismissed: number } | undefined,
        creatorName: string | null,
        editorName: string | null,
        inCatalog: boolean,
    ): PlatformWhatsNewEntry {
        return {
            id: r.id,
            key: r.key,
            origin: r.origin === 'release' ? 'release' : 'operator',
            status: r.status as WhatsNewStatus,
            kind: r.kind as WhatsNewKind,
            title: r.title,
            summary: r.summary,
            body: r.body,
            image_url: r.imageUrl,
            video_url: r.videoUrl,
            action: (r.action as WhatsNewAction | null) ?? null,
            version: r.version,
            featured: r.featured,
            audience: { roles: r.audienceRoles as WhatsNewAudienceRole[], plans: r.audiencePlans },
            published_at: r.publishedAt ? r.publishedAt.toISOString() : null,
            announce_from: r.announceFrom ? r.announceFrom.toISOString() : null,
            expires_at: r.expiresAt ? r.expiresAt.toISOString() : null,
            edited: r.edited,
            in_catalog: r.origin === 'release' && inCatalog,
            created_by_name: creatorName,
            updated_by_name: editorName,
            created_at: r.createdAt.toISOString(),
            updated_at: r.updatedAt.toISOString(),
            stats: { seen: s?.seen ?? 0, opened: s?.opened ?? 0, clicked: s?.clicked ?? 0, dismissed: s?.dismissed ?? 0 },
        };
    }

    private checkDates(publishedAt: Date | null, expiresAt: Date | null): void {
        if (publishedAt && expiresAt && expiresAt.getTime() <= publishedAt.getTime()) {
            throw bad('whats_new_expires_before_publish', 'El vencimiento tiene que ser después de la publicación');
        }
    }

    async create(input: CreateWhatsNewInput, actorId: number): Promise<PlatformWhatsNewEntry> {
        const now = new Date();
        const publishedAt = input.publish_at ? new Date(input.publish_at) : input.status === 'published' ? now : null;
        const expiresAt = input.expires_at ? new Date(input.expires_at) : null;
        this.checkDates(publishedAt, expiresAt);
        const [row] = await this.db
            .insert(whatsNewEntries)
            .values({
                key: `op-${randomBytes(8).toString('hex')}`,
                origin: 'operator',
                status: input.status,
                kind: input.kind,
                title: input.title,
                summary: input.summary,
                body: input.body,
                imageUrl: input.image_url,
                videoUrl: input.video_url,
                action: input.action,
                version: input.version,
                // Un aviso va en la franja de arriba: no sale en el diálogo de destacadas.
                featured: input.kind === 'notice' ? false : input.featured,
                audienceRoles: [...input.audience.roles],
                audiencePlans: [...input.audience.plans],
                publishedAt,
                announceFrom: publishedAt,
                expiresAt,
                createdBy: actorId,
                updatedBy: actorId,
            })
            .returning({ id: whatsNewEntries.id });
        this.logger.log(`Novedad ${row!.id} creada por el usuario ${actorId} («${input.title}», ${input.status})`);
        return this.one(row!.id);
    }

    async update(id: number, input: UpdateWhatsNewInput, actorId: number): Promise<PlatformWhatsNewEntry> {
        const [row] = await this.db.select().from(whatsNewEntries).where(eq(whatsNewEntries.id, id)).limit(1);
        if (!row) throw notFound();
        const isRelease = row.origin === 'release';
        if (isRelease && input.status === 'draft') {
            throw bad('whats_new_release_draft', 'Una novedad de versión no vuelve a borrador: ocúltala');
        }
        const now = new Date();
        const changes: Partial<typeof whatsNewEntries.$inferInsert> = { updatedBy: actorId, updatedAt: now };
        if (input.kind !== undefined) changes.kind = input.kind;
        if (input.title !== undefined) changes.title = input.title;
        if (input.summary !== undefined) changes.summary = input.summary;
        if (input.body !== undefined) changes.body = input.body;
        if (input.image_url !== undefined) changes.imageUrl = input.image_url;
        if (input.video_url !== undefined) changes.videoUrl = input.video_url;
        if (input.action !== undefined) changes.action = input.action;
        if (input.version !== undefined) changes.version = input.version;
        if (input.featured !== undefined) changes.featured = input.featured;
        if (input.audience !== undefined) {
            changes.audienceRoles = [...input.audience.roles];
            changes.audiencePlans = [...input.audience.plans];
        }
        if (input.expires_at !== undefined) changes.expiresAt = input.expires_at ? new Date(input.expires_at) : null;
        if (input.status !== undefined) changes.status = input.status;
        if ((changes.kind ?? row.kind) === 'notice') changes.featured = false;

        // Cualquier cambio que no sea mostrar/ocultar «adopta» una novedad de
        // versión: las próximas versiones ya no le cambian el texto.
        const contentKeys = Object.keys(input).filter((k) => k !== 'status' && k !== 'publish_at');
        if (isRelease && contentKeys.length > 0) changes.edited = true;

        // Fecha de publicación (sólo las del operador; las de versión llevan la suya).
        if (!isRelease) {
            const nextStatus = changes.status ?? row.status;
            let publishedAt = row.publishedAt;
            if (input.publish_at !== undefined) publishedAt = input.publish_at ? new Date(input.publish_at) : nextStatus === 'published' ? now : null;
            if (nextStatus === 'published' && publishedAt === null) publishedAt = now;
            changes.publishedAt = publishedAt;
            changes.announceFrom = publishedAt;
        }
        this.checkDates(changes.publishedAt ?? row.publishedAt, changes.expiresAt !== undefined ? changes.expiresAt : row.expiresAt);

        await this.db.update(whatsNewEntries).set(changes).where(eq(whatsNewEntries.id, id));
        if (input.image_url !== undefined && row.imageUrl !== input.image_url) await this.dropImageIfUnused(row.imageUrl);
        this.logger.log(`Novedad ${id} editada por el usuario ${actorId} (${Object.keys(input).join(', ')})`);
        return this.one(id);
    }

    /** Devuelve una novedad de versión editada a su texto del catálogo. */
    async restore(id: number, actorId: number): Promise<PlatformWhatsNewEntry> {
        const [row] = await this.db.select().from(whatsNewEntries).where(eq(whatsNewEntries.id, id)).limit(1);
        if (!row) throw notFound();
        if (row.origin !== 'release') throw bad('whats_new_not_release', 'Sólo se restauran las novedades que vienen con una versión');
        const entry = this.catalogByKey().get(row.key);
        if (!entry) {
            throw new ConflictException({
                code: 'whats_new_not_in_catalog',
                message: 'Esta novedad ya no está en el catálogo de la versión instalada',
                data: { status: 409 },
            });
        }
        await this.db
            .update(whatsNewEntries)
            .set({
                kind: entry.kind,
                title: entry.title,
                summary: entry.summary,
                body: entry.body,
                imageUrl: entry.imageUrl,
                videoUrl: entry.videoUrl,
                action: entry.action,
                version: entry.version,
                featured: entry.featured,
                audienceRoles: entry.audienceRoles,
                audiencePlans: entry.audiencePlans,
                publishedAt: entry.publishedAt,
                expiresAt: entry.expiresAt,
                edited: false,
                updatedBy: actorId,
                updatedAt: new Date(),
            })
            .where(eq(whatsNewEntries.id, id));
        await this.dropImageIfUnused(row.imageUrl);
        this.logger.log(`Novedad ${id} restaurada al texto de la versión por el usuario ${actorId}`);
        return this.one(id);
    }

    async remove(id: number, actorId: number): Promise<void> {
        const [row] = await this.db.select().from(whatsNewEntries).where(eq(whatsNewEntries.id, id)).limit(1);
        if (!row) throw notFound();
        if (row.origin === 'release') {
            throw bad('whats_new_release_delete', 'Una novedad de versión no se borra: ocúltala');
        }
        await this.db.delete(whatsNewEntries).where(eq(whatsNewEntries.id, id));
        await this.dropImageIfUnused(row.imageUrl);
        this.logger.log(`Novedad ${id} borrada por el usuario ${actorId} («${row.title}»)`);
    }

    /** Borra el archivo de una imagen subida si ya ninguna novedad la usa. */
    private async dropImageIfUnused(url: string | null): Promise<void> {
        const name = ownImageName(url);
        if (name === null) return;
        const [used] = await this.db
            .select({ id: whatsNewEntries.id })
            .from(whatsNewEntries)
            .where(eq(whatsNewEntries.imageUrl, `${WHATS_NEW_IMAGE_PATH}${name}`))
            .limit(1);
        if (used) return;
        await this.storage.delete(`${IMAGE_KEY_PREFIX}${name}`).catch(() => undefined);
    }

    /**
     * Guarda una imagen de novedad. El tipo se decide por los PRIMEROS BYTES
     * (nunca por el nombre o lo que declara el navegador): PNG, JPEG, WebP o
     * GIF; SVG nunca. El nombre es aleatorio, así la URL se puede cachear para
     * siempre.
     */
    async uploadImage(source: Readable): Promise<{ url: string }> {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of source) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
            size += buf.length;
            if (size > MAX_WHATS_NEW_IMAGE_BYTES) {
                source.destroy();
                throw bad('file_too_large', 'La imagen supera los 5 MB');
            }
            chunks.push(buf);
        }
        const bytes = Buffer.concat(chunks);
        const kind = sniffImage(bytes);
        if (kind === null) throw bad('whats_new_image_type', 'Sube una imagen PNG, JPG, WebP o GIF');
        const name = `${randomBytes(16).toString('hex')}.${kind.ext}`;
        await this.storage.write(`${IMAGE_KEY_PREFIX}${name}`, Readable.from(bytes));
        return { url: `${WHATS_NEW_IMAGE_PATH}${name}` };
    }

    /** Abre una imagen subida (null si el nombre no es válido o no existe). */
    async openImage(name: string): Promise<Readable | null> {
        if (!WHATS_NEW_IMAGE_NAME_RE.test(name)) return null;
        const key = `${IMAGE_KEY_PREFIX}${name}`;
        if (this.storage.probe && !(await this.storage.probe(key))) return null;
        return this.storage.read(key);
    }
}
