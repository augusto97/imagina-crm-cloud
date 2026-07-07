<?php
declare(strict_types=1);

namespace ImaginaCRM\Licensing;

use ImaginaCRM\Plugin;

/**
 * Cliente de updates contra `releases.imaginawp.com`.
 *
 * Se engancha en los filtros estándar de WordPress:
 *
 * - `pre_set_site_transient_update_plugins`: inyecta info de update si hay
 *   versión nueva y la licencia es válida (incluye grace period).
 * - `plugins_api`: responde al modal "Ver detalles" con el changelog y
 *   metadatos.
 *
 * Cachea la respuesta en un transient `imcrm_update_check` con TTL de 12h
 * para no martillar el servidor de releases.
 *
 * Si la licencia no es válida (ni en gracia), NO ofrecemos updates. Esto
 * es el único gate del producto basado en licencia. Los datos del usuario
 * siempre están disponibles (ADR-007).
 */
final class UpdaterClient
{
    public const RELEASES_ENDPOINT = 'https://releases.imaginawp.com/v1/check';
    public const TRANSIENT_KEY     = 'imcrm_update_check';
    public const CACHE_TTL_SECONDS = 12 * HOUR_IN_SECONDS;
    public const TIMEOUT_SECONDS   = 8;

    public function __construct(private readonly LicenseManager $licenses)
    {
    }

    public function register(): void
    {
        add_filter('pre_set_site_transient_update_plugins', [$this, 'injectUpdate']);
        add_filter('plugins_api', [$this, 'pluginsApi'], 10, 3);
        add_action('imagina_crm/license_state_changed', [$this, 'flushCache']);
    }

    /**
     * Hook: WordPress nos pasa el transient con todos los plugins; le
     * añadimos el nuestro si tenemos update disponible.
     *
     * @param mixed $transient
     * @return mixed
     */
    public function injectUpdate(mixed $transient): mixed
    {
        if (! is_object($transient)) {
            return $transient;
        }
        $update = $this->checkForUpdate();
        if ($update === null) {
            return $transient;
        }

        $basename = IMAGINA_CRM_BASENAME;
        $payload = (object) [
            'id'             => 'imagina-crm/imagina-crm',
            'slug'           => 'imagina-crm',
            'plugin'         => $basename,
            'new_version'    => $update['version'],
            'url'            => 'https://imaginawp.com/imagina-crm',
            'package'        => $update['download_url'],
            'tested'         => $update['tested_up_to'] ?? '',
            'requires_php'   => '8.2',
        ];

        // El transient nativo de WP es un stdClass con propiedad dinámica
        // `response` (array). Tipamos como stdClass para narrowing.
        /** @var \stdClass $bag */
        $bag = $transient;
        $current = property_exists($bag, 'response') && is_array($bag->response) ? $bag->response : [];
        $current[$basename] = $payload;
        $bag->response = $current;
        return $bag;
    }

    /**
     * Hook: responde al modal "Ver detalles" con info del plugin.
     *
     * @param false|object|array<mixed> $result
     * @param string                    $action
     * @param mixed                     $args
     * @return false|object|array<mixed>
     */
    public function pluginsApi(mixed $result, string $action, mixed $args): mixed
    {
        if ($action !== 'plugin_information') {
            return $result;
        }
        if (! is_object($args) || ($args->slug ?? null) !== 'imagina-crm') {
            return $result;
        }

        $update = $this->checkForUpdate();
        if ($update === null) {
            return $result;
        }

        return (object) [
            'name'         => 'Imagina CRM',
            'slug'         => 'imagina-crm',
            'version'      => $update['version'],
            'requires'     => '6.4',
            'tested'       => $update['tested_up_to'] ?? '',
            'requires_php' => '8.2',
            'download_link' => $update['download_url'],
            'sections'     => [
                'changelog' => $update['changelog'] ?? '',
            ],
            'author'       => 'IMAGINA LA WEB S.A.S.',
            'homepage'     => 'https://imaginawp.com/imagina-crm',
        ];
    }

    /**
     * Devuelve la info de update disponible (cacheada) o `null` si no hay.
     *
     * @return array{version:string, download_url:string, changelog?:string, tested_up_to?:string}|null
     */
    public function checkForUpdate(): ?array
    {
        if (! $this->licenses->getState()->isValid()) {
            return null;
        }

        $cached = get_transient(self::TRANSIENT_KEY);
        if (is_array($cached)) {
            // Cacheamos también el "no hay update" como `['none' => true]`
            // para no martillar el endpoint en cada admin-init.
            if (isset($cached['none'])) {
                return null;
            }
            return $this->normalizeUpdate($cached);
        }

        $fresh = $this->fetch();
        if ($fresh === null) {
            set_transient(self::TRANSIENT_KEY, ['none' => true], self::CACHE_TTL_SECONDS);
            return null;
        }
        set_transient(self::TRANSIENT_KEY, $fresh, self::CACHE_TTL_SECONDS);
        return $fresh;
    }

    public function flushCache(): void
    {
        delete_transient(self::TRANSIENT_KEY);
    }

    /**
     * @return array{version:string, download_url:string, changelog?:string, tested_up_to?:string}|null
     */
    private function fetch(): ?array
    {
        $key = $this->licenses->getState()->key;
        $url = add_query_arg(
            [
                'slug'        => 'imagina-crm',
                'version'     => Plugin::VERSION,
                'license_key' => $key,
                'site_url'    => home_url('/'),
            ],
            self::RELEASES_ENDPOINT,
        );

        $response = wp_remote_get($url, [
            'timeout' => self::TIMEOUT_SECONDS,
            'headers' => [
                'Accept'     => 'application/json',
                'User-Agent' => 'Imagina-CRM/' . Plugin::VERSION,
            ],
        ]);

        if ($response instanceof \WP_Error) {
            return null;
        }
        $code = (int) ($response['response']['code'] ?? 0);
        if ($code !== 200) {
            return null;
        }
        $body = json_decode((string) ($response['body'] ?? ''), true);
        if (! is_array($body) || empty($body['has_update'])) {
            return null;
        }
        return $this->normalizeUpdate($body);
    }

    /**
     * @param array<string, mixed> $raw
     * @return array{version:string, download_url:string, changelog?:string, tested_up_to?:string}
     */
    private function normalizeUpdate(array $raw): array
    {
        $out = [
            'version'      => isset($raw['version']) ? (string) $raw['version'] : Plugin::VERSION,
            'download_url' => isset($raw['download_url']) ? (string) $raw['download_url'] : '',
        ];
        if (isset($raw['changelog']) && is_string($raw['changelog'])) {
            $out['changelog'] = $raw['changelog'];
        }
        if (isset($raw['tested_up_to']) && is_string($raw['tested_up_to'])) {
            $out['tested_up_to'] = $raw['tested_up_to'];
        }
        return $out;
    }
}
