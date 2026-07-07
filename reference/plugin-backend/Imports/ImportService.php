<?php
declare(strict_types=1);

namespace ImaginaCRM\Imports;

use ImaginaCRM\Fields\FieldEntity;
use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Fields\FieldService;
use ImaginaCRM\Fields\Types\ComputedField;
use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Records\RecordService;
use ImaginaCRM\Support\ValidationResult;

/**
 * Importa registros desde un CSV (export de ClickUp, Airtable, Excel
 * "Save as CSV", Google Sheets, …) hacia una lista de Imagina CRM.
 *
 * Flujo de UI (dos pasos):
 *  1. `preview()` — el cliente sube el CSV, mostramos cabeceras +
 *     muestra de las primeras filas + sugerencia de mapping
 *     `csv_column_index → field_slug` basada en match difuso del
 *     header con el label/slug de cada campo.
 *  2. `run()` — el cliente confirma el mapping y dispara el import.
 *     Cada fila se valida contra `RecordValidator` y se inserta vía
 *     `RecordService::create`. Errores por fila se acumulan; el
 *     resto continúa importándose.
 *
 * No usa transacciones porque MySQL no garantiza atomicidad sobre
 * múltiples inserts cuando hay hooks/automatizaciones que pueden
 * disparar updates. El cliente recibe un summary con éxitos/errores
 * para decidir qué hacer manualmente con los registros fallidos.
 */
final class ImportService
{
    /** Cuántas filas devolvemos en el preview. */
    private const PREVIEW_ROWS = 20;

    /** Hard cap para no sobrecargar el servidor de un solo shot. */
    private const MAX_ROWS_PER_RUN = 5000;

    public function __construct(
        private readonly FieldRepository $fields,
        private readonly RecordService $records,
        private readonly FieldService $fieldService,
    ) {
    }

    /**
     * Inspecciona el CSV sin escribir nada. Devuelve cabeceras,
     * filas de muestra, sugerencias de mapping y un `suggested_type`
     * por columna (útil cuando el usuario quiere crear un campo
     * nuevo desde la UI).
     *
     * @return array{
     *     headers: array<int, string>,
     *     sample: array<int, array<int, string>>,
     *     total_rows: int,
     *     suggested_mapping: array<int, string>,
     *     suggested_types: array<int, string>,
     *     fields: array<int, array{id:int, slug:string, label:string, type:string}>
     * }
     */
    public function preview(ListEntity $list, string $csv): array
    {
        $parsed     = CsvParser::parse($csv);
        $headers    = $parsed['headers'];
        $rows       = $parsed['rows'];
        $listFields = $this->importableFields($list);
        $suggested  = $this->suggestMapping($headers, $listFields);

        // Inferir tipo por columna a partir de la muestra. La UI lo
        // usa como default cuando el usuario elige "crear campo nuevo"
        // para una columna que no mapea a ninguno existente.
        $sample           = array_slice($rows, 0, self::PREVIEW_ROWS);
        $suggestedTypes   = [];
        foreach ($headers as $idx => $_header) {
            $columnSample = [];
            foreach ($sample as $row) {
                $columnSample[] = $row[$idx] ?? '';
            }
            $suggestedTypes[$idx] = FieldTypeDetector::detect($columnSample);
        }

        return [
            'headers'           => $headers,
            'sample'            => $sample,
            'total_rows'        => count($rows),
            'suggested_mapping' => $suggested,
            'suggested_types'   => $suggestedTypes,
            'fields'            => array_map(
                static fn (FieldEntity $f): array => [
                    'id'          => $f->id,
                    'slug'        => $f->slug,
                    'label'       => $f->label,
                    'type'        => $f->type,
                    'is_required' => $f->isRequired,
                ],
                $listFields,
            ),
        ];
    }

