import type { WidgetSpec } from '@/types/dashboard';

import { BarChartWidget } from './BarChartWidget';
import {
    DividerWidget,
    HeadingWidget,
    ImageWidget,
    SpacerWidget,
    TextWidget,
} from './ContentWidgets';
import { FunnelWidget } from './FunnelWidget';
import { GaugeWidget } from './GaugeWidget';
import { KpiWidget } from './KpiWidget';
import { LineChartWidget } from './LineChartWidget';
import { PieChartWidget } from './PieChartWidget';
import { StatDeltaWidget } from './StatDeltaWidget';
import { TableWidget } from './TableWidget';

/**
 * Elige el componente de un widget por su tipo. Compartido por los tableros
 * y la ficha del registro (v0.1.230), que dibuja sus gráficos con los mismos
 * componentes inyectándoles los datos (`WidgetDataOverrideContext`).
 */
export function WidgetRenderer({
    dashboardId,
    widget,
}: {
    dashboardId: number;
    widget: WidgetSpec;
}): JSX.Element {
    switch (widget.type) {
        case 'heading':
            return <HeadingWidget widget={widget} />;
        case 'text':
            return <TextWidget widget={widget} />;
        case 'image':
            return <ImageWidget widget={widget} />;
        case 'divider':
            return <DividerWidget />;
        case 'spacer':
            return <SpacerWidget />;
        case 'kpi':
            return <KpiWidget dashboardId={dashboardId} widget={widget} />;
        case 'gauge':
            return <GaugeWidget dashboardId={dashboardId} widget={widget} />;
        case 'chart_bar':
            return <BarChartWidget dashboardId={dashboardId} widget={widget} />;
        case 'chart_pie':
            return <PieChartWidget dashboardId={dashboardId} widget={widget} />;
        case 'chart_area':
            return <LineChartWidget dashboardId={dashboardId} widget={widget} area />;
        case 'stat_delta':
            return <StatDeltaWidget dashboardId={dashboardId} widget={widget} />;
        case 'table':
            return <TableWidget dashboardId={dashboardId} widget={widget} />;
        case 'funnel':
            return <FunnelWidget dashboardId={dashboardId} widget={widget} />;
        case 'chart_line':
        default:
            return <LineChartWidget dashboardId={dashboardId} widget={widget} />;
    }
}
