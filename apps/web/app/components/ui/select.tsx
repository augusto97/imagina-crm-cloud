import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Select nativo estilizado. Para casos avanzados (búsqueda, virtualización)
 * crearemos un Combobox sobre Radix Popover, pero esto cubre el FieldType
 * picker y filtros simples.
 */
export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
    ({ className, children, ...props }, ref) => (
        <select
            ref={ref}
            className={cn(
                'imcrm-flex imcrm-h-9 imcrm-w-full imcrm-rounded-lg imcrm-border imcrm-border-input imcrm-bg-card imcrm-px-3 imcrm-text-sm imcrm-text-foreground',
                'imcrm-shadow-imcrm-inset',
                'imcrm-transition-[border-color,box-shadow] imcrm-duration-150',
                'focus-visible:imcrm-outline-none focus-visible:imcrm-border-primary focus-visible:imcrm-ring-4 focus-visible:imcrm-ring-primary/15',
                'hover:imcrm-border-input/80',
                'disabled:imcrm-cursor-not-allowed disabled:imcrm-bg-muted disabled:imcrm-opacity-60',
                className,
            )}
            {...props}
        >
            {children}
        </select>
    ),
);
Select.displayName = 'Select';
