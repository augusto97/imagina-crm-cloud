import { ForbiddenException } from '@nestjs/common';
import { readStoreListMarker, type StoreListMarker } from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { lists } from '../db/schema';

/**
 * v0.1.213 — Una lista sincronizada con una tienda es un espejo de la tienda:
 * los registros se crean y se borran ALLÁ. Si la app dejara crear un producto
 * o borrar un pedido, quedaría un dato que la tienda no tiene y la próxima
 * sincronización lo pisaría o lo dejaría huérfano. Lo usan el alta, el
 * borrado y la importación (el motor de la sincronización escribe por su
 * propio camino y no pasa por acá).
 */
export function assertNotStoreManaged(
    list: { settings: Record<string, unknown> },
    action: 'create' | 'delete' | 'import' | 'move',
): StoreListMarker | null {
    const marker = readStoreListMarker(list.settings);
    if (!marker) return null;
    const where = marker.store_name ? `la tienda ${marker.store_name}` : 'la tienda';
    const what = {
        create: `Esta lista viene de ${where}: los registros nuevos se crean en WooCommerce y llegan solos.`,
        delete: `Esta lista viene de ${where}: los registros se borran en WooCommerce.`,
        import: `Esta lista viene de ${where}: no se le pueden importar filas (se crean en WooCommerce).`,
        move: `Esta lista viene de ${where}: qué es variación de qué lo decide WooCommerce.`,
    }[action];
    throw new ForbiddenException({ code: 'store_managed', message: what, data: { status: 403 } });
}

/**
 * Quita la marca de tienda de las listas de una conexión: al dejar de
 * sincronizar (o borrar la conexión) las listas QUEDAN y pasan a ser listas
 * comunes de la empresa, editables sin restricciones (ADR-S09).
 */
export async function stripStoreMarkers(tx: Tx, tenantId: number, connectionId: number): Promise<void> {
    await tx
        .update(lists)
        .set({ settings: sql`${lists.settings} - 'store_sync'` })
        .where(
            and(
                eq(lists.tenantId, tenantId),
                sql`${lists.settings} ? 'store_sync'`,
                sql`(${lists.settings}->'store_sync'->>'connection_id')::bigint = ${connectionId}`,
            ),
        );
}