    /**
     * Ejecuta el import. `$mapping` es `csv_column_index → field_slug`
     * para campos ya existentes; `$newFields` permite crear campos
     * sobre la marcha (uno por columna del CSV no mapeada). Las
     * columnas no incluidas en ninguno de los dos se ignoran.
     *
     * Antes de iterar las filas:
     *  1. Crea los campos pedidos en `$newFields` (si los hay).
     *  2. Para columnas mapeadas a `select`/`multi_select`, escanea
     *     todas las filas y añade automáticamente cualquier valor
     *     que no exista todavía como opción del campo. ClickUp emite
     *     etiquetas como "sin factura", "Vencido" — no slugs — así
     *     que sin esto el validator rechazaría 100% de las filas.
     *
     * @param array<int, string>                                                $mapping
     * @param array<int, array{csv_column_index:int, label:string, type:string}> $newFields
     *
     * @return array{
     *     imported: int,
     *     skipped: int,
     *     errors: array<int, array{row:int, message:string}>,
     *     truncated: bool,
     *     created_fields: array<int, array{slug:string, label:string, type:string}>,
     *     expanded_options: array<string, array<int, array{value:string, label:string}>>
     * }
     */
    public function run(ListEntity $list, string $csv, array $mapping, array $newFields = []): array
    {
        $parsed  = CsvParser::parse($csv);
        $rows    = $parsed['rows'];
        $headers = $parsed['headers'] ?? [];

        // Crear primero los campos nuevos (si los hay). El user puede
        // haber pedido "crear nuevo" para columnas sin mapping en la
        // lista actual. Errores de creación se reportan en `errors`
        // como filas virtuales con row=0 y la columna como referencia.
        $createdFields = [];
        $errors        = [];
        $cellWarnings  = []; // celdas con data que no se importaron (silent drops antes)
        foreach ($newFields as $spec) {
            $idx   = (int) ($spec['csv_column_index'] ?? -1);
            $label = trim((string) ($spec['label'] ?? ''));
            $type  = (string) ($spec['type'] ?? 'text');
            if ($idx < 0 || $label === '') {
                continue;
            }
            $created = $this->fieldService->create($list->id, [
                'label' => $label,
                'type'  => $type,
            ]);
            if ($created instanceof ValidationResult) {
                $errors[] = [
                    'row'     => 0,
                    'message' => sprintf(
                        /* translators: 1: column label, 2: validation message */
                        __('No se pudo crear el campo "%1$s": %2$s', 'imagina-crm'),
                        $label,
                        $this->summarizeValidation($created),
                    ),
                ];
                continue;
            }
            // Inyectamos el slug recién creado al mapping para que la
            // segunda fase use la columna como cualquier otra.
            $mapping[$idx]   = $created->slug;
            $createdFields[] = [
                'slug'  => $created->slug,
                'label' => $created->label,
                'type'  => $created->type,
            ];
        }

        $listFields = $this->importableFields($list);

        // Auto-expandir opciones de selects/multi_selects con valores
        // que aparezcan en el CSV pero no en la config actual del campo.
        $expandedOptions = $this->expandSelectOptions($list, $rows, $mapping, $listFields);

        // Si expandimos algo, refrescamos los campos para que el
        // resolver de cell values tenga las opciones actualizadas.
        if ($expandedOptions !== []) {
            $listFields = $this->importableFields($list);
        }

        $bySlug = [];
        foreach ($listFields as $f) {
            $bySlug[$f->slug] = $f;
        }

        $truncated = false;
        if (count($rows) > self::MAX_ROWS_PER_RUN) {
            $rows      = array_slice($rows, 0, self::MAX_ROWS_PER_RUN);
            $truncated = true;
        }

        $imported = 0;
        $skipped  = 0;

        // Detectar columnas del CSV que tienen datos pero NO están en
        // el mapping — antes se silenciaban completamente. Ahora las
        // reportamos al user para que sepa que sus datos quedan fuera.
        $mappedIndices = array_keys($mapping);
        $unmappedColumnsWithData = [];
        foreach ($headers as $colIdx => $header) {
            if (in_array($colIdx, $mappedIndices, true)) continue;
            $rowsWithData = 0;
            $sample = '';
            foreach ($rows as $row) {
                $cell = trim((string) ($row[$colIdx] ?? ''));
                if ($cell !== '') {
                    $rowsWithData++;
                    if ($sample === '') $sample = mb_substr($cell, 0, 60);
                }
            }
            if ($rowsWithData > 0) {
                $unmappedColumnsWithData[] = [
                    'column_index' => $colIdx,
                    'header'       => (string) $header,
                    'rows_with_data' => $rowsWithData,
                    'sample'       => $sample,
                ];
            }
        }

        // Stage de filas válidas (no vacías) para procesar en bulk.
        // Mantenemos `originalRowNumber` para reportar errores con
        // el número de fila CSV correcto (1-indexed + header).
        /** @var array<int, array{values: array<string, mixed>, rowNumber: int}> $stagedRows */
        $stagedRows = [];
        foreach ($rows as $idx => $row) {
            $rowNumber = $idx + 2; // +1 por header, +1 para human-friendly

            $values = [];
            foreach ($mapping as $colIdx => $slug) {
                if (! isset($bySlug[$slug])) continue;
                $rawCell = $row[$colIdx] ?? '';
                $rawTrimmed = trim((string) $rawCell);
                $field   = $bySlug[$slug];
                $coerced = $this->coerceCellValue($rawCell, $field);
                // Celdas vacías se OMITEN del payload — no se mandan
                // como null. Eso permite que un campo `is_required`
                // no rebote contra filas individuales que lo traen
                // vacío. Validator en partial:true.
                if ($coerced === null || $coerced === '' || $coerced === []) {
                    // 0.36.5 fix: si la raw NO estaba vacía pero el
                    // coerce devolvió null/empty, es un silent drop —
                    // antes se perdía sin avisar. Ahora lo reportamos.
                    if ($rawTrimmed !== '') {
                        $cellWarnings[] = [
                            'row'         => $rowNumber,
                            'column_index' => $colIdx,
                            'header'      => (string) ($headers[$colIdx] ?? ''),
                            'field_slug'  => $slug,
                            'field_label' => $field->label,
                            'field_type'  => $field->type,
                            'raw'         => mb_substr($rawTrimmed, 0, 100),
                            'reason'      => 'coerce_empty',
                        ];
                    }
                    continue;
                }
                $values[$slug] = $coerced;
            }
            // Fila completamente vacía → skip silencioso.
            if ($values === []) {
                $skipped++;
                continue;
            }
            $stagedRows[] = ['values' => $values, 'rowNumber' => $rowNumber];
        }

        // Bulk insert: una sola INSERT con 200 VALUES por chunk.
        // En hosting con RTT >5ms esto es ~10× más rápido que
        // N inserts individuales — para 5000 filas, ~25s pasa a
        // ~3s solo en network.
        //
        // `silentHooks: true`: no disparamos `imagina_crm/record_created`
        // por cada uno de los 5000. Eso evita que cada record gatille
        // automations, eventual search reindex, listeners de logging,
        // etc. — multiplicaría el tiempo del import por N. En lugar,
        // disparamos UN solo `imagina_crm/import_finished` al final
        // que los listeners pueden usar para hacer el trabajo en
        // bulk (ej. el motor de búsqueda v0.30.0 va a re-indexar la
        // lista entera en una pasada, no record por record).
        $valuesList = array_map(static fn (array $s): array => $s['values'], $stagedRows);
        $bulkResult = $this->records->bulkCreate($list, $valuesList, partial: true, silentHooks: true);
        $imported = count($bulkResult['created']);

        // Notificar fin de import. Si hay Action Scheduler instalado
        // (lo está en este plugin como dep), encolar async para no
        // bloquear la response del import; sino, dispatch sync.
        $createdIds = $bulkResult['created'];
        if (function_exists('as_enqueue_async_action')) {
            as_enqueue_async_action(
                'imagina_crm/import_finished',
                [$list->id, $createdIds],
                'imagina-crm',
            );
        } else {
            do_action('imagina_crm/import_finished', $list->id, $createdIds);
        }
        // Mapear errors del bulk (que vienen con `index` 0-based en
        // staged) al rowNumber del CSV original.
        foreach ($bulkResult['errors'] as $err) {
            $stagedIdx = $err['index'] ?? -1;
            $rowNumber = $stagedRows[$stagedIdx]['rowNumber'] ?? 0;
            $errors[] = [
                'row'     => $rowNumber,
                'message' => $err['message'] ?? __('Error.', 'imagina-crm'),
            ];
            $skipped++;
        }

        return [
            'imported'         => $imported,
            'skipped'          => $skipped,
            'errors'           => $errors,
            'truncated'        => $truncated,
            'created_fields'   => $createdFields,
            'expanded_options' => $expandedOptions,
            // 0.36.5: visibility en silent drops. `cell_warnings`
            // lista celdas con datos que no se importaron por
            // coerce_empty (raw no parseable al tipo del field).
            // `unmapped_columns_with_data` lista columnas del CSV
            // que el user dejó sin mapping pero traían datos —
            // antes se descartaban en silencio.
            'cell_warnings'              => $cellWarnings,
            'unmapped_columns_with_data' => $unmappedColumnsWithData,
        ];
    }

