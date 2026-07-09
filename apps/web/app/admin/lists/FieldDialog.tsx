import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { FieldConfigEditor } from '@/admin/lists/FieldConfigEditor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateField, useUpdateField } from '@/hooks/useFields';
import { useFieldTypes } from '@/hooks/useFieldTypes';
import { ApiError } from '@/lib/api';
import { riskOf } from '@/lib/fieldTypeMigration';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity, FieldTypeSlug } from '@/types/field';

import { FieldTypeSelect } from './FieldTypeSelect';
import { SlugEditor } from './SlugEditor';

/**
 * Dialog unificado de creación + edición de campos. Maneja:
 * - label / slug / type
 * - is_required / is_unique
 * - config específica del tipo (delegada a `<FieldConfigEditor />`)
 *
 * En modo edición (cuando `field` está presente):
 * - El selector de tipo permite cambiar a tipos compatibles
 *   (definidos en `app/lib/fieldTypeMigration.ts` y validados en
 *   backend por `FieldTypeMigration`). Las transiciones con pérdida
 *   muestran badge de riesgo en la opción y un warning antes de submit.
 * - Los demás atributos siguen siendo editables.
 */
interface FieldDialogProps {
    listId: number;
    /** Si se pasa, el dialog está en modo edición. */
    field?: FieldEntity | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function FieldDialog({
    listId,
    field,
    open,
    onOpenChange,
}: FieldDialogProps): JSX.Element {
    const create = useCreateField(listId);
    const update = useUpdateField(listId);
    const { data: fieldTypes } = useFieldTypes();

    const isEdit = field !== undefined && field !== null;

    const [label, setLabel] = useState('');
    const [type, setType] = useState<FieldTypeSlug | ''>('');
    const [slug, setSlug] = useState('');
    const [slugDirty, setSlugDirty] = useState(false);
    const [isRequired, setIsRequired] = useState(false);
    const [isUnique, setIsUnique] = useState(false);
    const [isIndexed, setIsIndexed] = useState(false);
    const [config, setConfig] = useState<Record<string, unknown>>({});
    const [submitError, setSubmitError] = useState<string | null>(null);

    // Pre-llenar / resetear al abrir el dialog. Importante: `create` y
    // `update` (hooks de TanStack Query) cambian de referencia en cada
    // render — si los incluimos en las deps, el efecto re-corre tras
    // cada keystroke y RESETEA el label que el usuario está escribiendo.
    // Por eso dependemos sólo de `[open, isEdit, field?.id]` (estables)
    // y disable la regla exhaustive-deps.
    useEffect(() => {
        if (!open) {
            return;
        }
        if (isEdit && field) {
            setLabel(field.label);
            setType(field.type);
            setSlug(field.slug);
            setSlugDirty(true);
            setIsRequired(field.is_required);
            setIsUnique(field.is_unique);
            setIsIndexed(field.is_indexed);
            setConfig(field.config ?? {});
        } else {
            setLabel('');
            setType('');
            setSlug('');
            setSlugDirty(false);
            setIsRequired(false);
            setIsUnique(false);
            setIsIndexed(false);
            setConfig({});
        }
        setSubmitError(null);
        // Limpia errores de un attempt anterior (idempotente).
        create.reset();
        update.reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, isEdit, field?.id]);

    const supportsUnique = useMemo(
        () => fieldTypes?.find((t) => t.slug === type)?.supports_unique ?? false,
        [fieldTypes, type],
    );

    useEffect(() => {
        if (!supportsUnique && isUnique) {
            setIsUnique(false);
        }
    }, [supportsUnique, isUnique]);

    // Cuando cambia el tipo, reseteamos config para evitar arrastrar
    // claves de un tipo previo (ej. options al pasar de select a number).
    const handleTypeChange = (next: FieldTypeSlug | ''): void => {
        setType(next);
        setConfig({});
    };

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        if (!type) return;
        setSubmitError(null);

        // Si el usuario está cambiando el tipo en modo edición,
        // confirmamos antes de submitear cuando el riesgo es
        // `destructive` (ej. multi_select → select pierde N-1 valores).
        if (isEdit && field && type !== field.type) {
            const risk = riskOf(field.type, type);
            if (risk === 'destructive') {
                const ok = window.confirm(
                    __(
                        'Esta conversión puede perder datos en los registros existentes. ¿Continuar?',
                    ),
                );
                if (! ok) return;
            }
        }

        try {
            if (isEdit && field) {
                await update.mutateAsync({
                    id: field.id,
                    input: {
                        label: label.trim(),
                        slug: slug || undefined,
                        // Si el tipo cambió, lo enviamos para que el
                        // backend dispare `FieldService::changeType()`.
                        ...(type !== field.type ? { type } : {}),
                        is_required: isRequired,
                        is_unique: isUnique,
                        is_indexed: isIndexed,
                        config,
                    },
                });
            } else {
                await create.mutateAsync({
                    label: label.trim(),
                    type,
                    slug: slug || undefined,
                    is_required: isRequired,
                    is_unique: isUnique,
                    is_indexed: isIndexed,
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

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay
                    className={cn(
                        'imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm',
                    )}
                />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-text-card-foreground imcrm-p-6 imcrm-shadow-imcrm-lg',
                        'imcrm-max-h-[85vh] imcrm-overflow-y-auto',
                    )}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {isEdit ? __('Editar campo') : __('Añadir campo')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {isEdit
                                    ? __('El tipo no se puede cambiar tras crear el campo. Los demás atributos sí.')
                                    : __('Define el label, tipo, slug y configuración del nuevo campo.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <form onSubmit={handleSubmit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-4">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="field-label">{__('Label')}</Label>
                            <Input
                                id="field-label"
                                value={label}
                                onChange={(e) => setLabel(e.target.value)}
                                placeholder={__('Ej. Email')}
                                autoFocus
                            />
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label>{__('Tipo')}</Label>
                            <FieldTypeSelect
                                value={type}
                                onChange={handleTypeChange}
                                editingFromType={isEdit && field ? field.type : undefined}
                            />
                            {isEdit && field && type !== '' && type !== field.type && (
                                <TypeChangeWarning fromType={field.type} toType={type} />
                            )}
                        </div>

                        <SlugEditor
                            type="field"
                            sourceText={label}
                            listId={listId}
                            value={slug}
                            onChange={setSlug}
                            isDirty={slugDirty}
                            onDirty={() => setSlugDirty(true)}
                        />

                        <FieldConfigEditor
                            type={type}
                            config={config}
                            onChange={setConfig}
                            listId={listId}
                            currentFieldId={field?.id}
                        />

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                <input
                                    type="checkbox"
                                    checked={isRequired}
                                    onChange={(e) => setIsRequired(e.target.checked)}
                                />
                                {__('Obligatorio')}
                            </label>
                            <label
                                className={cn(
                                    'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm',
                                    !supportsUnique && 'imcrm-opacity-50',
                                )}
                            >
                                <input
                                    type="checkbox"
                                    checked={isUnique}
                                    onChange={(e) => setIsUnique(e.target.checked)}
                                    disabled={!supportsUnique}
                                />
                                {__('Único')}
                                {!supportsUnique && type !== '' && ' ' + __('(no soportado por este tipo)')}
                            </label>
                            {/* `is_indexed` (0.28.0): el user marca los
                                campos por los que filtra/ordena seguido
                                para que el plugin agregue un índice
                                MySQL. Vital a 50k+ filas. Tooltip explica
                                el tradeoff. UNIQUE ya provee índice así
                                que cuando isUnique está on, este se
                                deshabilita. */}
                            <label
                                className={cn(
                                    'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm',
                                    isUnique && 'imcrm-opacity-50',
                                )}
                                title={__('Crea un índice MySQL no-único sobre la columna. Acelera filtros y sort en listas grandes (50k+ registros). Tradeoff: ~10% más storage y writes ~5% más lentos. Activa solo en campos por los que filtras a menudo.')}
                            >
                                <input
                                    type="checkbox"
                                    checked={isIndexed}
                                    onChange={(e) => setIsIndexed(e.target.checked)}
                                    disabled={isUnique}
                                />
                                {__('Indexar')}
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('(rápido a gran escala)')}
                                </span>
                            </label>
                        </div>

                        {submitError !== null && (
                            <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                {submitError}
                            </div>
                        )}

                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Dialog.Close asChild>
                                <Button type="button" variant="outline">
                                    {__('Cancelar')}
                                </Button>
                            </Dialog.Close>
                            <Button type="submit" disabled={!canSubmit}>
                                {isPending
                                    ? __('Guardando…')
                                    : isEdit
                                      ? __('Guardar cambios')
                                      : __('Crear campo')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function TypeChangeWarning({
    fromType,
    toType,
}: {
    fromType: string;
    toType: string;
}): JSX.Element | null {
    const risk = riskOf(fromType, toType);
    if (risk === null || risk === 'safe') {
        // safe = sin warning. null no debería pasar porque el dropdown
        // filtra por allowedTargetsFor.
        return null;
    }
    const palette = risk === 'destructive'
        ? 'imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-text-destructive'
        : 'imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-text-warning-foreground';
    const message = risk === 'destructive'
        ? __('Esta conversión perderá información en los registros existentes (ej. multi_select → select solo conserva el primer valor).')
        : __('Esta conversión puede modificar algunos valores existentes (ej. truncar a 255 caracteres o descartar la hora).');

    return (
        <div className={cn('imcrm-mt-1 imcrm-rounded-md imcrm-border imcrm-px-3 imcrm-py-2 imcrm-text-xs', palette)}>
            <strong>{__('Atención:')}</strong> {message}{' '}
            {__('Antes de continuar, considerá hacer un export por seguridad.')}
        </div>
    );
}
