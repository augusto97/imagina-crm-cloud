import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export const DropdownMenuContent = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, align = 'end', collisionPadding = 16, ...props }, ref) => (
    <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
            ref={ref}
            sideOffset={sideOffset}
            align={align}
            collisionPadding={collisionPadding}
            className={cn(
                'imcrm-z-50 imcrm-min-w-[10rem] imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-popover imcrm-p-1 imcrm-text-popover-foreground imcrm-shadow-imcrm-md',
                'imcrm-animate-imcrm-fade-in',
                // Anti-overflow: limit a viewport disponible (Radix
                // calcula `--radix-dropdown-menu-content-available-*`
                // contra collisionPadding) y scroll interno cuando el
                // menú es más alto que ese espacio.
                'imcrm-max-w-[var(--radix-dropdown-menu-content-available-width)]',
                'imcrm-max-h-[var(--radix-dropdown-menu-content-available-height)]',
                'imcrm-overflow-y-auto',
                className,
            )}
            {...props}
        />
    </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

interface DropdownMenuItemProps
    extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
    danger?: boolean;
}

export const DropdownMenuItem = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitive.Item>,
    DropdownMenuItemProps
>(({ className, danger, ...props }, ref) => (
    <DropdownMenuPrimitive.Item
        ref={ref}
        className={cn(
            'imcrm-relative imcrm-flex imcrm-cursor-pointer imcrm-select-none imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-2 imcrm-py-1.5 imcrm-text-sm imcrm-outline-none imcrm-transition-colors',
            'focus:imcrm-bg-accent focus:imcrm-text-accent-foreground',
            'data-[disabled]:imcrm-pointer-events-none data-[disabled]:imcrm-opacity-50',
            danger && 'imcrm-text-destructive focus:imcrm-bg-destructive focus:imcrm-text-destructive-foreground',
            className,
        )}
        {...props}
    />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

export const DropdownMenuCheckboxItem = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
    <DropdownMenuPrimitive.CheckboxItem
        ref={ref}
        checked={checked}
        className={cn(
            'imcrm-relative imcrm-flex imcrm-cursor-pointer imcrm-select-none imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-py-1.5 imcrm-pl-7 imcrm-pr-2 imcrm-text-sm imcrm-outline-none',
            'focus:imcrm-bg-accent focus:imcrm-text-accent-foreground',
            className,
        )}
        {...props}
    >
        <span className="imcrm-absolute imcrm-left-2 imcrm-flex imcrm-h-3.5 imcrm-w-3.5 imcrm-items-center imcrm-justify-center">
            <DropdownMenuPrimitive.ItemIndicator>
                <Check className="imcrm-h-3 imcrm-w-3" />
            </DropdownMenuPrimitive.ItemIndicator>
        </span>
        {children}
    </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName;

export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuSubTrigger = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
    <DropdownMenuPrimitive.SubTrigger
        ref={ref}
        className={cn(
            'imcrm-flex imcrm-cursor-pointer imcrm-select-none imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-rounded imcrm-px-2 imcrm-py-1.5 imcrm-text-sm imcrm-outline-none',
            'focus:imcrm-bg-accent focus:imcrm-text-accent-foreground',
            'data-[state=open]:imcrm-bg-accent',
            className,
        )}
        {...props}
    >
        {children}
        <span aria-hidden className="imcrm-ml-2 imcrm-text-muted-foreground">›</span>
    </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName;

export const DropdownMenuSubContent = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
    <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.SubContent
            ref={ref}
            className={cn(
                'imcrm-z-50 imcrm-min-w-[10rem] imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-popover imcrm-p-1 imcrm-text-popover-foreground imcrm-shadow-imcrm-md',
                'imcrm-animate-imcrm-fade-in',
                className,
            )}
            {...props}
        />
    </DropdownMenuPrimitive.Portal>
));
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName;

export const DropdownMenuLabel = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitive.Label>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
    <DropdownMenuPrimitive.Label
        ref={ref}
        className={cn(
            'imcrm-px-2 imcrm-py-1.5 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground',
            className,
        )}
        {...props}
    />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

export const DropdownMenuSeparator = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
    <DropdownMenuPrimitive.Separator
        ref={ref}
        className={cn('imcrm-my-1 imcrm-h-px imcrm-bg-border', className)}
        {...props}
    />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;
