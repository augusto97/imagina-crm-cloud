import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    AUTOMATION_ACTIONS,
    AUTOMATION_TRIGGERS,
    type AutomationAction,
    type AutomationTrigger,
    type CreateAutomationInput,
    type Field,
    type List,
} from '@imagina-base/shared';
import { CloudApiError } from '@/lib/cloud/client';
import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'] as const;

/** Panel de automatizaciones de una lista: alta + listado con runs (F3). */
export function AutomationsPanel({
    listSlug,
    fields,
}: {
    listSlug: string;
    fields: Field[];
}): JSX.Element {
    const tenantId = useSession((s) => s.activeTenantId);
    const autos = useQuery({
        queryKey: ['automations', tenantId, listSlug],
        queryFn: () => api.listAutomations(listSlug),
    });
    const lists = useQuery({ queryKey: ['lists', tenantId], queryFn: () => api.listLists() });

    return (
        <div className="imcrm-grid imcrm-gap-6 lg:imcrm-grid-cols-2">
            <NewAutomationForm listSlug={listSlug} fields={fields} lists={lists.data ?? []} />
            <section className="imcrm-space-y-3">
                <h2 className="imcrm-text-sm imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                    Automatizaciones
                </h2>
                {autos.data?.length === 0 && (
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">Sin automatizaciones todavía.</p>
                )}
                {autos.data?.map((a) => (
                    <AutomationCard key={a.id} listSlug={listSlug} automation={a} fields={fields} />
                ))}
            </section>
        </div>
    );
}

