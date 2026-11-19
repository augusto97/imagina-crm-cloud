import { z } from 'zod';
import { idSchema } from './common';

/**
 * ACL por lista (permisos por rol). Se persiste en `list.settings.permissions`.
 *
 * Alcances (scope):
 *  - `all`      — todos los registros de la lista.
 *  - `assigned` — los que tienen al usuario en el campo de asignación (tipo user).
 *  - `own`      — los creados por el usuario (created_by).
 *  - `none`     — ninguno (deniega).
 *
 * `admin` tiene acceso total siempre (no se configura). `client` solo va al
 * portal. Los configurables son manager / agent / viewer.
 */
export const SCOPES = ['all', 'assigned', 'own', 'none'] as const;
export const scopeSchema = z.enum(SCOPES);
export type Scope = z.infer<typeof scopeSchema>;

/** Roles del workspace cuyos permisos por lista SÍ se configuran. */
export const CONFIGURABLE_ROLES = ['manager', 'agent', 'viewer'] as const;
export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number];

export const rolePermissionsSchema = z.object({
    view: scopeSchema,
    create: z.boolean(),
    edit: scopeSchema,
    delete: scopeSchema,
    /** Slugs de campos ocultos para este rol (no se devuelven ni se pueden editar). */
    fields_hidden: z.array(z.string()).default([]),
    /**
     * C4 (v0.1.457) — campos que este rol VE pero no puede cambiar. Por ID
     * (regla de oro nº 1; la clave sigue la convención `*_field_ids`, así
     * plantillas, duplicar y migrar una empresa la re-apuntan solas). Lo
     * escriben igual las automatizaciones, las sincronizaciones, los botones
     * y las plantillas (corren como el sistema); un administrador, siempre.
     */
    readonly_field_ids: z.array(idSchema).max(1000).optional(),
    /**
     * C3 — Sólo para invitados: «puede comentar» aunque no edite. Del lado del
     * equipo no aplica (quien ve un registro puede comentarlo, como siempre).
     */
    comment: z.boolean().optional(),
});
export type RolePermissions = z.infer<typeof rolePermissionsSchema>;

/** Documento de permisos por lista. `permissions` mapea rol → RolePermissions. */
export const listPermissionsSchema = z.object({
    permissions: z.record(z.string(), rolePermissionsSchema),
    /** Campo (tipo user) usado por el scope `assigned`. */
    assignment_field_id: idSchema.nullable().default(null),
    /**
     * v0.1.138 — Acceso POR PERSONA: `user_id` → permisos, para compartir
     * una lista con alguien puntual sin tocar el rol que tiene en todo el
     * workspace. Pisa lo que diga su rol para ESTA lista (puede dar más o
     * menos); `admin` no se ve afectado, siempre tiene acceso total.
     */
    users: z.record(z.string(), rolePermissionsSchema).prefault({}),
    /**
     * C1 — Acceso POR EQUIPO: `team_id` → permisos. Prioridad: persona >
     * equipo > rol. Si alguien está en varios equipos con acceso, vale lo MÁS
     * permisivo de cada eje y un campo se oculta sólo si TODOS lo ocultan.
     */
    teams: z.record(z.string(), rolePermissionsSchema).prefault({}),
    /**
     * C1 — Campo «Equipo» que también cuenta para el alcance «los asignados»:
     * un registro es de la persona si el campo Persona (`assignment_field_id`)
     * la tiene, si este campo contiene uno de sus equipos o si lo creó.
     */
    assignment_team_field_id: idSchema.nullable().default(null),
});
export type ListPermissions = z.infer<typeof listPermissionsSchema>;

/** Body del PATCH de permisos (parcial: solo lo que cambia). */
export const updateListPermissionsSchema = z.object({
    permissions: z.record(z.string(), rolePermissionsSchema).optional(),
    assignment_field_id: idSchema.nullable().optional(),
    /** Mapa completo de accesos por persona (reemplaza el guardado). */
    users: z.record(z.string(), rolePermissionsSchema).optional(),
    /** C1 — mapa completo de accesos por equipo (reemplaza el guardado). */
    teams: z.record(z.string(), rolePermissionsSchema).optional(),
    assignment_team_field_id: idSchema.nullable().optional(),
    /**
     * C2 — filas de roles PROPIOS (`custom:12`) que vuelven a heredar la de
     * su rol base (se borran del mapa).
     */
    reset_roles: z.array(z.string().max(40)).max(60).optional(),
});
export type UpdateListPermissionsInput = z.infer<typeof updateListPermissionsSchema>;

export interface ListRoleMeta {
    slug: string;
    label: string;
    can_configure: boolean;
    /** C2 — fila de un rol PROPIO: su rol base y si hoy hereda la fila de ese base. */
    custom_role_id?: number;
    base_role?: string;
    inherited?: boolean;
}

