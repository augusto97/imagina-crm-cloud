import { createContext, useContext } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { getBootData } from '@/lib/boot';
import { CAP, useCan } from '@/lib/permissions';
import type {
    CreateDashboardInput,
    DashboardEntity,
    DashboardFilterValue,
    UpdateDashboardInput,
    WidgetData,
    WidgetSpec,
} from '@/types/dashboard';

export const dashboardsKeys = {
    all: ['dashboards'] as const,
    one: (id: string | number) => [...dashboardsKeys.all, 'one', String(id)] as const,
    widgetData: (dashboardId: string | number, widgetId: string) =>
        [...dashboardsKeys.all, 'widget-data', String(dashboardId), widgetId] as const,
    /** Prefijo de TODOS los bundles de un tablero (cualquier período/filtro). */
    widgetsDataOf: (dashboardId: string | number) =>
        [...dashboardsKeys.all, 'widgets-data', String(dashboardId)] as const,
    /**
     * PERF-03: key ÚNICA por dashboard para el bundle de todos los widgets.
     * v0.1.100 — incluye el período GLOBAL activo; v0.1.286 — y los filtros
     * del tablero (cambiarlos refetchea el bundle completo).
     */
    widgetsData: (dashboardId: string | number, period = '', filters = '') =>
        [...dashboardsKeys.all, 'widgets-data', String(dashboardId), period, filters] as const,
    /** v0.1.286 — vista previa de un widget sin guardar. */
    preview: (dashboardId: string | number, body: string) =>
        [...dashboardsKeys.all, 'widgets-data', String(dashboardId), 'preview', body] as const,
};

/**
 * Lo que el tablero activo manda en el body del bundle: el período GLOBAL
 * ('' = cada widget con el suyo) y, desde v0.1.286, los filtros del tablero.
 * Lo provee DashboardPage; los widgets lo leen para armar queryKey/body sin
 * prop-drilling por cada tipo de widget.
 */
export interface DashboardBundleScope {
    period: string;
    filters: DashboardFilterValue[];
}
export const DashboardBundleContext = createContext<DashboardBundleScope>({ period: '', filters: [] });

/** Compat: el período global suelto (lo usan el selector y el badge). */
export function useDashboardPeriod(): string {
    return useContext(DashboardBundleContext).period;
}

export function bundleBody(scope: DashboardBundleScope): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    if (scope.period !== '') body.period_preset = scope.period;
    if (scope.filters.length > 0) body.filters = scope.filters;
    return body;
}

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
            // Sólo el listado: `invalidateQueries(['dashboards'])` sin `exact`
            // también recalculaba TODOS los bundles abiertos.
            void qc.invalidateQueries({ queryKey: dashboardsKeys.all, exact: true });
        },
    });
}

/**
 * ¿Cambió algo que mueve los DATOS de los widgets? El layout (x/y/w/h, el
 * alto del celular) y el estilo del card se dibujan en el cliente: arrastrar o
 * redimensionar no tiene por qué recalcular el tablero entero (v0.1.286).
 */
export function widgetsDataChanged(prev: readonly WidgetSpec[], next: readonly WidgetSpec[]): boolean {
    const strip = (ws: readonly WidgetSpec[]): string =>
        JSON.stringify(
            [...ws]
                .map((w) => {
                    const { style: _style, ...config } = (w.config ?? {}) as Record<string, unknown>;
                    void _style;
                    return { id: w.id, type: w.type, list_id: w.list_id, config };
                })
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
        );
    const prevIds = new Set(prev.map((w) => w.id));
    // Un widget QUITADO no necesita datos nuevos; uno agregado o cambiado sí.
    const kept = next.filter((w) => prevIds.has(w.id));
    if (kept.length !== next.length) return true;
    const nextIds = new Set(next.map((w) => w.id));
    return strip(prev.filter((w) => nextIds.has(w.id))) !== strip(next);
}

export function useUpdateDashboard(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: UpdateDashboardInput) => {
            const res = await api.patch<DashboardEntity>(`/dashboards/${id}`, input);
            return res.data;
        },
        // v0.1.286 — optimista: soltar un widget lo deja donde quedó al
        // instante (antes volvía a su lugar hasta que llegaba la respuesta).
        onMutate: async (input) => {
            await qc.cancelQueries({ queryKey: dashboardsKeys.one(id), exact: true });
            const prev = qc.getQueryData<DashboardEntity>(dashboardsKeys.one(id));
            if (prev) qc.setQueryData<DashboardEntity>(dashboardsKeys.one(id), { ...prev, ...(input as Partial<DashboardEntity>) });
            return { prev };
        },
        onError: (_err, _input, ctx) => {
            if (ctx?.prev) qc.setQueryData(dashboardsKeys.one(id), ctx.prev);
        },
        onSuccess: (data, input, ctx) => {
            qc.setQueryData(dashboardsKeys.one(id), data);
            qc.setQueryData<DashboardEntity[]>(dashboardsKeys.all, (list) =>
                list?.map((d) => (d.id === id ? data : input.is_default ? { ...d, is_default: false } : d)),
            );
            // Sólo si cambió lo que se CALCULA (no en un drag/resize).
            if (input.widgets !== undefined && widgetsDataChanged(ctx?.prev?.widgets ?? [], input.widgets)) {
                void qc.invalidateQueries({ queryKey: dashboardsKeys.widgetsDataOf(id) });
            }
        },
    });
}

/**
 * v0.1.286 — reordenar los tableros del panel arrastrando (como las listas):
 * optimista y con vuelta atrás si el servidor rechaza.
 */
