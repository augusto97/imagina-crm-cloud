import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
    AiAgentApplyResult,
    AiAgentDto,
    AiAgentMode,
    AiAgentProposalDto,
    AiAgentRunDto,
    AiAgentVersionDto,
    CreateAiAgentInput,
    CreateAiAgentTriggerInput,
    MyAgentProposalsDto,
    TestAiAgentInput,
    UpdateAiAgentInput,
    UpdateAiAgentTriggerInput,
} from '@imagina-base/shared';

import { rememberAgentNames } from '@/admin/automations/automationMeta';
import { invalidateForList, recordsKeys } from '@/hooks/useRecords';
import { api } from '@/lib/api';
import { useIsGuest } from '@/lib/guest';

import { activityKeys } from './useActivity';

/**
 * E6 — Agentes de IA.
 *
 * Claves:
 * - La configuración, el historial y las versiones viven bajo `ai-agents`.
 * - Las propuestas de UN registro viven bajo `records` con el id de la lista
 *   en el índice 1 (regla de oro nº 7): el aviso realtime de la lista las
 *   refresca solo (una corrida que propone emite el aviso de registros).
 * - «Mi trabajo» → Agentes vive bajo `notifications` (el aviso de la persona).
 */
export const aiAgentKeys = {
    all: ['ai-agents'] as const,
    list: ['ai-agents', 'list'] as const,
    options: ['ai-agents', 'options'] as const,
    detail: (id: number) => ['ai-agents', 'detail', id] as const,
    runs: (id: number) => ['ai-agents', 'runs', id] as const,
    run: (id: number, runId: number) => ['ai-agents', 'run', id, runId] as const,
    versions: (id: number) => ['ai-agents', 'versions', id] as const,
    forRecord: (listId: string | number, recordId: number) => ['records', String(listId), 'agent-proposals', recordId] as const,
    mine: ['notifications', 'agent-proposals'] as const,
};

/** Una opción del selector de «Pedirle a un agente». */
export interface AiAgentOption {
    id: number;
    name: string;
    color: string | null;
    icon: string | null;
    list_ids: number[];
    is_active: boolean;
    mode: AiAgentMode;
}

export function useAiAgents(enabled = true) {
    return useQuery({
        queryKey: aiAgentKeys.list,
        queryFn: async () => (await api.get<AiAgentDto[]>('/ai-agents')).data,
        enabled,
        // El consumo y la última corrida cambian solos (las corridas son de fondo).
        refetchOnMount: 'always',
    });
}

export function useAiAgent(id: number | undefined) {
    return useQuery({
        queryKey: aiAgentKeys.detail(id ?? 0),
        queryFn: async () => (await api.get<AiAgentDto>(`/ai-agents/${id}`)).data,
        enabled: id !== undefined && id > 0,
        refetchOnMount: 'always',
    });
}

export function useAiAgentOptions(enabled = true) {
    return useQuery({
        queryKey: aiAgentKeys.options,
        queryFn: async () => {
            const data = (await api.get<AiAgentOption[]>('/ai-agents/options')).data;
            // Los resúmenes de las automatizaciones nombran al agente.
            rememberAgentNames(data);
            return data;
        },
        enabled,
        staleTime: 30_000,
    });
}

function invalidateAgents(qc: QueryClient): void {
    void qc.invalidateQueries({ queryKey: aiAgentKeys.all });
    // «Cuándo trabaja» crea o cambia automatizaciones.
    void qc.invalidateQueries({ queryKey: ['automations'] });
}

export function useCreateAiAgent() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateAiAgentInput) => (await api.post<AiAgentDto>('/ai-agents', input)).data,
        onSuccess: () => invalidateAgents(qc),
    });
}

export function useUpdateAiAgent(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (patch: UpdateAiAgentInput) => (await api.patch<AiAgentDto>(`/ai-agents/${id}`, patch)).data,
        onSuccess: (agent) => {
            qc.setQueryData(aiAgentKeys.detail(id), agent);
            invalidateAgents(qc);
        },
    });
}

export function useDeleteAiAgent() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => (await api.delete<{ id: number; name: string; automations_removed: number }>(`/ai-agents/${id}`)).data,
        onSuccess: () => invalidateAgents(qc),
    });
}

export function useAddAgentTrigger(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateAiAgentTriggerInput) => (await api.post<AiAgentDto>(`/ai-agents/${id}/triggers`, input)).data,
        onSuccess: (agent) => {
            qc.setQueryData(aiAgentKeys.detail(id), agent);
            invalidateAgents(qc);
        },
    });
}

