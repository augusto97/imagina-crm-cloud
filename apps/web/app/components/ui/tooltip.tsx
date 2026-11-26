import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '@/lib/utils';

/**
 * v0.1.471 — Tooltip de la app: sale rápido (250 ms; al pasar al botón de al
 * lado, al instante) y dice QUÉ es el botón y PARA QUÉ sirve. El `title`
 * nativo del navegador tardaba ~1,5 s y en varios botones ni aparecía: con
 * una fila de íconos no se entendía qué hacía cada uno.
 *
 * - Con el teclado aparece al llegar con Tab, pero no cuando la app pone el
 *   foco sola (al abrir la ficha o al cerrar un diálogo).
 * - En pantallas táctiles no aparece (Radix no lo abre con el dedo): ahí las
 *   acciones viven en menús con su nombre escrito.
 */
const InProvider = React.createContext(false);

/**
 * Con el teclado, el tooltip sale sólo si se llegó al botón con Tab. Un foco
 * que pone la app sola (al abrir la ficha, al cerrar un menú o una ventana con
 * Esc) no lo levanta: `:focus-visible` no alcanza, porque después de una tecla
 * el navegador también lo da por visible.
 */
let lastTabAt = 0;
let tracking = false;
function trackTab(): void {
    if (tracking || typeof document === 'undefined') return;
    tracking = true;
    document.addEventListener(
        'keydown',
        (e) => {
            if (e.key === 'Tab') lastTabAt = Date.now();
        },
        true,
    );
    document.addEventListener(
        'pointerdown',
        () => {
            lastTabAt = 0;
        },
        true,
    );
}

export function TooltipProvider({
    children,
    delayDuration = 250,
    skipDelayDuration = 500,
}: {
    children: React.ReactNode;
    delayDuration?: number;
    skipDelayDuration?: number;
}): JSX.Element {
    return (
        <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration}>
            <InProvider.Provider value={true}>{children}</InProvider.Provider>
        </TooltipPrimitive.Provider>
    );
}

export interface TipProps {
    /** El nombre del botón («Generar PDF»). */
    label: string;
    /** Para qué sirve, en una línea («Arma un documento con los datos…»). */
    hint?: string | null;
    /** Un atajo de teclado («Esc», «K o ↑»). */
    shortcut?: string | null;
    side?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
    /** Sin tooltip (p. ej. el botón ya muestra su nombre). */
    disabled?: boolean;
    /** Un solo elemento que reenvía su ref (un `Button`, un trigger de Radix). */
    children: React.ReactElement;
}

export function Tip({ label, hint, shortcut, side = 'bottom', align = 'center', disabled = false, children }: TipProps): JSX.Element {
    const inProvider = React.useContext(InProvider);
    trackTab();
    if (disabled) return children;
    const tip = (
        <TooltipPrimitive.Root>
            <TooltipPrimitive.Trigger
                asChild
                // Sólo si se llegó con Tab: el foco que pone la app sola no
                // levanta el tooltip.
                onFocus={(e) => {
                    if (Date.now() - lastTabAt > 1000) e.preventDefault();
                }}
            >
                {children}
            </TooltipPrimitive.Trigger>
            <TooltipPrimitive.Portal>
                <TooltipPrimitive.Content
                    side={side}
                    align={align}
                    sideOffset={6}
                    collisionPadding={8}
                    className={cn(
                        'imcrm-z-[70] imcrm-max-w-[260px] imcrm-rounded-md imcrm-bg-foreground imcrm-px-2.5 imcrm-py-1.5 imcrm-text-background imcrm-shadow-imcrm-md',
                        'imcrm-animate-imcrm-fade-in',
                    )}
                    data-testid="imcrm-tooltip"
                >
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-font-semibold imcrm-leading-4">
                        <span>{label}</span>
                        {shortcut && (
                            <kbd className="imcrm-rounded imcrm-border imcrm-border-background/30 imcrm-px-1 imcrm-font-sans imcrm-text-[10px] imcrm-font-medium imcrm-leading-4 imcrm-opacity-80">
                                {shortcut}
                            </kbd>
                        )}
                    </span>
                    {hint && <span className="imcrm-mt-0.5 imcrm-block imcrm-text-[11px] imcrm-leading-4 imcrm-opacity-80">{hint}</span>}
                </TooltipPrimitive.Content>
            </TooltipPrimitive.Portal>
        </TooltipPrimitive.Root>
    );
    return inProvider ? tip : <TooltipProvider>{tip}</TooltipProvider>;
}
