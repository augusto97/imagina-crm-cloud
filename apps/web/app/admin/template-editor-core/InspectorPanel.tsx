import { Copy, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { readBlockStyle } from '@/lib/blockStyle';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import { BlockStyleEditor } from './BlockStyleEditor';
import type { BaseTemplateBlock, BlockRegistry } from './types';

interface Props<TBlock extends BaseTemplateBlock> {
    block: TBlock;
    fields: FieldEntity[];
    registry: BlockRegistry<TBlock>;
    onUpdate: (patch: Partial<TBlock>) => void;
    onDelete: () => void;
    onDuplicate?: () => void;
}

/**
 * Inspector lateral del editor genérico (columna derecha).
 * Header con label/descripción del tipo, body con form custom
 * vía `registry.renderInspector`, footer con Duplicar/Eliminar.
 */
export function InspectorPanel<TBlock extends BaseTemplateBlock>({
    block,
    fields,
    registry,
    onUpdate,
    onDelete,
    onDuplicate,
}: Props<TBlock>): JSX.Element {
    const confirm = useConfirm();

    const handleDelete = async (): Promise<void> => {
        const ok = await confirm({
            title: __('Eliminar bloque'),
            description: __('Lo podés volver a agregar después desde la paleta.'),
            destructive: true,
            confirmLabel: __('Eliminar'),
        });
        if (! ok) return;
        onDelete();
    };

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col">
            <header className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-border-b imcrm-border-border imcrm-py-3 imcrm-pl-12 imcrm-pr-4">
                <p className="imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                    {__('Bloque')}
                </p>
                <h3 className="imcrm-text-sm imcrm-font-semibold imcrm-tracking-tight">
                    {registry.labelForType(block.type)}
                </h3>
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {registry.descriptionForType(block.type)}
                </p>
            </header>

            <div className="imcrm-flex-1 imcrm-overflow-y-auto imcrm-px-4 imcrm-py-4">
                {registry.renderInspector(block, { fields }, onUpdate)}

                {/* Sección "Diseño" universal — fondo/texto/borde/relleno/
                    esquinas/sombra/alineación para CUALQUIER bloque. Vive en
                    `config.style` y la aplican el canvas, la ficha real del
                    registro y el portal con la misma función (blockStyleCss). */}
                <BlockStyleEditor
                    value={readBlockStyle(block.config)}
                    onChange={(style) => {
                        const config: Record<string, unknown> = { ...block.config };
                        if (Object.keys(style).length > 0) config.style = style;
                        else delete config.style;
                        onUpdate({ config } as unknown as Partial<TBlock>);
                    }}
                />
            </div>

            <footer className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-3">
                <span className="imcrm-truncate imcrm-text-[10px] imcrm-text-muted-foreground" title={block.id}>
                    {block.id}
                </span>
                <div className="imcrm-flex imcrm-gap-1.5">
                    {onDuplicate && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="imcrm-gap-1.5"
                            onClick={onDuplicate}
                        >
                            <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Duplicar')}
                        </Button>
                    )}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="imcrm-gap-1.5 imcrm-text-destructive hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                        onClick={() => void handleDelete()}
                    >
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Eliminar')}
                    </Button>
                </div>
            </footer>
        </div>
    );
}
