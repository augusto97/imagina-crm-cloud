import { Inject, Injectable } from '@nestjs/common';
import type { AppRelease } from '@imagina-base/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/client';
import { appReleases } from '../db/schema';

/**
 * Acceso a `app_releases`. Tabla GLOBAL (sin RLS): se consulta con el `db`
 * crudo, no dentro de un tx de tenant.
 */
@Injectable()
export class ReleasesRepository {
    constructor(@Inject(DRIZZLE) private readonly db: Db) {}

    async upsert(input: {
        version: string;
        channel: string;
        bundleUrl: string;
        checksum: string | null;
        releasedAt: Date;
    }): Promise<void> {
        await this.db
            .insert(appReleases)
            .values(input)
            .onConflictDoUpdate({
                target: [appReleases.version, appReleases.channel],
                set: {
                    bundleUrl: input.bundleUrl,
                    checksum: input.checksum,
                    releasedAt: input.releasedAt,
                    updatedAt: sql`now()`,
                },
            });
    }

    async latest(channel: string): Promise<AppRelease | null> {
        const [row] = await this.db
            .select()
            .from(appReleases)
            .where(eq(appReleases.channel, channel))
            .orderBy(desc(appReleases.releasedAt))
            .limit(1);
        return row ? toDto(row) : null;
    }

    async byVersion(version: string, channel: string): Promise<AppRelease | null> {
        const [row] = await this.db
            .select()
            .from(appReleases)
            .where(and(eq(appReleases.version, version), eq(appReleases.channel, channel)))
            .limit(1);
        return row ? toDto(row) : null;
    }
}

function toDto(row: typeof appReleases.$inferSelect): AppRelease {
    return {
        id: row.id,
        version: row.version,
        channel: row.channel,
        bundle_url: row.bundleUrl,
        checksum: row.checksum,
        released_at: row.releasedAt.toISOString(),
    };
}
