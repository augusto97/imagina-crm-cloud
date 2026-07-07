<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations\Actions;

use ImaginaCRM\Automations\TriggerContext;
use ImaginaCRM\Contracts\ActionInterface;

abstract class AbstractAction implements ActionInterface
{
    public function getConfigSchema(): array
    {
        return [];
    }

    /**
     * Reemplazo de merge tags. Soporta:
     *
     *   - `{{<slug>}}` y `{{record.<slug>}}`: campo del registro
     *     (uno con prefijo, otro sin — equivalentes para conveniencia).
     *   - `{{record.id}}`: id numérico del registro.
     *   - `{{record.created_at}}` / `{{record.updated_at}}`: timestamps
     *     del registro en el formato que viene del repository.
     *   - `{{record.created_by}}`: id del usuario creador.
     *   - `{{date.now}}`: timestamp actual en formato ISO 8601 UTC.
     *   - `{{date.today}}`: fecha actual `YYYY-MM-DD` en zona del sitio.
     *   - `{{user.<key>}}`: datos del usuario que disparó la acción
     *     (`user.email`, `user.display_name`, `user.id`).
     *   - `{{signature}}`: firma de email del autor (`get_user_meta`
     *     `imcrm_email_signature`); string vacío si no la tiene.
     *
     * Sin valor → string vacío. La regex acepta `[a-zA-Z0-9_.]` así
     * que slugs con underscore funcionan.
     */
    protected function applyMergeTags(string $template, TriggerContext $context): string
    {
        return preg_replace_callback(
            '/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/',
            static function (array $m) use ($context): string {
                $key = $m[1];

                if ($key === 'record.id') {
                    $id = $context->recordId();
                    return $id === null ? '' : (string) $id;
                }

                // Metadata del registro (timestamps + autor). Vienen
                // como columnas a nivel raíz del array `record` (no
                // bajo `fields`) — ver RecordService::hydrate().
                if ($key === 'record.created_at' || $key === 'record.updated_at' || $key === 'record.created_by') {
                    $col = substr($key, 7);
                    if ($context->record !== null && isset($context->record[$col])) {
                        return self::stringifyValue($context->record[$col]);
                    }
                    return '';
                }

                if (str_starts_with($key, 'record.')) {
                    $slug = substr($key, 7);
                    $val = $context->fieldValue($slug);
                    return self::stringifyValue($val);
                }

                if ($key === 'date.now') {
                    return gmdate('c');
                }
                if ($key === 'date.today') {
                    $today = wp_date('Y-m-d');
                    return is_string($today) ? $today : '';
                }

                if (str_starts_with($key, 'user.')) {
                    $authorId = self::resolveAuthorId($context);
                    $user = $authorId > 0 ? get_userdata($authorId) : false;
                    if ($user === false) return '';
                    $sub = substr($key, 5);
                    return match ($sub) {
                        'id'           => (string) $user->ID,
                        'email'        => (string) $user->user_email,
                        'display_name' => (string) $user->display_name,
                        'login'        => (string) $user->user_login,
                        default        => '',
                    };
                }

                if ($key === 'signature') {
                    $authorId = self::resolveAuthorId($context);
                    if ($authorId <= 0) return '';
                    $sig = get_user_meta($authorId, 'imcrm_email_signature', true);
                    return is_string($sig) ? $sig : '';
                }

                $val = $context->fieldValue($key);
                return self::stringifyValue($val);
            },
            $template,
        ) ?? $template;
    }

    /**
     * Quién es el "autor" en este contexto: el created_by del registro
     * (común en automations) o, en su defecto, el usuario actual (puede
     * ser 0 en cron). Usado para resolver `{{user.*}}` y `{{signature}}`.
     */
    private static function resolveAuthorId(TriggerContext $context): int
    {
        if ($context->record !== null && isset($context->record['created_by'])) {
            $id = $context->record['created_by'];
            if (is_numeric($id) && (int) $id > 0) {
                return (int) $id;
            }
        }
        return get_current_user_id();
    }

    private static function stringifyValue(mixed $value): string
    {
        if ($value === null) return '';
        if (is_bool($value)) return $value ? '1' : '0';
        if (is_scalar($value)) return (string) $value;
        $encoded = wp_json_encode($value);
        return is_string($encoded) ? $encoded : '';
    }
}
