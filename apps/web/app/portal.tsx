/**
 * Entry point del bundle del portal del cliente (Fase 9 — 3.D).
 *
 * El shortcode `[imcrm-client-portal]` renderiza un
 * `<div class="imcrm-portal-root" data-imcrm-portal-boot="...">`
 * server-side con el saludo + un placeholder. Cuando este bundle
 * carga, busca esos divs, parsea el boot data y monta el renderer
 * dentro del `.imcrm-portal-body` reemplazando el placeholder.
 *
 * Mismo patrón que el bundle público de Fase 8.
 */

import { createRoot } from 'react-dom/client';

import { PortalRenderer } from './portal/PortalRenderer';
import type { PortalBootData } from './portal/types';

function init(): void {
    const roots = document.querySelectorAll<HTMLDivElement>('.imcrm-portal-root');
    roots.forEach((el) => {
        if (el.dataset.imcrmHydrated === '1') return;
        el.dataset.imcrmHydrated = '1';

        const bootRaw = el.getAttribute('data-imcrm-portal-boot') ?? '';
        let boot: PortalBootData;
        try {
            boot = JSON.parse(bootRaw) as PortalBootData;
        } catch (err) {
            if (typeof console !== 'undefined' && process.env.NODE_ENV !== 'production') {
                console.warn('[imagina-crm portal] boot data inválido', err);
            }
            return;
        }

        // Reemplazamos solo el `.imcrm-portal-body` — el header con
        // saludo + logout queda intacto (no necesita JS).
        const body = el.querySelector<HTMLElement>('.imcrm-portal-body');
        if (body === null) return;

        const root = createRoot(body);
        root.render(<PortalRenderer boot={boot} />);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
