<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations;

/**
 * Motor de automatizaciones (CLAUDE.md §15).
 *
 * Dos rutas de ejecución:
 *
 * **Síncrona** (`dispatch()`): el listener de un `do_action` de WP llega
 * con su `TriggerContext`, pedimos al `TriggerInterface` si matchea, y
 * ejecutamos las acciones inline en la misma request. Útil para flujos
 * cortos (`update_field`) y aceptable para un solo `call_webhook` con
 * timeout 8s.
 *
 * **Asíncrona** (`enqueue()` + `runById()`): persiste un run en estado
 * `pending` y encola una tarea en Action Scheduler que más tarde
 * resuelve `runById($runId)` en una request separada (típicamente
 * disparada por el cron de WP). En fallo con retries disponibles,
 * `runById` re-encola con backoff.
 *
 * El modo se elige por automatización vía `is_async` (futuro flag en
 * `automations.settings`). Por ahora todas las automatizaciones corren
 * sync salvo las que provienen de triggers programados (que por
 * naturaleza llegan ya desde Action Scheduler) — eso lo decide el
 * caller invocando `enqueue()` en lugar de `dispatch()`.
 *
 * Errores de acción individuales se loguean pero NO abortan el run; el
 * run se marca `failed` si al menos una acción falló. El operador ve
 * el detalle en el log.
 */
final class AutomationEngine
{
    /**
     * Profundidad máxima de cadena síncrona (una automatización que
     * actualiza un campo dispara `record_updated` que puede gatillar otra,
     * etc.). 5 niveles permite cadenas legítimas pero rompe loops por
     * configuración accidental. La ruta async no participa de este
     * contador — cada job vive en su propia request.
     */
    public const MAX_DEPTH = 5;

    /**
     * Hook que Action Scheduler invoca para ejecutar un run encolado.
     * Plugin.php lo enlaza a `$engine->runById($runId)`.
     */
    public const HOOK_RUN_AUTOMATION = 'imagina_crm/automation_run';

    /**
     * Reintentos máximos antes de marcar un run como `failed` definitivo
     * (sin volver a encolar).
     */
    public const MAX_RETRIES = 3;

    /**
     * Backoff entre reintentos: 60s, 5min, 30min. Cubre desde flaps
     * cortos de red hasta caídas más largas sin saturar el queue.
     *
     * @var array<int, int>
     */
    private const RETRY_BACKOFF_SECONDS = [60, 300, 1800];

    private static int $currentDepth = 0;

    public function __construct(
        private readonly AutomationRepository $automations,
        private readonly AutomationRunRepository $runs,
        private readonly TriggerRegistry $triggers,
        private readonly ActionRegistry $actions,
    ) {
    }

    /**
     * Punto de entrada síncrono. Lo llaman los listeners de
     * `imagina_crm/record_created` y `imagina_crm/record_updated`.
     */
    public function dispatch(TriggerContext $context): void
    {
        if (self::$currentDepth >= self::MAX_DEPTH) {
            return;
        }

        $candidates = $this->findCandidates($context);
        if ($candidates === []) {
            return;
        }

        ++self::$currentDepth;
        try {
            foreach ($candidates as $automation) {
                try {
                    $this->runAutomation($automation, $context);
                } catch (\Throwable $e) {
                    $this->logFailedRun($automation, $context, $e->getMessage());
                }
            }
        } finally {
            --self::$currentDepth;
        }
    }

    /**
     * Punto de entrada asíncrono: persiste un run `pending` y encola
     * una acción en Action Scheduler. Un trigger programado o un caller
     * que prefiera diferir la ejecución usa este método.
     *
     * @return int|null Run id (0 si no había automatizaciones que matchearan).
     */
    public function enqueue(TriggerContext $context): ?int
    {
        $candidates = $this->findCandidates($context);
        if ($candidates === []) {
            return null;
        }

        $lastRunId = null;
        foreach ($candidates as $automation) {
            $runId = $this->persistPendingRun($automation, $context);
            $this->scheduleRun($runId);
            $lastRunId = $runId;
        }
        return $lastRunId;
    }

