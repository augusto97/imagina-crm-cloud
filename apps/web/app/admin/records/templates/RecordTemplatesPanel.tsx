import { useState } from 'react';
import { BookmarkPlus, ListTodo, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import type { RecordTemplate, RecordTemplateKind } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { useFields } from '@/hooks/useFields';
import { useDeleteRecordTemplate, useRecordTemplates } from '@/hooks/useRecordTemplates';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';

import { RecordTemplateEditor } from './RecordTemplateEditor';
import { templateSummary } from './templateModel';

/**
 * C6 / A9 — Ajustes de la lista → «Plantillas»: las plantillas de REGISTRO
 * («Nuevo cliente»: valores, subtareas y checklists de una vez) y las de
 * CHECKLIST (un checklist listo para agregar a cualquier registro).
 */
export function RecordTemplatesPanel({ listId, readOnly = false }: { listId: number; readOnly?: boolean }): JSX.Element {
    const fields = useFields(listId);
    const [editing, setEditing] = useState<{ kind: RecordTemplateKind; template: RecordTemplate | null } | null>(null);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="imcrm-record-templates-panel">
            <TemplatesCard
                listId={listId}
                kind="record"
                readOnly={readOnly}
                title={__('Plantillas de registro')}
                hint={__('Se usan en «Nuevo registro ▾ → Desde una plantilla», en las automatizaciones («Crear subtareas desde una plantilla») y en los formularios.')}
                empty={__('Todavía no hay plantillas de registro. Crea una aquí o abre un registro y toca «Guardar como plantilla».')}
                onEdit={(template) => setEditing({ kind: 'record', template })}
            />
            <TemplatesCard
                listId={listId}
                kind="checklist"
                readOnly={readOnly}
                title={__('Plantillas de checklist')}
                hint={__('Aparecen en «Checklist ▾» de cualquier registro de la lista.')}
                empty={__('Todavía no hay plantillas de checklist. Crea una aquí o, en un registro, usa «Guardar como plantilla» en el menú del checklist.')}
                onEdit={(template) => setEditing({ kind: 'checklist', template })}
            />
            {editing && fields.data && (
                <RecordTemplateEditor
                    key={`${editing.kind}:${editing.template?.id ?? 'new'}`}
                    listId={listId}
                    fields={fields.data}
                    kind={editing.kind}
                    template={editing.template}
                    open
                    onOpenChange={(o) => !o && setEditing(null)}
                />
            )}
        </div>
    );
}

function TemplatesCard({
    listId,
    kind,
    readOnly,
    title,
    hint,
    empty,
    onEdit,
}: {
    listId: number;
    kind: RecordTemplateKind;
    readOnly: boolean;
    title: string;
    hint: string;
    empty: string;
    onEdit: (t: RecordTemplate | null) => void;
}): JSX.Element {
    const templates = useRecordTemplates(listId, kind);
    const remove = useDeleteRecordTemplate(listId);
    const confirm = useConfirm();
    const toast = useToast();
    const Icon = kind === 'record' ? BookmarkPlus : ListTodo;
    const rows = templates.data ?? [];
    return (
        <Card>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-pt-5" data-testid={`imcrm-templates-${kind}`}>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-2">
                    <div className="imcrm-min-w-0">
                        <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-semibold">
                            <Icon className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                            {title}
                        </h3>
                        <p className="imcrm-max-w-xl imcrm-text-xs imcrm-text-muted-foreground">{hint}</p>
                    </div>
                    {!readOnly && (
                        <Button size="sm" className="imcrm-gap-1.5" onClick={() => onEdit(null)} data-testid={`imcrm-templates-${kind}-new`}>
                            <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Nueva plantilla')}
                        </Button>
                    )}
                </div>
                {templates.isLoading ? (
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                        {__('Cargando…')}
                    </p>
                ) : rows.length === 0 ? (
                    <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-6 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">{empty}</p>
                ) : (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border">
                        {rows.map((t) => (
                            <li key={t.id} className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-2.5" data-record-template={t.id}>
                                <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                                    <Icon className="imcrm-h-4 imcrm-w-4" />
                                </span>
                                <button
                                    type="button"
                                    disabled={readOnly}
                                    onClick={() => onEdit(t)}
                                    className="imcrm-min-w-0 imcrm-flex-1 imcrm-text-left disabled:imcrm-cursor-default"
                                >
                                    <p className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{t.name}</p>
                                    <p className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                        {t.description ? `${t.description} · ` : ''}
                                        {templateSummary(t)}
                                    </p>
                                </button>
                                {!readOnly && (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="imcrm-h-8 imcrm-w-8" aria-label={sprintf(__('Opciones de «%s»'), t.name)}>
                                                <MoreHorizontal className="imcrm-h-4 imcrm-w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onSelect={() => onEdit(t)}>
                                                <Pencil className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" />
                                                {__('Editar')}
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                className="imcrm-text-destructive focus:imcrm-text-destructive"
                                                onSelect={async () => {
                                                    const ok = await confirm({
                                                        title: sprintf(__('¿Eliminar la plantilla «%s»?'), t.name),
                                                        description: __('Los registros que ya salieron de ella no cambian.'),
                                                        confirmLabel: __('Eliminar'),
                                                        destructive: true,
                                                    });
                                                    if (!ok) return;
                                                    remove.mutate(t.id, {
                                                        onError: (err) =>
                                                            toast.error(__('No se pudo eliminar la plantilla'), err instanceof ApiError || err instanceof Error ? err.message : undefined),
                                                    });
                                                }}
                                            >
                                                <Trash2 className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" />
                                                {__('Eliminar')}
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
