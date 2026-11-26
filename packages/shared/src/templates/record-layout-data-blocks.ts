import { DATA_BLOCK_TYPES, layoutBlocks, type RecordLayoutV3 } from '../schemas/record-layout';

/**
 * v0.1.472 — Los bloques de la ficha que piden datos al servidor y su firma.
 * Aparte del armado de la ficha automática (`record-layout-integrated`): el
 * front lo usa desde la carga inicial (la caché del bundle de la ficha) y no
 * debe arrastrar ese armado.
 */

/** Un bloque de datos de la ficha, tal como viaja a `layout-data`. */
export interface LayoutDataBlock {
    id: string;
    type: 'chart' | 'related';
    title?: string;
    config: Record<string, unknown>;
}

/** Los bloques de la ficha que necesitan datos del servidor (gráficos y vinculados). */
export function layoutDataBlocks(layout: Pick<RecordLayoutV3, 'pages'>): LayoutDataBlock[] {
    return layoutBlocks(layout)
        .filter((b) => DATA_BLOCK_TYPES.includes(b.type))
        .map((b) => ({ id: b.id, type: b.type as 'chart' | 'related', title: b.title, config: b.config as Record<string, unknown> }));
}

/** La firma de esos bloques: si la del servidor coincide con la del front, la ficha no los vuelve a pedir. */
export function layoutDataSig(blocks: readonly LayoutDataBlock[]): string {
    return JSON.stringify(blocks);
}
