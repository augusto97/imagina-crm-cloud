<?php
declare(strict_types=1);

namespace ImaginaCRM\Records;

/**
 * Genera ETag determinísticos para responses de records y
 * notifica invalidación cuando la data subyacente cambia.
 *
 * Estrategia: cada lista mantiene un counter en `wp_options`
 * (`imcrm_list_version_<id>`). El counter se bumpea en cada
 * `record_*` hook. El ETag de un GET es `hash(version + query
 * params)`. Mismo query con misma version → mismo ETag → 304
 * Not Modified — sin serializar el JSON ni hacer queries.
 *
 * Ganancia real cuando el frontend hace refetch agresivo de la
 * misma vista (típico en TanStack Query con `refetchOnFocus` o
 * navegación entre tabs).
 */
final class RecordsETag
{
    private const OPTION_PREFIX = 'imcrm_list_version_';

    /**
     * Versión actual de la lista. 1 al inicio. Cualquier escritura
     * la bumpea — el ETag cambia y el browser rebusca.
     */
    public function getVersion(int $listId): int
    {
        if (! function_exists('get_option')) {
            return 1;
        }
        return (int) get_option(self::OPTION_PREFIX . $listId, 1);
    }

    public function bump(int $listId): void
    {
        if (! function_exists('update_option')) {
            return;
        }
        $current = $this->getVersion($listId);
        update_option(self::OPTION_PREFIX . $listId, $current + 1, false);
    }

    /**
     * Hash determinístico de (version, queryContext). Mismo input
     * exactamente igual ⇒ mismo hash. Cualquier diff (filter,
     * sort, page, una nueva escritura...) ⇒ hash distinto.
     *
     * @param array<string, mixed> $context
     */
    public function compute(int $listId, array $context): string
    {
        $version = $this->getVersion($listId);
        $payload = [
            'list' => $listId,
            'v'    => $version,
            'ctx'  => $context,
        ];
        // md5 es suficiente para ETag — no es seguridad, solo
        // identidad. Más rápido que sha256 y el espacio de colisión
        // (2^128) es astronómicamente seguro para este caso.
        return md5((string) wp_json_encode($payload));
    }

    /**
     * Engancha bumps automáticos. Se llama en bootstrap. Cualquier
     * write a un record de la lista X invalida los ETags
     * dependientes de la versión de X.
     */
    public function registerInvalidationHooks(): void
    {
        if (! function_exists('add_action')) {
            return;
        }
        $bump = function (mixed $listOrId): void {
            $id = is_int($listOrId) ? $listOrId
                : (is_object($listOrId) && property_exists($listOrId, 'id') ? (int) $listOrId->id : 0);
            if ($id > 0) {
                $this->bump($id);
            }
        };
        add_action('imagina_crm/record_created', $bump, 10, 1);
        add_action('imagina_crm/record_updated', $bump, 10, 1);
        add_action('imagina_crm/record_deleted', $bump, 10, 1);
        add_action('imagina_crm/import_finished', $bump, 10, 1);
        // Cambios de schema invalidan ETags también — si renombras
        // un slug, los responses con ese slug ya no son válidos.
        // `field_updated` dispara con (updated, current, list) — el
        // closure recibe el primero (la entity nueva) que tiene
        // `->listId`. La firma `mixed $listOrId` ya cubre eso por
        // `is_object && property_exists`.
        add_action('imagina_crm/field_updated', function ($updated): void {
            if (is_object($updated) && property_exists($updated, 'listId')) {
                $this->bump((int) $updated->listId);
            }
        }, 10, 1);
        add_action('imagina_crm/field_slug_renamed', $bump, 10, 1);
    }
}
