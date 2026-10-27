import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { WHATS_NEW_CATALOG, readWhatsNewMedia, type WhatsNewAction, type WhatsNewCatalogEntry, type WhatsNewKind } from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/client';
import { whatsNewEntries } from '../db/schema';
import { parseCatalog, planCatalogSync, type ExistingRelease, type ReleaseContent } from './catalog-sync';

export interface CatalogSyncResult {
    inserted: number;
    updated: number;
    /** Claves que quedaron anunciadas como nuevas en esta sincronización. */
    announced: string[];
    invalid: Array<{ key: string; reason: string }>;
}

/**
 * `{}` = nunca se eligió nada visual (la columna nació así en v0.1.325). Lo
 * que guarda el editor de la consola siempre trae sus tres claves, así que
 * «el operador lo quitó a propósito» no se confunde con «nunca se eligió».
 */
function isUnsetMedia(raw: unknown): boolean {
    return raw === null || raw === undefined || (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0);
}

/** Candado de la sincronización: varios nodos arrancando a la vez no se pisan. */
const SYNC_LOCK = sql`select pg_advisory_xact_lock(hashtext('imagina:whats-new-catalog-sync'))`;

function toColumns(c: ReleaseContent) {
    return {
        kind: c.kind,
        title: c.title,
        summary: c.summary,
        body: c.body,
        imageUrl: c.imageUrl,
        videoUrl: c.videoUrl,
        media: c.media,
        action: c.action,
        version: c.version,
        featured: c.featured,
        audienceRoles: c.audienceRoles,
        audiencePlans: c.audiencePlans,
        publishedAt: c.publishedAt,
        expiresAt: c.expiresAt,
    };
}

/**
 * Copia el catálogo de novedades del código (`WHATS_NEW_CATALOG`) a la tabla
 * al arrancar. Idempotente: un segundo arranque no duplica nada, y dos nodos a
 * la vez se esperan por un candado de la base (más la clave única). Si falla
 * (por ejemplo, falta correr la migración) se avisa en el log y el API arranca
 * igual: las novedades no son críticas.
 */
@Injectable()
export class WhatsNewSyncService implements OnApplicationBootstrap {
    private readonly logger = new Logger('WhatsNew');

    constructor(@Inject(DRIZZLE) private readonly db: Db) {}

    async onApplicationBootstrap(): Promise<void> {
        try {
            const r = await this.sync();
            if (r.inserted > 0 || r.updated > 0) {
                this.logger.log(`Novedades del catálogo: ${r.inserted} nuevas (${r.announced.length} anunciadas), ${r.updated} actualizadas`);
            }
            for (const i of r.invalid) this.logger.warn(`Novedad del catálogo inválida (${i.key}): ${i.reason}`);
        } catch (err) {
            this.logger.warn(`No se pudieron sincronizar las novedades: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    async sync(catalog: readonly WhatsNewCatalogEntry[] = WHATS_NEW_CATALOG, now: Date = new Date()): Promise<CatalogSyncResult> {
        const { entries, invalid } = parseCatalog(catalog, now);
        return this.db.transaction(async (tx) => {
            await tx.execute(SYNC_LOCK);
            const rows = await tx.select().from(whatsNewEntries).where(eq(whatsNewEntries.origin, 'release'));
            const existing: ExistingRelease[] = rows.map((r) => ({
                id: r.id,
                key: r.key,
                edited: r.edited,
                mediaUnset: isUnsetMedia(r.media),
                content: {
                    kind: r.kind as WhatsNewKind,
                    title: r.title,
                    summary: r.summary,
                    body: r.body,
                    imageUrl: r.imageUrl,
                    videoUrl: r.videoUrl,
                    media: readWhatsNewMedia(r.media),
                    action: (r.action as WhatsNewAction | null) ?? null,
                    version: r.version ?? '',
                    featured: r.featured,
                    audienceRoles: r.audienceRoles,
                    audiencePlans: r.audiencePlans,
                    publishedAt: r.publishedAt ?? now,
                    expiresAt: r.expiresAt,
                },
            }));
            const plan = planCatalogSync({ existing, catalog: entries, now });
            let inserted = 0;
            if (plan.inserts.length > 0) {
                const res = await tx
                    .insert(whatsNewEntries)
                    .values(
                        plan.inserts.map((i) => ({
                            key: i.key,
                            origin: 'release',
                            status: 'published',
                            ...toColumns(i),
                            announceFrom: i.announceFrom,
                        })),
                    )
                    .onConflictDoNothing({ target: whatsNewEntries.key })
                    .returning({ id: whatsNewEntries.id });
                inserted = res.length;
            }
            let updated = 0;
            for (const u of plan.updates) {
                const { publishedAt: _keepDate, ...columns } = toColumns(u.content);
                const res = await tx
                    .update(whatsNewEntries)
                    .set({ ...columns, updatedAt: now })
                    // `edited = false` también aquí: si el operador la editó
                    // entre la lectura y la escritura, gana su texto.
                    .where(and(eq(whatsNewEntries.id, u.id), eq(whatsNewEntries.edited, false)))
                    .returning({ id: whatsNewEntries.id });
                updated += res.length;
            }
            for (const b of plan.mediaBackfills) {
                const res = await tx
                    .update(whatsNewEntries)
                    .set({ media: b.media })
                    // Sólo si sigue sin tocar: el operador puede haberle puesto
                    // (o quitado) lo visual entre la lectura y la escritura.
                    .where(and(eq(whatsNewEntries.id, b.id), sql`${whatsNewEntries.media} = '{}'::jsonb`))
                    .returning({ id: whatsNewEntries.id });
                updated += res.length;
            }
            return { inserted, updated, announced: plan.announced, invalid };
        });
    }
}
