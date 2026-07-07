<?php
declare(strict_types=1);

namespace ImaginaCRM\Comments;

/**
 * Extrae menciones `@user_login` del contenido de un comentario y las
 * resuelve a IDs de usuario.
 *
 * Reglas del patrón:
 * - `@` precedido por inicio de string, espacio o salto de línea (no
 *   queremos que `email@host` se interprete como mención).
 * - Login: `[A-Za-z0-9._-]{1,60}`. Coincide con la sanitización de
 *   user_login que hace WP via `sanitize_user`.
 * - El parser no exige que el usuario exista: el caller decide qué
 *   hacer con menciones a logins desconocidos (típicamente, ignorar).
 *
 * Para tests / DI, el resolver de logins → user_id es inyectable. En
 * runtime se usa `get_user_by('login', $login)`; en tests se pasa una
 * closure que mapea sin tocar WP.
 */
final class MentionParser
{
    private const PATTERN = '/(?:^|\s)@([A-Za-z0-9._-]{1,60})/';

    /** @var \Closure(string): ?int */
    private \Closure $resolver;

    /**
     * @param \Closure(string): ?int|null $resolver
     */
    public function __construct(?\Closure $resolver = null)
    {
        $this->resolver = $resolver ?? static function (string $login): ?int {
            if (! function_exists('get_user_by')) {
                return null;
            }
            $user = get_user_by('login', $login);
            if ($user === false) {
                return null;
            }
            if (! ($user instanceof \WP_User)) {
                // Stubs de test (stdClass) llegan por aquí; los toleramos
                // leyendo ID dinámicamente.
                $rawId = is_object($user) && property_exists($user, 'ID') ? (int) $user->ID : 0;
                return $rawId > 0 ? $rawId : null;
            }
            $id = (int) $user->ID;
            return $id > 0 ? $id : null;
        };
    }

    /**
     * Extrae logins distintos del contenido (sin resolver). Útil cuando
     * sólo se necesita el listado para renderizar.
     *
     * @return array<int, string>
     */
    public function extractLogins(string $content): array
    {
        if (! preg_match_all(self::PATTERN, $content, $matches)) {
            return [];
        }
        $logins = $matches[1];
        // De-duplicar preservando orden de aparición.
        $seen   = [];
        $unique = [];
        foreach ($logins as $login) {
            $key = strtolower($login);
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $unique[]   = $login;
        }
        return $unique;
    }

    /**
     * Resuelve menciones a `[login => user_id]`. Logins inválidos se
     * descartan silenciosamente.
     *
     * @return array<string, int>
     */
    public function resolve(string $content): array
    {
        $out = [];
        foreach ($this->extractLogins($content) as $login) {
            $id = ($this->resolver)($login);
            if ($id !== null && $id > 0) {
                $out[$login] = $id;
            }
        }
        return $out;
    }
}
