import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Columns3 } from 'lucide-react';
import {
    SUBSCRIPTION_FIELD_LABELS,
    SUBSCRIPTION_FIELD_ROLES,
    SUBSCRIPTION_FIELD_TYPES,
    type SetSubscriptionFieldsInput,
    type SubscriptionFieldRole,
    type SubscriptionFields,
} from '@imagina-base/shared';

import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { fieldsKeys } from '@/hooks/useFields';
import { invalidateForList, recordsKeys } from '@/hooks/useRecords';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';

import { SUB_ROLE_HINTS, proposeSubscriptionChoices, type SubChoice, type SubFieldLike } from './subscriptionText';

/**
 * v0.1.367 (ADR-S96) — Dónde guarda la lista cada dato de la suscripción
 * (estado, plan, valor, próximo cobro, pagado hasta, rechazos, link). Con
 * esas columnas se filtra «quién está en mora» y se agrupa por estado.
 */
export function SubscriptionFieldsEditor({
    listId,
    fields,
    intro,
    onSaved,
}: {
    listId: number | string;
    fields: SubFieldLike[];
    intro?: string;
    onSaved?: (mapping: SubscriptionFields) => void;
}): JSX.Element {
    const qc = useQueryClient();
    const toast = useToast();
    const canEdit = useCan(CAP.MANAGE_FIELDS);
    const q = useQuery({
        queryKey: ['subscription-fields', String(listId)],
        queryFn: () => api.subscriptionFields(listId),
        retry: false,
    });
    const current = q.data?.fields ?? null;
    const proposal = useMemo(() => proposeSubscriptionChoices(fields, current), [fields, current]);
    const [choices, setChoices] = useState<Record<SubscriptionFieldRole, SubChoice> | null>(null);
    useEffect(() => {
        if (q.isSuccess && choices === null) setChoices(proposal);
    }, [q.isSuccess, proposal, choices]);

    const save = useMutation({
        mutationFn: (input: SetSubscriptionFieldsInput) => api.setSubscriptionFields(listId, input),
        onSuccess: (mapping) => {
            setChoices({ ...mapping });
            void qc.invalidateQueries({ queryKey: ['subscription-fields', String(listId)] });
            void qc.invalidateQueries({ queryKey: ['record-subscriptions'] });
            invalidateForList(qc, fieldsKeys.all, listId);
            invalidateForList(qc, recordsKeys.all, listId);
            toast.success(__('Columnas de la suscripción guardadas'), __('El estado, el próximo cobro y los rechazos se escriben solos en esas columnas.'));
            onSaved?.(mapping);
        },
        onError: (err) => toast.error(__('No se pudieron guardar'), err instanceof Error ? err.message : String(err)),
    });

    if (q.isError) {
        return <p className="imcrm-text-xs imcrm-text-destructive">{__('No se pudo leer dónde guarda las suscripciones esta lista.')}</p>;
    }
    if (q.isLoading || !choices) return <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Cargando…')}</p>;

    const dirty = current === null || SUBSCRIPTION_FIELD_ROLES.some((r) => choices[r] !== (current[r] ?? null));
    const usedBy = (id: number, except: SubscriptionFieldRole): boolean => SUBSCRIPTION_FIELD_ROLES.some((r) => r !== except && choices[r] === id);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="imcrm-subscription-fields">
            {intro && <p className="imcrm-text-xs imcrm-text-muted-foreground">{intro}</p>}
            {current === null && (
                <p className="imcrm-rounded-md imcrm-bg-amber-50 imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-text-amber-900 dark:imcrm-bg-amber-950/40 dark:imcrm-text-amber-200">
                    {__('Esta lista todavía no guarda las suscripciones en ninguna columna: el estado sólo se ve en «Suscripción» de la ficha.')}
                </p>
            )}
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                {SUBSCRIPTION_FIELD_ROLES.map((role) => {
                    const value = choices[role];
                    const compatible = fields.filter((f) => (SUBSCRIPTION_FIELD_TYPES[role] as readonly string[]).includes(f.type));
                    return (
                        <label key={role} className="imcrm-grid imcrm-gap-1 sm:imcrm-grid-cols-[11rem_1fr] sm:imcrm-items-center">
                            <span className="imcrm-text-xs">
                                <span className="imcrm-font-medium imcrm-text-foreground">{__(SUBSCRIPTION_FIELD_LABELS[role])}</span>
                                <span className="imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">{__(SUB_ROLE_HINTS[role])}</span>
                            </span>
                            <select
                                className="imcrm-h-8 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                                value={value === null ? '' : String(value)}
                                disabled={!canEdit || save.isPending}
                                onChange={(e) => {
                                    const raw = e.target.value;
                                    const next: SubChoice = raw === '' ? null : raw === 'create' ? 'create' : Number(raw);
                                    setChoices({ ...choices, [role]: next });
                                }}
                                data-testid={`imcrm-subscription-field-${role}`}
                            >
                                <option value="">{__('No guardar')}</option>
                                <option value="create">{sprintf(__('Crear columna «%s»'), __(SUBSCRIPTION_FIELD_LABELS[role]))}</option>
                                {compatible.map((f) => (
                                    <option key={f.id} value={String(f.id)} disabled={usedBy(f.id, role)}>
                                        {f.label}
                                        {usedBy(f.id, role) ? ` ${__('(ya elegida)')}` : ''}
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
                            const input: SetSubscriptionFieldsInput = {};
                            for (const r of SUBSCRIPTION_FIELD_ROLES) input[r] = choices[r];
                            save.mutate(input);
                        }}
                        data-testid="imcrm-subscription-fields-save"
                    >
                        <Columns3 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {current === null ? __('Guardar las suscripciones en estas columnas') : __('Guardar cambios')}
                    </Button>
                    {!dirty && current !== null && <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Listo: así quedan.')}</span>}
                </div>
            ) : (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Elegir las columnas lo hace quien administra los campos de la lista.')}</p>
            )}
        </div>
    );
}
