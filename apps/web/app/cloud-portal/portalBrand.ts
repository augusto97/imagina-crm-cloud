import { createContext, useContext } from 'react';
import { hexToHslTriplet } from '@/hooks/useBranding';
import { applyFavicon } from '@/lib/favicon';

/**
 * v0.1.245 — marca del portal del cliente (white-label).
 *
 * El portal no muestra NADA de la plataforma: ni su nombre, ni su ícono, ni
 * su color. La marca sale de dos lugares:
 *  - ANTES de la sesión (entrar, validar el enlace, enlace vencido, cerrar
 *    sesión): del dominio por el que se entró (`GET /public/boot` resuelve el
 *    Host → empresa). En el dominio de la plataforma no hay empresa: se ve
 *    un portal neutro, sin marca de nadie.
 *  - CON sesión: de la empresa de la cuenta que se está mirando.
 *
 * Una sola función pinta todo (color, ícono, título) y la llama un solo
 * efecto en la raíz del portal con la marca vigente: la de la sesión si hay,
 * si no la del dominio. Así no compiten dos efectos por el `<head>`.
 */
export interface PortalBrand {
    /** Nombre que ve el cliente (app_name de la empresa, o su nombre). */
    name: string | null;
    logoUrl: string | null;
    primaryColor: string | null;
}

/** Ícono neutro del portal cuando no hay empresa (dominio de la plataforma). */
export const PORTAL_NEUTRAL_ICON = '/portal-favicon.svg';
export const PORTAL_NEUTRAL_TITLE = 'Portal de clientes';

export function portalTitle(brand: PortalBrand | null): string {
    const name = brand?.name?.trim();
    return name ? `${name} — Portal de clientes` : PORTAL_NEUTRAL_TITLE;
}

/** Pinta la marca en el documento (DOM puro: se testea con jsdom). */
export function applyPortalBrand(brand: PortalBrand | null, doc: Document = document): void {
    const root = doc.documentElement;
    const hsl = brand?.primaryColor ? hexToHslTriplet(brand.primaryColor) : null;
    if (hsl) {
        root.style.setProperty('--imcrm-primary', hsl);
        root.style.setProperty('--imcrm-ring', hsl);
    } else {
        root.style.removeProperty('--imcrm-primary');
        root.style.removeProperty('--imcrm-ring');
    }
    // El ícono neutro se pinta como "logo": así no reaparecen los íconos por
    // defecto de la app del equipo.
    applyFavicon(brand?.logoUrl || PORTAL_NEUTRAL_ICON, doc);
    doc.title = portalTitle(brand);
}

/**
 * La sesión del portal avisa su marca a la raíz (que es la que pinta). `null`
 * = no hay sesión mostrándose: vale la del dominio.
 */
export const PortalBrandSetterContext = createContext<(brand: PortalBrand | null) => void>(() => undefined);

/** La marca del DOMINIO (la que ven las pantallas sin sesión). */
export const HostBrandContext = createContext<PortalBrand | null>(null);

export function useHostBrand(): PortalBrand | null {
    return useContext(HostBrandContext);
}
