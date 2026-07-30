import type { ReactNode } from 'react';
import { AlignLeft, ChevronRight, CornerDownRight } from 'lucide-react';

import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { RecordEntity } from '@/types/record';

interface RecordNameCellProps {
    record: RecordEntity;
    /** 0 = registro de primer nivel, 1 = subtarea. */
    depth: number;
    expanded: boolean;
    onToggle: () => void;
    /** La celda editable del campo (el "nombre" del registro). */
    children: ReactNode;
}

/**
 * Primera columna de la tabla: el nombre del registro con su chevron de
 * subtareas y las señales de la fila (v0.1.137).
 *
 * Vivía suelta dentro de `TableView`, y por eso la vista AGRUPADA nunca
 * tuvo subtareas: el usuario reportó que sólo aparecían en la vista
 * "Todos". Extraerla es lo que garantiza que las dos tablas muestren lo
 * mismo — y que la próxima señal que se agregue acá salga en ambas.
 */
export function RecordNameCell({
    record,
    depth,
    expanded,
    onToggle,
    children,
}: RecordNameCellProps): JSX.Element {
    const n = record.subtask_count;
    return (
        <span
            className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1"
            style={depth > 0 ? { paddingLeft: depth * 20 } : undefined}
        >
            {/* El hueco del chevron se reserva SIEMPRE (v0.1.139): antes sólo
                existía en las filas con subtareas y eso corría el texto de esa
                fila respecto de las vecinas — el usuario lo marcó como que
                "descuadra la vista". En ClickUp la columna arranca en la misma
                x para todas las filas; la subtarea se distingue por la
                sangría, no por un icono extra. */}
            {n > 0 ? (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggle();
                    }}
                    aria-expanded={expanded}
                    aria-label={sprintf(
                        /* translators: %d: subtask count */
                        __('%d subtareas'),
                        n,
                    )}
                    className="imcrm-flex imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                >
                    <ChevronRight
                        aria-hidden
                        className={cn(
                            'imcrm-h-3.5 imcrm-w-3.5 imcrm-transition-transform',
                            expanded && 'imcrm-rotate-90',
                        )}
                    />
                </button>
            ) : depth > 0 ? (
                // El codo de sangría se mantiene (v0.1.141): lo que descuadraba
                // la vista era el hueco del chevron, no esto.
                <CornerDownRight
                    aria-label={__('Subtarea')}
                    className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground/50"
                />
            ) : (
                <span aria-hidden className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
            )}
            <span className="imcrm-min-w-0 imcrm-flex-1">{children}</span>
            {/* Señal de que el registro tiene descripción (v0.1.133): el
                contenido no viaja en el listado, sólo este booleano. */}
            {record.has_description && (
                <AlignLeft
                    aria-label={__('Tiene descripción')}
                    className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground/70"
                />
            )}
        </span>
    );
}
