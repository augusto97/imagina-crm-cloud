<?php
declare(strict_types=1);

namespace ImaginaCRM\Support;

use wpdb;

/**
 * Adaptador delgado sobre `wpdb` para inyección por constructor.
 *
 * Centraliza la generación de nombres de tabla con el prefijo `imcrm_` y
 * expone helpers tipados. NO añade lógica de queries — eso vive en cada
 * Repository. La idea es solamente desterrar `global $wpdb` del código de
 * dominio y poder mockear en tests.
 */
final class Database
{
    public function __construct(private readonly wpdb $wpdb)
    {
    }

    public function wpdb(): wpdb
    {
        return $this->wpdb;
    }

    /**
     * Devuelve el nombre completo de una tabla del sistema (sufijo `imcrm_*`).
     *
     * @param string $name P.ej. "lists", "fields", "slug_history".
     */
    public function systemTable(string $name): string
    {
        return $this->wpdb->prefix . 'imcrm_' . $name;
    }

    /**
     * Devuelve el nombre físico de la tabla de datos de una lista.
     *
     * El `tableSuffix` debe haber sido sanitizado y validado por
     * `SlugManager::generateUnique()` antes de llegar aquí.
     */
    public function dataTable(string $tableSuffix): string
    {
        return $this->wpdb->prefix . 'imcrm_data_' . $tableSuffix;
    }

    public function charsetCollate(): string
    {
        return $this->wpdb->get_charset_collate();
    }

    public function prefix(): string
    {
        return $this->wpdb->prefix;
    }

    public function lastInsertId(): int
    {
        return (int) $this->wpdb->insert_id;
    }
}
