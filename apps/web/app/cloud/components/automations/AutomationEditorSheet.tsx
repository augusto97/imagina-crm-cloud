import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import {
    AUTOMATION_ACTIONS,
    AUTOMATION_TRIGGERS,
    type Automation,
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
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from '@/components/ui/sheet';
import {
    ACTION_LABELS,
    CONDITION_OPS,
    TRIGGER_LABELS,
    coerceValue,
    conditionToRows,
} from './automationMeta';

type CondRow = { field_id: number | ''; op: string; value: string };
type LocalAction = {
    key: string;
    type: AutomationAction['type'];
    field_id: number | '';
    value: string;
    url: string;
    secret: string;
    to: string;
    subject: string;
    body: string;
    list_id: number | '';
};

let keySeq = 0;
const nextKey = (): string => `a${++keySeq}`;

function blankAction(type: AutomationAction['type'] = 'update_field'): LocalAction {
    return { key: nextKey(), type, field_id: '', value: '', url: '', secret: '', to: '', subject: '', body: '', list_id: '' };
}

/** Sheet de alta/edición de una automatización (modelo nativo del backend NestJS). */
export function AutomationEditorSheet({
    open,
    onOpenChange,
    listSlug,
    fields,
    lists,
    automation,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    listSlug: string;
    fields: Field[];
    lists: List[];
    automation: Automation | null;
}): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const dateFields = useMemo(() => fields.filter((f) => f.type === 'date' || f.type === 'datetime'), [fields]);

    const [name, setName] = useState('');
    const [triggerType, setTriggerType] = useState<AutomationTrigger['type']>('record_created');
    const [cron, setCron] = useState('0 9 * * *');
    const [dueFieldId, setDueFieldId] = useState<number | ''>('');
    const [dueOffset, setDueOffset] = useState('0');
    const [changedFieldId, setChangedFieldId] = useState<number | ''>('');
    const [condLogic, setCondLogic] = useState<'and' | 'or'>('and');
    const [condRows, setCondRows] = useState<CondRow[]>([]);
    const [actions, setActions] = useState<LocalAction[]>([blankAction()]);
    const [error, setError] = useState<string | null>(null);

    // Hidratar al abrir (create = limpio, edit = desde la automatización).
    useEffect(() => {
        if (!open) return;
        setError(null);
        if (!automation) {
            setName('');
            setTriggerType('record_created');
            setCron('0 9 * * *');
            setDueFieldId('');
            setDueOffset('0');
            setChangedFieldId('');
            setCondLogic('and');
            setCondRows([]);
            setActions([blankAction()]);
            return;
        }
        setName(automation.name);
        const t = automation.trigger;
        setTriggerType(t.type);
        if (t.type === 'scheduled') setCron(t.cron);
        if (t.type === 'due_date_reached') { setDueFieldId(t.field_id); setDueOffset(String(t.offset_minutes)); }
        if (t.type === 'field_changed') setChangedFieldId(t.field_id);
        const { logic, rows } = conditionToRows(automation.condition);
        setCondLogic(logic);
        setCondRows(rows);
        setActions(
            automation.actions.map((a) => {
                const base = blankAction(a.type);
                if (a.type === 'update_field') return { ...base, field_id: a.field_id, value: a.value === undefined || a.value === null ? '' : String(a.value) };
                if (a.type === 'create_record') return { ...base, list_id: a.list_id };
                if (a.type === 'call_webhook') return { ...base, url: a.url, secret: a.secret ?? '' };
                return { ...base, to: a.to, subject: a.subject, body: a.body };
            }),
        );
    }, [open, automation]);

    const save = useMutation({
        mutationFn: () => {
            const input = buildInput();
            return automation
                ? api.updateAutomation(listSlug, automation.id, input)
                : api.createAutomation(listSlug, input);
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['automations', tenantId, listSlug] });
            onOpenChange(false);
        },
        onError: (e) => setError(e instanceof CloudApiError ? e.message : 'No se pudo guardar'),
    });

    function buildTrigger(): AutomationTrigger {
        switch (triggerType) {
            case 'scheduled': return { type: 'scheduled', cron: cron.trim() };
            case 'due_date_reached': return { type: 'due_date_reached', field_id: Number(dueFieldId), offset_minutes: Number(dueOffset) || 0 };
            case 'field_changed': return { type: 'field_changed', field_id: Number(changedFieldId || fields[0]?.id) };
            default: return { type: triggerType };
        }
    }

    function buildActions(): AutomationAction[] {
        return actions.map((a): AutomationAction => {
            if (a.type === 'update_field') return { type: 'update_field', field_id: Number(a.field_id), value: coerceValue(a.value) };
            if (a.type === 'create_record') return { type: 'create_record', list_id: Number(a.list_id), data: {} };
            if (a.type === 'call_webhook') return a.secret ? { type: 'call_webhook', url: a.url.trim(), secret: a.secret } : { type: 'call_webhook', url: a.url.trim() };
            return { type: 'send_email', to: a.to.trim(), subject: a.subject.trim() || name.trim(), body: a.body };
        });
    }

    function buildInput(): CreateAutomationInput {
        const condition =
            condRows.filter((r) => r.field_id !== '').length > 0
                ? {
                      type: 'group' as const,
                      logic: condLogic,
                      children: condRows
                          .filter((r) => r.field_id !== '')
                          .map((r) => {
                              const nullary = CONDITION_OPS.find((o) => o.op === r.op)?.nullary;
                              return {
                                  type: 'condition' as const,
                                  field_id: Number(r.field_id),
                                  op: r.op as never,
                                  ...(nullary ? {} : { value: coerceValue(r.value) }),
                              };
                          }),
                  }
                : undefined;
        return { name: name.trim(), trigger: buildTrigger(), actions: buildActions(), condition };
    }

    const valid =
        name.trim() !== '' &&
        actions.length > 0 &&
        actions.every((a) =>
            a.type === 'update_field' ? a.field_id !== '' :
            a.type === 'create_record' ? a.list_id !== '' :
            a.type === 'call_webhook' ? a.url.trim() !== '' :
            a.to.trim() !== '' && a.subject.trim() !== '',
        ) &&
        (triggerType !== 'scheduled' || cron.trim() !== '') &&
        (triggerType !== 'due_date_reached' || dueFieldId !== '') &&
        (triggerType !== 'field_changed' || changedFieldId !== '' || fields.length > 0);

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="imcrm-flex imcrm-w-full imcrm-max-w-lg imcrm-flex-col">
                <SheetHeader>
                    <SheetTitle>{automation ? 'Editar automatización' : 'Nueva automatización'}</SheetTitle>
                    <SheetDescription>Cuándo se dispara, condiciones opcionales y qué hace.</SheetDescription>
                </SheetHeader>

                <SheetBody className="imcrm-flex-1 imcrm-space-y-6 imcrm-overflow-y-auto">
                    <Field label="Nombre">
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Avisar cuando se marca ganado" />
                    </Field>

                    {/* CUÁNDO */}
                    <StepCard step="Cuándo" accent>
                        <Select value={triggerType} onChange={(e) => setTriggerType(e.target.value as AutomationTrigger['type'])}>
                            {AUTOMATION_TRIGGERS.map((t) => (
                                <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
                            ))}
                        </Select>
                        {triggerType === 'scheduled' && (
                            <Field label="Cron" hint="min hora díames mes díasem — ej: 0 9 * * 1">
                                <Input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 9 * * *" className="imcrm-font-mono" />
                            </Field>
                        )}
                        {triggerType === 'due_date_reached' && (
                            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                                <Field label="Campo fecha">
                                    <FieldSelect fields={dateFields} value={dueFieldId} onChange={setDueFieldId} />
                                </Field>
                                <Field label="Desfase (min)" hint="negativo = antes">
                                    <Input value={dueOffset} onChange={(e) => setDueOffset(e.target.value)} inputMode="numeric" />
                                </Field>
                            </div>
                        )}
                        {triggerType === 'field_changed' && (
                            <Field label="Campo">
                                <FieldSelect fields={fields} value={changedFieldId} onChange={setChangedFieldId} />
                            </Field>
                        )}
                    </StepCard>

                    {/* SI (condiciones) */}
                    <StepCard step="Si (opcional)">
                        {condRows.length === 0 ? (
                            <p className="imcrm-text-sm imcrm-text-muted-foreground">
                                Sin condiciones — se ejecuta siempre que ocurra el disparador.
                            </p>
                        ) : (
                            <div className="imcrm-space-y-2">
                                {condRows.length > 1 && (
                                    <Select value={condLogic} onChange={(e) => setCondLogic(e.target.value as 'and' | 'or')} className="imcrm-w-40">
                                        <option value="and">Se cumplen TODAS</option>
                                        <option value="or">Se cumple ALGUNA</option>
                                    </Select>
                                )}
                                {condRows.map((row, i) => {
                                    const nullary = CONDITION_OPS.find((o) => o.op === row.op)?.nullary;
                                    return (
                                        <div key={i} className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                            <FieldSelect fields={fields} value={row.field_id} onChange={(v) => updateRow(i, { field_id: v })} className="imcrm-flex-1" />
                                            <Select value={row.op} onChange={(e) => updateRow(i, { op: e.target.value })} className="imcrm-w-36">
                                                {CONDITION_OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
                                            </Select>
                                            {!nullary && (
                                                <Input value={row.value} onChange={(e) => updateRow(i, { value: e.target.value })} placeholder="valor" className="imcrm-w-28" />
                                            )}
                                            <Button variant="ghost" size="icon" onClick={() => setCondRows((r) => r.filter((_, j) => j !== i))} aria-label="Quitar condición">
                                                <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                            </Button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        <Button variant="ghost" size="sm" className="imcrm-mt-2 imcrm-gap-1.5" onClick={() => setCondRows((r) => [...r, { field_id: '', op: 'eq', value: '' }])}>
                            <Plus className="imcrm-h-3.5 imcrm-w-3.5" /> Agregar condición
                        </Button>
                    </StepCard>

                    {/* ENTONCES (acciones) */}
                    <StepCard step="Entonces" accent>
                        <div className="imcrm-space-y-3">
                            {actions.map((a, i) => (
                                <ActionEditor
                                    key={a.key}
                                    action={a}
                                    fields={fields}
                                    lists={lists}
                                    canRemove={actions.length > 1}
                                    onChange={(patch) => setActions((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
                                    onRemove={() => setActions((arr) => arr.filter((_, j) => j !== i))}
                                />
                            ))}
                        </div>
                        <Button variant="ghost" size="sm" className="imcrm-mt-3 imcrm-gap-1.5" onClick={() => setActions((arr) => [...arr, blankAction()])}>
                            <Plus className="imcrm-h-3.5 imcrm-w-3.5" /> Agregar acción
                        </Button>
                    </StepCard>

                    {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
                </SheetBody>

                <SheetFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={() => save.mutate()} disabled={!valid || save.isPending}>
                        {save.isPending ? 'Guardando…' : automation ? 'Guardar cambios' : 'Crear automatización'}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );

    function updateRow(i: number, patch: Partial<CondRow>): void {
        setCondRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    }
}

function ActionEditor({
    action,
    fields,
    lists,
    canRemove,
    onChange,
    onRemove,
}: {
    action: LocalAction;
    fields: Field[];
    lists: List[];
    canRemove: boolean;
    onChange: (patch: Partial<LocalAction>) => void;
    onRemove: () => void;
}): JSX.Element {
    return (
        <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-background imcrm-p-3">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <Select value={action.type} onChange={(e) => onChange({ type: e.target.value as AutomationAction['type'] })} className="imcrm-flex-1">
                    {AUTOMATION_ACTIONS.map((t) => <option key={t} value={t}>{ACTION_LABELS[t]}</option>)}
                </Select>
                {canRemove && (
                    <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Quitar acción">
                        <Trash2 className="imcrm-h-4 imcrm-w-4" />
                    </Button>
                )}
            </div>

            <div className="imcrm-mt-2 imcrm-space-y-2">
                {action.type === 'update_field' && (
                    <div className="imcrm-flex imcrm-gap-2">
                        <FieldSelect fields={fields} value={action.field_id} onChange={(v) => onChange({ field_id: v })} className="imcrm-flex-1" />
                        <Input value={action.value} onChange={(e) => onChange({ value: e.target.value })} placeholder="nuevo valor" className="imcrm-flex-1" />
                    </div>
                )}
                {action.type === 'create_record' && (
                    <Select value={action.list_id} onChange={(e) => onChange({ list_id: e.target.value ? Number(e.target.value) : '' })}>
                        <option value="">Elegí una lista…</option>
                        {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </Select>
                )}
                {action.type === 'call_webhook' && (
                    <>
                        <Input value={action.url} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://tu-endpoint.com/hook" />
                        <Input value={action.secret} onChange={(e) => onChange({ secret: e.target.value })} placeholder="Secreto HMAC (opcional)" />
                    </>
                )}
                {action.type === 'send_email' && (
                    <>
                        <Input value={action.to} onChange={(e) => onChange({ to: e.target.value })} placeholder="email o {{slug_de_campo}}" />
                        <Input value={action.subject} onChange={(e) => onChange({ subject: e.target.value })} placeholder="Asunto" />
                        <Textarea value={action.body} onChange={(e) => onChange({ body: e.target.value })} placeholder="Mensaje… podés usar {{slug}} como merge tag" rows={3} />
                    </>
                )}
            </div>
        </div>
    );
}

function StepCard({ step, accent, children }: { step: string; accent?: boolean; children: React.ReactNode }): JSX.Element {
    return (
        <section className="imcrm-space-y-2">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <span
                    className={[
                        'imcrm-rounded-full imcrm-px-2 imcrm-py-0.5 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide',
                        accent ? 'imcrm-bg-primary/10 imcrm-text-primary' : 'imcrm-bg-muted imcrm-text-muted-foreground',
                    ].join(' ')}
                >
                    {step}
                </span>
            </div>
            {children}
        </section>
    );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-space-y-1">
            <Label className="imcrm-text-xs imcrm-text-muted-foreground">{label}</Label>
            {children}
            {hint && <p className="imcrm-text-[11px] imcrm-text-muted-foreground/80">{hint}</p>}
        </div>
    );
}

function FieldSelect({
    fields,
    value,
    onChange,
    className,
}: {
    fields: Field[];
    value: number | '';
    onChange: (v: number | '') => void;
    className?: string;
}): JSX.Element {
    return (
        <Select value={value} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')} className={className} aria-label="Campo">
            <option value="">Elegí un campo…</option>
            {fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </Select>
    );
}
