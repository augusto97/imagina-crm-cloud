import { useMutation, useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { PublicTheme, PublicThemesDto, SavedPublicTheme } from '@imagina-base/shared';

import { useSession } from '@/cloud/session';
import { resolveAttachments, type ResolvedAttachment } from '@/hooks/useAttachments';
import { api, ApiError } from '@/lib/api';

/**
 * v0.1.351 (ADR-S94) — «Mis temas»: los diseños guardados de la empresa
 * (`/workspaces/current/public-themes`) y cuál usan los formularios nuevos.
 * La clave lleva el id numérico de la empresa (regla de oro nº 7).
 */
export const publicThemeKeys = {
    all: ['public-themes'] as const,
    forTenant: (tenantId: number | null) => ['public-themes', tenantId ?? 0] as const,
};

const BASE = '/workspaces/current/public-themes';

function useTenantKey() {
    return publicThemeKeys.forTenant(useSession((s) => s.activeTenantId));
}

export function usePublicThemes() {
    const key = useTenantKey();
    return useQuery({
        queryKey: key,
        queryFn: async (): Promise<PublicThemesDto> => {
            const res = await api.get<PublicThemesDto>(BASE);
            const d = res.data as Partial<PublicThemesDto> | null;
            return { themes: Array.isArray(d?.themes) ? d.themes : [], default_id: d?.default_id ?? null };
        },
        staleTime: 30_000,
        retry: false,
    });
}

function useThemesMutation<TVars, TOut>(fn: (vars: TVars) => Promise<TOut>, apply?: (prev: PublicThemesDto, out: TOut, vars: TVars) => PublicThemesDto) {
    const qc = useQueryClient();
    const key = useTenantKey();
    return useMutation({
        mutationFn: fn,
        onSuccess: (out, vars) => {
            if (apply) qc.setQueryData<PublicThemesDto>(key, (prev) => (prev ? apply(prev, out, vars) : prev));
            void qc.invalidateQueries({ queryKey: key });
        },
    });
}

export function useCreatePublicTheme() {
    return useThemesMutation(
        async (input: { name: string; theme: PublicTheme }) => (await api.post<SavedPublicTheme>(BASE, input)).data,
        (prev, out) => ({ ...prev, themes: [...prev.themes.filter((t) => t.id !== out.id), out] }),
    );
}

export function useUpdatePublicTheme() {
    return useThemesMutation(
        async ({ id, ...patch }: { id: string; name?: string; theme?: PublicTheme }) =>
            (await api.patch<SavedPublicTheme>(`${BASE}/${encodeURIComponent(id)}`, patch)).data,
        (prev, out) => ({ ...prev, themes: prev.themes.map((t) => (t.id === out.id ? out : t)) }),
    );
}

export function useDeletePublicTheme() {
    return useThemesMutation(
        async (id: string) => (await api.delete<{ ok: true }>(`${BASE}/${encodeURIComponent(id)}`)).data,
        (prev, _out, id) => ({
            themes: prev.themes.filter((t) => t.id !== id),
            default_id: prev.default_id === id ? null : prev.default_id,
        }),
    );
}

export function useSetDefaultPublicTheme() {
    return useThemesMutation(
        async (id: string | null) => (await api.put<PublicThemesDto>(`${BASE}/default`, { id })).data,
        (prev, out, id) => ({ ...prev, default_id: out?.default_id !== undefined ? out.default_id : id }),
    );
}

/** El mensaje para la persona de un error al guardar el diseño o un tema. */
export function themeErrorMessage(err: unknown): string {
    if (err instanceof ApiError && err.code === 'custom_css_admin_only') {
        return 'El CSS propio sólo lo puede cambiar un administrador. Deshaz ese cambio o pídele a un administrador que lo guarde.';
    }
    return err instanceof Error ? err.message : String(err);
}

/**
 * Las URL (firmadas) de las imágenes que usa el formulario, para la VISTA
 * PREVIA. Una consulta por archivo (comparte el cache de `useAttachment`) y
 * todas las del mismo momento viajan en UN pedido: al subir una imagen nueva
 * no se vuelven a pedir las demás, ni la vista previa parpadea.
 */
export function useAttachmentUrls(ids: readonly number[]): Map<number, string> {
    const results = useQueries({
        queries: ids.map((id) => ({
            queryKey: ['imcrm', 'attachment', id] as const,
            queryFn: async (): Promise<ResolvedAttachment | null> => (await resolveAttachments([id]))[0] ?? null,
            staleTime: 5 * 60_000,
        })),
    });
    const urls = results.map((r) => r.data?.url ?? '');
    const sig = urls.join('|');
    return useMemo(() => {
        const m = new Map<number, string>();
        ids.forEach((id, i) => {
            if (urls[i]) m.set(id, urls[i]!);
        });
        return m;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sig, ids.join(',')]);
}
