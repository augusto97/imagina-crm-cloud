import { sql, type SQL } from 'drizzle-orm';
import { memberships } from '../db/schema';

/**
 * Roles que nunca reciben avisos ni escalamientos de la mesa de ayuda: el
 * cliente del portal y el invitado externo. Se compara como texto para no
 * depender de los valores del enum (los roles propios agregan más).
 */
const NOT_STAFF = ['client', 'guest'] as const;

/** `memberships.role` es del equipo (ni cliente del portal ni invitado). */
export function staffRoleSql(): SQL {
    return sql`${memberships.role}::text NOT IN (${sql.join(
        NOT_STAFF.map((r) => sql`${r}`),
        sql`, `,
    )})`;
}

/** `memberships.role` es uno de estos roles (y del equipo). */
export function staffRoleInSql(roles: readonly string[]): SQL {
    const wanted = roles.filter((r) => !(NOT_STAFF as readonly string[]).includes(r));
    if (wanted.length === 0) return sql`false`;
    return sql`${memberships.role}::text IN (${sql.join(
        wanted.map((r) => sql`${r}`),
        sql`, `,
    )})`;
}
