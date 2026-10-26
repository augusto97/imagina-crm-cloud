import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Loader2, Play } from 'lucide-react';
import { AI_AGENT_MAX_EXTRA_INSTRUCTION, type AiAgentDto } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { aiAgentKeys, useAgentRun, useTestAiAgent } from '@/hooks/useAiAgents';
import { useFields } from '@/hooks/useFields';
import { api, ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import type { RecordEntity } from '@/types/record';

import { RunDetail, RunStatusBadge } from './AgentRuns';

/** Los últimos registros de una lista, para elegir sobre cuál probar. */
function useRecentRecords(listId: number) {
    return useQuery({
        queryKey: ['records', String(listId), 'agent-test-picker'],
        queryFn: async () => (await api.get<RecordEntity[]>(`/lists/${listId}/records`, { query: { limit: 20, sort_dir: 'desc' } })).data,
        enabled: listId > 0,
        staleTime: 30_000,
    });
}

/**
 * E6 — «Probar»: corre el agente sobre un registro REAL en modo simulación:
 * lee de verdad, pero no escribe ni deja propuestas. Se ve paso a paso lo que
 * haría.
 */
export function AgentTestPanel({ agent }: { agent: AiAgentDto }): JSX.Element {
    const [listId, setListId] = useState<number>(agent.lists[0]?.id ?? 0);
    const [recordId, setRecordId] = useState<number | null>(null);
    const [instruction, setInstruction] = useState('');
    const [runId, setRunId] = useState<number | null>(null);
    const test = useTestAiAgent(agent.id);
    const run = useAgentRun(agent.id, runId);
    const records = useRecentRecords(listId);
    const fields = useFields(listId > 0 ? listId : undefined);
    const toast = useToast();
    const primary = (fields.data ?? []).find((f) => f.is_primary) ?? (fields.data ?? []).find((f) => f.type === 'text');
    const titleOf = (r: RecordEntity): string => {
        const v = primary ? r.fields[primary.slug] : null;
        return typeof v === 'string' && v.trim() !== '' ? v : sprintf(__('Registro #%d'), r.id);
    };

    const start = (): void => {
        test.mutate(
            { list_id: listId, ...(recordId ? { record_id: recordId } : {}), instruction },
            {
                onSuccess: (res) => setRunId(res.run_id),
                onError: (err) => toast.error(__('No se pudo probar'), err instanceof ApiError || err instanceof Error ? err.message : undefined),
            },
        );
    };
    const live = run.data ? run.data.status === 'queued' || run.data.status === 'running' : runId !== null;
    // Al terminar, el consumo del agente (cabecera) y el historial cambian.
    const qc = useQueryClient();
    const finished = run.data !== undefined && !live;
    useEffect(() => {
        if (!finished) return;
        void qc.invalidateQueries({ queryKey: aiAgentKeys.detail(agent.id) });
        void qc.invalidateQueries({ queryKey: aiAgentKeys.runs(agent.id) });
    }, [finished, qc, agent.id]);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="agent-test">
            <Card className="imcrm-p-4">
                <p className="imcrm-mb-3 imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                    <FlaskConical className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    {__('La prueba lee el registro de verdad pero no escribe nada ni deja propuestas: ves paso a paso lo que haría. Cuenta como uso de IA.')}
                </p>
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                    <div>
                        <Label htmlFor="agent-test-list">{__('Lista')}</Label>
                        <Select
                            id="agent-test-list"
                            value={listId}
                            onChange={(e) => {
                                setListId(Number(e.target.value));
                                setRecordId(null);
                            }}
                        >
                            {agent.lists.map((l) => (
                                <option key={l.id} value={l.id}>
                                    {l.name}
                                </option>
                            ))}
                        </Select>
                    </div>
                    <div>
                        <Label htmlFor="agent-test-record">{__('Registro')}</Label>
                        <Select id="agent-test-record" value={recordId ?? ''} onChange={(e) => setRecordId(e.target.value === '' ? null : Number(e.target.value))}>
                            <option value="">{__('El más reciente')}</option>
                            {(records.data ?? []).map((r) => (
                                <option key={r.id} value={r.id}>
                                    {titleOf(r)}
                                </option>
                            ))}
                        </Select>
                    </div>
                </div>
                <div className="imcrm-mt-3">
                    <Label htmlFor="agent-test-instruction">{__('Instrucción extra (opcional)')}</Label>
                    <Textarea
                        id="agent-test-instruction"
                        rows={2}
                        maxLength={AI_AGENT_MAX_EXTRA_INSTRUCTION}
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                    />
                </div>
                <div className="imcrm-mt-3">
                    <Button onClick={start} disabled={test.isPending || live || listId === 0} data-testid="agent-test-run">
                        {test.isPending || live ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Play className="imcrm-h-4 imcrm-w-4" />}
                        {live ? __('Probando…') : __('Probar')}
                    </Button>
                </div>
            </Card>

            {runId !== null && (
                <Card className="imcrm-p-4" data-testid="agent-test-result">
                    <div className="imcrm-mb-2 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <h3 className="imcrm-text-sm imcrm-font-semibold">{__('Resultado de la prueba')}</h3>
                        {run.data && <RunStatusBadge run={run.data} />}
                        {run.data?.record_title && <span className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{run.data.record_title}</span>}
                    </div>
                    {run.data ? (
                        <RunDetail run={run.data} />
                    ) : (
                        <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                            {__('En cola…')}
                        </p>
                    )}
                </Card>
            )}
        </div>
    );
}
