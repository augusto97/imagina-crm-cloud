import type { BlockStyle, EmailBlock, EmailInnerBlock, EmailPadding } from '@imagina-base/shared';

import { STYLE_KEYS, styleHasAny, type QuickPreset, type StyleEditor } from '@/components/design/DesignStyleControls';
import { __ } from '@/lib/i18n';

/**
 * v0.1.273 — Atajos del panel «Estilo» del editor de correos: el tamaño
 * rápido de un título y el «Espacio arriba y abajo». Puros (con tests): un
 * atajo marca la opción sólo si no hay un valor exacto que lo pise, y elegir
 * uno BORRA el exacto en el mismo cambio (un solo paso de deshacer). Así cada
 * ajuste vive en un solo lugar y nunca hay dos controles peleándose.
 */

/** Lo que el renderizador usa para «Espacio arriba y abajo» (px). */
export const PAD_V: Record<EmailPadding, number> = { none: 0, sm: 6, md: 12, lg: 24 };

export const HEADING_SIZES: Record<1 | 2 | 3, number> = { 1: 28, 2: 22, 3: 18 };

export function levelPreset(ed: StyleEditor, level: 1 | 2 | 3, onPatch: (patch: Record<string, unknown>) => void): QuickPreset {
    return {
        label: __('Tamaño'),
        options: [
            { value: '1', label: __('Grande'), title: `${HEADING_SIZES[1]}px` },
            { value: '2', label: __('Mediano'), title: `${HEADING_SIZES[2]}px` },
            { value: '3', label: __('Chico'), title: `${HEADING_SIZES[3]}px` },
        ],
        current: ed.st.font_size == null ? String(level) : null,
        onPick: (v) => onPatch({ level: Number(v), style: ed.without(['font_size']) }),
    };
}

/** ¿El renderizador lo dibuja como recuadro (dentro de los márgenes)? */
export function isBox(st: BlockStyle | undefined): boolean {
    const s = st ?? {};
    return s.bg_mode === 'box' || (s.bg_mode !== 'band' && ((s.border_width ?? 0) > 0 || (s.radius ?? 0) > 0 || (!!s.shadow && s.shadow !== 'none')));
}

export function spacingDefaults(block: EmailBlock | EmailInnerBlock): { padding?: number; margin: number } {
    // En banda, arriba/abajo usan el atajo y los lados el margen de la hoja:
    // no hay UN número que describa los 4 lados, así que la pista queda «auto».
    if (!isBox(block.style)) return { margin: 0 };
    return { margin: PAD_V[block.padding ?? 'sm'], padding: block.background || (block.style?.border_width ?? 0) > 0 ? 16 : 0 };
}

export function spacingPreset(ed: StyleEditor, block: EmailBlock | EmailInnerBlock, onPatch: (patch: Record<string, unknown>) => void): QuickPreset {
    return {
        label: __('Espacio arriba y abajo'),
        options: (['none', 'sm', 'md', 'lg'] as const).map((v) => ({
            value: v,
            label: { none: __('Nada'), sm: __('Poco'), md: __('Medio'), lg: __('Mucho') }[v],
            title: `${PAD_V[v]}px`,
        })),
        current: styleHasAny(block.style, STYLE_KEYS.verticalSpace) ? null : (block.padding ?? (block.background ? 'lg' : 'sm')),
        onPick: (v) => onPatch({ padding: v, style: ed.without(STYLE_KEYS.verticalSpace) }),
    };
}
