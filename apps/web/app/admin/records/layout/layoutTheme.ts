import type { LayoutTheme } from '@imagina-base/shared';

/**
 * v0.1.230 — Presets de tema de la ficha. Un preset fija el acento, las
 * esquinas, el aire entre bloques y cómo se ve cada superficie; el diseño
 * puede pisar cualquiera de las cuatro cosas. Sin acento propio, la ficha
 * usa el color primario de la empresa (white-label).
 */
export interface ResolvedTheme {
    accent: string;
    radius: number;
    gap: number;
    surface: 'cards' | 'flat' | 'outlined';
}

const PRESETS: Record<string, Omit<ResolvedTheme, 'accent'> & { accent: string | null }> = {
    default: { accent: null, radius: 12, gap: 16, surface: 'cards' },
    minimal: { accent: null, radius: 8, gap: 20, surface: 'flat' },
    corporate: { accent: '#2a5bd7', radius: 6, gap: 14, surface: 'outlined' },
    fresh: { accent: '#0f9f6e', radius: 16, gap: 16, surface: 'cards' },
    warm: { accent: '#d9622b', radius: 14, gap: 16, surface: 'cards' },
};

const RADIUS = { none: 0, sm: 6, md: 10, lg: 14, xl: 18 } as const;
const GAP = { compact: 10, comfortable: 16, spacious: 24 } as const;

export function resolveTheme(theme: LayoutTheme | undefined): ResolvedTheme {
    const base = PRESETS[theme?.preset ?? 'default'] ?? PRESETS.default!;
    return {
        accent: theme?.accent ?? base.accent ?? 'hsl(var(--imcrm-primary))',
        radius: theme?.radius ? RADIUS[theme.radius] : base.radius,
        gap: theme?.density ? GAP[theme.density] : base.gap,
        surface: theme?.surface ?? base.surface,
    };
}

/** Clases de la superficie de un bloque según el tema. */
export function surfaceClass(surface: ResolvedTheme['surface']): string {
    switch (surface) {
        case 'flat':
            return 'imcrm-bg-transparent';
        case 'outlined':
            return 'imcrm-border imcrm-border-border imcrm-bg-card';
        default:
            return 'imcrm-border imcrm-border-border/80 imcrm-bg-card imcrm-shadow-imcrm-sm';
    }
}

/** Mezcla de un color con transparencia (para velos del acento). */
export function tint(color: string, pct: number): string {
    return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}
