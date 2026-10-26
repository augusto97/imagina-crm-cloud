import { useState } from 'react';
import { Link } from 'react-router';
import { ExternalLink, Loader2, Plus, Trash2, Workflow } from 'lucide-react';
import {
    AI_AGENT_MAX_EXTRA_INSTRUCTION,
    AI_AGENT_QUICK_TRIGGERS,
    AI_AGENT_QUICK_TRIGGER_LABELS,
    type AiAgentDto,
    type AiAgentQuickTrigger,
    type AiAgentTriggerDto,
} from '@imagina-base/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { TRIGGER_META } from '@/admin/automations/automationMeta';
import { useAddAgentTrigger, useRemoveAgentTrigger, useUpdateAgentTrigger } from '@/hooks/useAiAgents';
import { useFields } from '@/hooks/useFields';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';

/**
 * Etiqueta legible de cualquier disparador: los rápidos con su frase y el
 * resto con la del editor de automatizaciones (un disparador nuevo se nombra
 * solo, sin tocar este archivo).
 */
export function triggerTypeLabel(type: string): string {
    return (AI_AGENT_QUICK_TRIGGER_LABELS as Record<string, string>)[type] ?? TRIGGER_META[type]?.title ?? type;
}

function errText(err: unknown): string {
    return err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo guardar.');
}

function TriggerRow({ agent, trigger }: { agent: AiAgentDto; trigger: AiAgentTriggerDto }): JSX.Element {
    const update = useUpdateAgentTrigger(agent.id);
    const remove = useRemoveAgentTrigger(agent.id);
    const toast = useToast();
    const confirm = useConfirm();
    const [editing, setEditing] = useState(false);
    const [instruction, setInstruction] = useState(trigger.instruction);
    return (
        <li className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-px-3 imcrm-py-3" data-agent-trigger={trigger.automation_id}>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Workflow className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                <span className="imcrm-text-sm imcrm-font-medium">{triggerTypeLabel(trigger.trigger_type)}</span>
                <span className="imcrm-text-xs imcrm-text-muted-foreground">{sprintf(__('en «%s»'), trigger.list_name)}</span>
                {trigger.changed_fields.length > 0 && (
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{sprintf(__('si cambia %s'), trigger.changed_fields.join(', '))}</span>
                )}
                {!trigger.is_active && <Badge variant="warning">{__('Pausado')}</Badge>}
                {!trigger.managed && <Badge variant="secondary">{__('Con más pasos')}</Badge>}
            </div>
            {trigger.instruction.trim() !== '' && !editing && <p className="imcrm-text-xs imcrm-text-muted-foreground">«{trigger.instruction}»</p>}
            {editing && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Textarea value={instruction} rows={2} maxLength={AI_AGENT_MAX_EXTRA_INSTRUCTION} onChange={(e) => setInstruction(e.target.value)} />
                    <div className="imcrm-flex imcrm-gap-2">
                        <Button
                            size="sm"
                            disabled={update.isPending}
                            onClick={() =>
                                update.mutate(
                                    { automationId: trigger.automation_id, instruction },
                                    { onSuccess: () => setEditing(false), onError: (e) => toast.error(__('No se pudo guardar'), errText(e)) },
                                )
                            }
                        >
                            {__('Guardar')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                            {__('Cancelar')}
                        </Button>
                    </div>
                </div>
            )}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                <Button
                    size="sm"
                    variant="outline"
                    disabled={update.isPending}
                    onClick={() =>
                        update.mutate(
                            { automationId: trigger.automation_id, is_active: !trigger.is_active },
                            { onError: (e) => toast.error(__('No se pudo guardar'), errText(e)) },
                        )
                    }
                >
                    {trigger.is_active ? __('Pausar') : __('Activar')}
                </Button>
                {trigger.managed && !editing && (
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                        {__('Instrucción extra')}
                    </Button>
                )}
                <Button size="sm" variant="ghost" asChild>
                    <Link to={`/lists/${trigger.list_slug}/automations/${trigger.automation_id}`}>
                        <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Abrir la automatización')}
                    </Link>
                </Button>
                {trigger.managed && (
                    <Button
                        size="sm"
                        variant="ghost"
                        className="imcrm-text-destructive"
                        disabled={remove.isPending}
                        onClick={async () => {
                            const ok = await confirm({
                                title: __('¿Quitar este disparador?'),
                                description: __('La automatización va a la papelera y el agente deja de trabajar en ese momento.'),
                                confirmLabel: __('Quitar'),
                                destructive: true,
                            });
                            if (ok) remove.mutate(trigger.automation_id, { onError: (e) => toast.error(__('No se pudo quitar'), errText(e)) });
                        }}
                    >
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Quitar')}
                    </Button>
                )}
            </div>
        </li>
    );
}

/**
 * E6 — «Cuándo trabaja»: las automatizaciones que le piden trabajo al agente.
 * Las más comunes se arman aquí mismo; cualquier otro disparador (los de hoy
 * y los que vengan) se elige en el editor de automatizaciones con la acción
 * «Pedirle a un agente».
 */
