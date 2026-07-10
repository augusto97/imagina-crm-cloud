import { useQuery } from '@tanstack/react-query';

import { FIELD_TYPE_CATALOG } from '@/lib/fieldTypeCatalog';
import type { FieldTypeMeta } from '@/types/field';

/**
 * Catálogo de tipos de campo. En cloud se resuelve del catálogo estático local
 * (ver `fieldTypeCatalog.ts`) — el endpoint WordPress `/field-types` no existe
 * en el backend NestJS y dejaba el dropdown vacío (no se podía crear campos).
 * Se mantiene como `useQuery` para no cambiar la firma que consumen los
 * componentes (`data`/`isLoading`).
 */
export function useFieldTypes() {
    return useQuery({
        queryKey: ['field-types'],
        queryFn: async (): Promise<FieldTypeMeta[]> => FIELD_TYPE_CATALOG,
        staleTime: Infinity, // Catálogo estático — nunca stale.
    });
}