export function useReorderDashboards() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (ids: number[]) => {
            const res = await api.patch<DashboardEntity[]>('/dashboards/reorder', { ids });
            return res.data;
        },
        onMutate: async (ids) => {
            await qc.cancelQueries({ queryKey: dashboardsKeys.all, exact: true });
            const prev = qc.getQueryData<DashboardEntity[]>(dashboardsKeys.all);
            if (prev) {
                const byId = new Map(prev.map((d) => [d.id, d]));
                const next = ids.map((x) => byId.get(x)).filter((d): d is DashboardEntity => d !== undefined);
                if (next.length === prev.length) qc.setQueryData(dashboardsKeys.all, next);
            }
            return { prev };
        },
        onError: (_e, _ids, ctx) => {
            if (ctx?.prev) qc.setQueryData(dashboardsKeys.all, ctx.prev);
        },
        onSettled: () => {
            void qc.invalidateQueries({ queryKey: dashboardsKeys.all, exact: true });
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
        onSuccess: (_data, id) => {
            qc.setQueryData<DashboardEntity[]>(dashboardsKeys.all, (list) => list?.filter((d) => d.id !== id));
            void qc.invalidateQueries({ queryKey: dashboardsKeys.all, exact: true });
            qc.removeQueries({ queryKey: dashboardsKeys.widgetsDataOf(id) });
        },
    });
}

/**
 * v0.1.286 — Un cambio en registros de `listId` (realtime, otra pestaña u
 * otra persona) recalcula SÓLO los tableros con algún widget sobre esa lista.
 * Antes ningún tablero se enteraba: quedaban viejos hasta recargar. Sin
 * `listId` (evento genérico) o sin tableros en cache, recalcula todos.
 */
export function invalidateDashboardsForList(qc: QueryClient, listId: number | undefined): void {
    if (listId === undefined) {
        void qc.invalidateQueries({ queryKey: [...dashboardsKeys.all, 'widgets-data'] });
        return;
    }
    const ids = new Set<number>();
    for (const [, data] of qc.getQueriesData<DashboardEntity | DashboardEntity[]>({ queryKey: dashboardsKeys.all })) {
        const items = Array.isArray(data) ? data : data && typeof data === 'object' && 'widgets' in data ? [data] : [];
        for (const d of items) {
            if (Array.isArray(d.widgets) && d.widgets.some((w) => w.list_id === listId)) ids.add(d.id);
        }
    }
    for (const id of ids) void qc.invalidateQueries({ queryKey: dashboardsKeys.widgetsDataOf(id) });
}

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

/**
 * Datos de UN widget. Comparte el queryKey del bundle (`widgetsData`) con los
 * demás widgets → TanStack Query dedupe la request (UNA sola llamada HTTP por
 * tablero) y `select` entrega a cada widget su propio dato. El shape de retorno
 * es el mismo UseQueryResult<WidgetData> de antes (PERF-03).
 */
export function useWidgetData(dashboardId: number | undefined, widgetId: string | undefined) {
    const scope = useContext(DashboardBundleContext);
    const override = useContext(WidgetDataOverrideContext);
    const filtersKey = scope.filters.length > 0 ? JSON.stringify(scope.filters) : '';
    const query = useQuery({
        queryKey: dashboardsKeys.widgetsData(dashboardId ?? 0, scope.period, filtersKey),
        queryFn: async () => {
            const res = await api.post<Record<string, WidgetData>>(
                `/dashboards/${dashboardId}/widgets/data`,
                bundleBody(scope),
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

/**
 * v0.1.286 — Vista previa de un widget SIN guardar (el diálogo de edición).
 * Con el mismo período y filtros que el tablero que se está mirando.
 */
export function useWidgetPreview(dashboardId: number | undefined, widget: WidgetSpec | null, scope: DashboardBundleScope) {
    const body = widget ? JSON.stringify({ widget, ...bundleBody(scope) }) : '';
    return useQuery({
        queryKey: dashboardsKeys.preview(dashboardId ?? 0, body),
        queryFn: async () => {
            const res = await api.post<WidgetData>(`/dashboards/${dashboardId}/widgets/preview`, JSON.parse(body) as unknown);
            const failed = widgetErrorOf(res.data);
            if (failed !== null) throw new Error(failed);
            return res.data;
        },
        enabled: widget !== null && dashboardId !== undefined && dashboardId > 0,
        staleTime: 30 * 1000,
        placeholderData: (prev) => prev,
        retry: false,
    });
}

/** Mensaje de error de un widget dentro del bundle, o `null` si trajo datos. */
export function widgetErrorOf(entry: unknown): string | null {
    if (typeof entry !== 'object' || entry === null || !('__error' in entry)) return null;
    const msg = (entry as { __error: unknown }).__error;
    return typeof msg === 'string' && msg !== '' ? msg : 'No se pudo calcular este widget.';
}

/**
 * v0.1.286 — ¿Quien mira puede EDITAR este tablero? Hace falta
 * `manage_dashboards` y ser su creador o admin (lo mismo que exige el
 * backend). Sin esto un viewer o un agente veía botones de editar, mover y
 * borrar que terminaban en 403.
 */
export function useCanEditDashboard(d: Pick<DashboardEntity, 'created_by'> | undefined): boolean {
    const canManage = useCan(CAP.MANAGE_DASHBOARDS);
    const isAdmin = useCan('workspace_admin');
    if (!d || !canManage) return false;
    return isAdmin || d.created_by === getBootData().user.id;
}
