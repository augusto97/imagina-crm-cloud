import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Link } from 'react-router';
import { Settings2, X } from 'lucide-react';

import { FieldConfigEditor } from '@/admin/lists/FieldConfigEditor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpdateField } from '@/hooks/useFields';
import { ApiError } from '@/lib/api';
import { FIELD_TYPE_OPTIONS } from '@/lib/fieldTypeCatalog';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

/**
 * Cuadro flotante para EDITAR un campo sin salir de la tabla (v0.1.74;
 * v0.1.160 lo dejó sólo para edición — el alta se mudó al panel lateral
 * `FieldsPanel`, que trae el catálogo con vista previa).
 *
 * Muestra el tipo FIJO (convertirlo migra datos: eso vive en el
 * administrador de campos), el Nombre autoenfocado —así "Cambiar el
 * nombre" reutiliza este mismo cuadro sin UI propia—, la config del tipo y
 * "Obligatorio". El botón **Ajustes avanzados** abre este campo en el
 * administrador, que es donde están el slug, la unicidad y el índice.
 */
interface FieldCreateDialogProps {
    listId: number;
    /** Slug de la lista — para el botón "Ajustes avanzados". */
    listSlug: string;
    /** Campo a editar. Sin campo, el diálogo no se renderiza. */
    field?: FieldEntity | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function FieldCreateDialog({
    listId,
    listSlug,
    field,
    open,
    onOpenChange,
}: FieldCreateDialogProps): JSX.Element | null {
    const update = useUpdateField(listId);

    const [label, setLabel] = useState('');
    const [isRequired, setIsRequired] = useState(false);
    const [config, setConfig] = useState<Record<string, unknown>>({});
    const [submitError, setSubmitError] = useState<string | null>(null);

    // Precarga al abrir. `update` queda FUERA de las deps a propósito (misma
    // lección que FieldDialog del builder: el objeto de mutación cambia de
    // referencia en cada render y el efecto resetearía el nombre mientras el
    // usuario escribe).
    useEffect(() => {
        if (!open || !field) return;
        setLabel(field.label);
        setIsRequired(field.is_required);
        setConfig(field.config ?? {});
        setSubmitError(null);
        update.reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, field?.id]);

    if (!field) return null;

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        if (label.trim() === '') return;
        setSubmitError(null);
        try {
            await update.mutateAsync({
                id: field.id,
                input: { label: label.trim(), is_required: isRequired, config },
            });
            onOpenChange(false);
        } catch (err) {
            setSubmitError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    const option = FIELD_TYPE_OPTIONS.find((o) => o.type === field.type);
    const Icon = fieldTypeIcon(field.type);

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-lg',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-text-card-foreground imcrm-p-6 imcrm-shadow-imcrm-lg',
                        'imcrm-max-h-[85vh] imcrm-overflow-y-auto',
                    )}
                    // Centrado con transform inline (evita las utilities
                    // negativas imcrm--translate-* — prohibidas para
                    // código nuevo).
                    style={{ transform: 'translate(-50%, -50%)' }}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {__('Editar campo')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Cambia el nombre y la configuración. El tipo se convierte desde los ajustes avanzados.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <form onSubmit={handleSubmit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-4">
                        <span className="imcrm-inline-flex imcrm-w-fit imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-muted imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground imcrm-ring-1 imcrm-ring-inset imcrm-ring-border">
                            <Icon className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {option?.label ?? field.type}
                        </span>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="records-field-name">{__('Nombre')}</Label>
                            <Input
                                id="records-field-name"
                                value={label}
                                onChange={(e) => setLabel(e.target.value)}
                                placeholder={__('Ej. Estado')}
                                autoFocus
                            />
                        </div>

                        <FieldConfigEditor
                            type={field.type}
                            config={config}
                            onChange={setConfig}
                            listId={listId}
                            currentFieldId={field.id}
                        />

                        <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                            <input
                                type="checkbox"
                                checked={isRequired}
                                onChange={(e) => setIsRequired(e.target.checked)}
                            />
                            {__('Obligatorio')}
                        </label>

                        {submitError !== null && (
                            <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                {submitError}
                            </div>
                        )}

                        <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                            <AdvancedLink
                                listSlug={listSlug}
                                fieldId={field.id}
                                onNavigate={() => onOpenChange(false)}
                            />
                            <Button type="submit" disabled={label.trim() === '' || update.isPending}>
                                {update.isPending ? __('Guardando…') : __('Guardar')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/**
 * Salida al administrador de campos para lo que no entra en este cuadro:
 * slug, unicidad, índice, conversión de tipo y orden.
 *
 * v0.1.160 — pasó de link de texto chico a BOTÓN (pedido del usuario):
 * desde el cuadro de edición tiene que verse la puerta al editor completo.
 * Con `fieldId`, el administrador abre DIRECTO ese campo.
 */
function AdvancedLink({
    listSlug,
    fieldId,
    onNavigate,
}: {
    listSlug: string;
    fieldId: number;
    onNavigate: () => void;
}): JSX.Element {
    return (
        <Button asChild variant="outline" size="sm" className="imcrm-gap-1.5">
            <Link to={`/lists/${listSlug}/edit?s=campos&field=${fieldId}`} onClick={onNavigate}>
                <Settings2 className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                {__('Ajustes avanzados')}
            </Link>
        </Button>
    );
}
