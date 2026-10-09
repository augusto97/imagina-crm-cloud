import { createContext, useContext } from 'react';

import type { RelationTitles } from '@/hooks/useRelationTitles';

/**
 * Títulos de los registros vinculados de la página visible, por campo
 * relation (v0.1.209). La tabla los resuelve UNA vez por columna
 * (`useRelationTitlesForRows`) y cada celda los lee de aquí — así una página de
 * 50 filas no dispara 50 requests. Mismo criterio que `WrapTextContext`.
 */
export const RelationTitlesContext = createContext<Map<number, RelationTitles>>(new Map());

export function useRelationTitlesFor(fieldId: number): RelationTitles | undefined {
    return useContext(RelationTitlesContext).get(fieldId);
}
