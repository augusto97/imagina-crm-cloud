import { useMemo } from 'react';
import { Scissors } from 'lucide-react';
import type { ReportBlock, ReportWidgetBlock } from '@imagina-base/shared';

import { renderMarkdown } from '@/admin/records/crm/blocks/SimpleBlockViews';
import { WidgetRenderer } from '@/admin/dashboards/widgets/WidgetRenderer';
import {
    DashboardBundleContext,
    WidgetDataOverrideContext,
    widgetErrorOf,
    type DashboardBundleScope,
    type WidgetDataOverride,
} from '@/hooks/useDashboards';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { WidgetData } from '@/types/dashboard';

import { specFromBlock } from './reportEditor';

/** Alto de cada tipo de bloque de datos en la página (el PDF tiene los suyos). */
const BLOCK_HEIGHT: Record<string, number> = {
    kpi: 150,
    stat_delta: 150,
    gauge: 210,
    chart_bar: 310,
    chart_pie: 310,
    chart_line: 290,
    chart_area: 290,
    funnel: 290,
    table: 380,
    pivot: 380,
    forecast: 360,
};

/**
 * v0.1.464 (J1) — Un informe dibujado: de arriba abajo, cada bloque de datos
 * con los MISMOS componentes de los tableros (datos inyectados desde el
 * bundle del informe). Lo usan la página del informe y el centro del editor
 * (que además deja elegir cada bloque).
 */
export function ReportDocument({
    blocks,
    data,
    loading,
    error,
    period,
    compare,
    selectedId = null,
    onSelect,
    editing = false,
}: {
    blocks: ReportBlock[];
    data: Record<string, unknown> | undefined;
    loading: boolean;
    error: Error | null;
    period: string;
    compare: string;
    selectedId?: string | null;
    onSelect?: (id: string) => void;
    editing?: boolean;
}): JSX.Element {
    const override = useMemo<WidgetDataOverride>(
        () => ({
            get: (id) => {
                const entry = data?.[id];
                const failed = entry === undefined ? null : widgetErrorOf(entry);
                return {
                    data: failed === null ? (entry as WidgetData | undefined) : undefined,
                    isLoading: loading && entry === undefined,
                    error: failed !== null ? new Error(failed) : entry === undefined && !loading ? error ?? null : null,
                };
            },
        }),
        [data, loading, error],
    );
    const scope = useMemo<DashboardBundleScope>(() => ({ period, filters: [], compare }), [period, compare]);

    const pick = (id: string) => (e: React.MouseEvent): void => {
        if (!onSelect) return;
        e.stopPropagation();
        onSelect(id);
    };
    const selectable = (id: string): string =>
        cn(
            onSelect && 'imcrm-cursor-pointer imcrm-rounded-xl imcrm-outline-none imcrm-transition-shadow',
            onSelect && (selectedId === id ? 'imcrm-ring-2 imcrm-ring-primary imcrm-ring-offset-2 imcrm-ring-offset-background' : 'hover:imcrm-ring-1 hover:imcrm-ring-primary/40 hover:imcrm-ring-offset-2 hover:imcrm-ring-offset-background'),
        );

    const dataBlock = (b: ReportWidgetBlock): JSX.Element => (
        <div
            key={b.id}
            className={cn('imcrm-min-w-0', selectable(b.id))}
            onClick={pick(b.id)}
            data-report-block={b.id}
            data-testid="report-block"
        >
            <div
                className="imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 imcrm-shadow-imcrm-sm"
                style={{ height: BLOCK_HEIGHT[b.widget.type] ?? 300 }}
            >
                <WidgetRenderer dashboardId={0} widget={specFromBlock(b)} />
            </div>
        </div>
    );

    return (
        <DashboardBundleContext.Provider value={scope}>
            <WidgetDataOverrideContext.Provider value={override}>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="report-document">
                    {blocks.map((b) => {
                        switch (b.type) {
                            case 'heading':
                                return (
                                    <div key={b.id} className={cn('imcrm-pt-2', selectable(b.id))} onClick={pick(b.id)} data-report-block={b.id} data-testid="report-block">
                                        <h2 className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight imcrm-text-foreground sm:imcrm-text-xl">
                                            {b.text || (editing ? __('Título de sección') : '')}
                                        </h2>
                                        {b.subtitle && <p className="imcrm-mt-0.5 imcrm-text-sm imcrm-text-muted-foreground">{b.subtitle}</p>}
                                    </div>
                                );
                            case 'text':
                                return (
                                    <div key={b.id} className={selectable(b.id)} onClick={pick(b.id)} data-report-block={b.id} data-testid="report-block">
                                        {b.text.trim() === '' ? (
                                            editing ? <p className="imcrm-text-sm imcrm-italic imcrm-text-muted-foreground">{__('Escribe el texto en el panel de la derecha.')}</p> : null
                                        ) : (
                                            <div
                                                className="imcrm-prose-sm imcrm-text-sm imcrm-leading-relaxed imcrm-text-foreground"
                                                // renderMarkdown escapa el HTML antes de aplicar el formato.
                                                dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text) }}
                                            />
                                        )}
                                    </div>
                                );
                            case 'widget':
                                return dataBlock(b);
                            case 'columns':
                                return (
                                    <div
                                        key={b.id}
                                        className={cn(
                                            'imcrm-grid imcrm-grid-cols-1 imcrm-gap-4',
                                            b.children.length === 3 ? 'md:imcrm-grid-cols-3' : 'md:imcrm-grid-cols-2',
                                            editing && selectedId === b.id && 'imcrm-rounded-xl imcrm-ring-2 imcrm-ring-primary/50 imcrm-ring-offset-4 imcrm-ring-offset-background',
                                        )}
                                        data-report-block={b.id}
                                        data-testid="report-columns"
                                    >
                                        {b.children.map((c) => dataBlock(c))}
                                    </div>
                                );
                            case 'divider':
                                return (
                                    <div key={b.id} className={cn('imcrm-py-2', selectable(b.id))} onClick={pick(b.id)} data-report-block={b.id}>
                                        <hr className="imcrm-border-border" />
                                    </div>
                                );
                            case 'page_break':
                                return editing ? (
                                    <div
                                        key={b.id}
                                        className={cn('imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-1 imcrm-text-[11px] imcrm-text-muted-foreground', selectable(b.id))}
                                        onClick={pick(b.id)}
                                        data-report-block={b.id}
                                    >
                                        <span className="imcrm-h-px imcrm-flex-1 imcrm-border-t imcrm-border-dashed imcrm-border-border" />
                                        <Scissors className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                        {__('Salto de página (sólo en el PDF)')}
                                        <span className="imcrm-h-px imcrm-flex-1 imcrm-border-t imcrm-border-dashed imcrm-border-border" />
                                    </div>
                                ) : null;
                        }
                    })}
                </div>
            </WidgetDataOverrideContext.Provider>
        </DashboardBundleContext.Provider>
    );
}
