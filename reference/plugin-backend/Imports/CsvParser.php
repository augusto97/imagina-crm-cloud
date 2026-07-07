<?php
declare(strict_types=1);

namespace ImaginaCRM\Imports;

/**
 * Parser CSV minimalista pero robusto. Maneja:
 *  - BOM UTF-8 (lo strippea automáticamente).
 *  - Celdas con comas, comillas dobles escapadas (`""`), saltos de
 *    línea dentro de comillas. Lo hace vía `fgetcsv` sobre un buffer
 *    en memoria — la propia libc maneja esos casos.
 *  - Detección de delimiter en preview (`,` vs `;` vs tab) — Excel
 *    en español exporta con `;` por la configuración regional, y
 *    ClickUp/Airtable con `,`.
 *  - Encoding: el caller debe pasar UTF-8. Si recibe Latin-1 (típico
 *    de Excel viejo) aplicamos `mb_convert_encoding` cuando el
 *    contenido no es UTF-8 válido.
 *
 * No tiene dependencias del Container — es puro y testeable sin
 * bootstrap de WP.
 */
final class CsvParser
{
    /**
     * Parsea un CSV string y devuelve `[headers, rows]`.
     *
     * `headers` es la primera fila (asumida como nombres de columna).
     * `rows` son arrays indexados por posición (no por nombre) — el
     * caller hace el mapping `posición → field_id` con el output de
     * la suggestion.
     *
     * @return array{headers: array<int, string>, rows: array<int, array<int, string>>}
     */
    public static function parse(string $csv, ?string $delimiter = null): array
    {
        $csv = self::normalizeEncoding($csv);
        $csv = self::stripBom($csv);

        if ($csv === '') {
            return ['headers' => [], 'rows' => []];
        }

        $detectedDelimiter = $delimiter ?? self::detectDelimiter($csv);

        // fgetcsv requiere un stream — usamos php://temp para mantener
        // todo en memoria (typical CSV de import < 5MB).
        $stream = fopen('php://temp', 'r+');
        if ($stream === false) {
            return ['headers' => [], 'rows' => []];
        }
        fwrite($stream, $csv);
        rewind($stream);

        $headers = [];
        $rows    = [];
        $first   = true;
        while (($row = fgetcsv($stream, 0, $detectedDelimiter, '"', '\\')) !== false) {
            if ($row === [null]) {
                // Línea vacía dentro del CSV — fgetcsv la representa así.
                continue;
            }
            if ($first) {
                $headers = array_map(static fn ($c): string => is_string($c) ? trim($c) : '', $row);
                $first   = false;
                continue;
            }
            $rows[] = array_map(static fn ($c): string => is_string($c) ? $c : '', $row);
        }
        fclose($stream);

        return ['headers' => $headers, 'rows' => $rows];
    }

    /**
     * Genera CSV a partir de headers + rows usando `fputcsv` (mismas
     * reglas de quoting que el parse). Usa `,` como delimiter por
     * defecto — universal y lo que Excel/Google Sheets/ClickUp aceptan
     * como input.
     *
     * @param array<int, string>                   $headers
     * @param array<int, array<int, string|null>>  $rows
     */
    public static function build(array $headers, array $rows, string $delimiter = ','): string
    {
        $stream = fopen('php://temp', 'r+');
        if ($stream === false) {
            return '';
        }
        // BOM UTF-8 al principio para que Excel reconozca encoding al
        // abrir el .csv directamente (sin usar "Importar datos").
        fwrite($stream, "\xEF\xBB\xBF");
        fputcsv($stream, $headers, $delimiter, '"', '\\');
        foreach ($rows as $row) {
            fputcsv(
                $stream,
                array_map(static fn ($v): string => $v === null ? '' : (string) $v, $row),
                $delimiter,
                '"',
                '\\',
            );
        }
        rewind($stream);
        $out = stream_get_contents($stream);
        fclose($stream);
        return is_string($out) ? $out : '';
    }

    private static function stripBom(string $csv): string
    {
        if (str_starts_with($csv, "\xEF\xBB\xBF")) {
            return substr($csv, 3);
        }
        return $csv;
    }

    /**
     * Si el contenido no es UTF-8 válido, intentamos convertir desde
     * Latin-1 (CP1252) — el encoding por defecto de Excel en Windows
     * en español. Si ya es UTF-8 (o ASCII puro), pasa sin tocar.
     */
    private static function normalizeEncoding(string $csv): string
    {
        if (! function_exists('mb_check_encoding') || mb_check_encoding($csv, 'UTF-8')) {
            return $csv;
        }
        $converted = @mb_convert_encoding($csv, 'UTF-8', 'Windows-1252,ISO-8859-1');
        return is_string($converted) ? $converted : $csv;
    }

    /**
     * Detecta el delimiter más probable contando ocurrencias en la
     * primera línea (la única donde podemos asumir que está la
     * cabecera y por lo tanto un mínimo de "campos"). Tab (`\t`),
     * `;` y `,` son los candidatos típicos.
     */
    private static function detectDelimiter(string $csv): string
    {
        $firstLine = strtok($csv, "\n");
        if ($firstLine === false) {
            return ',';
        }
        // Ignora separadores que estén dentro de comillas — quitamos
        // los pares "..." antes de contar para no falsamente preferir
        // un delimiter que aparece sólo dentro de un texto quoted.
        $clean = preg_replace('/"[^"]*"/', '', $firstLine);
        $clean = is_string($clean) ? $clean : $firstLine;

        $counts = [
            ','  => substr_count($clean, ','),
            ';'  => substr_count($clean, ';'),
            "\t" => substr_count($clean, "\t"),
        ];
        arsort($counts);
        $top = (string) array_key_first($counts);
        return $counts[$top] > 0 ? $top : ',';
    }
}
