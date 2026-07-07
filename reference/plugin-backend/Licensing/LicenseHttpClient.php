<?php
declare(strict_types=1);

namespace ImaginaCRM\Licensing;

/**
 * Cliente HTTP fino para `licenses.imaginawp.com/v1/validate`.
 *
 * Toda la comunicación con el servidor de licencias pasa por aquí. Usar
 * `wp_remote_post` permite que tests intercepten via `pre_http_request`.
 *
 * Contrato del endpoint (lo definimos nosotros, vivimos a ambos lados):
 *
 *     POST /v1/validate
 *     Body (JSON): { key, site_url, action }
 *       action ∈ { "activate", "validate", "deactivate" }
 *     Response (JSON):
 *       {
 *         "ok": bool,
 *         "status": "valid" | "expired" | "invalid" | "site_limit_reached",
 *         "expires_at": "ISO8601 | null",
 *         "site_limit": int | null,
 *         "activations_count": int | null,
 *         "message": string | null
 *       }
 *
 * Errores HTTP (5xx, timeouts) lanzan `LicenseException::network()`. Una
 * respuesta JSON con `ok=false` y un status conocido lanza
 * `LicenseException::server()` para que el caller pueda discriminar.
 */
class LicenseHttpClient
{
    public const ENDPOINT = 'https://licenses.imaginawp.com/v1/validate';
    public const TIMEOUT_SECONDS = 8;

    /**
     * @return array<string, mixed>
     */
    public function call(string $action, string $key, string $siteUrl): array
    {
        $body = (string) wp_json_encode([
            'key'      => $key,
            'site_url' => $siteUrl,
            'action'   => $action,
        ]);

        $response = wp_remote_post(self::ENDPOINT, [
            'timeout'     => self::TIMEOUT_SECONDS,
            'redirection' => 2,
            'headers'     => [
                'Content-Type' => 'application/json',
                'Accept'       => 'application/json',
                'User-Agent'   => 'Imagina-CRM/' . (defined('IMAGINA_CRM_VERSION') ? IMAGINA_CRM_VERSION : 'dev'),
            ],
            'body'        => $body,
        ]);

        if ($response instanceof \WP_Error) {
            throw LicenseException::network($response->get_error_message());
        }

        /** @var array{response: array{code:int, message:string}, body: string} $response */
        $code = (int) ($response['response']['code'] ?? 0);
        if ($code >= 500 || $code === 0) {
            throw LicenseException::network(sprintf('HTTP %d', $code));
        }

        $rawBody = (string) ($response['body'] ?? '');
        $decoded = json_decode($rawBody, true);
        if (! is_array($decoded)) {
            throw LicenseException::network(__('Respuesta no JSON del servidor de licencias.', 'imagina-crm'));
        }

        $ok      = (bool) ($decoded['ok'] ?? false);
        $status  = is_string($decoded['status'] ?? null) ? $decoded['status'] : '';
        $message = is_string($decoded['message'] ?? null) ? $decoded['message'] : null;

        if (! $ok) {
            // El servidor decidió que la licencia no es válida — esto NO es
            // un error de red; es un estado controlado.
            throw LicenseException::server(
                $status !== '' ? $status : LicenseState::STATUS_INVALID,
                $message ?? __('La licencia no es válida.', 'imagina-crm'),
            );
        }

        return $decoded;
    }
}
