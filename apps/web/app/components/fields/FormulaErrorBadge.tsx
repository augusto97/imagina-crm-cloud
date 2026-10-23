import { AlertTriangle } from 'lucide-react';

import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Fórmulas (A1) — «#ERROR» de una fórmula que no se pudo calcular en esta
 * fila. En la tabla ocupa poco y el motivo va en el tooltip; en la ficha
 * (`detailed`) el motivo se lee al lado, porque ahí hay lugar y en el celular
 * no hay tooltip.
 */
export function FormulaErrorBadge({ message, detailed = false }: { message: string; detailed?: boolean }): JSX.Element {
    return (
        <span
            className={cn(
                'imcrm-inline-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1 imcrm-text-destructive',
                detailed ? 'imcrm-items-start imcrm-text-sm' : 'imcrm-text-[12px]',
            )}
            title={sprintf(__('No se pudo calcular: %s'), message)}
            aria-label={sprintf(__('Error en la fórmula: %s'), message)}
            data-formula-error=""
        >
            <AlertTriangle className={cn('imcrm-shrink-0', detailed ? 'imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5' : 'imcrm-h-3 imcrm-w-3')} aria-hidden />
            <span className="imcrm-font-mono imcrm-font-semibold">#ERROR</span>
            {detailed && <span className="imcrm-min-w-0 imcrm-text-xs imcrm-font-normal imcrm-text-muted-foreground">{message}</span>}
        </span>
    );
}
