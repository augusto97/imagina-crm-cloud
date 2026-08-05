import { Flame, Heart, Star } from 'lucide-react';

import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Calificación por estrellas (v0.1.158).
 *
 * En modo lectura y en modo edición es el MISMO widget: en ClickUp una
 * calificación se pone haciendo click en la estrella, no abriendo un editor
 * aparte. Volver a clickear la estrella actual limpia el valor (mismo gesto
 * de "des-seleccionar" que ya usan los chips de select desde v0.1.73).
 */
const ICONS = { star: Star, heart: Heart, flame: Flame } as const;
export type RatingIcon = keyof typeof ICONS;

interface Props {
    value: number | null;
    max?: number;
    icon?: RatingIcon;
    /** Sin `onChange` el control es de sólo lectura. */
    onChange?: (next: number | null) => void;
    size?: 'sm' | 'md';
}

export function RatingControl({ value, max = 5, icon = 'star', onChange, size = 'sm' }: Props): JSX.Element {
    const Icon = ICONS[icon] ?? Star;
    const current = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
    const total = Math.min(Math.max(Math.trunc(max) || 5, 1), 10);
    const px = size === 'sm' ? 'imcrm-h-3.5 imcrm-w-3.5' : 'imcrm-h-4 imcrm-w-4';
    const readOnly = onChange === undefined;

    return (
        <span
            className="imcrm-inline-flex imcrm-items-center imcrm-gap-0.5"
            role={readOnly ? 'img' : undefined}
            aria-label={readOnly ? `${current} / ${total}` : undefined}
        >
            {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
                const filled = n <= current;
                const glyph = (
                    <Icon
                        className={cn(
                            px,
                            filled ? 'imcrm-text-amber-500' : 'imcrm-text-muted-foreground/40',
                        )}
                        fill={filled ? 'currentColor' : 'none'}
                        aria-hidden
                    />
                );
                if (readOnly) return <span key={n}>{glyph}</span>;
                return (
                    <button
                        key={n}
                        type="button"
                        // El click no debe abrir el registro (la celda entera
                        // es clicable en la columna primaria).
                        onClick={(e) => {
                            e.stopPropagation();
                            onChange(n === current ? null : n);
                        }}
                        className="imcrm-rounded-sm hover:imcrm-scale-110 imcrm-transition-transform"
                        aria-label={`${n} ${__('de')} ${total}`}
                        aria-pressed={filled}
                    >
                        {glyph}
                    </button>
                );
            })}
        </span>
    );
}
