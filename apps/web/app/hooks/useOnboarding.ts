import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    OnboardingAiJob,
    OnboardingAiRequest,
    OnboardingAiStatus,
    OnboardingApplyInput,
    OnboardingApplyResult,
    OnboardingPrefs,
    OnboardingPrefsPatch,
    OnboardingSampleEdit,
    OnboardingSamplesDeleteResult,
    OnboardingStatus,
} from '@imagina-base/shared';

import { useToastOptional } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';

import { dashboardsKeys } from './useDashboards';
import { listGroupsKeys } from './useListGroups';
import { listsKeys, trackLocalListsChange } from './useLists';
import { recordsKeys } from './useRecords';
import { bulkHistoryKeys } from './useBulkHistory';
import { trashKeys } from './useTrash';

/**
 * F7 — «Empezar fácil» (ADR-S72): la bienvenida, los datos de ejemplo y
 * «Primeros pasos». El estado lo calcula el servidor con datos reales; aquí
 * sólo se pide, se cachea y se refresca.
 */
export const onboardingKeys = {
    all: ['onboarding'] as const,
    status: () => ['onboarding', 'status'] as const,
    ai: () => ['onboarding', 'ai'] as const,
    job: (id: string) => ['onboarding', 'job', id] as const,
};

/** Ya terminó (o no tiene pasos) y no le quedan datos de ejemplo: no hace falta preguntar seguido. */
function settled(data: OnboardingStatus | undefined): boolean {
    if (!data) return false;
    const done = data.audience === 'none' || (data.complete && data.prefs.celebrated);
    return done && !data.welcome && data.samples.length === 0;
}

export function useOnboardingStatus(enabled = true) {
    return useQuery({
        queryKey: onboardingKeys.status(),
        queryFn: async () => (await api.get<OnboardingStatus>('/onboarding')).data,
        enabled,
        staleTime: (q) => (settled(q.state.data) ? 5 * 60_000 : 15_000),
        refetchOnWindowFocus: (q) => !settled(q.state.data),
    });
}

/** PATCH optimista: el panel responde al instante (la lección del interruptor de v0.1.207). */
export function useUpdateOnboardingPrefs() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (patch: OnboardingPrefsPatch) => (await api.patch<OnboardingPrefs>('/onboarding', patch)).data,
        onMutate: async (patch) => {
            await qc.cancelQueries({ queryKey: onboardingKeys.status() });
            const prev = qc.getQueryData<OnboardingStatus>(onboardingKeys.status());
            if (prev) qc.setQueryData<OnboardingStatus>(onboardingKeys.status(), optimisticPrefs(prev, patch));
            return { prev };
        },
        onError: (_err, _patch, ctx) => {
            if (ctx?.prev) qc.setQueryData(onboardingKeys.status(), ctx.prev);
        },
        onSettled: () => void qc.invalidateQueries({ queryKey: onboardingKeys.status() }),
    });
}

/** Puro: cómo queda el estado tras un PATCH (mismo criterio que el servidor). */
export function optimisticPrefs(prev: OnboardingStatus, patch: OnboardingPrefsPatch): OnboardingStatus {
    const prefs: OnboardingPrefs = { ...prev.prefs, skipped: [...prev.prefs.skipped], marks: [...prev.prefs.marks] };
    if (patch.hidden !== undefined) prefs.hidden = patch.hidden;
    if (patch.celebrated !== undefined) prefs.celebrated = patch.celebrated;
    if (patch.welcome_dismissed !== undefined) prefs.welcome_dismissed = patch.welcome_dismissed;
    if (patch.skip && !prefs.skipped.includes(patch.skip)) prefs.skipped.push(patch.skip);
    if (patch.unskip) prefs.skipped = prefs.skipped.filter((s) => s !== patch.unskip);
    if (patch.mark && !prefs.marks.includes(patch.mark)) prefs.marks.push(patch.mark);
    const steps = prev.steps.map((s) => {
        const done = s.done || prefs.marks.includes(s.id);
        return { ...s, done, skipped: !done && prefs.skipped.includes(s.id) };
    });
    return {
        ...prev,
        prefs,
        steps,
        complete: steps.length > 0 && steps.every((s) => s.done || s.skipped),
        welcome: prev.welcome && !prefs.welcome_dismissed,
    };
}

