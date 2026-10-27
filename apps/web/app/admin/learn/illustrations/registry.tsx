import { lazy, Suspense, useMemo, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Registro de ilustraciones: cada archivo de `items/` es una (el nombre del
 * archivo es su clave: `items/kanban-drag.tsx` → `kanban-drag`) y se baja sólo
 * cuando se muestra. Sumar una ilustración = sumar el archivo; no hay lista
 * que mantener a mano (varias personas pueden agregar a la vez sin pisarse).
 */
type IllustrationModule = { default: ComponentType };

const files = import.meta.glob<IllustrationModule>('./items/*.tsx');

function keyOf(path: string): string {
    return path.replace(/^\.\/items\//, '').replace(/\.tsx$/, '');
}

const loaders = new Map<string, () => Promise<IllustrationModule>>(
    Object.entries(files).map(([path, load]) => [keyOf(path), load]),
);

export const ILLUSTRATION_KEYS: readonly string[] = [...loaders.keys()].sort();

export function hasIllustration(key: string): boolean {
    return loaders.has(key);
}

const cache = new Map<string, LazyExoticComponent<ComponentType>>();

function lazyFor(key: string): LazyExoticComponent<ComponentType> | null {
    const load = loaders.get(key);
    if (!load) return null;
    let c = cache.get(key);
    if (!c) {
        c = lazy(load);
        cache.set(key, c);
    }
    return c;
}

/** Placeholder del mismo tamaño mientras llega el código de la escena. */
function StageSkeleton(): JSX.Element {
    return <div className="imcrm-w-full imcrm-animate-pulse imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-muted/40" style={{ aspectRatio: '480 / 300' }} />;
}

export function Illustration({ name }: { name: string }): JSX.Element | null {
    const Comp = useMemo(() => lazyFor(name), [name]);
    if (!Comp) return null;
    return (
        <Suspense fallback={<StageSkeleton />}>
            <Comp />
        </Suspense>
    );
}
