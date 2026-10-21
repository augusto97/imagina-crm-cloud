/**
 * Esc dentro de una ficha modal (modal del registro, alta).
 *
 * Radix escucha Escape en el `document` en fase de CAPTURA: llega antes que
 * el campo o el menú donde está la persona. Sin este filtro, Esc en un campo
 * (o en el menú «/» o la mención del editor de la descripción) cerraba la
 * ficha entera y se perdía lo escrito — y el «/» quedaba guardado.
 *
 * Regla: Esc cierra la capa MÁS CERCANA. Un menú propio abierto se cierra a sí
 * mismo; con el foco en un campo, Esc sale del campo; recién con el foco
 * "afuera" Esc pide cerrar la ficha (y pregunta si hay cambios sin guardar).
 * Los popovers de Radix (selectores, calendario) ya son capas propias: Radix
 * sólo le da el Esc a la capa de arriba.
 */

/** Marca de un menú flotante propio (no Radix) mientras está abierto. */
export const FLOATING_MENU_ATTR = 'data-imcrm-floating-menu';
/**
 * Marca de una barra flotante que vive montada aunque no se vea (la de formato
 * del editor): no cuenta para Esc, pero un click en ella no es "afuera".
 */
export const POPUP_ATTR = 'data-imcrm-popup';

/** ¿El click fue en un menú o barra flotante propia (no "afuera" de la ficha)? */
export function isInsideFloatingUi(target: Element | null): boolean {
    return target?.closest(`[${FLOATING_MENU_ATTR}], [${POPUP_ATTR}]`) != null;
}

const TEXT_INPUTS = new Set([
    'text', 'search', 'email', 'url', 'tel', 'number', 'password', 'date', 'datetime-local', 'time', 'month', 'week', '',
]);

/** ¿El elemento es un lugar donde se escribe? */
export function isEditableTarget(el: Element | null | undefined): boolean {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el.isContentEditable) return true;
    // jsdom no implementa isContentEditable: se mira el atributo heredado.
    if (el.closest('[contenteditable="true"], [contenteditable=""]') !== null) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return TEXT_INPUTS.has(((el as HTMLInputElement).type ?? '').toLowerCase());
    return false;
}

/** ¿Hay un menú flotante propio abierto dentro de `root`? */
export function hasOpenFloatingMenu(root: ParentNode | null | undefined = typeof document === 'undefined' ? null : document): boolean {
    return root?.querySelector(`[${FLOATING_MENU_ATTR}]`) != null;
}

export type EscapeIntent = 'menu' | 'field' | 'close';

/** Qué tiene que hacer un Esc dentro de la ficha `root` con el foco en `active`. */
export function escapeIntent(active: Element | null, root: Element | null): EscapeIntent {
    if (hasOpenFloatingMenu(typeof document === 'undefined' ? root : document)) return 'menu';
    if (active && (!root || root.contains(active)) && isEditableTarget(active)) return 'field';
    return 'close';
}

/**
 * Sale del campo enfocado si nadie lo hizo ya: los editores de fila de la
 * ficha manejan su propio Esc (salen del modo edición); el resto pierde el
 * foco y el siguiente Esc ya es para la ficha.
 */
export function leaveField(active: Element | null): void {
    if (!(active instanceof HTMLElement)) return;
    window.setTimeout(() => {
        if (document.activeElement === active) active.blur();
    }, 0);
}