    /**
     * Convierte el string del CSV al shape que espera
     * `RecordValidator` para cada tipo de campo. Best-effort:
     * los errores de tipo los reporta el validator (con mensajes
     * por campo) en `run()`.
     */
    private function coerceCellValue(string $raw, FieldEntity $field): mixed
    {
        $trimmed = trim($raw);
        if ($trimmed === '') {
            return $field->type === 'multi_select' ? [] : null;
        }

        return match ($field->type) {
            // select: ClickUp/Airtable persisten la etiqueta humana
            // ("Vencido", "sin factura"), no el slug. Buscamos por
            // label o por value (case-insensitive); las opciones que
            // no existan ya fueron auto-añadidas por
            // `expandSelectOptions` antes de este loop, así que
            // esperamos encontrar siempre el slug.
            'select' => self::resolveSelectValue($trimmed, $field),

            // multi_select: split por `,` o `;`, luego resolver cada
            // ítem al slug.
            'multi_select' => array_values(array_filter(
                array_map(
                    fn (string $v): string => self::resolveSelectValue(trim($v), $field),
                    preg_split('/[,;]/', $trimmed) ?: [],
                ),
                static fn (string $v): bool => $v !== '',
            )),

            // checkbox: aceptamos true/false, 1/0, sí/no, x/blank.
            'checkbox' => self::parseBool($trimmed),

            // number/currency: limpiar separadores de miles.
            'number', 'currency' => self::parseNumber($trimmed),

            // user/file: ID numérico.
            'user', 'file' => is_numeric($trimmed) ? (int) $trimmed : $trimmed,

            // date/datetime: dejamos el string; el validator parsea.
            // Si viene en formato local "DD/MM/YYYY" lo convertimos.
            'date', 'datetime' => self::normalizeDate($trimmed, $field->type),

            default => $trimmed,
        };
    }

