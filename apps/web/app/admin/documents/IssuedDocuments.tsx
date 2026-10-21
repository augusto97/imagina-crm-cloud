import { useState } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Download, FileCheck2, Loader2, Lock, RotateCcw, X } from 'lucide-react';
import type { IssuedDocument } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { invalidateForList, recordsKeys } from '@/hooks/useRecords';
import { __, sprintf } from '@/lib/i18n';
import { useCan } from '@/lib/permissions';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { downloadPdf, fetchIssuedPdf, invalidateIssued, reissueDocument, useIssuedDocuments } from './useDocuments';

/**
 * v0.1.290 — «Documentos emitidos» de un registro (ADR-S35): cada número que
 * se emitió con su plantilla, cuándo y quién, si quedó CONGELADO (se entrega
 * siempre ese PDF) o ANULADO. Descargar baja el congelado (o el de ahora con
 * su mismo número, si la plantilla no congela). Un admin puede «Anular y
 * emitir de nuevo»: el número anterior queda anulado —conserva su PDF y su
 * número, que no se reusa— y se emite el siguiente con los datos actuales.
 */
export function IssuedDocumentsList({ listId, listSlug, recordId }: { listId: number; listSlug?: string; recordId: number }): JSX.Element | null {
    const issued = useIssuedDocuments(listId, recordId);
    const isAdmin = useCan('workspace_admin');
    const toast = useToast();
    const qc = useQueryClient();
    const [busy, setBusy] = useState<number | null>(null);
    const [voiding, setVoiding] = useState<IssuedDocument | null>(null);

    const rows = issued.data ?? [];
    if (issued.isLoading) {
        return (
            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> {__('Cargando…')}
            </p>
        );
    }
    if (rows.length === 0) return null;

    const download = async (doc: IssuedDocument): Promise<void> => {
        setBusy(doc.id);
        try {
            const res = await fetchIssuedPdf(listId, doc.id);
            downloadPdf(res.pdf, res.filename);
            // Bajar uno vigente sin congelar con la plantilla que ahora congela, lo congela.
            if (!doc.frozen) invalidateIssued(qc, listId, recordId);
        } catch (err) {
            toast.error(__('No se pudo descargar'), err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    };

    return (
        <>
            <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border" data-testid="issued-documents">
                {rows.map((doc) => {
                    const voided = doc.status === 'voided';
                    return (
                        <li
                            key={doc.id}
                            className={cn('imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1 imcrm-px-3 imcrm-py-2', voided && 'imcrm-bg-muted/40')}
                            data-issued={doc.label}
                            data-issued-status={doc.status}
                        >
                            <FileCheck2 className={cn('imcrm-h-4 imcrm-w-4 imcrm-shrink-0', voided ? 'imcrm-text-muted-foreground' : 'imcrm-text-primary')} aria-hidden />
                            <div className="imcrm-min-w-0 imcrm-flex-1">
                                <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-text-sm">
                                    <span className={cn('imcrm-font-semibold imcrm-tabular-nums', voided && 'imcrm-text-muted-foreground imcrm-line-through')}>{doc.label}</span>
                                    <span className="imcrm-truncate imcrm-text-muted-foreground">{doc.template_name}</span>
                                    {doc.frozen && (
                                        <span
                                            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-bg-primary/10 imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-primary"
                                            title={__('Se guardó el PDF al emitirlo: siempre se entrega ese, aunque cambien los datos.')}
                                        >
                                            <Lock className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                            {__('Congelado')}
                                        </span>
                                    )}
                                    {voided && (
                                        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-bg-destructive/10 imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-destructive">
                                            <Ban className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                            {__('Anulado')}
                                        </span>
                                    )}
                                </p>
                                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                    {sprintf(__('Emitido %s'), formatDateTimeStr(doc.issued_at))}
                                    {doc.frozen_by_name ? ` · ${sprintf(__('por %s'), doc.frozen_by_name)}` : ''}
                                    {doc.bytes ? ` · ${Math.max(1, Math.round(doc.bytes / 1024))} KB` : ''}
                                    {voided && doc.voided_at
                                        ? ` · ${sprintf(__('anulado %s'), formatDateTimeStr(doc.voided_at))}${doc.voided_by_name ? ` ${sprintf(__('por %s'), doc.voided_by_name)}` : ''}${doc.void_reason ? `: «${doc.void_reason}»` : ''}`
                                        : ''}
                                </p>
                            </div>
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="imcrm-h-8 imcrm-gap-1.5 imcrm-px-2 imcrm-text-xs"
                                    disabled={busy !== null || (voided && !doc.frozen)}
                                    title={voided && !doc.frozen ? __('Se anuló sin una copia guardada (no se congeló al emitirlo).') : undefined}
                                    onClick={() => void download(doc)}
                                    data-issued-download
                                >
                                    {busy === doc.id ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Download className="imcrm-h-3.5 imcrm-w-3.5" />}
                                    {__('Descargar')}
                                </Button>
                                {isAdmin && !voided && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="imcrm-h-8 imcrm-gap-1.5 imcrm-px-2 imcrm-text-xs imcrm-text-destructive hover:imcrm-text-destructive"
                                        disabled={busy !== null}
                                        onClick={() => setVoiding(doc)}
                                        data-issued-reissue
                                    >
                                        <RotateCcw className="imcrm-h-3.5 imcrm-w-3.5" />
                                        <span className="imcrm-hidden sm:imcrm-inline">{__('Anular y emitir de nuevo')}</span>
                                        <span className="sm:imcrm-hidden">{__('Anular')}</span>
                                    </Button>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
            {voiding && (
                <ReissueDialog
                    doc={voiding}
                    onClose={() => setVoiding(null)}
                    onConfirm={async (reason) => {
                        const res = await reissueDocument(listId, voiding.id, reason);
                        invalidateIssued(qc, listId, recordId);
                        // El número nuevo puede quedar escrito en un campo del registro.
                        invalidateForList(qc, recordsKeys.all, listId);
                        if (listSlug) invalidateForList(qc, recordsKeys.all, listSlug);
                        downloadPdf(res.pdf, res.filename);
                        toast.success(__('Documento emitido de nuevo'), sprintf(__('%1$s quedó anulado. El nuevo es %2$s.'), res.voided.label, res.issued.label));
                        setVoiding(null);
                    }}
                />
            )}
        </>
    );
}

/** Sección «Documentos emitidos» de la ficha clásica (se oculta si no hay). */
export function IssuedDocumentsSection({ className, ...props }: { listId: number; listSlug?: string; recordId: number; className?: string }): JSX.Element | null {
    const issued = useIssuedDocuments(props.listId, props.recordId);
    if ((issued.data ?? []).length === 0) return null;
    return (
        <section className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2', className)} data-testid="issued-documents-section">
            <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-semibold">
                <FileCheck2 className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                {__('Documentos emitidos')}
            </h3>
            <IssuedDocumentsList {...props} />
        </section>
    );
}

/** Diálogo con la lista (desde el menú «Generar PDF», en cualquier ficha). */
export function IssuedDocumentsDialog({
    open,
    onOpenChange,
    ...props
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    listId: number;
    listSlug?: string;
    recordId: number;
}): JSX.Element {
    const issued = useIssuedDocuments(props.listId, props.recordId);
    return (
        <RDialog.Root open={open} onOpenChange={onOpenChange}>
            <RDialog.Portal>
                <RDialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <RDialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[88vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-2xl imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-gap-3 imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg"
                    data-testid="issued-documents-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                        <div>
                            <RDialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Documentos emitidos')}</RDialog.Title>
                            <RDialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Los números que se emitieron para este registro. Un documento congelado se entrega siempre igual, aunque cambien los datos.')}
                            </RDialog.Description>
                        </div>
                        <RDialog.Close asChild>
                            <button type="button" aria-label={__('Cerrar')} className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent">
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </button>
                        </RDialog.Close>
                    </div>
                    {!issued.isLoading && (issued.data ?? []).length === 0 ? (
                        <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-4 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                            {__('Todavía no se emitió ningún documento numerado para este registro.')}
                        </p>
                    ) : (
                        <IssuedDocumentsList {...props} />
                    )}
                </RDialog.Content>
            </RDialog.Portal>
        </RDialog.Root>
    );
}

function ReissueDialog({ doc, onClose, onConfirm }: { doc: IssuedDocument; onClose: () => void; onConfirm: (reason?: string) => Promise<void> }): JSX.Element {
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    return (
        <RDialog.Root open onOpenChange={(o) => !o && !busy && onClose()}>
            <RDialog.Portal>
                <RDialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-[60] imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <RDialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-[60] imcrm-flex imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg"
                    data-testid="reissue-dialog"
                >
                    <RDialog.Title className="imcrm-text-base imcrm-font-semibold">{sprintf(__('¿Anular %s y emitir uno nuevo?'), doc.label)}</RDialog.Title>
                    <RDialog.Description className="imcrm-text-sm imcrm-leading-relaxed imcrm-text-muted-foreground">
                        {__('El documento actual queda ANULADO: conserva su número (que no se vuelve a usar) y su PDF. Se emite el siguiente número con los datos de ahora.')}
                    </RDialog.Description>
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-xs">
                        <span className="imcrm-font-medium">{__('Motivo (opcional)')}</span>
                        <Textarea rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder={__('Se corrigió el precio de un ítem')} />
                    </label>
                    {error && <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-p-2 imcrm-text-xs imcrm-text-destructive">{error}</p>}
                    <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                        <Button variant="ghost" onClick={onClose} disabled={busy}>
                            {__('Cancelar')}
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={busy}
                            className="imcrm-gap-1.5"
                            data-testid="reissue-confirm"
                            onClick={() => {
                                setBusy(true);
                                setError(null);
                                onConfirm(reason.trim() || undefined)
                                    .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
                                    .finally(() => setBusy(false));
                            }}
                        >
                            {busy ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <RotateCcw className="imcrm-h-4 imcrm-w-4" />}
                            {__('Anular y emitir de nuevo')}
                        </Button>
                    </div>
                </RDialog.Content>
            </RDialog.Portal>
        </RDialog.Root>
    );
}
