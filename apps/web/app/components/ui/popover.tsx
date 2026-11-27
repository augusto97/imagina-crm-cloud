import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

import { cn } from '@/lib/utils';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

/**
 * v0.1.473 — la rueda y el dedo vuelven a mover la lista de un desplegable
 * abierto DENTRO de una ventana (el registro flotante, el alta, un panel
 * lateral). La ventana bloquea el scroll de la página con `react-remove-scroll`,
 * que escucha `wheel`/`touchmove` en el `document` y cancela todo lo que no
 * esté dentro de su contenido. El desplegable se dibuja por portal en el
 * `<body>`, FUERA de ese contenido (y el bloqueo de Radix vive en el overlay, no
 * en el contenido: ni el árbol de React lo salva), así que la rueda sobre las
 * opciones quedaba cancelada y la lista no se movía.
 *
 * Cortar la propagación en el propio desplegable hace que el bloqueo nunca vea
 * el evento: el navegador scrollea lo que esté bajo el puntero y, al llegar al
 * final, `overscroll-behavior: contain` evita que siga hacia la página. Nada de
 * la app escucha `wheel`/`touchmove` dentro de un desplegable (ni en React).
 */
function stopScrollLock(e: Event): void {
    e.stopPropagation();
}

function useScrollableInModal<T extends HTMLElement>(
    forwarded: React.ForwardedRef<T>,
): (node: T | null) => void {
    const current = React.useRef<T | null>(null);
    return React.useCallback(
        (node: T | null) => {
            if (current.current) {
                current.current.removeEventListener('wheel', stopScrollLock);
                current.current.removeEventListener('touchmove', stopScrollLock);
            }
            current.current = node;
            if (node) {
                node.addEventListener('wheel', stopScrollLock, { passive: true });
                node.addEventListener('touchmove', stopScrollLock, { passive: true });
            }
            if (typeof forwarded === 'function') forwarded(node);
            else if (forwarded) forwarded.current = node;
        },
        [forwarded],
    );
}

export const PopoverContent = React.forwardRef<
    React.ElementRef<typeof PopoverPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 6, collisionPadding = 16, ...props }, ref) => {
    const scrollRef = useScrollableInModal(ref);
    return (
        <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
                ref={scrollRef}
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
                    'imcrm-overflow-y-auto imcrm-overscroll-contain',
                    className,
                )}
                {...props}
            />
        </PopoverPrimitive.Portal>
    );
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;
