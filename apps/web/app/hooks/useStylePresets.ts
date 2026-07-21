import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { BlockStyle } from '@/lib/blockStyle';

/**
 * v0.1.94 — Presets de estilo de marca del workspace, compartidos por
 * los dos editores de plantilla (registro + portal). El PATCH reemplaza
 * la lista completa; guardarlos exige admin/manager (el GET es libre).
 */

export interface StylePreset {
    name: string;
    style: BlockStyle;
}

const KEY = ['style-presets'] as const;

export function useStylePresets() {
    return useQuery({
        queryKey: KEY,
        queryFn: async (): Promise<StylePreset[]> => {
            const res = await api.get<{ presets: StylePreset[] }>('/workspaces/current/style-presets');
            return (res.data as unknown as { presets: StylePreset[] }).presets ?? [];
        },
        staleTime: 60_000,
    });
}

export function useSaveStylePresets() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (presets: StylePreset[]): Promise<StylePreset[]> => {
            const res = await api.patch<{ presets: StylePreset[] }>(
                '/workspaces/current/style-presets',
                { presets },
            );
            return (res.data as unknown as { presets: StylePreset[] }).presets ?? presets;
        },
        onSuccess: (presets) => {
            qc.setQueryData(KEY, presets);
        },
    });
}
