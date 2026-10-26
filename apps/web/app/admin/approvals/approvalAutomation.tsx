import {
    APPROVAL_RESULT_LABELS,
    APPROVAL_RESULTS,
    APPROVAL_STATUS_LABELS,
    APPROVAL_TRIGGER_DEFAULT_RESULTS,
    APPROVAL_TRIGGER_RESULTS,
    WAIT_APPROVAL_MAX_DAYS,
    readApprovalFlowId,
    readApprovalTriggerResults,
    readWaitApprovalConfig,
    waitApprovalProblem,
    type ApprovalTriggerResult,
} from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useApprovalFlows } from '@/hooks/useApprovals';
import { __ } from '@/lib/i18n';
import type { ActionSpec, TriggerConfig } from '@/types/automation';
import type { FieldEntity } from '@/types/field';

/**
 * C5 — Las piezas de aprobaciones del editor de automatizaciones: el
 * disparador «Cuando se aprueba o se rechaza», la acción «Pedir aprobación» y
 * el paso «Esperar aprobación». Viven aquí (y no en `config-editors.tsx`) para
 * tocar lo mínimo el editor compartido.
 */

/** ¿El flujo pide o espera una aprobación (a cualquier profundidad)? */
export function actionsUseApprovals(actions: readonly ActionSpec[]): boolean {
    for (const a of actions) {
        if (a.type === 'request_approval' || a.type === 'wait_approval') return true;
        const c = a.config ?? {};
        for (const key of ['then_actions', 'else_actions', 'actions'] as const) {
            const inner = c[key];
            if (Array.isArray(inner) && actionsUseApprovals(inner as ActionSpec[])) return true;
        }
    }
    return false;
}

/**
 * El pseudo-campo «Resultado de la aprobación» para las condiciones (un si/sino
 * después de «Esperar aprobación», o el disparador de una aprobación): una
 * selección con los resultados posibles. El motor lo resuelve con
 * `{{aprobacion.resultado}}`.
 */
export function approvalResultConditionField(listId: number): FieldEntity {
    return {
        id: -95001,
        list_id: listId,
        slug: 'aprobacion.resultado',
        label: __('Resultado de la aprobación'),
        type: 'select',
        config: { options: APPROVAL_RESULTS.map((r) => ({ value: r, label: APPROVAL_RESULT_LABELS[r] })) },
        is_required: false,
        is_unique: false,
        is_primary: false,
        is_indexed: false,
        position: 9999,
        created_at: '',
        updated_at: '',
    };
}

function FlowSelect({
    listId,
    value,
    onChange,
    anyLabel,
    id,
    testId,
}: {
    listId: number | undefined;
    value: number | null;
    onChange: (id: number | null) => void;
    anyLabel: string | null;
    id: string;
    testId: string;
}): JSX.Element {
    const flows = useApprovalFlows(listId);
    const list = flows.data ?? [];
    return (
        <>
            <Select id={id} value={value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} data-testid={testId}>
                {anyLabel !== null ? <option value="">{anyLabel}</option> : <option value="">{__('Elige un flujo…')}</option>}
                {list.map((f) => (
                    <option key={f.id} value={f.id}>
                        {f.name}
                        {f.is_active ? '' : ` (${__('pausado')})`}
                    </option>
                ))}
                {value !== null && !flows.isLoading && !list.some((f) => f.id === value) && <option value={value}>{__('Flujo eliminado')}</option>}
            </Select>
            {!flows.isLoading && list.length === 0 && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Esta lista todavía no tiene flujos de aprobación: créalos en Ajustes de la lista → Aprobaciones.')}
                </p>
            )}
        </>
    );
}

/** El disparador «Cuando se aprueba o se rechaza»: qué flujo y qué resultados. */
export function ApprovalTriggerConfig({
    listId,
    config,
    onChange,
}: {
    listId: number | undefined;
    config: TriggerConfig;
    onChange: (next: TriggerConfig) => void;
}): JSX.Element {
    const flowId = readApprovalFlowId(config);
    const results = readApprovalTriggerResults(config);
    const setResults = (next: ApprovalTriggerResult[]): void => {
        const out = { ...config };
        // Vacío = los de por defecto (aprobada y rechazada).
        if (next.length === 0) delete out.results;
        else out.results = next;
        onChange(out);
    };
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-3" data-testid="trigger-approval-config">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="trigger-approval-flow">{__('Flujo de aprobación')}</Label>
                <FlowSelect
                    id="trigger-approval-flow"
                    testId="trigger-approval-flow"
                    listId={listId}
                    value={flowId}
                    anyLabel={__('Cualquier flujo de esta lista')}
                    onChange={(id) => {
                        const out = { ...config };
                        if (id) out.approval_flow_id = id;
                        else delete out.approval_flow_id;
                        onChange(out);
                    }}
                />
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Cuando la solicitud queda')}</Label>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                    {APPROVAL_TRIGGER_RESULTS.map((r) => (
                        <label key={r} className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-1 imcrm-text-xs">
                            <input
                                type="checkbox"
                                checked={results.includes(r)}
                                onChange={(e) => setResults(e.target.checked ? [...results, r] : results.filter((x) => x !== r))}
                                data-testid={`trigger-approval-result-${r}`}
                            />
                            {APPROVAL_STATUS_LABELS[r]}
                        </label>
                    ))}
                </div>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {sameAsDefault(results)
                        ? __('Sin elegir nada se dispara al aprobar y al rechazar. Usa un «Si / Si no» con «Resultado de la aprobación» para hacer algo distinto en cada caso.')
                        : __('En las acciones puedes usar {{aprobacion.resultado}}, {{aprobacion.flujo}}, {{aprobacion.motivo}} y {{aprobacion.decidio}}.')}
                </p>
            </div>
        </div>
    );
}