export interface ListPermissionsDoc {
    list_id: number;
    permissions: Record<string, RolePermissions>;
    assignment_field_id: number | null;
    roles: ListRoleMeta[];
    /** v0.1.138 — accesos por persona, con los datos para mostrarlos. */
    users: Array<{
        user_id: number;
        name: string;
        email: string;
        permissions: RolePermissions;
        /** C3 — persona INVITADA de afuera (se gestiona en su propia sección). */
        is_guest?: boolean;
        /** C3 — todavía no definió su contraseña. */
        pending?: boolean;
    }>;
    /** C1 — accesos por equipo, con el nombre y color para mostrarlos. */
    teams: Array<{
        team_id: number;
        name: string;
        color: string | null;
        icon: string | null;
        member_count: number;
        permissions: RolePermissions;
    }>;
    assignment_team_field_id: number | null;
}

/**
 * C1 — Combina los accesos de VARIOS equipos de una persona: lo más permisivo
 * de cada eje (todos > asignados > propios > ninguno; crear si alguno deja) y
 * un campo queda oculto sólo si TODOS lo ocultan.
 */
export function mostPermissive(list: readonly RolePermissions[]): RolePermissions | null {
    if (list.length === 0) return null;
    const rank: Record<Scope, number> = { none: 0, own: 1, assigned: 2, all: 3 };
    const best = (pick: (p: RolePermissions) => Scope): Scope =>
        list.map(pick).reduce((a, b) => (rank[b] > rank[a] ? b : a), 'none' as Scope);
    let hidden: string[] | null = null;
    // C4 — de sólo lectura sólo si TODOS los equipos lo marcan (lo más permisivo).
    let readonly: number[] | null = null;
    for (const p of list) {
        const own = new Set(p.fields_hidden ?? []);
        hidden = hidden === null ? [...own] : hidden.filter((h) => own.has(h));
        const ro = new Set(p.readonly_field_ids ?? []);
        readonly = readonly === null ? [...ro] : readonly.filter((id) => ro.has(id));
    }
    return {
        view: best((p) => p.view),
        create: list.some((p) => p.create),
        edit: best((p) => p.edit),
        delete: best((p) => p.delete),
        fields_hidden: hidden ?? [],
        ...(readonly && readonly.length > 0 ? { readonly_field_ids: readonly } : {}),
    };
}

/** C4 — los campos de sólo lectura de un acceso (ids, sin repetir). */
export function readonlyFieldIdsOf(p: Pick<RolePermissions, 'readonly_field_ids'> | null | undefined): number[] {
    return [...new Set((p?.readonly_field_ids ?? []).filter((id) => Number.isInteger(id) && id > 0))];
}

/**
 * C4 — Lo que una persona puede hacer con cada campo según su acceso (lo que
 * ve la UI en Permisos): `edit` (ver y cambiar), `read` (sólo ver) o `none`
 * (no lo ve). Ocultar gana sobre sólo lectura.
 */
export type FieldAccessLevel = 'edit' | 'read' | 'none';

export function fieldAccessLevel(p: Pick<RolePermissions, 'fields_hidden' | 'readonly_field_ids'>, field: { id: number; slug: string }): FieldAccessLevel {
    if ((p.fields_hidden ?? []).includes(field.slug)) return 'none';
    if ((p.readonly_field_ids ?? []).includes(field.id)) return 'read';
    return 'edit';
}

/** C4 — Aplica un nivel a un campo en un acceso (devuelve un acceso nuevo). */
export function withFieldAccessLevel<P extends Pick<RolePermissions, 'fields_hidden' | 'readonly_field_ids'>>(
    p: P,
    field: { id: number; slug: string },
    level: FieldAccessLevel,
): P {
    const hidden = new Set(p.fields_hidden ?? []);
    const readonly = new Set(p.readonly_field_ids ?? []);
    hidden.delete(field.slug);
    readonly.delete(field.id);
    if (level === 'none') hidden.add(field.slug);
    if (level === 'read') readonly.add(field.id);
    const next = { ...p, fields_hidden: [...hidden] };
    if (readonly.size > 0) return { ...next, readonly_field_ids: [...readonly] };
    const { readonly_field_ids: _drop, ...rest } = next;
    return rest as P;
}

/** Defaults por rol cuando la lista no tiene ACL configurada (refleja las
 * capabilities globales: manager/viewer ven todo, agent solo lo suyo). */
export function defaultRolePermissions(role: ConfigurableRole): RolePermissions {
    if (role === 'manager') {
        return { view: 'all', create: true, edit: 'all', delete: 'all', fields_hidden: [] };
    }
    if (role === 'agent') {
        return { view: 'own', create: true, edit: 'own', delete: 'own', fields_hidden: [] };
    }
    // viewer: solo lectura total.
    return { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: [] };
}
