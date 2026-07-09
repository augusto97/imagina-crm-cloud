import { getBootData } from './boot';

/**
 * Módulos cuya integración con el backend NestJS (Imagina Base) YA está
 * cableada. A medida que se conectan de verdad, se ponen en `true` y su UI
 * aparece. Mientras estén en `false`, la UI del módulo se oculta en la nube
 * para no mostrar secciones rotas (el fork las expone todas por herencia del
 * plugin WordPress, donde sí existían).
 */
export const CLOUD_WIRED = {
    dashboards: true,
    automations: true,
    aggregates: true,
    mentions: false,
    recurrences: false,
} as const;

export function isCloud(): boolean {
    return getBootData().cloud;
}

/**
 * ¿Se debe mostrar este módulo? En WordPress (no-cloud) siempre sí; en la nube
 * solo si ya está cableado al backend nuevo.
 */
export function moduleEnabled(key: keyof typeof CLOUD_WIRED): boolean {
    return !isCloud() || CLOUD_WIRED[key];
}
