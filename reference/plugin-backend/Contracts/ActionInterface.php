<?php
declare(strict_types=1);

namespace ImaginaCRM\Contracts;

use ImaginaCRM\Automations\ActionResult;
use ImaginaCRM\Automations\TriggerContext;

/**
 * Contrato de un tipo de acción (CLAUDE.md §15 — Fase 2).
 *
 * Una automatización tiene N acciones que se ejecutan en orden cuando el
 * trigger dispara. Cada acción recibe el `TriggerContext` original y su
 * `config` (parametrizada por el usuario en el builder).
 *
 * `execute()` debe ser idempotente cuando sea posible: el engine puede
 * reintentar acciones fallidas, así que evitar efectos no idempotentes
 * sin un guard apropiado (ej. enviar email solo si no se envió ya).
 */
interface ActionInterface
{
    public function getSlug(): string;

    public function getLabel(): string;

    /**
     * Ejecuta la acción con la config especificada. Devuelve un
     * `ActionResult` (success/failed/skipped); NO debe lanzar — los
     * errores recuperables se reportan vía `ActionResult::failed`.
     *
     * @param array<string, mixed> $config
     */
    public function execute(TriggerContext $context, array $config): ActionResult;

    /**
     * Schema declarativo para construir UI del config en el frontend.
     *
     * @return array<string, array<string, mixed>>
     */
    public function getConfigSchema(): array;
}
