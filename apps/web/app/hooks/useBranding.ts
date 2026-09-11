import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BrandingResponse } from '@imagina-base/shared';

import { api, useSession } from '@/cloud/session';
import { applyDocumentTitle, applyFavicon } from '@/lib/favicon';
import { setTenantFormat } from '@/lib/tenantFormat';
import { useTheme, type ResolvedTheme } from '@/lib/theme';

/**
 * Branding white-label por workspace: `GET /workspaces/current/branding`.
 *
 * - `useBrandingData()` — sólo el query (lo consume el Sidebar y el panel de
 *   Ajustes). QueryKey por tenant activo NUMÉRICO (regla de oro §3.7): al
 *   cambiar de workspace se refetchea el branding del nuevo tenant.
 * - `useBranding()` — query + efecto que APLICA `primary_color` (y, desde
 *   v0.1.176, `sidebar_color`) a los tokens del tema (CSS variables en
 *   `:root`). Montarlo UNA sola vez (en `AdminCloudApp`); el resto de la app
 *   lee del query cache vía `useBrandingData()`.
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
 * v0.1.176 — con un color de riel PROPIO la tinta también se deriva (clara
 * sobre riel oscuro, oscura sobre riel claro). Sólo se tocan cuando hay
 * `sidebar_color`; si el riel sigue al primario, el CSS del tema manda.
 */
const SIDEBAR_INK_VARS = ['--imcrm-sidebar-foreground', '--imcrm-sidebar-accent-foreground'] as const;

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

type Hsl = { h: number; s: number; l: number };

