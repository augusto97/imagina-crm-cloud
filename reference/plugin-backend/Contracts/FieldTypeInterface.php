<?php
declare(strict_types=1);

namespace ImaginaCRM\Contracts;

use ImaginaCRM\Support\ValidationResult;

/**
 * Contrato de un tipo de campo (CLAUDE.md §8).
 *
 * Cada tipo conoce:
 * - Su slug y label visibles.
 * - Cómo se mapea a una columna SQL (`getSqlDefinition`). Devuelve `''`
 *   cuando el tipo NO crea columna en la tabla dinámica (caso `relation`,
 *   que vive en `wp_imcrm_relations`).
 * - Cómo validar un valor entrante.
 * - Cómo serializarlo para escribir en BD y des-serializarlo al leer.
 * - Su esquema de configuración (lo que `wp_imcrm_fields.config` puede
 *   contener), expuesto a la UI para construir formularios.
 */
interface FieldTypeInterface
{
    public function getSlug(): string;

    public function getLabel(): string;

    /**
     * @param array<string, mixed> $config
     */
    public function getSqlDefinition(array $config): string;

    /**
     * @param array<string, mixed> $config
     */
    public function validate(mixed $value, array $config): ValidationResult;

    /**
     * Convierte un valor recibido (frontend / REST) a su representación
     * persistida (string, int, JSON…). Puede devolver null para columnas
     * NULLABLE.
     *
     * @param array<string, mixed> $config
     */
    public function serialize(mixed $value, array $config): mixed;

    /**
     * Inverso de `serialize`: convierte la representación persistida en el
     * valor que ve la API/frontend.
     *
     * @param array<string, mixed> $config
     */
    public function unserialize(mixed $value, array $config): mixed;

    /**
     * Esquema declarativo de configuración para este tipo. Es lo que la UI
     * de FieldBuilder usa para pintar el panel lateral de "config avanzada"
     * de cada campo.
     *
     * Estructura (versionada informalmente):
     *
     *     [
     *         'options' => ['type' => 'array', 'items' => 'string', 'default' => []],
     *         'precision' => ['type' => 'integer', 'default' => 2, 'min' => 0, 'max' => 8],
     *         …
     *     ]
     *
     * @return array<string, array<string, mixed>>
     */
    public function getConfigSchema(): array;

    /**
     * `true` si el tipo soporta UNIQUE INDEX a nivel SQL. Tipos como
     * `multi_select` o `long_text` no lo soportan; el FieldService lo
     * consulta antes de aceptar `is_unique = true` desde la API.
     */
    public function supportsUnique(): bool;

    /**
     * `true` si el tipo materializa una columna en la tabla dinámica de la
     * lista. `false` para `relation`, que vive en `wp_imcrm_relations`.
     */
    public function hasColumn(): bool;
}
