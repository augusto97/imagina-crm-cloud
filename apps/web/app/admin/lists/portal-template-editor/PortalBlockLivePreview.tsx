import { useMemo } from 'react';

import type { FieldEntity } from '@/types/field';

import { PortalPreviewContext } from '@/portal/PreviewContext';
import { ActivityTimelineBlock } from '@/portal/blocks/ActivityTimelineBlock';
import { ClientDataBlock } from '@/portal/blocks/ClientDataBlock';
import { CommentsThreadBlock } from '@/portal/blocks/CommentsThreadBlock';
import { ContactCardBlock } from '@/portal/blocks/ContactCardBlock';
import { DividerBlock } from '@/portal/blocks/DividerBlock';
import { DownloadFilesBlock } from '@/portal/blocks/DownloadFilesBlock';
import { EditableFormBlock } from '@/portal/blocks/EditableFormBlock';
import { ExternalLinkBlock } from '@/portal/blocks/ExternalLinkBlock';
import { FaqBlock } from '@/portal/blocks/FaqBlock';
import { HeadingBlock } from '@/portal/blocks/HeadingBlock';
import { HeroBlock } from '@/portal/blocks/HeroBlock';
import { KpiWidgetBlock } from '@/portal/blocks/KpiWidgetBlock';
import { NoticeBlock } from '@/portal/blocks/NoticeBlock';
import { QuickActionsBlock } from '@/portal/blocks/QuickActionsBlock';
import { RelatedRecordsTableBlock } from '@/portal/blocks/RelatedRecordsTableBlock';
import { StaticTextBlock } from '@/portal/blocks/StaticTextBlock';
import { StatsGridBlock } from '@/portal/blocks/StatsGridBlock';
import type { PortalBootData, PortalRecord } from '@/portal/types';

import type { ResolvedPortalBlock } from './portalLayout';

interface Props {
    block: ResolvedPortalBlock;
    fields: FieldEntity[];
}

/**
 * Renderea el componente **real** del portal con datos mock dentro
 * del editor. A diferencia del `PortalBlockPreview` legacy (mockups
 * tailwind con tamaños distintos), este componente usa exactamente
 * el mismo HTML/CSS que el front, garantizando que lo que se ve en
 * el editor sea pixel-identical a lo que verá el cliente.
 *
 * Estrategia para bloques con fetch:
 *  - Componentes que hacen fetch (kpi, activity, comments, related,
 *    download, stats_grid) reciben un `boot` con un `rest_root`
 *    intencionalmente roto (`__preview__://`). El fetch falla,
 *    cae en el branch de error y se muestra el estado de error
 *    estilizado del bloque real — sigue siendo más fiel al front
 *    que un mockup custom.
 *  - Alternativa: para esos bloques se podría agregar un
 *    `previewMode` prop, pero no quiero contaminar la API pública
 *    de los bloques con concerns del editor.
 *
 * El wrapper externo (`GridCanvas`) ya neutraliza eventos
 * (`pointer-events: none`) y aplica `imcrm-portal-block__loading`
 * para los estados intermedios, así que basta con renderizar el
 * componente tal cual.
 */
export function PortalBlockLivePreview({ block, fields }: Props): JSX.Element {
    const mockRecord = useMemo<PortalRecord>(
        () => buildMockRecord(fields),
        [fields],
    );

    // Boot mock — los bloques que normalmente fetchean detectan el
    // preview vía `PortalPreviewContext` y no llegan a llamar a este
    // boot, así que sus campos pueden ser placeholder.
    const mockBoot: PortalBootData = useMemo(
        () => ({
            rest_root: '__preview__/',
            list_slug: 'preview',
            user_id: 0,
            record_id: 0,
        }),
        [],
    );

    // Envolvemos con `imcrm-portal-root` para que los tokens CSS
    // (`--imcrm-portal-*`) estén en scope y los bloques se vean con
    // los mismos colores/tipos que en el front. Sin esto los bloques
    // heredan colores del admin (oscuros vs claros del portal).
    // Mock de metadata de fields para el preview — derivado de los
    // FieldEntity reales de la lista. Permite que el `ClientDataBlock`
    // muestre labels reales y options resueltas en lugar de slugs
    // crudos.
    const mockFields = useMemo(
        () =>
            fields.map((f) => ({
                slug:   f.slug,
                label:  f.label,
                type:   f.type,
                config: f.config as Record<string, unknown>,
            })),
        [fields],
    );

    return (
        <div className="imcrm-portal-root imcrm-portal-preview-root">
            <PortalPreviewContext.Provider value={true}>
                {renderBlock(block, mockRecord, mockBoot, mockFields)}
            </PortalPreviewContext.Provider>
        </div>
    );
}

