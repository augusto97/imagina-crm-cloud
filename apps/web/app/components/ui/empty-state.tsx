import { type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Empty state estandarizado: ícono en un círculo con gradient sutil,
 * título, descripción opcional, y CTA opcional. Reemplaza los "p
 * gris diciendo 'Vacío'" que estaban dispersos por la app.
 *
 * Diseño inspirado en Linear / Notion: circle icon (no ilustraciones
 * complejas), tipografía moderada, mucho whitespace, CTA primario
 * llamativo cuando hay acción.
 */
interface EmptyStateProps {
    icon: LucideIcon;
    title: string;
    description?: string;
    action?: React.ReactNode;
    /** `card` viene con borde y bg sutiles; `bare` sin chrome para usar dentro de otros containers. */
    variant?: 'card' | 'bare';
    className?: string;
}

export function EmptyState({
    icon: Icon,
    title,
    description,
    action,
    variant = 'card',
    className,
}: EmptyStateProps): JSX.Element {
    return (
        <div
            className={cn(
                'imcrm-flex imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-3 imcrm-px-6 imcrm-py-12 imcrm-text-center',
                variant === 'card' &&
                    'imcrm-rounded-xl imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-gradient-to-b imcrm-from-muted/20 imcrm-to-transparent',
                className,
            )}
        >
            <div className="imcrm-relative imcrm-flex imcrm-h-14 imcrm-w-14 imcrm-items-center imcrm-justify-center imcrm-rounded-2xl imcrm-bg-gradient-to-br imcrm-from-primary/10 imcrm-to-primary/5 imcrm-shadow-imcrm-sm">
                <Icon className="imcrm-h-6 imcrm-w-6 imcrm-text-primary" aria-hidden />
                <span
                    aria-hidden
                    className="imcrm-absolute imcrm--inset-1 imcrm-rounded-3xl imcrm-bg-primary/5 imcrm-blur-md"
                />
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <h3 className="imcrm-text-sm imcrm-font-semibold imcrm-text-foreground">{title}</h3>
                {description !== undefined && (
                    <p className="imcrm-max-w-sm imcrm-text-xs imcrm-text-muted-foreground imcrm-leading-relaxed">
                        {description}
                    </p>
                )}
            </div>

            {action !== undefined && <div className="imcrm-mt-1">{action}</div>}
        </div>
    );
}
