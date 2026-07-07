import * as React from 'react';

import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type, ...props }, ref) => {
        return (
            <input
                ref={ref}
                type={type ?? 'text'}
                className={cn(
                    'imcrm-flex imcrm-h-9 imcrm-w-full imcrm-rounded-lg imcrm-border imcrm-border-input imcrm-bg-card imcrm-px-3 imcrm-text-sm imcrm-text-foreground',
                    'imcrm-shadow-imcrm-inset',
                    'imcrm-transition-[border-color,box-shadow] imcrm-duration-150',
                    'file:imcrm-border-0 file:imcrm-bg-transparent file:imcrm-text-sm file:imcrm-font-medium',
                    'placeholder:imcrm-text-muted-foreground/70',
                    // Focus: border primary + ring suave (no offset, más cerca del input)
                    'focus-visible:imcrm-outline-none focus-visible:imcrm-border-primary focus-visible:imcrm-ring-4 focus-visible:imcrm-ring-primary/15',
                    // Hover suave cuando no está enfocado
                    'hover:imcrm-border-input/80',
                    'disabled:imcrm-cursor-not-allowed disabled:imcrm-bg-muted disabled:imcrm-opacity-60',
                    className,
                )}
                {...props}
            />
        );
    },
);
Input.displayName = 'Input';
