import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Texto solo visible para screen readers. Útil cuando un elemento es
 * comprensible visualmente por contexto (ej. botón con icono y nombre
 * por su posición) pero un lector de pantalla necesita el nombre
 * explícito.
 *
 * Implementación estándar (Tailwind `sr-only`): clip-path + 1px x 1px
 * fuera del flujo, sin display:none (para que SR sí lo lea).
 */
export function VisuallyHidden({
    children,
    className,
    ...props
}: React.HTMLAttributes<HTMLSpanElement>): JSX.Element {
    return (
        <span className={cn('imcrm-sr-only', className)} {...props}>
            {children}
        </span>
    );
}
