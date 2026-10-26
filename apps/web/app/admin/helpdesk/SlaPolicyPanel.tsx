import { useEffect, useMemo, useState } from 'react';
import { Clock, Columns3, Loader2, Save, ShieldAlert, X } from 'lucide-react';
import { APPROVER_ROLE_LABELS, APPROVER_ROLES, type SlaPolicy, type SlaTarget } from '@imagina-base/shared';

import { extractFieldOptions } from '@/admin/records/fieldOptions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { UserPicker } from '@/components/ui/user-picker';
import { useFields } from '@/hooks/useFields';
import { useCreateSlaColumns, useHelpdeskSettings, useUpdateHelpdeskSettings } from '@/hooks/useHelpdesk';
import { useTeams } from '@/hooks/useTeams';
import { useMemberNames } from '@/hooks/useWpUsers';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { ChipGroup } from './HelpdeskSettingsPanel';
import { hoursLabel, parseHours, WEEKDAYS } from './helpdeskUi';

/**
 * E5 — Ajustes de la lista → «SLA»: cuánto tiempo hay para la PRIMERA
 * RESPUESTA y para RESOLVER cada ticket (por prioridad, o uno para todos),
 * contado en HORAS HÁBILES de la empresa (días, horario y festivos de
 * Colombia, en su zona horaria). A quién se avisa cuando un ticket entra en
 * riesgo, a quién se escala al vencer y las columnas que el SLA mantiene al
 * día (vencimientos y estado), que se filtran, ordenan y agrupan como
 * cualquier otra.
 */
