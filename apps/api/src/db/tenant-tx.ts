import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client';

/**
 * Rol NO-superuser al que baja toda transacción con scope: los superusers
 * bypassean RLS por diseño de Postgres, así que sin este SET LOCAL ROLE las
 * policies serían decorativas en dev/tests (pool conectado como superuser).
 * SET LOCAL: rol y settings mueren con la transacción.
 */
async function enterAppRole(tx: Tx): Promise<void> {
    await tx.execute(sql`set local role imagina_app`);
}

/**
 * Toda query sobre tablas con `tenant_id` corre dentro de una transacción
 * con `SET LOCAL app.tenant_id` (regla de oro nº 3; STANDALONE.md §4).
 * Las policies RLS filtran contra ese setting: aunque un bug de aplicación
 * olvide el WHERE tenant_id, Postgres no devuelve filas de otro tenant.
 */
export async function withTenant<T>(
    db: Db,
    tenantId: number,
    fn: (tx: Tx) => Promise<T>,
): Promise<T> {
    return db.transaction(async (tx) => {
        await enterAppRole(tx);
        await tx.execute(sql`select set_config('app.tenant_id', ${String(tenantId)}, true)`);
        return fn(tx);
    });
}

/**
 * Plano de auth: consultas de las memberships PROPIAS de un usuario antes de
 * que haya tenant seleccionado (login, listado de workspaces). La policy
 * `memberships_self` matchea contra `app.user_id`.
 */
export async function withUser<T>(
    db: Db,
    userId: number,
    fn: (tx: Tx) => Promise<T>,
): Promise<T> {
    return db.transaction(async (tx) => {
        await enterAppRole(tx);
        await tx.execute(sql`select set_config('app.user_id', ${String(userId)}, true)`);
        return fn(tx);
    });
}

/** Variante con ambos settings (operaciones que crean tenant + membership). */
export async function withUserAndTenant<T>(
    db: Db,
    userId: number,
    tenantId: number,
    fn: (tx: Tx) => Promise<T>,
): Promise<T> {
    return db.transaction(async (tx) => {
        await enterAppRole(tx);
        await tx.execute(sql`select set_config('app.user_id', ${String(userId)}, true)`);
        await tx.execute(sql`select set_config('app.tenant_id', ${String(tenantId)}, true)`);
        return fn(tx);
    });
}

/**
 * Rol de app SIN contexto de tenant/usuario. Existe para poder demostrar
 * (en tests) que sin settings las policies devuelven cero filas.
 */
export async function withoutContext<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
        await enterAppRole(tx);
        return fn(tx);
    });
}
