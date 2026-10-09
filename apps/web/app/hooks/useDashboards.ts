import { createContext, useContext } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
    CreateDashboardInput,
    DashboardEntity,
    UpdateDashboardInput,
    WidgetData,
} from '@/types/dashboard';

export const dashboardsKeys = {
    all: ['dashboards'] as const,
    one: (id: string | number) => [...dashboardsKeys.all, 'one', String(id)] as const,
    widgetData: (dashboardId: string | number, widgetId: string) =>
        [...dashboardsKeys.all, 'widget-data', String(dashboardId), widgetId] as const,
    /**
     * PERF-03: key ÚNICA por dashboard para el bundle de todos los widgets.
     * v0.1.100 — incluye el período GLOBAL activo (cambiarlo refetchea el
     * bundle completo con el override).
     */
    widgetsData: (dashboardId: string | number, period = '') =>
        [...dashboardsKeys.all, 'widgets-data', String(dashboardId), period] as const,
};

/**
 * Período GLOBAL del dashboard activo ('' = sin filtro). Lo provee
 * DashboardPage; los widgets lo leen para armar el queryKey/body del
 * bundle sin prop-drilling por cada tipo de widget.
 */
export const DashboardGlobalPeriodContext = createContext<string>('');

export function useDashboards() {
    return useQuery({
        queryKey: dashboardsKeys.all,
        queryFn: async () => {
            const res = await api.get<DashboardEntity[]>('/dashboards');
            return res.data;
        },
        staleTime: 60_000, // Fase 16.D
    });
}

export function useDashboard(id: number | undefined) {
    return useQuery({
        queryKey: dashboardsKeys.one(id ?? 0),
        queryFn: async () => {
            const res = await api.get<DashboardEntity>(`/dashboards/${id}`);
            return res.data;
        },
        enabled: id !== undefined && id > 0,
        staleTime: 60_000, // Fase 16.D
    });
}

export function useCreateDashboard() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateDashboardInput) => {
            const res = await api.post<DashboardEntity>('/dashboards', input);
            return res.data;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: dashboardsKeys.all });
        },
    });
}

export function useUpdateDashboard(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: UpdateDashboardInput) => {
            const res = await api.patch<DashboardEntity>(`/dashboards/${id}`, input);
            return res.data;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: dashboardsKeys.one(id) });
            void qc.invalidateQueries({ queryKey: dashboardsKeys.all });
        },
    });
}

/**
 * v0.1.98 — duplicar un dashboard completo: widgets con ids nuevos (copia
 * profunda de la config) + settings + visibilidad. Lo usan el índice y el
 * menú contextual del panel (v0.1.172).
 */
export function useDuplicateDashboard() {
    const create = useCreateDashboard();
    return useMutation({
        mutationFn: async (src: DashboardEntity) =>
            create.mutateAsync({
                name: `${src.name} (copia)`,
                description: src.description,
                widgets: src.widgets.map((w) => ({
                    ...w,
                    id: `w-${Math.random().toString(36).slice(2, 10)}`,
                    config: JSON.parse(JSON.stringify(w.config)) as typeof w.config,
                })),
                settings: src.settings,
                visibility: src.visibility,
                allowed_roles: src.allowed_roles,
            }),
    });
}

export function useDeleteDashboard() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/dashboards/${id}`);
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: dashboardsKeys.all });
        },
    });
}

/**
 * Datos de UN widget. Comparte el queryKey del bundle (`widgetsData`) con los
 * demás widgets → TanStack Query dedupe la request (UNA sola llamada HTTP por
 * tablero) y `select` entrega a cada widget su propio dato. El shape de retorno
 * es el mismo UseQueryResult<WidgetData> de antes (PERF-03).
 */
/**
 * v0.1.230 — datos de widgets INYECTADOS: la ficha del registro dibuja sus
 * gráficos con los MISMOS componentes de los tableros, pero los datos vienen
 * de su propio bundle (acotado a los registros vinculados). Con este
 * contexto presente, `useWidgetData` no pide nada: lee de aquí.
 */
export interface WidgetDataOverride {
    get(widgetId: string): { data: WidgetData | undefined; isLoading: boolean; error: Error | null };
}
export const WidgetDataOverrideContext = createContext<WidgetDataOverride | null>(null);

export function useWidgetData(dashboardId: number | undefined, widgetId: string | undefined) {
    const globalPeriod = useContext(DashboardGlobalPeriodContext);
    const override = useContext(WidgetDataOverrideContext);
    const query = useQuery({
        queryKey: dashboardsKeys.widgetsData(dashboardId ?? 0, globalPeriod),
        queryFn: async () => {
            const res = await api.post<Record<string, WidgetData>>(
                `/dashboards/${dashboardId}/widgets/data`,
                globalPeriod !== '' ? { period_preset: globalPeriod } : {},
            );
            return res.data;
        },
        enabled:
            override === null &&
            dashboardId !== undefined &&
            dashboardId > 0 &&
            widgetId !== undefined &&
            widgetId !== '',
        staleTime: 30 * 1000,
        // v0.1.229 — el bundle trae el error de CADA widget por separado
        // (`{ __error }`): tirarlo desde `select` pone en error SÓLO al widget
        // que lo tiene; los demás siguen con su dato.
        select: (all: Record<string, WidgetData>): WidgetData | undefined => {
            const one = widgetId ? all[widgetId] : undefined;
            const failed = widgetErrorOf(one);
            if (failed !== null) throw new Error(failed);
            return one;
        },
    });
    if (override !== null && widgetId !== undefined) {
        const o = override.get(widgetId);
        return { ...query, data: o.data, isLoading: o.isLoading, isError: o.error !== null, error: o.error } as typeof query;
    }
    return query;
}

/** Mensaje de error de un widget dentro del bundle, o `null` si trajo datos. */
export function widgetErrorOf(entry: unknown): string | null {
    if (typeof entry !== 'object' || entry === null || !('__error' in entry)) return null;
    const msg = (entry as { __error: unknown }).__error;
    return typeof msg === 'string' && msg !== '' ? msg : 'No se pudo calcular este widget.';
}
