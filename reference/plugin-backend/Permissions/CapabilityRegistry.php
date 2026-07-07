<?php
declare(strict_types=1);

namespace ImaginaCRM\Permissions;

/**
 * Catálogo central de capabilities del plugin y mapeo a roles default.
 *
 * Las capabilities son strings WP planas que el plugin sumerge en la tabla
 * de roles vía `WP_Role::add_cap`. Cada controller REST y cada elemento de
 * UI verifica una de éstas con `current_user_can()`.
 *
 * La clave `administrator` recibe SIEMPRE todas las caps `imcrm_*` durante
 * la migración: garantiza que cualquier admin existente de WP sigue
 * teniendo acceso total al plugin sin acción manual del usuario.
 *
 * Ver `docs/multi-stakeholder-design.md` §1 (Fase 7).
 */
final class CapabilityRegistry
{
    // Acceso general al admin SPA del plugin.
    public const CAP_ACCESS_ADMIN = 'imcrm_access_admin';

    // Schema.
    public const CAP_MANAGE_LISTS        = 'imcrm_manage_lists';
    public const CAP_MANAGE_FIELDS       = 'imcrm_manage_fields';
    public const CAP_MANAGE_VIEWS        = 'imcrm_manage_views';
    public const CAP_MANAGE_AUTOMATIONS  = 'imcrm_manage_automations';
    public const CAP_MANAGE_DASHBOARDS   = 'imcrm_manage_dashboards';

    // Records.
    public const CAP_VIEW_RECORDS        = 'imcrm_view_records';
    public const CAP_VIEW_OWN_RECORDS    = 'imcrm_view_own_records';
    public const CAP_CREATE_RECORDS      = 'imcrm_create_records';
    public const CAP_EDIT_RECORDS        = 'imcrm_edit_records';
    public const CAP_EDIT_OWN_RECORDS    = 'imcrm_edit_own_records';
    public const CAP_DELETE_RECORDS      = 'imcrm_delete_records';
    public const CAP_DELETE_OWN_RECORDS  = 'imcrm_delete_own_records';

    // Bulk / IO.
    public const CAP_IMPORT_RECORDS = 'imcrm_import_records';
    public const CAP_EXPORT_RECORDS = 'imcrm_export_records';
    public const CAP_BULK_ACTIONS   = 'imcrm_bulk_actions';

    // Portal del cliente (Fase 9).
    public const CAP_ACCESS_PORTAL = 'imcrm_access_portal';

    // Roles propios del plugin.
    public const ROLE_ADMIN   = 'crm_admin';
    public const ROLE_MANAGER = 'crm_manager';
    public const ROLE_AGENT   = 'crm_agent';
    public const ROLE_VIEWER  = 'crm_viewer';
    public const ROLE_CLIENT  = 'crm_client';

    /**
     * Lista completa de capabilities. Fuente de verdad para `RoleInstaller`
     * y para detectar caps obsoletas en futuras migraciones.
     *
     * @return list<string>
     */
    public static function allCapabilities(): array
    {
        return [
            self::CAP_ACCESS_ADMIN,
            self::CAP_MANAGE_LISTS,
            self::CAP_MANAGE_FIELDS,
            self::CAP_MANAGE_VIEWS,
            self::CAP_MANAGE_AUTOMATIONS,
            self::CAP_MANAGE_DASHBOARDS,
            self::CAP_VIEW_RECORDS,
            self::CAP_VIEW_OWN_RECORDS,
            self::CAP_CREATE_RECORDS,
            self::CAP_EDIT_RECORDS,
            self::CAP_EDIT_OWN_RECORDS,
            self::CAP_DELETE_RECORDS,
            self::CAP_DELETE_OWN_RECORDS,
            self::CAP_IMPORT_RECORDS,
            self::CAP_EXPORT_RECORDS,
            self::CAP_BULK_ACTIONS,
            self::CAP_ACCESS_PORTAL,
        ];
    }

