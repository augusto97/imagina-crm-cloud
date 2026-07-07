<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations\Actions;

use ImaginaCRM\Automations\ActionResult;
use ImaginaCRM\Automations\TriggerContext;
use ImaginaCRM\Records\RecordService;

/**
 * Acción `update_field`: actualiza uno o más campos del registro que
 * disparó el trigger.
 *
 * Config:
 * - `values`: `[slug => valor|template]`. Los templates con
 *   `{{slug}}` se evalúan contra el contexto antes de aplicar.
 *
 * Ejemplo: cuando un lead pasa a status=qualified, asignar
 * `assigned_to = {{record.created_by}}` y `priority = "high"`.
 */
final class UpdateFieldAction extends AbstractAction
{
    public const SLUG = 'update_field';

    public function __construct(private readonly RecordService $records)
    {
    }

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Actualizar campo del registro', 'imagina-crm');
    }

    public function execute(TriggerContext $context, array $config): ActionResult
    {
        $recordId = $context->recordId();
        if ($recordId === null) {
            return ActionResult::skipped(self::SLUG, 'No hay record_id en el contexto.');
        }

        $values = $config['values'] ?? null;
        if (! is_array($values) || $values === []) {
            return ActionResult::skipped(self::SLUG, 'Sin valores a actualizar.');
        }

        $resolved = [];
        foreach ($values as $slug => $template) {
            if (! is_string($slug)) {
                continue;
            }
            // Strings con merge tags se interpolan; otros tipos pasan tal cual.
            $resolved[$slug] = is_string($template)
                ? $this->applyMergeTags($template, $context)
                : $template;
        }

        $result = $this->records->update($context->list, $recordId, $resolved);

        if (is_array($result)) {
            return ActionResult::success(self::SLUG, null, [
                'record_id' => $recordId,
                'updated'   => array_keys($resolved),
            ]);
        }

        return ActionResult::failed(
            self::SLUG,
            $result->firstError() ?? 'No se pudo actualizar el registro.',
            ['errors' => $result->errors()],
        );
    }

    public function getConfigSchema(): array
    {
        return [
            'values' => [
                'type' => 'object',
                'description' => 'Pares slug → valor (acepta merge tags `{{slug}}`).',
                'required' => true,
            ],
        ];
    }
}
