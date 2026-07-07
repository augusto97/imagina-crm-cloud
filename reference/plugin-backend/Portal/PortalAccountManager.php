<?php
declare(strict_types=1);

namespace ImaginaCRM\Portal;

use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Permissions\CapabilityRegistry;
use ImaginaCRM\Records\RecordRepository;
use ImaginaCRM\Support\ValidationResult;

/**
 * Crea cuentas WP para clientes desde la UI del CRM (Fase 9 — 3.G).
 *
 * El admin abre el record de un cliente en la lista de portal y
 * presiona "Crear acceso al portal". El service:
 *   1. Valida que la lista efectivamente sea lista de portal.
 *   2. Lee el email + nombre del record (vía slugs configurados o
 *      el primer field de tipo `email` que encuentre).
 *   3. Crea (o reactiva) el user WP con rol `crm_client`.
 *   4. Asocia el user_id al `owner_field` del record.
 *   5. Opcionalmente envía el email de bienvenida con password
 *      generado por WP (`wp_send_new_user_notifications`).
 *
 * Idempotencia: si el record YA tiene un user asociado en
 * `owner_field`, el service devuelve éxito sin crear otro user.
 * Útil para reintento sin efectos colaterales.
 */
final class PortalAccountManager
{
    public function __construct(
        private readonly ClientResolverInterface $resolver,
        private readonly RecordRepository $records,
    ) {
    }

    /**
     * Resultado de `createAccessFor()`. Distingue:
     *  - éxito + user_id (recién creado o ya asociado).
     *  - error de validación (lista no es portal, record sin email,
     *    email inválido, etc.).
     *
     * @return array{user_id: int, created: bool, email: string}|ValidationResult
     */
    public function createAccessFor(
        ListEntity $portalList,
        int $recordId,
        bool $sendNotification = true,
    ): array|ValidationResult {
        if (! $this->isPortalList($portalList)) {
            return ValidationResult::failWith(
                'list',
                __('Esta lista no está marcada como lista de portal.', 'imagina-crm'),
            );
        }

        $ownerField = $this->resolver->ownerField($portalList);
        if ($ownerField === null) {
            return ValidationResult::failWith(
                'list',
                __('La lista de portal no tiene un campo de usuario configurado.', 'imagina-crm'),
            );
        }

        $row = $this->records->find($portalList->tableSuffix, $recordId);
        if ($row === null) {
            return ValidationResult::failWith(
                'record',
                __('No se encontró el registro del cliente.', 'imagina-crm'),
            );
        }

        // Idempotencia: si ya hay user asociado, no creamos otro.
        $existingUserId = isset($row[$ownerField->columnName])
            ? (int) $row[$ownerField->columnName]
            : 0;
        if ($existingUserId > 0) {
            $existingUser = get_user_by('id', $existingUserId);
            if ($existingUser !== false) {
                // Preferimos el email del WP user (siempre presente)
                // sobre el del record (puede no estar configurado).
                $emailForResp = is_string($existingUser->user_email) && $existingUser->user_email !== ''
                    ? $existingUser->user_email
                    : ($this->extractEmail($row, $portalList) ?? '');
                return [
                    'user_id' => $existingUserId,
                    'created' => false,
                    'email'   => $emailForResp,
                ];
            }
            // El user_id apuntaba a alguien que ya no existe (admin
            // borró el WP user manualmente). Limpiamos y creamos
            // uno nuevo abajo.
        }

        $email = $this->extractEmail($row, $portalList);
        if ($email === null) {
            return ValidationResult::failWith(
                'email',
                __('No se pudo determinar el email del cliente. Agrega un campo de tipo email al registro.', 'imagina-crm'),
            );
        }
        if (! is_email($email)) {
            return ValidationResult::failWith(
                'email',
                __('El email del cliente no es válido.', 'imagina-crm'),
            );
        }

        // Si ya existe un wp_user con ese email, lo reusamos (le
        // asignamos el rol crm_client si no lo tiene). Evita
        // colisiones cuando un cliente tiene varios records en
        // distintas instalaciones del mismo WP.
        $existingByEmail = get_user_by('email', $email);
        if ($existingByEmail !== false) {
            $userId = (int) $existingByEmail->ID;
            $this->ensureClientRole($userId);
            $this->associateUser($portalList, $ownerField->columnName, $recordId, $userId);
            return [
                'user_id' => $userId,
                'created' => false,
                'email'   => $email,
            ];
        }

        // Crear user nuevo. wp_generate_password genera la pass que se
        // envía en el email de bienvenida (si sendNotification=true).
        $userLogin = $this->generateLoginFromEmail($email);
        $password = function_exists('wp_generate_password') ? wp_generate_password(16, true, false) : 'temp-pass';
        $userId = wp_create_user($userLogin, $password, $email);
        if (is_wp_error($userId)) {
            return ValidationResult::failWith(
                'create_user',
                /* translators: %s: WP error message */
                sprintf(__('No se pudo crear el usuario: %s', 'imagina-crm'), $userId->get_error_message()),
            );
        }
        $userId = (int) $userId;

        $this->ensureClientRole($userId);
        $this->associateUser($portalList, $ownerField->columnName, $recordId, $userId);

        if ($sendNotification && function_exists('wp_send_new_user_notifications')) {
            // 'user' envía solo al usuario (no al admin) con la pass.
            wp_send_new_user_notifications($userId, 'user');
        }

        return [
            'user_id' => $userId,
            'created' => true,
            'email'   => $email,
        ];
    }

