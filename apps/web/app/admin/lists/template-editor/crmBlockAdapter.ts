import {
    emptyCustomConfigV2,
    type CustomTemplateConfigV2,
    type V2Block,
} from '@/lib/crmTemplates';

/**
 * Adaptadores entre el shape del CRM (`CustomTemplateConfigV2` con
 * un wrapper `{ v, header, blocks }`) y el shape que el shell
 * genérico (`TemplateEditorShell`) maneja (`V2Block[]` directo).
 *
 * El wrapper es necesario en el CRM porque guarda el `header`
 * global del template (qué fields se muestran como título,
 * subtítulos, status pills y acciones rápidas en la pestaña de
 * detalle del record). Ese config NO vive como un bloque del grid
 * — vive a nivel template y se configura desde el
 * `TemplateSettingsPanel`.
 *
 * El shell solo conoce `V2Block[]`. Estos adaptores:
 *  - **`extractBlocks`** desempaca un `CustomTemplateConfigV2` y
 *    devuelve sus blocks para alimentar el shell.
 *  - **`rebuildConfig`** vuelve a empacar — preservando el header
 *    original, los blocks vienen del shell.
 *
 * Patrón: `TemplateEditorPage` mantiene un `originalHeader` en
 * estado, pasa los blocks al shell, y al guardar reconstruye el
 * config con `rebuildConfig(blocks, originalHeader)`.
 */

export function extractBlocks(config: CustomTemplateConfigV2): V2Block[] {
    return config.blocks;
}

export function extractHeader(
    config: CustomTemplateConfigV2,
): CustomTemplateConfigV2['header'] {
    return config.header;
}

export function rebuildConfig(
    blocks: V2Block[],
    header: CustomTemplateConfigV2['header'],
): CustomTemplateConfigV2 {
    return {
        v: 2,
        header,
        blocks,
    };
}

/**
 * Default cuando la lista todavía no tiene config custom. Devuelve
 * un config vacío que el editor puede empezar a llenar.
 */
export function defaultConfig(): CustomTemplateConfigV2 {
    return emptyCustomConfigV2();
}
