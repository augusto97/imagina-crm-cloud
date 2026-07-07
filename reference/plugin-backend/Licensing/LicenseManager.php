<?php
declare(strict_types=1);

namespace ImaginaCRM\Licensing;

use ImaginaCRM\Support\ValidationResult;

/**
 * Orquesta el ciclo de vida de la licencia (CLAUDE.md §14).
 *
 * Reglas:
 *
 * - Persistimos el estado en una sola opción (`imcrm_license_state`).
 * - `activate()` consulta al servidor con `action=activate`. Si el servidor
 *   acepta, persistimos `valid` con `expires_at`/`site_limit`. Si rechaza
 *   con un status conocido, persistimos ese status (no lanzamos).
 * - `deactivate()` notifica al servidor (`action=deactivate`) y deja el
 *   estado en `inactive`, tolerando fallos de red (queremos que el usuario
 *   pueda desactivar siempre desde su lado).
 * - `refresh()` re-valida manualmente. Si la red falla y la licencia ya
 *   estaba `valid`, abrimos un grace period de 7 días.
 * - `dailyCheck()` corre desde wp-cron una vez al día. Misma lógica que
 *   `refresh()` pero sin tocar el estado si todo está bien.
 *
 * NUNCA bloqueamos datos del usuario por estado de licencia (ADR-007).
 * El gate es solo para `UpdaterClient`.
 */
final class LicenseManager
{
    public const OPTION_KEY        = 'imcrm_license_state';
    public const CRON_HOOK         = 'imagina_crm/license_check';
    public const GRACE_PERIOD_DAYS = 7;

    public function __construct(private readonly LicenseHttpClient $http)
    {
    }

    public function getState(): LicenseState
    {
        $raw = get_option(self::OPTION_KEY);
        if (! is_array($raw)) {
            return LicenseState::inactive();
        }
        return LicenseState::fromArray($raw);
    }

    /**
     * Activa una licencia. Devuelve el nuevo estado o `ValidationResult`
     * con error legible si el input es vacío.
     */
    public function activate(string $key): LicenseState|ValidationResult
    {
        $key = trim($key);
        if ($key === '') {
            return ValidationResult::failWith('key', __('La clave de licencia es obligatoria.', 'imagina-crm'));
        }

        try {
            $response = $this->http->call('activate', $key, $this->siteUrl());
        } catch (LicenseException $e) {
            // En activación NO abrimos grace period: el usuario está
            // intentando registrarse y debe ver el error.
            $state = $e->isNetwork()
                ? new LicenseState(
                    key: $key,
                    status: LicenseState::STATUS_INACTIVE,
                    activatedAt: null,
                    expiresAt: null,
                    lastCheckAt: $this->now(),
                    graceUntil: null,
                    siteLimit: null,
                    activationsCount: null,
                    message: $e->getMessage(),
                )
                : $this->stateFromServerFailure($key, $e);
            $this->persist($state);
            return $state;
        }

        $state = $this->stateFromSuccess($key, $response, activated: true);
        $this->persist($state);
        return $state;
    }

    /**
     * Desactiva la licencia local y notifica al servidor.
     * Incluso si el servidor no responde, dejamos el estado en `inactive`.
     */
    public function deactivate(): LicenseState
    {
        $current = $this->getState();
        if ($current->isActive()) {
            try {
                $this->http->call('deactivate', $current->key, $this->siteUrl());
            } catch (LicenseException) {
                // Fallo silencioso: el usuario quiere desactivar, no bloqueamos.
            }
        }
        $inactive = LicenseState::inactive();
        $this->persist($inactive);
        return $inactive;
    }

    /**
     * Re-valida la licencia actual. Si el último check estaba `valid` y
     * fallamos por red, abrimos/extendemos el grace period.
     */
    public function refresh(): LicenseState
    {
        $current = $this->getState();
        if (! $current->isActive()) {
            return $current;
        }

        try {
            $response = $this->http->call('validate', $current->key, $this->siteUrl());
        } catch (LicenseException $e) {
            if ($e->isNetwork()) {
                $state = $this->withGraceFromCurrent($current, $e->getMessage());
            } else {
                $state = $this->stateFromServerFailure($current->key, $e);
            }
            $this->persist($state);
            return $state;
        }

        $state = $this->stateFromSuccess($current->key, $response, activated: false);
        $this->persist($state);
        return $state;
    }

    /**
     * Hook de cron diario. Mismo flujo que `refresh()`.
     */
    public function dailyCheck(): void
    {
        if (! $this->getState()->isActive()) {
            return;
        }
        $this->refresh();
    }

    /**
     * Programa el cron diario si la licencia está activa.
     */
    public function scheduleCron(): void
    {
        if (! wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time() + DAY_IN_SECONDS, 'daily', self::CRON_HOOK);
        }
    }

    public function unscheduleCron(): void
    {
        $next = wp_next_scheduled(self::CRON_HOOK);
        if ($next !== false) {
            wp_unschedule_event($next, self::CRON_HOOK);
        }
    }

    /**
     * @param array<string, mixed> $response
     */
    private function stateFromSuccess(string $key, array $response, bool $activated): LicenseState
    {
        $current = $this->getState();
        return new LicenseState(
            key: $key,
            status: LicenseState::STATUS_VALID,
            activatedAt: $activated || $current->activatedAt === null ? $this->now() : $current->activatedAt,
            expiresAt: isset($response['expires_at']) && is_string($response['expires_at']) ? $response['expires_at'] : null,
            lastCheckAt: $this->now(),
            graceUntil: null,
            siteLimit: isset($response['site_limit']) ? (int) $response['site_limit'] : null,
            activationsCount: isset($response['activations_count']) ? (int) $response['activations_count'] : null,
            message: isset($response['message']) && is_string($response['message']) ? $response['message'] : null,
        );
    }

    private function stateFromServerFailure(string $key, LicenseException $e): LicenseState
    {
        $status = match ($e->serverStatus) {
            LicenseState::STATUS_EXPIRED            => LicenseState::STATUS_EXPIRED,
            LicenseState::STATUS_SITE_LIMIT_REACHED => LicenseState::STATUS_SITE_LIMIT_REACHED,
            default                                 => LicenseState::STATUS_INVALID,
        };
        return new LicenseState(
            key: $key,
            status: $status,
            activatedAt: null,
            expiresAt: null,
            lastCheckAt: $this->now(),
            graceUntil: null,
            siteLimit: null,
            activationsCount: null,
            message: $e->getMessage(),
        );
    }

    private function withGraceFromCurrent(LicenseState $current, string $message): LicenseState
    {
        // Si ya estábamos en gracia, conservamos `grace_until`. Si no,
        // arrancamos uno nuevo desde ahora.
        $graceUntil = $current->graceUntil ?? gmdate(
            'Y-m-d H:i:s',
            time() + self::GRACE_PERIOD_DAYS * DAY_IN_SECONDS,
        );

        return new LicenseState(
            key: $current->key,
            status: $current->status, // mantenemos `valid` durante la gracia
            activatedAt: $current->activatedAt,
            expiresAt: $current->expiresAt,
            lastCheckAt: $this->now(),
            graceUntil: $graceUntil,
            siteLimit: $current->siteLimit,
            activationsCount: $current->activationsCount,
            message: $message,
        );
    }

    private function persist(LicenseState $state): void
    {
        update_option(self::OPTION_KEY, $state->toArray(), false);
        do_action('imagina_crm/license_state_changed', $state);
    }

    private function siteUrl(): string
    {
        return home_url('/');
    }

    private function now(): string
    {
        return gmdate('Y-m-d H:i:s');
    }
}