    /**
     * Ejecuta un run previamente encolado. Lo invoca Action Scheduler vía
     * `HOOK_RUN_AUTOMATION`. Maneja reintentos: si la ejecución termina en
     * `failed` y aún hay retries disponibles, re-encola con backoff.
     */
    public function runById(int $runId): void
    {
        $row = $this->runs->find($runId);
        if ($row === null) {
            return;
        }

        $automationId = (int) ($row['automation_id'] ?? 0);
        $automation   = $this->automations->find($automationId);
        if ($automation === null) {
            $this->runs->update($runId, [
                'status' => AutomationRunRepository::STATUS_FAILED,
                'error'  => 'Automation not found at run time.',
                'finished_at' => current_time('mysql', true),
            ]);
            return;
        }

        $context = $this->rehydrateContext($row, $automation);
        if ($context === null) {
            $this->runs->update($runId, [
                'status' => AutomationRunRepository::STATUS_FAILED,
                'error'  => 'Could not rehydrate trigger context.',
                'finished_at' => current_time('mysql', true),
            ]);
            return;
        }

        $this->runs->update($runId, [
            'status'     => AutomationRunRepository::STATUS_RUNNING,
            'started_at' => current_time('mysql', true),
        ]);

        $log         = [];
        $hadAnyOk    = false;
        $hadAnyFail  = false;

        foreach ($automation->actions as $spec) {
            foreach ($this->executeStep($spec, $context) as $result) {
                $log[] = $result->toArray();
                if ($result->isSuccess()) {
                    $hadAnyOk = true;
                } elseif ($result->isFailed()) {
                    $hadAnyFail = true;
                }
            }
        }

        $finalStatus = $hadAnyFail
            ? AutomationRunRepository::STATUS_FAILED
            : AutomationRunRepository::STATUS_SUCCESS;

        $retries = (int) ($row['retries'] ?? 0);

        $this->runs->update($runId, [
            'status'      => $finalStatus,
            'actions_log' => $log,
            'finished_at' => current_time('mysql', true),
        ]);

        if ($finalStatus === AutomationRunRepository::STATUS_FAILED && $retries < self::MAX_RETRIES) {
            $this->scheduleRun($runId, self::RETRY_BACKOFF_SECONDS[$retries] ?? 60);
            $this->runs->update($runId, ['retries' => $retries + 1]);
        }

        unset($hadAnyOk);

        do_action(
            'imagina_crm/automation_run_completed',
            $automation,
            $runId,
            $finalStatus,
            $log,
        );
    }

    /**
     * Útil para tests: resetea el contador de profundidad entre tests
     * para evitar contaminación.
     */
    public static function resetDepth(): void
    {
        self::$currentDepth = 0;
    }

    /**
     * Resuelve trigger + filtra automatizaciones activas que matchean.
     *
     * Importante: un mismo evento WP puede ser observado por varios
     * triggers distintos (ej. `record_updated` lo observan tanto el
     * trigger del mismo nombre como `field_changed`; `scheduled_tick`
     * lo observan `scheduled` y `due_date_reached`). Iteramos todos los
     * triggers que matchean el evento y consultamos las automatizaciones
     * para cada uno.
     *
     * @return array<int, AutomationEntity>
     */
    private function findCandidates(TriggerContext $context): array
    {
        $triggerSlugs = $this->resolveTriggerSlugsForEvent($context->event);
        if ($triggerSlugs === []) {
            return [];
        }

        $matched = [];
        foreach ($triggerSlugs as $slug) {
            $trigger = $this->triggers->get($slug);
            if ($trigger === null) {
                continue;
            }
            $automations = $this->automations->activeForListAndTrigger($context->list->id, $slug);
            foreach ($automations as $automation) {
                try {
                    if ($trigger->matches($context, $automation->triggerConfig)) {
                        $matched[] = $automation;
                    }
                } catch (\Throwable $e) {
                    $this->logFailedRun($automation, $context, 'Trigger error: ' . $e->getMessage());
                }
            }
        }
        return $matched;
    }

