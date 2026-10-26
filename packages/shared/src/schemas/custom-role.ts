import { z } from 'zod';
import { idSchema } from './common';
import { CUSTOM_ROLE_BASES, capabilitySchema } from './membership';

/**
 * C2 — Roles PROPIOS de una empresa («Vendedor senior», «Contador»).
 *
 * Un rol propio PARTE de un rol base (manager / agente / lector) y ajusta sus
 * capacidades por módulo. El rol base sigue mandando para todo lo demás: el
 * acceso por defecto a cada lista y el alcance (todo / lo suyo). `admin`
 * queda fijo (todas las capacidades) y los roles base no se editan.
 * Tabla `custom_roles` (RLS) + `memberships.custom_role_id`.
 */

export const MAX_CUSTOM_ROLES = 50;

export const customRoleBaseSchema = z.enum(CUSTOM_ROLE_BASES);

export const customRoleSchema = z.object({
    id: idSchema,
    name: z.string(),
    description: z.string().nullable(),
    color: z.string().nullable(),
    base_role: customRoleBaseSchema,
    /** Lista EXPLÍCITA de capacidades (sin `access_admin`, que va siempre). */
    capabilities: z.array(capabilitySchema),
    /** Personas que lo tienen. */
    member_count: z.number().int().nonnegative(),
    created_at: z.string(),
    updated_at: z.string(),
});
export type CustomRole = z.infer<typeof customRoleSchema>;

const roleNameSchema = z.string().trim().min(1, 'El rol necesita un nombre').max(60);

export const createCustomRoleSchema = z.object({
    name: roleNameSchema,
    description: z.string().trim().max(300).nullable().optional(),
    color: z.string().max(32).nullable().optional(),
    base_role: customRoleBaseSchema,
    /** Sin lista: copia las del rol base. */
    capabilities: z.array(capabilitySchema).max(40).optional(),
});
export type CreateCustomRoleInput = z.infer<typeof createCustomRoleSchema>;

export const updateCustomRoleSchema = z.object({
    name: roleNameSchema.optional(),
    description: z.string().trim().max(300).nullable().optional(),
    color: z.string().max(32).nullable().optional(),
    capabilities: z.array(capabilitySchema).max(40).optional(),
});
export type UpdateCustomRoleInput = z.infer<typeof updateCustomRoleSchema>;

/**
 * Clave de un rol propio en el ACL de una lista (`settings.permissions.
 * permissions['custom:12']`). Sin fila propia, la lista usa la de su base.
 */
export const CUSTOM_ROLE_KEY_PREFIX = 'custom:';

export function customRoleKey(id: number): string {
    return `${CUSTOM_ROLE_KEY_PREFIX}${id}`;
}

/** Id de una clave `custom:12` (null si no es de un rol propio). */
export function parseCustomRoleKey(key: string): number | null {
    if (!key.startsWith(CUSTOM_ROLE_KEY_PREFIX)) return null;
    const n = Number(key.slice(CUSTOM_ROLE_KEY_PREFIX.length));
    return Number.isInteger(n) && n > 0 ? n : null;
}
