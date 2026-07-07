<?php
declare(strict_types=1);

namespace ImaginaCRM\Search;

/**
 * Tokenizer simple para construir el índice invertido.
 *
 * Normaliza (lowercase + sin acentos + sin puntuación), parte por
 * whitespace/non-alphanum y filtra stopwords + tokens muy cortos
 * (< 2 chars) o muy largos (> 64).
 *
 * No es un tokenizer Unicode-completo: para alfabetos no latinos
 * (chino, árabe) habría que cambiar a `mb_*` con segmentación. Por
 * ahora cubre español + inglés + portugués bien.
 */
final class Tokenizer
{
    /**
     * Stopwords mínimas ES + EN. Preferimos lista corta — los falsos
     * negativos en búsqueda son peores que algún ruido por stopwords
     * que sí se dejaron pasar.
     */
    private const STOPWORDS = [
        // ES
        'a', 'al', 'algo', 'ante', 'asi', 'aun', 'aunque', 'con', 'como',
        'cual', 'cuando', 'de', 'del', 'desde', 'donde', 'dos', 'el',
        'ella', 'ellas', 'ellos', 'en', 'entre', 'era', 'es', 'esa',
        'ese', 'eso', 'esta', 'este', 'esto', 'estos', 'fue', 'ha',
        'hay', 'la', 'las', 'le', 'les', 'lo', 'los', 'mas', 'me',
        'mi', 'mis', 'muy', 'no', 'nos', 'nuestro', 'o', 'para',
        'pero', 'por', 'porque', 'que', 'se', 'si', 'sin', 'sobre',
        'son', 'su', 'sus', 'te', 'tu', 'tus', 'un', 'una', 'uno',
        'unos', 'y', 'ya', 'yo',
        // EN
        'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for',
        'from', 'has', 'have', 'he', 'her', 'here', 'his', 'i', 'in',
        'is', 'it', 'its', 'me', 'my', 'no', 'not', 'of', 'on', 'or',
        'our', 'she', 'so', 'that', 'the', 'their', 'them', 'they',
        'this', 'to', 'us', 'was', 'we', 'were', 'what', 'when',
        'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your',
    ];

    private const MIN_TOKEN_LENGTH = 2;
    private const MAX_TOKEN_LENGTH = 64;

    /**
     * Tokeniza texto crudo en lista de tokens normalizados (sin
     * deduplicar — el caller calcula tf contando ocurrencias). Vacío
     * → array vacío.
     *
     * @return list<string>
     */
    public function tokenize(string $text): array
    {
        if ($text === '') {
            return [];
        }

        $normalized = $this->normalize($text);

        // Split por cualquier cosa que no sea letra/dígito/guión bajo.
        $parts = preg_split('/[^a-z0-9_]+/', $normalized);
        if (! is_array($parts)) {
            return [];
        }

        $stopwords = array_flip(self::STOPWORDS);
        $out       = [];
        foreach ($parts as $token) {
            $len = strlen($token);
            if ($len < self::MIN_TOKEN_LENGTH || $len > self::MAX_TOKEN_LENGTH) {
                continue;
            }
            if (isset($stopwords[$token])) {
                continue;
            }
            $out[] = $token;
        }
        return $out;
    }

    /**
     * Normaliza para comparación: lowercase + ASCII (sin acentos).
     * Mantiene los caracteres alfanuméricos para que `match` y otros
     * tokens válidos pasen, pero limpia diacríticos.
     */
    public function normalize(string $text): string
    {
        // Lowercase ASCII-safe (mb_strtolower si está disponible).
        if (function_exists('mb_strtolower')) {
            $text = mb_strtolower($text, 'UTF-8');
        } else {
            $text = strtolower($text);
        }

        // Acentos: mapping mínimo ES/EN/PT/FR. Suficiente para la
        // gran mayoría del corpus en estos idiomas. Para alfabetos
        // no latinos seguirá funcionando — solo no tendrán
        // "fold-equivalence".
        $map = [
            'á' => 'a', 'à' => 'a', 'ä' => 'a', 'â' => 'a', 'ã' => 'a',
            'é' => 'e', 'è' => 'e', 'ë' => 'e', 'ê' => 'e',
            'í' => 'i', 'ì' => 'i', 'ï' => 'i', 'î' => 'i',
            'ó' => 'o', 'ò' => 'o', 'ö' => 'o', 'ô' => 'o', 'õ' => 'o',
            'ú' => 'u', 'ù' => 'u', 'ü' => 'u', 'û' => 'u',
            'ñ' => 'n', 'ç' => 'c',
        ];
        return strtr($text, $map);
    }
}
