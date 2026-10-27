import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { whatsNewViews } from '../db/schema';

/**
 * Borrar la cuenta (GDPR): lo que vio la persona de las novedades se va con
 * ella. Es por persona (no por empresa), así que no cae con las membresías; y
 * la fila del usuario se anonimiza en vez de borrarse, así que tampoco cae por
 * la cascada. Por la conexión base (la tabla tiene RLS por `app.user_id`).
 */
export async function deleteWhatsNewViewsForUser(db: Db, userId: number): Promise<void> {
    await db.delete(whatsNewViews).where(eq(whatsNewViews.userId, userId));
}
