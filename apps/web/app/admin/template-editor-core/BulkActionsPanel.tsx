import { Copy, Layers, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';

interface Props {
    count: number;
    onDuplicate: () => void;
    onDelete: () => void;
    onDeselect: () => void;
}

/**
 * Inspector cuando hay 2+ bloques seleccionados. Solo expone
 * acciones bulk — la edición fina por bloque queda fuera porque
 * cada tipo tiene su propio shape de config y mezclarlos confunde.
 */
export function BulkActionsPanel({
    count,
    onDuplicate,
    onDelete,
    onDeselect,
}: Props): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col">
            <header className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-border-b imcrm-border-border imcrm-py-3 imcrm-pl-12 imcrm-pr-4">
                <p className="imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                    {__('Selección múltiple')}
                </p>
                <h3 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold imcrm-tracking-tight">
                    <Layers className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" />
                    {__('%d bloques seleccionados').replace('%d', String(count))}
                </h3>
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Acciones bulk. Las propiedades se editan una por bloque.')}
                </p>
            </header>

            <div className="imcrm-flex-1 imcrm-overflow-y-auto imcrm-px-4 imcrm-py-4">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="imcrm-w-full imcrm-justify-start imcrm-gap-2"
                        onClick={onDuplicate}
                    >
                        <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Duplicar todos')}
                        <span className="imcrm-ml-auto imcrm-text-[10px] imcrm-text-muted-foreground">⌘D</span>
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="imcrm-w-full imcrm-justify-start imcrm-gap-2 imcrm-text-destructive hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                        onClick={onDelete}
                    >
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Eliminar todos')}
                        <span className="imcrm-ml-auto imcrm-text-[10px] imcrm-text-muted-foreground">⌫</span>
                    </Button>
                </div>

                <div className="imcrm-mt-6 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3 imcrm-text-[11px] imcrm-text-muted-foreground">
                    <p className="imcrm-mb-1.5 imcrm-font-medium imcrm-text-foreground">
                        {__('Atajos')}
                    </p>
                    <ul className="imcrm-space-y-1">
                        <li className="imcrm-flex imcrm-justify-between">
                            <span>{__('Sumar a la selección')}</span>
                            <kbd className="imcrm-rounded imcrm-bg-background imcrm-px-1 imcrm-py-0.5 imcrm-text-[10px]">⇧ click</kbd>
                        </li>
                        <li className="imcrm-flex imcrm-justify-between">
                            <span>{__('Duplicar')}</span>
                            <kbd className="imcrm-rounded imcrm-bg-background imcrm-px-1 imcrm-py-0.5 imcrm-text-[10px]">⌘D</kbd>
                        </li>
                        <li className="imcrm-flex imcrm-justify-between">
                            <span>{__('Eliminar')}</span>
                            <kbd className="imcrm-rounded imcrm-bg-background imcrm-px-1 imcrm-py-0.5 imcrm-text-[10px]">⌫</kbd>
                        </li>
                        <li className="imcrm-flex imcrm-justify-between">
                            <span>{__('Deseleccionar')}</span>
                            <kbd className="imcrm-rounded imcrm-bg-background imcrm-px-1 imcrm-py-0.5 imcrm-text-[10px]">Esc</kbd>
                        </li>
                    </ul>
                </div>
            </div>

            <footer className="imcrm-flex imcrm-justify-end imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-3">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="imcrm-gap-1.5"
                    onClick={onDeselect}
                >
                    <X className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Deseleccionar')}
                </Button>
            </footer>
        </div>
    );
}
