import { createElement, type ComponentType, type SVGProps } from 'react';

import { LIST_ICON_PATHS, type ListIconPath } from './listIconPaths.generated';

/**
 * Componente de icono del catálogo: cualquier SVG que acepte `className` y
 * `style` (los del catálogo y los de lucide cumplen los dos).
 */
export type ListIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export interface ListIconEntry {
    key: string;
    icon: ListIconComponent;
    label: string;
    category: string;
}

/**
 * Catálogo de iconos para listas, carpetas y dashboards (v0.1.137).
 *
 * El usuario pidió lo que hace ClickUp: cada lista con su icono en vez de
 * un punto igual para todas. Se guarda la CLAVE (`lists.icon`), nunca el
 * componente — así el set de iconos puede cambiar sin romper los datos.
 *
 * v0.1.175 — el catálogo pasa a **324 glifos SÓLIDOS** (Phosphor "fill",
 * generados a `listIconPaths.generated.ts` por `scripts/gen-list-icons.mjs`):
 * a 14-16px un icono de trazo casi no se distingue y 36 opciones eran pocas
 * (feedback del usuario mirando ClickUp). Cada glifo es un `<svg>` con su
 * `path` embebido — sin librería en runtime, ~30 KB gz en total. Las 36
 * claves históricas se conservan con el MISMO nombre: lo guardado sigue
 * valiendo, sólo cambia el dibujo. El selector agrupa por categoría y busca
 * sin acentos.
 */
function pathIcon(entry: ListIconPath): ListIconComponent {
    const Icon: ListIconComponent = (props) =>
        createElement(
            'svg',
            { viewBox: '0 0 256 256', fill: 'currentColor', 'aria-hidden': true, ...props },
            createElement('path', { d: entry.d }),
        );
    Icon.displayName = `ListIcon(${entry.key})`;
    return Icon;
}

export const LIST_ICONS: readonly ListIconEntry[] = LIST_ICON_PATHS.map((p) => ({
    key: p.key,
    icon: pathIcon(p),
    label: p.label,
    category: p.category,
}));

const BY_KEY = new Map(LIST_ICONS.map((e) => [e.key, e]));

/** Categorías en el orden del selector (el del generador). */
export const LIST_ICON_CATEGORIES: readonly string[] = [...new Set(LIST_ICONS.map((e) => e.category))];

/** Sin acentos y en minúsculas, para buscar "camion" y encontrar "Camión". */
function fold(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Filtra el catálogo por etiqueta o clave (sin acentos); vacío = todo. */
export function searchListIcons(query: string): readonly ListIconEntry[] {
    const q = fold(query.trim());
    if (q === '') return LIST_ICONS;
    return LIST_ICONS.filter((e) => fold(e.label).includes(q) || e.key.replace(/_/g, ' ').includes(q));
}

/**
 * Icono de las listas que no eligieron uno (v0.1.139). Antes caían a un
 * puntito gris igual para todas — el usuario lo pidió explícitamente: toda
 * lista se ve con icono, elija o no.
 */
export const DEFAULT_LIST_ICON: ListIconComponent = BY_KEY.get('list')!.icon;

/** Icono de las carpetas sin elección (v0.1.173), sólido como el resto. */
export const DEFAULT_FOLDER_ICON: ListIconComponent = BY_KEY.get('folder')!.icon;

/** Icono de los dashboards sin elección (v0.1.145). */
export const DEFAULT_DASHBOARD_ICON: ListIconComponent = BY_KEY.get('chart_bar')!.icon;

/** El icono de una lista, o `undefined` si no eligió ninguno (o es viejo). */
export function listIcon(key: string | null | undefined): ListIconComponent | undefined {
    if (typeof key !== 'string' || key === '') return undefined;
    return BY_KEY.get(key)?.icon;
}

/**
 * Colores para el icono. Se guardan como hex en `lists.color` (la columna
 * ya existía) para no atarse a los presets del tema.
 */
export const LIST_ICON_COLORS: Array<{ hex: string; label: string }> = [
    { hex: '#64748b', label: 'Gris' },
    { hex: '#ef4444', label: 'Rojo' },
    { hex: '#f97316', label: 'Naranja' },
    { hex: '#eab308', label: 'Amarillo' },
    { hex: '#22c55e', label: 'Verde' },
    { hex: '#14b8a6', label: 'Turquesa' },
    { hex: '#0ea5e9', label: 'Celeste' },
    { hex: '#6366f1', label: 'Índigo' },
    { hex: '#a855f7', label: 'Violeta' },
    { hex: '#ec4899', label: 'Rosa' },
];

/** Hex válido (`#rrggbb`) o `undefined` — nunca se inyecta lo que venga. */
export function listColor(color: string | null | undefined): string | undefined {
    return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : undefined;
}
