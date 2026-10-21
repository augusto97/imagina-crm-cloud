import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

/**
 * Flechas de orden de una cabecera de columna (vista plana y agrupada). El
 * estado ya viaja al lector de pantalla por `aria-sort`/la etiqueta del
 * botón: los iconos son decorativos.
 */
export function SortIndicator({
    dir,
    index,
    multiCount,
}: {
    dir: 'asc' | 'desc' | null;
    index: number;
    multiCount: number;
}): JSX.Element | null {
    // El estado de sort ya está expuesto al SR vía aria-sort en el <th>;
    // los iconos solo son decorativos.
    if (dir === null) {
        return <ArrowUpDown className="imcrm-h-3 imcrm-w-3 imcrm-opacity-30" aria-hidden="true" />;
    }
    return (
        <span className="imcrm-flex imcrm-items-center imcrm-gap-0.5" aria-hidden="true">
            {dir === 'asc' ? (
                <ArrowUp className="imcrm-h-3 imcrm-w-3 imcrm-text-primary" />
            ) : (
                <ArrowDown className="imcrm-h-3 imcrm-w-3 imcrm-text-primary" />
            )}
            {multiCount > 1 && (
                <span className="imcrm-font-mono imcrm-text-[9px] imcrm-text-primary">{index + 1}</span>
            )}
        </span>
    );
}
