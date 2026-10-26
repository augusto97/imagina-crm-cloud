import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
    WORKLOAD_DATE_TYPES,
    WORKLOAD_ESTIMATE_TYPES,
    WORKLOAD_PERSON_TYPES,
    defaultHideDone,
    type WorkloadMetric,
    type WorkloadSettings,
    type WorkloadZoom,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useFields } from '@/hooks/useFields';
import { useUpdateSavedView } from '@/hooks/useSavedViews';
import { useWorkloadPeople } from '@/hooks/useWorkload';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { SavedViewEntity } from '@/types/view';

import { viewConfigToWorkload, workloadToViewConfig } from '../savedViewMapping';

interface WorkloadSettingsDialogProps {
    listId: number;
    view: SavedViewEntity;
    fields?: FieldEntity[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export const WORKLOAD_ZOOM_LABEL: Record<WorkloadZoom, string> = {
    day: __('Día'),
    week: __('Semana'),
    month: __('Mes'),
};

export const WORKLOAD_METRIC_LABEL: Record<WorkloadMetric, string> = {
    count: __('Registros'),
    estimate: __('Esfuerzo estimado'),
    time: __('Tiempo registrado'),
};

/**
 * «Configurar carga» (B2): de quién es cada registro (el campo Persona), en qué
 * fechas cae, qué se mide (cantidad, esfuerzo estimado o tiempo registrado),
 * con qué zoom abre, qué personas se ven y si se ocultan los terminados.
 *
 * El `useEffect` de re-init depende sólo de `[open, view.id]`: si dependiera de
 * `view` reiniciaría lo que la persona está editando en cada refetch.
 */
export function WorkloadSettingsDialog({ listId, view, fields: fieldsProp, open, onOpenChange }: WorkloadSettingsDialogProps): JSX.Element {
    const fieldsQuery = useFields(fieldsProp ? undefined : listId);
    const fields = useMemo(() => fieldsProp ?? fieldsQuery.data ?? [], [fieldsProp, fieldsQuery.data]);
    const people = useWorkloadPeople(listId, open);
    const update = useUpdateSavedView(listId);

    const [name, setName] = useState(view.name);
    const [settings, setSettings] = useState<WorkloadSettings>(() => viewConfigToWorkload(view.config));
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setName(view.name);
        setSettings(viewConfigToWorkload(view.config));
        setError(null);
        update.reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, view.id]);

    const patch = (p: Partial<WorkloadSettings>): void => setSettings((prev) => ({ ...prev, ...p }));