    /**
     * Ejecuta acciones de una automatización y persiste el run.
     */
    private function runAutomation(AutomationEntity $automation, TriggerContext $context): void
    {
        $runId = $this->persistPendingRun($automation, $context);
        $this->runs->update($runId, [
            'status'     => AutomationRunRepository::STATUS_RUNNING,
            'started_at' => current_time('mysql', true),
        ]);

        $log         = [];
        $hadAnyOk    = false;
        $hadAnyFail  = false;

        foreach ($automation->actions as $spec) {
            foreach ($this->executeStep($spec, $context) as $result) {
                $log[] = $result->toArray();
                if ($result->isSuccess()) {
                    $hadAnyOk = true;
                } elseif ($result->isFailed()) {
                    $hadAnyFail = true;
                }
            }
        }

        $finalStatus = $hadAnyFail
            ? AutomationRunRepository::STATUS_FAILED
            : AutomationRunRepository::STATUS_SUCCESS;

        $this->runs->update($runId, [
            'status'      => $finalStatus,
            'actions_log' => $log,
            'finished_at' => current_time('mysql', true),
        ]);

        unset($hadAnyOk);

        do_action(
            'imagina_crm/automation_run_completed',
            $automation,
            $runId,
            $finalStatus,
            $log,
        );
    }

    /**
     * Ejecuta un step y retorna todos los `ActionResult` que produjo —
     * normalmente uno solo, pero `if_else` emite uno por la decisión
     * más uno por cada acción del branch elegido.
     *
     * @param array{type: string, config: array<string, mixed>, condition?: array<string, mixed>|null} $spec
     * @return array<int, ActionResult>
     */
    private function executeStep(array $spec, TriggerContext $context): array
    {
        // Gate por condition de nivel-acción (común a TODAS las acciones,
        // incluido `if_else`). Si no matchea, skip ANTES de tocar nada.
        $condition = isset($spec['condition']) && is_array($spec['condition']) ? $spec['condition'] : null;
        if (! ConditionEvaluator::matches($context, $condition)) {
            return [ActionResult::skipped(
                $spec['type'],
                'Condición de ejecución no cumplida.',
            )];
        }

        // `if_else`: control de flujo — el engine maneja la recursión.
        // Nunca llamamos al ActionRegistry para este tipo (su execute()
        // es solo un stub).
        if ($spec['type'] === 'if_else') {
            return $this->executeIfElse($spec['config'], $context);
        }

        $action = $this->actions->get($spec['type']);
        if ($action === null) {
            return [ActionResult::skipped(
                $spec['type'],
                'Acción no registrada en el ActionRegistry.',
            )];
        }

        try {
            return [$action->execute($context, $spec['config'])];
        } catch (\Throwable $e) {
            return [ActionResult::failed($spec['type'], $e->getMessage())];
        }
    }

    /**
     * Evalúa `config.condition` y ejecuta el branch correspondiente
     * (`then_actions` o `else_actions`). Devuelve UN summary del nodo
     * if_else + los resultados de cada acción del branch ejecutado.
     *
     * Cada acción nested es un `ActionSpec` regular y puede ser otro
     * `if_else` (anidamiento sin límite en runtime — la validación lo
     * cap a `MAX_IF_ELSE_DEPTH` antes de llegar acá).
     *
     * @param array<string, mixed> $config
     * @return array<int, ActionResult>
     */
    private function executeIfElse(array $config, TriggerContext $context): array
    {
        $condition = isset($config['condition']) && is_array($config['condition']) ? $config['condition'] : null;
        $matched = ConditionEvaluator::matches($context, $condition);

        $branchKey = $matched ? 'then_actions' : 'else_actions';
        $branch = isset($config[$branchKey]) && is_array($config[$branchKey]) ? $config[$branchKey] : [];

        $summary = ActionResult::success(
            'if_else',
            $matched ? 'Condición matcheó → branch then' : 'Condición no matcheó → branch else',
            ['branch' => $matched ? 'then' : 'else', 'count' => count($branch)],
        );

        $results = [$summary];
        foreach ($branch as $nested) {
            if (! is_array($nested) || ! isset($nested['type']) || ! is_string($nested['type'])) {
                continue;
            }
            $stepSpec = [
                'type'      => $nested['type'],
                'config'    => isset($nested['config']) && is_array($nested['config']) ? $nested['config'] : [],
                'condition' => isset($nested['condition']) && is_array($nested['condition']) ? $nested['condition'] : null,
            ];
            foreach ($this->executeStep($stepSpec, $context) as $r) {
                $results[] = $r;
            }
        }
        return $results;
    }