    /**
     * Resuelve un valor crudo del CSV (típicamente la etiqueta humana)
     * al `value` correcto de la opción. Match case-insensitive
     * primero por label exacto, después por value exacto.
     *
     * Si no encontramos match, devolvemos el string crudo — el
     * validator lo rechazará con "Opción no válida" y la fila irá a
     * `errors`. En la práctica `expandSelectOptions` se ejecuta antes
     * y cubre todos los valores presentes en el CSV.
     */
    private static function resolveSelectValue(string $raw, FieldEntity $field): string
    {
        if ($raw === '') {
            return '';
        }
        $options = is_array($field->config['options'] ?? null) ? $field->config['options'] : [];
        $needle  = self::ciKey($raw);
        foreach ($options as $opt) {
            if (! is_array($opt)) {
                if (is_string($opt) && self::ciKey($opt) === $needle) {
                    return $opt;
                }
                continue;
            }
            $value = isset($opt['value']) ? (string) $opt['value'] : '';
            $label = isset($opt['label']) ? (string) $opt['label'] : $value;
            if (self::ciKey($label) === $needle || self::ciKey($value) === $needle) {
                return $value;
            }
        }
        return $raw;
    }

    /**
     * Lower-case multi-byte para comparaciones case-insensitive
     * sobre cadenas con tildes (ES) — `strtolower` solo lowercase
     * ASCII, así que "AL DÍA" no matchearía "al día" sin esto.
     */
    private static function ciKey(string $s): string
    {
        return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
    }

