import type { FileThumbWidth } from '@imagina-base/shared';

/**
 * v0.1.426 — Miniaturas de los archivos.
 *
 * El servidor devuelve `thumb_url` (sólo para imágenes): la URL firmada del
 * archivo con `&w=320`. El ancho no entra en la firma, así que cada superficie
 * pide el suyo cambiando ese parámetro: 96 en la celda de la tabla (se ve a
 * ~24 px, alcanza para pantallas 3x), 160/320 en la ficha y 640 en las
 * portadas de tarjetas y kanban.
 */

/** La misma URL con otro ancho de miniatura (agrega `w` si no lo tenía). */
export function withThumbWidth(url: string, width: FileThumbWidth): string {
    if (/[?&]w=\d+/.test(url)) return url.replace(/([?&])w=\d+/, `$1w=${width}`);
    return `${url}${url.includes('?') ? '&' : '?'}w=${width}`;
}

/** `src` + `srcSet` (1x/2x) de una miniatura. */
export function thumbSources(url: string, width: FileThumbWidth, retina: FileThumbWidth): { src: string; srcSet: string } {
    return { src: withThumbWidth(url, width), srcSet: `${withThumbWidth(url, width)} 1x, ${withThumbWidth(url, retina)} 2x` };
}

/**
 * Qué se muestra: hasta `max` cosas y después «+N». Las IMÁGENES van primero
 * (son lo que se reconoce de un vistazo; el orden del campo se respeta dentro
 * de cada grupo): un PDF subido antes que la foto no la esconde detrás de un
 * «+1». En la celda de la tabla, lo que no es imagen va con su nombre y ocupa
 * más, así que después del primero se corta (`stopAfterNamed`); en la ficha se
 * ven todos. `isImage` puede no saberse todavía (null = cargando: cuenta como
 * imagen para no saltar de lugar cuando llega).
 */
export function visibleFileItems<T>(
    items: readonly T[],
    isImage: (item: T) => boolean | null,
    max = 4,
    opts: { stopAfterNamed?: boolean } = {},
): { shown: T[]; more: number } {
    const stop = opts.stopAfterNamed ?? true;
    const ordered = [...items.filter((it) => isImage(it) !== false), ...items.filter((it) => isImage(it) === false)];
    const shown: T[] = [];
    for (const item of ordered) {
        if (shown.length >= max) break;
        shown.push(item);
        if (stop && isImage(item) === false) break;
    }
    return { shown, more: items.length - shown.length };
}
