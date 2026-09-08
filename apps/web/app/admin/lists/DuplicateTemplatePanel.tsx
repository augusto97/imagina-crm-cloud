import { useState } from 'react';
import { Copy, LayoutTemplate } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';
import type { ListSummary } from '@/types/list';

import { DuplicateListDialog } from './DuplicateListDialog';
import { SaveAsTemplateDialog } from './SaveAsTemplateDialog';

/**
 * "Duplicar y plantillas" (v0.1.166): las dos salidas de una lista que ya
 * está armada — hacer una copia (con lo que se elija) o guardarla en la
 * galería del workspace para crear otras iguales. Vive en Ajustes → General,
 * antes de la zona de peligro.
 */
export function DuplicateTemplatePanel({ list }: { list: ListSummary }): JSX.Element {
    const [dupOpen, setDupOpen] = useState(false);
    const [tplOpen, setTplOpen] = useState(false);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 sm:imcrm-flex-row sm:imcrm-items-center sm:imcrm-justify-between">
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5">
                <h3 className="imcrm-text-sm imcrm-font-semibold imcrm-text-foreground">
                    {__('Duplicar o guardar como plantilla')}
                </h3>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Una copia con sus campos, vistas y automatizaciones, o una plantilla reutilizable en la galería de "Nueva lista".')}
                </p>
            </div>
            <div className="imcrm-flex imcrm-shrink-0 imcrm-flex-wrap imcrm-gap-2">
                <Button variant="outline" onClick={() => setDupOpen(true)} className="imcrm-gap-2">
                    <Copy className="imcrm-h-4 imcrm-w-4" />
                    {__('Duplicar lista')}
                </Button>
                <Button variant="outline" onClick={() => setTplOpen(true)} className="imcrm-gap-2">
                    <LayoutTemplate className="imcrm-h-4 imcrm-w-4" />
                    {__('Guardar como plantilla')}
                </Button>
            </div>
            <DuplicateListDialog open={dupOpen} onOpenChange={setDupOpen} sourceId={list.id} />
            <SaveAsTemplateDialog list={list} open={tplOpen} onOpenChange={setTplOpen} />
        </div>
    );
}
