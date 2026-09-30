/**
 * Anti-encuadre en el cliente (v0.1.227).
 *
 * El `X-Frame-Options`/`frame-ancestors` que impide que otro sitio meta la app
 * en un `<iframe>` (clickjacking: hacerle aprobar un conector OAuth o borrar
 * algo con un click "disfrazado") sólo existía si el operador copiaba las
 * cabeceras del proxy a su servidor — y `frame-ancestors` no se puede poner en
 * el `<meta>` de la CSP. Esto lo cubre desde el propio bundle: encuadrada por
 * OTRO origen, la app no se monta y ofrece abrirse en su propia pestaña.
 * El mismo origen sí puede encuadrarla (igual que `SAMEORIGIN`).
 */
export interface FrameWindow {
    self: unknown;
    top: { location: { origin: string } } | null;
    location: { origin: string };
}

export function isFramedCrossOrigin(win: FrameWindow): boolean {
    if (win.top === null || win.top === win.self) return false;
    try {
        // Leer el origin del `top` de otro sitio LANZA (SecurityError).
        return win.top.location.origin !== win.location.origin;
    } catch {
        return true;
    }
}

/**
 * Si la app está encuadrada por otro sitio, pinta un aviso mínimo (sin React:
 * nada de la app llega a montarse) y devuelve `true` para que el entry no
 * siga. El enlace abre la app en una pestaña propia.
 */
export function blockCrossOriginFraming(container: HTMLElement): boolean {
    if (!isFramedCrossOrigin(window as unknown as FrameWindow)) return false;
    container.textContent = '';
    const box = document.createElement('div');
    box.setAttribute(
        'style',
        'font-family:system-ui,sans-serif;font-size:14px;padding:24px;text-align:center;color:#333',
    );
    const p = document.createElement('p');
    p.textContent = 'Por seguridad, esta aplicación no se puede usar dentro de otro sitio.';
    const a = document.createElement('a');
    a.href = window.location.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Abrirla en una pestaña nueva';
    box.append(p, a);
    container.append(box);
    return true;
}
