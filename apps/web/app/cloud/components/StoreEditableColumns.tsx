import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowLeftRight, Store } from 'lucide-react';
import {
    STORE_EDITABLE_CATALOG,
    type StoreListRole,
    type StoreMetaResource,
    type StoreSyncStatus,
} from '@imagina-base/shared';

import { api } from '@/cloud/session';
import { listsKeys } from '@/hooks/useLists';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * «Columnas que se editan desde la app» (v0.1.214): cada empresa elige, por
 * lista de la tienda, qué columnas de WooCommerce se pueden cambiar desde aquí
 * —además de precios, stock y estados, el nombre, el SKU, las categorías, las
 * etiquetas, datos de los clientes y los campos de otros plugins traídos a
 * columnas—. Se muestra en la página de la tienda y en Ajustes → Campos de
 * cada lista: es la misma elección vista desde dos lugares.
 */

const ROLE_LABEL: Record<StoreListRole, string> = {
    products: 'Productos y variaciones',
    orders: 'Pedidos',
    customers: 'Clientes',
};

/** Recursos de la tienda (con campos de plugins) que viven en cada lista. */
const META_OF: Record<StoreListRole, StoreMetaResource[]> = {
    products: ['products', 'variations'],
    orders: ['orders'],
    customers: ['customers'],
};

type Editable = StoreSyncStatus['editable'];