    private static function parseBool(string $v): bool
    {
        $low = strtolower($v);
        return in_array($low, ['1', 'true', 'yes', 'sí', 'si', 'x', 'on'], true);
    }

    private static function parseNumber(string $v): float|int|string
    {
        // Excel ES exporta "1.234,56"; mantenemos el último separador
        // como decimal y descartamos los demás (separadores de miles).
        $clean = $v;
        if (preg_match('/^-?[0-9]{1,3}(\.[0-9]{3})+(,[0-9]+)?$/', $v) === 1) {
            $clean = str_replace('.', '', $v);
            $clean = str_replace(',', '.', $clean);
        } elseif (str_contains($v, ',') && ! str_contains($v, '.')) {
            $clean = str_replace(',', '.', $v);
        }
        if (is_numeric($clean)) {
            return str_contains($clean, '.') ? (float) $clean : (int) $clean;
        }
        return $v;
    }

    /**
     * Normaliza una cadena de fecha a formato compatible con
     * `RecordValidator`:
     *  - `date`     → 'YYYY-MM-DD'
     *  - `datetime` → 'YYYY-MM-DD HH:MM:SS'
     *
     * Acepta:
     *  1. ISO 8601: 'YYYY-MM-DD' (canónico, devuelto sin tocar para
     *     `date` — para `datetime` con hora ya viene formateado).
     *  2. Slashed numéricos: 'DD/MM/YYYY' o 'MM/DD/YYYY' (Excel ES,
     *     ClickUp US). Heurística: si el primer grupo > 12, es DD/MM;
     *     si el segundo > 12, MM/DD; ambiguo → DD/MM (locale ES).
     *  3. Fallback: `DateTimeImmutable::__construct` parsea formatos
     *     humanos como "Thursday, May 21st 2026" o
     *     "Wednesday, January 21st 2026, 5:29:08 pm -05:00" — el
     *     parser nativo de PHP entiende nombres de día/mes y sufijos
     *     ordinales (1st, 2nd, 3rd, 21st). Es lo que ClickUp emite
     *     en sus exports CSV.
     *
     * Si nada parsea, devolvemos el string original — el validator
     * reportará "Fecha inválida" con el valor crudo para que el
     * usuario sepa qué celda revisar.
     */
    public static function normalizeDate(string $v, string $type): string
    {
        // 1. Ya en formato ISO. Cuando el destino es `date` y el input
        // viene con cola de hora/zona (ej. ClickUp emite
        // "2024-07-23T00:00:00.000+00:00" para campos de fecha sin hora),
        // truncamos al `YYYY-MM-DD` — si no, `DateField::parse()` rechaza
        // el string entero por su validación estricta `Y-m-d`.
        if (preg_match('/^(\d{4}-\d{2}-\d{2})/', $v, $m) === 1) {
            return $type === 'date' ? $m[1] : $v;
        }
        // 2. Slashed numéricos.
        if (preg_match('/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(.*)$/', $v, $m) === 1) {
            $a    = (int) $m[1];
            $b    = (int) $m[2];
            $year = (int) $m[3];
            if ($year < 100) {
                $year += 2000;
            }
            $tail = (string) $m[4];
            if ($a > 12 && $b <= 12) {
                $day = $a; $month = $b;
            } elseif ($b > 12 && $a <= 12) {
                $day = $b; $month = $a;
            } else {
                $day = $a; $month = $b;
            }
            $iso = sprintf('%04d-%02d-%02d', $year, $month, $day);
            return $type === 'datetime' && trim($tail) !== '' ? $iso . ' ' . trim($tail) : $iso;
        }
        // 3. Fallback al parser nativo de PHP (cubre formatos humanos
        // como ClickUp).
        try {
            $d = new \DateTimeImmutable($v);
            return $type === 'datetime'
                ? $d->format('Y-m-d H:i:s')
                : $d->format('Y-m-d');
        } catch (\Throwable) {
            return $v;
        }
    }

