<?php
declare(strict_types=1);

namespace ImaginaCRM\Support;

/**
 * Contexto bajo el cual se valida o resuelve un slug.
 *
 * Las reglas de unicidad y palabras reservadas difieren entre listas (alcance
 * global) y campos (alcance por lista). Se modela como enum para que el typing
 * sea exhaustivo en `SlugManager` y haya un único punto de verdad sobre los
 * tipos de entidad que tienen slug.
 */
enum SlugContext: string
{
    case List_ = 'list';
    case Field = 'field';

    /**
     * Valor estable usado en `wp_imcrm_slug_history.entity_type`.
     */
    public function entityType(): string
    {
        return $this->value;
    }
}
