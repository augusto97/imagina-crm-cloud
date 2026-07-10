/**
 * i18n propio de Imagina Base (sin dependencias de WordPress).
 *
 * Herencia: el fork del plugin usaba `@wordpress/i18n` + text-domain, pero en
 * la nube nunca se cargan catálogos de traducción (no hay
 * `wp_set_script_translations`), así que `__()` siempre devolvía el string
 * fuente. Este módulo reproduce esa semántica con cero dependencias:
 *  - `__(text)` / `_x(text, context)` → identidad (el fuente ya está en español).
 *  - `_n(single, plural, count)`      → singular si count === 1, si no plural.
 *  - `sprintf(fmt, ...args)`          → estilo printf: %s %d %f, posicionales
 *    (%1$s) y %% literal — lo que usa el código heredado.
 *
 * Usar siempre como `import { __ } from '@/lib/i18n'`. Si algún día se agregan
 * idiomas, este módulo es el único punto a tocar.
 */

export function __(text: string): string {
    return text;
}

export function _x(text: string, _context: string): string {
    return text;
}

export function _n(single: string, plural: string, count: number): string {
    return count === 1 ? single : plural;
}

const SPEC = /%(\d+\$)?([sdf%])/g;

export function sprintf(format: string, ...args: Array<string | number>): string {
    let auto = 0;
    return format.replace(SPEC, (_m, pos: string | undefined, kind: string) => {
        if (kind === '%') return '%';
        const index = pos !== undefined ? Number(pos.slice(0, -1)) - 1 : auto++;
        const value = args[index];
        if (value === undefined) return '';
        if (kind === 'd') return String(Math.trunc(Number(value)));
        if (kind === 'f') return String(Number(value));
        return String(value);
    });
}
