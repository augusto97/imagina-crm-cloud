/**
 * ¿La página corre como DEMOSTRACIÓN (la de «Compartir», dentro de la app)?
 *
 * En la demostración nada se envía, no se cuenta ni se pide el anti-robots,
 * y se muestra la pantalla final de verdad. Por eso NO alcanza con el
 * parámetro `imb_demo=1` de la dirección: cualquiera podía repartir el enlace
 * real del formulario con ese parámetro (o insertarlo así en otro sitio) y la
 * gente creía haber enviado algo que nunca se guardó. Sólo vale cuando la
 * página está metida en un marco cuyo padre es del MISMO origen: la app.
 * Abierta directo o insertada en otro sitio, el parámetro se ignora.
 */
export interface DemoGateWindow {
    location: { search: string; origin: string };
    parent?: unknown;
}

export function isDemoFrame(win: DemoGateWindow): boolean {
    let asked = false;
    try {
        asked = new URLSearchParams(win.location.search).get('imb_demo') === '1';
    } catch {
        return false;
    }
    if (!asked) return false;
    try {
        const parent = win.parent as { location: { origin: string } } | undefined | null;
        // Sin marco, `parent` es la propia ventana.
        if (!parent || parent === win) return false;
        // Leer el origen de un padre de otro sitio lanza: no es la app.
        return parent.location.origin === win.location.origin;
    } catch {
        return false;
    }
}
