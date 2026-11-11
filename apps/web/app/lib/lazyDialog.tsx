import { Suspense, useState, type ComponentType } from 'react';

import { lazyWithReload } from '@/lib/lazyWithReload';

/**
 * Un diálogo (o panel) con prop `open` cuyo código se baja la PRIMERA vez que
 * se abre, no con la pantalla que lo contiene. Hasta entonces no dibuja nada;
 * después queda montado (cerrar conserva su animación y su estado, igual que
 * antes). Mismo `lazyWithReload` de las rutas: un chunk viejo recarga la app.
 *
 * Para lo que se abre de vez en cuando (crear un campo, guardar una vista, el
 * asistente): NO para las vistas de la lista, que van con la página.
 */
// `any` a propósito, como en `lazyWithReload`: el tipo de las props sale del
// componente que devuelve la fábrica.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyDialog<C extends (props: any) => JSX.Element | null>(
    factory: () => Promise<{ default: C }>,
): ComponentType<Parameters<C>[0] & { open: boolean }> & { preload: () => void } {
    type P = Parameters<C>[0] & { open: boolean };
    const Lazy = lazyWithReload(factory);
    const Inner = Lazy as unknown as ComponentType<P>;
    function LazyDialog(props: P): JSX.Element | null {
        const [mounted, setMounted] = useState(props.open);
        if (props.open && !mounted) setMounted(true);
        if (!mounted && !props.open) return null;
        return (
            <Suspense fallback={null}>
                <Inner {...props} />
            </Suspense>
        );
    }
    LazyDialog.preload = (): void => {
        void Lazy.preload().catch(() => undefined);
    };
    return LazyDialog;
}
