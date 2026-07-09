import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client';

/**
 * Baja al rol NO-superuser `imagina_app` Y fija los settings de scope en UNA
 * sola ida a Postgres. Los superusers bypassean RLS por diseño, así que sin
 * el cambio de rol las policies serían decorativas (el pool conecta como
 * owner). `set_config('role', …, true)` es equivalente a `SET LOCAL ROLE` y,
 * combinado con los `set_config('app.*', …, true)` en el mismo `SELECT`, evita
 * los 2-3 round-trips secuenciales que antes hacía cada transacción (perf:
 * cada request de dominio abre varias transacciones con scope).
 *
 * SET LOCAL / is_local=true: rol y settings mueren con la transacción.
 */
async function enterScope(
    tx: Tx,
    settings: { userId?: number; tenantId?: number },
): Promise<void> {
    // Orden en el targetlist: primero el rol, luego los GUCs `app.*` (un no
    // superuser puede setear GUCs del namespace `app.`). Todo en un statement.
    if (settings.userId !== undefined && settings.tenantId !== undefined) {
        await tx.execute(
            sql`select set_config('role', 'imagina_app', true), set_config('app.user_id', ${String(settings.userId)}, true), set_config('app.tenant_id', ${String(settings.tenantId)}, true)`,
        );
    } else if (settings.tenantId !== undefined) {
        await tx.execute(
            sql`select set_config('role', 'imagina_app', true), set_config('app.tenant_id', ${String(settings.tenantId)}, true)`,
        );
    } else if (settings.userId !== undefined) {
        await tx.execute(
            sql`select set_config('role', 'imagina_app', true), set_config('app.user_id', ${String(settings.userId)}, true)`,
        );
    } else {
        await tx.execute(sql`select set_config('role', 'imagina_app', true)`);
    }
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
        await enterScope(tx, { tenantId });
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
        await enterScope(tx, { userId });
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
        await enterScope(tx, { userId, tenantId });
        return fn(tx);
    });
}

/**
 * Rol de app SIN contexto de tenant/usuario. Existe para poder demostrar
 * (en tests) que sin settings las policies devuelven cero filas.
 */
export async function withoutContext<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
        await enterScope(tx, {});
        return fn(tx);
    });
}
