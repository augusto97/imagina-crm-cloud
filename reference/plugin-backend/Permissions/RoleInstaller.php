<?php
declare(strict_types=1);

namespace ImaginaCRM\Permissions;

/**
 * Instala y sincroniza los roles del plugin y sus capabilities.
 *
 * Idempotente: se puede llamar tantas veces como haga falta. Cada llamada
 * deja el estado de roles = lo declarado en `CapabilityRegistry`.
 *
 * Se invoca desde:
 *  - `Installer::activate()` cuando el plugin se activa.
 *  - `Plugin::maybeUpgradeSchema()` cuando se actualiza el plugin (sin
 *    desactivar/reactivar) y sube `IMAGINA_CRM_DB_VERSION`.
 *
 * Backwards-compat: el rol nativo de WP `administrator` recibe SIEMPRE
 * todas las caps `imcrm_*`. Eso garantiza que cualquier admin existente
 * sigue teniendo acceso completo al plugin tras la actualización, sin
 * requerir acción manual.
 */
final class RoleInstaller
{
    /**
     * Sincroniza roles y capabilities con lo declarado en
     * `CapabilityRegistry`. Es seguro llamarla cada activación o
     * actualización: agrega caps faltantes, no quita caps custom que
     * el sysadmin haya añadido a mano fuera del plugin.
     */
    public function sync(): void
    {
        $this->syncPluginRoles();
        $this->grantAdministratorCaps();
        $this->syncCustomRoles();
    }

    /**
     * Remueve los roles del plugin y todas las caps `imcrm_*` del rol
     * `administrator`. Solo se llama desde `uninstall.php` cuando el
     * usuario borra el plugin definitivamente (no en desactivación).
     */
    public function uninstall(): void
    {
        foreach (array_keys(CapabilityRegistry::roles()) as $roleSlug) {
            remove_role($roleSlug);
        }

        $admin = get_role('administrator');
        if ($admin !== null) {
            foreach (CapabilityRegistry::allCapabilities() as $cap) {
                $admin->remove_cap($cap);
            }
        }
    }

    /**
     * Crea/actualiza los 5 roles del plugin. Para cada rol:
     *  - Si no existe, lo crea con `add_role()`.
     *  - Si existe, sincroniza el set de caps: agrega las faltantes y
     *    quita las que el plugin ya no declara (limpia caps obsoletas
     *    de versiones anteriores). Solo toca caps con prefijo `imcrm_`
     *    + la cap WP nativa `read`.
     */
    private function syncPluginRoles(): void
    {
        $labels   = CapabilityRegistry::roles();
        $defaults = CapabilityRegistry::defaultCapabilitiesByRole();

        foreach ($defaults as $roleSlug => $caps) {
            $label = $labels[$roleSlug] ?? $roleSlug;
            // Todos los roles del plugin necesitan `read` (cap nativa de
            // WP) para poder hacer login y acceder al frontend.
            $capsMap = ['read' => true];
            foreach ($caps as $cap) {
                $capsMap[$cap] = true;
            }

            $existing = get_role($roleSlug);
            if ($existing === null) {
                add_role($roleSlug, $label, $capsMap);
                continue;
            }

            // Sincroniza caps `imcrm_*`: agrega las que faltan, quita las
            // obsoletas. No toca caps con otros prefijos para no pisar
            // ajustes manuales del sysadmin.
            $declared = array_fill_keys(array_keys($capsMap), true);

            // Quitar caps obsoletas con prefijo `imcrm_` que ya no
            // están en la lista declarada.
            foreach (array_keys($existing->capabilities) as $cap) {
                if (! is_string($cap)) {
                    continue;
                }
                if (str_starts_with($cap, 'imcrm_') && ! isset($declared[$cap])) {
                    $existing->remove_cap($cap);
                }
            }

            // Agregar las declaradas que falten.
            foreach (array_keys($capsMap) as $cap) {
                if (! isset($existing->capabilities[$cap]) || $existing->capabilities[$cap] !== true) {
                    $existing->add_cap($cap);
                }
            }
        }
    }

    /**
     * Sincroniza roles personalizados desde wp_options (Fase 10).
     *
     * - Crea roles nuevos con prefijo `crm_custom_`.
     * - Actualiza caps si el shape cambió.
     * - Remueve roles que ya no figuran en options (admin los borró
     *   desde la UI).
     *
     * Detección de "obsoletos": iteramos `get_roles()` (todos los WP
     * roles) buscando los que tienen prefijo `crm_custom_`. Si alguno
     * no está en `$declaredSet` actual, lo removemos.
     */
    private function syncCustomRoles(): void
    {
        // Importamos via global para no introducir nueva dep en el ctor
        // — el RoleInstaller es stateless, mantengamoslo así. El service
        // se instancia directamente porque su shape es trivial.
        $service = new CustomRoleService();
        $custom = $service->all();

        // 1. Sincronizar declarados: crear/actualizar.
        $declaredSet = [];
        foreach ($custom as $entry) {
            $wpSlug = $service->wpRoleSlug($entry['slug']);
            $declaredSet[$wpSlug] = true;

            $capsMap = ['read' => true];
            foreach ($entry['capabilities'] as $cap) {
                $capsMap[$cap] = true;
            }

            $existing = get_role($wpSlug);
            if ($existing === null) {
                add_role($wpSlug, $entry['label'], $capsMap);
                continue;
            }

            // Quitar caps `imcrm_*` obsoletas que ya no figuran en
            // declared. NO tocamos otros prefijos (defensa idéntica a
            // syncPluginRoles).
            $declared = array_fill_keys(array_keys($capsMap), true);
            foreach (array_keys($existing->capabilities) as $cap) {
                if (! is_string($cap)) continue;
                if (str_starts_with($cap, 'imcrm_') && ! isset($declared[$cap])) {
                    $existing->remove_cap($cap);
                }
            }
            foreach (array_keys($capsMap) as $cap) {
                if (! isset($existing->capabilities[$cap]) || $existing->capabilities[$cap] !== true) {
                    $existing->add_cap($cap);
                }
            }
        }

        // 2. Eliminar roles custom que ya no están en options.
        // Iteramos los WP roles directamente buscando el prefijo.
        if (function_exists('wp_roles')) {
            $allRoles = wp_roles()->roles;
            foreach (array_keys($allRoles) as $wpSlug) {
                if (! is_string($wpSlug)) continue;
                if (! str_starts_with($wpSlug, CustomRoleService::SLUG_PREFIX)) continue;
                if (! isset($declaredSet[$wpSlug])) {
                    remove_role($wpSlug);
                }
            }
        }
    }

    /**
     * Asegura que el rol nativo `administrator` tenga todas las caps
     * `imcrm_*`. Sin esto, después de la migración los admins WP
     * existentes perderían acceso a los endpoints del plugin (que ahora
     * checan `imcrm_access_admin` en vez de `manage_options`).
     */
    private function grantAdministratorCaps(): void
    {
        $admin = get_role('administrator');
        if ($admin === null) {
            return;
        }

        foreach (CapabilityRegistry::allCapabilities() as $cap) {
            if (! isset($admin->capabilities[$cap]) || $admin->capabilities[$cap] !== true) {
                $admin->add_cap($cap);
            }
        }
    }
}
