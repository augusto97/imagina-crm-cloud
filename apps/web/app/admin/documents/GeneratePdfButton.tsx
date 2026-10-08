import { useState } from 'react';
import { Download, FileDown, FileText, Loader2, Paperclip, Settings2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { invalidateForList, recordsKeys } from '@/hooks/useRecords';
import { __ } from '@/lib/i18n';
import { CAP, useCanAny } from '@/lib/permissions';
import type { FieldEntity } from '@/types/field';

import { downloadPdf, generateDocument, useDocumentTemplates } from './useDocuments';

/**
 * v0.1.266 — «Generar PDF» en la ficha del registro (ADR-S35): las
 * plantillas de documento de la lista, para descargar el PDF o guardarlo en
 * un campo Archivo del registro. Sin plantillas no se dibuja (salvo para
 * quien puede crearlas, que ve el atajo a Ajustes → Documentos).
 */
export function GeneratePdfButton({
    listId,
    listSlug,
    recordId,
    fields,
    compact = false,
}: {
    listId: number;
    listSlug?: string;
    recordId: number;
    fields: FieldEntity[];
    /** Sólo el icono (barra del modal); si no, botón con texto. */
    compact?: boolean;
}): JSX.Element | null {
    const templates = useDocumentTemplates(listId);
    const canEdit = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);
    const canDesign = useCanAny(CAP.MANAGE_LISTS, CAP.MANAGE_AUTOMATIONS);
    const toast = useToast();
    const qc = useQueryClient();
    const [busy, setBusy] = useState<number | null>(null);

    const list = templates.data ?? [];
    if (list.length === 0 && !canDesign) return null;
    const fileFields = canEdit ? fields.filter((f) => f.type === 'file') : [];

    const run = async (templateId: number, saveField?: FieldEntity): Promise<void> => {
        setBusy(templateId);
        try {
            const res = await generateDocument(listId, templateId, {
                record_id: recordId,
                ...(saveField ? { save_field: saveField.slug, save_mode: 'append' as const } : {}),
            });
            if (saveField) {
                invalidateForList(qc, recordsKeys.all, listId);
                if (listSlug) invalidateForList(qc, recordsKeys.all, listSlug);
                toast.success(__('PDF guardado'), `${res.filename} → «${saveField.label}»`);
            } else {
                downloadPdf(res.pdf, res.filename);
            }
        } catch (err) {
            toast.error(__('No se pudo generar el PDF'), err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    };

    const icon = busy !== null ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <FileDown className="imcrm-h-4 imcrm-w-4" />;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                {compact ? (
                    <Button variant="ghost" size="icon" aria-label={__('Generar PDF')} title={__('Generar PDF')} data-testid="record-pdf">
                        {icon}
                    </Button>
                ) : (
                    <Button variant="outline" className="imcrm-gap-2" data-testid="record-pdf">
                        {icon}
                        {__('Generar PDF')}
                    </Button>
                )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="imcrm-w-64">
                <DropdownMenuLabel className="imcrm-text-xs imcrm-text-muted-foreground">{__('Documentos de esta lista')}</DropdownMenuLabel>
                {list.length === 0 && (
                    <p className="imcrm-px-2 imcrm-pb-2 imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Todavía no hay plantillas. Armá la primera (cuenta de cobro, recibo…).')}
                    </p>
                )}
                {list.map((t) =>
                    fileFields.length === 0 ? (
                        <DropdownMenuItem key={t.id} disabled={busy !== null} onSelect={() => void run(t.id)} data-doc-generate={t.id}>
                            <FileText className="imcrm-h-4 imcrm-w-4" />
                            <span className="imcrm-flex-1 imcrm-truncate">{t.name}</span>
                            <Download className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                        </DropdownMenuItem>
                    ) : (
                        <DropdownMenuSub key={t.id}>
                            <DropdownMenuSubTrigger data-doc-generate={t.id}>
                                <FileText className="imcrm-h-4 imcrm-w-4" />
                                <span className="imcrm-flex-1 imcrm-truncate">{t.name}</span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="imcrm-w-60">
                                <DropdownMenuItem disabled={busy !== null} onSelect={() => void run(t.id)} data-doc-download>
                                    <Download className="imcrm-h-4 imcrm-w-4" />
                                    {__('Descargar')}
                                </DropdownMenuItem>
                                {fileFields.map((f) => (
                                    <DropdownMenuItem key={f.id} disabled={busy !== null} onSelect={() => void run(t.id, f)} data-doc-save={f.slug}>
                                        <Paperclip className="imcrm-h-4 imcrm-w-4" />
                                        <span className="imcrm-truncate">
                                            {__('Guardar en')} «{f.label}»
                                        </span>
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                    ),
                )}
                {canDesign && listSlug && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                            <Link to={`/lists/${listSlug}/edit?s=documentos`}>
                                <Settings2 className="imcrm-h-4 imcrm-w-4" />
                                {__('Diseñar plantillas')}
                            </Link>
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