export function SlaPolicyPanel({ listId, onGoToMail }: { listId: number; onGoToMail?: () => void }): JSX.Element {
    const settingsQ = useHelpdeskSettings(listId);
    const fieldsQ = useFields(listId);
    const update = useUpdateHelpdeskSettings(listId);
    const columns = useCreateSlaColumns(listId);
    const teamsQ = useTeams();
    const toast = useToast();
    const [draft, setDraft] = useState<SlaPolicy | null>(null);
    const [hoursText, setHoursText] = useState<Record<string, string>>({});

    const loaded = settingsQ.data?.settings;
    useEffect(() => {
        if (loaded && draft === null) setDraft(loaded.sla);
    }, [loaded, draft]);

    const fields = useMemo(() => fieldsQ.data ?? [], [fieldsQ.data]);
    const priorityField = useMemo(() => fields.find((f) => f.id === draft?.priority_field_id) ?? null, [fields, draft?.priority_field_id]);
    const priorityOptions = priorityField ? extractFieldOptions(priorityField) : [];
    const people = useMemberNames([...(draft?.notify_user_ids ?? []), ...(draft?.escalate_user_ids ?? []), ...(draft?.escalate_set_user_id ? [draft.escalate_set_user_id] : [])]);

    if (!draft || !loaded) return <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />;

    const set = <K extends keyof SlaPolicy>(key: K, value: SlaPolicy[K]): void => setDraft((d) => (d ? { ...d, [key]: value } : d));
    const statusReady = loaded.status_field_id !== null && loaded.closed_statuses.length > 0;

    // Filas de objetivos: una por opción de prioridad + «las demás», o una sola.
    const rows: Array<{ priority: string | null; label: string }> = priorityField
        ? [...priorityOptions.map((o) => ({ priority: o.value, label: o.label })), { priority: null, label: __('Las demás (sin prioridad)') }]
        : [{ priority: null, label: __('Todos los tickets') }];
    const targetOf = (priority: string | null): SlaTarget =>
        draft.targets.find((t) => t.priority === priority) ?? { priority, first_response_hours: null, resolution_hours: null };
    const setTarget = (priority: string | null, key: 'first_response_hours' | 'resolution_hours', raw: string): void => {
        setHoursText((h) => ({ ...h, [`${priority ?? '*'}:${key}`]: raw }));
        const next = { ...targetOf(priority), [key]: parseHours(raw) };
        const others = draft.targets.filter((t) => t.priority !== priority);
        set('targets', next.first_response_hours === null && next.resolution_hours === null ? others : [...others, next]);
    };
    const hoursValue = (priority: string | null, key: 'first_response_hours' | 'resolution_hours'): string => {
        const typed = hoursText[`${priority ?? '*'}:${key}`];
        if (typed !== undefined) return typed;
        const v = targetOf(priority)[key];
        return v === null ? '' : String(v).replace('.', ',');
    };

    const toggleDay = (d: number): void => {
        const days = draft.calendar.days.includes(d) ? draft.calendar.days.filter((x) => x !== d) : [...draft.calendar.days, d];
        set('calendar', { ...draft.calendar, days: days.sort((a, b) => a - b) });
    };
    const toggle = (key: 'notify_roles' | 'escalate_roles', role: string): void => {
        const cur = draft[key] as string[];
        set(key, (cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role]) as never);
    };
    const toggleTeam = (key: 'notify_team_ids' | 'escalate_team_ids', id: number): void => {
        const cur = draft[key];
        set(key, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
    };

    const escalateField = fields.find((f) => f.id === draft.escalate_set_field_id) ?? null;
    const hasColumns = draft.first_due_field_id !== null || draft.resolution_due_field_id !== null || draft.sla_status_field_id !== null;
    const columnName = (id: number | null): string | null => (id ? (fields.find((f) => f.id === id)?.label ?? null) : null);

    const save = (): void => {
        update.mutate(
            { sla: draft },
            {
                onSuccess: (s) => {
                    setDraft(s.sla);
                    setHoursText({});
                    toast.success(__('SLA guardado'), __('Los tickets abiertos se recalculan en unos segundos.'));
                },
                onError: (err) => toast.error(__('No se pudo guardar'), err instanceof ApiError ? (Object.values(err.errors)[0] ?? err.message) : err instanceof Error ? err.message : ''),
            },
        );
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="imcrm-sla-panel">
            <Card>
                <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-pt-5">
                    <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2">
                        <input type="checkbox" className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} data-testid="imcrm-sla-enabled" />
                        <span>
                            <span className="imcrm-text-sm imcrm-font-medium">{__('Medir el SLA de los tickets de esta lista')}</span>
                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                {__('El reloj corre sólo en horario hábil, se detiene mientras el ticket espera al cliente y se cierra cuando pasa a un estado cerrado.')}
                            </span>
                        </span>
                    </label>
                    {!statusReady && (
                        <p className="imcrm-flex imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-warning/10 imcrm-p-2 imcrm-text-sm imcrm-text-[hsl(var(--imcrm-warning-ink))]">
                            <ShieldAlert className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                            <span>
                                {__('Elige primero el campo de estado y cuáles estados cierran el ticket (y cuáles lo dejan esperando al cliente).')}{' '}
                                {onGoToMail && (
                                    <button type="button" className="imcrm-font-medium imcrm-underline" onClick={onGoToMail}>
                                        {__('Ir a «Correo entrante»')}
                                    </button>
                                )}
                            </span>
                        </p>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base">
                        <Clock className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        {__('Objetivos')}
                    </CardTitle>
                    <CardDescription>{__('En horas hábiles («1,5» es una hora y media). Vacío: sin objetivo.')}</CardDescription>
                </CardHeader>
                <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    <div className="imcrm-flex imcrm-max-w-sm imcrm-flex-col imcrm-gap-1">
                        <Label htmlFor="sla-priority">{__('Según la prioridad')}</Label>
                        <Select id="sla-priority" value={draft.priority_field_id === null ? '' : String(draft.priority_field_id)} onChange={(e) => set('priority_field_id', e.target.value === '' ? null : Number(e.target.value))}>
                            <option value="">{__('Un solo objetivo para todos')}</option>
                            {fields
                                .filter((f) => f.type === 'select')
                                .map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {f.label}
                                    </option>
                                ))}
                        </Select>
                    </div>
                    <div className="imcrm-overflow-x-auto imcrm-overflow-y-hidden">
                        <table className="imcrm-w-full imcrm-table-fixed imcrm-text-sm" data-testid="imcrm-sla-targets">
                            <thead>
                                <tr className="imcrm-text-left imcrm-text-xs imcrm-text-muted-foreground">
                                    <th className="imcrm-w-[34%] imcrm-py-1 imcrm-pr-2 imcrm-font-medium">{priorityField ? priorityField.label : ''}</th>
                                    <th className="imcrm-py-1 imcrm-pr-2 imcrm-font-medium">{__('Primera respuesta (horas)')}</th>
                                    <th className="imcrm-py-1 imcrm-font-medium">{__('Resolución (horas)')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.priority ?? '*'} className="imcrm-border-t imcrm-border-border">
                                        <td className="imcrm-break-words imcrm-py-1.5 imcrm-pr-2 imcrm-font-medium">{r.label}</td>
                                        {(['first_response_hours', 'resolution_hours'] as const).map((k) => (
                                            <td key={k} className="imcrm-py-1.5 imcrm-pr-2">
                                                <Input
                                                    inputMode="decimal"
                                                    aria-label={`${r.label} · ${k === 'first_response_hours' ? __('Primera respuesta') : __('Resolución')}`}
                                                    value={hoursValue(r.priority, k)}
                                                    onChange={(e) => setTarget(r.priority, k, e.target.value)}
                                                    placeholder="—"
                                                    className="imcrm-h-8 imcrm-w-full imcrm-max-w-[120px]"
                                                />
                                                <span className="imcrm-mt-0.5 imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">{targetOf(r.priority)[k] !== null ? hoursLabel(targetOf(r.priority)[k]) : ''}</span>
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="imcrm-text-base">{__('Horario hábil')}</CardTitle>
                    <CardDescription>{__('En la zona horaria de la empresa (Ajustes → Formato regional). Fuera de este horario el reloj no corre.')}</CardDescription>
                </CardHeader>
                <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5" role="group" aria-label={__('Días hábiles')}>
                        {WEEKDAYS.map((d) => {
                            const on = draft.calendar.days.includes(d.value);
                            return (
                                <button
                                    key={d.value}
                                    type="button"
                                    title={d.long}
                                    aria-pressed={on}
                                    onClick={() => toggleDay(d.value)}
                                    className={cn(
                                        'imcrm-h-8 imcrm-w-10 imcrm-rounded-md imcrm-border imcrm-text-xs imcrm-font-medium',
                                        on ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-foreground' : 'imcrm-border-border imcrm-text-muted-foreground',
                                    )}
                                >
                                    {d.short}
                                </button>
                            );
                        })}
                    </div>
                    <div className="imcrm-grid imcrm-max-w-md imcrm-grid-cols-2 imcrm-gap-3 sm:imcrm-grid-cols-3">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="sla-start">{__('Desde')}</Label>
                            <Input id="sla-start" type="time" value={draft.calendar.start} onChange={(e) => set('calendar', { ...draft.calendar, start: e.target.value || '08:00' })} />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="sla-end">{__('Hasta')}</Label>
                            <Input id="sla-end" type="time" value={draft.calendar.end === '24:00' ? '23:59' : draft.calendar.end} onChange={(e) => set('calendar', { ...draft.calendar, end: e.target.value || '18:00' })} />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="sla-holidays">{__('Festivos')}</Label>
                            <Select id="sla-holidays" value={draft.calendar.holidays} onChange={(e) => set('calendar', { ...draft.calendar, holidays: e.target.value as 'co' | 'none' })}>
                                <option value="co">{__('De Colombia (no cuentan)')}</option>
                                <option value="none">{__('Ninguno')}</option>
                            </Select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="imcrm-text-base">{__('Avisos y escalamiento')}</CardTitle>
                    <CardDescription>{__('Un aviso por ticket y por umbral, en la campana y por correo. Los clientes del portal y los invitados nunca los reciben.')}</CardDescription>
                </CardHeader>
                <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                        <span>{__('Avisar «en riesgo» al')}</span>
                        <Input
                            inputMode="numeric"
                            aria-label={__('Porcentaje del tiempo para avisar en riesgo')}
                            className="imcrm-h-8 imcrm-w-16"
                            value={String(draft.at_risk_percent)}
                            onChange={(e) => set('at_risk_percent', Math.min(99, Math.max(10, Number(e.target.value.replace(/\D/g, '')) || 75)))}
                        />
                        <span>{__('% del tiempo')}</span>
                    </div>

                    <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                        <h4 className="imcrm-text-sm imcrm-font-semibold">{__('A quién avisar (en riesgo y vencido)')}</h4>
                        <PeopleField ids={draft.notify_user_ids} names={people.data} onChange={(ids) => set('notify_user_ids', ids)} testId="imcrm-sla-notify-people" />
                        <ChipGroup
                            label={__('Roles')}
                            options={APPROVER_ROLES.map((r) => ({ value: r, label: __(APPROVER_ROLE_LABELS[r]) }))}
                            selected={draft.notify_roles}
                            onToggle={(r) => toggle('notify_roles', r)}
                        />
                        {(teamsQ.data ?? []).length > 0 && (
                            <ChipGroup
                                label={__('Equipos')}
                                options={(teamsQ.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))}
                                selected={draft.notify_team_ids.map(String)}
                                onToggle={(id) => toggleTeam('notify_team_ids', Number(id))}
                            />
                        )}
                        <div className="imcrm-flex imcrm-max-w-sm imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="sla-assignee">{__('Y al responsable del ticket')}</Label>
                            <Select id="sla-assignee" value={draft.notify_assignee_field_id === null ? '' : String(draft.notify_assignee_field_id)} onChange={(e) => set('notify_assignee_field_id', e.target.value === '' ? null : Number(e.target.value))}>
                                <option value="">{__('No')}</option>
                                {fields
                                    .filter((f) => f.type === 'user')
                                    .map((f) => (
                                        <option key={f.id} value={f.id}>
                                            {f.label}
                                        </option>
                                    ))}
                            </Select>
                        </div>
                    </section>

                    <section className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
                        <h4 className="imcrm-text-sm imcrm-font-semibold">{__('Al vencer, escalar a')}</h4>
                        <PeopleField ids={draft.escalate_user_ids} names={people.data} onChange={(ids) => set('escalate_user_ids', ids)} testId="imcrm-sla-escalate-people" />
                        <ChipGroup
                            label={__('Roles')}
                            options={APPROVER_ROLES.map((r) => ({ value: r, label: __(APPROVER_ROLE_LABELS[r]) }))}
                            selected={draft.escalate_roles}
                            onToggle={(r) => toggle('escalate_roles', r)}
                        />
                        {(teamsQ.data ?? []).length > 0 && (
                            <ChipGroup
                                label={__('Equipos')}
                                options={(teamsQ.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))}
                                selected={draft.escalate_team_ids.map(String)}
                                onToggle={(id) => toggleTeam('escalate_team_ids', Number(id))}
                            />
                        )}
                        <div className="imcrm-grid imcrm-max-w-xl imcrm-gap-3 sm:imcrm-grid-cols-2">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="sla-esc-field">{__('Y además, cambiar el campo')}</Label>
                                <Select
                                    id="sla-esc-field"
                                    value={draft.escalate_set_field_id === null ? '' : String(draft.escalate_set_field_id)}
                                    onChange={(e) => setDraft((d) => (d ? { ...d, escalate_set_field_id: e.target.value === '' ? null : Number(e.target.value), escalate_set_value: null, escalate_set_user_id: null } : d))}
                                >
                                    <option value="">{__('No cambiar nada')}</option>
                                    {fields
                                        .filter((f) => ['select', 'user', 'checkbox'].includes(f.type))
                                        .map((f) => (
                                            <option key={f.id} value={f.id}>
                                                {f.label}
                                            </option>
                                        ))}
                                </Select>
                            </div>
                            {escalateField?.type === 'select' && (
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                    <Label htmlFor="sla-esc-value">{__('a')}</Label>
                                    <Select id="sla-esc-value" value={draft.escalate_set_value ?? ''} onChange={(e) => set('escalate_set_value', e.target.value || null)}>
                                        <option value="">{__('Elige un valor')}</option>
                                        {extractFieldOptions(escalateField).map((o) => (
                                            <option key={o.value} value={o.value}>
                                                {o.label}
                                            </option>
                                        ))}
                                    </Select>
                                </div>
                            )}
                            {escalateField?.type === 'user' && (
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                    <Label>{__('a')}</Label>
                                    <UserPicker value={draft.escalate_set_user_id} onChange={(id) => set('escalate_set_user_id', id)} excludeGuests placeholder={__('Elige a quién')} />
                                </div>
                            )}
                            {escalateField?.type === 'checkbox' && <p className="imcrm-self-end imcrm-pb-2 imcrm-text-sm imcrm-text-muted-foreground">{__('(se marca)')}</p>}
                        </div>
                    </section>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base">
                        <Columns3 className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        {__('Columnas del SLA')}
                    </CardTitle>
                    <CardDescription>
                        {__('«Vence primera respuesta», «Vence resolución» y «Estado del SLA» (a tiempo, en riesgo, vencido, cumplido, pausado). Las mantiene el SLA: se filtran, ordenan, agrupan y aparecen en el calendario y en «Mi trabajo», pero no se editan a mano.')}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {hasColumns ? (
                        <ul className="imcrm-flex imcrm-flex-wrap imcrm-gap-2 imcrm-text-sm" data-testid="imcrm-sla-columns">
                            {[draft.first_due_field_id, draft.resolution_due_field_id, draft.sla_status_field_id].map((id) =>
                                columnName(id) ? (
                                    <li key={id} className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-2 imcrm-py-0.5">
                                        {columnName(id)}
                                    </li>
                                ) : null,
                            )}
                        </ul>
                    ) : (
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={columns.isPending}
                            onClick={() =>
                                columns.mutate(undefined, {
                                    onSuccess: (s) => {
                                        setDraft((d) => (d ? { ...d, first_due_field_id: s.sla.first_due_field_id, resolution_due_field_id: s.sla.resolution_due_field_id, sla_status_field_id: s.sla.sla_status_field_id } : d));
                                        toast.success(__('Columnas creadas'));
                                    },
                                    onError: (err) => toast.error(__('No se pudieron crear'), err instanceof Error ? err.message : ''),
                                })
                            }
                            data-testid="imcrm-sla-create-columns"
                        >
                            {columns.isPending ? __('Creando…') : __('Crear las columnas del SLA')}
                        </Button>
                    )}
                </CardContent>
            </Card>

            <div className="imcrm-sticky imcrm-bottom-2 imcrm-z-10 imcrm-flex imcrm-justify-end">
                <Button onClick={save} disabled={update.isPending} className="imcrm-shadow-lg" data-testid="imcrm-sla-save">
                    <Save className="imcrm-mr-1.5 imcrm-h-4 imcrm-w-4" />
                    {update.isPending ? __('Guardando…') : __('Guardar el SLA')}
                </Button>
            </div>
        </div>
    );
}

/** Varias personas del equipo: chips con su nombre + un selector para sumar otra. */
function PeopleField({
    ids,
    names,
    onChange,
    testId,
}: {
    ids: number[];
    names: Map<number, string> | undefined;
    onChange: (ids: number[]) => void;
    testId?: string;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid={testId}>
            <span className="imcrm-text-sm imcrm-font-medium">{__('Personas')}</span>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                {ids.map((id) => (
                    <span key={id} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-py-0.5 imcrm-pl-2.5 imcrm-pr-1 imcrm-text-xs">
                        {names?.get(id) ?? sprintf(__('Persona %d'), id)}
                        <button type="button" aria-label={__('Quitar')} className="imcrm-rounded-full imcrm-p-0.5 hover:imcrm-bg-muted" onClick={() => onChange(ids.filter((x) => x !== id))}>
                            <X className="imcrm-h-3 imcrm-w-3" />
                        </button>
                    </span>
                ))}
                <div className="imcrm-w-56">
                    <UserPicker value={null} onChange={(id) => id !== null && !ids.includes(id) && onChange([...ids, id])} excludeGuests compact placeholder={__('Agregar persona…')} />
                </div>
            </div>
        </div>
    );
}
