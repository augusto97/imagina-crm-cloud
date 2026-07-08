export type BootUser = {
    id: number;
    displayName: string;
    avatar: string;
    capabilities: Record<string, boolean>;
};

export type BootData = {
    version: string;
    rootId: string;
    restRoot: string;
    restNonce: string;
    adminUrl: string;
    assetsUrl: string;
    locale: string;
    timezone: string;
    user: BootUser;
    /**
     * Modo nube (Imagina Base): la app corre standalone contra el backend
     * NestJS (`/api/v1`, cookie de sesión + `X-Tenant-Id`) en vez del plugin
     * WordPress (`/wp-json`, nonce). Gatea las adaptaciones de shape en
     * `lib/api.ts` para no alterar el build WP.
     */
    cloud: boolean;
    /** Workspace activo (se envía como header `X-Tenant-Id`). Solo en cloud. */
    tenantId: number | null;
};

declare global {
    interface Window {
        IMAGINA_CRM_BOOT?: BootData;
    }
}

const FALLBACK: BootData = {
    version: '0.0.0',
    rootId: 'imcrm-root',
    restRoot: '/wp-json/imagina-crm/v1',
    restNonce: '',
    adminUrl: '',
    assetsUrl: '',
    locale: 'en-US',
    timezone: 'UTC',
    user: {
        id: 0,
        displayName: '',
        avatar: '',
        capabilities: {},
    },
    cloud: false,
    tenantId: null,
};

/**
 * Estado runtime del boot en modo nube. En el plugin WordPress el boot llega
 * inyectado en `window.IMAGINA_CRM_BOOT` (síncrono, ya autenticado); en la
 * nube no existe ese global — lo poblamos tras el login (`setBootData`).
 */
let runtime: BootData = { ...FALLBACK };

export function getBootData(): BootData {
    // El plugin WP inyecta el global; tiene prioridad. En la nube usamos el
    // store runtime que hidrata el gate de sesión.
    return window.IMAGINA_CRM_BOOT ?? runtime;
}

/** Hidrata (parcial) el boot runtime. Usado por el gate de sesión de la nube. */
export function setBootData(patch: Partial<BootData>): void {
    runtime = { ...runtime, ...patch };
}

/** Cambia el workspace activo (header `X-Tenant-Id`). */
export function setBootTenant(tenantId: number | null): void {
    runtime = { ...runtime, tenantId };
}
