import { bigint, index, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

/**
 * Releases detectados en GitHub (ADR-S13). Tabla GLOBAL: no tiene `tenant_id`
 * ni RLS (como `users`) — la actualización es del servidor entero, no de un
 * workspace. Único por (version, channel).
 */
export const appReleases = pgTable(
    'app_releases',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        version: varchar('version', { length: 64 }).notNull(),
        channel: varchar('channel', { length: 32 }).notNull().default('stable'),
        bundleUrl: text('bundle_url').notNull(),
        checksum: varchar('checksum', { length: 128 }),
        releasedAt: timestamp('released_at', { withTimezone: true }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex('app_releases_version_channel_ux').on(t.version, t.channel),
        index('app_releases_channel_released_idx').on(t.channel, t.releasedAt),
    ],
);
