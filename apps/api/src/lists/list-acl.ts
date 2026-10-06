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
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
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
        : { permissions: {}, assignment_field_id: null, users: {} };
    // Rellenar los roles configurables faltantes con defaults.
    const permissions: Record<string, RolePermissions> = { ...base.permissions };
    for (const role of CONFIGURABLE_ROLES) {
        if (!permissions[role]) permissions[role] = defaultRolePermissions(role);
    }
    return { permissions, assignment_field_id: base.assignment_field_id, users: base.users ?? {} };
}

/**
 * Permiso efectivo para esta lista.
 *
 * v0.1.138 — si la lista fue compartida con ESTA persona (`users[userId]`),
 * ese acceso MANDA sobre el de su rol: es el punto de compartir con alguien
 * puntual sin cambiarle el rol en todo el workspace. `admin` queda afuera a
 * propósito (siempre tiene acceso total) y `client` va por el portal.
 */
export function effectivePermissions(
    settings: Record<string, unknown>,
    role: Role,
    userId?: number,
): RolePermissions {
    if (role === 'admin') {
        return { view: 'all', create: true, edit: 'all', delete: 'all', fields_hidden: [] };
    }
    if (role === 'client') {
        return { view: 'none', create: false, edit: 'none', delete: 'none', fields_hidden: [] };
    }
    const doc = resolvePermissions(settings);
    if (userId !== undefined) {
        const own = doc.users[String(userId)];
        if (own) return creatorSeesOwn(own);
    }
    return creatorSeesOwn(doc.permissions[role] ?? defaultRolePermissions(role as ConfigurableRole));
}

/**
 * v0.1.253 — Quien puede CREAR registros en una lista ve, como mínimo, los
 * que creó. El ajuste fino permitía guardar "Ver: nada" con "Crear: sí": la
 * persona creaba un registro y desaparecía al instante de su vista (reporte
 * de un cliente con el rol agente).
 */
function creatorSeesOwn(p: RolePermissions): RolePermissions {
    if (p.create && p.view === 'none') return { ...p, view: 'own' };
    return p;
}

/** Scope efectivo del rol para una acción. */
export function scopeFor(
    settings: Record<string, unknown>,
    role: Role,
    action: 'view' | 'edit' | 'delete',
    userId?: number,
): Scope {
    return effectivePermissions(settings, role, userId)[action];
}

/** Campos ocultos para el rol (Set de slugs). */
export function hiddenFieldsFor(
    settings: Record<string, unknown>,
    role: Role,
    userId?: number,
): Set<string> {
    return new Set(effectivePermissions(settings, role, userId).fields_hidden);
}

/**
 * Condición SQL para el scope de LECTURA. Devuelve:
 *  - `undefined` → sin filtro (scope `all`).
 *  - `sql\`false\`` → deniega todo (scope `none`).
 *  - una condición → `own` (created_by) o `assigned` (campo = userId O
 *    created_by).
 *
 * v0.1.253 — `assigned` incluye además los que la persona CREÓ: un agente
 * con "los que tiene asignados" daba de alta un registro sin ponerse de
 * responsable y lo perdía en el acto (el admin sí lo veía). Y sin campo de
 * asignación elegido ya no deniega todo: queda en "los que creó".
 */
export function scopeWhere(
    scope: Scope,
    actorUserId: number,
    assignmentKey: string | null,
): SQL | undefined {
    if (scope === 'all') return undefined;
    if (scope === 'own') return eq(records.createdBy, actorUserId);
    if (scope === 'assigned') {
        const created = eq(records.createdBy, actorUserId);
        if (!assignmentKey) return created;
        // El campo user guarda un id numérico en JSONB.
        return or(
            created,
            sql`(${records.data} ->> ${sql.raw(`'${assignmentKey}'`)}) = ${String(actorUserId)}`,
        );
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
    // assigned (v0.1.253: o creado por la persona)
    return row.createdBy === actorUserId || String(row.assignmentValue) === String(actorUserId);
}

/** Combina un scopeWhere con un where existente. */
export function andWhere(a: SQL | undefined, b: SQL | undefined): SQL | undefined {
    if (a && b) return and(a, b);
    return a ?? b;
}

/**
 * SEC-36 (v0.1.239) — Un `computed` que usa como entrada un campo oculto (o
 * un lookup/rollup restringido) también se oculta: si no, `ganancia = precio −
 * costo` devolvía el costo despejado con una resta. Encadenados (un computed
 * sobre otro) se resuelven hasta que no cambia nada.
 */
export function withDependentComputed(
    fields: ReadonlyArray<{ id: number; type: string; config?: Record<string, unknown> | null }>,
    hiddenIds: ReadonlySet<number>,
): Set<number> {
    const out = new Set(hiddenIds);
    if (out.size === 0) return out;
    let changed = true;
    while (changed) {
        changed = false;
        for (const f of fields) {
            if (f.type !== 'computed' || out.has(f.id)) continue;
            const inputs = (f.config?.inputs ?? []) as unknown[];
            if (inputs.some((id) => out.has(Number(id)))) {
                out.add(f.id);
                changed = true;
            }
        }
    }
    return out;
}
