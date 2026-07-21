import { useState } from 'react';

import { blockStyleCss, readBlockStyle, wrapperStyleCss } from '@/lib/blockStyle';
import { groupBlocksByRowsAndColumns } from '@/lib/rowsLayout';

import { ActivityTimelineBlock } from './blocks/ActivityTimelineBlock';
import { ClientDataBlock } from './blocks/ClientDataBlock';
import { CommentsThreadBlock } from './blocks/CommentsThreadBlock';
import { ContactCardBlock } from './blocks/ContactCardBlock';
import { DividerBlock } from './blocks/DividerBlock';
import { DownloadFilesBlock } from './blocks/DownloadFilesBlock';
import { EditableFormBlock } from './blocks/EditableFormBlock';
import { ExternalLinkBlock } from './blocks/ExternalLinkBlock';
import { FaqBlock } from './blocks/FaqBlock';
import { HeadingBlock } from './blocks/HeadingBlock';
import { HeroBlock } from './blocks/HeroBlock';
import { ImageBlock } from './blocks/ImageBlock';
import { KpiWidgetBlock } from './blocks/KpiWidgetBlock';
import { NoticeBlock } from './blocks/NoticeBlock';
import { QuickActionsBlock } from './blocks/QuickActionsBlock';
import { RelatedRecordsTableBlock } from './blocks/RelatedRecordsTableBlock';
import { StaticTextBlock } from './blocks/StaticTextBlock';
import { StatsGridBlock } from './blocks/StatsGridBlock';
import type { PortalBlock, PortalBootData, PortalFieldMeta, PortalRecord } from './types';

/** Datos ya resueltos por el caller (el SPA fetchea `/portal/me`). */
export interface PortalRendererData {
    record: PortalRecord;
    fields: PortalFieldMeta[];
    template: { blocks: PortalBlock[] };
}

interface Props {
    boot: PortalBootData;
    data: PortalRendererData;
}

/**
 * Renderer principal del portal. Recibe `template.blocks` + `record` ya
 * resueltos y los itera renderizando el componente apropiado por
 * `block.type` (los interactivos fetchean sus endpoints `/portal/*`).
 *
 * Bloques desconocidos (versionado futuro) se ignoran silenciosamente —
 * mismo criterio que el parser del template en el backend.
 */
