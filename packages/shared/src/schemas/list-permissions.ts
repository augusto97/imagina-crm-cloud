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
});
export type RolePermissions = z.infer<typeof rolePermissionsSchema>;

/** Documento de permisos por lista. `permissions` mapea rol → RolePermissions. */
export const listPermissionsSchema = z.object({
    permissions: z.record(rolePermissionsSchema),
    /** Campo (tipo user) usado por el scope `assigned`. */
    assignment_field_id: idSchema.nullable().default(null),
});
export type ListPermissions = z.infer<typeof listPermissionsSchema>;

/** Body del PATCH de permisos (parcial: solo lo que cambia). */
export const updateListPermissionsSchema = z.object({
    permissions: z.record(rolePermissionsSchema).optional(),
    assignment_field_id: idSchema.nullable().optional(),
});
export type UpdateListPermissionsInput = z.infer<typeof updateListPermissionsSchema>;

export interface ListRoleMeta {
    slug: string;
    label: string;
    can_configure: boolean;
}

export interface ListPermissionsDoc {
    list_id: number;
    permissions: Record<string, RolePermissions>;
    assignment_field_id: number | null;
    roles: ListRoleMeta[];
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
