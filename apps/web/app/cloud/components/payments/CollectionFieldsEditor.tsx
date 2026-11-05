import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Columns3 } from 'lucide-react';
import {
    COLLECTION_FIELD_LABELS,
    COLLECTION_FIELD_ROLES,
    COLLECTION_FIELD_TYPES,
    type CollectionFieldRole,
    type CollectionFields,
    type SetCollectionFieldsInput,
} from '@imagina-base/shared';

import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { fieldsKeys } from '@/hooks/useFields';
import { invalidateForList, recordsKeys } from '@/hooks/useRecords';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';

import { ROLE_HINTS, proposeCollectionChoices, type Choice, type FieldLike } from './collectionChoices';

/**
 * v0.1.365 — Dónde guarda la lista cada dato del cobro. Antes había un solo
 * botón «Agregar columnas» escondido en la ficha: una automatización creaba el
 * link y no quedaba en ninguna columna visible. Aquí se elige una columna que
 * ya existe, una nueva, o ninguna.
 */
export function CollectionFieldsEditor({
    listId,
    fields,
    intro,
    onSaved,
}: {
    listId: number | string;
    fields: FieldLike[];
    /** Texto de arriba (cada lugar lo cuenta a su manera). */
    intro?: string;
    onSaved?: (mapping: CollectionFields) => void;
}): JSX.Element {
    const qc = useQueryClient();
    const toast = useToast();
    const canEdit = useCan(CAP.MANAGE_FIELDS);
    const q = useQuery({
        queryKey: ['collection-fields', String(listId)],
        queryFn: () => api.collectionFields(listId),
        retry: false,
    });
    const current = q.data?.fields ?? null;
    const proposal = useMemo(() => proposeCollectionChoices(fields, current), [fields, current]);
    const [choices, setChoices] = useState<Record<CollectionFieldRole, Choice> | null>(null);
    // Se propone una vez (al cargar): un refresco de los campos de fondo no
    // pisa lo que la persona está eligiendo.
    useEffect(() => {
        if (q.isSuccess && choices === null) setChoices(proposal);
    }, [q.isSuccess, proposal, choices]);

    const save = useMutation({
        mutationFn: (input: SetCollectionFieldsInput) => api.setCollectionFields(listId, input),
        onSuccess: (mapping) => {
            setChoices({ ...mapping });
            void qc.invalidateQueries({ queryKey: ['collection-fields', String(listId)] });
            void qc.invalidateQueries({ queryKey: ['record-payments'] });
            invalidateForList(qc, fieldsKeys.all, listId);
            invalidateForList(qc, recordsKeys.all, listId);
            toast.success(__('Columnas de cobro guardadas'), __('Cada link nuevo y cada pago quedan escritos en esas columnas.'));
            onSaved?.(mapping);
        },
        onError: (err) => toast.error(__('No se pudieron guardar'), err instanceof Error ? err.message : String(err)),
    });

    if (q.isError) {
        return <p className="imcrm-text-xs imcrm-text-destructive">{__('No se pudo leer dónde guarda los cobros esta lista.')}</p>;
    }
    if (q.isLoading || !choices) return <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Cargando…')}</p>;

    const byId = new Map(fields.map((f) => [f.id, f]));
    const dirty = current === null || COLLECTION_FIELD_ROLES.some((r) => choices[r] !== (current[r] ?? null));
    const usedBy = (id: number, except: CollectionFieldRole): boolean =>
        COLLECTION_FIELD_ROLES.some((r) => r !== except && choices[r] === id);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="imcrm-collection-fields">
            {intro && <p className="imcrm-text-xs imcrm-text-muted-foreground">{intro}</p>}
            {current === null && (
                <p className="imcrm-rounded-md imcrm-bg-amber-50 imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-text-amber-900 dark:imcrm-bg-amber-950/40 dark:imcrm-text-amber-200" data-testid="imcrm-collection-fields-missing">
                    {__('Esta lista todavía no guarda los cobros en ninguna columna: el link sólo se ve en «Cobros» de la ficha.')}
                </p>
            )}
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                {COLLECTION_FIELD_ROLES.map((role) => {
                    const value = choices[role];
                    const compatible = fields.filter((f) => (COLLECTION_FIELD_TYPES[role] as readonly string[]).includes(f.type));
                    return (
                        <label key={role} className="imcrm-grid imcrm-gap-1 sm:imcrm-grid-cols-[11rem_1fr] sm:imcrm-items-center">
                            <span className="imcrm-text-xs">
                                <span className="imcrm-font-medium imcrm-text-foreground">{__(COLLECTION_FIELD_LABELS[role])}</span>
                                <span className="imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">{__(ROLE_HINTS[role])}</span>
                            </span>
                            <select
                                className="imcrm-h-8 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                                value={value === null ? '' : String(value)}
                                disabled={!canEdit || save.isPending}
                                onChange={(e) => {
                                    const raw = e.target.value;
                                    const next: Choice = raw === '' ? null : raw === 'create' ? 'create' : Number(raw);
                                    setChoices({ ...choices, [role]: next });
                                }}
                                data-testid={`imcrm-collection-field-${role}`}
                            >
                                <option value="">{__('No guardar')}</option>
                                <option value="create">{sprintf(__('Crear columna «%s»'), __(COLLECTION_FIELD_LABELS[role]))}</option>
                                {compatible.map((f) => (
                                    <option key={f.id} value={String(f.id)} disabled={usedBy(f.id, role)}>
                                        {f.label}
                                        {byId.get(f.id) && usedBy(f.id, role) ? ` ${__('(ya elegida)')}` : ''}
                                    </option>
                                ))}
                            </select>
                        </label>
                    );
                })}
            </div>
            {canEdit ? (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    <Button
                        type="button"
                        size="sm"
                        disabled={!dirty || save.isPending}
                        onClick={() => {
                            const input: SetCollectionFieldsInput = {};
                            for (const r of COLLECTION_FIELD_ROLES) input[r] = choices[r];
                            save.mutate(input);
                        }}
                        data-testid="imcrm-collection-fields-save"
                    >
                        <Columns3 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {current === null ? __('Guardar los cobros en estas columnas') : __('Guardar cambios')}
                    </Button>
                    {!dirty && current !== null && <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Listo: así quedan.')}</span>}
                </div>
            ) : (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Elegir las columnas lo hace quien administra los campos de la lista.')}</p>
            )}
        </div>
    );
}
