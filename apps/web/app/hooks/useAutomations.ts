import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { folderKey } from '@imagina-base/shared';
import type {
    AutomationFolderOp,
    AutomationFolders,
    AutomationTestRunInput,
    AutomationTestRunResult,
    AutomationVersion,
} from '@imagina-base/shared';

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
    /** v0.1.399 — qué haría el disparador con el registro si este dato llegara ahora. */
    match?: { kind: 'none' | 'found' | 'create' | 'not_found' | 'error'; message: string; record_id?: number | null; title?: string | null };
}

/** v0.1.399 — la búsqueda que se está editando (sin guardar), para la vista previa de las capturas. */
export interface HookMatchPreview {
    record_mode: string;
    match_by: 'record_id' | 'field';
    match_field?: string;
    match_key?: string;
}

/**
 * v0.1.111 — capturas de prueba del webhook entrante (últimos POST a la URL
 * pública). Con `listening` activo, el panel "Probar" del editor sondea cada
 * 3.5 s para mostrar el payload apenas llega (estilo Zapier).
 */
export function useHookCaptures(automationId: number | undefined, listening: boolean, preview?: HookMatchPreview) {
    const qs = preview
        ? `?${new URLSearchParams(
              Object.entries(preview).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''),
          ).toString()}`
        : '';
    return useQuery({
        queryKey: [...automationsKeys.all, 'hook-captures', String(automationId ?? 0), qs] as const,
        queryFn: async () => {
            const res = await api.get<HookCaptureEntity[]>(
                `/automations/${automationId}/hook-captures${qs}`,
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

/** v0.1.399 — el secreto opcional del webhook entrante (sólo se ve completo al crearlo). */
export function useHookSecret(automationId: number | undefined) {
    return useQuery({
        queryKey: [...automationsKeys.all, 'hook-secret', String(automationId ?? 0)] as const,
        queryFn: async () => (await api.get<{ enabled: boolean; hint: string | null }>(`/automations/${automationId}/hook-secret`)).data,
        enabled: automationId !== undefined && automationId > 0,
        retry: false,
    });
}

export function useSetHookSecret(automationId: number | undefined) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (secret?: string) =>
            (await api.post<{ secret: string; hint: string }>(`/automations/${automationId}/hook-secret`, secret ? { secret } : {})).data,
        onSuccess: (data) => {
            qc.setQueryData([...automationsKeys.all, 'hook-secret', String(automationId ?? 0)], { enabled: true, hint: data.hint });
        },
    });
}

export function useClearHookSecret(automationId: number | undefined) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => {
            await api.delete(`/automations/${automationId}/hook-secret`);
        },
        onSuccess: () => {
            qc.setQueryData([...automationsKeys.all, 'hook-secret', String(automationId ?? 0)], { enabled: false, hint: null });
        },
    });
}

/**
 * v0.1.411 — Carpetas del índice de automatizaciones de una lista (en su
 * orden). La clave cuelga de `forList` → `invalidateForList` también las
 * refresca.
 */
export function useAutomationFolders(listId: string | number | undefined) {
    return useQuery({
        queryKey: [...automationsKeys.forList(listId ?? ''), 'folders'] as const,
        queryFn: async () => {
            const res = await api.get<AutomationFolders>(`/lists/${listId}/automations/folders`);
            return res.data.folders;
        },
        enabled: listId !== undefined && listId !== '',
        staleTime: 60_000,
    });
}

/** Crear, renombrar, borrar u ordenar carpetas. */
export function useAutomationFolderOp(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (op: AutomationFolderOp) => {
            const res = await api.post<AutomationFolders>(`/lists/${listId}/automations/folders`, op);
            return res.data.folders;
        },
        onMutate: (op) => {
            // El orden se ve al instante; el resto espera la respuesta (puede fallar por un nombre repetido).
            if (op.op !== 'reorder') return;
            qc.setQueryData<string[]>([...automationsKeys.forList(listId), 'folders'], (old) => {
                if (!old) return old;
                const map = new Map(old.map((f) => [folderKey(f), f]));
                const out = op.order.map((n) => map.get(folderKey(n))).filter((f): f is string => f !== undefined);
                return [...out, ...old.filter((f) => !out.includes(f))];
            });
        },
        onSuccess: (folders) => {
            qc.setQueryData([...automationsKeys.forList(listId), 'folders'], folders);
            invalidateForList(qc, automationsKeys.all, listId);
        },
        onError: () => invalidateForList(qc, automationsKeys.all, listId),
    });
}

/** Mover una o varias a una carpeta (null = sin carpeta). Optimista. */
export function useMoveAutomations(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: { ids: number[]; folder: string | null }) => {
            const res = await api.post<AutomationFolders & { moved: number }>(`/lists/${listId}/automations/move`, input);
            return res.data;
        },
        onMutate: async (input) => {
            const key = automationsKeys.forList(listId);
            await qc.cancelQueries({ queryKey: key, exact: true });
            const prev = qc.getQueryData<AutomationEntity[]>(key);
            const folders = qc.getQueryData<string[]>([...key, 'folders']) ?? [];
            const name = input.folder === null ? null : (folders.find((f) => folderKey(f) === folderKey(input.folder!)) ?? input.folder.trim());
            const ids = new Set(input.ids);
            qc.setQueryData<AutomationEntity[]>(key, (old) => old?.map((a) => (ids.has(a.id) ? { ...a, folder: name } : a)));
            return { prev };
        },
        onError: (_err, _input, ctx) => {
            if (ctx?.prev) qc.setQueryData(automationsKeys.forList(listId), ctx.prev);
        },
        onSuccess: (data) => {
            qc.setQueryData([...automationsKeys.forList(listId), 'folders'], data.folders);
        },
        onSettled: () => invalidateForList(qc, automationsKeys.all, listId),
    });
}
