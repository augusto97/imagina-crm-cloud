import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateTeamInput, Team, UpdateTeamInput } from '@imagina-base/shared';

import { api } from '@/lib/api';
import { getBootData } from '@/lib/boot';

import { listsKeys } from './useLists';

/**
 * C1 — Equipos del workspace. Se leen en muchos lugares a la vez (chips del
 * campo «Equipo», selectores, filtros, menciones, permisos), así que es UNA
 * query compartida con `staleTime` largo; el realtime (`teams`) la invalida
 * cuando alguien los cambia en otra pestaña.
 */
export const teamsKeys = {
    all: ['teams'] as const,
    list: () => [...teamsKeys.all, 'list'] as const,
};

/**
 * Las superficies SIN sesión del equipo (página pública de un tablero, portal
 * del cliente) reusan componentes que pintan equipos: ahí no se pide nada a la
 * API (sería un 401) y el chip dice «Equipo» a secas.
 */
let teamsApiDisabled = false;
export function disableTeamsApi(): void {
    teamsApiDisabled = true;
}

export function useTeams(enabled = true) {
    return useQuery({
        queryKey: teamsKeys.list(),
        queryFn: async () => {
            const res = await api.get<Team[]>('/teams');
            return Array.isArray(res.data) ? res.data : [];
        },
        staleTime: 5 * 60_000,
        enabled: enabled && !teamsApiDisabled,
    });
}

/** Equipos indexados por id (para pintar chips sin buscar en un array). */
export function useTeamMap(): ReadonlyMap<number, Team> {
    return useTeamDirectory().map;
}

/**
 * Equipos por id + si ya se cargaron: un id que no está en una lista ya
 * cargada es un equipo BORRADO; antes de cargar (o sin API) no se sabe.
 */
export function useTeamDirectory(): { map: ReadonlyMap<number, Team>; loaded: boolean } {
    const { data } = useTeams();
    const map = useMemo(() => new Map((data ?? []).map((t) => [t.id, t] as const)), [data]);
    return { map, loaded: data !== undefined };
}

/** Los ids de los equipos de la persona que está usando la app. */
export function useMyTeamIds(): number[] {
    const { data } = useTeams();
    const me = getBootData().user.id;
    return useMemo(
        () => (data ?? []).filter((t) => t.members.some((m) => m.user_id === me)).map((t) => t.id),
        [data, me],
    );
}

function useTeamMutation<TVars, TOut>(fn: (vars: TVars) => Promise<TOut>) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: fn,
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: teamsKeys.all });
            // Los permisos de las listas muestran los equipos con su nombre.
            void qc.invalidateQueries({ queryKey: listsKeys.all });
        },
    });
}

export function useCreateTeam() {
    return useTeamMutation(async (input: CreateTeamInput) => {
        const res = await api.post<Team>('/teams', input);
        return res.data;
    });
}

export function useUpdateTeam() {
    return useTeamMutation(async ({ id, ...patch }: UpdateTeamInput & { id: number }) => {
        const res = await api.patch<Team>(`/teams/${id}`, patch);
        return res.data;
    });
}

export function useDeleteTeam() {
    return useTeamMutation(async (id: number) => {
        await api.delete(`/teams/${id}`);
    });
}