    /**
     * Sugiere `csv_column_index → field_slug` basado en match difuso
     * del header CSV con label/slug de cada campo. Usamos
     * `similar_text()` que devuelve un score 0-100. Threshold > 60
     * para minimizar falsos positivos.
     *
     * @param array<int, string>          $headers
     * @param array<int, FieldEntity>     $listFields
     * @return array<int, string>
     */
    private function suggestMapping(array $headers, array $listFields): array
    {
        $suggestions = [];
        $usedSlugs   = [];
        foreach ($headers as $idx => $header) {
            $bestSlug  = null;
            $bestScore = 0.0;
            foreach ($listFields as $f) {
                if (in_array($f->slug, $usedSlugs, true)) {
                    continue;
                }
                $candidates = [
                    self::normalize($f->slug),
                    self::normalize($f->label),
                ];
                foreach ($candidates as $cand) {
                    similar_text(self::normalize($header), $cand, $score);
                    if ($score > $bestScore) {
                        $bestScore = $score;
                        $bestSlug  = $f->slug;
                    }
                }
            }
            if ($bestSlug !== null && $bestScore >= 60.0) {
                $suggestions[$idx] = $bestSlug;
                $usedSlugs[]       = $bestSlug;
            }
        }
        return $suggestions;
    }

    private static function normalize(string $s): string
    {
        $s = strtolower(trim($s));
        $s = (string) preg_replace('/[^a-z0-9]+/i', '_', $s);
        return trim($s, '_');
    }

    /**
     * Campos importables: todos menos `computed` (no acepta input
     * directo, lo deriva el evaluator) y `relation` (requiere FK
     * a registros que pueden no existir aún).
     *
     * @return array<int, FieldEntity>
     */
    private function importableFields(ListEntity $list): array
    {
        return array_values(array_filter(
            $this->fields->allForList($list->id),
            static fn (FieldEntity $f): bool =>
                $f->type !== 'relation'
                && $f->type !== ComputedField::SLUG
                && $f->deletedAt === null,
        ));
    }

