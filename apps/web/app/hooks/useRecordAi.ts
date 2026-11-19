import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    AgentBatchDto,
    AgentBatchPreview,
    AgentBatchPreviewInput,
    AgentBatchStartInput,
    AiStatus,
    RecordAgentOption,
    RecordAgentRunDto,
    RecordAiReplyInput,
    RecordAiSummary,
    RecordAiTextResult,
    RecordAiWriteInput,
} from '@imagina-base/shared';

import { api as cloud, useSession } from '@/cloud/session';
import { ApiError, api } from '@/lib/api';
import { invalidateForList, recordsKeys } from '@/hooks/useRecords';
import { recordViewKeys } from '@/hooks/useRecordView';

/**
 * v0.1.456 (ADR-S109) — La IA en el día a día desde la ficha: el resumen,
 * escribir con IA, sugerir respuestas y pedirle a un agente (uno o en lote).
 * Las keys llevan el ID numérico de la lista en el índice 1 (regla de oro nº 7).
 */
export const recordAiKeys = {
    agents: (listId: number, recordId: number) => ['records', String(listId), 'ai-agents-ask', recordId] as const,
    // Fuera de `records`: al terminar, la corrida y el lote refrescan los
    // registros de la lista, y si su propia key estuviera adentro se volverían
    // a pedir solas.
    run: (listId: number, recordId: number, runId: number) => ['ai-assist', 'run', listId, recordId, runId] as const,
    batch: (listId: number, batchId: number) => ['ai-assist', 'batch', listId, batchId] as const,
    summary: (listId: number, recordId: number) => ['ai-assist', 'summary', listId, recordId] as const,
};

/** El mismo estado de la IA que usa el asistente (misma key: una sola consulta). */
export function useAiStatus(enabled = true) {
    const tenantId = useSession((s) => s.activeTenantId);
    return useQuery<AiStatus>({
        queryKey: ['ai-status', tenantId],
        queryFn: () => cloud.aiStatus(),
        enabled: enabled && tenantId !== null,
        retry: false,
        staleTime: 30_000,
    });
}

/** El motivo legible de un error de la IA (sin IA, cuota, permiso, proveedor). */
export function aiErrorText(err: unknown): string {
    if (err instanceof ApiError) return err.message || 'La IA no respondió.';
    if (err instanceof Error) return err.message;
    return 'La IA no respondió.';
}

/**
 * El resumen del registro. Se pide sólo al tocar «Resumir con IA» (cada pedido
 * sin caché gasta uno de la cuota); el último queda en memoria para cuando se
 * vuelve a abrir la ficha.
 */
export function useRecordAiSummary(listId: number, recordId: number) {
    const qc = useQueryClient();
    const key = recordAiKeys.summary(listId, recordId);
    const last = useQuery<RecordAiSummary | null>({
        queryKey: key,
        queryFn: () => qc.getQueryData<RecordAiSummary>(key) ?? null,
        enabled: false,
        staleTime: Infinity,
        gcTime: 30 * 60_000,
    });
    const ask = useMutation({
        mutationFn: async (refresh: boolean) => (await api.post<RecordAiSummary>(`/lists/${listId}/records/${recordId}/ai/summary`, { refresh })).data,
        onSuccess: (data) => qc.setQueryData(key, data),
    });
    return { summary: last.data ?? null, ask };
}

/** Escribir con IA en la descripción (`listKey`: id o slug — el servidor resuelve ambos). */
export function useRecordAiWrite(listKey: string | number, recordId: number) {
    return useMutation({
        mutationFn: async (input: RecordAiWriteInput) =>
            (await api.post<RecordAiTextResult>(`/lists/${encodeURIComponent(String(listKey))}/records/${recordId}/ai/write`, input)).data,
    });
}

/** «Sugerir respuesta» en la caja de comentarios: un borrador que la persona revisa. */
export function useRecordAiReply(listId: number, recordId: number) {
    return useMutation({
        mutationFn: async (input: Partial<RecordAiReplyInput>) => (await api.post<RecordAiTextResult>(`/lists/${listId}/records/${recordId}/ai/reply`, input)).data,
    });
}

// ── Pedir al agente ──────────────────────────────────────────────────────

export interface RecordAgentsState {
    agents: RecordAgentOption[];
    runs: RecordAgentRunDto[];
    can_ask: boolean;
}

export function useRecordAgents(listId: number, recordId: number, enabled = true) {
    return useQuery({
        queryKey: recordAiKeys.agents(listId, recordId),
        queryFn: async () => (await api.get<RecordAgentsState>(`/lists/${listId}/records/${recordId}/agents`)).data,
        enabled: enabled && listId > 0 && recordId > 0,
        staleTime: 30_000,
        retry: false,
    });
}

