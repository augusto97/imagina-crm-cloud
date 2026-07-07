import { type CustomTemplateConfigV2 } from '@/lib/crmTemplates';
import type { FieldEntity } from '@/types/field';

import { TemplateSettingsPanel } from './panels/TemplateSettingsPanel';

interface Props {
    fields: FieldEntity[];
    header: CustomTemplateConfigV2['header'];
    onHeaderChange: (next: CustomTemplateConfigV2['header']) => void;
    onResetFromBuiltin: (builtinId: string) => void;
}

/**
 * Wrapper del `TemplateSettingsPanel` original adaptado para encajar
 * en el contrato `emptySelectionPanel` del `TemplateEditorShell`.
 *
 * El shell solo conoce `V2Block[]` — el `header` global del template
 * (qué fields se muestran como título, subtítulos, badges, acciones)
 * vive fuera del array de blocks. `TemplateEditorPage` mantiene el
 * header en estado separado y lo pasa acá; cuando el usuario lo
 * edita, este componente llama `onHeaderChange` con el header nuevo
 * sin tocar los blocks.
 *
 * Internamente reconstruye un `CustomTemplateConfigV2` efímero (con
 * `blocks: []` porque el panel original solo lee `config.header`) y
 * lo pasa al `TemplateSettingsPanel`. Cuando el panel devuelve un
 * config modificado, extraemos el nuevo header y lo emitimos.
 */
export function CrmTemplateSettingsPanel({
    fields,
    header,
    onHeaderChange,
    onResetFromBuiltin,
}: Props): JSX.Element {
    const effectiveConfig: CustomTemplateConfigV2 = {
        v: 2,
        header,
        blocks: [], // el panel solo toca `header`; blocks no se usa.
    };

    const handleChange = (next: CustomTemplateConfigV2): void => {
        onHeaderChange(next.header);
    };

    return (
        <TemplateSettingsPanel
            fields={fields}
            config={effectiveConfig}
            onChange={handleChange}
            onResetFromBuiltin={onResetFromBuiltin}
        />
    );
}
