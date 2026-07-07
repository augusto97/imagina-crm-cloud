/**
 * Capability slugs y hook `useCan` para gatear UI por permisos.
 *
 * El bootstrap del SPA inyecta `IMAGINA_CRM_BOOT.user.capabilities` con un
 * mapa `{cap_slug: boolean}` calculado server-side en `AdminAssets` /
 * `StandalonePage` (ver `CapabilityRegistry::currentUserCapabilitiesMap`
 * en el backend). Para el SPA en vivo, también lo expone
 * `GET /imagina-crm/v1/me`.
 *
 * Convención: los componentes consumen `useCan('imcrm_manage_lists')` y el
 * gating se reduce a `if (!can) return null` o `disabled={!can}`.
 */
import { getBootData } from './boot';

export const CAP = {
    // Acceso general al admin SPA.
    ACCESS_ADMIN: 'imcrm_access_admin',

    // Schema
    MANAGE_LISTS: 'imcrm_manage_lists',
    MANAGE_FIELDS: 'imcrm_manage_fields',
    MANAGE_VIEWS: 'imcrm_manage_views',
    MANAGE_AUTOMATIONS: 'imcrm_manage_automations',
    MANAGE_DASHBOARDS: 'imcrm_manage_dashboards',

    // Records
    VIEW_RECORDS: 'imcrm_view_records',
    VIEW_OWN_RECORDS: 'imcrm_view_own_records',
    CREATE_RECORDS: 'imcrm_create_records',
    EDIT_RECORDS: 'imcrm_edit_records',
    EDIT_OWN_RECORDS: 'imcrm_edit_own_records',
    DELETE_RECORDS: 'imcrm_delete_records',
    DELETE_OWN_RECORDS: 'imcrm_delete_own_records',

    // Bulk / IO
    IMPORT_RECORDS: 'imcrm_import_records',
    EXPORT_RECORDS: 'imcrm_export_records',
    BULK_ACTIONS: 'imcrm_bulk_actions',

    // Portal del cliente (Fase 9).
    ACCESS_PORTAL: 'imcrm_access_portal',
} as const;

export type Capability = (typeof CAP)[keyof typeof CAP];

/**
 * `true` si el usuario actual tiene la capability dada. Lee el snapshot
 * del bootstrap (rápido, sin red). Hook trivial, no re-renderea — las
 * caps no cambian dentro de la sesión SPA (cambiar de rol requiere
 * logout/login).
 */
export function useCan(cap: Capability | 'manage_options'): boolean {
    const caps = getBootData().user.capabilities;
    return Boolean(caps[cap]);
}

/**
 * `true` si tiene AL MENOS UNA de las capabilities recibidas.
 * Útil cuando un control acepta el OR de varias caps
 * (ej. `view_records || view_own_records`).
 */
export function useCanAny(...caps: Array<Capability | 'manage_options'>): boolean {
    const map = getBootData().user.capabilities;
    return caps.some((c) => Boolean(map[c]));
}

/**
 * `true` si el user es admin "total" del plugin (administrator nativo
 * de WP o crm_admin). Es el shortcut canónico para checks "puedo todo".
 */
export function useIsPluginAdmin(): boolean {
    const caps = getBootData().user.capabilities;
    return Boolean(caps.manage_options) || Boolean(caps[CAP.MANAGE_LISTS]);
}

/**
 * Roles del plugin (en orden de jerarquía). Espejo de
 * `CapabilityRegistry::roles()` en el backend.
 */
export const ROLES = {
    ADMIN: 'crm_admin',
    MANAGER: 'crm_manager',
    AGENT: 'crm_agent',
    VIEWER: 'crm_viewer',
    CLIENT: 'crm_client',
} as const;

export type RoleSlug = (typeof ROLES)[keyof typeof ROLES];
