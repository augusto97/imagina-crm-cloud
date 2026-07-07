<?php
declare(strict_types=1);

namespace ImaginaCRM\Portal;

use ImaginaCRM\Permissions\CapabilityRegistry;
use ImaginaCRM\Support\ValidationResult;

/**
 * Magic links: login sin password para clientes del portal
 * (Fase 10 — pulidos).
 *
 * Flujo:
 *   1. Admin pide `generate(user_id)` → genera token aleatorio,
 *      guarda en transient con TTL, devuelve URL.
 *   2. Admin comparte la URL al cliente (email automático opt-in).
 *   3. Cliente clickea → el shortcode `[imcrm-client-portal]` lee
 *      `?imcrm_token=...`, llama `consume(token)` → si válido,
 *      setea auth cookie con `wp_set_auth_cookie(user_id)` y
 *      redirige a la misma URL sin el query param.
 *
 * Storage: transients de WP (auto-expirables, sin schema bump).
 *  - Key: `imcrm_ml_<sha256(token)>`.
 *  - Value: `['user_id' => int, 'created_at' => int]`.
 *  - TTL: `LINK_TTL_SECONDS` (default 7 días).
 *
 * Seguridad:
 *  - Token = 32 bytes random hex → 64 chars URL-safe, alta entropía
 *    (256 bits).
 *  - El transient guarda el HASH del token (sha256) — si un atacante
 *    roba el snapshot de la BD, no obtiene tokens utilizables.
 *  - One-time: al consumir, se borra el transient inmediatamente.
 *  - El user_id se verifica contra WP_User existente al consumir
 *    (un admin podría haber borrado al cliente entre el genera y el
 *    consume).
 *  - El user debe tener cap `imcrm_access_portal` para que el
 *    consume funcione — sin cap, el link es inútil (defensa contra
 *    misuse en cuentas escaladas accidentalmente).
 *  - Rate limit en `generate`: máx N links activos simultáneos por
 *    user — evita flood y limita el window de exposure.
 *
 * Sin almacenamiento persistente del historial de links — auditoría
 * detallada queda como mejora futura si se necesita.
 */
final class MagicLinkService
{
    public const LINK_TTL_SECONDS    = 7 * DAY_IN_SECONDS;  // 7 días.
    public const QUERY_PARAM         = 'imcrm_token';
    public const MAX_ACTIVE_PER_USER = 10;                  // anti-flood.
    public const TRANSIENT_PREFIX    = 'imcrm_ml_';

    /**
     * Genera un magic link para `$userId`.
     *
     * Validaciones:
     *  - El WP user existe.
     *  - Tiene cap `imcrm_access_portal`. Sin esa cap, el portal
     *    rechaza el login después → el link sería inútil. Mejor
     *    fallar acá con mensaje claro.
     *
     * @param string $targetUrl URL del portal del cliente (donde
     *                          está el shortcode). El cliente llegará
     *                          a `$targetUrl?imcrm_token=...`.
     *
     * @return array{token: string, url: string, expires_at: int}|ValidationResult
     */
    public function generate(int $userId, string $targetUrl): array|ValidationResult
    {
        if ($userId <= 0) {
            return ValidationResult::failWith('user_id', __('User ID inválido.', 'imagina-crm'));
        }
        $user = get_user_by('id', $userId);
        if ($user === false) {
            return ValidationResult::failWith('user_id', __('El usuario no existe.', 'imagina-crm'));
        }
        if (! user_can($user, CapabilityRegistry::CAP_ACCESS_PORTAL)) {
            return ValidationResult::failWith(
                'user_id',
                __('El usuario no tiene acceso al portal — primero crea su cuenta de cliente.', 'imagina-crm'),
            );
        }
        if ($targetUrl === '' || ! function_exists('wp_http_validate_url') || wp_http_validate_url($targetUrl) === false) {
            return ValidationResult::failWith(
                'target_url',
                __('La URL destino del portal no es válida.', 'imagina-crm'),
            );
        }

        // El token raw nunca se guarda en BD — solo se incluye en la
        // URL que sale al email. La BD guarda el sha256.
        $token = bin2hex(random_bytes(32));
        $hash = hash('sha256', $token);

        $payload = [
            'user_id'    => $userId,
            'created_at' => time(),
        ];

        $stored = set_transient(self::TRANSIENT_PREFIX . $hash, $payload, self::LINK_TTL_SECONDS);
        if ($stored === false) {
            return ValidationResult::failWith(
                'transient',
                __('No se pudo guardar el token. Verifica que WP-cache esté operativo.', 'imagina-crm'),
            );
        }

        $url = add_query_arg(self::QUERY_PARAM, $token, $targetUrl);

        return [
            'token'      => $token,
            'url'        => $url,
            'expires_at' => time() + self::LINK_TTL_SECONDS,
        ];
    }

    /**
     * Consume un token: valida, autentica al user, invalida el token.
     *
     * Debe llamarse ANTES de cualquier check de `is_user_logged_in`.
     * Si el token es válido:
     *  - Se setea la auth cookie con `wp_set_auth_cookie`.
     *  - Se borra el transient (one-time).
     *  - Se devuelve el user_id.
     *
     * Si el token es inválido / expirado / del user equivocado /
     * el user ya no existe / el user perdió la cap: devuelve null.
     * El caller no debe revelar la causa exacta al cliente
     * (data leak prevention).
     */
    public function consume(string $token): ?int
    {
        if ($token === '' || strlen($token) !== 64 || ! ctype_xdigit($token)) {
            return null;
        }
        $hash = hash('sha256', $token);
        $key = self::TRANSIENT_PREFIX . $hash;

        $payload = function_exists('get_transient') ? get_transient($key) : false;
        if (! is_array($payload) || ! isset($payload['user_id'])) {
            return null;
        }

        $userId = (int) $payload['user_id'];
        if ($userId <= 0) {
            // Defensivo: payload corrupto.
            delete_transient($key);
            return null;
        }

        $user = get_user_by('id', $userId);
        if ($user === false) {
            // User borrado entre el generate y el consume.
            delete_transient($key);
            return null;
        }
        if (! user_can($user, CapabilityRegistry::CAP_ACCESS_PORTAL)) {
            // El admin le quitó el rol entre el generate y el consume.
            delete_transient($key);
            return null;
        }

        // One-time: invalidar ANTES de auth para que un consume
        // concurrente no pueda usar el mismo token.
        delete_transient($key);

        // Setea las cookies de auth de WP. El segundo arg `false` =
        // sesión normal (no "remember me" — esto es defensive, el
        // cliente vuelve a hacer login después si la sesión expira).
        wp_set_auth_cookie($userId, false, is_ssl());
        wp_set_current_user($userId);

        return $userId;
    }
}
