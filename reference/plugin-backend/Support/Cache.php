<?php
declare(strict_types=1);

namespace ImaginaCRM\Support;

/**
 * Wrapper sobre el object cache de WordPress (`wp_cache_*`).
 *
 * - Funciona transparente con o sin drop-in persistente. Si hay
 *   Redis/Memcached vía `wp_using_ext_object_cache()`, los reads
 *   sobreviven entre requests y la ganancia es enorme. Si no, el
 *   cache es per-request (todavía útil para deduplicar reads
 *   dentro del mismo render).
 *
 * - Group fijo `imagina_crm` para poder hacer flush masivo cuando
 *   schema change (rename slug, ALTER TABLE, plugin upgrade).
 *
 * - Invalidación automática enganchada a los hooks de write del
 *   plugin (`imagina_crm/list_*`, `imagina_crm/field_*`). El
 *   módulo cliente solo hace `get`/`set`; no se preocupa por
 *   invalidar — `Cache::registerInvalidationHooks()` lo orquesta
 *   en el bootstrap.
 *
 * - Settings toggle (`imcrm_object_cache_enabled` option, default
 *   `true`) para emergency-disable si hay un drop-in con bug.
 */
final class Cache
{
    public const GROUP = 'imagina_crm';

    /** Disabled flag — leído desde wp_options al primer uso. */
    private ?bool $enabled = null;

    /**
     * `true` si hay un drop-in persistente activo (Redis,
     * Memcached, etc.). En ese caso los reads sobreviven entre
     * requests y la ganancia escala con el tráfico. Lo usamos para
     * decidir TTLs más agresivos.
     */
    public function isPersistent(): bool
    {
        return function_exists('wp_using_ext_object_cache')
            && (bool) wp_using_ext_object_cache();
    }

    public function isEnabled(): bool
    {
        if ($this->enabled !== null) {
            return $this->enabled;
        }
        if (! function_exists('get_option')) {
            return $this->enabled = true;
        }
        $opt = get_option('imcrm_object_cache_enabled', '1');
        $this->enabled = $opt !== '0' && $opt !== false && $opt !== 0;
        return $this->enabled;
    }

    /**
     * @template T
     * @param callable(): T $loader  Función que produce el valor si no
     *                               hay cache hit. Solo se invoca en miss.
     * @return T
     */
    public function remember(string $key, callable $loader, int $ttl = 0): mixed
    {
        if (! $this->isEnabled() || ! function_exists('wp_cache_get')) {
            return $loader();
        }
        $found = false;
        $value = wp_cache_get($key, self::GROUP, false, $found);
        if ($found) {
            return $value;
        }
        $value = $loader();
        // wp_cache_set con TTL=0 = cache permanente (hasta flush).
        // Para entries hot que rarrara cambian (field metadata,
        // list metadata) eso es lo que queremos — las hooks de
        // invalidación se encargan al write.
        wp_cache_set($key, $value, self::GROUP, $ttl);
        return $value;
    }

    public function get(string $key): mixed
    {
        if (! $this->isEnabled() || ! function_exists('wp_cache_get')) {
            return null;
        }
        $found = false;
        $value = wp_cache_get($key, self::GROUP, false, $found);
        return $found ? $value : null;
    }

    public function set(string $key, mixed $value, int $ttl = 0): bool
    {
        if (! $this->isEnabled() || ! function_exists('wp_cache_set')) {
            return false;
        }
        return (bool) wp_cache_set($key, $value, self::GROUP, $ttl);
    }

    public function delete(string $key): bool
    {
        if (! function_exists('wp_cache_delete')) {
            return false;
        }
        return (bool) wp_cache_delete($key, self::GROUP);
    }

    /**
     * Flush completo del group. Intenta `wp_cache_flush_group` (WP
     * 6.1+ con drop-ins compatibles); si no existe, fallback a un
     * "salt" que invalida todas las keys del group bumpeando el
     * prefijo en wp_options.
     */
    public function flushGroup(): void
    {
        if (function_exists('wp_cache_flush_group')) {
            wp_cache_flush_group(self::GROUP);
            return;
        }
        // Fallback: bump version stored in option. Las keys se
        // construyen con `Cache::keyForList()` etc. que incluyen
        // el version prefix; al bumpearlo, todas las viejas se
        // vuelven inalcanzables.
        if (function_exists('update_option')) {
            $current = (int) get_option('imcrm_cache_version', 1);
            // OJO: tercer arg `false` = NO autoload. Auditoría
            // (0.28.0): TODAS las options del plugin usan
            // autoload=false. Si agregas options nuevas, mantén
            // la convención — un autoload=yes con valor pesado
            // enlentece TODA la admin de WP, no solo el plugin.
            update_option('imcrm_cache_version', $current + 1, false);
        }
    }

    /**
     * Versioned key — incluye `imcrm_cache_version` para que el
     * fallback de `flushGroup()` (sin `wp_cache_flush_group`) sea
     * efectivo. Drop-ins modernos ignoran el prefix porque
     * `flush_group` ya invalida.
     */
    public function key(string $namespace, int|string $id): string
    {
        $version = function_exists('get_option')
            ? (int) get_option('imcrm_cache_version', 1)
            : 1;
        return "v{$version}:{$namespace}:{$id}";
    }

    /**
     * Engancha invalidación automática a los hooks del plugin.
     * Se llama una vez en el bootstrap (`Plugin::register()`).
     *
     * Estrategia conservadora: cualquier write a list/field invalida
     * el group entero. El costo del flush es despreciable comparado
     * con el riesgo de servir stale fields después de un schema
     * change (renombrar slug, alterar columna, etc.).
     */
    public function registerInvalidationHooks(): void
    {
        if (! function_exists('add_action')) {
            return;
        }
        $flush = function (): void {
            $this->flushGroup();
        };
        // Lists
        add_action('imagina_crm/list_created', $flush);
        add_action('imagina_crm/list_updated', $flush);
        add_action('imagina_crm/list_deleted', $flush);
        add_action('imagina_crm/list_slug_renamed', $flush);
        // Fields
        add_action('imagina_crm/field_created', $flush);
        add_action('imagina_crm/field_updated', $flush);
        add_action('imagina_crm/field_deleted', $flush);
        add_action('imagina_crm/field_slug_renamed', $flush);
        add_action('imagina_crm/fields_reordered', $flush);
        // Schema upgrade
        add_action('imagina_crm/schema_upgraded', $flush);
    }
}
