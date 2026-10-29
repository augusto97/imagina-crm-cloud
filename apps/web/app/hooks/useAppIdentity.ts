import { useSession } from '@/cloud/session';
import { useBrandingData } from '@/hooks/useBranding';

/**
 * v0.1.327 — Con qué nombre y qué imagen se presenta la app en ESTA pantalla.
 *
 * Manda la empresa: su logo y nombre de app (Ajustes → Marca) dentro de la
 * app, o los del dominio propio por el que se entró (white-label). Si no, la
 * marca de la PLATAFORMA (Plataforma → Marca) — pero nunca en el dominio de
 * una empresa: ahí el cliente de la empresa no tiene por qué ver al operador.
 * Sin nada subido, sólo el nombre: la app no inventa un logo.
 */
export interface AppIdentity {
    /** Nombre a mostrar (app de la empresa, empresa del dominio o plataforma). */
    name: string;
    /** Logo horizontal (login, arranque). */
    logoUrl: string | null;
    /**
     * El logo para modo oscuro: el de la empresa sirve en los dos; el de la
     * plataforma sólo si subió una versión para fondos oscuros (si no, se
     * muestra el nombre: un logo oscuro sobre fondo oscuro no se lee).
     */
    logoDarkUrl: string | null;
    /** Imagen cuadrada (riel, barra del celular): logo de la empresa o ícono de la plataforma. */
    markUrl: string | null;
    /** Se entró por el dominio de una empresa. */
    whiteLabel: boolean;
    /**
     * v0.1.331 — el sitio del producto (Plataforma → Marca). Nunca en el
     * dominio de una empresa: ahí la app es de ella.
     */
    marketingUrl: string | null;
}

export function useAppIdentity(opts: { workspaceName?: string | null } = {}): AppIdentity {
    const branding = useBrandingData();
    const domainTenant = useSession((s) => s.domainTenant);
    const platform = useSession((s) => s.platformBrand);
    const whiteLabel = domainTenant !== null;
    const tenantLogo = branding.data !== undefined ? (branding.data.logo_url ?? null) : (domainTenant?.logo_url ?? null);
    const tenantAppName = branding.data !== undefined ? (branding.data.app_name ?? null) : (domainTenant?.app_name ?? null);
    const platformName = platform.app_name;
    const name =
        tenantAppName?.trim() ||
        opts.workspaceName?.trim() ||
        (whiteLabel ? domainTenant?.name?.trim() : null) ||
        platformName;
    const platformLogo = whiteLabel ? null : platform.logo_url;
    return {
        name,
        logoUrl: tenantLogo ?? platformLogo,
        logoDarkUrl: tenantLogo ?? (whiteLabel ? null : platform.logo_dark_url),
        markUrl: tenantLogo ?? (whiteLabel ? null : (platform.icons?.icon_192 ?? null)),
        whiteLabel,
        marketingUrl: whiteLabel ? null : platform.marketing_url,
    };
}

/** Iniciales de un nombre («Acme Gestión» → «AG»), para cuando no hay imagen. */
export function brandInitials(name: string): string {
    const words = name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean);
    const letters = words.length >= 2 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? '?').slice(0, 2);
    return letters.toUpperCase();
}