    /**
     * Para cada columna mapeada a un `select`/`multi_select`, escanea
     * todos los valores del CSV y añade al config del campo cualquier
     * etiqueta que no exista ya como opción. Update vía
     * `FieldService::update` con un solo write por campo (acumulamos
     * primero, escribimos al final).
     *
     * Match es case-insensitive contra `label` Y `value` para no
     * duplicar opciones cuando el user ya tiene "Activo" y el CSV
     * trae "activo".
     *
     * @param array<int, array<int, string>> $rows
     * @param array<int, string>             $mapping  csv_idx → field_slug
     * @param array<int, FieldEntity>        $listFields
     *
     * @return array<string, array<int, array{value:string, label:string}>>
     *         field_slug → opciones añadidas (para el summary del UI).
     */
    private function expandSelectOptions(
        ListEntity $list,
        array $rows,
        array $mapping,
        array $listFields,
    ): array {
        $bySlug = [];
        foreach ($listFields as $f) {
            $bySlug[$f->slug] = $f;
        }

        $result = [];
        foreach ($mapping as $csvIdx => $slug) {
            $field = $bySlug[$slug] ?? null;
            if ($field === null) {
                continue;
            }
            if ($field->type !== 'select' && $field->type !== 'multi_select') {
                continue;
            }

            // Recolectar valores únicos de la columna.
            $rawValues = [];
            foreach ($rows as $row) {
                $cell = $row[$csvIdx] ?? '';
                $cell = trim((string) $cell);
                if ($cell === '') {
                    continue;
                }
                if ($field->type === 'multi_select') {
                    $items = preg_split('/[,;]/', $cell) ?: [];
                    foreach ($items as $item) {
                        $item = trim($item);
                        if ($item !== '') {
                            $rawValues[$item] = true;
                        }
                    }
                } else {
                    $rawValues[$cell] = true;
                }
            }
            if ($rawValues === []) {
                continue;
            }

            $existing = is_array($field->config['options'] ?? null) ? $field->config['options'] : [];
            $known    = [];   // ciKey(label|value) → true
            $usedSlugs = [];  // existing values (slugs)
            foreach ($existing as $opt) {
                if (is_array($opt)) {
                    $val = isset($opt['value']) ? (string) $opt['value'] : '';
                    $lbl = isset($opt['label']) ? (string) $opt['label'] : $val;
                    if ($val !== '') {
                        $known[self::ciKey($lbl)] = true;
                        $known[self::ciKey($val)] = true;
                        $usedSlugs[]              = $val;
                    }
                } elseif (is_string($opt) && $opt !== '') {
                    $known[self::ciKey($opt)] = true;
                    $usedSlugs[]              = $opt;
                }
            }

            $newOptions = [];
            foreach (array_keys($rawValues) as $value) {
                $value = (string) $value;
                if (isset($known[self::ciKey($value)])) {
                    continue;
                }
                $newSlug = $this->makeOptionSlug($value, $usedSlugs);
                $newOptions[] = ['value' => $newSlug, 'label' => $value];
                $usedSlugs[]  = $newSlug;
                $known[self::ciKey($value)] = true;
                $known[self::ciKey($newSlug)] = true;
            }

            if ($newOptions === []) {
                continue;
            }

            $newConfig = $field->config;
            $newConfig['options'] = array_merge($existing, $newOptions);

            $updated = $this->fieldService->update($list->id, $field->id, [
                'config' => $newConfig,
            ]);
            if ($updated instanceof ValidationResult) {
                continue;
            }
            $result[$slug] = $newOptions;
        }

        return $result;
    }

    /**
     * Slugify para `option.value`. Asegura unicidad contra los slugs
     * ya presentes en el campo: `vencido_2`, `vencido_3`, etc.
     *
     * @param array<int, string> $usedSlugs
     */
    private function makeOptionSlug(string $label, array $usedSlugs): string
    {
        $base = strtolower(trim($label));
        $base = (string) preg_replace('/[^a-z0-9]+/', '_', $base);
        $base = trim($base, '_');
        if ($base === '') {
            $base = 'option';
        }
        if (! in_array($base, $usedSlugs, true)) {
            return $base;
        }
        $i = 2;
        while (in_array($base . '_' . $i, $usedSlugs, true)) {
            $i++;
        }
        return $base . '_' . $i;
    }

    private function summarizeValidation(ValidationResult $result): string
    {
        $errors = $result->errors();
        if ($errors === []) {
            return __('Validación falló sin detalles.', 'imagina-crm');
        }
        $msgs = [];
        foreach ($errors as $field => $messages) {
            $list = is_array($messages) ? $messages : [$messages];
            foreach ($list as $msg) {
                $msgs[] = $field . ': ' . (string) $msg;
            }
        }
        return implode('; ', array_slice($msgs, 0, 3));
    }
}
