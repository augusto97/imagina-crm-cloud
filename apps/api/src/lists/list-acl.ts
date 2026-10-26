import {
    CONFIGURABLE_ROLES,
    defaultRolePermissions,
    formulaDependencies,
    jsonbKeyForField,
    listPermissionsSchema,
    mostPermissive,
    teamIdsOf,
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
 *  - Prioridad de los accesos: persona > equipo (C1) > rol.
 */

/**
 * Quién pide, para el ACL por lista. `role` es el rol BASE del workspace;
 * C1 — `teamIds`: los equipos de la persona en esta empresa (acceso por
 * equipo y el alcance «los asignados» por un campo «Equipo»). Lo arma el
 * TenantGuard una vez por request (`req.tenant.teamIds`); un llamador interno
 * que no lo trae se evalúa sin equipos (nunca da MÁS acceso del debido).
 */
export interface AclSubject {
    userId: number;
    role: Role;
    teamIds?: readonly number[];
}

function subjectOf(who: AclSubject | Role, userId?: number): AclSubject {
    return typeof who === 'string' ? { role: who, userId: userId ?? 0, teamIds: [] } : who;
}

/** Normaliza `settings.permissions` a un doc completo con defaults por rol. */
export function resolvePermissions(settings: Record<string, unknown>): ListPermissions {
    const raw = settings.permissions;
    const parsed = listPermissionsSchema.safeParse(raw);
    const base: ListPermissions = parsed.success
        ? parsed.data
        : { permissions: {}, assignment_field_id: null, users: {}, teams: {}, assignment_team_field_id: null };
    // Rellenar los roles configurables faltantes con defaults.
    const permissions: Record<string, RolePermissions> = { ...base.permissions };
    for (const role of CONFIGURABLE_ROLES) {
        if (!permissions[role]) permissions[role] = defaultRolePermissions(role);
    }
    return {
        permissions,
        assignment_field_id: base.assignment_field_id,
        users: base.users ?? {},
        teams: base.teams ?? {},
        assignment_team_field_id: base.assignment_team_field_id ?? null,
    };
}

/**
 * Permiso efectivo para esta lista.
 *
 * v0.1.138 — si la lista fue compartida con ESTA persona (`users[userId]`),
 * ese acceso MANDA sobre el de su rol: es el punto de compartir con alguien
 * puntual sin cambiarle el rol en todo el workspace. `admin` queda afuera a
 * propósito (siempre tiene acceso total) y `client` va por el portal.
 *
 * C1 — después de la persona, el acceso de sus EQUIPOS (lo más permisivo de
 * cada eje entre todos los que tienen acceso; un campo se oculta sólo si
 * todos lo ocultan) y, al final, el de su rol.
 */
export function effectivePermissions(
    settings: Record<string, unknown>,
    who: AclSubject | Role,
    userId?: number,
): RolePermissions {
    const subject = subjectOf(who, userId);
    const role = subject.role;
    if (role === 'admin') {
        return { view: 'all', create: true, edit: 'all', delete: 'all', fields_hidden: [] };
    }
    if (role === 'client') {
        return { view: 'none', create: false, edit: 'none', delete: 'none', fields_hidden: [] };
    }
    const doc = resolvePermissions(settings);
    if (subject.userId > 0) {
        const own = doc.users[String(subject.userId)];
        if (own) return creatorSeesOwn(own);
    }
    const byTeam = mostPermissive(
        (subject.teamIds ?? [])
            .map((t) => doc.teams[String(t)])
            .filter((p): p is RolePermissions => p !== undefined),
    );
    if (byTeam) return creatorSeesOwn(byTeam);
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
    who: AclSubject | Role,
    action: 'view' | 'edit' | 'delete',
    userId?: number,
): Scope {
    return effectivePermissions(settings, who, userId)[action];
}

/** Campos ocultos para el rol (Set de slugs). */
export function hiddenFieldsFor(
    settings: Record<string, unknown>,
    who: AclSubject | Role,
    userId?: number,
): Set<string> {
    return new Set(effectivePermissions(settings, who, userId).fields_hidden);
}

/** Claves JSONB (`f{id}`) de los campos de asignación de la lista (Persona y Equipo). */
export interface AssignmentKeys {
    user: string | null;
    team: string | null;
}

export function assignmentKeys(settings: Record<string, unknown>): AssignmentKeys {
    const doc = resolvePermissions(settings);
    return {
        user: doc.assignment_field_id ? jsonbKeyForField(doc.assignment_field_id) : null,
        team: doc.assignment_team_field_id ? jsonbKeyForField(doc.assignment_team_field_id) : null,
    };
}

/**
 * Condición SQL del alcance de la lista para quien pide y la acción, con los
 * campos de asignación de la lista. Es la forma corta de
 * `effectivePermissions` + `scopeWhere` que usan los listados.
 */
export function listScopeWhere(
    settings: Record<string, unknown>,
    who: AclSubject,
    action: 'view' | 'edit' | 'delete' = 'view',
): SQL | undefined {
    const scope = effectivePermissions(settings, who)[action];
    return scopeWhere(scope, who, assignmentKeys(settings));
}

/** ¿La fila cae en el alcance de la lista para quien pide y la acción? */
export function listRowInScope(
    settings: Record<string, unknown>,
    who: AclSubject,
    action: 'view' | 'edit' | 'delete',
    row: { createdBy: number; data: unknown },
): boolean {
    const scope = effectivePermissions(settings, who)[action];
    const keys = assignmentKeys(settings);
    const data = (row.data ?? {}) as Record<string, unknown>;
    return rowInScope(scope, who, {
        createdBy: row.createdBy,
        assignmentValue: keys.user ? data[keys.user] : null,
        teamValue: keys.team ? data[keys.team] : null,
    });
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
 *
 * C1 — con un campo «Equipo» de asignación, `assigned` también incluye los
 * registros asignados a uno de los equipos de la persona.
 */
export function scopeWhere(
    scope: Scope,
    who: number | AclSubject,
    assignment: string | null | AssignmentKeys,
): SQL | undefined {
    const actorUserId = typeof who === 'number' ? who : who.userId;
    const teamIds = typeof who === 'number' ? [] : (who.teamIds ?? []);
    const keys: AssignmentKeys =
        assignment === null || typeof assignment === 'string' ? { user: assignment, team: null } : assignment;
    if (scope === 'all') return undefined;
    if (scope === 'own') return eq(records.createdBy, actorUserId);
    if (scope === 'assigned') {
        const parts: SQL[] = [eq(records.createdBy, actorUserId)];
        // El campo user guarda un id numérico en JSONB.
        if (keys.user) parts.push(sql`(${records.data} ->> ${keyLit(keys.user)}) = ${String(actorUserId)}`);
        // C1 — el campo «Equipo» guarda un array de ids: alcanza con que
        // contenga UNO de los equipos de la persona.
        if (keys.team && teamIds.length > 0) parts.push(teamContainsAny(keys.team, teamIds));
        return parts.length === 1 ? parts[0] : or(...parts);
    }
    return sql`false`; // none
}

/** `data->'fN'` contiene alguno de los ids de equipo (un `@>` por equipo, con parámetros). */
export function teamContainsAny(key: string, teamIds: readonly number[]): SQL {
    const col = sql`(${records.data} -> ${keyLit(key)})`;
    return sql`(${sql.join(
        teamIds.slice(0, 100).map((t) => sql`${col} @> jsonb_build_array(${t}::bigint)`),
        sql` OR `,
    )})`;
}

/** La clave `f{id}` como literal (validada), igual que en el QueryBuilder. */
function keyLit(key: string): SQL {
    if (!/^f\d+$/.test(key)) throw new Error('Clave de campo inválida');
    return sql.raw(`'${key}'`);
}

/** ¿La fila (createdBy + valor de asignación) cae dentro del scope? */
export function rowInScope(
    scope: Scope,
    who: number | AclSubject,
    row: { createdBy: number; assignmentValue: unknown; teamValue?: unknown },
): boolean {
    const actorUserId = typeof who === 'number' ? who : who.userId;
    const teamIds = typeof who === 'number' ? [] : (who.teamIds ?? []);
    if (scope === 'all') return true;
    if (scope === 'none') return false;
    if (scope === 'own') return row.createdBy === actorUserId;
    // assigned (v0.1.253: o creado por la persona)
    if (row.createdBy === actorUserId || String(row.assignmentValue) === String(actorUserId)) return true;
    // C1 — o asignado a uno de sus equipos.
    if (teamIds.length > 0 && row.teamValue !== undefined && row.teamValue !== null) {
        return teamIdsOf(row.teamValue).some((t) => teamIds.includes(t));
    }
    return false;
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
            if ((f.type !== 'computed' && f.type !== 'formula') || out.has(f.id)) continue;
            // Fórmulas (A1): sus entradas son los campos que nombra la fórmula.
            const inputs = f.type === 'formula' ? formulaDependencies(f.config ?? {}) : ((f.config?.inputs ?? []) as unknown[]);
            if (inputs.some((id) => out.has(Number(id)))) {
                out.add(f.id);
                changed = true;
            }
        }
    }
    return out;
}
