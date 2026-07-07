<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations;

use ImaginaCRM\Automations\Triggers\DueDateReachedTrigger;
use ImaginaCRM\Automations\Triggers\ScheduledTrigger;
use ImaginaCRM\Lists\ListRepository;
use ImaginaCRM\Records\RecordService;
use ImaginaCRM\Support\ValidationResult;

/**
 * Driver de los triggers basados en tiempo (`scheduled`,
 * `due_date_reached`).
 *
 * Action Scheduler ejecuta `tick()` cada hora (granularidad mínima de
 * cualquiera de las frecuencias soportadas). En cada tick:
 *
 * 1. Busca automatizaciones activas con trigger_type ∈ {scheduled,
 *    due_date_reached}.
 * 2. Para cada una: resuelve la lista, recorre los registros activos
 *    paginadamente, construye un `TriggerContext` con el evento
 *    sintético `imagina_crm/scheduled_tick` y llama
 *    `engine->enqueue()`. El engine se encarga de la evaluación del
 *    `matches()` (con offset/tolerance para due_date_reached) y de la
 *    persistencia/encolado del run.
 *
 * Para evitar disparos duplicados antes del intervalo configurado,
 * `scheduled` consulta el último run conocido y salta si es muy
 * reciente. `due_date_reached` no necesita esa lógica porque su
 * `matches()` ya filtra por la ventana de tolerancia (es válido — y
 * deseable — re-evaluar cada hora; solo dispara cuando estamos cerca
 * del target).
 */
final class ScheduledRunner
{
    /**
     * Hook AS recurrente. Plugin.php lo enlaza a `tick()`.
     */
    public const HOOK_TICK = 'imagina_crm/scheduled_runner_tick';

    /**
     * Granularidad del runner. Una hora cubre 'hourly' (la frecuencia
     * más fina) y deja a `scheduled` saltar ticks intermedios cuando su
     * frecuencia es mayor.
     */
    public const TICK_INTERVAL_SECONDS = 3600;

    /**
     * Tamaño de página al recorrer registros. Balance entre número de
     * queries y memoria por tick. 200 records × 1KB ≈ 200KB; con listas
     * gigantes el tick se reparte en varias páginas y, ante caída,
     * Action Scheduler reintenta el job completo (lo que reprocesará la
     * automatización entera, pero idempotencia la cubre `enqueue()` en
     * caso de duplicados — los runs son trazables aunque rehagan la
     * misma acción).
     */
    public const RECORD_PAGE_SIZE = 200;

    public function __construct(
        private readonly AutomationRepository $automations,
        private readonly AutomationRunRepository $runs,
        private readonly ListRepository $lists,
        private readonly RecordService $records,
        private readonly AutomationEngine $engine,
    ) {
    }

    /**
     * Asegura que el tick recurrente esté programado en Action Scheduler.
     * Idempotente: si ya hay una entrada activa, no la duplica.
     *
     * Llamado desde `Activation\Installer::activate()` para no perder el
     * scheduling cuando se actualiza el plugin.
     */
    public static function ensureScheduled(): void
    {
        if (! function_exists('as_has_scheduled_action') || ! function_exists('as_schedule_recurring_action')) {
            return;
        }
        if (as_has_scheduled_action(self::HOOK_TICK, [], 'imagina-crm')) {
            return;
        }
        as_schedule_recurring_action(
            time() + 60,
            self::TICK_INTERVAL_SECONDS,
            self::HOOK_TICK,
            [],
            'imagina-crm',
        );
    }

    /**
     * Quita el tick recurrente del scheduler. Llamado desde
     * `Activation\Deactivator::deactivate()` para no dejar jobs
     * huérfanos cuando el plugin se desactiva.
     */
    public static function unschedule(): void
    {
        if (function_exists('as_unschedule_all_actions')) {
            as_unschedule_all_actions(self::HOOK_TICK, [], 'imagina-crm');
        }
    }

    /**
     * Punto de entrada llamado por Action Scheduler en cada tick.
     */
    public function tick(): void
    {
        $candidates = $this->automations->activeWithTriggers([
            ScheduledTrigger::SLUG,
            DueDateReachedTrigger::SLUG,
        ]);

        foreach ($candidates as $automation) {
            try {
                $this->processAutomation($automation);
            } catch (\Throwable $e) {
                // Una automatización rota no debe abortar el tick
                // entero — las demás siguen procesándose.
                do_action(
                    'imagina_crm/scheduled_runner_error',
                    $automation,
                    $e->getMessage(),
                );
            }
        }
    }

    private function processAutomation(AutomationEntity $automation): void
    {
        $list = $this->lists->find($automation->listId);
        if ($list === null) {
            return;
        }

        // `scheduled` respeta la frecuencia del config; `due_date_reached`
        // se evalúa en cada tick y el propio trigger filtra por tolerancia.
        if ($automation->triggerType === ScheduledTrigger::SLUG && ! $this->shouldFireScheduled($automation)) {
            return;
        }

        $page = 1;
        do {
            $result = $this->records->list(
                $list,
                filters: [],
                sort: [],
                fields: [],
                search: null,
                page: $page,
                perPage: self::RECORD_PAGE_SIZE,
            );
            if ($result instanceof ValidationResult) {
                return;
            }

            foreach ($result['data'] as $record) {
                $context = new TriggerContext(
                    event: ScheduledTrigger::EVENT,
                    list: $list,
                    record: $record,
                );
                $this->engine->enqueue($context);
            }

            $totalPages = (int) ($result['meta']['total_pages'] ?? 1);
            ++$page;
        } while ($page <= $totalPages);
    }

    /**
     * Decide si una automatización `scheduled` debe disparar en este
     * tick. Compara contra el último run registrado y la frecuencia
     * configurada con un margen de media hora para no perder ticks
     * por jitter del cron.
     */
    private function shouldFireScheduled(AutomationEntity $automation): bool
    {
        $frequency       = (string) ($automation->triggerConfig['frequency'] ?? 'daily');
        $intervalSeconds = ScheduledTrigger::frequencyToSeconds($frequency);

        $recent = $this->runs->recentForAutomation($automation->id, 1);
        if ($recent === []) {
            return true;
        }

        $createdAt = $recent[0]['created_at'] ?? null;
        if (! is_string($createdAt) || $createdAt === '') {
            return true;
        }
        $lastTimestamp = strtotime($createdAt);
        if ($lastTimestamp === false) {
            return true;
        }

        // Margen de seguridad: 30 minutos antes del intervalo nominal
        // para no perder ticks por jitter del cron.
        $minElapsed = max(60, $intervalSeconds - 1800);
        return (time() - $lastTimestamp) >= $minElapsed;
    }
}
