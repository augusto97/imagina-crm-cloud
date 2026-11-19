import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    CreateReportInput,
    Report,
    ReportBlock,
    ReportBundle,
    ReportExportFormat,
    UpdateReportInput,
} from '@imagina-base/shared';

import { widgetErrorOf } from '@/hooks/useDashboards';
import { api } from '@/lib/api';
import { getBootData } from '@/lib/boot';
import type { WidgetData, WidgetSpec } from '@/types/dashboard';

/**
 * v0.1.464 (J1) — Informes: documentos armados con bloques de varias listas.
 *
 * Las claves viven bajo `['reports', …]`. El bundle de un informe va en
 * `['reports', 'bundle', id, período, comparación]`: el realtime de registros
 * recalcula todos los bundles de informes (ver `invalidateDashboardsForList`).
 */
export const reportsKeys = {
    all: ['reports'] as const,
    list: () => ['reports', 'list'] as const,
    one: (id: number | string) => ['reports', 'one', String(id)] as const,
    bundleOf: (id: number | string) => ['reports', 'bundle', String(id)] as const,
    bundle: (id: number | string, period: string, compare: string) => ['reports', 'bundle', String(id), period, compare] as const,
    preview: (body: string) => ['reports', 'bundle', 'preview', body] as const,
};

/** Lo que manda quien mira: período y comparación ('' = lo de cada bloque). */
export interface ReportScope {
    period: string;
    compare: string;
}

export function useReports(enabled = true) {
    return useQuery({
        queryKey: reportsKeys.list(),
        queryFn: async () => (await api.get<Report[]>('/reports')).data,
        enabled,
        staleTime: 30_000,
    });
}

export function useReport(id: number) {
    return useQuery({
        queryKey: reportsKeys.one(id),
        queryFn: async () => (await api.get<Report>(`/reports/${id}`)).data,
        enabled: Number.isFinite(id) && id > 0,
        staleTime: 30_000,
        retry: false,
    });
}

export function useCreateReport() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateReportInput) => (await api.post<Report>('/reports', input)).data,
        onSuccess: (r) => {
            qc.setQueryData(reportsKeys.one(r.id), r);
            void qc.invalidateQueries({ queryKey: reportsKeys.list() });
        },
    });
}

export function useUpdateReport(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (patch: UpdateReportInput) => (await api.patch<Report>(`/reports/${id}`, patch)).data,
        onSuccess: (r) => {
            qc.setQueryData(reportsKeys.one(id), r);
            void qc.invalidateQueries({ queryKey: reportsKeys.list() });
            void qc.invalidateQueries({ queryKey: reportsKeys.bundleOf(id) });
        },
    });
}

export function useDeleteReport() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/reports/${id}`);
            return id;
        },
        onSuccess: (id) => {
            qc.removeQueries({ queryKey: reportsKeys.one(id) });
            qc.removeQueries({ queryKey: reportsKeys.bundleOf(id) });
            void qc.invalidateQueries({ queryKey: reportsKeys.list() });
        },
    });
}

export function useDuplicateReport() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => (await api.post<Report>(`/reports/${id}/duplicate`)).data,
        onSuccess: (r) => {
            qc.setQueryData(reportsKeys.one(r.id), r);
            void qc.invalidateQueries({ queryKey: reportsKeys.list() });
        },
    });
}

/** El informe calculado en UN pedido, con el período y la comparación de quien mira. */
export function useReportBundle(id: number, scope: ReportScope, enabled = true) {
    return useQuery({
        queryKey: reportsKeys.bundle(id, scope.period, scope.compare),
        queryFn: async () => (await api.post<ReportBundle>(`/reports/${id}/bundle`, { period: scope.period, compare: scope.compare })).data,
        enabled: enabled && id > 0,
        staleTime: 30_000,
        placeholderData: (prev) => prev,
        retry: false,
    });
}

/** Vista previa del editor: los bloques SIN guardar, con el mismo motor. */
export function useReportPreview(blocks: ReportBlock[] | null, scope: ReportScope) {
    const body = blocks ? JSON.stringify({ blocks, period: scope.period, compare: scope.compare }) : '';
    return useQuery({
        queryKey: reportsKeys.preview(body),
        queryFn: async () => (await api.post<ReportBundle>('/reports/preview', JSON.parse(body) as unknown)).data,
        enabled: blocks !== null && blocks.length > 0,
        staleTime: 30_000,
        placeholderData: (prev) => prev,
        retry: false,
    });
}

/**
 * La vista previa de UN bloque en el diálogo del widget: el bloque solo,
 * calculado por la vista previa del informe (mismo motor, mismo ACL).
 */
export function useReportWidgetPreview(widget: WidgetSpec | null, scope: ReportScope) {
    const blocks: ReportBlock[] | null = widget
        ? [{ id: 'preview', type: 'widget', widget: { type: widget.type as never, list_id: widget.list_id, title: widget.title, config: widget.config } }]
        : null;
    const q = useReportPreview(blocks, scope);
    const entry: unknown = q.data?.data.preview;
    const failed = entry === undefined ? null : widgetErrorOf(entry);
    return {
        data: failed === null ? (entry as WidgetData | undefined) : undefined,
        isLoading: q.isLoading,
        error: q.error ?? (failed !== null ? new Error(failed) : null),
    };
}

/** Descarga el informe en PDF o Excel (con el período y la comparación de quien mira). */
export async function downloadReport(id: number, format: ReportExportFormat, scope: ReportScope): Promise<void> {
    const boot = getBootData();
    const headers: Record<string, string> = {};
    if (boot.tenantId !== null) headers['X-Tenant-Id'] = String(boot.tenantId);
    const qs = new URLSearchParams({ format, period: scope.period, compare: scope.compare });
    const res = await fetch(`${boot.restRoot.replace(/\/$/, '')}/reports/${id}/export?${qs.toString()}`, {
        method: 'GET',
        headers,
        credentials: 'include',
    });
    if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? '';
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
    const plain = /filename="?([^";]+)"?/i.exec(cd)?.[1];
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = star ? decodeURIComponent(star) : plain ?? `informe.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