    private function persistPendingRun(AutomationEntity $automation, TriggerContext $context): int
    {
        return $this->runs->create([
            'automation_id'   => $automation->id,
            'list_id'         => $context->list->id,
            'record_id'       => $context->recordId(),
            'status'          => AutomationRunRepository::STATUS_PENDING,
            'trigger_context' => $context->toArray(),
            'started_at'      => null,
        ]);
    }

    /**
     * Encola un run en Action Scheduler. Si la librería no está cargada
     * (entornos de test, AS desactivado), persiste el run como `failed`
     * con un error explicativo en lugar de fallar silenciosamente.
     */
    private function scheduleRun(int $runId, int $delaySeconds = 0): void
    {
        if (! function_exists('as_schedule_single_action') || ! function_exists('as_enqueue_async_action')) {
            $this->runs->update($runId, [
                'status' => AutomationRunRepository::STATUS_FAILED,
                'error'  => 'Action Scheduler no está disponible.',
                'finished_at' => current_time('mysql', true),
            ]);
            return;
        }

        if ($delaySeconds <= 0) {
            as_enqueue_async_action(self::HOOK_RUN_AUTOMATION, [$runId], 'imagina-crm');
            return;
        }
        as_schedule_single_action(time() + $delaySeconds, self::HOOK_RUN_AUTOMATION, [$runId], 'imagina-crm');
    }

    /**
     * Reconstruye un `TriggerContext` a partir del JSON persistido en
     * `trigger_context`. Necesario en la ruta async porque la request que
     * ejecuta el run es distinta de la que lo encoló.
     *
     * @param array<string, mixed> $row
     */
    private function rehydrateContext(array $row, AutomationEntity $automation): ?TriggerContext
    {
        $raw = $row['trigger_context'] ?? null;
        if (! is_string($raw) || $raw === '') {
            return null;
        }
        $decoded = json_decode($raw, true);
        if (! is_array($decoded)) {
            return null;
        }

        $listId = (int) ($decoded['list_id'] ?? $automation->listId);
        // Evitamos depender de ListRepository aquí: usamos el listId del
        // payload y construimos un ListEntity mínimo. Las acciones que
        // necesitan más datos de la lista (UpdateFieldAction usa
        // RecordService que ya re-resuelve la lista) están bien.
        $list = new \ImaginaCRM\Lists\ListEntity(
            id: $listId,
            slug: '',
            tableSuffix: '',
            name: '',
            description: null,
            icon: null,
            color: null,
            settings: [],
            position: 0,
            createdBy: 0,
            createdAt: '',
            updatedAt: '',
            deletedAt: null,
        );

        return new TriggerContext(
            event: (string) ($decoded['event'] ?? ''),
            list: $list,
            record: is_array($decoded['record'] ?? null) ? $decoded['record'] : null,
            previousRecord: is_array($decoded['previous'] ?? null) ? $decoded['previous'] : null,
            extra: is_array($decoded['extra'] ?? null) ? $decoded['extra'] : [],
        );
    }

    private function logFailedRun(AutomationEntity $automation, TriggerContext $context, string $error): void
    {
        $now = current_time('mysql', true);
        $this->runs->create([
            'automation_id'   => $automation->id,
            'list_id'         => $context->list->id,
            'record_id'       => $context->recordId(),
            'status'          => AutomationRunRepository::STATUS_FAILED,
            'trigger_context' => $context->toArray(),
            'started_at'      => $now,
        ]);
    }

    /**
     * @return array<int, string>
     */
    private function resolveTriggerSlugsForEvent(string $event): array
    {
        $slugs = [];
        foreach ($this->triggers->all() as $trigger) {
            if ($trigger->getEvent() === $event) {
                $slugs[] = $trigger->getSlug();
            }
        }
        return $slugs;
    }
}
