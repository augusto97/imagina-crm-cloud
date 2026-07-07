import * as React from 'react';

import { cn } from '@/lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className, ...props }, ref) => {
        return (
            <textarea
                ref={ref}
                className={cn(
                    'imcrm-flex imcrm-min-h-[80px] imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-shadow-sm',
                    'placeholder:imcrm-text-muted-foreground',
                    'focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring focus-visible:imcrm-ring-offset-2',
                    'disabled:imcrm-cursor-not-allowed disabled:imcrm-opacity-50',
                    className,
                )}
                {...props}
            />
        );
    },
);
Textarea.displayName = 'Textarea';
