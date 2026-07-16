import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Link } from 'react-router-dom';
import { ArrowLeft, Search, X } from 'lucide-react';

import { FieldConfigEditor } from '@/admin/lists/FieldConfigEditor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateField, useUpdateField } from '@/hooks/useFields';
import { ApiError } from '@/lib/api';
import { FIELD_TYPE_OPTIONS } from '@/lib/fieldTypeCatalog';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity, FieldTypeSlug } from '@/types/field';

/**
 * Modal de creación/edición de campos SIN salir de la tabla de
 * registros (estilo ClickUp — v0.1.74). Dos pasos dentro del mismo
 * modal:
 *
 *   1. Catálogo de tipos: grid buscable con icono + label +
 *      descripción corta por tipo (fuente única: FIELD_TYPE_OPTIONS,
 *      derivado de las mismas ENTRIES que usa el List Builder).
 *   2. Form del campo elegido: Nombre (autofocus) + config específica
 *      del tipo (`FieldConfigEditor`, el mismo del builder) +
 *      checkbox "Obligatorio". Botones Volver / Crear.
 *
 * En modo edición (prop `field`): salta directo al paso 2 con el tipo
 * FIJO (la conversión de tipo migra datos — eso vive en el editor de
 * lista) y los valores precargados; el Nombre queda autoenfocado, así
 * "Cambiar el nombre" reutiliza este mismo modo sin UI extra.
 *
 * La configuración avanzada (slug, único, indexado, conversión de
 * tipo) sigue en el editor de lista — link al pie del modal.
 */
