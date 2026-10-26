import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ClipboardCheck, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
    APPROVAL_MAX_STEPS,
    APPROVAL_MODE_LABELS,
    APPROVER_ROLE_LABELS,
    APPROVER_ROLES,
    approvalFlowConfigProblems,
    describeApprover,
    isUserWritableType,
    stepLabel,
    type ApprovalFieldSet,
    type ApprovalFlow,
    type ApprovalFlowConfig,
    type ApprovalMode,
    type ApprovalStep,
    type Approver,
    type FieldType,
} from '@imagina-base/shared';

import { extractFieldOptions } from '@/admin/records/fieldOptions';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { UserPicker } from '@/components/ui/user-picker';
import { useApprovalFlows, useCreateApprovalFlow, useDeleteApprovalFlow, useUpdateApprovalFlow } from '@/hooks/useApprovals';
import { useFields } from '@/hooks/useFields';
import { useMemberNames } from '@/hooks/useWpUsers';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

/**
 * C5 — Ajustes de la lista → «Aprobaciones»: los flujos de la lista.
 *
 * Cada flujo tiene pasos EN SERIE (quién aprueba cada uno y si alcanza con
 * uno o tienen que aprobar todos), qué campos se ponen al aprobar y al
 * rechazar, y si se puede volver a pedir tras un rechazo. El servidor valida
 * todo de nuevo al guardar; aquí se avisa mientras se edita con la MISMA
 * función (`approvalFlowConfigProblems`).
 *
 * Los EQUIPOS como aprobador todavía no se ofrecen: el tipo `team` ya existe
 * en el schema y en la resolución del servidor, y se habilita aquí cuando la
 * empresa tenga equipos (ver ApprovalsService.resolveApprovers).
 */
