import type { RecordDependencies } from '@imagina-base/shared';

import { api } from '@/lib/api';

/**
 * A8 — Keys de las dependencias. Cuelgan de `['records', listId, …]` (el
 * namespace de los registros): cualquier cambio de registros de la lista
 * (edición, realtime, otra pestaña) las refresca. Módulo sin dependencias de
 * los hooks de registros, así la guarda de cierre lo puede usar desde
 * `useUpdateRecord` sin ciclos de import.
 */
export const dependencyKeys = {
    forRecord: (listId: string | number, recordId: number) => ['records', String(listId), 'dependencies', recordId] as const,
    settings: (listId: string | number) => ['records', String(listId), 'dependency-settings'] as const,
};

export async function fetchRecordDependencies(listId: string | number, recordId: number): Promise<RecordDependencies> {
    return (await api.get<RecordDependencies>(`/lists/${listId}/records/${recordId}/dependencies`)).data;
}
