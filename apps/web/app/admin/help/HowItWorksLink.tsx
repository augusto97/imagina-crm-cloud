import { CircleHelp } from 'lucide-react';

import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { help, useHelpAvailability } from './helpBus';

/**
 * «¿Cómo funciona?» junto al título de una pantalla compleja: abre la guía
 * que la explica en el panel de Ayuda. Si el centro de ayuda no está montado,
 * no se dibuja (nunca queda un enlace muerto).
 */
export function HowItWorksLink({
    guideId,
    label,
    className,
}: {
    guideId: string;
    label?: string;
    className?: string;
}): JSX.Element | null {
    const { help: available } = useHelpAvailability();
    if (!available) return null;
    return (
        <button
            type="button"
            onClick={() => help.openHelp({ guideId })}
            data-testid={`how-it-works-${guideId}`}
            className={cn(
                'imcrm-inline-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1.5 imcrm-py-0.5 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-bg-accent hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring',
                className,
            )}
        >
            <CircleHelp className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
            {label ?? __('¿Cómo funciona?')}
        </button>
    );
}
