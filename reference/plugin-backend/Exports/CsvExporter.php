<?php
declare(strict_types=1);

namespace ImaginaCRM\Exports;

use ImaginaCRM\Fields\FieldEntity;
use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Imports\CsvParser;
use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Records\RecordService;

/**
 * Exporta los registros de una lista a CSV — dump bulk, opcionalmente
 * filtrado y/o limitado a un subset de campos visibles. Reusa la
 * pipeline de `RecordService::list` (mismas reglas de visibilidad,
 * filtros y soft-delete que la vista Table) para que lo que el
 * usuario ve en pantalla sea exactamente lo que se exporta.
 *
 * Hard cap de 50 000 registros para que el endpoint no se cuelgue
 * en listas gigantes — más allá habría que streamear con un
 * generator y `flush()` por chunks. Para el MVP es suficiente.
 */
final class CsvExporter
{
    private const MAX_ROWS = 50000;
    private const PAGE_SIZE = 500;

    public function __construct(
        private readonly FieldRepository $fields,
        private readonly RecordService $records,
    ) {
    }

    /**
     * @param array<int, int>|null      $fieldIds Campos a incluir (en
     *                                            orden). Si es null/vacío
     *                                            se incluyen todos los
     *                                            no-relation/no-computed.
     * @param array<string, mixed>|null $filterTree Mismo árbol que el
     *                                              que aceptan los
     *                                              widgets / saved views.
     */
    /**
     * @param list<int>|null                                  $fieldIds
     * @param array<string, mixed>|null                       $filterTree
     * @param array{sql:string, args:array<int, mixed>}|null  $additionalWhere
     * @param string                                          $delimiter  CSV delimiter (`,` default, `;` para locales europeos).
     * @param bool                                            $withBom    Si true, prepende UTF-8 BOM — Excel respeta el encoding al abrir. (Fase 15.B)
     */
    public function export(
        ListEntity $list,
        ?array $fieldIds = null,
        ?array $filterTree = null,
        ?array $additionalWhere = null,
        string $delimiter = ',',
        bool $withBom = false,
    ): string {
        $allFields  = $this->fields->allForList($list->id);
        $exportable = array_values(array_filter(
            $allFields,
            static fn (FieldEntity $f): bool => $f->type !== 'relation' && $f->deletedAt === null,
        ));

        // Si el caller pasó IDs explícitos, respetamos su orden y
        // filtramos a esos. Si no, exportamos todos los exportables.
        /** @var array<int, FieldEntity> $columns */
        $columns = [];
        if (is_array($fieldIds) && $fieldIds !== []) {
            $byId = [];
            foreach ($exportable as $f) {
                $byId[$f->id] = $f;
            }
            foreach ($fieldIds as $id) {
                if (isset($byId[$id])) {
                    $columns[] = $byId[$id];
                }
            }
        }
        if ($columns === []) {
            $columns = $exportable;
        }

        $headers = array_map(static fn (FieldEntity $f): string => $f->label, $columns);
        $rows    = $this->fetchRows($list, $columns, $filterTree, $additionalWhere);

        // Whitelist de delimiters — solo comma o semicolon. Cualquier
        // otra cosa (incluyendo tab '\t') se normaliza a ',' por
        // seguridad: un delimiter custom inyectado podría producir
        // CSVs malformados.
        $safeDelimiter = $delimiter === ';' ? ';' : ',';

        $csv = CsvParser::build($headers, $rows, $safeDelimiter);

        if ($withBom) {
            // UTF-8 BOM. Excel respeta el encoding cuando abre el
            // archivo y los acentos no se rompen. Solo ~3 bytes
            // extra al inicio del file.
            $csv = "\xEF\xBB\xBF" . $csv;
        }

        return $csv;
    }

    /**
     * @param array<int, FieldEntity>                         $columns
     * @param array<string, mixed>|null                       $filterTree
     * @param array{sql:string, args:array<int, mixed>}|null  $additionalWhere
     * @return array<int, array<int, string>>
     */
    private function fetchRows(ListEntity $list, array $columns, ?array $filterTree, ?array $additionalWhere = null): array
    {
        $rows  = [];
        $page  = 1;
        $total = 0;

        while ($total < self::MAX_ROWS) {
            $result = $this->records->list(
                list:            $list,
                filters:         [],
                sort:            [],
                fields:          [],
                search:          null,
                page:            $page,
                perPage:         self::PAGE_SIZE,
                filterTree:      $filterTree,
                cursor:          null,
                additionalWhere: $additionalWhere,
            );
            if (! is_array($result) || ! isset($result['data']) || ! is_array($result['data'])) {
                break;
            }
            $batch = $result['data'];
            if ($batch === []) {
                break;
            }
            foreach ($batch as $record) {
                $rows[] = $this->serializeRow($record, $columns);
                $total++;
                if ($total >= self::MAX_ROWS) {
                    break 2;
                }
            }
            // Si el batch fue menor que la página, no hay más datos.
            if (count($batch) < self::PAGE_SIZE) {
                break;
            }
            $page++;
        }

        return $rows;
    }

    /**
     * @param array<string, mixed>    $record
     * @param array<int, FieldEntity> $columns
     * @return array<int, string>
     */
    private function serializeRow(array $record, array $columns): array
    {
        $fieldsMap   = is_array($record['fields'] ?? null) ? $record['fields'] : [];
        $relationsMap = is_array($record['relations'] ?? null) ? $record['relations'] : [];

        $out = [];
        foreach ($columns as $field) {
            // `relation` quedó filtrado arriba pero por defensa.
            if ($field->type === 'relation') {
                $out[] = '';
                continue;
            }
            $value = $fieldsMap[$field->slug] ?? null;
            $out[] = $this->stringifyValue($value, $field);
            unset($relationsMap); // unused; reservado por si exportamos relaciones en el futuro
        }
        return $out;
    }

    private function stringifyValue(mixed $value, FieldEntity $field): string
    {
        if ($value === null || $value === '') {
            return '';
        }
        return match ($field->type) {
            'multi_select' => is_array($value) ? implode(', ', array_map('strval', $value)) : (string) $value,
            'checkbox'     => ($value === true || $value === 1 || $value === '1') ? '1' : '0',
            default        => is_scalar($value) ? (string) $value : (string) wp_json_encode($value),
        };
    }
}
