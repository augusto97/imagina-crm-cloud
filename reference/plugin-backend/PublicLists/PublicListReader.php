<?php
declare(strict_types=1);

namespace ImaginaCRM\PublicLists;

use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Support\ValidationResult;

/**
 * Interfaz de lectura para consumidores anónimos de listas públicas
 * (Shortcode, PublicListsController, bloque Gutenberg server-render).
 *
 * Separada de `PublicListService` para que tests puedan implementar
 * fakes sin extender la clase final.
 */
interface PublicListReader
{
    public function findPublicList(string $slug): ?ListEntity;

    public function configFor(ListEntity $list): PublicListConfig;

    /**
     * @return array<string, mixed>
     */
    public function metaFor(ListEntity $list): array;

    /**
     * @param array{
     *     page?: int,
     *     per_page?: int,
     *     search?: ?string,
     *     sort?: ?string,
     *     filter?: array<string, mixed>
     * } $params
     *
     * @return array{
     *     data: list<array<string, mixed>>,
     *     meta: array{page:int, per_page:int, total:int, total_pages:int}
     * }|ValidationResult
     */
    public function fetchRecords(ListEntity $list, array $params): array|ValidationResult;
}
