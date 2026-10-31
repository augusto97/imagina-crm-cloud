import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    FILE_IMPORT_CONTENT_TYPE,
    type FileImportAiJob,
    type FileImportAnalysis,
    type FileImportAnalyzeInput,
    type FileImportApplyInput,
    type FileImportApplyResult,
} from '@imagina-base/shared';

import { api } from '@/lib/api';

import { listGroupsKeys } from './useListGroups';
import { listsKeys, trackLocalListsChange } from './useLists';
import { onboardingKeys } from './useOnboarding';

/**
 * v0.1.339 (ADR-S88) — «Crear desde un archivo»: analizar (reglas), afinar
 * con IA (en segundo plano, se pregunta cada poco) y crear. Las hojas viajan
 * con el tipo de contenido propio: esas rutas aceptan un cuerpo más grande
 * que el resto del API.
 */
export const fileImportKeys = {
    all: ['file-import'] as const,
    ai: (id: string) => ['file-import', 'ai', id] as const,
};

export function useAnalyzeFile() {
    return useMutation({
        mutationFn: async (input: FileImportAnalyzeInput) =>
            (await api.post<FileImportAnalysis>('/file-import/analyze', input, { contentType: FILE_IMPORT_CONTENT_TYPE })).data,
    });
}

export function useStartFileImportAi() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => (await api.post<FileImportAiJob>(`/file-import/${id}/ai`, { consent: true })).data,
        onSuccess: (job, id) => qc.setQueryData(fileImportKeys.ai(id), job),
    });
}

/** El análisis con IA en curso: se pregunta cada 1,5 s hasta que termina. */
export function useFileImportAiJob(id: string | null, enabled: boolean) {
    return useQuery({
        queryKey: fileImportKeys.ai(id ?? ''),
        queryFn: async () => (await api.get<FileImportAiJob>(`/file-import/${id}/ai`)).data,
        enabled: enabled && id !== null,
        refetchInterval: (q) => (q.state.data?.state === 'running' ? 1500 : false),
        staleTime: 0,
    });
}

export function useApplyFileImport() {
    const qc = useQueryClient();
    return useMutation({
        // Las listas nuevas las creo yo: el aviso de realtime no tiene que repetir la recarga.
        mutationFn: (input: FileImportApplyInput) =>
            trackLocalListsChange(api.post<FileImportApplyResult>('/file-import/apply', input, { contentType: FILE_IMPORT_CONTENT_TYPE }).then((r) => r.data)),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: listsKeys.all });
            void qc.invalidateQueries({ queryKey: listGroupsKeys.all });
            void qc.invalidateQueries({ queryKey: onboardingKeys.all });
        },
    });
}
