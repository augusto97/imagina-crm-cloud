<?php
declare(strict_types=1);

namespace ImaginaCRM;

use Closure;
use ImaginaCRM\Support\ContainerException;

/**
 * Contenedor DI mínimo.
 *
 * Soporta singletons, factories y resolución por reflection. La idea es
 * mantenerlo pequeño: el plugin no necesita un PSR-11 completo, sólo
 * inyección por constructor con resolución determinista.
 */
final class Container
{
    /** @var array<class-string|string, Closure(self):mixed> */
    private array $factories = [];

    /** @var array<class-string|string, mixed> */
    private array $instances = [];

    /** @var array<class-string|string, true> */
    private array $singletons = [];

    /** @var array<class-string|string, true> */
    private array $resolving = [];

    /**
     * @template T of object
     * @param class-string<T>|string $id
     * @param Closure(self):T        $factory
     */
    public function bind(string $id, Closure $factory, bool $singleton = true): void
    {
        $this->factories[$id] = $factory;
        if ($singleton) {
            $this->singletons[$id] = true;
        }
        unset($this->instances[$id]);
    }

    /**
     * @template T of object
     * @param class-string<T>|string $id
     * @param T                      $instance
     */
    public function instance(string $id, object $instance): void
    {
        $this->instances[$id]  = $instance;
        $this->singletons[$id] = true;
    }

    public function get(string $id): mixed
    {
        if (isset($this->instances[$id])) {
            return $this->instances[$id];
        }

        if (isset($this->resolving[$id])) {
            throw new ContainerException(sprintf('Circular dependency detected while resolving "%s".', $id));
        }

        $this->resolving[$id] = true;

        try {
            $value = isset($this->factories[$id])
                ? ($this->factories[$id])($this)
                : $this->autowire($id);

            if (isset($this->singletons[$id])) {
                $this->instances[$id] = $value;
            }

            return $value;
        } finally {
            unset($this->resolving[$id]);
        }
    }

    public function has(string $id): bool
    {
        return isset($this->instances[$id]) || isset($this->factories[$id]);
    }

    /**
     * @param class-string|string $id
     */
    private function autowire(string $id): object
    {
        if (! class_exists($id)) {
            throw new ContainerException(sprintf('Cannot resolve "%s": class does not exist.', $id));
        }

        $reflection = new \ReflectionClass($id);

        if (! $reflection->isInstantiable()) {
            throw new ContainerException(sprintf('Cannot instantiate "%s".', $id));
        }

        $constructor = $reflection->getConstructor();

        if ($constructor === null) {
            return $reflection->newInstance();
        }

        $args = [];

        foreach ($constructor->getParameters() as $parameter) {
            $args[] = $this->resolveParameter($parameter, $id);
        }

        return $reflection->newInstanceArgs($args);
    }

    private function resolveParameter(\ReflectionParameter $parameter, string $owner): mixed
    {
        $type = $parameter->getType();

        if ($type instanceof \ReflectionNamedType && ! $type->isBuiltin()) {
            return $this->get($type->getName());
        }

        if ($parameter->isDefaultValueAvailable()) {
            return $parameter->getDefaultValue();
        }

        throw new ContainerException(
            sprintf(
                'Cannot resolve parameter "$%s" of "%s::__construct" — not bound and no default available.',
                $parameter->getName(),
                $owner
            )
        );
    }
}
