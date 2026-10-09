import { lazy, Suspense, useState } from 'react';
import { ClipboardList, ExternalLink, Link2, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { readStoreListMarker } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useFields } from '@/hooks/useFields';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import { __ } from '@/lib/i18n';

import { formPublicUrl, useCreateForm, useDeleteForm, useForms, useUpdateForm } from './useForms';

const FormBuilder = lazy(() => import('./FormBuilder'));

/**
 * v0.1.275 — Ajustes de la lista → Formularios (ADR-S39). Cada formulario es
 * una página pública que crea un registro por respuesta; se diseña en el
 * constructor a pantalla completa.
 */
export function FormsPanel({ listId, listName, listSettings }: { listId: number; listName: string; listSettings: unknown }): JSX.Element {
    const forms = useForms(listId);
    const fields = useFields(listId);
    const create = useCreateForm(listId);
    const update = useUpdateForm(listId);
    const remove = useDeleteForm(listId);
    const confirm = useConfirm();
    const toast = useToast();
    const [editingId, setEditingId] = useState<number | null>(null);

    // Las listas que llenan una tienda no aceptan altas desde la app.
    if (readStoreListMarker(listSettings)) {
        return (
            <Card>
                <CardContent className="imcrm-pt-5 imcrm-text-sm imcrm-text-muted-foreground" data-testid="forms-store-managed">
                    {__('Esta lista la llena la tienda en línea: los registros nuevos se crean allá, así que no puede tener formularios.')}
                </CardContent>
            </Card>
        );
    }

    const list = forms.data ?? [];
    const editing = editingId !== null ? list.find((f) => f.id === editingId) ?? null : null;

    const createNew = (): void => {
        create.mutate(
            { name: list.length === 0 ? `${__('Formulario de')} ${listName}` : `${__('Formulario')} ${list.length + 1}` },
            {
                onSuccess: (form) => setEditingId(form.id),
                onError: (err) => toast.error(__('No se pudo crear'), err instanceof Error ? err.message : String(err)),
            },
        );
    };

    const copyLink = (url: string): void => {
        void navigator.clipboard.writeText(url).then(
            () => toast.success(__('Enlace copiado')),
            () => toast.error(__('No se pudo copiar')),
        );
    };

    return (
        <Card>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-pt-5" data-testid="forms-panel">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                    <p className="imcrm-max-w-xl imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Compartí el enlace o insertalo en tu sitio. Cada respuesta crea un registro, y una automatización puede avisarte o responderle a quien lo llenó.')}
                    </p>
                    <Button size="sm" className="imcrm-gap-1.5" onClick={createNew} disabled={create.isPending} data-testid="form-new">
                        {create.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Plus className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {__('Nuevo formulario')}
                    </Button>
                </div>

                {forms.isLoading ? (
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                        {__('Cargando…')}
                    </p>
                ) : list.length === 0 ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-8 imcrm-text-center">
                        <ClipboardList className="imcrm-h-7 imcrm-w-7 imcrm-text-muted-foreground" />
                        <p className="imcrm-text-sm imcrm-font-medium">{__('Todavía no hay formularios')}</p>
                        <p className="imcrm-max-w-sm imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Arrancá con los campos de la lista ya puestos: sacá los que no quieras preguntar y publicalo.')}
                        </p>
                        <Button size="sm" variant="outline" onClick={createNew} disabled={create.isPending}>
                            {__('Crear el primero')}
                        </Button>
                    </div>
                ) : (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border">
                        {list.map((f) => {
                            const url = formPublicUrl(f);
                            const questions = f.config.items.filter((i) => i.type === 'field' && !i.hidden).length;
                            return (
                                <li key={f.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-2.5" data-form={f.id}>
                                    <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                                        <ClipboardList className="imcrm-h-4 imcrm-w-4" />
                                    </span>
                                    <div className="imcrm-min-w-0 imcrm-flex-1">
                                        <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                                            <span className="imcrm-truncate">{f.name}</span>
                                            <span
                                                className={
                                                    f.enabled
                                                        ? 'imcrm-shrink-0 imcrm-rounded imcrm-bg-success/10 imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-success'
                                                        : 'imcrm-shrink-0 imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-muted-foreground'
                                                }
                                                data-form-status
                                            >
                                                {f.enabled ? __('Publicado') : __('Sin publicar')}
                                            </span>
                                        </p>
                                        <p className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                                            {questions} {questions === 1 ? __('pregunta') : __('preguntas')} ·{' '}
                                            {f.submissions_count} {f.submissions_count === 1 ? __('respuesta') : __('respuestas')}
                                            {f.last_submitted_at && ` · ${__('última')} ${formatDateTimeStr(f.last_submitted_at)}`}
                                        </p>
                                    </div>
                                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                        <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => setEditingId(f.id)} data-form-edit>
                                            <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                            {__('Editar')}
                                        </Button>
                                        {f.enabled ? (
                                            <>
                                                <Button variant="ghost" size="icon" aria-label={__('Copiar enlace')} title={__('Copiar enlace')} onClick={() => copyLink(url)}>
                                                    <Link2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                                </Button>
                                                <Button variant="ghost" size="icon" aria-label={__('Abrir')} title={__('Abrir el formulario')} asChild>
                                                    <a href={url} target="_blank" rel="noreferrer">
                                                        <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    </a>
                                                </Button>
                                            </>
                                        ) : (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={questions === 0 || update.isPending}
                                                title={questions === 0 ? __('Agregá al menos una pregunta') : undefined}
                                                onClick={() =>
                                                    update.mutate(
                                                        { id: f.id, body: { enabled: true } },
                                                        {
                                                            onSuccess: () => toast.success(__('Formulario publicado')),
                                                            onError: (err) => toast.error(__('No se pudo publicar'), err instanceof Error ? err.message : String(err)),
                                                        },
                                                    )
                                                }
                                            >
                                                {__('Publicar')}
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={__('Eliminar')}
                                            onClick={() =>
                                                void confirm({
                                                    title: __('¿Eliminar el formulario?'),
                                                    description: `«${f.name}». ${__('El enlace deja de funcionar. Los registros que ya llegaron se conservan.')}`,
                                                    confirmLabel: __('Eliminar'),
                                                    destructive: true,
                                                }).then((ok) => {
                                                    if (!ok) return;
                                                    remove.mutate(f.id, {
                                                        onSuccess: () => toast.success(__('Formulario eliminado')),
                                                        onError: (err) => toast.error(__('No se pudo eliminar'), err instanceof Error ? err.message : String(err)),
                                                    });
                                                })
                                            }
                                        >
                                            <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                        </Button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </CardContent>

            {editing && (
                <Suspense fallback={null}>
                    <FormBuilder
                        open
                        onOpenChange={(o) => !o && setEditingId(null)}
                        listId={listId}
                        form={editing}
                        fields={fields.data ?? []}
                    />
                </Suspense>
            )}
        </Card>
    );
}