    const personFields = fields.filter((f) => (WORKLOAD_PERSON_TYPES as readonly string[]).includes(f.type));
    const dateFields = fields.filter((f) => (WORKLOAD_DATE_TYPES as readonly string[]).includes(f.type));
    const estimateFields = fields.filter((f) => (WORKLOAD_ESTIMATE_TYPES as readonly string[]).includes(f.type));
    const estimateField = fields.find((f) => f.id === settings.estimateFieldId);
    const needsDates = settings.metric !== 'time';

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);
        if (settings.personFieldId === null) {
            setError(__('Elige el campo Persona: cada persona es una fila.'));
            return;
        }
        if (needsDates && settings.startFieldId === null && settings.endFieldId === null) {
            setError(__('Elige al menos una fecha: es la que ubica cada registro en el tiempo.'));
            return;
        }
        if (settings.metric === 'estimate' && settings.estimateFieldId === null) {
            setError(__('Elige el campo con el esfuerzo estimado (horas o una duración).'));
            return;
        }
        try {
            const final: WorkloadSettings = {
                ...settings,
                estimateFieldId: settings.metric === 'estimate' ? settings.estimateFieldId : null,
            };
            await update.mutateAsync({ id: view.id, name: name.trim() || view.name, config: workloadToViewConfig(view.config, final) });
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    const members = people.data ?? [];
    const allPeople = settings.userIds === null;
    const togglePerson = (id: number): void => {
        const current = settings.userIds ?? members.map((m) => m.user_id);
        const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
        patch({ userIds: next });
    };

    const metricChoice = (value: WorkloadMetric, hint: string): JSX.Element => (
        <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-sm">
            <input
                type="radio"
                name="workload-metric"
                checked={settings.metric === value}
                onChange={() => patch({ metric: value, hideDone: defaultHideDone(value) })}
                className="imcrm-mt-0.5 imcrm-accent-[hsl(var(--imcrm-primary))]"
                data-testid={`workload-setting-metric-${value}`}
            />
            <span className="imcrm-flex imcrm-flex-col">
                <span className="imcrm-font-medium">{WORKLOAD_METRIC_LABEL[value]}</span>
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{hint}</span>
            </span>
        </label>
    );

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-2xl',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg sm:imcrm-p-6',
                        'imcrm-max-h-[88vh] imcrm-overflow-y-auto',
                    )}
                    data-testid="workload-settings-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Configurar carga')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('De quién es cada registro, en qué fechas cae, qué se mide y a quién se ve.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <form onSubmit={handleSubmit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-6">
                        <Section title={__('Personas y fechas')}>
                            <Row label={__('Nombre')} htmlFor="workload-name">
                                <Input id="workload-name" value={name} onChange={(e) => setName(e.target.value)} />
                            </Row>
                            <Row label={__('Persona asignada')} htmlFor="workload-person" hint={__('Cada persona es una fila; los registros sin persona van a «Sin asignar».')}>
                                <Select
                                    id="workload-person"
                                    value={settings.personFieldId ?? 0}
                                    onChange={(e) => patch({ personFieldId: Number(e.target.value) || null })}
                                    data-testid="workload-person-field"
                                >
                                    <option value={0} disabled>
                                        {personFields.length === 0 ? __('La lista no tiene campos Persona') : __('Elige un campo Persona')}
                                    </option>
                                    {personFields.map((f) => (
                                        <option key={f.id} value={f.id}>
                                            {f.label}
                                        </option>
                                    ))}
                                </Select>
                            </Row>
                            <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                                <Row label={__('Fecha de inicio')} htmlFor="workload-start" hint={__('O la única fecha (por ejemplo, el vencimiento).')}>
                                    <Select
                                        id="workload-start"
                                        value={settings.startFieldId ?? 0}
                                        onChange={(e) => {
                                            const id = Number(e.target.value) || null;
                                            patch({ startFieldId: id, endFieldId: settings.endFieldId === id ? null : settings.endFieldId });
                                        }}
                                        data-testid="workload-start-field"
                                    >
                                        <option value={0}>{__('Sin fecha de inicio')}</option>
                                        {dateFields.map((f) => (
                                            <option key={f.id} value={f.id}>
                                                {f.label}
                                            </option>
                                        ))}
                                    </Select>
                                </Row>
                                <Row label={__('Fecha de fin')} htmlFor="workload-end" hint={__('El esfuerzo se reparte entre los días hábiles del tramo.')}>
                                    <Select
                                        id="workload-end"
                                        value={settings.endFieldId ?? 0}
                                        onChange={(e) => patch({ endFieldId: Number(e.target.value) || null })}
                                        data-testid="workload-end-field"
                                    >
                                        <option value={0}>{__('Sin fecha de fin')}</option>
                                        {dateFields
                                            .filter((f) => f.id !== settings.startFieldId)
                                            .map((f) => (
                                                <option key={f.id} value={f.id}>
                                                    {f.label}
                                                </option>
                                            ))}
                                    </Select>
                                </Row>
                            </div>
                        </Section>

                        <Section title={__('Qué se mide')}>
                            {metricChoice('count', __('Cuántos registros tiene cada persona en cada período, frente a sus registros por semana.'))}
                            {metricChoice('estimate', __('La suma de un campo de horas o de duración, repartida en los días hábiles de cada registro.'))}
                            {settings.metric === 'estimate' && (
                                <div className="imcrm-grid imcrm-gap-3 imcrm-pl-6 sm:imcrm-grid-cols-2">
                                    <Row label={__('Campo de estimación')} htmlFor="workload-estimate">
                                        <Select
                                            id="workload-estimate"
                                            value={settings.estimateFieldId ?? 0}
                                            onChange={(e) => patch({ estimateFieldId: Number(e.target.value) || null })}
                                            data-testid="workload-estimate-field"
                                        >
                                            <option value={0} disabled>
                                                {estimateFields.length === 0 ? __('La lista no tiene campos numéricos ni de duración') : __('Elige un campo')}
                                            </option>
                                            {estimateFields.map((f) => (
                                                <option key={f.id} value={f.id}>
                                                    {f.label}
                                                </option>
                                            ))}
                                        </Select>
                                    </Row>
                                    {estimateField && estimateField.type !== 'duration' && (
                                        <Row label={__('Unidad')} htmlFor="workload-unit">
                                            <Select
                                                id="workload-unit"
                                                value={settings.estimateUnit}
                                                onChange={(e) => patch({ estimateUnit: e.target.value === 'minutes' ? 'minutes' : 'hours' })}
                                                data-testid="workload-estimate-unit"
                                            >
                                                <option value="hours">{__('Horas')}</option>
                                                <option value="minutes">{__('Minutos')}</option>
                                            </Select>
                                        </Row>
                                    )}
                                </div>
                            )}
                            {metricChoice('time', __('Las horas que cada persona registró de verdad (registro de tiempo) en cada período.'))}
                        </Section>

                        <Section title={__('Qué se ve')}>
                            <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                                <Row label={__('Zoom al abrir')} htmlFor="workload-zoom">
                                    <Select id="workload-zoom" value={settings.zoom} onChange={(e) => patch({ zoom: e.target.value as WorkloadZoom })}>
                                        {(Object.keys(WORKLOAD_ZOOM_LABEL) as WorkloadZoom[]).map((z) => (
                                            <option key={z} value={z}>
                                                {WORKLOAD_ZOOM_LABEL[z]}
                                            </option>
                                        ))}
                                    </Select>
                                </Row>
                            </div>
                            <Check
                                checked={settings.hideDone}
                                onChange={(v) => patch({ hideDone: v })}
                                label={__('Ocultar terminados')}
                                hint={__('Los registros cuyo estado dice terminado, completado o cerrado no cuentan.')}
                                testId="workload-hide-done"
                            />
                            <Check
                                checked={settings.showUnassigned}
                                onChange={(v) => patch({ showUnassigned: v })}
                                label={__('Mostrar la fila «Sin asignar»')}
                                testId="workload-show-unassigned"
                            />
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                                <span className="imcrm-text-sm imcrm-font-medium">{__('Personas visibles')}</span>
                                <Check
                                    checked={allPeople}
                                    onChange={(v) => patch({ userIds: v ? null : members.map((m) => m.user_id) })}
                                    label={__('Todas las que pueden ver la lista')}
                                    testId="workload-people-all"
                                />
                                <div
                                    className={cn(
                                        'imcrm-grid imcrm-max-h-48 imcrm-grid-cols-1 imcrm-gap-1 imcrm-overflow-y-auto imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2 sm:imcrm-grid-cols-2',
                                        allPeople && 'imcrm-opacity-60',
                                    )}
                                >
                                    {people.isLoading && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Cargando…')}</p>}
                                    {members.map((m) => {
                                        const checked = allPeople || (settings.userIds ?? []).includes(m.user_id);
                                        return (
                                            <label key={m.user_id} className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-1.5 imcrm-py-1 imcrm-text-sm hover:imcrm-bg-accent/50">
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    disabled={allPeople}
                                                    onChange={() => togglePerson(m.user_id)}
                                                    className="imcrm-h-3.5 imcrm-w-3.5 imcrm-accent-[hsl(var(--imcrm-primary))]"
                                                    data-testid={`workload-person-${m.user_id}`}
                                                />
                                                <span className="imcrm-truncate">{m.name}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        </Section>

                        {error !== null && (
                            <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">{error}</div>
                        )}

                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Dialog.Close asChild>
                                <Button type="button" variant="outline">
                                    {__('Cancelar')}
                                </Button>
                            </Dialog.Close>
                            <Button type="submit" disabled={update.isPending} data-testid="workload-settings-save">
                                {update.isPending ? __('Guardando…') : __('Guardar')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
    return (
        <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <legend className="imcrm-mb-1 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">{title}</legend>
            {children}
        </fieldset>
    );
}

function Row({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label htmlFor={htmlFor}>{label}</Label>
            {children}
            {hint && <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{hint}</p>}
        </div>
    );
}

function Check({ checked, onChange, label, hint, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; testId?: string }): JSX.Element {
    return (
        <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-sm">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-accent-[hsl(var(--imcrm-primary))]"
                data-testid={testId}
            />
            <span className="imcrm-flex imcrm-flex-col">
                <span>{label}</span>
                {hint && <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{hint}</span>}
            </span>
        </label>
    );
}