export function StoreEditableColumns({
    status,
    roles,
    busy,
    onToggle,
    fieldLabel,
}: {
    status: StoreSyncStatus;
    /** Qué listas mostrar (por defecto, las que la tienda tiene). */
    roles?: StoreListRole[];
    busy: boolean;
    /** Prende o apaga UNA columna (el servidor lo aplica sobre lo guardado). */
    onToggle: (role: StoreListRole, slug: string, on: boolean) => void;
    /** Etiqueta de una columna de plugin (si no, se muestra su clave). */
    fieldLabel?: (fieldId: number) => string | undefined;
}): JSX.Element {
    // Optimista: el tilde se mueve al tocarlo (mismo motivo que «Editar desde la app»).
    const [local, setLocal] = useState<Editable | null>(null);
    useEffect(() => {
        if (!busy) setLocal(null);
    }, [busy]);
    const current = local ?? status.editable;
    const shown = (roles ?? (['products', 'orders', 'customers'] as StoreListRole[])).filter((r) => status.lists[r] !== null && status.lists[r] !== undefined);

    const toggle = (role: StoreListRole, slug: string, on: boolean): void => {
        const list = current[role] ?? [];
        const nextList = on ? [...new Set([...list, slug])] : list.filter((s) => s !== slug);
        const next = { ...current, [role]: nextList };
        setLocal(next);
        onToggle(role, slug, on);
    };

    return (
        <div className="imcrm-grid imcrm-gap-4 md:imcrm-grid-cols-2" data-testid="imcrm-store-editable-columns">
            {shown.map((role) => {
                const chosen = new Set(current[role] ?? []);
                const meta = META_OF[role]
                    .flatMap((r) => status.meta_keys[r] ?? [])
                    .filter((k): k is typeof k & { field_id: number } => k.field_id !== null);
                const uniqueMeta = [...new Map(meta.map((k) => [k.field_id, k])).values()];
                return (
                    <fieldset key={role} className="imcrm-min-w-0 imcrm-space-y-1.5" data-testid={`imcrm-store-editable-${role}`}>
                        <legend className="imcrm-mb-1 imcrm-text-xs imcrm-font-medium">{__(ROLE_LABEL[role])}</legend>
                        {STORE_EDITABLE_CATALOG[role].map((c) => (
                            <Check
                                key={c.slug}
                                id={`${role}-${c.slug}`}
                                label={__(c.label)}
                                hint={c.hint ? __(c.hint) : undefined}
                                checked={chosen.has(c.slug)}
                                disabled={busy && local === null}
                                onChange={(on) => toggle(role, c.slug, on)}
                            />
                        ))}
                        {role === 'customers' && (
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {__('Sólo los clientes con cuenta en la tienda: quien compró como invitado no tiene una cuenta que editar.')}
                            </p>
                        )}
                        {uniqueMeta.length > 0 && (
                            <div className="imcrm-space-y-1.5 imcrm-pt-1">
                                <p className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">{__('Campos de otros plugins')}</p>
                                {uniqueMeta.map((k) => {
                                    const slug = `meta:${k.field_id}`;
                                    return (
                                        <Check
                                            key={slug}
                                            id={`${role}-${slug}`}
                                            label={fieldLabel?.(k.field_id) ?? k.key}
                                            hint={fieldLabel?.(k.field_id) ? k.key : undefined}
                                            checked={chosen.has(slug)}
                                            disabled={busy && local === null}
                                            onChange={(on) => toggle(role, slug, on)}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </fieldset>
                );
            })}
        </div>
    );
}

function Check({
    id,
    label,
    hint,
    checked,
    disabled,
    onChange,
}: {
    id: string;
    label: string;
    hint?: string;
    checked: boolean;
    disabled: boolean;
    onChange: (on: boolean) => void;
}): JSX.Element {
    return (
        <label htmlFor={`imcrm-editable-${id}`} className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-sm">
            <input
                id={`imcrm-editable-${id}`}
                type="checkbox"
                className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-accent-[hsl(var(--imcrm-primary))]"
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                data-testid={`imcrm-editable-${id}`}
            />
            <span className="imcrm-min-w-0">
                <span className="imcrm-block imcrm-leading-tight">{label}</span>
                {hint && <span className="imcrm-block imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{hint}</span>}
            </span>
        </label>
    );
}

/**
 * La misma elección, dentro de Ajustes → Campos de una lista de la tienda:
 * trae el estado de la sincronización y guarda sólo esa lista.
 */
export function StoreEditableColumnsCard({
    connectionId,
    role,
    fieldLabel,
}: {
    connectionId: number;
    role: StoreListRole;
    fieldLabel?: (fieldId: number) => string | undefined;
}): JSX.Element | null {
    const qc = useQueryClient();
    const key = ['store-sync', connectionId];
    const status = useQuery({ queryKey: key, queryFn: () => api.storeSyncStatus(connectionId), refetchOnMount: 'always' });
    const [error, setError] = useState<string | null>(null);
    const update = useMutation({
        mutationFn: (t: { role: StoreListRole; slug: string; on: boolean }) => api.storeSyncUpdate(connectionId, { editable_toggle: t }),
        onSuccess: (s) => {
            qc.setQueryData(key, s);
            // La marca de la lista cambia: candados de las celdas y del encabezado.
            void qc.invalidateQueries({ queryKey: listsKeys.all });
            setError(null);
        },
        onError: (err) => setError(err instanceof CloudApiError || err instanceof Error ? err.message : String(err)),
    });
    const s = status.data;
    if (!s || !s.configured) return null;
    return (
        <section
            className={cn('imcrm-space-y-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4')}
            data-testid="imcrm-store-editable-card"
        >
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-min-w-0">
                    <h3 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                        <Store className="imcrm-h-4 imcrm-w-4 imcrm-text-[#7F54B3]" aria-hidden />
                        {__('Columnas que se editan desde la app')}
                    </h3>
                    <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Lo que marques se puede cambiar desde esta lista y el cambio viaja a WooCommerce. Lo demás se sigue editando en la tienda.')}
                    </p>
                </div>
                <Link
                    to={`/settings/stores/${connectionId}`}
                    className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground hover:imcrm-underline"
                >
                    {__('Ajustes de la tienda')}
                </Link>
            </div>
            {!s.write_back && (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted/60 imcrm-px-3 imcrm-py-2 imcrm-text-xs" data-testid="imcrm-store-editable-off">
                    <ArrowLeftRight className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                    <span>
                        {__('«Editar desde la app» está apagado en esta tienda: hasta que lo actives, todas las columnas de la tienda son de sólo lectura.')}{' '}
                        <Link to={`/settings/stores/${connectionId}`} className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                            {__('Activarlo')}
                        </Link>
                    </span>
                </p>
            )}
            <StoreEditableColumns status={s} roles={[role]} busy={update.isPending} onToggle={(role, slug, on) => update.mutate({ role, slug, on })} fieldLabel={fieldLabel} />
            {error && <p className="imcrm-text-xs imcrm-text-destructive">{error}</p>}
        </section>
    );
}
