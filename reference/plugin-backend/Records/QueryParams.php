<?php
declare(strict_types=1);

namespace ImaginaCRM\Records;

/**
 * DTO con los parámetros normalizados de una consulta de records.
 *
 * Existe para mantener `QueryBuilder::buildSelect()` con una firma
 * estable y para que la validación de inputs (operadores conocidos,
 * límites de paginación, máximo de filtros) ocurra en un único lugar.
 */
final class QueryParams
{
    public const MAX_FILTERS  = 5;
    public const MAX_PER_PAGE = 500;

    /**
     * @param array<int, array{column:string, operator:string, value:mixed}> $filters
     * @param array<int, array{column:string, direction:string}>             $sort
     * @param array<int, string>                                              $fields
     */
    public function __construct(
        public readonly int $page,
        public readonly int $perPage,
        public readonly array $filters,
        public readonly array $sort,
        public readonly array $fields,
        public readonly ?string $search,
        public readonly bool $includeDeleted,
        /**
         * Cursor opt-in para keyset pagination. Cuando es int >0, el
         * QueryBuilder agrega `WHERE id < cursor ORDER BY id DESC LIMIT
         * perPage` (mantiene constante el costo del query a cualquier
         * profundidad — mientras OFFSET degrada lineal con el offset).
         * Si es null, fallback a OFFSET tradicional (compat con
         * page-jumps directos del UI).
         *
         * Solo se usa cuando el sort es por defecto (id DESC) o ID
         * explícito; si hay sort custom, el QueryBuilder lo ignora
         * porque keyset por id solo no garantiza el orden estable.
         */
        public readonly ?int $cursor = null,
    ) {
    }
}
