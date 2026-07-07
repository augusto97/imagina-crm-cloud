<?php
declare(strict_types=1);

namespace ImaginaCRM\Activation;

use ImaginaCRM\Automations\ScheduledRunner;
use ImaginaCRM\Licensing\LicenseManager;

/**
 * Desactivación del plugin.
 *
 * No borra datos. Sólo limpia transients propios, desprograma el cron de
 * licencia y resetea rewrite rules. La eliminación real de tablas vive en
 * uninstall.php y depende del flag `imcrm_purge_on_uninstall` (ADR-007 —
 * los datos del cliente se preservan).
 */
final class Deactivator
{
    public static function deactivate(): void
    {
        flush_rewrite_rules();

        $next = wp_next_scheduled(LicenseManager::CRON_HOOK);
        if ($next !== false) {
            wp_unschedule_event($next, LicenseManager::CRON_HOOK);
        }

        // Quita el tick recurrente del scheduled runner para no dejar
        // jobs huérfanos cuando el plugin se desactiva.
        ScheduledRunner::unschedule();

        global $wpdb;

        $wpdb->query(
            $wpdb->prepare(
                "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
                $wpdb->esc_like('_transient_imcrm_') . '%',
                $wpdb->esc_like('_transient_timeout_imcrm_') . '%'
            )
        );
    }
}
