import { useState } from 'react';
import { Asterisk, KeyRound, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDeleteField, useFields } from '@/hooks/useFields';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { FieldDialog } from './FieldDialog';

interface FieldBuilderProps {
    listId: number;
}

export function FieldBuilder({ listId }: FieldBuilderProps): JSX.Element {
    const fields = useFields(listId);
    const deleteField = useDeleteField(listId);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingField, setEditingField] = useState<FieldEntity | null>(null);

    const openCreate = (): void => {
        setEditingField(null);
        setDialogOpen(true);
    };
    const openEdit = (field: FieldEntity): void => {
        setEditingField(field);
        setDialogOpen(true);
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                <div>
                    <h2 className="imcrm-text-base imcrm-font-semibold">{__('Campos')}</h2>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Cada campo se traduce en una columna real en la base de datos.')}
                    </p>
                </div>
                <Button onClick={openCreate} size="sm" className="imcrm-gap-2">
                    <Plus className="imcrm-h-4 imcrm-w-4" />
                    {__('Añadir campo')}
                </Button>
            </div>

            {fields.isLoading && (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando campos…')}
                </div>
            )}

            {fields.data && fields.data.length === 0 && (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-card imcrm-p-8 imcrm-text-center">
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Esta lista aún no tiene campos. Añade el primero para empezar.')}
                    </p>
                </div>
            )}

            {fields.data && fields.data.length > 0 && (
                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
                    {fields.data.map((field) => (
                        <FieldRow
                            key={field.id}
                            field={field}
                            onEdit={() => openEdit(field)}
                            onDelete={() => {
                                if (
                                    !confirm(
                                        sprintf(
                                            /* translators: %s: field label */
                                            __('¿Eliminar el campo "%s"? Los datos guardados se conservan a menos que pidas borrarlos definitivamente.'),
                                            field.label,
                                        ),
                                    )
                                ) {
                                    return;
                                }
                                deleteField.mutate({ id: field.id, purge: false });
                            }}
                        />
                    ))}
                </ul>
            )}

            <FieldDialog
                listId={listId}
                field={editingField}
                open={dialogOpen}
                onOpenChange={(open) => {
                    setDialogOpen(open);
                    if (!open) setEditingField(null);
                }}
            />
        </div>
    );
}

interface FieldRowProps {
    field: FieldEntity;
    onEdit: () => void;
    onDelete: () => void;
}

function FieldRow({ field, onEdit, onDelete }: FieldRowProps): JSX.Element {
    return (
        <li
            className={cn(
                'imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-px-4 imcrm-py-3',
            )}
        >
            <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-3">
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <span className="imcrm-text-sm imcrm-font-medium">{field.label}</span>
                        {field.is_primary && (
                            <Badge variant="secondary" className="imcrm-gap-1">
                                <KeyRound className="imcrm-h-3 imcrm-w-3" />
                                {__('Primario')}
                            </Badge>
                        )}
                        {field.is_required && (
                            <Badge variant="outline" className="imcrm-gap-1">
                                <Asterisk className="imcrm-h-3 imcrm-w-3" />
                                {__('Obligatorio')}
                            </Badge>
                        )}
                        {field.is_unique && <Badge variant="outline">{__('Único')}</Badge>}
                    </div>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                        <code className="imcrm-font-mono">{field.slug}</code>
                        <span>·</span>
                        <span className="imcrm-uppercase imcrm-tracking-wide">{field.type}</span>
                        {field.column_name && (
                            <>
                                <span>·</span>
                                <code className="imcrm-font-mono imcrm-opacity-60">
                                    col:{field.column_name}
                                </code>
                            </>
                        )}
                    </div>
                </div>
            </div>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onEdit}
                    aria-label={sprintf(
                        /* translators: %s: field label */
                        __('Editar %s'),
                        field.label,
                    )}
                    title={__('Editar')}
                >
                    <Pencil className="imcrm-h-4 imcrm-w-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onDelete}
                    aria-label={sprintf(
                        /* translators: %s: field label */
                        __('Eliminar %s'),
                        field.label,
                    )}
                    title={__('Eliminar')}
                >
                    <Trash2 className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </div>
        </li>
    );
}
