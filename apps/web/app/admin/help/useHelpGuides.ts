import { useMemo } from 'react';

import { useSystemGuides } from './guideCatalog';
import { visibleGuides, type VisibleGuide } from './guideAccess';
import { useHelpConfig, useHelpViewer } from './useHelpData';

/**
 * Las guías que ve esta persona: las del sistema (a pedido) + las del
 * operador, filtradas por su rol. `null` mientras carga el catálogo.
 */
export function useHelpGuides(enabled = true): VisibleGuide[] | null {
    const viewer = useHelpViewer();
    const system = useSystemGuides(enabled && !viewer.isGuest);
    const config = useHelpConfig(enabled && !viewer.isGuest);
    return useMemo(() => (system ? visibleGuides(system, config, viewer) : null), [system, config, viewer]);
}
