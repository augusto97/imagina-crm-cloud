import { __ } from '@/lib/i18n';

/**
 * Skip-link para usuarios de teclado y screen readers.
 *
 * Visualmente oculto hasta recibir foco; al presionar Tab desde el inicio
 * del documento aparece como botón flotante en la esquina superior
 * izquierda con el texto "Saltar al contenido". Apunta a `#imcrm-main`
 * que es el `<main>` del AdminShell.
 *
 * v0.1.286 — la app usa HashRouter: un `href="#imcrm-main"` lo tomaba como
 * RUTA (`/imcrm-main` no existe → redirigía a /lists). Ahora el click no
 * navega: lleva el foco al `<main>` y deja el scroll donde está.
 *
 * Convención WCAG 2.4.1 (Bypass Blocks).
 */
export function SkipLink(): JSX.Element {
    return (
        <a
            href="#imcrm-main"
            onClick={(e) => {
                e.preventDefault();
                const main = document.getElementById('imcrm-main');
                main?.focus({ preventScroll: true });
            }}
            className="imcrm-sr-only focus:imcrm-not-sr-only focus:imcrm-fixed focus:imcrm-left-4 focus:imcrm-top-4 focus:imcrm-z-[100] focus:imcrm-rounded-md focus:imcrm-bg-primary focus:imcrm-px-4 focus:imcrm-py-2 focus:imcrm-text-sm focus:imcrm-font-medium focus:imcrm-text-primary-foreground focus:imcrm-shadow-imcrm-lg focus:imcrm-outline-none focus:imcrm-ring-2 focus:imcrm-ring-ring focus:imcrm-ring-offset-2"
        >
            {__('Saltar al contenido')}
        </a>
    );
}