function sameAsDefault(results: readonly string[]): boolean {
    return results.length === APPROVAL_TRIGGER_DEFAULT_RESULTS.length && APPROVAL_TRIGGER_DEFAULT_RESULTS.every((r) => results.includes(r));
}

/** La acción «Pedir aprobación»: qué flujo y la nota (con variables). */
export function RequestApprovalConfig({
    listId,
    spec,
    onChange,
    renderNote,
}: {
    listId: number | undefined;
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    /** El campo de la nota con variables (lo provee el editor: `MergeTagInput`). */
    renderNote: (value: string, onChange: (v: string) => void) => JSX.Element;
}): JSX.Element {
    const cfg = spec.config;
    const flowId = readApprovalFlowId(cfg);
    const note = typeof cfg.note === 'string' ? cfg.note : '';
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-request-approval-config">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="action-approval-flow">{__('Flujo que se pide')}</Label>
                <FlowSelect
                    id="action-approval-flow"
                    testId="action-approval-flow"
                    listId={listId}
                    value={flowId}
                    anyLabel={null}
                    onChange={(id) => {
                        const config = { ...cfg };
                        if (id) config.approval_flow_id = id;
                        else delete config.approval_flow_id;
                        onChange({ ...spec, config });
                    }}
                />
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Nota para quienes aprueban (opcional)')}</Label>
                {renderNote(note, (v) => onChange({ ...spec, config: { ...cfg, note: v } }))}
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Si el registro ya tiene una solicitud pendiente de ese flujo, no se pide otra. Para seguir sólo cuando alguien decida, agrega después «Esperar aprobación».')}
            </p>
        </div>
    );
}

/** El paso «Esperar aprobación»: qué solicitud y el tope de días. */
export function WaitApprovalConfig({
    listId,
    spec,
    onChange,
    insideLoop,
}: {
    listId: number | undefined;
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    insideLoop: boolean;
}): JSX.Element {
    const cfg = spec.config;
    const w = readWaitApprovalConfig(cfg);
    const problem = waitApprovalProblem(cfg);
    if (insideLoop) {
        return (
            <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-p-2 imcrm-text-xs imcrm-text-destructive">
                {__('No se puede esperar una aprobación dentro de «Repetir por cada registro vinculado»: pon la espera antes o después de la repetición.')}
            </p>
        );
    }
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-wait-approval-config">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="action-wait-approval-flow">{__('Esperar la solicitud de')}</Label>
                <FlowSelect
                    id="action-wait-approval-flow"
                    testId="action-wait-approval-flow"
                    listId={listId}
                    value={w.flowId}
                    anyLabel={__('La que pidió esta automatización (o cualquiera pendiente)')}
                    onChange={(id) => {
                        const config = { ...cfg };
                        if (id) config.approval_flow_id = id;
                        else delete config.approval_flow_id;
                        onChange({ ...spec, config });
                    }}
                />
            </div>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                <span>{__('Si no se resuelve en')}</span>
                <Input
                    type="number"
                    min={1}
                    max={WAIT_APPROVAL_MAX_DAYS}
                    className="imcrm-h-8 imcrm-w-20"
                    value={typeof cfg.timeout_days === 'number' || typeof cfg.timeout_days === 'string' ? String(cfg.timeout_days) : ''}
                    onChange={(e) => {
                        const config = { ...cfg };
                        if (e.target.value === '') delete config.timeout_days;
                        else config.timeout_days = Number(e.target.value);
                        onChange({ ...spec, config });
                    }}
                    placeholder="—"
                    aria-label={__('Tope de días')}
                    data-testid="action-wait-approval-days"
                />
                <span>{__('días, seguir con el resultado «vencida» (vacío: sin tope).')}</span>
            </div>
            {problem && <p className="imcrm-text-xs imcrm-text-destructive">{problem}</p>}
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('La corrida queda en pausa y sigue sola cuando alguien aprueba, rechaza, devuelve o cancela. Después usa un «Si / Si no» con «Resultado de la aprobación» (o {{aprobacion.resultado}}) para cada caso.')}
            </p>
        </div>
    );
}