interface FieldCreateDialogProps {
    listId: number;
    /** Slug de la lista — para el link "Configuración avanzada". */
    listSlug: string;
    /** Si se pasa, el modal está en modo edición (tipo fijo). */
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
}: FieldCreateDialogProps): JSX.Element {
    const create = useCreateField(listId);
    const update = useUpdateField(listId);

    const isEdit = field !== undefined && field !== null;

    const [step, setStep] = useState<'type' | 'form'>('type');
    const [typeSearch, setTypeSearch] = useState('');
    const [type, setType] = useState<FieldTypeSlug | ''>('');
    const [label, setLabel] = useState('');
    const [isRequired, setIsRequired] = useState(false);
    const [config, setConfig] = useState<Record<string, unknown>>({});
    const [submitError, setSubmitError] = useState<string | null>(null);

    // Reset / precarga al abrir. `create`/`update` quedan FUERA de las
    // deps a propósito (misma lección que FieldDialog del builder: los
    // objetos de mutación cambian de referencia en cada render y el
    // efecto resetearía el nombre mientras el usuario escribe).
    useEffect(() => {
        if (!open) return;
        if (isEdit && field) {
            setStep('form');
            setType(field.type);
            setLabel(field.label);
            setIsRequired(field.is_required);
            setConfig(field.config ?? {});
        } else {
            setStep('type');
            setType('');
            setLabel('');
            setIsRequired(false);
            setConfig({});
        }
        setTypeSearch('');
        setSubmitError(null);
        create.reset();
        update.reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, isEdit, field?.id]);

    const filteredTypes = useMemo(() => {
        const q = typeSearch.trim().toLowerCase();
        if (q === '') return FIELD_TYPE_OPTIONS;
        return FIELD_TYPE_OPTIONS.filter(
            (o) =>
                o.label.toLowerCase().includes(q)
                || o.description.toLowerCase().includes(q)
                || o.type.includes(q),
        );
    }, [typeSearch]);

    const pickType = (next: FieldTypeSlug): void => {
        setType(next);
        // Config limpia por tipo — no arrastrar claves de otro tipo si
        // el usuario vuelve atrás y elige otro.
        setConfig({});
        setSubmitError(null);
        setStep('form');
    };

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        if (type === '' || label.trim() === '') return;
        setSubmitError(null);
        try {
            if (isEdit && field) {
                await update.mutateAsync({
                    id: field.id,
                    input: {
                        label: label.trim(),
                        is_required: isRequired,
                        config,
                    },
                });
            } else {
                await create.mutateAsync({
                    label: label.trim(),
                    type,
                    is_required: isRequired,
                    config,
                });
            }
            onOpenChange(false);
        } catch (err) {
            setSubmitError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    const isPending = create.isPending || update.isPending;
    const canSubmit = label.trim() !== '' && type !== '' && !isPending;

    const selectedOption = type !== ''
        ? FIELD_TYPE_OPTIONS.find((o) => o.type === type)
        : undefined;
    const SelectedIcon = type !== '' ? fieldTypeIcon(type) : null;

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
                                {isEdit
                                    ? __('Editar campo')
                                    : step === 'type'
                                      ? __('Nuevo campo')
                                      : sprintf(
                                            /* translators: %s: nombre del tipo de campo */
                                            __('Nuevo campo: %s'),
                                            selectedOption?.label ?? '',
                                        )}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {isEdit
                                    ? __('Cambia el nombre y la configuración. El tipo se convierte desde el editor de lista.')
                                    : step === 'type'
                                      ? __('Elige el tipo de dato de la nueva columna.')
                                      : __('Ponle nombre y configura el campo.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    {step === 'type' ? (
                        <div className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-3">
                            <div className="imcrm-relative">
                                <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-2.5 imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                                <Input
                                    value={typeSearch}
                                    onChange={(e) => setTypeSearch(e.target.value)}
                                    placeholder={__('Buscar tipo de campo…')}
                                    className="imcrm-pl-8"
                                    autoFocus
                                />
                            </div>

                            {filteredTypes.length === 0 ? (
                                <p className="imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                                    {__('Ningún tipo coincide con la búsqueda.')}
                                </p>
                            ) : (
                                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-1.5 sm:imcrm-grid-cols-2">
                                    {filteredTypes.map((opt) => {
                                        const Icon = fieldTypeIcon(opt.type);
                                        return (
                                            <button
                                                key={opt.type}
                                                type="button"
                                                onClick={() => pickType(opt.type)}
                                                className={cn(
                                                    'imcrm-flex imcrm-items-start imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-border-transparent imcrm-px-2.5 imcrm-py-2 imcrm-text-left imcrm-transition-colors',
                                                    'hover:imcrm-border-border hover:imcrm-bg-muted/40',
                                                    'focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40',
                                                )}
                                            >
                                                <span className="imcrm-mt-0.5 imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-text-muted-foreground imcrm-ring-1 imcrm-ring-inset imcrm-ring-border">
                                                    <Icon className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                                </span>
                                                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                                                    <span className="imcrm-text-sm imcrm-font-medium imcrm-leading-tight">
                                                        {opt.label}
                                                    </span>
                                                    <span className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">
                                                        {opt.description}
                                                    </span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            <AdvancedLink listSlug={listSlug} onNavigate={() => onOpenChange(false)} />
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-4">
                            {/* Chip del tipo elegido (fijo en edición). */}
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-muted imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground imcrm-ring-1 imcrm-ring-inset imcrm-ring-border">
                                    {SelectedIcon !== null && (
                                        <SelectedIcon className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                    )}
                                    {selectedOption?.label ?? type}
                                </span>
                                {!isEdit && (
                                    <button
                                        type="button"
                                        onClick={() => setStep('type')}
                                        className="imcrm-text-xs imcrm-text-primary hover:imcrm-underline"
                                    >
                                        {__('Cambiar tipo')}
                                    </button>
                                )}
                            </div>

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
                                type={type}
                                config={config}
                                onChange={setConfig}
                                listId={listId}
                                currentFieldId={field?.id}
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
                                <AdvancedLink listSlug={listSlug} onNavigate={() => onOpenChange(false)} />
                                <div className="imcrm-flex imcrm-gap-2">
                                    {!isEdit && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => setStep('type')}
                                            className="imcrm-gap-1.5"
                                        >
                                            <ArrowLeft className="imcrm-h-3.5 imcrm-w-3.5" />
                                            {__('Volver')}
                                        </Button>
                                    )}
                                    <Button type="submit" disabled={!canSubmit}>
                                        {isPending
                                            ? __('Guardando…')
                                            : isEdit
                                              ? __('Guardar')
                                              : __('Crear campo')}
                                    </Button>
                                </div>
                            </div>
                        </form>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/**
 * Link secundario al editor de lista para la configuración avanzada
 * (slug, único, indexado, conversión de tipo, reordenar).
 */
function AdvancedLink({
    listSlug,
    onNavigate,
}: {
    listSlug: string;
    onNavigate: () => void;
}): JSX.Element {
    return (
        <Link
            to={`/lists/${listSlug}/edit?focus=fields`}
            onClick={onNavigate}
            className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground hover:imcrm-underline"
        >
            {__('Configuración avanzada en el editor de lista')}
        </Link>
    );
}
