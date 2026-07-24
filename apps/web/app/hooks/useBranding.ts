import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BrandingResponse } from '@imagina-base/shared';

import { api, useSession } from '@/cloud/session';
import { setTenantFormat } from '@/lib/tenantFormat';
import { useTheme, type ResolvedTheme } from '@/lib/theme';

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

/** Parte una tripleta `"H S% L%"` en números (o null si no matchea). */
function parseTriplet(triplet: string): { h: number; s: number; l: number } | null {
    const m = /^(\d+)\s+(\d+)%\s+(\d+)%$/.exec(triplet);
    if (!m) return null;
    return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

/**
 * v0.1.112 — Tokens de marca ADAPTADOS al tema activo.
 *
 * En claro el color del tenant se usa tal cual. En oscuro NO se puede: el
 * `--imcrm-primary-foreground` del tema oscuro es tinta (texto oscuro sobre
 * el acento), así que un primary hondo (ej. un teal al 22% de lightness)
 * daría texto negro sobre fondo casi negro — ilegible. Se sube la lightness
 * a una banda legible conservando hue y saturación (la marca se reconoce
 * igual), y el riel se hunde en vez de encenderse.
 */
export function brandVars(triplet: string, theme: ResolvedTheme): Record<string, string> {
    const hsl = parseTriplet(triplet);
    if (!hsl) return {};
    const { h, s } = hsl;
    const sat = Math.min(s, 70);
    if (theme === 'dark') {
        // Banda 52-70%: contrasta con las superficies oscuras y deja que la
        // tinta del `primary-foreground` se lea encima.
        const l = Math.min(Math.max(hsl.l, 52), 70);
        return {
            '--imcrm-primary': `${h} ${Math.min(s, 85)}% ${l}%`,
            '--imcrm-ring': `${h} ${Math.min(s, 85)}% ${l}%`,
            // Riel: teñido pero HUNDIDO (en oscuro un riel a 30% sería el
            // elemento más brillante de la pantalla).
            '--imcrm-sidebar': `${h} ${sat}% 13%`,
            '--imcrm-sidebar-border': `${h} ${sat}% 19%`,
            '--imcrm-sidebar-accent': `${h} ${sat}% 21%`,
        };
    }
    return {
        '--imcrm-primary': triplet,
        '--imcrm-ring': triplet,
        // El riel toma el color de marca VIVO (estilo ClickUp: el riel ES el
        // color del tema, no una tinta imperceptible). Lightness fija ~30% →
        // texto blanco siempre contrasta, con cualquier hue.
        '--imcrm-sidebar': `${h} ${sat}% 30%`,
        '--imcrm-sidebar-border': `${h} ${sat}% 37%`,
        '--imcrm-sidebar-accent': `${h} ${sat}% 38%`,
    };
}

/** Query del branding del tenant activo (comparte cache con `useBranding`). */
export function useBrandingData() {
    const tenantId = useSession((s) => s.activeTenantId);
    // `activeTenantId` se persiste en localStorage: sin gate por usuario el
    // query dispararía ANTES de hidratar la sesión (401 + queda en error).
    const hasUser = useSession((s) => s.user !== null);
    const query = useQuery<BrandingResponse>({
        queryKey: brandingQueryKey(tenantId),
        queryFn: () => api.getBranding(),
        enabled: hasUser && tenantId !== null,
        staleTime: 60_000,
        retry: false,
    });
    // v0.1.104 — el formato regional viaja dentro del branding (todo miembro
    // lo trae al bootear). Se publica como estado de módulo: los helpers de
    // formateo (formatNumber/formatDateStr…) son funciones puras llamadas en
    // render sin acceso a hooks. Tolerante a respuestas cacheadas sin format.
    const format = query.data?.format;
    useEffect(() => {
        setTenantFormat(format ?? null);
    }, [format]);
    return query;
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
    // v0.1.112 — al cambiar de tema hay que RE-derivar los tokens de marca
    // (la fórmula es distinta en claro y en oscuro).
    const { resolved } = useTheme();

    useEffect(() => {
        const style = document.documentElement.style;
        const triplet = primaryColor !== null ? hexToHslTriplet(primaryColor) : null;
        const clear = (): void => {
            for (const name of BRANDED_VARS) style.removeProperty(name);
            for (const name of SIDEBAR_VARS) style.removeProperty(name);
        };
        if (triplet !== null) {
            for (const [name, value] of Object.entries(brandVars(triplet, resolved))) {
                style.setProperty(name, value);
            }
        } else {
            clear();
        }
        return clear;
    }, [primaryColor, resolved]);

    return query;
}
