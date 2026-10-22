import { REPORT_LIGHT_THEME, suggestedReportHeight, widgetReportSvg, type WidgetReport } from '@imagina-base/shared';
import { pdfFontFamily, renderPdfDefinition } from '../documents/document-render';

/** A4 menos los márgenes (puntos). */
const PAGE_W = 515;
/** Alto útil de la hoja: un gráfico más alto no entra en una página. */
const MAX_H = 720;

/**
 * v0.1.292 (ADR-S50) — El tablero en PDF (adjunto del envío programado):
 * cada widget es el MISMO SVG de la imagen que se descarga desde la app
 * (`widgetReportSvg`), que pdfmake dibuja VECTORIAL — barras, donas, KPIs y
 * tablas nítidos a cualquier zoom, sin navegador ni capturas.
 */
export async function renderDashboardPdf(input: {
    title: string;
    subtitle: string;
    reports: WidgetReport[];
    accent?: string | null;
}): Promise<Buffer> {
    const font = pdfFontFamily('inter');
    const theme = { ...REPORT_LIGHT_THEME, ...(input.accent && /^#[0-9a-f]{6}$/i.test(input.accent) ? { accent: input.accent } : {}) };
    const blocks = input.reports.map((r) => {
        const height = suggestedReportHeight(r, { max: MAX_H });
        return {
            svg: widgetReportSvg(r, { width: PAGE_W, height, theme, font }),
            width: PAGE_W,
            margin: [0, 0, 0, 14],
            unbreakable: true,
        };
    });
    const def = {
        pageSize: 'A4',
        pageMargins: [40, 40, 40, 44],
        info: { title: input.title },
        defaultStyle: { font, fontSize: 10, color: '#1f2937' },
        content: [
            { text: input.title, fontSize: 18, bold: true, margin: [0, 0, 0, 2] },
            { text: input.subtitle, fontSize: 10, color: '#6b7280', margin: [0, 0, 0, 14] },
            ...(blocks.length > 0 ? blocks : [{ text: 'Este tablero no tiene gráficos con datos.', color: '#6b7280' }]),
        ],
        footer: (current: number, total: number) => ({
            text: `Página ${current} de ${total}`,
            alignment: 'right',
            fontSize: 8,
            color: '#9aa1ad',
            margin: [40, 12, 40, 0],
        }),
    };
    return renderPdfDefinition(def);
}
