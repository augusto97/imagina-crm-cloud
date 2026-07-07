<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations\Actions;

use ImaginaCRM\Automations\ActionResult;
use ImaginaCRM\Automations\TriggerContext;

/**
 * Acción `send_email`: envía un correo vía `wp_mail()` con merge tags en
 * destinatario, asunto y cuerpo.
 *
 * Config:
 * - `to`: requerida. Email o merge tag (`{{email}}`, `{{record.email}}`).
 *   Acepta múltiples destinatarios separados por coma.
 * - `subject`: requerida. Acepta merge tags.
 * - `body`: requerida. Acepta merge tags. Si `is_html` es true se envía
 *   con `Content-Type: text/html; charset=UTF-8`.
 * - `is_html`: opcional, default false. Si true, el body se envía como
 *   HTML (no se le aplica autop ni nada — el operador es responsable
 *   del markup).
 * - `from_name` / `from_email`: opcionales. Si ambos están seteados se
 *   añade un header `From:`. Si no, WP usa su default
 *   (wordpress@host).
 * - `cc` / `bcc`: opcionales, mismas reglas que `to`.
 *
 * Errores: si `wp_mail()` devuelve `false`, marcamos como `failed` para
 * que el operador pueda inspeccionar y reintentar; el engine async (commit
 * posterior) reintentará automáticamente con backoff.
 */
final class SendEmailAction extends AbstractAction
{
    public const SLUG = 'send_email';

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Enviar email', 'imagina-crm');
    }

    public function execute(TriggerContext $context, array $config): ActionResult
    {
        $to = $this->resolveAddressList($config['to'] ?? null, $context);
        if ($to === []) {
            return ActionResult::skipped(self::SLUG, 'Destinatario vacío o inválido tras interpolación.');
        }

        $subject = isset($config['subject']) ? (string) $config['subject'] : '';
        $subject = trim($this->applyMergeTags($subject, $context));
        if ($subject === '') {
            return ActionResult::skipped(self::SLUG, 'Asunto vacío.');
        }

        $body = isset($config['body']) ? (string) $config['body'] : '';
        $body = $this->applyMergeTags($body, $context);
        if (trim($body) === '') {
            return ActionResult::skipped(self::SLUG, 'Cuerpo vacío.');
        }

        $isHtml  = ! empty($config['is_html']);
        $headers = $this->buildHeaders($config, $context, $isHtml);

        // wp_mail puede emitir notices si la SMTP no está configurada;
        // silenciamos para no contaminar el log de runs (el resultado
        // bool ya nos dice si tuvo éxito).
        // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
        $sent = @wp_mail($to, $subject, $body, $headers);

        if ($sent === true) {
            return ActionResult::success(self::SLUG, null, [
                'to'      => $to,
                'subject' => $subject,
                'is_html' => $isHtml,
            ]);
        }

        return ActionResult::failed(
            self::SLUG,
            'wp_mail devolvió false. Revisa la configuración SMTP del sitio.',
            ['to' => $to, 'subject' => $subject],
        );
    }

    public function getConfigSchema(): array
    {
        return [
            'to'         => ['type' => 'string', 'required' => true, 'description' => 'Email(s) separados por coma. Acepta merge tags.'],
            'subject'    => ['type' => 'string', 'required' => true],
            'body'       => ['type' => 'string', 'required' => true],
            'is_html'    => ['type' => 'boolean', 'default' => false],
            'from_name'  => ['type' => 'string', 'default' => ''],
            'from_email' => ['type' => 'string', 'default' => ''],
            'cc'         => ['type' => 'string', 'default' => ''],
            'bcc'        => ['type' => 'string', 'default' => ''],
        ];
    }

    /**
     * @param mixed $raw Valor del config tras hidratar (string, array o null).
     * @return array<int, string> Lista de emails válidos tras interpolación.
     */
    private function resolveAddressList(mixed $raw, TriggerContext $context): array
    {
        if (! is_string($raw) || $raw === '') {
            return [];
        }
        $expanded = $this->applyMergeTags($raw, $context);
        $candidates = array_map('trim', explode(',', $expanded));
        $valid = [];
        foreach ($candidates as $address) {
            if ($address === '') {
                continue;
            }
            // is_email es la validación oficial de WP — evita duplicar
            // reglas de RFC. Si no estamos en runtime WP (tests sin
            // is_email), filter_var como fallback.
            $ok = function_exists('is_email')
                ? (bool) is_email($address)
                : filter_var($address, FILTER_VALIDATE_EMAIL) !== false;
            if ($ok) {
                $valid[] = $address;
            }
        }
        return $valid;
    }

    /**
     * @param array<string, mixed> $config
     * @return array<int, string>
     */
    private function buildHeaders(array $config, TriggerContext $context, bool $isHtml): array
    {
        $headers = [];

        if ($isHtml) {
            $headers[] = 'Content-Type: text/html; charset=UTF-8';
        }

        $fromName  = isset($config['from_name'])  ? trim($this->applyMergeTags((string) $config['from_name'],  $context)) : '';
        $fromEmail = isset($config['from_email']) ? trim($this->applyMergeTags((string) $config['from_email'], $context)) : '';
        if ($fromEmail !== '') {
            $isValid = function_exists('is_email')
                ? (bool) is_email($fromEmail)
                : filter_var($fromEmail, FILTER_VALIDATE_EMAIL) !== false;
            if ($isValid) {
                $headers[] = $fromName !== ''
                    ? sprintf('From: %s <%s>', $fromName, $fromEmail)
                    : sprintf('From: %s', $fromEmail);
            }
        }

        foreach (['cc' => 'Cc', 'bcc' => 'Bcc'] as $key => $headerName) {
            $list = $this->resolveAddressList($config[$key] ?? null, $context);
            if ($list !== []) {
                $headers[] = sprintf('%s: %s', $headerName, implode(', ', $list));
            }
        }

        return $headers;
    }
}