    private function isPortalList(ListEntity $list): bool
    {
        return PortalConfig::fromListSettings($list->settings)->isPortalList();
    }

    private function ensureClientRole(int $userId): void
    {
        $user = get_user_by('id', $userId);
        if ($user === false) {
            return;
        }
        if (! in_array(CapabilityRegistry::ROLE_CLIENT, (array) $user->roles, true)) {
            $user->add_role(CapabilityRegistry::ROLE_CLIENT);
        }
    }

    /**
     * Persiste el user_id en la columna del owner_field del record.
     */
    private function associateUser(
        ListEntity $portalList,
        string $columnName,
        int $recordId,
        int $userId,
    ): void {
        $this->records->update($portalList->tableSuffix, $recordId, [
            $columnName => $userId,
        ]);
    }

    /**
     * Busca un email en el record. Estrategia:
     *  1. Si la lista tiene `settings.portal.email_field_slug`, usar
     *     ese (admin puede override explícito).
     *  2. Sino, el primer field tipo `email` no soft-deleted.
     *  3. Sino, null.
     *
     * @param array<string, mixed> $row
     */
    private function extractEmail(array $row, ListEntity $portalList): ?string
    {
        // Override explícito en settings (futuro — por ahora no se usa).
        $portalCfg = $portalList->settings['portal'] ?? [];
        if (is_array($portalCfg) && isset($portalCfg['email_field_slug'])) {
            $slug = (string) $portalCfg['email_field_slug'];
            // El row del repository tiene columnas, no slugs — sin un
            // FieldRepository acá no podemos mapear. En el caller (REST
            // controller) habrá que pasar el row hidratado.
            // Por ahora caemos al fallback.
            unset($slug);
        }

        // Fallback: cualquier columna con valor que parezca email.
        // Funciona porque las columnas `email` en la BD almacenan
        // strings con formato email.
        foreach ($row as $key => $value) {
            if (! is_string($value)) {
                continue;
            }
            $value = trim($value);
            if ($value === '') {
                continue;
            }
            if (function_exists('is_email') && is_email($value)) {
                return $value;
            }
            // Si is_email no existe (entorno raro), filter_var fallback.
            if (! function_exists('is_email') && filter_var($value, FILTER_VALIDATE_EMAIL)) {
                return $value;
            }
        }
        return null;
    }

    private function generateLoginFromEmail(string $email): string
    {
        $local = strstr($email, '@', true);
        if ($local === false) {
            $local = $email;
        }
        $base = sanitize_user($local, true);
        if ($base === '') {
            $base = 'cliente';
        }
        // Si el login ya existe, append _N.
        $candidate = $base;
        $i = 2;
        while (get_user_by('login', $candidate) !== false) {
            $candidate = $base . '_' . $i;
            $i++;
            if ($i > 99) {
                // Bail-out — improbable pero defensivo.
                $candidate = $base . '_' . wp_generate_uuid4();
                break;
            }
        }
        return $candidate;
    }
}
