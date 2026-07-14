import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BrandingResponse } from '@imagina-base/shared';

import { api, useSession } from '@/cloud/session';

/**
 * Branding white-label por workspace: `GET /workspaces/current/branding`.
 *
 * - `useBrandingData()` — sólo el query (lo consume el Sidebar y el panel de
 *   Ajustes). QueryKey por tenant activo NUMÉRICO (regla de oro §3.7): al
 *   cambiar de workspace se refetchea el branding del nuevo tenant.
 * - `useBranding()` — query + efecto que APLICA `primary_color` a los tokens
 *   del tema (CSS variables en `:root`). Montarlo UNA sola vez (en
 *   `AdminCloudApp`); el resto de la app lee del query cache vía
 *   `useBrandingData()`.
 */

/** QueryKey canónica del branding del tenant activo. */
export function brandingQueryKey(tenantId: number | null): readonly [string, number | null] {
    return ['branding', tenantId] as const;
}

/** Tokens que toman el color primario del tenant tal cual. */
const BRANDED_VARS = ['--imcrm-primary', '--imcrm-ring'] as const;
/** El sidebar oscuro (estilo ClickUp) se re-tiñe con el HUE del tenant. */
const SIDEBAR_VARS = ['--imcrm-sidebar', '--imcrm-sidebar-border', '--imcrm-sidebar-accent'] as const;

/**
 * `#RRGGBB` → tripleta HSL `"H S% L%"` (el formato de los tokens del tema,
 * que se consumen como `hsl(var(--imcrm-primary))`). Redondeo a enteros.
 * Devuelve `null` si el hex no es válido.
 */
export function hexToHslTriplet(hex: string): string | null {
    const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
    const digits = match?.[1];
    if (!digits) return null;
    const int = parseInt(digits, 16);
    const r = ((int >> 16) & 0xff) / 255;
    const g = ((int >> 8) & 0xff) / 255;
    const b = (int & 0xff) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0;
    let s = 0;
    if (d !== 0) {
        s = d / (1 - Math.abs(2 * l - 1));
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Query del branding del tenant activo (comparte cache con `useBranding`). */
export function useBrandingData() {
    const tenantId = useSession((s) => s.activeTenantId);
    // `activeTenantId` se persiste en localStorage: sin gate por usuario el
    // query dispararía ANTES de hidratar la sesión (401 + queda en error).
    const hasUser = useSession((s) => s.user !== null);
    return useQuery<BrandingResponse>({
        queryKey: brandingQueryKey(tenantId),
        queryFn: () => api.getBranding(),
        enabled: hasUser && tenantId !== null,
        staleTime: 60_000,
        retry: false,
    });
}

/**
 * Query + aplicación del color primario del tenant a los tokens del tema.
 * Con `primary_color` → setea las variables inline en `<html>`; con null (o
 * mientras carga otro tenant sin data) → las remueve y el CSS vuelve al
 * default (incluye el override de dark mode, que las inline pisarían).
 *
 * Tramo pre-login (ADR-S17): sin data del branding del tenant activo (sin
 * sesión, o cargando), manda el color del tenant del DOMINIO white-label
 * (`/public/boot` → `domainTenant` en el store) — así el LOGIN ya sale con la
 * marca de la empresa y no parpadea al hidratar. Con data del tenant activo,
 * ese branding SIEMPRE manda (misma fórmula, mismas vars: sin conflicto).
 */
export function useBranding() {
    const query = useBrandingData();
    const domainColor = useSession((s) => s.domainTenant?.primary_color ?? null);
    const primaryColor = query.data !== undefined ? (query.data.primary_color ?? null) : domainColor;

    useEffect(() => {
        const style = document.documentElement.style;
        const triplet = primaryColor !== null ? hexToHslTriplet(primaryColor) : null;
        const clear = (): void => {
            for (const name of BRANDED_VARS) style.removeProperty(name);
            for (const name of SIDEBAR_VARS) style.removeProperty(name);
        };
        if (triplet !== null) {
            for (const name of BRANDED_VARS) style.setProperty(name, triplet);
            // El riel toma el color de marca VIVO (estilo ClickUp: el riel ES
            // el color del tema, no una tinta imperceptible). Lightness fija
            // ~30% → texto blanco siempre contrasta, con cualquier hue.
            const [h, sRaw] = triplet.split(' ');
            const sat = Math.min(parseInt(sRaw ?? '60', 10) || 60, 70);
            style.setProperty('--imcrm-sidebar', `${h} ${sat}% 30%`);
            style.setProperty('--imcrm-sidebar-border', `${h} ${sat}% 37%`);
            style.setProperty('--imcrm-sidebar-accent', `${h} ${sat}% 38%`);
        } else {
            clear();
        }
        return clear;
    }, [primaryColor]);

    return query;
}
