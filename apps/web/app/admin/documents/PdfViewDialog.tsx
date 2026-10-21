import { useEffect, useState } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import { Download, Lock, X } from 'lucide-react';
import type { ViewDocumentResult } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { __, sprintf } from '@/lib/i18n';

import { PdfCanvasPreview } from './PdfCanvasPreview';
import { downloadPdf, viewDocument } from './useDocuments';

/**
 * v0.1.290 — «Ver» un documento desde la ficha: el PDF con los datos de ahora
 * (o el CONGELADO, si ya se emitió y congeló), dibujado con pdf.js. No emite
 * número: sirve para revisar —por ejemplo después de cambiar los ítems en la
 * tabla editable— antes de generar el de verdad. Se pide cada vez que se
 * abre: siempre refleja el último cambio.
 */
export default function PdfViewDialog({
    listId,
    templateId,
    templateName,
    recordId,
    onClose,
}: {
    listId: number;
    templateId: number;
    templateName: string;
    recordId: number;
    onClose: () => void;
}): JSX.Element {
    const [doc, setDoc] = useState<ViewDocumentResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        viewDocument(listId, templateId, recordId)
            .then((res) => alive && setDoc(res))
            .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)));
        return () => {
            alive = false;
        };
    }, [listId, templateId, recordId]);

    return (
        <RDialog.Root open onOpenChange={(o) => !o && onClose()}>
            <RDialog.Portal>
                <RDialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/50 imcrm-backdrop-blur-sm" />
                <RDialog.Content
                    className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-flex imcrm-flex-col imcrm-bg-card sm:imcrm-inset-4 sm:imcrm-rounded-lg sm:imcrm-border sm:imcrm-border-border sm:imcrm-shadow-imcrm-lg"
                    data-testid="pdf-view-dialog"
                    aria-describedby={undefined}
                >
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-py-2.5">
                        <RDialog.Title className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-sm imcrm-font-semibold">
                            {templateName}
                            {doc?.number && (
                                <span className="imcrm-ml-2 imcrm-font-normal imcrm-text-muted-foreground" data-view-number>
                                    {doc.issued ? doc.number : sprintf(__('%s (próximo: ver no lo gasta)'), doc.number)}
                                </span>
                            )}
                        </RDialog.Title>
                        {doc?.frozen && (
                            <span
                                className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-bg-primary/10 imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium imcrm-text-primary"
                                data-view-frozen
                            >
                                <Lock className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                {__('Congelado al emitirlo: no refleja cambios posteriores')}
                            </span>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            className="imcrm-gap-1.5"
                            disabled={!doc}
                            onClick={() => doc && downloadPdf(doc.pdf, doc.filename)}
                        >
                            <Download className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Descargar esta vista')}
                        </Button>
                        <RDialog.Close asChild>
                            <button type="button" aria-label={__('Cerrar')} className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-accent">
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </button>
                        </RDialog.Close>
                    </div>
                    <div className="imcrm-min-h-0 imcrm-flex-1">
                        {error ? (
                            <p className="imcrm-p-6 imcrm-text-center imcrm-text-sm imcrm-text-destructive">{error}</p>
                        ) : (
                            <PdfCanvasPreview
                                pdf={doc?.pdf ?? null}
                                regions={[]}
                                pageWidth={0}
                                pageHeight={0}
                                selectedId={null}
                                onSelect={() => undefined}
                                loading={!doc}
                                maxWidth={900}
                            />
                        )}
                    </div>
                </RDialog.Content>
            </RDialog.Portal>
        </RDialog.Root>
    );
}
