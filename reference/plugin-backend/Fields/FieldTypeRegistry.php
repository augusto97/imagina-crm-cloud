<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields;

use ImaginaCRM\Contracts\FieldTypeInterface;
use ImaginaCRM\Fields\Types\CheckboxField;
use ImaginaCRM\Fields\Types\ComputedField;
use ImaginaCRM\Fields\Types\CurrencyField;
use ImaginaCRM\Fields\Types\DateField;
use ImaginaCRM\Fields\Types\DateTimeField;
use ImaginaCRM\Fields\Types\EmailField;
use ImaginaCRM\Fields\Types\FileField;
use ImaginaCRM\Fields\Types\LongTextField;
use ImaginaCRM\Fields\Types\MultiSelectField;
use ImaginaCRM\Fields\Types\NumberField;
use ImaginaCRM\Fields\Types\RelationField;
use ImaginaCRM\Fields\Types\SelectField;
use ImaginaCRM\Fields\Types\TextField;
use ImaginaCRM\Fields\Types\UrlField;
use ImaginaCRM\Fields\Types\UserField;

/**
 * Catálogo de tipos de campo soportados por el plugin.
 *
 * Se registran los 14 tipos del MVP en construcción. Tipos custom de
 * terceros pueden registrarse vía `register()` sobre el filtro
 * `imagina_crm/field_types/registered` (Fase 2).
 */
final class FieldTypeRegistry
{
    /** @var array<string, FieldTypeInterface> */
    private array $types = [];

    public function __construct()
    {
        $this->registerDefaults();
    }

    public function register(FieldTypeInterface $type): void
    {
        $this->types[$type->getSlug()] = $type;
    }

    public function has(string $slug): bool
    {
        return isset($this->types[$slug]);
    }

    public function get(string $slug): ?FieldTypeInterface
    {
        return $this->types[$slug] ?? null;
    }

    /**
     * @return array<string, FieldTypeInterface>
     */
    public function all(): array
    {
        return $this->types;
    }

    /**
     * Forma serializable usada por `/field-types`.
     *
     * @return array<int, array<string, mixed>>
     */
    public function toArray(): array
    {
        $out = [];
        foreach ($this->types as $type) {
            $out[] = [
                'slug'             => $type->getSlug(),
                'label'            => $type->getLabel(),
                'has_column'       => $type->hasColumn(),
                'supports_unique'  => $type->supportsUnique(),
                'config_schema'    => $type->getConfigSchema(),
            ];
        }
        return $out;
    }

    private function registerDefaults(): void
    {
        $defaults = [
            new TextField(),
            new LongTextField(),
            new NumberField(),
            new CurrencyField(),
            new SelectField(),
            new MultiSelectField(),
            new DateField(),
            new DateTimeField(),
            new CheckboxField(),
            new UrlField(),
            new EmailField(),
            new UserField(),
            new RelationField(),
            new FileField(),
            new ComputedField(),
        ];

        foreach ($defaults as $type) {
            $this->register($type);
        }
    }
}
