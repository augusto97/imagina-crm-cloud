import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Badge / status pill — versión "refined" estilo Linear/Vercel:
 * fondo MUY suave del color (no saturado), texto del color
 * fuerte, dot opcional, border hairline tonal. Mucho más elegante
 * que los badges sólidos saturados.
 *
 * Para los casos donde NECESITAS el solid (ej. label de un menu),
 * usá `solid` o `default`.
 */
const badgeVariants = cva(
    'imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-px-2 imcrm-py-0.5 imcrm-text-xs imcrm-font-medium imcrm-tracking-tight imcrm-leading-tight imcrm-whitespace-nowrap',
    {
        variants: {
            variant: {
                default:
                    'imcrm-border imcrm-border-primary/20 imcrm-bg-primary/10 imcrm-text-primary',
                secondary:
                    'imcrm-border imcrm-border-border imcrm-bg-muted imcrm-text-foreground',
                outline:
                    'imcrm-border imcrm-border-border imcrm-text-foreground/80',
                success:
                    'imcrm-border imcrm-border-success/25 imcrm-bg-success/10 imcrm-text-success',
                warning:
                    'imcrm-border imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-text-warning',
                destructive:
                    'imcrm-border imcrm-border-destructive/25 imcrm-bg-destructive/10 imcrm-text-destructive',
                info:
                    'imcrm-border imcrm-border-info/25 imcrm-bg-info/10 imcrm-text-info',
                /* Variante sólida — para cuando un fill llamativo es deseado. */
                solid:
                    'imcrm-bg-primary imcrm-text-primary-foreground imcrm-shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]',
            },
        },
        defaultVariants: { variant: 'default' },
    },
);

export interface BadgeProps
    extends React.HTMLAttributes<HTMLSpanElement>,
        VariantProps<typeof badgeVariants> {
    /** Si `true`, antepone un dot del mismo color (Linear/GitHub style). */
    dot?: boolean;
}

export function Badge({ className, variant, dot, children, ...props }: BadgeProps): JSX.Element {
    return (
        <span className={cn(badgeVariants({ variant }), className)} {...props}>
            {dot && (
                <span
                    aria-hidden
                    className="imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full imcrm-bg-current imcrm-opacity-80"
                />
            )}
            {children}
        </span>
    );
}
