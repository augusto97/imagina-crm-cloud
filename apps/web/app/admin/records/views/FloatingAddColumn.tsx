import { useEffect, useState, type RefObject } from 'react';
import { Plus } from 'lucide-react';

import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * v0.1.261 — el "+" de agregar columna FLOTA sobre el borde derecho de la
 * cabecera, con un degradado que funde lo que pasa por debajo (como ClickUp).
 * Antes era una columna más de 48px, con su celda de fondo en cada fila: un
 * carril casi vacío que le comía ancho a la tabla. Va dentro de la cabecera
 * sticky (posicionada), así queda fijo al scrollear en los dos ejes.
 */
export function FloatingAddColumn({ onClick }: { onClick: () => void }): JSX.Element {
    return (
        <div
            data-testid="floating-add-column"
            className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-y-0 imcrm-right-0 imcrm-z-30 imcrm-flex imcrm-items-center imcrm-bg-gradient-to-l imcrm-from-background imcrm-from-40% imcrm-to-transparent imcrm-pl-8 imcrm-pr-1.5"
        >
            <button
                type="button"
                onClick={onClick}
                title={__('Agregar columna')}
                aria-label={__('Agregar columna')}
                className="imcrm-pointer-events-auto imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary imcrm-text-primary-foreground imcrm-shadow-imcrm-sm imcrm-transition-transform hover:imcrm-scale-110"
            >
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" strokeWidth={3} />
            </button>
        </div>
    );
}

/** ¿Quedan columnas por ver a la derecha? (scroll horizontal no al final) */
export function useOverflowsRight(ref: RefObject<HTMLElement>, deps: unknown[] = []): boolean {
    const [overflows, setOverflows] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const update = (): void => {
            const next = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
            setOverflows((prev) => (prev === next ? prev : next));
        };
        update();
        el.addEventListener('scroll', update, { passive: true });
        const ro = new ResizeObserver(update);
        ro.observe(el);
        if (el.firstElementChild) ro.observe(el.firstElementChild);
        return () => {
            el.removeEventListener('scroll', update);
            ro.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ref, ...deps]);
    return overflows;
}

/** Desvanecido del borde derecho cuando hay más columnas por scrollear. */
export function RightEdgeFade({ show }: { show: boolean }): JSX.Element | null {
    return (
        <div
            aria-hidden
            data-testid="table-right-fade"
            className={cn(
                'imcrm-pointer-events-none imcrm-absolute imcrm-inset-y-0 imcrm-right-0 imcrm-z-[15] imcrm-w-10 imcrm-bg-gradient-to-l imcrm-from-background imcrm-to-transparent imcrm-transition-opacity',
                show ? 'imcrm-opacity-100' : 'imcrm-opacity-0',
            )}
        />
    );
}