function AutomationCard({
    listSlug,
    automation,
    fields,
}: {
    listSlug: string;
    automation: import('@imagina-base/shared').Automation;
    fields: Field[];
}): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const [showRuns, setShowRuns] = useState(false);
    const invalidate = () => qc.invalidateQueries({ queryKey: ['automations', tenantId, listSlug] });

    const toggle = useMutation({
        mutationFn: () => api.updateAutomation(listSlug, automation.id, { is_active: !automation.is_active }),
        onSuccess: invalidate,
    });
    const del = useMutation({
        mutationFn: () => api.deleteAutomation(listSlug, automation.id),
        onSuccess: invalidate,
    });
    const runs = useQuery({
        queryKey: ['automation-runs', tenantId, automation.id],
        queryFn: () => api.automationRuns(listSlug, automation.id),
        enabled: showRuns,
    });

    return (
        <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                <div>
                    <div className="imcrm-font-medium">{automation.name}</div>
                    <div className="imcrm-text-xs imcrm-text-muted-foreground">
                        {triggerLabel(automation.trigger, fields)} · {automation.actions.length} acción(es)
                    </div>
                </div>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <button
                        onClick={() => toggle.mutate()}
                        className={[
                            'imcrm-rounded imcrm-px-2 imcrm-py-0.5 imcrm-text-xs',
                            automation.is_active
                                ? 'imcrm-bg-emerald-100 imcrm-text-emerald-700'
                                : 'imcrm-bg-muted imcrm-text-muted-foreground',
                        ].join(' ')}
                    >
                        {automation.is_active ? 'Activa' : 'Pausada'}
                    </button>
                    <button
                        onClick={() => setShowRuns((v) => !v)}
                        className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground"
                    >
                        Runs
                    </button>
                    <button
                        onClick={() => del.mutate()}
                        aria-label="Eliminar"
                        className="imcrm-text-muted-foreground hover:imcrm-text-destructive"
                    >
                        ✕
                    </button>
                </div>
            </div>
            {showRuns && (
                <ul className="imcrm-mt-2 imcrm-space-y-1 imcrm-border-t imcrm-border-border imcrm-pt-2 imcrm-text-xs">
                    {runs.data?.length === 0 && <li className="imcrm-text-muted-foreground">Sin ejecuciones.</li>}
                    {runs.data?.map((r) => (
                        <li key={r.id} className="imcrm-flex imcrm-justify-between imcrm-gap-2">
                            <span className={runColor(r.status)}>{r.status}</span>
                            <span className="imcrm-flex-1 imcrm-truncate imcrm-text-muted-foreground">
                                {r.logs.join(' · ')}
                            </span>
                            <span className="imcrm-text-muted-foreground">{r.duration_ms}ms</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function NewAutomationForm({
    listSlug,
    fields,
    lists,
}: {
    listSlug: string;
    fields: Field[];
    lists: List[];
}): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const [name, setName] = useState('');
    const [triggerType, setTriggerType] = useState<AutomationTrigger['type']>('record_created');
    const [cron, setCron] = useState('0 9 * * *');
    const [dueFieldId, setDueFieldId] = useState<number | ''>('');
    const [condFieldId, setCondFieldId] = useState<number | ''>('');
    const [condOp, setCondOp] = useState<(typeof OPS)[number]>('eq');
    const [condValue, setCondValue] = useState('');
    const [actionType, setActionType] = useState<AutomationAction['type']>('update_field');
    const [actFieldId, setActFieldId] = useState<number | ''>('');
    const [actValue, setActValue] = useState('');
    const [actUrl, setActUrl] = useState('');
    const [actListId, setActListId] = useState<number | ''>('');
    const [error, setError] = useState<string | null>(null);

    const create = useMutation({
        mutationFn: () => api.createAutomation(listSlug, buildInput()),
        onSuccess: () => {
            setName('');
            setError(null);
            void qc.invalidateQueries({ queryKey: ['automations', tenantId, listSlug] });
        },
        onError: (e) => setError(e instanceof CloudApiError ? e.message : 'Error'),
    });

    function buildInput(): CreateAutomationInput {
        const trigger = buildTrigger();
        const action = buildAction();
        const condition =
            condFieldId !== ''
                ? ({
                      type: 'group' as const,
                      logic: 'and' as const,
                      children: [
                          {
                              type: 'condition' as const,
                              field_id: condFieldId,
                              op: condOp,
                              value: coerce(condValue),
                          },
                      ],
                  })
                : undefined;
        return { name: name.trim(), trigger, actions: [action], condition };
    }

    function buildTrigger(): AutomationTrigger {
        if (triggerType === 'scheduled') return { type: 'scheduled', cron };
        if (triggerType === 'due_date_reached')
            return { type: 'due_date_reached', field_id: Number(dueFieldId), offset_minutes: 0 };
        if (triggerType === 'field_changed') return { type: 'field_changed', field_id: Number(condFieldId || fields[0]?.id) };
        return { type: triggerType };
    }

    function buildAction(): AutomationAction {
        if (actionType === 'update_field') return { type: 'update_field', field_id: Number(actFieldId), value: coerce(actValue) };
        if (actionType === 'create_record') return { type: 'create_record', list_id: Number(actListId), data: {} };
        if (actionType === 'call_webhook') return { type: 'call_webhook', url: actUrl };
        return { type: 'send_email', to: actValue || 'demo@imagina.base', subject: name || 'Aviso', body: '' };
    }

    const dateFields = fields.filter((f) => f.type === 'date' || f.type === 'datetime');

    return (
        <form
            className="imcrm-space-y-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4"
            onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) create.mutate();
            }}
        >
            <h2 className="imcrm-text-sm imcrm-font-semibold">Nueva automatización</h2>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" aria-label="Nombre automatización" />

            <Row label="Cuando">
                <Select value={triggerType} onChange={(v) => setTriggerType(v as AutomationTrigger['type'])} options={AUTOMATION_TRIGGERS} />
            </Row>
            {triggerType === 'scheduled' && (
                <Row label="Cron">
                    <Input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 9 * * *" />
                </Row>
            )}
            {triggerType === 'due_date_reached' && (
                <Row label="Campo fecha">
                    <FieldSelect fields={dateFields} value={dueFieldId} onChange={setDueFieldId} />
                </Row>
            )}

            <Row label="Si (opcional)">
                <div className="imcrm-flex imcrm-flex-1 imcrm-gap-1">
                    <FieldSelect fields={fields} value={condFieldId} onChange={setCondFieldId} allowEmpty />
                    <Select value={condOp} onChange={(v) => setCondOp(v as (typeof OPS)[number])} options={OPS} />
                    <Input value={condValue} onChange={(e) => setCondValue(e.target.value)} placeholder="valor" className="imcrm-w-24" />
                </div>
            </Row>

            <Row label="Entonces">
                <Select value={actionType} onChange={(v) => setActionType(v as AutomationAction['type'])} options={AUTOMATION_ACTIONS} />
            </Row>
            {actionType === 'update_field' && (
                <Row label="Campo = valor">
                    <div className="imcrm-flex imcrm-flex-1 imcrm-gap-1">
                        <FieldSelect fields={fields} value={actFieldId} onChange={setActFieldId} />
                        <Input value={actValue} onChange={(e) => setActValue(e.target.value)} placeholder="valor" />
                    </div>
                </Row>
            )}
            {actionType === 'create_record' && (
                <Row label="En lista">
                    <select
                        aria-label="Lista destino"
                        value={actListId}
                        onChange={(e) => setActListId(e.target.value ? Number(e.target.value) : '')}
                        className="imcrm-h-9 imcrm-flex-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                    >
                        <option value="">—</option>
                        {lists.map((l) => (
                            <option key={l.id} value={l.id}>
                                {l.name}
                            </option>
                        ))}
                    </select>
                </Row>
            )}
            {actionType === 'call_webhook' && (
                <Row label="URL">
                    <Input value={actUrl} onChange={(e) => setActUrl(e.target.value)} placeholder="https://…" />
                </Row>
            )}
            {actionType === 'send_email' && (
                <Row label="Para">
                    <Input value={actValue} onChange={(e) => setActValue(e.target.value)} placeholder="email o {{slug}}" />
                </Row>
            )}

            {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
            <Button type="submit" size="sm" disabled={!name.trim() || create.isPending}>
                Crear automatización
            </Button>
        </form>
    );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
    return (
        <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
            <span className="imcrm-w-28 imcrm-shrink-0 imcrm-text-muted-foreground">{label}</span>
            {children}
        </label>
    );
}

function Select({
    value,
    onChange,
    options,
}: {
    value: string;
    onChange: (v: string) => void;
    options: readonly string[];
}): JSX.Element {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="imcrm-h-9 imcrm-flex-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2 imcrm-text-sm"
        >
            {options.map((o) => (
                <option key={o} value={o}>
                    {o}
                </option>
            ))}
        </select>
    );
}

function FieldSelect({
    fields,
    value,
    onChange,
    allowEmpty,
}: {
    fields: Field[];
    value: number | '';
    onChange: (v: number | '') => void;
    allowEmpty?: boolean;
}): JSX.Element {
    return (
        <select
            aria-label="Campo"
            value={value}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
            className="imcrm-h-9 imcrm-flex-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2 imcrm-text-sm"
        >
            {allowEmpty && <option value="">—</option>}
            {fields.map((f) => (
                <option key={f.id} value={f.id}>
                    {f.label}
                </option>
            ))}
        </select>
    );
}

function triggerLabel(trigger: AutomationTrigger, fields: Field[]): string {
    if (trigger.type === 'scheduled') return `cron ${trigger.cron}`;
    if (trigger.type === 'due_date_reached') {
        const f = fields.find((x) => x.id === trigger.field_id);
        return `vence ${f?.label ?? trigger.field_id}`;
    }
    return trigger.type;
}

function runColor(status: string): string {
    return status === 'success'
        ? 'imcrm-text-emerald-600'
        : status === 'failed'
          ? 'imcrm-text-destructive'
          : 'imcrm-text-muted-foreground';
}

/** Coerción liviana: número si parece número, si no string. */
function coerce(raw: string): unknown {
    if (raw === '') return '';
    const n = Number(raw);
    return Number.isFinite(n) && raw.trim() !== '' ? n : raw;
}