export function PortalRenderer({ boot, data }: Props): JSX.Element {
    // Bloques de tipo `notice` con `dismissible: true` pueden ser
    // cerrados por el cliente. Guardamos el set de índices cerrados
    // acá (no dentro del NoticeBlock) para poder excluir el wrapper
    // de grid completo — sino el slot del grid quedaba como espacio
    // vacío y los bloques de abajo no se desplazaban hacia arriba.
    // El state es local a la sesión; no persiste entre recargas.
    const [dismissed, setDismissed] = useState<Set<number>>(new Set());

    // 0.57.24 — Layout filas → columnas → bloques apilados.
    //
    // Cada fila contiene N columnas (con ancho propio en /12). Cada
    // columna contiene una pila vertical de bloques. El HTML/CSS es
    // idéntico al editor: clases `imcrm-rows-layout` / `imcrm-row` /
    // `imcrm-row__cell`. Bloques apilados se separan con `gap: 12px`
    // del CSS del cell (flex column).
    if (data.template.blocks.length === 0) return <></>;

    const rows = groupBlocksByRowsAndColumns(
        data.template.blocks.map((b, i) => ({ ...b, __idx: i })),
    );

    return (
        <div className="imcrm-rows-layout">
            {rows.map((row) => {
                // Si TODOS los bloques de la fila están dismissed,
                // no renderizamos la fila para no generar gap inútil.
                const visibleColumns = row.columns
                    .map((col) => ({
                        ...col,
                        blocks: col.blocks.filter((b) => ! dismissed.has(b.__idx)),
                    }))
                    .filter((col) => col.blocks.length > 0);

                if (visibleColumns.length === 0) return null;

                // 0.57.29 — spacing (y desde v0.1.93 fondo) de la sección
                // leído del primer bloque (consistente entre hermanos).
                const firstBlockOfSec = visibleColumns[0]?.blocks[0];
                const sectionStyle = wrapperStyleCss({
                    bg: firstBlockOfSec?.secBg,
                    padding: firstBlockOfSec?.secPadding,
                    margin: firstBlockOfSec?.secMargin,
                });

                return (
                    <div
                        key={`row-${row.index}`}
                        className="imcrm-row"
                        style={sectionStyle}
                    >
                        {visibleColumns.map((col) => {
                            // 0.57.38 — `flex: w w 0` (ver nota en globals.css).
                            const firstBlockOfCol = col.blocks[0];
                            const cellStyle: React.CSSProperties = {
                                flex: `${col.width} ${col.width} 0`,
                                ...wrapperStyleCss({
                                    bg: firstBlockOfCol?.colBg,
                                    padding: firstBlockOfCol?.colPadding,
                                    margin: firstBlockOfCol?.colMargin,
                                }),
                            };
                            return (
                                <div
                                    key={`col-${row.index}-${col.colIdx}`}
                                    className="imcrm-row__cell"
                                    style={cellStyle}
                                >
                                    {col.blocks.map((block) => {
                                        const handleDismiss = (): void => {
                                            setDismissed((prev) => {
                                                const next = new Set(prev);
                                                next.add(block.__idx);
                                                return next;
                                            });
                                        };
                                        const rendered = renderBlock(
                                            block,
                                            block.__idx,
                                            data,
                                            boot,
                                            handleDismiss,
                                        );
                                        if (rendered === null) return null;
                                        const maxH = readMaxHeight(
                                            block.config as Record<string, unknown>,
                                        );
                                        // v0.1.93 — estilo por bloque (config.style):
                                        // el mismo wrapper que aplica el editor.
                                        const wrapStyle: React.CSSProperties = {
                                            ...blockStyleCss(
                                                readBlockStyle(
                                                    block.config as Record<string, unknown>,
                                                ),
                                            ),
                                            ...(maxH !== null
                                                ? { maxHeight: `${maxH}px`, overflowY: 'auto' as const }
                                                : {}),
                                        };
                                        return (
                                            <div key={block.__idx} style={wrapStyle}>
                                                {rendered}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}

/**
 * Lee `config.max_height` y devuelve el valor en px o null. Valida
 * que sea un número > 0 — cualquier otra cosa (string, NaN, 0,
 * negativo) se ignora. Permite al admin limitar la altura del
 * bloque desde el editor cuando no quiere que crezca indefinidamente
 * (ej. listados largos), sumando scroll interno automáticamente
 * desde el CSS del cell.
 */
function readMaxHeight(config: Record<string, unknown>): number | null {
    const v = config['max_height'];
    if (typeof v !== 'number') return null;
    if (! Number.isFinite(v) || v <= 0) return null;
    return Math.floor(v);
}

function renderBlock(
    block: PortalBlock & { __idx?: number },
    idx: number,
    data: PortalRendererData,
    boot: PortalBootData,
    /** Solo lo consumen los bloques con UI de cierre (notice). */
    onDismiss: () => void,
): JSX.Element | null {
    switch (block.type) {
        case 'static_text':
            return <StaticTextBlock key={idx} config={block.config} />;
        case 'client_data':
            return (
                <ClientDataBlock
                    key={idx}
                    config={block.config}
                    record={data.record}
                    fields={data.fields ?? []}
                />
            );
        case 'related_records_table':
            return <RelatedRecordsTableBlock key={idx} config={block.config} boot={boot} />;
        case 'editable_form':
            return (
                <EditableFormBlock
                    key={idx}
                    config={block.config}
                    record={data.record}
                    boot={boot}
                />
            );
        case 'external_link':
            return <ExternalLinkBlock key={idx} config={block.config} />;
        case 'kpi_widget':
            return <KpiWidgetBlock key={idx} config={block.config} boot={boot} />;
        case 'activity_timeline':
            return <ActivityTimelineBlock key={idx} config={block.config} boot={boot} />;
        case 'download_files':
            return <DownloadFilesBlock key={idx} config={block.config} record={data.record} />;
        case 'comments_thread':
            return <CommentsThreadBlock key={idx} config={block.config} boot={boot} />;
        case 'heading':
            return <HeadingBlock key={idx} config={block.config} />;
        case 'hero':
            return <HeroBlock key={idx} config={block.config} record={data.record} />;
        case 'stats_grid':
            return <StatsGridBlock key={idx} config={block.config} boot={boot} />;
        case 'quick_actions':
            return <QuickActionsBlock key={idx} config={block.config} />;
        case 'notice':
            return <NoticeBlock key={idx} config={block.config} onDismiss={onDismiss} />;
        case 'divider':
            return <DividerBlock key={idx} config={block.config} />;
        case 'faq':
            return <FaqBlock key={idx} config={block.config} />;
        case 'contact_card':
            return <ContactCardBlock key={idx} config={block.config} />;
        case 'image':
            return <ImageBlock key={idx} config={block.config} />;
        case 'nested_section':
            return (
                <div key={idx} className="imcrm-rows-layout">
                    <div className="imcrm-row">
                        {block.config.columns.map((col, cIdx) => {
                            return (
                                <div
                                    key={col.id ?? cIdx}
                                    className="imcrm-row__cell"
                                    style={{ flex: `${col.width} ${col.width} 0` }}
                                >
                                    {col.blocks.map((subBlock, subIdx) => {
                                        // Recursivo — los sub-bloques son del mismo tipo
                                        // que los top-level (excepto nested_section, que
                                        // se filtra a 1 nivel desde el editor).
                                        const sub = renderBlock(
                                            subBlock,
                                            // Key compuesta para evitar colisiones con
                                            // los keys del nivel superior.
                                            (idx * 1000) + (cIdx * 100) + subIdx,
                                            data,
                                            boot,
                                            // Los sub-bloques no soportan dismiss (los
                                            // notice dismissibles solo tienen sentido a
                                            // nivel top-level del template).
                                            () => undefined,
                                        );
                                        if (sub === null) return null;
                                        return (
                                            <div
                                                key={`s-${cIdx}-${subIdx}`}
                                                style={blockStyleCss(
                                                    readBlockStyle(
                                                        subBlock.config as Record<string, unknown>,
                                                    ),
                                                )}
                                            >
                                                {sub}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        default:
            return null;
    }
}
