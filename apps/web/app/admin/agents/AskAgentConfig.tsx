import { Link } from 'react-router';
import { AlertTriangle, Bot } from 'lucide-react';
import { AI_AGENT_MODE_LABELS, readAskAgentConfig } from '@imagina-base/shared';

import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useAiAgentOptions } from '@/hooks/useAiAgents';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import type { ActionSpec } from '@/types/automation';

/**
 * E6 — Config de la acción «Pedirle a un agente» (`ask_agent`): qué agente
 * trabaja y una instrucción extra con variables (llegan al agente como DATOS).
 * El agente corre aparte, con su propio historial; según su modo cambia el
 * registro o deja una propuesta para que alguien la apruebe.
 */
export function AskAgentConfig({
    spec,
    onChange,
    listId,
    renderInstruction,
}: {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    listId: number | undefined;
    /** El campo de la instrucción con variables (lo provee el editor: `MergeTagInput`). */
    renderInstruction: (value: string, onChange: (v: string) => void) => JSX.Element;
}): JSX.Element {
    const options = useAiAgentOptions();
    const canManage = useCan(CAP.MANAGE_AI_AGENTS);
    const cfg = readAskAgentConfig(spec.config);
    const agents = options.data ?? [];
    const current = agents.find((a) => a.id === cfg.agent_id) ?? null;
    const set = (patch: Record<string, unknown>): void => onChange({ ...spec, config: { ...spec.config, ...patch } });
    const outside = current !== null && listId !== undefined && !current.list_ids.includes(listId);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="ask-agent-config">
            <div>
                <Label htmlFor="ask-agent-select">{__('Agente')}</Label>
                <Select id="ask-agent-select" value={cfg.agent_id ?? ''} onChange={(e) => set({ agent_id: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">{__('Elige un agente…')}</option>
                    {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                            {a.name}
                            {a.is_active ? '' : ` (${__('en pausa')})`}
                            {listId !== undefined && !a.list_ids.includes(listId) ? ` — ${__('no trabaja en esta lista')}` : ''}
                        </option>
                    ))}
                </Select>
                {cfg.agent_id !== null && current === null && !options.isLoading && (
                    <p className="imcrm-mt-1 imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-destructive">
                        <AlertTriangle className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Ese agente ya no existe: elige otro.')}
                    </p>
                )}
                {outside && (
                    <p className="imcrm-mt-1 imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-destructive">
                        <AlertTriangle className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Este agente no trabaja en esta lista: agrégala a sus listas o elige otro.')}
                    </p>
                )}
                {current && !outside && (
                    <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                        {sprintf(__('Modo: %s.'), AI_AGENT_MODE_LABELS[current.mode])}
                        {!current.is_active && ` ${__('Está en pausa: no va a trabajar hasta que lo reanudes.')}`}
                    </p>
                )}
                {agents.length === 0 && !options.isLoading && (
                    <p className="imcrm-mt-1 imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                        <Bot className="imcrm-h-3.5 imcrm-w-3.5" />
                        {canManage ? (
                            <>
                                {__('Todavía no hay agentes.')}{' '}
                                <Link to="/agents/new" className="imcrm-text-primary hover:imcrm-underline">
                                    {__('Crear uno')}
                                </Link>
                            </>
                        ) : (
                            __('Todavía no hay agentes: los crea quien administra la empresa.')
                        )}
                    </p>
                )}
            </div>
            <div>
                <Label>{__('Instrucción extra (opcional)')}</Label>
                {renderInstruction(cfg.instruction, (v) => set({ instruction: v }))}
                <p className="imcrm-mt-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Se suma a lo que el agente ya sabe hacer. Las variables del registro llegan como datos, no como órdenes.')}
                </p>
            </div>
        </div>
    );
}
