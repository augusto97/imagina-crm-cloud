import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Bot, Check, CircleAlert, Loader2, X } from 'lucide-react';
import type { RecordAgentOption } from '@imagina-base/shared';

import { agentColor, agentIcon } from '@/admin/agents/agentUi';
import { IconSquare } from '@/admin/lists/FolderBadge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { aiErrorText, useAskRecordAgent } from '@/hooks/useRecordAi';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { AgentRunStatus } from './RecordAi';

/**
 * v0.1.456 — «Pedir al agente» desde la ficha: elegir el agente, una
 * indicación opcional y seguir el estado sin recargar. Va en su propio chunk
 * (se baja al abrirlo).
 */
function modeText(mode: RecordAgentOption['mode']): string {
    return mode === 'act' ? __('Hace los cambios') : __('Propone y una persona aprueba');
}

export function AskAgentDialog({
    listId,
    recordId,
    agents,
    unavailable,
    onClose,
}: {
    listId: number;
    recordId: number;
    agents: RecordAgentOption[];
    unavailable: string | null;
    onClose: () => void;
}): JSX.Element {
    const [agentId, setAgentId] = useState(agents[0]!.id);
    const [instruction, setInstruction] = useState('');
    const ask = useAskRecordAgent(listId, recordId);
    const run = ask.data ?? null;
    const agent = agents.find((a) => a.id === agentId) ?? agents[0]!;

    return (
        <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-lg imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg sm:imcrm-p-6"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="imcrm-ask-agent-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary">
                            <Bot className="imcrm-h-5 imcrm-w-5" />
                        </span>
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Pedir al agente')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('El agente lee este registro y hace lo que tiene en sus instrucciones. Puedes darle una indicación para esta vez.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent" aria-label={__('Cerrar')}>
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Dialog.Close>
                    </div>

                    {run !== null ? (
                        <div className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-3">
                            <AgentRunStatus listId={listId} recordId={recordId} initial={run} />
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Puedes cerrar esta ventana: el estado también queda en la ficha y no hace falta recargar.')}
                            </p>
                            <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                                <Button type="button" variant="ghost" onClick={() => ask.reset()}>
                                    {__('Pedir otra cosa')}
                                </Button>
                                <Button type="button" onClick={onClose}>
                                    {__('Listo')}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <form
                            className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-3"
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (!ask.isPending) ask.mutate({ agent_id: agent.id, instruction: instruction.trim() });
                            }}
                        >
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" role="radiogroup" aria-label={__('Agente')}>
                                {agents.map((a) => {
                                    const on = a.id === agent.id;
                                    return (
                                        <button
                                            key={a.id}
                                            type="button"
                                            role="radio"
                                            aria-checked={on}
                                            onClick={() => setAgentId(a.id)}
                                            className={cn(
                                                'imcrm-flex imcrm-w-full imcrm-items-start imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-transition-colors',
                                                on ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-accent/50',
                                            )}
                                            data-testid="imcrm-ask-agent-option"
                                        >
                                            <IconSquare icon={agentIcon(a.icon)} color={agentColor(a.color)} />
                                            <span className="imcrm-min-w-0 imcrm-flex-1">
                                                <span className="imcrm-block imcrm-text-sm imcrm-font-medium">{a.name}</span>
                                                {a.description !== '' && (
                                                    <span className="imcrm-line-clamp-2 imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{a.description}</span>
                                                )}
                                                <span className="imcrm-mt-0.5 imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">{modeText(a.mode)}</span>
                                            </span>
                                            {on && <Check className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" />}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="ask-agent-instruction">{__('Indicación para esta vez (opcional)')}</Label>
                                <Textarea
                                    id="ask-agent-instruction"
                                    rows={3}
                                    value={instruction}
                                    maxLength={2000}
                                    placeholder={__('Ej.: revisa el último correo del cliente y deja la prioridad al día.')}
                                    onChange={(e) => setInstruction(e.target.value)}
                                    data-testid="imcrm-ask-agent-instruction"
                                />
                            </div>
                            {unavailable !== null && (
                                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-[hsl(var(--imcrm-warning-ink))]">
                                    <CircleAlert className="imcrm-mt-px imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                                    {sprintf(/* translators: %s: motivo */ __('%s El agente no va a poder trabajar hasta que se resuelva.'), unavailable)}
                                </p>
                            )}
                            {ask.isError && (
                                <p className="imcrm-text-xs imcrm-text-destructive" role="alert">
                                    {aiErrorText(ask.error)}
                                </p>
                            )}
                            <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                                <Button type="button" variant="ghost" onClick={onClose}>
                                    {__('Cancelar')}
                                </Button>
                                <Button type="submit" className="imcrm-gap-2" disabled={ask.isPending || unavailable !== null} data-testid="imcrm-ask-agent-submit">
                                    {ask.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Bot className="imcrm-h-4 imcrm-w-4" />}
                                    {__('Pedírselo')}
                                </Button>
                            </div>
                        </form>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
