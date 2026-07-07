<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations\Actions;

use ImaginaCRM\Automations\ActionResult;
use ImaginaCRM\Automations\TriggerContext;
use ImaginaCRM\Contracts\ActionInterface;

/**
 * Acción "control de flujo" `if_else`.
 *
 * Es un stub: el engine SIEMPRE intercepta este tipo en
 * `AutomationEngine::executeAction()` y maneja la recursión por su
 * cuenta. Esta clase existe solo para que `if_else` aparezca en el
 * catálogo `/actions` (mismo shape que el resto) y para que el
 * ActionRegistry la valide como tipo conocido.
 *
 * Si por alguna razón el engine NO intercepta (regresión), `execute()`
 * devuelve `failed` en lugar de fingir éxito — preferible romper
 * ruidosamente que ejecutar silenciosamente solo el branch then.
 *
 * Shape del config:
 *   {
 *     condition: { slug: valor, ... },     // misma shape que field_filters
 *     then_actions: ActionSpec[],          // ejecutadas si condition matchea
 *     else_actions: ActionSpec[],          // ejecutadas si condition NO matchea
 *   }
 */
final class IfElseAction implements ActionInterface
{
    public function getSlug(): string
    {
        return 'if_else';
    }

    public function getLabel(): string
    {
        return 'Si / sino (condicional)';
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    public function getConfigSchema(): array
    {
        return [
            'condition'    => ['type' => 'object',  'default' => []],
            'then_actions' => ['type' => 'array',   'default' => []],
            'else_actions' => ['type' => 'array',   'default' => []],
        ];
    }

    /**
     * Stub. El engine NUNCA debe llegar acá — `executeAction()` detecta
     * el tipo `if_else` antes y maneja la recursión.
     *
     * @param array<string, mixed> $config
     */
    public function execute(TriggerContext $context, array $config): ActionResult
    {
        return ActionResult::failed(
            $this->getSlug(),
            'IfElseAction::execute() invocado directamente — el engine no '
            . 'interceptó el control flow. Esto es un bug, abrir issue.',
        );
    }
}
