import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    CreateReminderInput,
    FollowStateDto,
    MarkNotificationsInput,
    MyWorkDto,
    NotificationPrefs,
    NotificationsPage,
    ReminderDto,
    UpdateNotificationPrefsInput,
    UpdateReminderInput,
} from '@imagina-base/shared';

import { api } from '@/lib/api';

/**
 * v0.1.276 (ADR-S40) — Bandeja de avisos, «Mi trabajo», seguir y
 * recordatorios. La bandeja se refresca por realtime (sala de la persona);
 * el polling es sólo la red de seguridad.
 */
export const notificationKeys = {
    all: ['notifications'] as const,
    page: (unread: boolean) => ['notifications', 'page', unread] as const,
    prefs: ['notifications', 'prefs'] as const,
    work: ['notifications', 'my-work'] as const,
    follow: (recordId: number) => ['notifications', 'follow', recordId] as const,
    reminders: (recordId: number | null) => ['notifications', 'reminders', recordId] as const,
};

export function useNotifications(unread = false) {
    return useQuery({
        queryKey: notificationKeys.page(unread),
        queryFn: async () => (await api.get<NotificationsPage>('/me/notifications', { query: { limit: 40, unread: unread ? '1' : '0' } })).data,
        refetchInterval: 5 * 60 * 1000,
        staleTime: 30_000,
    });
}

export function useMarkNotifications() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: MarkNotificationsInput) => (await api.post<{ unread: number }>('/me/notifications/read', input)).data,
        onSuccess: () => void qc.invalidateQueries({ queryKey: notificationKeys.all }),
    });
}

export function useNotificationPrefs() {
    return useQuery({
        queryKey: notificationKeys.prefs,
        queryFn: async () => (await api.get<NotificationPrefs>('/me/notification-prefs')).data,
        staleTime: 60_000,
    });
}

export function useUpdateNotificationPrefs() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: UpdateNotificationPrefsInput) => (await api.patch<NotificationPrefs>('/me/notification-prefs', input)).data,
        // Optimista: un checkbox controlado que espera al servidor no se mueve
        // al tocarlo (la lección de v0.1.207).
        onMutate: (input) => {
            const prev = qc.getQueryData<NotificationPrefs>(notificationKeys.prefs);
            if (prev) {
                qc.setQueryData<NotificationPrefs>(notificationKeys.prefs, {
                    ...prev,
                    ...input,
                    email: { ...prev.email, ...(input.email ?? {}) },
                    digest_days: input.digest_days ?? prev.digest_days,
                });
            }
            return { prev };
        },
        onError: (_err, _input, ctx) => {
            if (ctx?.prev) qc.setQueryData(notificationKeys.prefs, ctx.prev);
        },
        onSuccess: (prefs) => qc.setQueryData(notificationKeys.prefs, prefs),
    });
}

export function useMyWork() {
    return useQuery({
        queryKey: notificationKeys.work,
        queryFn: async () => (await api.get<MyWorkDto>('/me/work')).data,
        staleTime: 30_000,
    });
}

export function useFollowState(listId: number | undefined, recordId: number | undefined) {
    return useQuery({
        queryKey: notificationKeys.follow(recordId ?? 0),
        queryFn: async () => (await api.get<FollowStateDto>(`/lists/${listId}/records/${recordId}/follow`)).data,
        enabled: !!listId && !!recordId,
        staleTime: 30_000,
    });
}

export function useSetFollow(listId: number, recordId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (following: boolean) =>
            (await api.post<FollowStateDto>(`/lists/${listId}/records/${recordId}/follow`, { following })).data,
        onSuccess: (state) => {
            qc.setQueryData(notificationKeys.follow(recordId), state);
            void qc.invalidateQueries({ queryKey: notificationKeys.work });
        },
    });
}

export function useReminders(recordId: number | null) {
    return useQuery({
        queryKey: notificationKeys.reminders(recordId),
        queryFn: async () =>
            (await api.get<ReminderDto[]>('/me/reminders', { query: recordId ? { record_id: String(recordId) } : {} })).data,
        staleTime: 30_000,
    });
}

export function useCreateReminder() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateReminderInput) => (await api.post<ReminderDto>('/me/reminders', input)).data,
        onSuccess: () => void qc.invalidateQueries({ queryKey: notificationKeys.all }),
    });
}

export function useUpdateReminder() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: { id: number; body: UpdateReminderInput }) =>
            (await api.patch<ReminderDto>(`/me/reminders/${input.id}`, input.body)).data,
        onSuccess: () => void qc.invalidateQueries({ queryKey: notificationKeys.all }),
    });
}

export function useDeleteReminder() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/me/reminders/${id}`);
        },
        onSuccess: () => void qc.invalidateQueries({ queryKey: notificationKeys.all }),
    });
}
