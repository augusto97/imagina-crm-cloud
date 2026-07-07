import {
    __ as wpI18n__,
    _n as wpI18n_n,
    _x as wpI18n_x,
    sprintf as wpI18nSprintf,
} from '@wordpress/i18n';

/**
 * Wrapper de `@wordpress/i18n` con el text-domain del plugin pre-aplicado.
 *
 * Las llamadas al wrapper son bloqueantes y sincrónicas. Si WordPress aún
 * no ha cargado las traducciones para el handle del bundle (vía
 * `wp_set_script_translations`), `__()` devuelve el string fuente
 * (español) sin error.
 *
 * Usar siempre como:
 *
 *     import { __ } from '@/lib/i18n';
 *     __('Nuevo registro');
 *
 * No usar `@wordpress/i18n` directamente — perderías la consistencia del
 * domain y dificulta el extract de strings con `wp i18n make-pot`.
 */

export const TEXT_DOMAIN = 'imagina-crm';

export function __(text: string): string {
    return wpI18n__(text, TEXT_DOMAIN);
}

export function _x(text: string, context: string): string {
    return wpI18n_x(text, context, TEXT_DOMAIN);
}

export function _n(single: string, plural: string, count: number): string {
    return wpI18n_n(single, plural, count, TEXT_DOMAIN);
}

export const sprintf = wpI18nSprintf;