/** Parte una tripleta `"H S% L%"` en números (o null si no matchea). */
function parseTriplet(triplet: string): Hsl | null {
    const m = /^(\d+)\s+(\d+)%\s+(\d+)%$/.exec(triplet);
    if (!m) return null;
    return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

/**
 * Luminancia relativa (0-1, WCAG) de una tripleta HSL. Decide si sobre el
 * riel va tinta clara u oscura. Se calcula desde HSL (y no desde la L a
 * secas) porque un amarillo al 50% de lightness es MUCHO más brillante que
 * un azul al 50%: la L engaña, la luminancia no.
 */
function tripletLuminance({ h, s, l }: Hsl): number {
    const sat = s / 100;
    const light = l / 100;
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    if (hp < 1) [r, g, b] = [c, x, 0];
    else if (hp < 2) [r, g, b] = [x, c, 0];
    else if (hp < 3) [r, g, b] = [0, c, x];
    else if (hp < 4) [r, g, b] = [0, x, c];
    else if (hp < 5) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const m = light - c / 2;
    const lin = (v: number): number => {
        const ch = v + m;
        return ch <= 0.03928 ? ch / 12.92 : ((ch + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const clampL = (l: number): number => Math.min(Math.max(Math.round(l), 0), 100);

/**
 * v0.1.176 — Tokens del riel para un color de fondo ELEGIDO (independiente
 * del primario). El color se respeta tal cual en los dos temas: es una
 * elección explícita del tenant, no una derivación (a diferencia del riel
 * que sigue al primario, que en oscuro se hunde). Lo que sí se deriva es
 * todo lo que va ENCIMA: borde y velo de hover un escalón más claros u
 * oscuros según el fondo, y la tinta por luminancia — un gris claro lleva
 * texto oscuro; un gris carbón, texto claro. El velo del item activo
 * (`bg-sidebar-foreground/10`) sale de esa misma tinta, así también se ve
 * en las dos direcciones.
 */
export function sidebarVars(triplet: string): Record<string, string> {
    const hsl = parseTriplet(triplet);
    if (!hsl) return {};
    const { h, s, l } = hsl;
    const light = tripletLuminance(hsl) > 0.45;
    if (light) {
        return {
            '--imcrm-sidebar': `${h} ${s}% ${l}%`,
            '--imcrm-sidebar-border': `${h} ${s}% ${clampL(l - 9)}%`,
            '--imcrm-sidebar-accent': `${h} ${s}% ${clampL(l - 7)}%`,
            '--imcrm-sidebar-foreground': `${h} ${Math.min(s, 30)}% 24%`,
            '--imcrm-sidebar-accent-foreground': `${h} ${Math.min(s, 40)}% 8%`,
        };
    }
    return {
        '--imcrm-sidebar': `${h} ${s}% ${l}%`,
        '--imcrm-sidebar-border': `${h} ${s}% ${clampL(l + 7)}%`,
        '--imcrm-sidebar-accent': `${h} ${s}% ${clampL(l + 8)}%`,
        '--imcrm-sidebar-foreground': `${h} ${Math.min(s, 25)}% 88%`,
        '--imcrm-sidebar-accent-foreground': '0 0% 100%',
    };
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
 *
 * v0.1.176 — `sidebar` (tripleta opcional): con un color de riel propio, el
 * riel deja de seguir al primario y toma ese color (ver `sidebarVars`). Se
 * puede pasar sin primario: el primario queda el del tema y sólo se pinta
 * el riel.
 */
export function brandVars(
    triplet: string | null,
    theme: ResolvedTheme,
    sidebar: string | null = null,
): Record<string, string> {
    const hsl = triplet !== null ? parseTriplet(triplet) : null;
    const own = sidebar !== null ? sidebarVars(sidebar) : {};
    if (!hsl) return own;
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
            ...own,
        };
    }
    return {
        '--imcrm-primary': triplet as string,
        '--imcrm-ring': triplet as string,
        // El riel toma el color de marca VIVO (estilo ClickUp: el riel ES el
        // color del tema, no una tinta imperceptible). Lightness fija ~30% →
        // texto blanco siempre contrasta, con cualquier hue.
        '--imcrm-sidebar': `${h} ${sat}% 30%`,
        '--imcrm-sidebar-border': `${h} ${sat}% 37%`,
        '--imcrm-sidebar-accent': `${h} ${sat}% 38%`,
        ...own,
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
 *
 * v0.1.176 — `sidebar_color` (riel independiente) sólo viene del branding
 * del tenant activo: en el login no hay riel, así que el boot público no lo
 * necesita.
 */
export function useBranding() {
    const query = useBrandingData();
    const domainColor = useSession((s) => s.domainTenant?.primary_color ?? null);
    const primaryColor = query.data !== undefined ? (query.data.primary_color ?? null) : domainColor;
    const sidebarColor = query.data !== undefined ? (query.data.sidebar_color ?? null) : null;
    // v0.1.112 — al cambiar de tema hay que RE-derivar los tokens de marca
    // (la fórmula es distinta en claro y en oscuro).
    const { resolved } = useTheme();

    useEffect(() => {
        const style = document.documentElement.style;
        const triplet = primaryColor !== null ? hexToHslTriplet(primaryColor) : null;
        const sidebarTriplet = sidebarColor !== null ? hexToHslTriplet(sidebarColor) : null;
        const clear = (): void => {
            for (const name of BRANDED_VARS) style.removeProperty(name);
            for (const name of SIDEBAR_VARS) style.removeProperty(name);
            for (const name of SIDEBAR_INK_VARS) style.removeProperty(name);
        };
        // Limpiar SIEMPRE antes de aplicar: si el tenant quita el color del
        // riel, las variables de tinta deben volver al tema (no quedar
        // colgadas del color anterior).
        clear();
        if (triplet !== null || sidebarTriplet !== null) {
            for (const [name, value] of Object.entries(brandVars(triplet, resolved, sidebarTriplet))) {
                style.setProperty(name, value);
            }
        }
        return clear;
    }, [primaryColor, sidebarColor, resolved]);

    // v0.1.177 — favicon y título de la pestaña con la marca del tenant (logo
    // por URL firmada + app_name). Pre-login manda el tenant del dominio, con
    // sesión el branding del workspace activo; sin logo vuelve el icono de la
    // app (así cambiar de workspace nunca deja el logo del anterior).
    const domainLogo = useSession((s) => s.domainTenant?.logo_url ?? null);
    const domainName = useSession((s) => s.domainTenant?.app_name ?? null);
    const logoUrl = query.data !== undefined ? (query.data.logo_url ?? null) : domainLogo;
    const appName = query.data !== undefined ? (query.data.app_name ?? null) : domainName;
    useEffect(() => {
        applyFavicon(logoUrl);
        applyDocumentTitle(appName);
    }, [logoUrl, appName]);

    return query;
}
