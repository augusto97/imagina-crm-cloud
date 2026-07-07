<?php
declare(strict_types=1);

namespace ImaginaCRM\Activation;

use ImaginaCRM\Automations\ScheduledRunner;
use ImaginaCRM\Licensing\LicenseManager;
use ImaginaCRM\Lists\SchemaManager;
use ImaginaCRM\Permissions\RoleInstaller;
use ImaginaCRM\Plugin;
use ImaginaCRM\Support\Database;

/**
 * Activación del plugin.
 *
 * Ejecuta migraciones de las tablas del sistema vía `SchemaManager` y deja
 * marcadas las versiones de plugin/DB. Es idempotente: `dbDelta` aplica solo
 * las diferencias, así que reactivar no rompe nada.
 *
 * Las migraciones de tablas dinámicas (`wp_imcrm_data_*`) NO van aquí — se
 * crean cuando el usuario crea cada lista, vía `ListService`.
 */
final class Installer
{
    public const OPTION_DB_VERSION = 'imcrm_db_version';
    public const OPTION_INSTALLED  = 'imcrm_installed_at';

    public static function activate(): void
    {
        if (version_compare(PHP_VERSION, IMAGINA_CRM_MIN_PHP, '<')) {
            deactivate_plugins(IMAGINA_CRM_BASENAME);
            wp_die(
                esc_html(
                    sprintf(
                        /* translators: 1: required PHP version, 2: current PHP version */
                        __('Imagina CRM requires PHP %1$s or higher. You are running PHP %2$s.', 'imagina-crm'),
                        IMAGINA_CRM_MIN_PHP,
                        PHP_VERSION
                    )
                ),
                esc_html__('Plugin activation error', 'imagina-crm'),
                ['back_link' => true]
            );
        }

        global $wpdb;
        $schema = new SchemaManager(new Database($wpdb));
        $schema->installSystemTables();

        // Roles y capabilities del plugin (Fase 7). Idempotente: añade
        // las caps faltantes a `administrator` para no romper acceso
        // de los admins existentes.
        (new RoleInstaller())->sync();

        if (get_option(self::OPTION_INSTALLED) === false) {
            update_option(self::OPTION_INSTALLED, current_time('mysql', true), false);
        }

        update_option(self::OPTION_DB_VERSION, Plugin::DB_VERSION, false);

        // Programa el cron diario de re-validación de licencia (idempotente).
        if (! wp_next_scheduled(LicenseManager::CRON_HOOK)) {
            wp_schedule_event(time() + DAY_IN_SECONDS, 'daily', LicenseManager::CRON_HOOK);
        }

        // Tick recurrente del runner de triggers programados. Idempotente.
        ScheduledRunner::ensureScheduled();

        flush_rewrite_rules();
    }
}
