import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * v0.1.262 — menús que no se abren solos al deslizar en el celular.
 *
 * El trigger de Radix abre en `pointerdown` (para el mouse es lo correcto: el
 * menú aparece al apretar). Pero en táctil el `pointerdown` es el INICIO de
 * cualquier gesto: deslizar la tira de pestañas de vistas (o el árbol del
 * panel) apoyando el dedo sobre un "···" abría su menú aunque la intención
 * fuera scrollear. Aquí, para punteros que no son mouse, se anula la apertura
 * en `pointerdown` y se abre en `click` — que el navegador NO dispara si el
 * gesto terminó en scroll. Mouse y teclado no cambian.
 *
 * Para eso el Root lleva su estado (controlado o no) y se lo pasa al Trigger.
 */
interface TouchToggle {
    open: boolean;
    setOpen: (open: boolean) => void;
}
const TouchToggleContext = React.createContext<TouchToggle | null>(null);

export function DropdownMenu({
    open: openProp,
    defaultOpen,
    onOpenChange,
    ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>): JSX.Element {
    const [inner, setInner] = React.useState(defaultOpen ?? false);
    const open = openProp ?? inner;
    const setOpen = React.useCallback(
        (next: boolean) => {
            if (openProp === undefined) setInner(next);
            onOpenChange?.(next);
        },
        [openProp, onOpenChange],
    );
    const ctx = React.useMemo(() => ({ open, setOpen }), [open, setOpen]);
    return (
        <TouchToggleContext.Provider value={ctx}>
            <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen} {...props} />
        </TouchToggleContext.Provider>
    );
}

export const DropdownMenuTrigger = React.forwardRef<
    React.ElementRef<typeof DropdownMenuPrimitive.Trigger>,
    React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(({ onPointerDown, onClick, ...props }, ref) => {
    const ctx = React.useContext(TouchToggleContext);
    // null = el último pointerdown fue de mouse (o no hubo: teclado).
    const touchDown = React.useRef<{ wasOpen: boolean } | null>(null);
    return (
        <DropdownMenuPrimitive.Trigger
            ref={ref}
            onPointerDown={(e) => {
                onPointerDown?.(e);
                if (e.defaultPrevented) return;
                if (e.pointerType === 'mouse' || !ctx) {
                    touchDown.current = null;
                    return;
                }
                // `composeEventHandlers` de Radix saltea su apertura si el
                // evento ya viene con preventDefault. No frena el scroll (eso
                // lo decide `touch-action`) ni el `click` posterior.
                e.preventDefault();
                touchDown.current = { wasOpen: ctx.open };
            }}
            onClick={(e) => {
                onClick?.(e);
                const down = touchDown.current;
                touchDown.current = null;
                if (!down || !ctx || e.defaultPrevented) return;
                // Si estaba abierto, el toque "afuera" ya lo cerró: no reabrir.
                ctx.setOpen(!down.wasOpen);
            }}
            {...props}
        />
    );
});
DropdownMenuTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName;

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
