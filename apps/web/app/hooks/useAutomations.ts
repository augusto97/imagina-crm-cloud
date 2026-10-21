import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AutomationTestRunInput, AutomationTestRunResult, AutomationVersion } from '@imagina-base/shared';

import { api } from '@/lib/api';
import { invalidateForList } from '@/hooks/useRecords';
import type {
    ActionMeta,
    AutomationEntity,
    AutomationRunEntity,
    CreateAutomationInput,
    TriggerMeta,
    UpdateAutomationInput,
} from '@/types/automation';

export const automationsKeys = {
    all: ['automations'] as const,
    // El identificador va en el índice 1 (igual que records/fields):
    // el segmento 'list' extra corría el id al índice 2 y
    // `invalidateForList` —que matchea el índice 1— NUNCA invalidaba →
    // la página de automatizaciones no mostraba altas/cambios sin
    // recargar (misma clase de bug que fieldsKeys, ya documentada ahí).
    forList: (listId: string | number) =>
        [...automationsKeys.all, String(listId)] as const,
    runs: (automationId: number) =>
        [...automationsKeys.all, 'runs', String(automationId)] as const,
    triggers: ['automations', 'triggers'] as const,
    actions: ['automations', 'actions'] as const,
};

export function useAutomations(listId: string | number | undefined) {
    return useQuery({
        queryKey: automationsKeys.forList(listId ?? ''),
        queryFn: async () => {
            const res = await api.get<AutomationEntity[]>(`/lists/${listId}/automations`);
            return res.data;
        },
        enabled: listId !== undefined && listId !== '',
        staleTime: 60_000, // Fase 16.D
    });
}

export function useCreateAutomation(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateAutomationInput) => {
            const res = await api.post<AutomationEntity>(
                `/lists/${listId}/automations`,
                input,
            );
            return res.data;
        },
        onSuccess: () => {
            // 0.57.41 — scope a id+slug de la lista.
            invalidateForList(qc, automationsKeys.all, listId);
        },
    });
}

export function useUpdateAutomation(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, input }: { id: number; input: UpdateAutomationInput }) => {
            const res = await api.patch<AutomationEntity>(
                `/lists/${listId}/automations/${id}`,
                input,
            );
            return res.data;
        },
        onSuccess: () => {
            // 0.57.41 — scope a id+slug de la lista.
            invalidateForList(qc, automationsKeys.all, listId);
        },
    });
}

export function useDeleteAutomation(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/lists/${listId}/automations/${id}`);
        },
        onSuccess: () => {
            // 0.57.41 — scope a id+slug de la lista.
            invalidateForList(qc, automationsKeys.all, listId);
        },
    });
}

export function useTriggerCatalog() {
    return useQuery({
        queryKey: automationsKeys.triggers,
        queryFn: async () => {
            const res = await api.get<TriggerMeta[]>('/triggers');
            return res.data;
        },
        staleTime: 5 * 60 * 1000,
    });
}

export function useActionCatalog() {
    return useQuery({
        queryKey: automationsKeys.actions,
        queryFn: async () => {
            const res = await api.get<ActionMeta[]>('/actions');
            return res.data;
        },
        staleTime: 5 * 60 * 1000,
        // v0.1.203 — «Conectar otra app» abre Ajustes en otra pestaña: al
        // volver, las acciones de la app recién conectada tienen que aparecer
        // sin recargar el editor (el default global no refresca al enfocar).
        refetchOnWindowFocus: 'always',
    });
}

export interface HookCaptureEntity {
    payload: Record<string, unknown>;
    received_at: string;
}

/**
 * v0.1.111 — capturas de prueba del webhook entrante (últimos POST a la URL
 * pública). Con `listening` activo, el panel "Probar" del editor sondea cada
 * 3.5 s para mostrar el payload apenas llega (estilo Zapier).
 */
export function useHookCaptures(automationId: number | undefined, listening: boolean) {
    return useQuery({
        queryKey: [...automationsKeys.all, 'hook-captures', String(automationId ?? 0)] as const,
        queryFn: async () => {
            const res = await api.get<HookCaptureEntity[]>(
                `/automations/${automationId}/hook-captures`,
            );
            return res.data;
        },
        enabled: automationId !== undefined && automationId > 0,
        refetchInterval: listening ? 3500 : false,
        staleTime: 0,
    });
}

/**
 * Historial de corridas, de a 50 (el endpoint pagina por cursor). Antes se
 * mostraban sólo las primeras 50 y el resto no se podía ver.
 */
export function useAutomationRuns(automationId: number | undefined) {
    return useInfiniteQuery({
        queryKey: automationsKeys.runs(automationId ?? 0),
        initialPageParam: null as string | null,
        queryFn: async ({ pageParam }) => {
            const qs = pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : '';
            const res = await api.get<AutomationRunEntity[]>(`/automations/${automationId}/runs${qs}`);
            const next = (res.meta as { next_cursor?: unknown } | undefined)?.next_cursor;
            return { runs: res.data, next: typeof next === 'string' && next !== '' ? next : null };
        },
        getNextPageParam: (last) => last.next,
        select: (data) => data.pages.flatMap((p) => p.runs),
        enabled: automationId !== undefined && automationId > 0,
    });
}

/** v0.1.288 — Duplicar: copia pausada «Nombre (copia)», sin el token del webhook. */
export function useDuplicateAutomation(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            const res = await api.post<AutomationEntity>(`/lists/${listId}/automations/${id}/duplicate`, {});
            return res.data;
        },
        onSuccess: () => {
            invalidateForList(qc, automationsKeys.all, listId);
        },
    });
}

/** v0.1.288 — Historial de versiones (la más nueva primero, hasta 50). */
export function useAutomationVersions(listId: string | number, automationId: number | undefined, enabled: boolean) {
    return useQuery({
        queryKey: [...automationsKeys.all, 'versions', String(automationId ?? 0)] as const,
        queryFn: async () => {
            const res = await api.get<AutomationVersion[]>(`/lists/${listId}/automations/${automationId}/versions`);
            return res.data;
        },
        enabled: enabled && automationId !== undefined && automationId > 0,
        staleTime: 0,
    });
}

/** v0.1.288 — Cancelar una corrida que está en un «Esperar». */
export function useCancelWaitingRun(automationId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (runId: number) => {
            const res = await api.post<{ cancelled: boolean }>(`/automations/${automationId}/runs/${runId}/cancel`, {});
            return res.data;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: automationsKeys.runs(automationId) });
            void qc.invalidateQueries({ queryKey: automationsKeys.all });
        },
    });
}

/**
 * v0.1.288 — «Probar» paso a paso: corre la automatización tal como se está
 * editando (sin guardar) contra un registro real, en modo simulación.
 */
export function useAutomationTestRun(listId: string | number) {
    return useMutation({
        mutationFn: async (input: AutomationTestRunInput) => {
            const res = await api.post<AutomationTestRunResult>(`/lists/${listId}/automations/test-run`, input);
            return res.data;
        },
    });
}
