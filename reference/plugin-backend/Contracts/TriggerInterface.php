<?php
declare(strict_types=1);

namespace ImaginaCRM\Contracts;

use ImaginaCRM\Automations\TriggerContext;

/**
 * Contrato de un tipo de trigger (CLAUDE.md §15 — Fase 2).
 *
 * Cada trigger se identifica por su slug (ej. `record_created`). El
 * engine pregunta a cada automatización configurada con ese slug si
 * debe disparar, pasándole un `TriggerContext`. El trigger evalúa sus
 * filtros propios (parametrizados via `config`) y decide.
 */
interface TriggerInterface
{
    public function getSlug(): string;

    public function getLabel(): string;

    /**
     * Evento WP que dispara este trigger (`imagina_crm/record_created`,
     * `imagina_crm/record_updated`, etc.). El engine usa este valor para
     * routear desde un único listener genérico.
     *
     * Para triggers programados (`scheduled`, `due_date_reached`), devuelve
     * un identificador de cron interno y el engine los corre desde su
     * propio loop, no desde un do_action.
     */
    public function getEvent(): string;

    /**
     * Decide si este trigger debe disparar para el contexto dado.
     *
     * @param array<string, mixed> $config Config de la automatización.
     */
    public function matches(TriggerContext $context, array $config): bool;

    /**
     * Schema declarativo del config para construir UI en el frontend.
     *
     * @return array<string, array<string, mixed>>
     */
    public function getConfigSchema(): array;
}
