import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { pushSubscriptions } from '../db/schema';

/**
 * H1 — Limpieza de dispositivos push fuera del módulo (sin inyección, para no
 * atar el módulo de autenticación al de push). Corre sobre la conexión BASE:
 * una sesión o una cuenta tienen dispositivos en VARIAS empresas.
 *
 * Es la vía inmediata; la red de seguridad es el envío, que descarta todo
 * dispositivo cuya sesión ya no está viva (cerrada, vencida, revocada).
 */
export async function deletePushForSessionId(db: Db, sessionPublicId: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.sessionId, sessionPublicId)).catch(() => undefined);
}

export async function deletePushForUser(db: Db, userId: number): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).catch(() => undefined);
}
