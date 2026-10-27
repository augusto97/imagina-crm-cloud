import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    effectiveCapabilities,
    mergeGuideProgress,
    parseGuideProgress,
    type Capability,
    type GuideProgress,
    type HelpConfigView,
    type PlatformHelp,
    type UpdateGuideProgressInput,
    type UpdatePlatformHelpInput,
} from '@imagina-base/shared';

import { useSession } from '@/cloud/session';
import { api } from '@/lib/api';

/**
 * Fase 7 — los datos del centro de ayuda: el progreso de los recorridos de
 * esta persona en esta empresa (`/me/guides`), la ayuda que configuró el
 * operador (`/help`) y, en la consola, su edición (`/platform/help`).
 */

export const helpKeys = {
    progress: ['help', 'progress'] as const,
    config: ['help', 'config'] as const,
    platform: ['help', 'platform'] as const,
};

/** Quien mira, para filtrar guías y recorridos con lo MISMO que aplica el servidor. */
export interface HelpViewer {
    role: string | null;
    isAdmin: boolean;
    isGuest: boolean;
    impersonating: boolean;
    caps: ReadonlySet<Capability>;
}

export function useHelpViewer(): HelpViewer {
    const membership = useSession((s) => s.memberships.find((m) => m.tenant_id === s.activeTenantId) ?? null);
    const impersonating = useSession((s) => Boolean(s.impersonating));
    return useMemo(() => {
        const role = membership?.role ?? null;
        // Las capacidades EFECTIVAS que manda el servidor (rol propio incluido);
        // sin ellas, las del rol base.
        const list = membership ? (membership.capabilities ?? effectiveCapabilities(membership.role)) : [];
        return {
            role,
            isAdmin: role === 'admin',
            isGuest: role === 'guest',
            impersonating,
            caps: new Set(list),
        };
    }, [membership, impersonating]);
}

export function useGuideProgress(enabled: boolean) {
    return useQuery({
        queryKey: helpKeys.progress,
        queryFn: async (): Promise<GuideProgress> => parseGuideProgress((await api.get<GuideProgress>('/me/guides')).data),
        enabled,
        staleTime: 5 * 60_000,
    });
}

export function useUpdateGuideProgress() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (patch: UpdateGuideProgressInput): Promise<GuideProgress> =>
            parseGuideProgress((await api.patch<GuideProgress>('/me/guides', patch)).data),
        // Optimista: el ofrecimiento de bienvenida se va al instante.
        onMutate: async (patch) => {
            await qc.cancelQueries({ queryKey: helpKeys.progress });
            const prev = qc.getQueryData<GuideProgress>(helpKeys.progress);
            if (prev) qc.setQueryData(helpKeys.progress, mergeGuideProgress(prev, patch));
            return { prev };
        },
        onError: (_err, _patch, ctx) => {
            if (ctx?.prev) qc.setQueryData(helpKeys.progress, ctx.prev);
        },
        onSuccess: (data) => qc.setQueryData(helpKeys.progress, data),
    });
}

const EMPTY_CONFIG: HelpConfigView = {
    support: { email: null, whatsapp: null, url: null, note: null },
    videos: {},
    hidden: [],
    custom: [],
};

/** La ayuda que configuró el operador (vacía si no hay o si falla: la del sistema alcanza). */
export function useHelpConfig(enabled: boolean) {
    const q = useQuery({
        queryKey: helpKeys.config,
        queryFn: async (): Promise<HelpConfigView> => {
            const res = await api.get<HelpConfigView>('/help');
            return { ...EMPTY_CONFIG, ...res.data };
        },
        enabled,
        staleTime: 5 * 60_000,
        retry: 1,
    });
    return q.data ?? EMPTY_CONFIG;
}

export function usePlatformHelp() {
    return useQuery({
        queryKey: helpKeys.platform,
        queryFn: async (): Promise<PlatformHelp> => (await api.get<PlatformHelp>('/platform/help')).data,
    });
}

export function useUpdatePlatformHelp() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (patch: UpdatePlatformHelpInput): Promise<PlatformHelp> =>
            (await api.patch<PlatformHelp>('/platform/help', patch)).data,
        onSuccess: (data) => {
            qc.setQueryData(helpKeys.platform, data);
            // El panel de Ayuda del operador ve el cambio sin recargar.
            void qc.invalidateQueries({ queryKey: helpKeys.config });
        },
    });
}