function renderBlock(
    block: ResolvedPortalBlock,
    mockRecord: PortalRecord,
    mockBoot: PortalBootData,
    mockFields: Array<{ slug: string; label: string; type: string; config: Record<string, unknown> }>,
): JSX.Element {
    switch (block.type) {
        case 'static_text':
            return (
                <StaticTextBlock
                    config={block.config as Parameters<typeof StaticTextBlock>[0]['config']}
                />
            );
        case 'client_data':
            return (
                <ClientDataBlock
                    config={block.config as Parameters<typeof ClientDataBlock>[0]['config']}
                    record={mockRecord}
                    fields={mockFields}
                />
            );
        case 'related_records_table':
            return (
                <RelatedRecordsTableBlock
                    config={block.config as Parameters<typeof RelatedRecordsTableBlock>[0]['config']}
                    boot={mockBoot}
                />
            );
        case 'editable_form':
            return (
                <EditableFormBlock
                    config={block.config as Parameters<typeof EditableFormBlock>[0]['config']}
                    record={mockRecord}
                    boot={mockBoot}
                />
            );
        case 'external_link':
            return (
                <ExternalLinkBlock
                    config={block.config as Parameters<typeof ExternalLinkBlock>[0]['config']}
                />
            );
        case 'kpi_widget':
            return (
                <KpiWidgetBlock
                    config={block.config as Parameters<typeof KpiWidgetBlock>[0]['config']}
                    boot={mockBoot}
                />
            );
        case 'activity_timeline':
            return (
                <ActivityTimelineBlock
                    config={block.config as Parameters<typeof ActivityTimelineBlock>[0]['config']}
                    boot={mockBoot}
                />
            );
        case 'download_files':
            return (
                <DownloadFilesBlock
                    config={block.config as Parameters<typeof DownloadFilesBlock>[0]['config']}
                    record={mockRecord}
                />
            );
        case 'comments_thread':
            return (
                <CommentsThreadBlock
                    config={block.config as Parameters<typeof CommentsThreadBlock>[0]['config']}
                    boot={mockBoot}
                />
            );
        case 'heading':
            return (
                <HeadingBlock
                    config={block.config as Parameters<typeof HeadingBlock>[0]['config']}
                />
            );
        case 'hero':
            return (
                <HeroBlock
                    config={block.config as Parameters<typeof HeroBlock>[0]['config']}
                    record={mockRecord}
                />
            );
        case 'stats_grid':
            return (
                <StatsGridBlock
                    config={block.config as Parameters<typeof StatsGridBlock>[0]['config']}
                    boot={mockBoot}
                />
            );
        case 'quick_actions':
            return (
                <QuickActionsBlock
                    config={block.config as Parameters<typeof QuickActionsBlock>[0]['config']}
                />
            );
        case 'notice':
            return (
                <NoticeBlock
                    config={block.config as Parameters<typeof NoticeBlock>[0]['config']}
                />
            );
        case 'divider':
            return (
                <DividerBlock
                    config={block.config as Parameters<typeof DividerBlock>[0]['config']}
                />
            );
        case 'faq':
            return (
                <FaqBlock
                    config={block.config as Parameters<typeof FaqBlock>[0]['config']}
                />
            );
        case 'contact_card':
            return (
                <ContactCardBlock
                    config={block.config as Parameters<typeof ContactCardBlock>[0]['config']}
                />
            );
        case 'nested_section': {
            // Renderea las sub-columnas con sus sub-bloques recursivamente.
            // El preview usa el mismo mock que el padre.
            const cfg = block.config as {
                columns: Array<{
                    id?: string;
                    width: number;
                    blocks: Array<{ type: string; config: Record<string, unknown> }>;
                }>;
            };
            return (
                <div className="imcrm-rows-layout">
                    <div className="imcrm-row">
                        {cfg.columns.map((col, cIdx) => {
                            const basis = `${(col.width / 12) * 100}%`;
                            return (
                                <div
                                    key={col.id ?? cIdx}
                                    className="imcrm-row__cell"
                                    style={{ flexBasis: basis, maxWidth: basis }}
                                >
                                    {col.blocks.length === 0 ? (
                                        <p className="imcrm-portal-block__loading">
                                            (col vacía — agregar sub-bloques desde el panel de opciones)
                                        </p>
                                    ) : (
                                        col.blocks.map((subBlock, subIdx) => (
                                            <div key={subIdx}>
                                                {renderBlock(
                                                    {
                                                        // ResolvedPortalBlock shape minimo
                                                        id: `${block.id}-sub-${cIdx}-${subIdx}`,
                                                        type: subBlock.type as never,
                                                        config: subBlock.config as never,
                                                        x: 0,
                                                        y: 0,
                                                        w: 12,
                                                        h: 4,
                                                    } as never,
                                                    mockRecord,
                                                    mockBoot,
                                                    mockFields,
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }
    }
}

/**
 * Construye un record mock con valores de ejemplo para cada campo
 * de la lista. Los componentes que reciben `record` (hero,
 * client_data, etc.) muestran estos valores en el preview, dándole
 * al admin una idea realista de cómo se ven los datos del cliente.
 */
function buildMockRecord(fields: FieldEntity[]): PortalRecord {
    const out: Record<string, unknown> = {};
    fields.forEach((f) => {
        out[f.slug] = mockValueFor(f);
    });
    return { id: 1, fields: out, relations: {} };
}

function mockValueFor(field: FieldEntity): unknown {
    switch (field.type) {
        case 'text':
            return field.slug.includes('name') || field.slug.includes('nombre')
                ? 'Ana García'
                : 'Valor de ejemplo';
        case 'long_text':
            return 'Texto largo de ejemplo con varias líneas para mostrar cómo se ve el contenido.';
        case 'number':
            return 42;
        case 'currency':
            return 1250.5;
        case 'email':
            return 'cliente@ejemplo.com';
        case 'url':
            return 'https://ejemplo.com';
        case 'date':
            return '2026-05-26';
        case 'datetime':
            return '2026-05-26 14:30:00';
        case 'checkbox':
            return true;
        case 'select':
            return 'Activo';
        case 'multi_select':
            return ['Etiqueta A', 'Etiqueta B'];
        case 'user':
            return 1;
        case 'file':
            return null;
        case 'relation':
            return null;
        default:
            return null;
    }
}
