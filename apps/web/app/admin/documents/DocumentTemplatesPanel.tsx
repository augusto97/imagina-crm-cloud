import { lazy, Suspense, useState } from 'react';
import { FileText, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { DOC_PAGE_SIZE_LABELS, type DocDesign } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useFields } from '@/hooks/useFields';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import { __ } from '@/lib/i18n';

import { DocumentStarterDialog } from './DocumentStarterDialog';
import { useDeleteDocumentTemplate, useDocumentTemplates } from './useDocuments';

const DocumentDesigner = lazy(() => import('./DocumentDesigner'));

/**
 * v0.1.266 — Ajustes de la lista → Documentos (ADR-S35): las plantillas de
 * PDF de la lista (cuenta de cobro, recibo…). Se usan desde la ficha de un
 * registro («Generar PDF») y desde las automatizaciones (acción «Generar un
 * PDF» y los adjuntos de «Enviar email»).
 */
export function DocumentTemplatesPanel({ listId }: { listId: number }): JSX.Element {
    const templates = useDocumentTemplates(listId);
    const fields = useFields(listId);
    const remove = useDeleteDocumentTemplate(listId);
    const confirm = useConfirm();
    const toast = useToast();
    const [starterOpen, setStarterOpen] = useState(false);
    const [editing, setEditing] = useState<{ id: number | null; initial?: { name: string; filename: string; design: DocDesign } } | null>(null);

    return (
        <Card>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-pt-5" data-testid="doc-templates-panel">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                    <p className="imcrm-max-w-xl imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Diseña documentos con los datos de cada registro. Después los generas desde la ficha o los manda una automatización por correo.')}
                    </p>
                    <Button size="sm" className="imcrm-gap-1.5" onClick={() => setStarterOpen(true)} data-testid="doc-new">
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Nueva plantilla')}
                    </Button>
                </div>

                {templates.isLoading ? (
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                        {__('Cargando…')}
                    </p>
                ) : (templates.data ?? []).length === 0 ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-8 imcrm-text-center">
                        <FileText className="imcrm-h-7 imcrm-w-7 imcrm-text-muted-foreground" />
                        <p className="imcrm-text-sm imcrm-font-medium">{__('Todavía no hay plantillas')}</p>
                        <p className="imcrm-max-w-sm imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Arranca con la cuenta de cobro: el monto en letras, tus datos bancarios y la firma ya vienen armados.')}
                        </p>
                        <Button size="sm" variant="outline" onClick={() => setStarterOpen(true)}>
                            {__('Crear la primera')}
                        </Button>
                    </div>
                ) : (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border">
                        {(templates.data ?? []).map((t) => (
                            <li key={t.id} className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-2.5" data-doc-template={t.id}>
                                <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                                    <FileText className="imcrm-h-4 imcrm-w-4" />
                                </span>
                                <div className="imcrm-min-w-0 imcrm-flex-1">
                                    <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                                        <span className="imcrm-truncate">{t.name}</span>
                                        {t.next_label && (
                                            <span
                                                className="imcrm-shrink-0 imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-muted-foreground"
                                                title={__('Próximo número a emitir')}
                                                data-doc-next
                                            >
                                                {__('Próximo')} {t.next_label}
                                            </span>
                                        )}
                                        {t.portal_visible && (
                                            <span
                                                className="imcrm-shrink-0 imcrm-rounded imcrm-bg-primary/10 imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-primary"
                                                title={__('El cliente lo descarga desde su portal')}
                                                data-doc-portal
                                            >
                                                {__('Portal')}
                                            </span>
                                        )}
                                    </p>
                                    <p className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                                        {__(DOC_PAGE_SIZE_LABELS[t.page_size])} · {t.blocks} {__('bloques')} · {__('Editada')} {formatDateTimeStr(t.updated_at)}
                                    </p>
                                </div>
                                <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => setEditing({ id: t.id })}>
                                    <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Editar')}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={__('Eliminar')}
                                    onClick={() =>
                                        void confirm({
                                            title: __('¿Eliminar la plantilla?'),
                                            description: `«${t.name}». ${__('Los PDF ya generados no se borran.')}`,
                                            confirmLabel: __('Eliminar'),
                                            destructive: true,
                                        }).then((ok) => {
                                            if (!ok) return;
                                            remove.mutate(t.id, {
                                                onSuccess: () => toast.success(__('Plantilla eliminada')),
                                                onError: (err) => toast.error(__('No se pudo eliminar'), err instanceof Error ? err.message : String(err)),
                                            });
                                        })
                                    }
                                >
                                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>

            <DocumentStarterDialog
                open={starterOpen}
                onOpenChange={setStarterOpen}
                listId={listId}
                fields={fields.data ?? []}
                onCreate={(initial) => {
                    setStarterOpen(false);
                    setEditing({ id: null, initial });
                }}
            />
            {editing && (
                <Suspense fallback={null}>
                    <DocumentDesigner
                        open
                        onOpenChange={(o) => !o && setEditing(null)}
                        listId={listId}
                        templateId={editing.id}
                        initial={editing.initial}
                        fields={fields.data ?? []}
                    />
                </Suspense>
            )}
        </Card>
    );
}
