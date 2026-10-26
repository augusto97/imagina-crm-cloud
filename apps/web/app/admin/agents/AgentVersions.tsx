import { History, Loader2, RotateCcw } from 'lucide-react';
import { AI_AGENT_MODE_LABELS, AI_AGENT_TOOL_META, type AiAgentDto, type AiAgentVersionDto } from '@imagina-base/shared';

import { relativeTime } from '@/admin/activity/activityText';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useAgentVersions, useUpdateAiAgent } from '@/hooks/useAiAgents';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { formatDateTime } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';

/**
 * E6 — «Versiones»: una foto del agente por guardado (las últimas 30).
 * Restaurar guarda la foto como un cambio más (queda su propia versión).
 */
export function AgentVersions({ agent }: { agent: AiAgentDto }): JSX.Element {
    const versions = useAgentVersions(agent.id);
    const update = useUpdateAiAgent(agent.id);
    const confirm = useConfirm();
    const toast = useToast();
    if (versions.isLoading) return <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-muted-foreground" />;
    const rows = versions.data ?? [];
    if (rows.length === 0) {
        return (
            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                <History className="imcrm-h-4 imcrm-w-4" />
                {__('Sin versiones guardadas.')}
            </p>
        );
    }
    const restore = async (v: AiAgentVersionDto): Promise<void> => {
        const ok = await confirm({
            title: __('¿Restaurar esta versión?'),
            description: __('El agente vuelve a esa configuración (instrucciones, listas, herramientas, modo y topes) y pasa a trabajar con tu acceso.'),
            confirmLabel: __('Restaurar'),
        });
        if (!ok) return;
        const s = v.snapshot;
        update.mutate(
            {
                name: s.name,
                description: s.description,
                color: s.color,
                icon: s.icon,
                instructions: s.instructions,
                list_ids: s.list_ids,
                tools: s.tools,
                mode: s.mode,
                settings: s.settings,
                max_steps: s.max_steps,
                max_runs_per_day: s.max_runs_per_day,
                monthly_token_budget: s.monthly_token_budget,
                restored_from: v.id,
            },
            {
                onSuccess: () => toast.success(__('Versión restaurada')),
                onError: (err) => toast.error(__('No se pudo restaurar'), err instanceof ApiError || err instanceof Error ? err.message : undefined),
            },
        );
    };
    return (
        <Card>
            <ul className="imcrm-divide-y imcrm-divide-border" data-testid="agent-versions">
                {rows.map((v, i) => (
                    <li key={v.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-gap-3 imcrm-px-3 imcrm-py-2.5">
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <p className="imcrm-text-sm">
                                {v.note ?? __('Cambio')}
                                {i === 0 && <span className="imcrm-ml-1.5 imcrm-text-xs imcrm-text-muted-foreground">({__('actual')})</span>}
                            </p>
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {v.author?.name ?? __('Alguien')} · <span title={formatDateTime(parseUtcDate(v.created_at))}>{relativeTime(v.created_at)}</span>
                                {' · '}
                                {AI_AGENT_MODE_LABELS[v.snapshot.mode]} · {v.snapshot.tools.map((t) => AI_AGENT_TOOL_META[t]?.label ?? t).join(', ')}
                            </p>
                        </div>
                        {i > 0 && (
                            <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => void restore(v)}>
                                <RotateCcw className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Restaurar')}
                            </Button>
                        )}
                    </li>
                ))}
            </ul>
        </Card>
    );
}