export function useUpdateAgentTrigger(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ automationId, ...patch }: UpdateAiAgentTriggerInput & { automationId: number }) =>
            (await api.patch<AiAgentDto>(`/ai-agents/${id}/triggers/${automationId}`, patch)).data,
        onSuccess: (agent) => {
            qc.setQueryData(aiAgentKeys.detail(id), agent);
            invalidateAgents(qc);
        },
    });
}

export function useRemoveAgentTrigger(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (automationId: number) => (await api.delete<AiAgentDto>(`/ai-agents/${id}/triggers/${automationId}`)).data,
        onSuccess: (agent) => {
            qc.setQueryData(aiAgentKeys.detail(id), agent);
            invalidateAgents(qc);
        },
    });
}

/** «Probar»: devuelve la corrida simulada (se sigue con `useAgentRun`). */
export function useTestAiAgent(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: TestAiAgentInput) => (await api.post<{ run_id: number }>(`/ai-agents/${id}/test`, input)).data,
        onSuccess: () => void qc.invalidateQueries({ queryKey: aiAgentKeys.runs(id) }),
    });
}

const LIVE: ReadonlySet<string> = new Set(['queued', 'running']);

/** Historial de corridas. Mientras alguna corre, se refresca solo. */
export function useAgentRuns(id: number | undefined) {
    return useQuery({
        queryKey: aiAgentKeys.runs(id ?? 0),
        queryFn: async () => (await api.get<AiAgentRunDto[]>(`/ai-agents/${id}/runs`)).data,
        enabled: id !== undefined && id > 0,
        refetchInterval: (q) => ((q.state.data ?? []).some((r) => LIVE.has(r.status)) ? 2_000 : false),
    });
}

/** Una corrida (la de «Probar»): se pregunta cada segundo y medio hasta que termina. */
export function useAgentRun(id: number, runId: number | null) {
    return useQuery({
        queryKey: aiAgentKeys.run(id, runId ?? 0),
        queryFn: async () => (await api.get<AiAgentRunDto>(`/ai-agents/${id}/runs/${runId}`)).data,
        enabled: runId !== null && runId > 0,
        refetchInterval: (q) => (q.state.data && !LIVE.has(q.state.data.status) ? false : 1_500),
    });
}

export function useAgentVersions(id: number | undefined, enabled = true) {
    return useQuery({
        queryKey: aiAgentKeys.versions(id ?? 0),
        queryFn: async () => (await api.get<AiAgentVersionDto[]>(`/ai-agents/${id}/versions`)).data,
        enabled: enabled && id !== undefined && id > 0,
    });
}

// ── Propuestas ───────────────────────────────────────────────────────────

export function useRecordAgentProposals(listId: string | number | undefined, recordId: number | undefined, enabled = true) {
    // Lo que propone un agente es interno de la empresa: un invitado no lo ve.
    const isGuest = useIsGuest();
    return useQuery({
        queryKey: aiAgentKeys.forRecord(listId ?? '', recordId ?? 0),
        queryFn: async () => (await api.get<AiAgentProposalDto[]>(`/lists/${listId}/records/${recordId}/agent-proposals`)).data,
        enabled: enabled && !isGuest && listId !== undefined && listId !== '' && recordId !== undefined && recordId > 0,
        staleTime: 30_000,
    });
}

export function useMyAgentProposals(enabled = true) {
    return useQuery({
        queryKey: aiAgentKeys.mine,
        queryFn: async () => (await api.get<MyAgentProposalsDto>('/me/agent-proposals')).data,
        enabled,
        staleTime: 15_000,
    });
}

function invalidateProposal(qc: QueryClient, listId: number): void {
    // El registro (campos que cambió), su actividad, sus comentarios y la tarjeta.
    invalidateForList(qc, recordsKeys.all, listId);
    invalidateForList(qc, activityKeys.all, listId);
    void qc.invalidateQueries({ queryKey: ['comments'] });
    void qc.invalidateQueries({ queryKey: aiAgentKeys.mine });
    void qc.invalidateQueries({ queryKey: aiAgentKeys.list });
}

export function useApplyAgentProposal() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => (await api.post<AiAgentApplyResult>(`/ai-agent-proposals/${id}/apply`)).data,
        onSuccess: (res) => invalidateProposal(qc, res.proposal.list_id),
    });
}

export function useDiscardAgentProposal() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => (await api.post<AiAgentProposalDto>(`/ai-agent-proposals/${id}/discard`)).data,
        onSuccess: (p) => invalidateProposal(qc, p.list_id),
    });
}