export function useAskRecordAgent(listId: number, recordId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: { agent_id: number; instruction: string }) =>
            (await api.post<RecordAgentRunDto>(`/lists/${listId}/records/${recordId}/agent-runs`, input)).data,
        onSuccess: (run) => {
            qc.setQueryData(recordAiKeys.run(listId, recordId, run.id), run);
            void qc.invalidateQueries({ queryKey: recordAiKeys.agents(listId, recordId) });
        },
    });
}

const RUNNING: ReadonlySet<string> = new Set(['queued', 'running']);

/**
 * El estado de una corrida, preguntado cada 2 s mientras espera o trabaja.
 * Al terminar refresca el registro (cambios hechos, propuesta nueva).
 */
export function useRecordAgentRun(listId: number, recordId: number, runId: number | null, initial?: RecordAgentRunDto) {
    const qc = useQueryClient();
    return useQuery({
        initialData: initial,
        initialDataUpdatedAt: initial ? Date.now() : undefined,
        queryKey: recordAiKeys.run(listId, recordId, runId ?? 0),
        queryFn: async () => {
            const prev = qc.getQueryData<RecordAgentRunDto>(recordAiKeys.run(listId, recordId, runId ?? 0));
            const run = (await api.get<RecordAgentRunDto>(`/lists/${listId}/records/${recordId}/agent-runs/${runId}`)).data;
            // Recién terminó: el registro (cambios hechos) y sus propuestas.
            if (prev !== undefined && RUNNING.has(prev.status) && !RUNNING.has(run.status)) {
                invalidateForList(qc, recordsKeys.all, listId);
                void qc.invalidateQueries({ queryKey: recordViewKeys.forRecord(listId, recordId) });
                void qc.invalidateQueries({ queryKey: ['notifications', 'agent-proposals'] });
            }
            return run;
        },
        enabled: runId !== null && runId > 0,
        staleTime: 5_000,
        refetchInterval: (q) => (q.state.data && !RUNNING.has(q.state.data.status) ? false : 2000),
        retry: false,
    });
}

// ── Agente en lote ───────────────────────────────────────────────────────

export function useAgentBatchPreview(listId: number) {
    return useMutation({
        mutationFn: async (input: AgentBatchPreviewInput) => (await api.post<AgentBatchPreview>(`/lists/${listId}/agent-batches/preview`, input)).data,
    });
}

export function useStartAgentBatch(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: AgentBatchStartInput) => (await api.post<AgentBatchDto>(`/lists/${listId}/agent-batches`, input)).data,
        onSuccess: (b) => qc.setQueryData(recordAiKeys.batch(listId, b.id), b),
    });
}

/** El avance de un lote, cada 2,5 s mientras corre. Al cerrar refresca la tabla. */
export function useAgentBatch(listId: number, batchId: number | null) {
    const qc = useQueryClient();
    return useQuery({
        queryKey: recordAiKeys.batch(listId, batchId ?? 0),
        queryFn: async () => {
            const prev = qc.getQueryData<AgentBatchDto>(recordAiKeys.batch(listId, batchId ?? 0));
            const b = (await api.get<AgentBatchDto>(`/lists/${listId}/agent-batches/${batchId}`)).data;
            // Avanzó o cerró: la tabla muestra lo que el agente cambió.
            if (prev !== undefined && (b.status !== prev.status || b.succeeded !== prev.succeeded)) invalidateForList(qc, recordsKeys.all, listId);
            return b;
        },
        enabled: batchId !== null && batchId > 0,
        refetchInterval: (q) => (q.state.data && q.state.data.status !== 'running' ? false : 2500),
        retry: false,
    });
}

export function useCancelAgentBatch(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (batchId: number) => (await api.post<AgentBatchDto>(`/lists/${listId}/agent-batches/${batchId}/cancel`)).data,
        onSuccess: (b) => qc.setQueryData(recordAiKeys.batch(listId, b.id), b),
    });
}

/** Los agentes activos de una lista que se pueden correr en lote. */
export function useListAgents(listId: number, enabled = true) {
    return useQuery({
        queryKey: ['records', String(listId), 'ai-agents-batch-options'] as const,
        queryFn: async () => (await api.get<RecordAgentOption[]>(`/lists/${listId}/agent-batches/agents`)).data,
        enabled: enabled && listId > 0,
        staleTime: 30_000,
        retry: false,
    });
}
