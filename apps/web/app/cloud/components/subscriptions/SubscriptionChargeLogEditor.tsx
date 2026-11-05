import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, LayoutDashboard, ListPlus, Loader2, ReceiptText } from 'lucide-react';
import {
    SUBSCRIPTION_CHARGE_LOG_HINTS,
    SUBSCRIPTION_CHARGE_LOG_LABELS,
    SUBSCRIPTION_CHARGE_LOG_ROLES,
    SUBSCRIPTION_CHARGE_LOG_TYPES,
    readMirrorListMarker,
    suggestChargeLogFields,
    type SetSubscriptionChargeLogInput,
    type SubscriptionChargeLogRole,
    type SubscriptionChargeLogStatus,
} from '@imagina-base/shared';

import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { dashboardsKeys } from '@/hooks/useDashboards';
import { useFields } from '@/hooks/useFields';
import { listsKeys, useLists } from '@/hooks/useLists';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

type Choice = number | 'create' | null;
type Mode = 'create' | 'existing';

/**
 * v0.1.371 (ADR-S96) — El registro de cobros: cada cobro de una suscripción
 * (pagado, rechazado, reembolsado) queda como un registro en OTRA lista
 * vinculada, así se filtra, se suma y se grafica como cualquier dato. Se
 * crea la lista «Cobros de suscripciones» con su tablero o se usa una que ya
 * existe, eligiendo la columna de cada dato.
 */
export function SubscriptionChargeLogEditor({ listId }: { listId: number }): JSX.Element {
    const qc = useQueryClient();
    const toast = useToast();
    const confirm = useConfirm();
    const canEdit = useCan(CAP.MANAGE_FIELDS);
    const canCreateList = useCan(CAP.MANAGE_LISTS);
    const key = ['subscription-charge-log', String(listId)];
    const q = useQuery({ queryKey: key, queryFn: () => api.subscriptionChargeLog(listId), retry: false });
    const [editing, setEditing] = useState(false);

    const save = useMutation({
        mutationFn: (input: SetSubscriptionChargeLogInput) => api.setSubscriptionChargeLog(listId, input),
        onSuccess: (status, input) => {
            qc.setQueryData(key, status);
            void qc.invalidateQueries({ queryKey: listsKeys.all });
            void qc.invalidateQueries({ queryKey: dashboardsKeys.all });
            setEditing(false);
            if (input.mode === 'off') toast.success(__('Ya no se registran los cobros'), __('Los registros que ya estaban quedan en su lista.'));
            else toast.success(__('Registro de cobros listo'), status.config ? sprintf(__('Cada cobro queda en «%s», también los de antes.'), status.config.list_name) : undefined);
            for (const w of status.warnings ?? []) toast.info(__('Para revisar'), w);
        },
        onError: (err) => toast.error(__('No se pudo guardar'), err instanceof Error ? err.message : String(err)),
    });

    if (q.isError) return <p className="imcrm-text-xs imcrm-text-destructive">{__('No se pudo leer el registro de cobros de esta lista.')}</p>;
    if (q.isLoading || !q.data) return <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Cargando…')}</p>;
    const status: SubscriptionChargeLogStatus = q.data;
    const cfg = status.config;

    if (cfg && !editing) {
        const mapped = SUBSCRIPTION_CHARGE_LOG_ROLES.filter((r) => cfg.fields[r]);
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="imcrm-charge-log">
                <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-emerald-500/30 imcrm-bg-emerald-500/5 imcrm-p-3">
                    <ReceiptText className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-emerald-600 dark:imcrm-text-emerald-400" aria-hidden />
                    <div className="imcrm-min-w-0 imcrm-flex-1 imcrm-text-sm">
                        <p>
                            {__('Cada cobro queda en')}{' '}
                            <Link to={`/lists/${cfg.list_slug}/records`} className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline" data-testid="imcrm-charge-log-list">
                                «{cfg.list_name}»
                            </Link>
                            .
                        </p>
                        <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-charge-log-count">
                            {status.charges === 0
                                ? __('Todavía no hay cobros: el primero llega cuando un cliente pague.')
                                : sprintf(__('%1$s de %2$s cobros registrados.'), String(status.logged), String(status.charges))}
                        </p>
                        <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Guarda:')} {mapped.map((r) => __(SUBSCRIPTION_CHARGE_LOG_LABELS[r])).join(', ')}
                        </p>
                    </div>
                </div>
                {(status.warnings ?? []).map((w) => (
                    <p
                        key={w}
                        className="imcrm-rounded-md imcrm-bg-amber-50 imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-text-amber-900 dark:imcrm-bg-amber-950/40 dark:imcrm-text-amber-200"
                    >
                        {w}
                    </p>
                ))}
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    {cfg.dashboard_id && (
                        <Button asChild size="sm" variant="outline">
                            <Link to={`/dashboards/${cfg.dashboard_id}`} data-testid="imcrm-charge-log-dashboard">
                                <LayoutDashboard className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Ver el tablero')}
                            </Link>
                        </Button>
                    )}
                    {canEdit && (
                        <>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)} data-testid="imcrm-charge-log-change">
                                {__('Cambiar las columnas')}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="imcrm-text-destructive"
                                disabled={save.isPending}
                                onClick={async () => {
                                    const ok = await confirm({
                                        title: __('¿Dejar de registrar los cobros?'),
                                        description: sprintf(__('Los cobros nuevos ya no se agregan a «%s». Los que ya están quedan ahí.'), cfg.list_name),
                                        confirmLabel: __('Dejar de registrar'),
                                        destructive: true,
                                    });
                                    if (ok) save.mutate({ mode: 'off' });
                                }}
                                data-testid="imcrm-charge-log-off"
                            >
                                {__('Dejar de registrar')}
                            </Button>
                        </>
                    )}
                </div>
            </div>
        );
    }

    return (
        <ChargeLogSetup
            listId={listId}
            current={cfg}
            canEdit={canEdit}
            canCreateList={canCreateList}
            pending={save.isPending}
            onCancel={cfg ? () => setEditing(false) : undefined}
            onSave={(input) => save.mutate(input)}
        />
    );
}

