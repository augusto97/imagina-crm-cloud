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
};

export function getBootData(): BootData {
    return window.IMAGINA_CRM_BOOT ?? FALLBACK;
}
