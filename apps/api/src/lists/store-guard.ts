import { ForbiddenException } from '@nestjs/common';
import { mirrorFromPlace, mirrorGoneReason, readMirrorListMarker, type MirrorListMarker } from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { lists } from '../db/schema';

/**
 * v0.1.213 — Una lista sincronizada con una tienda es un espejo de la tienda:
 * los registros se crean y se borran ALLÁ. Si la app dejara crear un producto
 * o borrar un pedido, quedaría un dato que la tienda no tiene y la próxima
 * sincronización lo pisaría o lo dejaría huérfano. Lo usan el alta, el
 * borrado y la importación (el motor de la sincronización escribe por su
 * propio camino y no pasa por aquí).
 *
 * v0.1.333 (ADR-S83) — vale igual para una lista que viene de un sitio
 * WordPress (`site_sync`): las entradas se crean y se borran en WordPress.
 * Devuelve la marca (de la tienda o del sitio) o null si es una lista común.
 */
export function assertNotStoreManaged(
    list: { settings: Record<string, unknown> },
    action: 'create' | 'delete' | 'import' | 'move',
): MirrorListMarker | null {
    const m = readMirrorListMarker(list.settings);
    if (!m) return null;
    const from = mirrorFromPlace(m);
    const what =
        m.source === 'store'
            ? {
                  create: `Esta lista viene ${from}: los registros nuevos se crean en WooCommerce y llegan solos.`,
                  delete: `Esta lista viene ${from}: los registros se borran en WooCommerce (cuando se borran allá, puedes quitarlos de aquí).`,
                  import: `Esta lista viene ${from}: no se le pueden importar filas (se crean en WooCommerce).`,
                  move: `Esta lista viene ${from}: qué es variación de qué lo decide WooCommerce.`,
              }[action]
            : {
                  create: `Esta lista viene ${from}: lo nuevo se crea en WordPress y llega solo.`,
                  delete: `Esta lista viene ${from}: se borra en WordPress (cuando se borra allá, puedes quitarlo de aquí).`,
                  import: `Esta lista viene ${from}: no se le pueden importar filas (se crean en WordPress).`,
                  move: `Esta lista viene ${from}: su orden lo decide WordPress.`,
              }[action];
    throw new ForbiddenException({ code: 'store_managed', message: what, data: { status: 403 } });
}

/**
 * v0.1.336 — Una fila de una lista espejo que la fuente YA borró se puede
 * quitar de la app; una que sigue viva allá, no (volvería en la próxima
 * vuelta). Este es el error de la segunda, con el motivo.
 */
export function mirrorStillAliveError(m: MirrorListMarker): ForbiddenException {
    return new ForbiddenException({ code: 'store_managed', message: mirrorGoneReason(m), data: { status: 403 } });
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

/** v0.1.333 — lo mismo para las listas de un sitio WordPress (`site_sync`). */
export async function stripSiteMarkers(tx: Tx, tenantId: number, connectionId: number): Promise<void> {
    await tx
        .update(lists)
        .set({ settings: sql`${lists.settings} - 'site_sync'` })
        .where(
            and(
                eq(lists.tenantId, tenantId),
                sql`${lists.settings} ? 'site_sync'`,
                sql`(${lists.settings}->'site_sync'->>'connection_id')::bigint = ${connectionId}`,
            ),
        );
}
