<?php
declare(strict_types=1);

namespace ImaginaCRM\Permissions;

use ImaginaCRM\Support\ValidationResult;

/**
 * Gestiona roles personalizados (Fase 10 — pulidos).
 *
 * Los roles built-in (`crm_admin`/manager/agent/viewer/client) son fijos
 * y declarados en `CapabilityRegistry`. Roles custom son los que el
 * admin define con su propio set de caps `imcrm_*`. Útil para casos
 * como "Vendedor Senior" (manager + bulk_actions), "Soporte Cliente"
 * (view only + comments), etc.
 *
 * Storage: `wp_options.imcrm_custom_roles` = array
 *   `[ {slug, label, capabilities[]}, ... ]`.
 *
 * Convenciones:
 *  - El slug efectivo en WP es `crm_custom_<slug>` (prefijado para
 *    evitar colisión con built-ins y con WP).
 *  - El admin solo puede asignar caps del catálogo `imcrm_*` —
 *    intentar asignar caps WP core falla la validación.
 *  - El rol `read` (cap WP nativa) se agrega automáticamente para
 *    que el user pueda hacer login.
 *  - Los roles custom se sincronizan via `RoleInstaller::sync()` —
 *    se crean/actualizan en cada upgrade del plugin (idempotente).
 *  - Borrar un rol custom: el `RoleInstaller` detecta el delta y
 *    llama `remove_role()`. Los users que tenían ese rol pierden
 *    las caps pero NO se desactivan — los gestiona el admin manualmente.
 */
final class CustomRoleService
{
    public const OPTION_KEY = 'imcrm_custom_roles';
    public const SLUG_PREFIX = 'crm_custom_';

    /**
     * Devuelve la lista actual de roles custom desde wp_options.
     *
     * @return list<array{slug: string, label: string, capabilities: list<string>}>
     */
    public function all(): array
    {
        $raw = get_option(self::OPTION_KEY, []);
        if (! is_array($raw)) {
            return [];
        }
        $out = [];
        foreach ($raw as $entry) {
            if (! is_array($entry)) continue;
            $slug = isset($entry['slug']) && is_string($entry['slug']) ? $entry['slug'] : '';
            $label = isset($entry['label']) && is_string($entry['label']) ? $entry['label'] : '';
            $caps = isset($entry['capabilities']) && is_array($entry['capabilities'])
                ? $entry['capabilities']
                : [];
            if ($slug === '' || $label === '') continue;
            $caps = array_values(array_filter(
                $caps,
                static fn ($c): bool => is_string($c) && CapabilityRegistry::isPluginCapability($c),
            ));
            $out[] = ['slug' => $slug, 'label' => $label, 'capabilities' => $caps];
        }
        return $out;
    }

    /**
     * Persiste un rol custom (crear o actualizar). El sync con WP roles
     * lo hace `RoleInstaller::sync()` después.
     *
     * @param list<string> $capabilities
     */
    public function save(string $slug, string $label, array $capabilities): ValidationResult|true
    {
        $cleanSlug = $this->sanitizeSlug($slug);
        if ($cleanSlug === null) {
            return ValidationResult::failWith(
                'slug',
                __('Slug inválido. Solo letras minúsculas, números y guiones bajos (3-50 chars).', 'imagina-crm'),
            );
        }
        $cleanLabel = trim($label);
        if ($cleanLabel === '' || mb_strlen($cleanLabel) > 100) {
            return ValidationResult::failWith(
                'label',
                __('El nombre del rol es requerido (max 100 caracteres).', 'imagina-crm'),
            );
        }
        // No permitir override de slugs built-in.
        $builtIns = array_keys(CapabilityRegistry::roles());
        if (in_array(self::SLUG_PREFIX . $cleanSlug, $builtIns, true)) {
            return ValidationResult::failWith(
                'slug',
                __('Ese slug colisiona con un rol built-in.', 'imagina-crm'),
            );
        }

        // Filtrar caps a SOLO las del plugin.
        $allowedCaps = CapabilityRegistry::allCapabilities();
        $cleanCaps = [];
        foreach ($capabilities as $cap) {
            if (! is_string($cap)) continue;
            if (in_array($cap, $allowedCaps, true)) {
                $cleanCaps[] = $cap;
            }
        }
        $cleanCaps = array_values(array_unique($cleanCaps));

        $existing = $this->all();
        $found = false;
        foreach ($existing as &$entry) {
            if ($entry['slug'] === $cleanSlug) {
                $entry['label'] = $cleanLabel;
                $entry['capabilities'] = $cleanCaps;
                $found = true;
                break;
            }
        }
        unset($entry);
        if (! $found) {
            $existing[] = [
                'slug'         => $cleanSlug,
                'label'        => $cleanLabel,
                'capabilities' => $cleanCaps,
            ];
        }

        update_option(self::OPTION_KEY, $existing, false);
        return true;
    }

    /**
     * Borra un rol custom. WP role se remueve via RoleInstaller en el
     * próximo sync.
     */
    public function delete(string $slug): ValidationResult|true
    {
        $cleanSlug = $this->sanitizeSlug($slug);
        if ($cleanSlug === null) {
            return ValidationResult::failWith('slug', __('Slug inválido.', 'imagina-crm'));
        }
        $existing = $this->all();
        $filtered = array_values(array_filter(
            $existing,
            static fn (array $entry): bool => $entry['slug'] !== $cleanSlug,
        ));
        if (count($filtered) === count($existing)) {
            return ValidationResult::failWith('slug', __('El rol no existe.', 'imagina-crm'));
        }
        update_option(self::OPTION_KEY, $filtered, false);
        return true;
    }

    /**
     * Slug efectivo en WP (con prefijo `crm_custom_`). Usado por el
     * RoleInstaller al llamar `add_role`.
     */
    public function wpRoleSlug(string $slug): string
    {
        return self::SLUG_PREFIX . $slug;
    }

    /**
     * Sanea un slug a la convención del plugin:
     *  - lowercase
     *  - solo a-z 0-9 _
     *  - 3-50 chars
     *  - retorna null si no cumple
     */
    private function sanitizeSlug(string $raw): ?string
    {
        $clean = strtolower(trim($raw));
        $clean = preg_replace('/[^a-z0-9_]/', '', $clean) ?? '';
        $len = strlen($clean);
        if ($len < 3 || $len > 50) {
            return null;
        }
        return $clean;
    }
}
