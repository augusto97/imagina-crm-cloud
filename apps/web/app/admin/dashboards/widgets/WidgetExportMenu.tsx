import { useContext, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, ImageDown, Loader2 } from 'lucide-react';
import {
    buildWidgetReport,
    reportFileName,
    suggestedReportHeight,
    widgetReportCsv,
    widgetReportSvg,
    type ReportField,
    type WidgetReport,
} from '@imagina-base/shared';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWidgetData } from '@/hooks/useDashboards';
import { useFields } from '@/hooks/useFields';
import { useLists } from '@/hooks/useLists';
import { memberNamesFor, MemberDirectoryContext } from '@/hooks/useWpUsers';
import { useToast } from '@/components/ui/toast';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { formatDateTime, getTenantFormat } from '@/lib/tenantFormat';
import { CONTENT_WIDGET_TYPES, type WidgetSpec } from '@/types/dashboard';

import {
    downloadBlob,
    reportContext,
    svgToPngBlob,
    themeFromElement,
    todayYmd,
    userIdsInData,
} from './widgetExport';

/**
 * v0.1.292 — «Descargar imagen (PNG)» y «Descargar datos (CSV)» de un widget.
 * La imagen es el MISMO dibujo que va en el correo programado (SVG del modelo
 * compartido), con los colores del tema que se está viendo, el título y la
 * fecha. Funciona igual en la página pública del tablero (los nombres de las
 * personas salen del directorio del enlace, no de la API del equipo).
 */
export function WidgetExportMenu({
    dashboardId,
    widget,
    className,
}: {
    dashboardId: number;
    widget: WidgetSpec;
    className?: string;
}): JSX.Element | null {
    const qc = useQueryClient();
    const toast = useToast();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const directory = useContext(MemberDirectoryContext);
    const data = useWidgetData(dashboardId, widget.id);
    const fields = useFields(widget.list_id > 0 ? widget.list_id : undefined);
    const lists = useLists();
    const [busy, setBusy] = useState<'png' | 'csv' | null>(null);

    if (CONTENT_WIDGET_TYPES.includes(widget.type)) return null;
    const ready = data.data !== undefined && !data.isError;

    const build = async (): Promise<{ report: WidgetReport; card: Element | null } | null> => {
        const fieldList = (fields.data ?? []) as unknown as ReportField[];
        const fieldOf = (id: unknown): ReportField | undefined => fieldList.find((f) => f.id === Number(id));
        const names = await memberNamesFor(qc, userIdsInData(widget, data.data, fieldOf), directory);
        const card = triggerRef.current?.closest('[data-widget-card]') ?? null;
        const listName = lists.data?.find((l) => l.id === widget.list_id)?.name ?? null;
        const ctx = reportContext({ fields: fieldList, names, format: getTenantFormat(), listName, el: card });
        const report = buildWidgetReport(widget, data.data, ctx);
        return report ? { report, card } : null;
    };

    const run = async (kind: 'png' | 'csv'): Promise<void> => {
        setBusy(kind);
        try {
            const built = await build();
            if (!built) {
                toast.error(__('Este widget todavía no tiene datos para descargar.'));
                return;
            }
            const { report, card } = built;
            const name = reportFileName(report.title, todayYmd());
            if (kind === 'csv') {
                const csv = widgetReportCsv(report, getTenantFormat());
                downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
                return;
            }
            const theme = themeFromElement(card);
            const rect = card?.getBoundingClientRect();
            const width = Math.round(Math.min(1600, Math.max(560, rect?.width ?? 640)));
            const height = Math.max(Math.round(rect?.height ?? 0), suggestedReportHeight(report));
            const svg = widgetReportSvg(report, { width, height, theme, dateText: formatDateTime(new Date()) });
            const png = await svgToPngBlob(svg, width, height, theme.background);
            downloadBlob(png, `${name}.png`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : __('No se pudo descargar.'));
        } finally {
            setBusy(null);
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    ref={triggerRef}
                    type="button"
                    className={cn(
                        'imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground',
                        className,
                    )}
                    aria-label={__('Descargar widget')}
                    title={__('Descargar')}
                    data-testid="imcrm-widget-export"
                >
                    {busy ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Download className="imcrm-h-3.5 imcrm-w-3.5" />}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="imcrm-w-56">
                <DropdownMenuLabel className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                    {__('Descargar')}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!ready || busy !== null} onSelect={() => void run('png')} data-testid="imcrm-widget-export-png">
                    <ImageDown className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" />
                    {__('Descargar imagen (PNG)')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!ready || busy !== null} onSelect={() => void run('csv')} data-testid="imcrm-widget-export-csv">
                    <FileSpreadsheet className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" />
                    {__('Descargar datos (CSV)')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
