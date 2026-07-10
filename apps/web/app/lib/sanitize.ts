import DOMPurify from 'dompurify';

/**
 * Sanitización de contenido HTML / URLs autoría-admin (SEC-02).
 *
 * Aunque el HTML de los bloques (portal, plantillas, firma de correo) lo
 * configura un usuario del equipo, el CLIENTE del portal es una identidad de
 * MENOR confianza. Un admin no debe poder ejecutar JavaScript en el navegador
 * del cliente (XSS almacenado que cruza una frontera de privilegio). React no
 * escapa `dangerouslySetInnerHTML` ni neutraliza esquemas `javascript:` en
 * atributos `href`, así que hay que sanitizar explícitamente en el borde de
 * render.
 */

/**
 * Sanitiza una cadena de HTML antes de inyectarla con
 * `dangerouslySetInnerHTML`. Deja formato e imágenes/enlaces básicos, pero
 * elimina `<script>`, manejadores `on*`, `javascript:`, y elementos peligrosos
 * (iframe/object/embed, controles de formulario, `<style>`).
 */
export function sanitizeHtml(dirty: string): string {
    return DOMPurify.sanitize(dirty, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: [
            'style',
            'iframe',
            'object',
            'embed',
            'form',
            'input',
            'button',
            'textarea',
            'select',
            'option',
        ],
        FORBID_ATTR: ['style'],
    });
}

/**
 * Devuelve una URL segura para un atributo `href`/`src` de React. Acepta
 * http, https, mailto, tel y rutas relativas; cualquier otro esquema
 * (`javascript:`, `data:`, `vbscript:`, `file:`…) se colapsa a `#` para que
 * el enlace sea inerte. React escapa el valor del atributo, así que aquí solo
 * importa la whitelist de esquema.
 */
export function sanitizeHref(url: string | null | undefined): string {
    if (url === null || url === undefined) return '#';
    const trimmed = String(url).trim();
    if (trimmed === '') return '#';

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) return trimmed; // relativa, sin esquema

    // Si un `/`, `?` o `#` aparece antes del primer `:`, es relativa
    // (p.ej. `path/a:b`, `?x=a:b`, `#frag:z`).
    const slashIdx = trimmed.indexOf('/');
    const queryIdx = trimmed.indexOf('?');
    const hashIdx = trimmed.indexOf('#');
    const firstPathChar = Math.min(
        slashIdx === -1 ? Infinity : slashIdx,
        queryIdx === -1 ? Infinity : queryIdx,
        hashIdx === -1 ? Infinity : hashIdx,
    );
    if (firstPathChar < colonIdx) return trimmed;

    const scheme = trimmed.slice(0, colonIdx).toLowerCase();
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel') {
        return trimmed;
    }
    return '#';
}
