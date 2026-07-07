import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Sheet (Drawer lateral) sobre Radix Dialog.
 *
 * Usado para el RecordDetailDrawer, futuros panels de comentarios/actividad,
 * y cualquier flujo que requiera un panel deslizable desde la derecha.
 */
export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof Dialog.Content> {
    side?: 'right' | 'left';
}

export const SheetContent = React.forwardRef<
    React.ElementRef<typeof Dialog.Content>,
    SheetContentProps
>(({ className, children, side = 'right', ...props }, ref) => (
    <Dialog.Portal>
        <Dialog.Overlay
            className={cn(
                'imcrm-fixed imcrm-inset-0 imcrm-z-40 imcrm-bg-black/40 imcrm-backdrop-blur-sm',
                'imcrm-animate-imcrm-fade-in',
            )}
        />
        <Dialog.Content
            ref={ref}
            className={cn(
                'imcrm-fixed imcrm-z-50 imcrm-flex imcrm-flex-col imcrm-bg-card imcrm-text-card-foreground imcrm-shadow-imcrm-lg',
                'imcrm-top-0 imcrm-bottom-0 imcrm-w-full sm:imcrm-w-[480px]',
                side === 'right' && 'imcrm-right-0 imcrm-border-l imcrm-border-border imcrm-animate-imcrm-slide-in-right',
                side === 'left' && 'imcrm-left-0 imcrm-border-r imcrm-border-border',
                className,
            )}
            {...props}
        >
            {children}
        </Dialog.Content>
    </Dialog.Portal>
));
SheetContent.displayName = 'SheetContent';

export const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element => (
    <div
        className={cn(
            'imcrm-flex imcrm-shrink-0 imcrm-items-start imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-py-4',
            className,
        )}
        {...props}
    />
);

export const SheetTitle = React.forwardRef<
    React.ElementRef<typeof Dialog.Title>,
    React.ComponentPropsWithoutRef<typeof Dialog.Title>
>(({ className, ...props }, ref) => (
    <Dialog.Title
        ref={ref}
        className={cn('imcrm-text-base imcrm-font-semibold imcrm-tracking-tight', className)}
        {...props}
    />
));
SheetTitle.displayName = 'SheetTitle';

export const SheetDescription = React.forwardRef<
    React.ElementRef<typeof Dialog.Description>,
    React.ComponentPropsWithoutRef<typeof Dialog.Description>
>(({ className, ...props }, ref) => (
    <Dialog.Description
        ref={ref}
        className={cn('imcrm-text-sm imcrm-text-muted-foreground', className)}
        {...props}
    />
));
SheetDescription.displayName = 'SheetDescription';

export const SheetBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element => (
    <div className={cn('imcrm-flex-1 imcrm-overflow-y-auto imcrm-px-5 imcrm-py-4', className)} {...props} />
);

export const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element => (
    <div
        className={cn(
            'imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-5 imcrm-py-3',
            className,
        )}
        {...props}
    />
);

interface SheetCloseButtonProps {
    'aria-label'?: string;
}

export function SheetCloseButton({ 'aria-label': ariaLabel = 'Cerrar' }: SheetCloseButtonProps): JSX.Element {
    return (
        <Dialog.Close
            className="imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
            aria-label={ariaLabel}
        >
            <X className="imcrm-h-4 imcrm-w-4" />
        </Dialog.Close>
    );
}
