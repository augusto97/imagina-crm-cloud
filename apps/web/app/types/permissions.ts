/**
 * Tipos para el ACL por lista. Espejo del shape devuelto por
 * `GET /imagina-crm/v1/lists/{id}/permissions` y aceptado por el `PATCH`.
 */

export type Scope = 'all' | 'own' | 'assigned' | 'none';

export interface RolePermissions {
    view: Scope;
    create: boolean;
    edit: Scope;
    delete: Scope;
    fields_hidden: string[];
}

export interface ListPermissionsDoc {
    list_id: number;
    permissions: Record<string, RolePermissions>;
    assignment_field_id: number | null;
    /** Solo viene en GET (no en PATCH response). Catálogo de roles. */
    roles?: PluginRole[];
}

export interface PluginRole {
    slug: string;
    label: string;
    /** `false` para crm_admin y crm_client — su comportamiento no se configura. */
    can_configure: boolean;
}