    /**
     * Roles del plugin con su label legible.
     *
     * @return array<string, string>
     */
    public static function roles(): array
    {
        return [
            self::ROLE_ADMIN   => __('Admin del CRM', 'imagina-crm'),
            self::ROLE_MANAGER => __('Manager del CRM', 'imagina-crm'),
            self::ROLE_AGENT   => __('Agente del CRM', 'imagina-crm'),
            self::ROLE_VIEWER  => __('Visualizador del CRM', 'imagina-crm'),
            self::ROLE_CLIENT  => __('Cliente del CRM', 'imagina-crm'),
        ];
    }

    /**
     * Mapeo rol → caps default. Estos son los valores con los que se
     * crea/sincroniza cada rol. `administrator` (rol nativo de WP) recibe
     * SIEMPRE todas las caps — eso se aplica en el `RoleInstaller`, no aquí.
     *
     * Reglas de diseño:
     *  - `crm_admin`: igual de poderoso que `administrator` dentro del plugin.
     *  - `crm_manager`: gestiona records y vistas, no toca schema ni
     *    automatizaciones (aunque sí ve dashboards).
     *  - `crm_agent`: usuario operativo. Solo sus propios records.
     *  - `crm_viewer`: lectura total, sin mutaciones.
     *  - `crm_client`: solo portal — no entra al admin.
     *
     * @return array<string, list<string>>
     */
    public static function defaultCapabilitiesByRole(): array
    {
        $all = self::allCapabilities();
        // crm_admin recibe todas las caps del plugin (pero NO `read`/WP-core,
        // eso lo añade el RoleInstaller para permitir login).
        $admin = $all;

        $manager = [
            self::CAP_ACCESS_ADMIN,
            self::CAP_MANAGE_VIEWS,
            self::CAP_MANAGE_DASHBOARDS,
            self::CAP_VIEW_RECORDS,
            self::CAP_CREATE_RECORDS,
            self::CAP_EDIT_RECORDS,
            self::CAP_DELETE_RECORDS,
            self::CAP_IMPORT_RECORDS,
            self::CAP_EXPORT_RECORDS,
            self::CAP_BULK_ACTIONS,
        ];

        $agent = [
            self::CAP_ACCESS_ADMIN,
            self::CAP_VIEW_OWN_RECORDS,
            self::CAP_CREATE_RECORDS,
            self::CAP_EDIT_OWN_RECORDS,
            self::CAP_DELETE_OWN_RECORDS,
            self::CAP_EXPORT_RECORDS,
        ];

        $viewer = [
            self::CAP_ACCESS_ADMIN,
            self::CAP_VIEW_RECORDS,
            self::CAP_EXPORT_RECORDS,
        ];

        $client = [
            self::CAP_ACCESS_PORTAL,
        ];

        return [
            self::ROLE_ADMIN   => $admin,
            self::ROLE_MANAGER => $manager,
            self::ROLE_AGENT   => $agent,
            self::ROLE_VIEWER  => $viewer,
            self::ROLE_CLIENT  => $client,
        ];
    }

    /**
     * Devuelve true si el slug recibido es una de las capabilities del
     * plugin (todas tienen prefijo `imcrm_`).
     */
    public static function isPluginCapability(string $cap): bool
    {
        return str_starts_with($cap, 'imcrm_') && in_array($cap, self::allCapabilities(), true);
    }

    /**
     * Mapa `{cap_slug => bool}` con el estado de cada capability del
     * plugin para el usuario actual. Se usa en el payload de bootstrap
     * del SPA (admin + standalone) y en `GET /me` para que el front
     * pueda gatear UI sin tener que pedir N veces al backend.
     *
     * @return array<string, bool>
     */
    public static function currentUserCapabilitiesMap(): array
    {
        $out = [];
        foreach (self::allCapabilities() as $cap) {
            $out[$cap] = current_user_can($cap);
        }
        return $out;
    }
}
