import type { LucideIcon } from 'lucide-react';

import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

/**
 * Shape mínimo que cualquier bloque del editor debe cumplir
 * (id + posicionamiento en grid 12-col + config opaca).
 *
 * Los consumidores extienden esto con su discriminated union
 * (V2Block del CRM, PortalBlock del portal).
 */
export interface BaseTemplateBlock {
    id: string;
    type: string;
    config: Record<string, unknown>;
    /** Índice de columna dentro de la fila (0, 1, 2...). */
    x: number;
    /** Índice de fila (0, 1, 2...). */
    y: number;
    /** Ancho de la columna en cols de 12. */
    w: number;
    /** [Legacy] Altura — ignorado desde 0.57.22. */
    h: number;
    /** Posición vertical dentro de la columna (0, 1, 2...). Default 0. */
    pos?: number;
    /**
     * Spacing CSS aplicado al wrapper de la SECCIÓN que contiene este
     * bloque. Consistente entre todos los bloques de la misma fila
     * (todos los que comparten `y`). Opcional, default '' (sin estilo).
     */
    secPadding?: string;
    secMargin?: string;
    /**
     * Spacing CSS aplicado al wrapper de la COLUMNA que contiene este
     * bloque. Consistente entre todos los bloques de la misma columna
     * (todos los que comparten `y` y `x`). Opcional, default '' (sin estilo).
     */
    colPadding?: string;
    colMargin?: string;
}

export interface BaseTemplateConfig<TBlock extends BaseTemplateBlock> {
    blocks: TBlock[];
}

/** Definición declarativa de un tipo de bloque para la paleta. */
export interface BlockTypeDef {
    type: string;
    label: string;
    description: string;
    icon: LucideIcon;
    category: string;
    /** Si true, la paleta deshabilita el card cuando ya existe uno en el canvas. */
    singleton?: boolean;
}

export interface PaletteCategory {
    id: string;
    label: string;
}

/** Contexto que recibe el preview renderer de un bloque. */
export interface PreviewContext {
    listId: number;
    fields: FieldEntity[];
    /**
     * Record real seleccionado en el RecordSelector, o null si el
     * editor está usando datos mock. Los renderers que ignoren el
     * record y usen mocks internos pueden no leer este campo.
     */
    record: RecordEntity | null;
}

/** Adaptador opcional para el tab "Campos" de la paleta. */
export interface FieldAsBlockAdapter<TBlock extends BaseTemplateBlock> {
    /** Crea un bloque nuevo a partir de un field (típicamente un "properties group"). */
    createBlock: (
        field: FieldEntity,
        existing: TBlock[],
        position?: { x: number; y: number; pos?: number },
    ) => TBlock | null;
    /** Filtra cuáles fields aparecen en la paleta. Default: todos. */
    fieldFilter?: (field: FieldEntity) => boolean;
}

/** Adaptador opcional: drop de un field sobre un bloque ya existente. */
export interface FieldDropAdapter<TBlock extends BaseTemplateBlock> {
    /**
     * Si el bloque acepta el field, devuelve el bloque parcheado +
     * un flag indicando si el field ya estaba (para mostrar toast).
     * Si el bloque no acepta el field, devuelve null.
     */
    handle: (block: TBlock, slug: string) => { block: TBlock; alreadyPresent: boolean } | null;
}

/**
 * El "block registry" es la API que cada consumidor del editor
 * (CRM, portal) implementa para inyectar sus tipos de bloque,
 * forms de inspector y renderers de preview en el shell genérico.
 */
export interface BlockRegistry<TBlock extends BaseTemplateBlock> {
    types: BlockTypeDef[];
    categories: PaletteCategory[];

    /**
     * Crea un bloque nuevo del tipo dado al final del grid (o en la
     * posición indicada por un drop). Devuelve null si la creación
     * no aplica (ej. CRM `related` sin relation field en la lista).
     */
    createBlock: (
        type: string,
        existing: TBlock[],
        ctx: { fields: FieldEntity[] },
        position?: { x: number; y: number; pos?: number },
    ) => TBlock | null;

    /** Razón por la cual `createBlock` devolvió null (para mostrar toast). */
    createBlockErrorMessage?: (type: string, ctx: { fields: FieldEntity[] }) => string;

    /** Renderea el form del inspector para un bloque. */
    renderInspector: (
        block: TBlock,
        ctx: { fields: FieldEntity[] },
        onUpdate: (patch: Partial<TBlock>) => void,
    ) => JSX.Element;

    /** Renderea el preview del bloque dentro del canvas del grid. */
    renderPreview: (block: TBlock, ctx: PreviewContext) => JSX.Element;

    /** Label del tipo (header del inspector). */
    labelForType: (type: string) => string;
    /** Descripción del tipo (subheader del inspector). */
    descriptionForType: (type: string) => string;

    /** Opcional: tab "Campos" en la paleta. */
    fieldAsBlock?: FieldAsBlockAdapter<TBlock>;

    /** Opcional: drop de field sobre bloque existente. */
    fieldDrop?: FieldDropAdapter<TBlock>;
}