export function ApprovalFlowsPanel({ listId }: { listId: number }): JSX.Element {
    const flows = useApprovalFlows(listId);
    const fieldsQ = useFields(listId);
    const [editing, setEditing] = useState<ApprovalFlow | 'new' | null>(null);
    const del = useDeleteApprovalFlow(listId);
    const update = useUpdateApprovalFlow(listId);
    const confirm = useConfirm();
    const toast = useToast();
    const fields = fieldsQ.data ?? [];

    if (editing !== null) {
        return (
            <FlowEditor
                listId={listId}
                fields={fields}
                flow={editing === 'new' ? null : editing}
                onClose={() => setEditing(null)}
            />
        );
    }

    const remove = async (flow: ApprovalFlow): Promise<void> => {
        const ok = await confirm({
            title: sprintf(__('¿Eliminar el flujo «%s»?'), flow.name),
            description:
                flow.pending_count > 0
                    ? sprintf(__('Tiene %d solicitudes pendientes: se van a cancelar. El historial de las ya resueltas se conserva en la actividad de cada registro.'), flow.pending_count)
                    : __('El historial de las solicitudes resueltas se conserva en la actividad de cada registro.'),
            confirmLabel: __('Eliminar'),
            destructive: true,
        });
        if (!ok) return;
        del.mutate(flow.id, {
            onSuccess: () => toast.success(__('Flujo eliminado')),
            onError: (err) => toast.error(__('No se pudo eliminar'), err instanceof ApiError || err instanceof Error ? err.message : ''),
        });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="imcrm-approval-flows">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <p className="imcrm-max-w-2xl imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Un gasto, un descuento, un contrato: en la ficha de cada registro aparece «Pedir aprobación» (también lo puede pedir una automatización) y a quien le toca decidir le llega el aviso.')}
                </p>
                <Button size="sm" onClick={() => setEditing('new')} data-testid="imcrm-approval-flow-new">
                    <Plus className="imcrm-mr-1.5 imcrm-h-4 imcrm-w-4" />
                    {__('Nuevo flujo')}
                </Button>
            </div>

            {flows.isLoading ? (
                <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
            ) : (flows.data ?? []).length === 0 ? (
                <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-10 imcrm-text-center">
                    <ClipboardCheck className="imcrm-h-8 imcrm-w-8 imcrm-text-muted-foreground/60" aria-hidden />
                    <p className="imcrm-text-sm imcrm-font-medium">{__('Esta lista todavía no tiene flujos de aprobación')}</p>
                    <p className="imcrm-max-w-md imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Crea uno y en la ficha de cada registro aparece «Pedir aprobación». También lo puede pedir una automatización.')}
                    </p>
                </div>
            ) : (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    {(flows.data ?? []).map((flow) => (
                        <li
                            key={flow.id}
                            className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3 sm:imcrm-flex-row sm:imcrm-items-start sm:imcrm-justify-between"
                            data-testid="imcrm-approval-flow"
                        >
                            <div className="imcrm-min-w-0 imcrm-flex-1">
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                    <span className="imcrm-font-semibold">{flow.name}</span>
                                    {!flow.is_active && (
                                        <span className="imcrm-rounded-full imcrm-bg-muted imcrm-px-2 imcrm-py-px imcrm-text-[11px] imcrm-text-muted-foreground">{__('Pausado')}</span>
                                    )}
                                    {flow.pending_count > 0 && (
                                        <span className="imcrm-rounded-full imcrm-bg-amber-500/15 imcrm-px-2 imcrm-py-px imcrm-text-[11px] imcrm-font-medium imcrm-text-amber-800 dark:imcrm-text-amber-300">
                                            {flow.pending_count === 1 ? __('1 pendiente') : sprintf(__('%d pendientes'), flow.pending_count)}
                                        </span>
                                    )}
                                </div>
                                {flow.description.trim() !== '' && <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">{flow.description}</p>}
                                <FlowStepsSummary config={flow.config} fields={fields} />
                            </div>
                            <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1">
                                <label className="imcrm-mr-2 imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                                    <input
                                        type="checkbox"
                                        className="imcrm-h-3.5 imcrm-w-3.5"
                                        checked={flow.is_active}
                                        onChange={(e) =>
                                            update.mutate(
                                                { id: flow.id, is_active: e.target.checked },
                                                { onError: (err) => toast.error(__('No se pudo guardar'), err instanceof Error ? err.message : '') },
                                            )
                                        }
                                    />
                                    {__('Activo')}
                                </label>
                                <Button size="sm" variant="ghost" onClick={() => setEditing(flow)} aria-label={sprintf(__('Editar «%s»'), flow.name)} data-testid="imcrm-approval-flow-edit">
                                    <Pencil className="imcrm-h-4 imcrm-w-4" />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => void remove(flow)} aria-label={sprintf(__('Eliminar «%s»'), flow.name)}>
                                    <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function FlowStepsSummary({ config, fields }: { config: ApprovalFlowConfig; fields: FieldEntity[] }): JSX.Element {
    const ids = config.steps.flatMap((s) => (s.approver.type === 'users' ? s.approver.approver_user_ids : []));
    const names = useMemberNames(ids).data;
    const fieldLabel = (id: number): string | null => fields.find((f) => f.id === id)?.label ?? null;
    return (
        <ol className="imcrm-mt-2 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-text-xs">
            {config.steps.map((s, i) => (
                <li key={s.id} className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                    {i > 0 && <span className="imcrm-text-muted-foreground" aria-hidden>→</span>}
                    <span className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2 imcrm-py-0.5">
                        <span className="imcrm-font-medium">{stepLabel(s, i)}</span>
                        <span className="imcrm-text-muted-foreground">
                            {' · '}
                            {describeApprover(s.approver, {
                                fieldLabel: s.approver.type === 'field' ? fieldLabel(s.approver.approver_field_id) : null,
                                userNames: names,
                            })}
                            {' · '}
                            {APPROVAL_MODE_LABELS[s.mode]}
                        </span>
                    </span>
                </li>
            ))}
        </ol>
    );
}

// ── Editor ─────────────────────────────────────────────────────────────────

function newStepId(): string {
    return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function blankStep(fields: FieldEntity[]): ApprovalStep {
    const person = fields.find((f) => f.type === 'user');
    return {
        id: newStepId(),
        name: '',
        approver: person ? { type: 'field', approver_field_id: person.id } : { type: 'role', role: 'manager' },
        mode: 'any',
    };
}

/** Campos que el flujo puede poner al resolver: los que se escriben a mano. */
function settableFields(fields: FieldEntity[]): FieldEntity[] {
    return fields.filter((f) => isUserWritableType(f.type as FieldType) && f.type !== 'file' && f.type !== 'relation');
}

function FlowEditor({
    listId,
    fields,
    flow,
    onClose,
}: {
    listId: number;
    fields: FieldEntity[];
    flow: ApprovalFlow | null;
    onClose: () => void;
}): JSX.Element {
    const create = useCreateApprovalFlow(listId);
    const update = useUpdateApprovalFlow(listId);
    const toast = useToast();
    const [name, setName] = useState(flow?.name ?? '');
    const [description, setDescription] = useState(flow?.description ?? '');
    const [isActive, setIsActive] = useState(flow?.is_active ?? true);
    const [config, setConfig] = useState<ApprovalFlowConfig>(
        flow?.config ?? { steps: [blankStep(fields)], on_approve: [], on_reject: [], allow_resubmit: false, self_approval: false },
    );
    const hasStatusColumn = fields.some((f) => f.type === 'approval');
    const [addStatusField, setAddStatusField] = useState(!hasStatusColumn);
    const [serverError, setServerError] = useState<string | null>(null);

    const fieldMap = useMemo(() => new Map(fields.map((f) => [f.id, { type: f.type as string, label: f.label }])), [fields]);
    const problems = [
        ...config.steps.flatMap((s, i) =>
            s.approver.type === 'users' && s.approver.approver_user_ids.length === 0
                ? [sprintf(__('%s: elige al menos una persona.'), stepLabel(s, i))]
                : [],
        ),
        ...approvalFlowConfigProblems(config, fieldMap),
    ];
    const userFields = fields.filter((f) => f.type === 'user');
    const busy = create.isPending || update.isPending;

    const setStep = (i: number, patch: Partial<ApprovalStep>): void =>
        setConfig((c) => ({ ...c, steps: c.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
    const moveStep = (i: number, dir: -1 | 1): void =>
        setConfig((c) => {
            const steps = [...c.steps];
            const j = i + dir;
            if (j < 0 || j >= steps.length) return c;
            [steps[i], steps[j]] = [steps[j]!, steps[i]!];
            return { ...c, steps };
        });

    const save = (): void => {
        setServerError(null);
        if (name.trim() === '') {
            setServerError(__('Ponle un nombre al flujo.'));
            return;
        }
        if (problems.length > 0) return;
        const onError = (err: unknown): void => {
            const msg = err instanceof ApiError ? [err.message, ...Object.values(err.errors)].join(' ') : err instanceof Error ? err.message : '';
            setServerError(msg || __('No se pudo guardar el flujo.'));
        };
        if (flow) {
            update.mutate(
                { id: flow.id, name: name.trim(), description: description.trim(), config, is_active: isActive },
                { onSuccess: () => { toast.success(__('Flujo guardado')); onClose(); }, onError },
            );
        } else {
            create.mutate(
                { name: name.trim(), description: description.trim(), config, is_active: isActive, add_status_field: addStatusField },
                { onSuccess: () => { toast.success(__('Flujo creado')); onClose(); }, onError },
            );
        }
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-5" data-testid="imcrm-approval-flow-editor">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <h3 className="imcrm-text-base imcrm-font-semibold">{flow ? sprintf(__('Editar «%s»'), flow.name) : __('Nuevo flujo de aprobación')}</h3>
                <Button size="sm" variant="ghost" onClick={onClose} aria-label={__('Cerrar')}>
                    <X className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </div>

            <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label htmlFor="imcrm-flow-name">{__('Nombre')}</Label>
                    <Input id="imcrm-flow-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={__('Por ejemplo: Gasto mayor a $1M')} data-testid="imcrm-approval-flow-name" />
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label htmlFor="imcrm-flow-desc">{__('Descripción (opcional)')}</Label>
                    <Input id="imcrm-flow-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder={__('Cuándo se usa')} />
                </div>
            </div>

            <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                    <h4 className="imcrm-text-sm imcrm-font-semibold">{__('Pasos (en orden)')}</h4>
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('El paso 2 empieza cuando se aprueba el 1.')}</span>
                </div>
                <ol className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    {config.steps.map((s, i) => (
                        <StepEditor
                            key={s.id}
                            index={i}
                            step={s}
                            total={config.steps.length}
                            userFields={userFields}
                            onChange={(patch) => setStep(i, patch)}
                            onMove={(dir) => moveStep(i, dir)}
                            onRemove={() => setConfig((c) => ({ ...c, steps: c.steps.filter((_, j) => j !== i) }))}
                        />
                    ))}
                </ol>
                {config.steps.length < APPROVAL_MAX_STEPS && (
                    <Button
                        size="sm"
                        variant="outline"
                        className="imcrm-self-start"
                        onClick={() => setConfig((c) => ({ ...c, steps: [...c.steps, blankStep(fields)] }))}
                        data-testid="imcrm-approval-step-add"
                    >
                        <Plus className="imcrm-mr-1.5 imcrm-h-4 imcrm-w-4" />
                        {__('Agregar un paso')}
                    </Button>
                )}
            </section>

            <div className="imcrm-grid imcrm-gap-4 md:imcrm-grid-cols-2">
                <FieldSetsEditor
                    title={__('Al aprobar, poner')}
                    hint={__('Se escribe en el registro cuando se aprueba el último paso.')}
                    fields={settableFields(fields)}
                    sets={config.on_approve}
                    onChange={(sets) => setConfig((c) => ({ ...c, on_approve: sets }))}
                    testId="imcrm-approval-on-approve"
                />
                <FieldSetsEditor
                    title={__('Al rechazar, poner')}
                    hint={__('Se escribe en el registro cuando alguien rechaza.')}
                    fields={settableFields(fields)}
                    sets={config.on_reject}
                    onChange={(sets) => setConfig((c) => ({ ...c, on_reject: sets }))}
                    testId="imcrm-approval-on-reject"
                />
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-text-sm">
                <label className="imcrm-flex imcrm-items-start imcrm-gap-2">
                    <input type="checkbox" className="imcrm-mt-0.5" checked={config.allow_resubmit} onChange={(e) => setConfig((c) => ({ ...c, allow_resubmit: e.target.checked }))} data-testid="imcrm-approval-allow-resubmit" />
                    <span>
                        {__('Se puede pedir otra vez tras un rechazo')}
                        <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__('Si no, un registro rechazado queda así. «Devolver» siempre permite corregir y pedir de nuevo.')}</span>
                    </span>
                </label>
                <label className="imcrm-flex imcrm-items-start imcrm-gap-2">
                    <input type="checkbox" className="imcrm-mt-0.5" checked={config.self_approval} onChange={(e) => setConfig((c) => ({ ...c, self_approval: e.target.checked }))} />
                    <span>
                        {__('Quien pide puede aprobar su propia solicitud')}
                        <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__('Apagado (recomendado): aunque sea aprobador del paso, no decide sobre lo que pidió.')}</span>
                    </span>
                </label>
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                    {__('Activo (se puede pedir)')}
                </label>
                {!flow && !hasStatusColumn && (
                    <label className="imcrm-flex imcrm-items-start imcrm-gap-2">
                        <input type="checkbox" className="imcrm-mt-0.5" checked={addStatusField} onChange={(e) => setAddStatusField(e.target.checked)} data-testid="imcrm-approval-add-column" />
                        <span>
                            {__('Agregar la columna «Aprobación» a la tabla')}
                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__('Muestra el estado (pendiente, aprobada, rechazada…) y sirve para filtrar y agrupar.')}</span>
                        </span>
                    </label>
                )}
            </div>

            {(problems.length > 0 || serverError) && (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/5 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-destructive" role="alert">
                    {problems.map((p) => <li key={p}>{p}</li>)}
                    {serverError && <li>{serverError}</li>}
                </ul>
            )}

            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                <Button onClick={save} disabled={busy || problems.length > 0} data-testid="imcrm-approval-flow-save">
                    {busy && <Loader2 className="imcrm-mr-1.5 imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                    {flow ? __('Guardar cambios') : __('Crear flujo')}
                </Button>
                <Button variant="ghost" onClick={onClose} disabled={busy}>
                    {__('Cancelar')}
                </Button>
            </div>
            {flow && flow.pending_count > 0 && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Las solicitudes que ya están pendientes siguen con la configuración con la que se pidieron; los cambios valen para las nuevas.')}
                </p>
            )}
        </div>
    );
}

function StepEditor({
    index,
    step,
    total,
    userFields,
    onChange,
    onMove,
    onRemove,
}: {
    index: number;
    step: ApprovalStep;
    total: number;
    userFields: FieldEntity[];
    onChange: (patch: Partial<ApprovalStep>) => void;
    onMove: (dir: -1 | 1) => void;
    onRemove: () => void;
}): JSX.Element {
    const a = step.approver;
    const ids = a.type === 'users' ? a.approver_user_ids : [];
    const names = useMemberNames(ids).data;
    const setType = (type: string): void => {
        let next: Approver;
        if (type === 'users') next = { type: 'users', approver_user_ids: [] as number[] } as unknown as Approver;
        else if (type === 'field') next = { type: 'field', approver_field_id: userFields[0]?.id ?? 0 };
        else next = { type: 'role', role: 'manager' };
        onChange({ approver: next });
    };
    return (
        <li className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3" data-testid="imcrm-approval-step-editor">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <span className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-xs imcrm-font-semibold imcrm-text-primary">
                    {index + 1}
                </span>
                <Input
                    value={step.name}
                    onChange={(e) => onChange({ name: e.target.value.slice(0, 80) })}
                    placeholder={sprintf(__('Paso %d (nombre opcional, p. ej. Jefe directo)'), index + 1)}
                    className="imcrm-h-8"
                    aria-label={sprintf(__('Nombre del paso %d'), index + 1)}
                />
                <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)} aria-label={__('Subir')}>
                    <ArrowUp className="imcrm-h-4 imcrm-w-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={index === total - 1} onClick={() => onMove(1)} aria-label={__('Bajar')}>
                    <ArrowDown className="imcrm-h-4 imcrm-w-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={total === 1} onClick={onRemove} aria-label={__('Quitar el paso')}>
                    <Trash2 className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </div>
            <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs">{__('Quién aprueba')}</Label>
                    <Select value={a.type} onChange={(e) => setType(e.target.value)} data-testid="imcrm-approval-approver-type">
                        <option value="field" disabled={userFields.length === 0}>
                            {userFields.length === 0 ? __('Un campo Persona (la lista no tiene)') : __('Un campo Persona del registro')}
                        </option>
                        <option value="role">{__('Todas las personas con un rol')}</option>
                        <option value="users">{__('Personas puntuales')}</option>
                        {/* `team`: se habilita cuando la empresa tenga equipos. */}
                        {a.type === 'team' && <option value="team">{__('Un equipo')}</option>}
                    </Select>
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs">
                        {a.type === 'field' ? __('Campo') : a.type === 'role' ? __('Rol') : a.type === 'users' ? __('Personas') : __('Equipo')}
                    </Label>
                    {a.type === 'field' && (
                        <Select
                            value={String(a.approver_field_id)}
                            onChange={(e) => onChange({ approver: { type: 'field', approver_field_id: Number(e.target.value) } })}
                            data-testid="imcrm-approval-approver-field"
                        >
                            {userFields.map((f) => (
                                <option key={f.id} value={f.id}>{f.label}</option>
                            ))}
                        </Select>
                    )}
                    {a.type === 'role' && (
                        <Select value={a.role} onChange={(e) => onChange({ approver: { type: 'role', role: e.target.value } })} data-testid="imcrm-approval-approver-role">
                            {APPROVER_ROLES.map((r) => (
                                <option key={r} value={r}>{APPROVER_ROLE_LABELS[r]}</option>
                            ))}
                        </Select>
                    )}
                    {a.type === 'users' && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            {ids.length > 0 && (
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                                    {ids.map((id) => (
                                        <span key={id} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-bg-muted imcrm-px-2 imcrm-py-0.5 imcrm-text-xs">
                                            {names?.get(id) ?? sprintf(__('Persona #%d'), id)}
                                            <button
                                                type="button"
                                                className="imcrm-text-muted-foreground hover:imcrm-text-foreground"
                                                onClick={() => onChange({ approver: { type: 'users', approver_user_ids: ids.filter((x) => x !== id) } as Approver })}
                                                aria-label={__('Quitar')}
                                            >
                                                <X className="imcrm-h-3 imcrm-w-3" />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}
                            <UserPicker
                                value={null}
                                placeholder={__('Agregar una persona…')}
                                onChange={(id) => {
                                    if (id && !ids.includes(id)) onChange({ approver: { type: 'users', approver_user_ids: [...ids, id] } });
                                }}
                            />
                            {ids.length === 0 && <span className="imcrm-text-xs imcrm-text-destructive">{__('Elige al menos una persona.')}</span>}
                        </div>
                    )}
                    {a.type === 'team' && <span className="imcrm-text-xs imcrm-text-muted-foreground">{sprintf(__('Equipo #%d'), a.team_id)}</span>}
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs">{__('Cómo se aprueba')}</Label>
                    <Select value={step.mode} onChange={(e) => onChange({ mode: e.target.value as ApprovalMode })} data-testid="imcrm-approval-mode">
                        <option value="any">{APPROVAL_MODE_LABELS.any}</option>
                        <option value="all">{APPROVAL_MODE_LABELS.all}</option>
                    </Select>
                </div>
            </div>
        </li>
    );
}

function FieldSetsEditor({
    title,
    hint,
    fields,
    sets,
    onChange,
    testId,
}: {
    title: string;
    hint: string;
    fields: FieldEntity[];
    sets: ApprovalFieldSet[];
    onChange: (sets: ApprovalFieldSet[]) => void;
    testId: string;
}): JSX.Element {
    const used = new Set(sets.map((s) => s.field_id));
    const free = fields.filter((f) => !used.has(f.id));
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid={testId}>
            <div>
                <h4 className="imcrm-text-sm imcrm-font-semibold">{title}</h4>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{hint}</p>
            </div>
            {sets.map((s, i) => {
                const field = fields.find((f) => f.id === s.field_id);
                return (
                    <div key={`${s.field_id}-${i}`} className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <Select
                            className="imcrm-w-[42%]"
                            value={String(s.field_id)}
                            onChange={(e) => onChange(sets.map((x, j) => (j === i ? { field_id: Number(e.target.value), value: null } : x)))}
                            aria-label={__('Campo')}
                        >
                            {field === undefined && <option value={s.field_id}>{__('(campo borrado)')}</option>}
                            {fields.filter((f) => f.id === s.field_id || !used.has(f.id)).map((f) => (
                                <option key={f.id} value={f.id}>{f.label}</option>
                            ))}
                        </Select>
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">=</span>
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            {field ? (
                                <FieldSetValue field={field} value={s.value} onChange={(v) => onChange(sets.map((x, j) => (j === i ? { ...x, value: v } : x)))} />
                            ) : null}
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => onChange(sets.filter((_, j) => j !== i))} aria-label={__('Quitar')}>
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Button>
                    </div>
                );
            })}
            {free.length > 0 && sets.length < 20 && (
                <Button
                    size="sm"
                    variant="ghost"
                    className="imcrm-self-start"
                    onClick={() => onChange([...sets, { field_id: (free.find((f) => f.type === 'select') ?? free[0]!).id, value: null }])}
                >
                    <Plus className="imcrm-mr-1.5 imcrm-h-4 imcrm-w-4" />
                    {__('Poner un campo')}
                </Button>
            )}
        </section>
    );
}

/** El valor que el flujo pone en un campo (las mismas formas del registro, simplificadas). */
function FieldSetValue({ field, value, onChange }: { field: FieldEntity; value: unknown; onChange: (v: unknown) => void }): JSX.Element {
    const cls = 'imcrm-h-9';
    switch (field.type) {
        case 'select': {
            const opts = extractFieldOptions(field);
            return (
                <Select className={cls} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)} aria-label={field.label}>
                    <option value="">{__('(vaciar)')}</option>
                    {opts.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </Select>
            );
        }
        case 'multi_select': {
            const opts = extractFieldOptions(field);
            const cur = Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '';
            return (
                <Select className={cls} value={cur} onChange={(e) => onChange(e.target.value === '' ? [] : [e.target.value])} aria-label={field.label}>
                    <option value="">{__('(vaciar)')}</option>
                    {opts.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </Select>
            );
        }
        case 'checkbox':
            return (
                <Select className={cls} value={value === true ? '1' : '0'} onChange={(e) => onChange(e.target.value === '1')} aria-label={field.label}>
                    <option value="1">{__('Sí')}</option>
                    <option value="0">{__('No')}</option>
                </Select>
            );
        case 'user':
            return <UserPicker value={typeof value === 'number' ? value : null} onChange={(id) => onChange(id)} />;
        case 'date':
            return <Input className={cls} type="date" value={typeof value === 'string' ? value.slice(0, 10) : ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)} aria-label={field.label} />;
        case 'number':
        case 'currency':
        case 'percent':
        case 'rating':
        case 'duration':
            return (
                <Input
                    className={cls}
                    type="number"
                    step="any"
                    value={typeof value === 'number' ? String(value) : ''}
                    onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
                    aria-label={field.label}
                />
            );
        default:
            return <Input className={cn(cls)} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)} aria-label={field.label} />;
    }
}
