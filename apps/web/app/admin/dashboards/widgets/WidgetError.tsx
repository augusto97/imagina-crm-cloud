import { TriangleAlert } from 'lucide-react';

import { __ } from '@/lib/i18n';

/**
 * Estado de error de un widget (v0.1.229). Muestra el MOTIVO a la vista (antes
 * sólo "Error", con el mensaje escondido en un tooltip): así quien configura el
 * tablero sabe qué corregir en ESE widget.
 */
export function WidgetError({ error, compact = false }: { error: unknown; compact?: boolean }): JSX.Element {
    const message = error instanceof Error && error.message !== '' ? error.message : null;
    return (
        <div
            role="alert"
            className="imcrm-flex imcrm-max-w-full imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-1 imcrm-px-2 imcrm-text-center imcrm-text-destructive"
            title={message ?? undefined}
        >
            <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                <TriangleAlert className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                {__('No se pudo calcular')}
            </span>
            {message && !compact && (
                <span className="imcrm-line-clamp-3 imcrm-text-xs imcrm-text-muted-foreground">{message}</span>
            )}
        </div>
    );
}
