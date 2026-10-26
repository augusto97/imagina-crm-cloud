import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    BookingConfig,
    BookingPageDto,
    CreateBookingPageInput,
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
    members: Array<{ id: number; name: string; email: string }>;
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
    body: { config: BookingConfig; service_id: string; staff_id: string; from: string; to: string },
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

/**
 * Código para insertarla en un sitio: el marco y el MISMO script de los
 * formularios (`embed.js`), que ajusta el alto del marco a su contenido.
 */
export function bookingEmbedCode(page: Pick<BookingPageDto, 'public_path' | 'public_url' | 'public_origin' | 'name'>): string {
    const title = page.name.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
    return (
        `<iframe src="${bookingPublicUrl(page)}" title="${title}" data-imagina-form style="width:100%;height:720px;border:0" loading="lazy"></iframe>\n` +
        `<script src="${bookingPublicOrigin(page)}/api/v1/public/f/embed.js" async></script>`
    );
}