function ChargeLogSetup({
    listId,
    current,
    canEdit,
    canCreateList,
    pending,
    onCancel,
    onSave,
}: {
    listId: number;
    current: SubscriptionChargeLogStatus['config'];
    canEdit: boolean;
    canCreateList: boolean;
    pending: boolean;
    onCancel?: () => void;
    onSave: (input: SetSubscriptionChargeLogInput) => void;
}): JSX.Element {
    const lists = useLists();
    const [mode, setMode] = useState<Mode>(current ? 'existing' : canCreateList ? 'create' : 'existing');
    const [dashboard, setDashboard] = useState(true);
    const [targetId, setTargetId] = useState<number | null>(current?.list_id ?? null);
    const targetFields = useFields(targetId ?? undefined);
    const [choices, setChoices] = useState<Record<SubscriptionChargeLogRole, Choice> | null>(null);

    const options = useMemo(
        () => (lists.data ?? []).filter((l) => l.id !== listId && !readMirrorListMarker(l.settings)).sort((a, b) => a.name.localeCompare(b.name)),
        [lists.data, listId],
    );

    // Al elegir la lista (o al abrir con una ya elegida): lo actual, o lo que ya sirve.
    useEffect(() => {
        if (!targetId || !targetFields.data) return;
        const fields = targetFields.data;
        if (current && current.list_id === targetId) {
            const out = {} as Record<SubscriptionChargeLogRole, Choice>;
            for (const r of SUBSCRIPTION_CHARGE_LOG_ROLES) out[r] = current.fields[r]?.id ?? null;
            setChoices(out);
            return;
        }
        const suggested = suggestChargeLogFields(fields, listId);
        const out = {} as Record<SubscriptionChargeLogRole, Choice>;
        for (const r of SUBSCRIPTION_CHARGE_LOG_ROLES) out[r] = suggested[r] ?? (r === 'reason' || r === 'payment_id' || r === 'method' ? null : 'create');
        setChoices(out);
    }, [targetId, targetFields.data, current, listId]);

    if (!canEdit) {
        return (
            <p className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-charge-log-readonly">
                {__('Esta lista todavía no registra los cobros en otra lista. Lo configura quien administra los campos.')}
            </p>
        );
    }

    const usedBy = (id: number, except: SubscriptionChargeLogRole): boolean => !!choices && SUBSCRIPTION_CHARGE_LOG_ROLES.some((r) => r !== except && choices[r] === id);
    const canSave = mode === 'create' ? canCreateList : !!targetId && !!choices && choices.record !== null;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-charge-log-setup">
            <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2">
                <ModeCard
                    active={mode === 'create'}
                    disabled={!canCreateList}
                    icon={<ListPlus className="imcrm-h-4 imcrm-w-4" />}
                    title={__('Crear la lista «Cobros de suscripciones»')}
                    text={canCreateList ? __('Con sus columnas listas, vinculada a esta lista.') : __('Crear listas lo hace quien administra las listas.')}
                    onClick={() => setMode('create')}
                    testId="imcrm-charge-log-mode-create"
                />
                <ModeCard
                    active={mode === 'existing'}
                    icon={<ReceiptText className="imcrm-h-4 imcrm-w-4" />}
                    title={__('Usar una lista que ya existe')}
                    text={__('Eliges qué columna guarda cada dato del cobro.')}
                    onClick={() => setMode('existing')}
                    testId="imcrm-charge-log-mode-existing"
                />
            </div>

            {mode === 'create' ? (
                <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                    <input
                        type="checkbox"
                        className="imcrm-mt-0.5"
                        checked={dashboard}
                        onChange={(e) => setDashboard(e.target.checked)}
                        data-testid="imcrm-charge-log-dashboard-check"
                    />
                    <span>
                        {__('Crear también su tablero')}
                        <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Cobrado este mes, pagados y rechazados, cobros por mes y por plan, y los últimos rechazos.')}
                        </span>
                    </span>
                </label>
            ) : (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <label className="imcrm-grid imcrm-gap-1">
                        <span className="imcrm-text-xs imcrm-font-medium">{__('Lista donde va cada cobro')}</span>
                        <select
                            className="imcrm-h-8 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                            value={targetId === null ? '' : String(targetId)}
                            onChange={(e) => {
                                setChoices(null);
                                setTargetId(e.target.value ? Number(e.target.value) : null);
                            }}
                            data-testid="imcrm-charge-log-target"
                        >
                            <option value="">{__('Elige una lista…')}</option>
                            {options.map((l) => (
                                <option key={l.id} value={String(l.id)}>
                                    {l.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    {targetId && !choices && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Cargando…')}</p>}
                    {targetId && choices && targetFields.data && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            {SUBSCRIPTION_CHARGE_LOG_ROLES.map((role) => {
                                const compatible = targetFields.data!.filter(
                                    (f) =>
                                        (SUBSCRIPTION_CHARGE_LOG_TYPES[role] as readonly string[]).includes(f.type) &&
                                        (role !== 'record' || Number((f.config as { target_list_id?: unknown }).target_list_id) === listId),
                                );
                                const value = choices[role];
                                return (
                                    <label key={role} className="imcrm-grid imcrm-gap-1 sm:imcrm-grid-cols-[11rem_1fr] sm:imcrm-items-center">
                                        <span className="imcrm-text-xs">
                                            <span className="imcrm-font-medium imcrm-text-foreground">{__(SUBSCRIPTION_CHARGE_LOG_LABELS[role])}</span>
                                            <span className="imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">{__(SUBSCRIPTION_CHARGE_LOG_HINTS[role])}</span>
                                        </span>
                                        <select
                                            className="imcrm-h-8 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                                            value={value === null ? '' : String(value)}
                                            onChange={(e) => {
                                                const raw = e.target.value;
                                                setChoices({ ...choices, [role]: raw === '' ? null : raw === 'create' ? 'create' : Number(raw) });
                                            }}
                                            data-testid={`imcrm-charge-log-field-${role}`}
                                        >
                                            {role !== 'record' && <option value="">{__('No guardar')}</option>}
                                            <option value="create">{sprintf(__('Crear columna «%s»'), __(SUBSCRIPTION_CHARGE_LOG_LABELS[role]))}</option>
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
                    )}
                </div>
            )}

            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Button
                    type="button"
                    size="sm"
                    disabled={!canSave || pending}
                    onClick={() => {
                        if (mode === 'create') onSave({ mode: 'create', dashboard });
                        else if (targetId && choices) onSave({ mode: 'existing', list_id: targetId, fields: choices });
                    }}
                    data-testid="imcrm-charge-log-save"
                >
                    {pending && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                    {mode === 'create' ? __('Crear y registrar los cobros') : __('Registrar los cobros ahí')}
                </Button>
                {onCancel && (
                    <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
                        {__('Cancelar')}
                    </Button>
                )}
                {mode === 'existing' && targetId && (
                    <a
                        href={`/lists/${options.find((l) => l.id === targetId)?.slug ?? ''}/records`}
                        target="_blank"
                        rel="noreferrer"
                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground"
                    >
                        <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                        {__('Ver la lista')}
                    </a>
                )}
            </div>
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Los cobros que ya existen se cargan sin disparar automatizaciones; los nuevos sí las disparan.')}</p>
        </div>
    );
}

function ModeCard({
    active,
    disabled,
    icon,
    title,
    text,
    onClick,
    testId,
}: {
    active: boolean;
    disabled?: boolean;
    icon: JSX.Element;
    title: string;
    text: string;
    onClick: () => void;
    testId: string;
}): JSX.Element {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                'imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-p-3 imcrm-text-left imcrm-transition-colors',
                active ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-ring-1 imcrm-ring-primary' : 'imcrm-border-border hover:imcrm-bg-accent',
                disabled && 'imcrm-cursor-not-allowed imcrm-opacity-60',
            )}
            data-testid={testId}
        >
            <span className={cn('imcrm-mt-0.5', active ? 'imcrm-text-primary' : 'imcrm-text-muted-foreground')}>{icon}</span>
            <span className="imcrm-min-w-0">
                <span className="imcrm-block imcrm-text-sm imcrm-font-medium">{title}</span>
                <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{text}</span>
            </span>
        </button>
    );
}
