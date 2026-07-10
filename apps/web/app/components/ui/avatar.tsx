import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Avatar de iniciales — cuadrado redondeado tonal (mismos tokens `tone-*`
 * que StatTile). El tono se elige por hash del nombre, así cada entidad
 * (empresa/usuario) mantiene SIEMPRE el mismo color — identidad estable,
 * estilo Linear/Vercel.
 */
const TONES = [
    ['imcrm-bg-tone-cyan/15', 'imcrm-text-tone-cyan'],
    ['imcrm-bg-tone-mint/15', 'imcrm-text-tone-mint'],
    ['imcrm-bg-tone-blue/15', 'imcrm-text-tone-blue'],
    ['imcrm-bg-tone-violet/15', 'imcrm-text-tone-violet'],
    ['imcrm-bg-tone-amber/15', 'imcrm-text-tone-amber'],
    ['imcrm-bg-tone-rose/15', 'imcrm-text-tone-rose'],
    ['imcrm-bg-tone-slate/15', 'imcrm-text-tone-slate'],
] as const;

function toneFor(seed: string): (typeof TONES)[number] {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    return TONES[Math.abs(h) % TONES.length]!;
}

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
    const [bg, fg] = toneFor(name);
    return (
        <span
            aria-hidden
            className={cn(
                'imcrm-inline-flex imcrm-shrink-0 imcrm-select-none imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-font-semibold',
                size === 'sm' ? 'imcrm-h-6 imcrm-w-6 imcrm-text-[10px]' : 'imcrm-h-8 imcrm-w-8 imcrm-text-xs',
                bg,
                fg,
                className,
            )}
            {...props}
        >
            {initialsOf(name)}
        </span>
    );
}
