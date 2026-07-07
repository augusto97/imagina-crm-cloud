import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { LicenseState } from '@/types/license';

export const licenseKeys = {
    all: ['license'] as const,
};

export function useLicense() {
    return useQuery({
        queryKey: licenseKeys.all,
        queryFn: async () => {
            const res = await api.get<LicenseState>('/license');
            return res.data;
        },
        staleTime: 60_000,
    });
}

export function useActivateLicense() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (key: string) => {
            const res = await api.post<LicenseState>('/license/activate', { key });
            return res.data;
        },
        onSuccess: (data) => {
            qc.setQueryData(licenseKeys.all, data);
        },
    });
}

export function useDeactivateLicense() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => {
            const res = await api.post<LicenseState>('/license/deactivate');
            return res.data;
        },
        onSuccess: (data) => {
            qc.setQueryData(licenseKeys.all, data);
        },
    });
}

export function useRefreshLicense() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => {
            const res = await api.post<LicenseState>('/license/refresh');
            return res.data;
        },
        onSuccess: (data) => {
            qc.setQueryData(licenseKeys.all, data);
        },
    });
}
