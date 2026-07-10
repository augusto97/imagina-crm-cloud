import {
    CONFIGURABLE_ROLES,
    defaultRolePermissions,
    listPermissionsSchema,
    type ConfigurableRole,
    type ListPermissions,
    type RolePermissions,
    type Role,
    type Scope,
} from '@imagina-base/shared';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { records } from '../db/schema';

/**
 * ACL por lista — enforcement de los permisos por rol (`settings.permissions`).
 *
 * Reglas:
 *  - `admin` (y el owner del workspace) tiene acceso total: scope `all` siempre.
 *  - `client` no toca el admin (va al portal): scope `none`.
 *  - manager/agent/viewer usan el ACL de la lista; si no hay ACL configurada,
 *    caen a los defaults que reflejan las capabilities globales.
 */

/** Normaliza `settings.permissions` a un doc completo con defaults por rol. */
export function resolvePermissions(settings: Record<string, unknown>): ListPermissions {
    const raw = settings.permissions;
    const parsed = listPermissionsSchema.safeParse(raw);
    const base: ListPermissions = parsed.success
        ? parsed.data
        : { permissions: {}, assignment_field_id: null };
    // Rellenar los roles configurables faltantes con defaults.
    const permissions: Record<string, RolePermissions> = { ...base.permissions };
    for (const role of CONFIGURABLE_ROLES) {
        if (!permissions[role]) permissions[role] = defaultRolePermissions(role);
    }
    return { permissions, assignment_field_id: base.assignment_field_id };
}

/** Permiso efectivo del rol para esta lista. */
export function effectivePermissions(settings: Record<string, unknown>, role: Role): RolePermissions {
    if (role === 'admin') {
        return { view: 'all', create: true, edit: 'all', delete: 'all', fields_hidden: [] };
    }
    if (role === 'client') {
        return { view: 'none', create: false, edit: 'none', delete: 'none', fields_hidden: [] };
    }
    const doc = resolvePermissions(settings);
    return doc.permissions[role] ?? defaultRolePermissions(role as ConfigurableRole);
}

/** Scope efectivo del rol para una acción. */
export function scopeFor(
    settings: Record<string, unknown>,
    role: Role,
    action: 'view' | 'edit' | 'delete',
): Scope {
    return effectivePermissions(settings, role)[action];
}

/** Campos ocultos para el rol (Set de slugs). */
export function hiddenFieldsFor(settings: Record<string, unknown>, role: Role): Set<string> {
    return new Set(effectivePermissions(settings, role).fields_hidden);
}

/**
 * Condición SQL para el scope de LECTURA. Devuelve:
 *  - `undefined` → sin filtro (scope `all`).
 *  - `sql\`false\`` → deniega todo (scope `none` o `assigned` sin campo).
 *  - una condición → `own` (created_by) o `assigned` (campo = userId).
 */
export function scopeWhere(
    scope: Scope,
    actorUserId: number,
    assignmentKey: string | null,
): SQL | undefined {
    if (scope === 'all') return undefined;
    if (scope === 'own') return eq(records.createdBy, actorUserId);
    if (scope === 'assigned') {
        if (!assignmentKey) return sql`false`; // assigned sin campo → nada
        // El campo user guarda un id numérico en JSONB.
        return sql`(${records.data} ->> ${sql.raw(`'${assignmentKey}'`)}) = ${String(actorUserId)}`;
    }
    return sql`false`; // none
}

/** ¿La fila (createdBy + valor de asignación) cae dentro del scope? */
export function rowInScope(
    scope: Scope,
    actorUserId: number,
    row: { createdBy: number; assignmentValue: unknown },
): boolean {
    if (scope === 'all') return true;
    if (scope === 'none') return false;
    if (scope === 'own') return row.createdBy === actorUserId;
    // assigned
    return String(row.assignmentValue) === String(actorUserId);
}

/** Combina un scopeWhere con un where existente. */
export function andWhere(a: SQL | undefined, b: SQL | undefined): SQL | undefined {
    if (a && b) return and(a, b);
    return a ?? b;
}
