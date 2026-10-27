import { Link, useNavigate } from 'react-router';
import { ArrowRight, ExternalLink, PlayCircle } from 'lucide-react';
import { isHttpsUrl, isSafeAppRoute, type WhatsNewAction } from '@imagina-base/shared';

import { help, useHasTour } from '@/admin/help/helpBus';
import { Button, type ButtonProps } from '@/components/ui/button';
import { __ } from '@/lib/i18n';

/**
 * El botón de una novedad («Pruébalo»). Si nombra un recorrido y la pieza de
 * guías lo tiene para esta persona, lo arranca; si no, lleva a su pantalla
 * (o abre el enlace en otra pestaña). Sin destino posible, no se dibuja: un
 * botón muerto es peor que ninguno.
 */
export function WhatsNewActionButton({
    action,
    onActivate,
    variant = 'outline',
    size = 'sm',
    className,
}: {
    action: WhatsNewAction | null;
    /** Antes de ir: registrar el clic y cerrar el panel o el diálogo. */
    onActivate?: () => void;
    variant?: ButtonProps['variant'];
    size?: ButtonProps['size'];
    className?: string;
}): JSX.Element | null {
    const navigate = useNavigate();
    const hasTour = useHasTour(action?.tour ?? null);
    if (!action) return null;
    const href = action.href ?? null;
    const internal = href !== null && isSafeAppRoute(href) ? href : null;
    const external = href !== null && isHttpsUrl(href) ? href : null;

    if (action.tour && hasTour) {
        const tour = action.tour;
        return (
            <Button
                type="button"
                variant={variant}
                size={size}
                className={className}
                data-whats-new-action="tour"
                onClick={() => {
                    onActivate?.();
                    // Después de cerrar el panel (si no, el recorrido queda debajo).
                    window.setTimeout(() => {
                        if (!help.startTour(tour) && internal) navigate(internal);
                    }, 60);
                }}
            >
                <PlayCircle className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                {action.label}
            </Button>
        );
    }
    if (internal) {
        return (
            <Button asChild variant={variant} size={size} className={className}>
                <Link to={internal} onClick={() => onActivate?.()} data-whats-new-action="route">
                    {action.label}
                    <ArrowRight className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                </Link>
            </Button>
        );
    }
    if (external) {
        return (
            <Button asChild variant={variant} size={size} className={className}>
                <a href={external} target="_blank" rel="noopener noreferrer" onClick={() => onActivate?.()} data-whats-new-action="url">
                    {action.label}
                    <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    <span className="imcrm-sr-only">{__('(se abre en otra pestaña)')}</span>
                </a>
            </Button>
        );
    }
    return null;
}
