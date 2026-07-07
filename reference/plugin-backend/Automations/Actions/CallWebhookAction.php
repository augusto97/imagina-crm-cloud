<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations\Actions;

use ImaginaCRM\Automations\ActionResult;
use ImaginaCRM\Automations\TriggerContext;

/**
 * Acción `call_webhook`: hace un POST (o método configurable) a una URL
 * externa con el contexto del trigger en el body.
 *
 * Config:
 * - `url`: requerida. Acepta merge tags (`https://hooks.zapier.com/…?id={{record.id}}`).
 * - `method`: GET / POST / PUT (default POST).
 * - `headers`: `[name => value]` opcional. Acepta merge tags en el value.
 * - `body_template`: opcional. Si está, se interpola y se envía como
 *   string. Si no, se envía el contexto completo como JSON.
 *
 * Errores 4xx/5xx → `ActionResult::failed` para que el engine pueda
 * reintentar (vía Action Scheduler en commit posterior).
 */
final class CallWebhookAction extends AbstractAction
{
    public const SLUG = 'call_webhook';
    public const TIMEOUT_SECONDS = 8;

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Llamar webhook externo', 'imagina-crm');
    }

    public function execute(TriggerContext $context, array $config): ActionResult
    {
        $url = isset($config['url']) ? (string) $config['url'] : '';
        $url = trim($this->applyMergeTags($url, $context));
        if ($url === '') {
            return ActionResult::skipped(self::SLUG, 'URL vacía.');
        }
        if (filter_var($url, FILTER_VALIDATE_URL) === false) {
            return ActionResult::failed(self::SLUG, 'URL inválida tras interpolación: ' . $url);
        }

        $method = strtoupper((string) ($config['method'] ?? 'POST'));
        if (! in_array($method, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], true)) {
            $method = 'POST';
        }

        $headers = ['Content-Type' => 'application/json', 'Accept' => 'application/json'];
        if (isset($config['headers']) && is_array($config['headers'])) {
            foreach ($config['headers'] as $name => $value) {
                if (! is_string($name) || ! is_scalar($value)) {
                    continue;
                }
                $headers[$name] = $this->applyMergeTags((string) $value, $context);
            }
        }

        $body = null;
        if ($method !== 'GET') {
            if (isset($config['body_template']) && is_string($config['body_template']) && $config['body_template'] !== '') {
                $body = $this->applyMergeTags($config['body_template'], $context);
            } else {
                $encoded = wp_json_encode($context->toArray());
                $body = is_string($encoded) ? $encoded : '{}';
            }
        }

        $args = [
            'method'  => $method,
            'timeout' => self::TIMEOUT_SECONDS,
            'headers' => $headers,
        ];
        if ($body !== null) {
            $args['body'] = $body;
        }

        $response = wp_remote_request($url, $args);

        if ($response instanceof \WP_Error) {
            return ActionResult::failed(self::SLUG, 'Error de red: ' . $response->get_error_message(), [
                'url' => $url,
            ]);
        }

        /** @var array{response: array{code:int}} $response */
        $code = (int) ($response['response']['code'] ?? 0);
        if ($code >= 200 && $code < 300) {
            return ActionResult::success(self::SLUG, null, ['status' => $code, 'url' => $url]);
        }

        return ActionResult::failed(self::SLUG, sprintf('HTTP %d', $code), [
            'status' => $code,
            'url'    => $url,
        ]);
    }

    public function getConfigSchema(): array
    {
        return [
            'url'           => ['type' => 'string', 'required' => true],
            'method'        => ['type' => 'string', 'default' => 'POST', 'enum' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']],
            'headers'       => ['type' => 'object', 'default' => []],
            'body_template' => ['type' => 'string', 'description' => 'Si vacío, se envía el contexto completo como JSON.'],
        ];
    }
}
