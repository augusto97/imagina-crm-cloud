import { z } from 'zod';
import { idSchema } from './common';

/** Los mismos 5 roles del plugin (STANDALONE.md §5), sin el prefijo `crm_`. */
export const ROLES = ['admin', 'manager', 'agent', 'viewer', 'client'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/**
 * Capabilities del plugin (CONTRACT.md §6), sin el prefijo `imcrm_`.
 * El backend SIEMPRE valida; el frontend solo oculta botones (`useCan`).
 */
export const CAPABILITIES = [
    'access_admin',
    'manage_lists',
    'manage_fields',
    'manage_views',
    'manage_automations',
    'manage_dashboards',
    'view_records',
    'view_own_records',
    'create_records',
    'edit_records',
    'edit_own_records',
    'delete_records',
    'delete_own_records',
    'import_records',
    'export_records',
    'bulk_actions',
    'access_portal',
] as const;
export const capabilitySchema = z.enum(CAPABILITIES);
export type Capability = z.infer<typeof capabilitySchema>;

/**
 * Matriz rol → capabilities, portada 1:1 de
 * `reference/plugin-backend/Permissions/CapabilityRegistry.php`:
 *  - admin: todas.
 *  - manager: gestiona records y vistas, no toca schema ni automatizaciones.
 *  - agent: usuario operativo, solo sus propios records.
 *  - viewer: lectura total, sin mutaciones.
 *  - client: solo portal.
 */
export const CAPABILITIES_BY_ROLE: Record<Role, readonly Capability[]> = {
    admin: [...CAPABILITIES],
    manager: [
        'access_admin',
        'manage_views',
        'manage_dashboards',
        'view_records',
        'create_records',
        'edit_records',
        'delete_records',
        'import_records',
        'export_records',
        'bulk_actions',
    ],
    agent: [
        'access_admin',
        'view_own_records',
        'create_records',
        'edit_own_records',
        'delete_own_records',
        'export_records',
    ],
    viewer: ['access_admin', 'view_records', 'export_records'],
    client: ['access_portal'],
};

export function roleHasCapability(role: Role, capability: Capability): boolean {
    return CAPABILITIES_BY_ROLE[role].includes(capability);
}

/** Mapa `{cap => bool}` para gatear UI sin N requests (payload de /me y bootstrap). */
export function capabilitiesMap(role: Role): Record<Capability, boolean> {
    const out = {} as Record<Capability, boolean>;
    for (const cap of CAPABILITIES) {
        out[cap] = roleHasCapability(role, cap);
    }
    return out;
}

export const membershipSchema = z.object({
    user_id: idSchema,
    tenant_id: idSchema,
    role: roleSchema,
});
export type Membership = z.infer<typeof membershipSchema>;
