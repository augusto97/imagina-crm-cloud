import { useMemo } from 'react';
import {
    DEFAULT_PUBLIC_THEME,
    resolvePublicPalettes,
    type PublicElementColorKey,
    type PublicTheme,
} from '@imagina-base/shared';

import { ColorField } from '@/components/design/DesignStyleControls';
import { __ } from '@/lib/i18n';

import { effectiveTheme, fallbackAccent, patchThemeSection, type Themed } from './themeOps';

/**
 * v0.1.377 — El color de CADA elemento (título, descripción, etiquetas,
 * opciones, botón, avance…). Vacío = el que sale de los colores generales del
 * diseño, que se ve punteado. Lo usan el panel de un elemento (sólo sus
 * colores) y «Colores de cada elemento» del diseño (todos).
 */

export const ELEMENT_COLOR_LABELS: Record<PublicElementColorKey, string> = {
    title: 'Título',
    description: 'Descripción',
    label: 'Preguntas (etiqueta)',
    help: 'Ayuda de cada pregunta',
    required: 'Asterisco de obligatoria',
    heading: 'Títulos de sección',
    text: 'Textos y aclaraciones',
    input_text: 'Texto que se escribe',
    placeholder: 'Texto de ejemplo',
    choice_bg: 'Fondo de las opciones',
    choice_text: 'Texto de las opciones',
    choice_border: 'Borde de las opciones',
    choice_selected_bg: 'Opción elegida (fondo)',
    choice_selected_text: 'Opción elegida (texto)',
    button_bg: 'Fondo del botón',
    button_text: 'Texto del botón',
    button_border: 'Borde del botón',
    progress: 'Avance (lo hecho)',
    progress_track: 'Avance (lo que falta)',
    band: 'Franja de color',
    link: 'Enlaces',
};

/** Los grupos de «Colores de cada elemento», en el orden en que se ven en la página. */
export const ELEMENT_COLOR_GROUPS: ReadonlyArray<{ title: string; keys: PublicElementColorKey[] }> = [
    { title: 'Encabezado', keys: ['title', 'description', 'band'] },
    { title: 'Preguntas', keys: ['label', 'help', 'required', 'input_text', 'placeholder'] },
    { title: 'Opciones', keys: ['choice_bg', 'choice_text', 'choice_border', 'choice_selected_bg', 'choice_selected_text'] },
    { title: 'Contenido', keys: ['heading', 'text', 'link'] },
    { title: 'Botón y avance', keys: ['button_bg', 'button_text', 'button_border', 'progress', 'progress_track'] },
];

/** El color que tiene cada elemento cuando no se le eligió uno (el de la paleta). */
export function elementFallbacks(theme: PublicTheme, accent: string): Record<PublicElementColorKey, string> {
    const p = resolvePublicPalettes(theme, accent).main;
    return {
        title: p.text,
        description: p.muted,
        label: p.text,
        help: p.muted,
        required: p.error,
        heading: p.text,
        text: p.text,
        input_text: p.text,
        placeholder: p.muted,
        choice_bg: p.input_bg,
        choice_text: p.text,
        choice_border: p.input_border,
        choice_selected_bg: p.accent,
        choice_selected_text: p.accent_ink,
        button_bg: p.accent,
        button_text: p.accent_ink,
        button_border: p.accent,
        progress: p.accent,
        progress_track: p.border,
        band: p.accent,
        link: p.accent,
    };
}

export function elementColorsModified(theme: PublicTheme, keys: ReadonlyArray<PublicElementColorKey>): boolean {
    return keys.some((k) => theme.elements[k] !== null);
}

export function ElementColors<C extends Themed>({
    config,
    onChange,
    keys,
    brand,
    base = DEFAULT_PUBLIC_THEME,
    columns = 2,
}: {
    config: C;
    onChange: (next: C) => void;
    keys: ReadonlyArray<PublicElementColorKey>;
    brand: string;
    base?: PublicTheme;
    columns?: 1 | 2;
}): JSX.Element {
    const s = config.settings;
    const t = useMemo(() => effectiveTheme(s, base), [s, base]);
    const accent = fallbackAccent(s, brand);
    const fb = useMemo(() => elementFallbacks(t, accent), [t, accent]);
    return (
        <div className={columns === 2 ? 'imcrm-grid imcrm-grid-cols-2 imcrm-gap-2' : 'imcrm-flex imcrm-flex-col imcrm-gap-2'} data-testid="element-colors">
            {keys.map((k) => (
                <div key={k} data-element-color={k}>
                    <ColorField
                        label={__(ELEMENT_COLOR_LABELS[k])}
                        value={t.elements[k]}
                        placeholder={fb[k]}
                        onChange={(v) => onChange(patchThemeSection(config, 'elements', { [k]: v } as Partial<PublicTheme['elements']>, base))}
                    />
                </div>
            ))}
        </div>
    );
}
