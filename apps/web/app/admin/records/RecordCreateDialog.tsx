import { useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetCloseButton,
    SheetDescription,
    SheetFooter,
    SheetTitle,
} from '@/components/ui/sheet';
import { useCreateRecord } from '@/hooks/useRecords';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { RecordFieldsForm } from './RecordFieldsForm';

interface RecordCreateDialogProps {
    listId: number;
    /**
     * Nombre humano de la lista para el breadcrumb de la barra superior
     * ("{lista} / Nuevo registro"). Opcional para retro-compatibilidad.
     */
    listName?: string;
    fields: FieldEntity[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * Valores iniciales por slug para pre-cargar el form al abrir.
     * Lo usa el modo agrupado: "+ Agregar tarea" en el grupo "Hecho"
     * abre el diálogo con estado=hecho ya seteado.
     */
    initialValues?: Record<string, unknown>;
}

/**
 * Modal de creación con el MISMO diseño del RecordDetailDrawer (patrón
 * ClickUp): barra superior full-width (breadcrumb + X), contenido con
 * chip "Registro" + form de campos en filas planas con icono por tipo
 * (hairlines, sin caja), y footer Cancelar/Crear. Sin aside de
 * actividad (el registro aún no existe). Geometría algo menor que el
 * drawer: min(900px, 92vw) × max-h 88vh.
 */
export function RecordCreateDialog({
    listId,
    listName,
    fields,
    open,
    onOpenChange,
    initialValues,
}: RecordCreateDialogProps): JSX.Element {
    const create = useCreateRecord(listId);
    const { reset: resetCreate } = create;
    const [values, setValues] = useState<Record<string, unknown>>({});
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!open) {
            // Dep en `resetCreate` (estable), NO en `create` (nueva identidad
            // cada render → loop infinito de renders).
            setValues({});
            setError(null);
            setFieldErrors({});
            resetCreate();
        } else if (initialValues !== undefined) {
            // Al abrir con prefill (add-inline de un grupo) sembramos el
            // form. `initialValues` vive en el state del caller — identidad
            // estable mientras el diálogo está abierto, no pisa el tipeo.
            setValues(initialValues);
        }
    }, [open, resetCreate, initialValues]);

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);
        setFieldErrors({});
        try {
            await create.mutateAsync(values);
            onOpenChange(false);
        } catch (err) {
            if (err instanceof ApiError) {
                setError(err.message);
                setFieldErrors(err.errors);
            } else if (err instanceof Error) {
                setError(err.message);
            }
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-40 imcrm-bg-black/40 imcrm-backdrop-blur-sm imcrm-animate-imcrm-fade-in" />
                {/* Centrado por flex (mismo patrón que RecordDetailDrawer):
                 * el transform del scale-in no pelea con el de centrado. */}
                <div className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-flex imcrm-items-center imcrm-justify-center">
                    <DialogPrimitive.Content
                        className={cn(
                            'imcrm-flex imcrm-max-h-[88vh] imcrm-w-[min(900px,92vw)] imcrm-flex-col imcrm-overflow-hidden',
                            'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-text-card-foreground imcrm-shadow-imcrm-xl',
                            'imcrm-animate-imcrm-scale-in',
                        )}
                    >
                        {/* ——— Barra superior full-width (patrón ClickUp) ——— */}
                        <div className="imcrm-flex imcrm-h-12 imcrm-shrink-0 imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-4">
                            <SheetDescription className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-[13px] imcrm-text-muted-foreground">
                                {listName !== undefined && (
                                    <>
                                        {listName}
                                        <span className="imcrm-mx-1.5 imcrm-text-muted-foreground/50">/</span>
                                    </>
                                )}
                                {__('Nuevo registro')}
                            </SheetDescription>
                            <SheetCloseButton />
                        </div>

                        <form onSubmit={handleSubmit} className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col">
                            {/* ——— Contenido con scroll propio ——— */}
                            <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-px-6 imcrm-py-5">
                                {/* Chip de tipo de entidad (como el chip "Tarea" de ClickUp). */}
                                <span className="imcrm-inline-flex imcrm-w-fit imcrm-items-center imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                                    {__('Registro')}
                                </span>

                                <SheetTitle className="imcrm-mt-2 imcrm-text-2xl imcrm-font-bold imcrm-tracking-tight">
                                    {__('Nuevo registro')}
                                </SheetTitle>

                                {/* Mismo layout de filas planas del drawer: icono
                                 * del tipo + label a la izquierda, editor a la
                                 * derecha, separadas solo por hairlines. */}
                                <div className="imcrm-mt-4">
                                    <RecordFieldsForm
                                        listId={listId}
                                        fields={fields}
                                        values={values}
                                        onChange={setValues}
                                        fieldErrors={fieldErrors}
                                        density="compact"
                                        showTypeIcon
                                    />
                                </div>

                                {error !== null && (
                                    <div className="imcrm-mt-4 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                        {error}
                                    </div>
                                )}
                            </div>

                            <SheetFooter>
                                <DialogPrimitive.Close asChild>
                                    <Button type="button" variant="outline">
                                        {__('Cancelar')}
                                    </Button>
                                </DialogPrimitive.Close>
                                <Button type="submit" disabled={create.isPending}>
                                    {create.isPending ? __('Creando…') : __('Crear registro')}
                                </Button>
                            </SheetFooter>
                        </form>
                    </DialogPrimitive.Content>
                </div>
            </DialogPrimitive.Portal>
        </Sheet>
    );
}
