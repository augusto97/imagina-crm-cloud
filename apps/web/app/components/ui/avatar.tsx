import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Avatar de iniciales — NEUTRO (pasada premium). El hash-de-color por
 * entidad pintaba cada fila de un pastel distinto y la grilla parecía
 * confeti; el estilo enterprise (Cloudflare/Stripe) usa iniciales en
 * gris uniforme y deja que el color aparezca sólo donde significa algo
 * (estados, alertas).
 */

function initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
    /** Nombre de la entidad; define iniciales y tono estable. */
    name: string;
    /** sm = 24px (filas densas) · md = 32px (default). */
    size?: 'sm' | 'md';
}

export function Avatar({ name, size = 'md', className, ...props }: AvatarProps): JSX.Element {
    return (
        <span
            aria-hidden
            className={cn(
                'imcrm-inline-flex imcrm-shrink-0 imcrm-select-none imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-font-semibold imcrm-text-foreground/70 imcrm-ring-1 imcrm-ring-border',
                size === 'sm' ? 'imcrm-h-6 imcrm-w-6 imcrm-text-[10px]' : 'imcrm-h-8 imcrm-w-8 imcrm-text-xs',
                className,
            )}
            {...props}
        >
            {initialsOf(name)}
        </span>
    );
}
