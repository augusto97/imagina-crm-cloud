export type BootUser = {
    id: number;
    displayName: string;
    avatar: string;
    capabilities: Record<string, boolean>;
};

/**
 * Boot runtime de Imagina Base. Se puebla tras el login (gate de sesión →
 * `hydrateAdminBoot`) — no existe ningún global inyectado por el servidor.
 * La app corre SIEMPRE contra el backend NestJS (`/api/v1`, cookie de sesión
 * + header `X-Tenant-Id`); el modo dual con el plugin WordPress se eliminó.
 */
export type BootData = {
    version: string;
    /** Raíz del API NestJS (mismo origen). */
    restRoot: string;
    user: BootUser;
    /** Workspace activo (se envía como header `X-Tenant-Id`). */
    tenantId: number | null;
};

const FALLBACK: BootData = {
    version: '0.0.0',
    restRoot: '/api/v1',
    user: {
        id: 0,
        displayName: '',
        avatar: '',
        capabilities: {},
    },
    tenantId: null,
};

let runtime: BootData = { ...FALLBACK };

export function getBootData(): BootData {
    return runtime;
}

/** Hidrata (parcial) el boot runtime. Usado por el gate de sesión. */
export function setBootData(patch: Partial<BootData>): void {
    runtime = { ...runtime, ...patch };
}

/** Cambia el workspace activo (header `X-Tenant-Id`). */
export function setBootTenant(tenantId: number | null): void {
    runtime = { ...runtime, tenantId };
}
