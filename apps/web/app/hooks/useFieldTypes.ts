import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { FieldTypeMeta } from '@/types/field';

export function useFieldTypes() {
    return useQuery({
        queryKey: ['field-types'],
        queryFn: async () => {
            const res = await api.get<FieldTypeMeta[]>('/field-types');
            return res.data;
        },
        staleTime: 60 * 60_000, // El catálogo no cambia casi nunca.
    });
}
