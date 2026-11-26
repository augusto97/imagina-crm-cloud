/**
 * v0.1.472 — El código de la ficha se baja ANTES de que haga falta: la
 * ficha diseñada cuando la tabla de una lista que la usa queda quieta, y el
 * editor de la descripción en cuanto se abre un registro (a la par del
 * pedido de sus datos, no después). Antes las dos descargas empezaban recién
 * cuando llegaban los datos, y la primera ficha del día tardaba el doble.
 */

let designedBody: Promise<unknown> | null = null;
let descriptionEditor: Promise<unknown> | null = null;

export const loadDesignedBody = () => import('./DrawerDesignedBody');

export function warmDesignedRecord(): void {
    designedBody ??= loadDesignedBody().catch(() => {
        designedBody = null;
    });
}

export function warmDescriptionEditor(): void {
    descriptionEditor ??= import('../description/DescriptionEditor').catch(() => {
        descriptionEditor = null;
    });
}
