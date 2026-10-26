import type { ReactNode } from 'react';
import { AlignLeft, ChevronRight, ClipboardCheck, CornerDownRight, ListTodo, Lock } from 'lucide-react';

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
 * mismo — y que la próxima señal que se agregue aquí salga en ambas.
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
            {/* A8 — bloqueado por registros abiertos (el dato viaja en el
                listado: ningún pedido por fila). */}
            {(record.blocked_by_open ?? 0) > 0 && (
                <span
                    role="img"
                    title={blockedTitle(record.blocked_by_open ?? 0)}
                    aria-label={blockedTitle(record.blocked_by_open ?? 0)}
                    className="imcrm-inline-flex imcrm-shrink-0 imcrm-text-amber-600 dark:imcrm-text-amber-400"
                    data-testid="imcrm-row-blocked"
                >
                    <Lock aria-hidden className="imcrm-h-3.5 imcrm-w-3.5" />
                </span>
            )}
            {/* C5 — aprobación pendiente (viaja en el listado). */}
            {(record.approval_pending ?? 0) > 0 && (
                <span
                    role="img"
                    title={__('Aprobación pendiente')}
                    aria-label={__('Aprobación pendiente')}
                    className="imcrm-inline-flex imcrm-shrink-0 imcrm-text-amber-600 dark:imcrm-text-amber-400"
                    data-testid="imcrm-row-approval-pending"
                >
                    <ClipboardCheck aria-hidden className="imcrm-h-3.5 imcrm-w-3.5" />
                </span>
            )}
            {/* A9 — progreso de los checklists («3/8»; viaja en el listado,
                una consulta por página). Completo = verde. */}
            {record.checklist && record.checklist.total > 0 && (
                <span
                    title={checklistTitle(record.checklist.done, record.checklist.total)}
                    aria-label={checklistTitle(record.checklist.done, record.checklist.total)}
                    className={cn(
                        'imcrm-inline-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-0.5 imcrm-rounded imcrm-px-1 imcrm-text-[11px] imcrm-font-medium imcrm-tabular-nums',
                        record.checklist.done === record.checklist.total
                            ? 'imcrm-bg-emerald-500/15 imcrm-text-emerald-700 dark:imcrm-text-emerald-400'
                            : 'imcrm-text-muted-foreground',
                    )}
                    data-testid="imcrm-row-checklist"
                >
                    <ListTodo aria-hidden className="imcrm-h-3.5 imcrm-w-3.5" />
                    {record.checklist.done}/{record.checklist.total}
                </span>
            )}
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

/** «Bloqueado por 1 registro abierto» / «… por 3 registros abiertos». */
export function blockedTitle(n: number): string {
    return n === 1
        ? __('Bloqueado por 1 registro abierto')
        : sprintf(/* translators: %d: open blockers */ __('Bloqueado por %d registros abiertos'), n);
}

/** «Checklist: 3 de 8 hechos». */
export function checklistTitle(done: number, total: number): string {
    return sprintf(/* translators: %1$d hechos, %2$d total */ __('Checklist: %1$d de %2$d hechos'), done, total);
}
