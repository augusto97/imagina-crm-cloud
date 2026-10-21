import { lazy, Suspense, useState } from 'react';
import { Download, Eye, FileCheck2, FileDown, FileText, Link2, Loader2, Lock, Paperclip, Settings2 } from 'lucide-react';
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

import { formatDate } from '@/lib/tenantFormat';

import { IssuedDocumentsDialog } from './IssuedDocuments';
import { documentLink, downloadPdf, generateDocument, invalidateIssued, useDocumentTemplates, useIssuedDocuments } from './useDocuments';

// pdf.js pesa: el visor sólo se baja al abrir «Ver».
const PdfViewDialog = lazy(() => import('./PdfViewDialog'));

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
    // v0.1.290 — «Ver» (sin emitir) y «Documentos emitidos».
    const [viewing, setViewing] = useState<{ id: number; name: string } | null>(null);
    const [issuedOpen, setIssuedOpen] = useState(false);
    const issued = useIssuedDocuments(listId, recordId);

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
            // Guardarlo en un campo o numerarlo (el número puede quedar en un
            // campo de texto) cambia el registro: refrescar la ficha y la lista.
            if (saveField || res.number) {
                invalidateForList(qc, recordsKeys.all, listId);
                if (listSlug) invalidateForList(qc, recordsKeys.all, listSlug);
                // v0.1.290 — y «Documentos emitidos» (puede haber uno nuevo o congelado).
                invalidateIssued(qc, listId, recordId);
            }
            if (saveField) {
                toast.success(__('PDF guardado'), `${res.filename}${res.number ? ` (N.º ${res.number})` : ''} → «${saveField.label}»`);
            } else {
                downloadPdf(res.pdf, res.filename);
                if (res.number) toast.success(__('PDF generado'), `${__('Número')}: ${res.number}`);
            }
        } catch (err) {
            toast.error(__('No se pudo generar el PDF'), err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    };

    // v0.1.268 — enlace que arma el PDF al abrirlo: no ocupa espacio.
    const copyLink = async (templateId: number): Promise<void> => {
        setBusy(templateId);
        try {
            const res = await documentLink(listId, templateId, recordId);
            await navigator.clipboard.writeText(res.url).catch(() => undefined);
            toast.success(
                __('Enlace copiado'),
                `${__('Arma el PDF con los datos del momento en que se abre. Vence el')} ${formatDate(new Date(res.expires_at))}.`,
            );
        } catch (err) {
            toast.error(__('No se pudo crear el enlace'), err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    };

    const icon = busy !== null ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <FileDown className="imcrm-h-4 imcrm-w-4" />;

    return (
        <>
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
                            {__('Todavía no hay plantillas. Arma la primera (cuenta de cobro, recibo…).')}
                        </p>
                    )}
                    {list.map((t) => (
                        <DropdownMenuSub key={t.id}>
                            <DropdownMenuSubTrigger data-doc-generate={t.id}>
                                <FileText className="imcrm-h-4 imcrm-w-4" />
                                <span className="imcrm-flex-1 imcrm-truncate">{t.name}</span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="imcrm-w-64">
                                <DropdownMenuItem disabled={busy !== null} onSelect={() => setViewing({ id: t.id, name: t.name })} data-doc-view>
                                    <Eye className="imcrm-h-4 imcrm-w-4" />
                                    <span className="imcrm-flex imcrm-flex-col">
                                        <span>{__('Ver')}</span>
                                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                            {t.next_label ? __('Revisarlo no emite número') : __('Con los datos de ahora')}
                                        </span>
                                    </span>
                                </DropdownMenuItem>
                                <DropdownMenuItem disabled={busy !== null} onSelect={() => void run(t.id)} data-doc-download>
                                    {t.freezes ? <Lock className="imcrm-h-4 imcrm-w-4" /> : <Download className="imcrm-h-4 imcrm-w-4" />}
                                    <span className="imcrm-flex imcrm-flex-col">
                                        <span>{__('Descargar')}</span>
                                        {t.freezes && <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('La primera vez lo emite y lo congela')}</span>}
                                    </span>
                                </DropdownMenuItem>
                                <DropdownMenuItem disabled={busy !== null} onSelect={() => void copyLink(t.id)} data-doc-link>
                                    <Link2 className="imcrm-h-4 imcrm-w-4" />
                                    <span className="imcrm-flex imcrm-flex-col">
                                        <span>{__('Copiar enlace (30 días)')}</span>
                                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Sin guardar archivo: se arma al abrirlo')}</span>
                                    </span>
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
                    ))}
                    {(issued.data ?? []).length > 0 && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setIssuedOpen(true)} data-doc-issued>
                                <FileCheck2 className="imcrm-h-4 imcrm-w-4" />
                                <span className="imcrm-flex-1">{__('Documentos emitidos')}</span>
                                <span className="imcrm-text-[11px] imcrm-tabular-nums imcrm-text-muted-foreground">{(issued.data ?? []).length}</span>
                            </DropdownMenuItem>
                        </>
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
            {viewing && (
                <Suspense fallback={null}>
                    <PdfViewDialog listId={listId} templateId={viewing.id} templateName={viewing.name} recordId={recordId} onClose={() => setViewing(null)} />
                </Suspense>
            )}
            {issuedOpen && <IssuedDocumentsDialog open onOpenChange={setIssuedOpen} listId={listId} listSlug={listSlug} recordId={recordId} />}
        </>
    );
}
