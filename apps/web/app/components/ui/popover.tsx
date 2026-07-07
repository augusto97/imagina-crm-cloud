import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

import { cn } from '@/lib/utils';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = React.forwardRef<
    React.ElementRef<typeof PopoverPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 6, collisionPadding = 16, ...props }, ref) => (
    <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
            ref={ref}
            align={align}
            sideOffset={sideOffset}
            collisionPadding={collisionPadding}
            className={cn(
                'imcrm-z-50 imcrm-w-72 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-popover imcrm-p-3 imcrm-text-popover-foreground imcrm-shadow-imcrm-md',
                'imcrm-animate-imcrm-fade-in',
                // Constraints anti-overflow — el contenido nunca se mete
                // bajo la sidebar ni sale por debajo del viewport. Radix
                // ya tiene `--radix-popover-content-available-{width,height}`
                // calculado contra collisionPadding; los usamos como max
                // y un `overflow-y-auto` para que el contenido scrollée
                // si crece más que el espacio disponible (ej. panel de
                // filtros con muchas condiciones anidadas).
                'imcrm-max-w-[var(--radix-popover-content-available-width)]',
                'imcrm-max-h-[var(--radix-popover-content-available-height)]',
                'imcrm-overflow-y-auto',
                className,
            )}
            {...props}
        />
    </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;
