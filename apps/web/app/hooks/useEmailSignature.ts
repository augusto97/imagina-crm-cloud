import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

const KEY = ['me', 'email-signature'] as const;

interface SignatureResponse {
    signature: string;
}

/**
 * Lee la firma de email del usuario actual (`user_meta`
 * `imcrm_email_signature`). Sirve para:
 *  - El editor de firma en Settings.
 *  - El botón "+ Agregar firma" en `MergeTagInput` que la inserta
 *    en el body del email.
 */
export function useEmailSignature() {
    return useQuery({
        queryKey: KEY,
        queryFn: async () => {
            const res = await api.get<SignatureResponse>('/me/email-signature');
            return res.data.signature;
        },
        // La firma cambia con poca frecuencia; cache largo está bien.
        staleTime: 60_000,
    });
}

export function useUpdateEmailSignature() {
    const qc = useQueryClient();
    return useMutation<string, Error, string>({
        mutationFn: async (signature) => {
            const res = await api.patch<SignatureResponse>('/me/email-signature', { signature });
            return res.data.signature;
        },
        onSuccess: (next) => {
            qc.setQueryData(KEY, next);
        },
    });
}
