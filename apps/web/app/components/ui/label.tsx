import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';

import { cn } from '@/lib/utils';

export const Label = React.forwardRef<
    React.ElementRef<typeof LabelPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
    <LabelPrimitive.Root
        ref={ref}
        className={cn(
            'imcrm-text-sm imcrm-font-medium imcrm-leading-none',
            'peer-disabled:imcrm-cursor-not-allowed peer-disabled:imcrm-opacity-70',
            className,
        )}
        {...props}
    />
));
Label.displayName = LabelPrimitive.Root.displayName;