export function useOnboardingAiStatus(enabled = true) {
    return useQuery({
        queryKey: onboardingKeys.ai(),
        queryFn: async () => (await api.get<OnboardingAiStatus>('/onboarding/ai')).data,
        enabled,
        staleTime: 30_000,
    });
}

export function useStartOnboardingAi() {
    return useMutation({
        mutationFn: async (input: OnboardingAiRequest) => (await api.post<{ id: string }>('/onboarding/ai/proposals', input)).data,
    });
}

/** Pregunta cada poco mientras la IA trabaja; se detiene sola al terminar. */
export function useOnboardingJob(id: string | null) {
    return useQuery({
        queryKey: onboardingKeys.job(id ?? ''),
        queryFn: async () => (await api.get<OnboardingAiJob>(`/onboarding/ai/proposals/${id}`)).data,
        enabled: id !== null,
        refetchInterval: (q) => (q.state.data?.state === 'running' || q.state.data === undefined ? 1500 : false),
        refetchOnWindowFocus: false,
        staleTime: 0,
        gcTime: 0,
    });
}

export function useApplyOnboarding() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: OnboardingApplyInput) =>
            (await trackLocalListsChange(api.post<OnboardingApplyResult>('/onboarding/apply', input))).data,
        onSuccess: () => {
            for (const key of [listsKeys.all, listGroupsKeys.all, dashboardsKeys.all, onboardingKeys.all]) {
                void qc.invalidateQueries({ queryKey: key });
            }
        },
    });
}

/**
 * «Borrar los datos de ejemplo» con el aviso de siempre: «Se borraron… ·
 * Deshacer». Van a la papelera (borrado en lote de la app, con su historial).
 */
export function useDeleteSamples(): { run: (listId?: number) => Promise<void>; pending: boolean } {
    const qc = useQueryClient();
    const toast = useToastOptional();
    const del = useMutation({
        mutationFn: async (listId?: number) =>
            (await api.post<OnboardingSamplesDeleteResult>('/onboarding/samples/delete', listId !== undefined ? { list_id: listId } : {})).data,
    });
    const refresh = useCallback(
        (edits: OnboardingSampleEdit[]) => {
            for (const key of [onboardingKeys.all, recordsKeys.all, trashKeys.all, ['aggregates']]) void qc.invalidateQueries({ queryKey: key });
            for (const e of edits) void qc.invalidateQueries({ queryKey: bulkHistoryKeys.forList(e.list_id) });
        },
        [qc],
    );
    const run = useCallback(
        async (listId?: number) => {
            try {
                const res = await del.mutateAsync(listId);
                refresh(res.edits);
                if (!toast) return;
                if (res.deleted === 0) {
                    toast.info(__('Ya no quedan datos de ejemplo'));
                    return;
                }
                toast.show({
                    title: sprintf(_n('Se borró %d registro de ejemplo', 'Se borraron %d registros de ejemplo', res.deleted), res.deleted),
                    description: __('Quedaron en la papelera por si los necesitas.'),
                    variant: 'success',
                    duration: 8000,
                    action: {
                        label: __('Deshacer'),
                        onClick: () => {
                            void api
                                .post<{ restored: number }>('/onboarding/samples/restore', { edits: res.edits })
                                .then(() => {
                                    refresh(res.edits);
                                    toast.success(__('Volvieron los datos de ejemplo'));
                                })
                                .catch((err: unknown) => toast.error(__('No se pudo deshacer'), err instanceof Error ? err.message : String(err)));
                        },
                    },
                });
            } catch (err) {
                toast?.error(__('No se pudieron borrar los datos de ejemplo'), err instanceof Error ? err.message : String(err));
            }
        },
        [del, refresh, toast],
    );
    return { run, pending: del.isPending };
}