export function AgentWhen({ agent, suggested }: { agent: AiAgentDto; suggested?: AiAgentQuickTrigger | null }): JSX.Element {
    const add = useAddAgentTrigger(agent.id);
    const toast = useToast();
    const [listId, setListId] = useState<number>(agent.lists[0]?.id ?? 0);
    const [type, setType] = useState<AiAgentQuickTrigger>(suggested ?? 'record_created');
    const [changed, setChanged] = useState<string[]>([]);
    const [instruction, setInstruction] = useState('');
    const fields = useFields(listId > 0 ? listId : undefined);
    const list = agent.lists.find((l) => l.id === listId) ?? agent.lists[0];

    const submit = (): void => {
        if (!list) return;
        add.mutate(
            { list_id: list.id, trigger_type: type, changed_fields: type === 'record_updated' ? changed : [], instruction },
            {
                onSuccess: () => {
                    setInstruction('');
                    setChanged([]);
                    toast.success(__('Listo: el agente ya trabaja en ese momento'));
                },
                onError: (e) => toast.error(__('No se pudo agregar'), errText(e)),
            },
        );
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="agent-when">
            {agent.triggers.length > 0 ? (
                <Card>
                    <ul className="imcrm-divide-y imcrm-divide-border">
                        {agent.triggers.map((t) => (
                            <TriggerRow key={t.automation_id} agent={agent} trigger={t} />
                        ))}
                    </ul>
                </Card>
            ) : (
                <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Todavía nadie le pide trabajo. Agrega cuándo trabaja abajo, o pruébalo primero.')}
                </p>
            )}

            {agent.lists.length > 0 && (
                <Card className="imcrm-p-4">
                    <h3 className="imcrm-mb-3 imcrm-text-sm imcrm-font-semibold">{__('Agregar cuándo trabaja')}</h3>
                    <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                        <div>
                            <Label htmlFor="agent-trigger-type">{__('Cuándo')}</Label>
                            <Select id="agent-trigger-type" value={type} onChange={(e) => setType(e.target.value as AiAgentQuickTrigger)}>
                                {AI_AGENT_QUICK_TRIGGERS.map((t) => (
                                    <option key={t} value={t}>
                                        {AI_AGENT_QUICK_TRIGGER_LABELS[t]}
                                    </option>
                                ))}
                            </Select>
                        </div>
                        <div>
                            <Label htmlFor="agent-trigger-list">{__('En la lista')}</Label>
                            <Select id="agent-trigger-list" value={list?.id ?? ''} onChange={(e) => setListId(Number(e.target.value))}>
                                {agent.lists.map((l) => (
                                    <option key={l.id} value={l.id}>
                                        {l.name}
                                    </option>
                                ))}
                            </Select>
                        </div>
                    </div>
                    {type === 'record_updated' && (
                        <div className="imcrm-mt-3">
                            <Label>{__('Sólo si cambia alguno de estos campos (opcional)')}</Label>
                            <div className="imcrm-mt-1 imcrm-flex imcrm-flex-wrap imcrm-gap-1.5" data-testid="agent-trigger-fields">
                                {(fields.data ?? []).map((f) => {
                                    const on = changed.includes(f.slug);
                                    return (
                                        <button
                                            key={f.id}
                                            type="button"
                                            onClick={() => setChanged(on ? changed.filter((s) => s !== f.slug) : [...changed, f.slug])}
                                            className={
                                                on
                                                    ? 'imcrm-rounded-full imcrm-border imcrm-border-primary imcrm-bg-primary/10 imcrm-px-2.5 imcrm-py-0.5 imcrm-text-xs'
                                                    : 'imcrm-rounded-full imcrm-border imcrm-border-border imcrm-px-2.5 imcrm-py-0.5 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground'
                                            }
                                            aria-pressed={on}
                                        >
                                            {f.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    <div className="imcrm-mt-3">
                        <Label htmlFor="agent-trigger-instruction">{__('Instrucción extra (opcional)')}</Label>
                        <Textarea
                            id="agent-trigger-instruction"
                            rows={2}
                            maxLength={AI_AGENT_MAX_EXTRA_INSTRUCTION}
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                            placeholder={__('Ej.: Fíjate sobre todo en el campo {{asunto}}.')}
                        />
                        <p className="imcrm-mt-1 imcrm-text-[11px] imcrm-text-muted-foreground">{__('Puedes usar variables del registro como {{slug}}: llegan al agente como datos.')}</p>
                    </div>
                    <div className="imcrm-mt-3 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                        <Button onClick={submit} disabled={add.isPending || !list} data-testid="agent-trigger-add">
                            {add.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Plus className="imcrm-h-4 imcrm-w-4" />}
                            {__('Agregar')}
                        </Button>
                        {list && (
                            <Link to={`/lists/${list.slug}/automations/new`} className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground hover:imcrm-underline">
                                {__('¿Otro momento? Arma una automatización con la acción «Pedirle a un agente»')}
                            </Link>
                        )}
                    </div>
                </Card>
            )}
        </div>
    );
}
