import { createContext, useContext } from 'react';

/**
 * Context que indica si los bloques del portal se están renderizando
 * dentro del editor del admin (preview) o en el frontend real.
 *
 * Cuando está en `true`, los bloques que normalmente hacen fetch a
 * la REST API (kpi, activity, downloads, comments, related, stats)
 * deben renderizar **datos mock** en lugar de llamar al backend.
 * Esto permite que el preview del editor sea pixel-identical al
 * front sin depender del estado real de la base de datos ni de
 * que las APIs estén disponibles en el contexto del admin.
 *
 * Default: `false` — comportamiento normal del portal.
 */
export const PortalPreviewContext = createContext<boolean>(false);

export function usePortalPreview(): boolean {
    return useContext(PortalPreviewContext);
}
