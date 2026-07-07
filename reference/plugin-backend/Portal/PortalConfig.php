<?php
declare(strict_types=1);

namespace ImaginaCRM\Portal;

/**
 * Value object inmutable que representa `wp_imcrm_lists.settings.portal`.
 *
 * Shape persistido:
 * ```
 * {
 *   "portal": {
 *     "enabled":              true,
 *     "owner_field_id":       42,   // field tipo `user` que identifica al cliente
 *     "default_template_id":  7     // template del portal (Fase 9 — 3.C)
 *   }
 * }
 * ```
 *
 * Garantías:
 *  - `enabled=false` o ausencia de `portal.owner_field_id` → la lista
 *    NO se considera lista de portal (`isPortalList=false`).
 *  - `default_template_id` es opcional — si no está, el portal usa
 *    un layout default minimal.
 *
 * Ver `docs/multi-stakeholder-design.md` §3 (Fase 9).
 */
final class PortalConfig
{
    private function __construct(
        public readonly bool $enabled,
        public readonly ?int $ownerFieldId,
        public readonly ?int $defaultTemplateId,
    ) {
    }

    /**
     * @param array<string, mixed> $settings
     */
    public static function fromListSettings(array $settings): self
    {
        $raw = $settings['portal'] ?? null;
        if (! is_array($raw)) {
            return self::disabled();
        }

        $enabled = (bool) ($raw['enabled'] ?? false);
        $ownerFieldId = isset($raw['owner_field_id']) && is_numeric($raw['owner_field_id'])
                && (int) $raw['owner_field_id'] > 0
            ? (int) $raw['owner_field_id']
            : null;
        $defaultTemplateId = isset($raw['default_template_id']) && is_numeric($raw['default_template_id'])
                && (int) $raw['default_template_id'] > 0
            ? (int) $raw['default_template_id']
            : null;

        return new self($enabled, $ownerFieldId, $defaultTemplateId);
    }

    public static function disabled(): self
    {
        return new self(false, null, null);
    }

    /**
     * `true` si esta lista está marcada como lista de portal Y tiene un
     * `owner_field_id` configurado. Sin el field de owner no se puede
     * resolver qué record pertenece a qué cliente, así que el "enabled"
     * sin él no cuenta.
     */
    public function isPortalList(): bool
    {
        return $this->enabled && $this->ownerFieldId !== null;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'enabled'             => $this->enabled,
            'owner_field_id'      => $this->ownerFieldId,
            'default_template_id' => $this->defaultTemplateId,
        ];
    }
}
