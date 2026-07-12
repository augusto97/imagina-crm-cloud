import * as React from 'react';
import { type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * StatTile — la primitiva de "tile de KPI" que usa nuestra app de
 * audit (audit.imagina.cloud) en su dashboard y en la vista Leads.
 *
 * Anatomía:
 *  - Card en blanco con border hairline y rounded-2xl
 *  - Icon en cuadrado redondeado tonal (bg-tone/10 + text-tone)
 *  - Label en small-caps gris ("TOTAL", "CON CONTACTO", etc.)
 *  - Número grande (`hint` opcional para sub-texto)
 *  - Estado `active` (border primary + ring) cuando hace de filtro
 *    seleccionado
 *
 * Tones disponibles: cyan (default) · mint · rose · blue · violet ·
 * amber · slate. Los tokens viven en globals.css → tailwind.config
 * como `tone-{name}`.
 */
type Tone = 'cyan' | 'mint' | 'rose' | 'blue' | 'violet' | 'amber' | 'slate';

/* Pasada premium: los tiles YA NO pintan el icon-square con el arcoíris
 * tonal (leía "dashboard template"). El chip es neutro (muted) y el
 * énfasis lo lleva el NÚMERO — estilo Cloudflare, donde el color aparece
 * sólo cuando significa algo. El tone `rose`/`amber` se conserva como
 * señal semántica (negativo/atención); el resto colapsa a neutro. */
const TONE_BG: Record<Tone, string> = {
    cyan:   'imcrm-bg-muted/70',
    mint:   'imcrm-bg-muted/70',
    rose:   'imcrm-bg-tone-rose/10',
    blue:   'imcrm-bg-muted/70',
    violet: 'imcrm-bg-muted/70',
    amber:  'imcrm-bg-tone-amber/10',
    slate:  'imcrm-bg-muted/70',
};

const TONE_FG: Record<Tone, string> = {
    cyan:   'imcrm-text-foreground/60',
    mint:   'imcrm-text-foreground/60',
    rose:   'imcrm-text-tone-rose',
    blue:   'imcrm-text-foreground/60',
    violet: 'imcrm-text-foreground/60',
    amber:  'imcrm-text-tone-amber',
    slate:  'imcrm-text-foreground/60',
};

interface StatTileProps {
    icon: LucideIcon;
    label: string;
    value: React.ReactNode;
    hint?: React.ReactNode;
    tone?: Tone;
    /** Si `true`, marca el tile como filtro activo (border + ring primary). */
    active?: boolean;
    onClick?: () => void;
    className?: string;
}

export function StatTile({
    icon: Icon,
    label,
    value,
    hint,
    tone = 'cyan',
    active,
    onClick,
    className,
}: StatTileProps): JSX.Element {
    const Comp: React.ElementType = onClick !== undefined ? 'button' : 'div';
    return (
        <Comp
            type={onClick !== undefined ? 'button' : undefined}
            onClick={onClick}
            className={cn(
                'imcrm-relative imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-2xl imcrm-border imcrm-bg-card imcrm-p-4 imcrm-text-left imcrm-transition-all imcrm-duration-150',
                active
                    ? 'imcrm-border-primary imcrm-shadow-[0_0_0_3px_hsl(var(--imcrm-primary)/0.12)]'
                    : 'imcrm-border-border hover:imcrm-border-input',
                onClick !== undefined && 'imcrm-cursor-pointer hover:imcrm-bg-card/95',
                className,
            )}
        >
            <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                <span className="imcrm-flex-1 imcrm-text-[11px] imcrm-font-medium imcrm-tracking-[0.02em] imcrm-text-muted-foreground">
                    {label}
                </span>
                <span
                    className={cn(
                        'imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg',
                        TONE_BG[tone],
                        TONE_FG[tone],
                    )}
                >
                    <Icon className="imcrm-h-4 imcrm-w-4" aria-hidden />
                </span>
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                <span className="imcrm-text-[24px] imcrm-font-semibold imcrm-leading-none imcrm-tabular-nums imcrm-tracking-tight imcrm-text-foreground">
                    {value}
                </span>
                {hint !== undefined && hint !== null && hint !== '' && (
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {hint}
                    </span>
                )}
            </div>
        </Comp>
    );
}
