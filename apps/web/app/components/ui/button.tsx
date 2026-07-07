import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
    [
        // Base: layout + tipografía + transición
        'imcrm-inline-flex imcrm-items-center imcrm-justify-center imcrm-gap-2',
        'imcrm-whitespace-nowrap imcrm-font-medium imcrm-tracking-tight imcrm-select-none',
        'imcrm-transition-colors imcrm-duration-150',
        // Focus ring: ring DENTRO del button (offset negativo) — flush
        // con el borde, sin gap visible. El halo con offset positivo
        // se confundía con un "estado seleccionado pegado".
        'focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40',
        // Disabled
        'disabled:imcrm-pointer-events-none disabled:imcrm-opacity-50',
    ].join(' '),
    {
        variants: {
            variant: {
                /* Primary: solid color, sin shadow innecesaria. Hover
                 * oscurece levemente. Diseño moderno-flat estilo
                 * Vercel/Linear admin — el color hace el trabajo, no
                 * necesita "depth" via shadows. */
                default: [
                    'imcrm-bg-primary imcrm-text-primary-foreground',
                    'hover:imcrm-bg-primary/90',
                ].join(' '),

                /* Outline: el botón "default" estilo Vercel — white +
                 * hairline border. Sin shadow exterior. Hover apenas
                 * tinta el bg, el border se oscurece. */
                outline: [
                    'imcrm-bg-card imcrm-text-foreground imcrm-border imcrm-border-border',
                    'hover:imcrm-bg-canvas hover:imcrm-border-input',
                ].join(' '),

                /* Secondary: gris suave para acciones paralelas. Sin
                 * border, hover ligero darken. */
                secondary: [
                    'imcrm-bg-secondary imcrm-text-secondary-foreground',
                    'hover:imcrm-bg-muted',
                ].join(' '),

                /* Destructive: solid red, sin shadow. */
                destructive: [
                    'imcrm-bg-destructive imcrm-text-destructive-foreground',
                    'hover:imcrm-bg-destructive/90',
                ].join(' '),

                /* Ghost: sin chrome, sólo hover sutil con tint del
                 * foreground. No genera "pastilla" pegajosa porque
                 * la opacidad es muy baja (4%). */
                ghost: [
                    'imcrm-text-foreground/80',
                    'hover:imcrm-bg-foreground/[0.04] hover:imcrm-text-foreground',
                ].join(' '),

                /* Link: solo color primary + underline on hover. */
                link: [
                    'imcrm-text-primary imcrm-underline-offset-4',
                    'hover:imcrm-underline',
                ].join(' '),
            },
            size: {
                /* Densidad estándar moderna: h-9 con padding horizontal
                 * generoso (px-4) para que los buttons respiren. Antes
                 * usaba px-3.5 que sentía cramped. */
                default: 'imcrm-h-9 imcrm-rounded-lg imcrm-px-4 imcrm-text-sm',
                sm: 'imcrm-h-8 imcrm-rounded-md imcrm-px-3 imcrm-text-[13px]',
                lg: 'imcrm-h-10 imcrm-rounded-lg imcrm-px-5 imcrm-text-sm',
                icon: 'imcrm-h-9 imcrm-w-9 imcrm-rounded-lg',
            },
        },
        defaultVariants: {
            variant: 'default',
            size: 'default',
        },
    },
);

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : 'button';
        return (
            <Comp
                ref={ref}
                className={cn(buttonVariants({ variant, size, className }))}
                {...props}
            />
        );
    },
);
Button.displayName = 'Button';

export { buttonVariants };
