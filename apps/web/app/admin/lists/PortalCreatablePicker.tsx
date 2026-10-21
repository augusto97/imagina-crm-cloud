import { useQuery } from '@tanstack/react-query';
import { isUserWritableType, type FieldType, type PortalRelatedList } from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { useFields } from '@/hooks/useFields';
import { api } from '@/lib/api';
import { __ } from '@/lib/i18n';
import type { ListSummary } from '@/types/list';
import type { PortalCreatable } from '@/types/portal';

/** Tipos que el cliente nunca completa al crear (personas del equipo, relaciones, archivos). */
const EXCLUDED = new Set(['relation', 'user', 'file']);

/**
 * «Qué puede crear el cliente»: listas vinculadas a ésta donde el cliente abre
 * registros desde su portal (un ticket, un pedido). Sólo las que tienen una
 * RELACIÓN hacia esta lista —así el registro nuevo queda vinculado a él— y
 * sólo los campos que se marquen aquí. Opt-in: por defecto, ninguna.
 */
export function PortalCreatablePicker({
    list,
    value,
    disabled,
    onChange,
}: {
    list: ListSummary;
    value: PortalCreatable[];
    disabled: boolean;
    onChange: (next: PortalCreatable[]) => void;
}): JSX.Element {
    const options = useQuery({
        queryKey: ['portal-related-options', list.id],
        queryFn: async (): Promise<PortalRelatedList[]> =>
            (await api.get<{ options: PortalRelatedList[] }>(`/lists/${encodeURIComponent(list.slug)}/portal/related-options`)).data.options,
        retry: false,
    });
    const byRelation = (options.data ?? []).filter((o) => o.via === 'relation');

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="portal-creatable">
            <span className="imcrm-text-sm imcrm-font-medium">{__('Qué puede crear el cliente')}</span>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-px-4 imcrm-py-3">
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Desde su portal, el cliente puede abrir registros en otra lista (un ticket, un pedido). Queda vinculado a él solo y el equipo recibe el aviso. Elige la lista y qué datos completa.')}
                </p>
                {options.data && byRelation.length === 0 && (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Ninguna lista tiene una relación hacia ésta. Agrega en la otra lista un campo de tipo "relación" que apunte aquí.')}
                    </p>
                )}
                {byRelation.map((o) => {
                    const current = value.find((v) => v.list_id === o.list_id);
                    return (
                        <CreatableRow
                            key={o.list_id}
                            option={o}
                            current={current}
                            disabled={disabled}
                            onChange={(next) =>
                                onChange(next ? [...value.filter((v) => v.list_id !== o.list_id), next] : value.filter((v) => v.list_id !== o.list_id))
                            }
                        />
                    );
                })}
            </div>
        </div>
    );
}

function CreatableRow({
    option,
    current,
    disabled,
    onChange,
}: {
    option: PortalRelatedList;
    current: PortalCreatable | undefined;
    disabled: boolean;
    onChange: (next: PortalCreatable | null) => void;
}): JSX.Element {
    const fields = useFields(current ? option.list_id : undefined);
    const writable = (fields.data ?? []).filter((f) => isUserWritableType(f.type as FieldType) && !EXCLUDED.has(f.type));
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2.5 imcrm-text-sm">
                <input
                    type="checkbox"
                    className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                    checked={current !== undefined}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.checked ? { list_id: option.list_id, field_ids: [], label: '' } : null)}
                />
                <span className="imcrm-font-medium">{option.name}</span>
            </label>
            {current && (
                <div className="imcrm-ml-6 imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <Input
                        className="imcrm-h-8 imcrm-text-xs"
                        placeholder={`${__('Texto del botón (por ejemplo: «Abrir un ticket»)')}`}
                        value={current.label}
                        maxLength={80}
                        disabled={disabled}
                        onChange={(e) => onChange({ ...current, label: e.target.value })}
                    />
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Datos que completa el cliente:')}</span>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-4 imcrm-gap-y-1">
                        {writable.map((f) => (
                            <label key={f.id} className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs">
                                <input
                                    type="checkbox"
                                    className="imcrm-h-3.5 imcrm-w-3.5"
                                    checked={current.field_ids.includes(f.id)}
                                    disabled={disabled}
                                    onChange={(e) =>
                                        onChange({
                                            ...current,
                                            field_ids: e.target.checked ? [...current.field_ids, f.id] : current.field_ids.filter((id) => id !== f.id),
                                        })
                                    }
                                />
                                {f.label}
                                {f.is_required && <span className="imcrm-text-destructive">*</span>}
                            </label>
                        ))}
                    </div>
                    {current.field_ids.length === 0 && (
                        <p className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-300">
                            {__('Elige al menos un dato: sin campos, el cliente no ve el botón.')}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
