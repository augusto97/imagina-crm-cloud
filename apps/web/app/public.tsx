/**
 * Entry point del bundle público (Fase 8 — 2.C).
 *
 * Se enqueuea automáticamente en cualquier página que contiene el
 * shortcode `[imcrm-list]` o el bloque GB `imagina-crm/list` (la
 * detección la hace `PublicAssets` en PHP).
 *
 * Comportamiento:
 *  1. Busca todos los `<div data-imcrm-public-list="...">` en el DOM.
 *  2. Para cada uno, parsea `data-imcrm-config` y `data-imcrm-initial`
 *     (JSON inyectado server-side por `Shortcode::render`).
 *  3. Monta el componente `PublicList` con esos props.
 *
 * El HTML server-side queda dentro del `<div>` como first paint — al
 * montar, React lo reemplaza. Usamos `createRoot` (no `hydrateRoot`)
 * porque mantener un mismo DOM tree para hidratación pura requeriría
 * que el HTML PHP coincida byte-a-byte con lo que React renderea,
 * lo cual es frágil y aumenta el costo del shortcode. El re-render
 * inicial es de ~10-30ms, imperceptible.
 */

import { createRoot } from 'react-dom/client';

import { PublicList } from './public/PublicList';
import type { PublicInitialPayload, PublicListConfig } from './public/types';

function init(): void {
    const roots = document.querySelectorAll<HTMLDivElement>('[data-imcrm-public-list]');
    roots.forEach((el) => {
        // Si por algún motivo se intenta hidratar dos veces, abortamos.
        if (el.dataset.imcrmHydrated === '1') return;
        el.dataset.imcrmHydrated = '1';

        const configRaw = el.getAttribute('data-imcrm-config') ?? '';
        const initialRaw = el.getAttribute('data-imcrm-initial') ?? '';
        let config: PublicListConfig;
        let initial: PublicInitialPayload;
        try {
            config = JSON.parse(configRaw) as PublicListConfig;
            initial = JSON.parse(initialRaw) as PublicInitialPayload;
        } catch (err) {
            // JSON inválido: dejamos el HTML server-side en su lugar (es
            // funcional para lectura aunque pierda la interactividad).
            // No spammeamos console.error en producción — solo en dev.
            if (typeof console !== 'undefined' && process.env.NODE_ENV !== 'production') {
                console.warn('[imagina-crm] no se pudo parsear data attrs', err);
            }
            return;
        }

        const root = createRoot(el);
        root.render(<PublicList config={config} initial={initial} columns={config.columns} />);
    });
}

// Espera al DOM listo. El bundle se carga con `in_footer=true`, así
// que en la mayoría de casos el DOM ya está parseado, pero defensivo.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
