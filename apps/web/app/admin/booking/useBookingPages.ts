import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    AgendaCalendarItem,
    BookingConfig,
    BookingMemberCalendar,
    BookingPageDto,
    CreateBookingPageInput,
    HolidayItem,
    PublicBookingSlots,
    UpdateBookingPageInput,
} from '@imagina-base/shared';

import { api } from '@/lib/api';

/**
 * D5 — Páginas de agenda de una lista. La clave usa el ID numérico de la
 * lista (regla de oro nº 7).
 */
export const bookingKeys = {
    all: ['booking-pages'] as const,
    forList: (listId: number) => ['booking-pages', listId] as const,
    options: (listId: number) => ['booking-pages', listId, 'options'] as const,
};

export interface BookingCalendarOption {
    id: number;
    name: string;
    provider: 'google_calendar' | 'outlook';
    account: string | null;
    /** null = del equipo; si no, sólo esa persona puede usarlo. */
    owner_user_id: number | null;
}

export interface BookingEditorOptions {
    /** v0.1.350 — con el estado de su «Mi calendario» (sin los nombres de sus calendarios). */
    members: Array<{ id: number; name: string; email: string; calendar?: BookingMemberCalendar | null }>;
    calendars: BookingCalendarOption[];
    time_zone: string;
    time_zone_set: boolean;
}

export function useBookingPages(listId: number | undefined) {
    return useQuery({
        queryKey: bookingKeys.forList(listId ?? 0),
        queryFn: async () => (await api.get<BookingPageDto[]>(`/lists/${listId}/booking-pages`)).data,
        enabled: listId !== undefined && listId > 0,
        staleTime: 15_000,
    });
}

/** Quién puede atender, los calendarios conectados y la zona de la empresa. */
export function useBookingOptions(listId: number | undefined) {
    return useQuery({
        queryKey: bookingKeys.options(listId ?? 0),
        queryFn: async () => (await api.get<BookingEditorOptions>(`/lists/${listId}/booking-pages/options`)).data,
        enabled: listId !== undefined && listId > 0,
        staleTime: 60_000,
    });
}

export function useCreateBookingPage(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateBookingPageInput) => (await api.post<BookingPageDto>(`/lists/${listId}/booking-pages`, input)).data,
        onSuccess: () => void qc.invalidateQueries({ queryKey: bookingKeys.forList(listId) }),
    });
}

export function useUpdateBookingPage(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: { id: number; body: UpdateBookingPageInput }) =>
            (await api.patch<BookingPageDto>(`/lists/${listId}/booking-pages/${input.id}`, input.body)).data,
        onSuccess: (doc) => {
            qc.setQueryData<BookingPageDto[]>(bookingKeys.forList(listId), (prev) => prev?.map((p) => (p.id === doc.id ? doc : p)));
            void qc.invalidateQueries({ queryKey: bookingKeys.forList(listId) });
            // Publicar crea las opciones de servicios y estados en los campos.
            void qc.invalidateQueries({ queryKey: ['fields'] });
        },
    });
}

export function useDeleteBookingPage(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/lists/${listId}/booking-pages/${id}`);
        },
        onSuccess: () => void qc.invalidateQueries({ queryKey: bookingKeys.forList(listId) }),
    });
}

/** Horarios de la vista previa con la configuración EN EDICIÓN (sin guardar). */
export async function fetchPreviewSlots(
    listId: number,
    pageId: number,
    body: { config: BookingConfig; service_id: string; staff_id: string; from: string; to: string; duration?: number },
): Promise<PublicBookingSlots> {
    return (await api.post<PublicBookingSlots>(`/lists/${listId}/booking-pages/${pageId}/preview-slots`, body)).data;
}

/** Dirección absoluta de la agenda (la que se comparte o se inserta). */
export function bookingPublicUrl(page: Pick<BookingPageDto, 'public_path' | 'public_url'>): string {
    return page.public_url ?? `${window.location.origin}${page.public_path}`;
}

export function bookingPublicOrigin(page: Pick<BookingPageDto, 'public_path' | 'public_url' | 'public_origin'>): string {
    if (page.public_origin) return page.public_origin;
    try {
        return new URL(bookingPublicUrl(page)).origin;
    } catch {
        return window.location.origin;
    }
}


/** v0.1.349 — Los festivos de un país en un año (para marcar los que sí se atienden). */
export function useBookingHolidays(listId: number, country: string | null, year: number) {
    return useQuery({
        queryKey: ['booking-holidays', listId, country, year],
        enabled: country !== null,
        staleTime: 60 * 60_000,
        queryFn: async () =>
            (await api.get<{ country: string; items: HolidayItem[]; available: boolean }>(`/lists/${listId}/booking-pages/holidays?country=${encodeURIComponent(country ?? '')}&year=${year}`)).data,
    });
}

/**
 * v0.1.350 — Los calendarios de una conexión de la EMPRESA (para elegir en
 * cuáles mira lo ocupado una persona y en cuál crea las citas). Una conexión
 * privada no se lista: esos calendarios los elige su dueño en «Mi calendario».
 */
export function useConnectionCalendars(listId: number, connectionId: number | null, enabled: boolean) {
    return useQuery({
        queryKey: ['booking-pages', listId, 'calendars', connectionId],
        enabled: enabled && connectionId !== null,
        staleTime: 5 * 60_000,
        retry: false,
        queryFn: async () => (await api.get<AgendaCalendarItem[]>(`/lists/${listId}/booking-pages/calendars/${connectionId}`)).data,
    });
}
