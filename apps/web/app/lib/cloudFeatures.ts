/**
 * Módulos heredados del fork cuyo backend en Imagina Base aún no existe.
 * Mientras estén en `false`, su UI se oculta para no mostrar secciones rotas
 * (el fork las expone todas por herencia del plugin, donde sí existían).
 * Al implementar el módulo en el API, se pone en `true` y su UI aparece.
 */
export const CLOUD_WIRED = {
    dashboards: true,
    automations: true,
    aggregates: true,
    mentions: true,
    recurrences: true,
} as const;

/** ¿Se debe mostrar este módulo? Sólo si su backend ya está cableado. */
export function moduleEnabled(key: keyof typeof CLOUD_WIRED): boolean {
    return CLOUD_WIRED[key];
}
