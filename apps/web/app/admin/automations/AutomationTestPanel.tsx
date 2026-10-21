import { useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, CircleDashed, FlaskConical, Info, Loader2, MinusCircle, Play, Search, X, XCircle } from 'lucide-react';
import type { AutomationTestRunInput, AutomationTestRunResult, AutomationTestStep, ConditionCheck } from '@imagina-base/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Sheet,
    SheetBody,
    SheetCloseButton,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { useAutomationTestRun } from '@/hooks/useAutomations';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRecords } from '@/hooks/useRecords';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTime } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { ActionMeta, ActionSpec, TriggerConfig } from '@/types/automation';
import type { FieldEntity } from '@/types/field';

import { getNode } from './actionsTree';
import { actionMetaFor } from './automationMeta';
import { actionTitle } from './actionTypeOptions';

/**
 * v0.1.289 — «Probar» paso a paso. Corre la automatización TAL COMO SE ESTÁ
 * EDITANDO (sin guardar) contra un registro real, con el MISMO motor que una
 * corrida de verdad pero en modo simulación: dice si el disparador
 * coincidiría (y por qué), resuelve las variables y muestra, paso por paso,
 * el correo que mandaría, la petición que haría, los campos que cambiaría…
 * Nada se envía, se escribe ni se llama, salvo los webhooks/conectores que se
 * marquen para ejecutar de verdad.
 */
export interface AutomationTestPanelProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    listId: number;
    automationId?: number;
    triggerType: string;
    triggerConfig: TriggerConfig;
    actions: ActionSpec[];
    fields: FieldEntity[];
    actionsCatalog: ActionMeta[];
    /** Respuestas reales obtenidas (por ruta): sugieren variables en el editor. */
    onResponses: (responses: Record<string, unknown>) => void;
}

const REAL_TYPES = new Set(['call_webhook', 'connector_action']);

export function AutomationTestPanel(props: AutomationTestPanelProps): JSX.Element {
    const { open, onOpenChange, listId, fields } = props;
    const run = useAutomationTestRun(listId);
    const [recordId, setRecordId] = useState<number | null>(null);
    const [recordLabel, setRecordLabel] = useState<string>('');
    const [real, setReal] = useState<Set<string>>(new Set());
    const [result, setResult] = useState<AutomationTestRunResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const execute = async (realSteps: Set<string> = real): Promise<void> => {
        setError(null);
        try {
            const out = await run.mutateAsync({
                trigger_type: props.triggerType,
                // Mismas formas que el guardado: el servidor las valida igual.
                trigger_config: props.triggerConfig as AutomationTestRunInput['trigger_config'],
                actions: props.actions as AutomationTestRunInput['actions'],
                ...(recordId ? { record_id: recordId } : {}),
                ...(props.automationId ? { automation_id: props.automationId } : {}),
                real_steps: [...realSteps],
            });
            setResult(out);
            if (Object.keys(out.responses ?? {}).length > 0) props.onResponses(out.responses);
        } catch (err) {
            setResult(null);
            setError(err instanceof ApiError || err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="imcrm-w-full sm:imcrm-w-[560px]" data-testid="imcrm-test-panel">
                <SheetHeader>
                    <div>
                        <SheetTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <FlaskConical className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" />
                            {__('Probar paso a paso')}
                        </SheetTitle>
                        <SheetDescription>
                            {__('Corre la automatización como está ahora (aunque no la hayas guardado) con un registro real. No se envía, no se escribe ni se llama nada, salvo los pasos que marques para ejecutar de verdad.')}
                        </SheetDescription>
                    </div>
                    <SheetCloseButton aria-label={__('Cerrar')} />
                </SheetHeader>
                <SheetBody className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                    <RecordChooser
                        listId={listId}
                        fields={fields}
                        recordId={recordId}
                        label={recordLabel}
                        onPick={(id, label) => {
                            setRecordId(id);
                            setRecordLabel(label);
                        }}
                    />
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <Button onClick={() => void execute()} disabled={run.isPending} className="imcrm-gap-1.5" data-testid="imcrm-test-run">
                            {run.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Play className="imcrm-h-4 imcrm-w-4" />}
                            {result ? __('Probar de nuevo') : __('Probar')}
                        </Button>
                        {real.size > 0 && (
                            <span className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">
                                {sprintf(__('%d paso(s) se ejecutarán de verdad.'), real.size)}
                            </span>
                        )}
                    </div>

                    {error && (
                        <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive" role="alert">
                            {error}
                        </div>
                    )}

                    {result && (
                        <TestResult
                            result={result}
                            actions={props.actions}
                            catalog={props.actionsCatalog}
                            real={real}
                            onToggleReal={(path, on) => {
                                const next = new Set(real);
                                if (on) next.add(path);
                                else next.delete(path);
                                setReal(next);
                            }}
                            onRunReal={(path) => {
                                const next = new Set(real);
                                next.add(path);
                                setReal(next);
                                void execute(next);
                            }}
                            busy={run.isPending}
                        />
                    )}
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}

function RecordChooser({
    listId,
    fields,
    recordId,
    label,
    onPick,
}: {
    listId: number;
    fields: FieldEntity[];
    recordId: number | null;
    label: string;
    onPick: (id: number | null, label: string) => void;
}): JSX.Element {
    const [term, setTerm] = useState('');
    const [open, setOpen] = useState(false);
    const debounced = useDebouncedValue(term, 200);
    const primary = useMemo(() => fields.find((f) => f.is_primary) ?? fields.find((f) => f.type === 'text'), [fields]);
    const records = useRecords(open ? listId : undefined, {
        per_page: 8,
        ...(debounced.trim() !== '' ? { search: debounced.trim() } : {}),
    });
    const titleOf = (data: Record<string, unknown>, id: number): string => {
        const v = primary ? data[primary.slug] : undefined;
        return typeof v === 'string' && v.trim() !== '' ? v : sprintf(__('Registro #%d'), id);
    };
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="imcrm-test-record">
            <span className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{__('Registro de prueba')}</span>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-3 imcrm-py-2 imcrm-text-sm">
                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">
                    {recordId ? `${label} · #${recordId}` : __('El último registro de la lista')}
                </span>
                {recordId && (
                    <button type="button" className="imcrm-text-muted-foreground hover:imcrm-text-foreground" onClick={() => onPick(null, '')} aria-label={__('Usar el último')}>
                        <X className="imcrm-h-3.5 imcrm-w-3.5" />
                    </button>
                )}
                <Button type="button" variant="ghost" size="sm" className="imcrm-h-7 imcrm-gap-1" onClick={() => setOpen((v) => !v)} data-testid="imcrm-test-record-change">
                    <Search className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Elegir otro')}
                </Button>
            </div>
            {open && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2">
                    <Input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder={__('Buscar un registro…')} className="imcrm-h-8" data-testid="imcrm-test-record-search" />
                    <div className="imcrm-flex imcrm-max-h-48 imcrm-flex-col imcrm-overflow-y-auto">
                        {(records.data?.data ?? []).map((r) => (
                            <button
                                key={r.id}
                                type="button"
                                className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent/60"
                                onClick={() => {
                                    onPick(r.id, titleOf(r.fields, r.id));
                                    setOpen(false);
                                    setTerm('');
                                }}
                            >
                                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{titleOf(r.fields, r.id)}</span>
                                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">#{r.id}</span>
                            </button>
                        ))}
                        {records.isFetched && (records.data?.data ?? []).length === 0 && (
                            <p className="imcrm-px-2 imcrm-py-3 imcrm-text-xs imcrm-text-muted-foreground">{__('No hay registros que coincidan.')}</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function TestResult({
    result,
    actions,
    catalog,
    real,
    onToggleReal,
    onRunReal,
    busy,
}: {
    result: AutomationTestRunResult;
    actions: ActionSpec[];
    catalog: ActionMeta[];
    real: Set<string>;
    onToggleReal: (path: string, on: boolean) => void;
    onRunReal: (path: string) => void;
    busy: boolean;
}): JSX.Element {
    const t = result.trigger;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-test-result">
            {result.record && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {sprintf(__('Con el registro «%1$s» (#%2$d).'), result.record.title, result.record.id)}
                </p>
            )}
            <section
                className={cn(
                    'imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-p-3',
                    t.matches ? 'imcrm-border-success/30 imcrm-bg-success/5' : 'imcrm-border-warning/40 imcrm-bg-warning/5',
                )}
                data-testid="imcrm-test-trigger"
                data-matches={t.matches ? 'true' : 'false'}
            >
                <div className="imcrm-flex imcrm-items-start imcrm-gap-2">
                    {t.matches ? <CheckCircle2 className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-success" /> : <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-warning" />}
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                        <span className="imcrm-text-sm imcrm-font-medium">{t.matches ? __('El disparador coincidiría') : __('El disparador NO coincidiría')}</span>
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">{t.message}</span>
                    </div>
                </div>
                {t.checks.length > 0 && <ChecksTable checks={t.checks} />}
                {t.notes.map((n) => (
                    <p key={n} className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                        <Info className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0" />
                        {n}
                    </p>
                ))}
            </section>

            {result.steps.length === 0 ? (
                <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('No hay pasos para simular.')}</p>
            ) : (
                <ol className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    {result.steps.map((step, i) => (
                        <StepResult
                            key={`${step.path}:${i}`}
                            step={step}
                            spec={step.path ? getNode(actions, step.path.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : (p as 'then' | 'else' | 'each')))) : undefined}
                            catalog={catalog}
                            real={real.has(step.path)}
                            onToggleReal={(on) => onToggleReal(step.path, on)}
                            onRunReal={() => onRunReal(step.path)}
                            busy={busy}
                        />
                    ))}
                </ol>
            )}
        </div>
    );
}

const STATUS_LABEL: Record<string, string> = {
    would_run: 'Se ejecutaría',
    ran: 'Se ejecutó de verdad',
    skipped: 'Se omitiría',
    failed: 'Fallaría',
    info: 'Información',
};

function StepStatusBadge({ status }: { status: AutomationTestStep['status'] }): JSX.Element {
    const variant = status === 'ran' ? 'success' : status === 'failed' ? 'destructive' : status === 'skipped' ? 'outline' : status === 'info' ? 'info' : 'default';
    return (
        <Badge variant={variant} className="imcrm-shrink-0">
            {__(STATUS_LABEL[status] ?? status)}
        </Badge>
    );
}

function StatusIcon({ status }: { status: AutomationTestStep['status'] }): JSX.Element {
    if (status === 'failed') return <XCircle className="imcrm-h-4 imcrm-w-4 imcrm-text-destructive" />;
    if (status === 'skipped') return <MinusCircle className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />;
    if (status === 'ran') return <CheckCircle2 className="imcrm-h-4 imcrm-w-4 imcrm-text-success" />;
    if (status === 'info') return <Info className="imcrm-h-4 imcrm-w-4 imcrm-text-info" />;
    return <CircleDashed className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" />;
}

function StepResult({
    step,
    spec,
    catalog,
    real,
    onToggleReal,
    onRunReal,
    busy,
}: {
    step: AutomationTestStep;
    spec: ActionSpec | undefined;
    catalog: ActionMeta[];
    real: boolean;
    onToggleReal: (on: boolean) => void;
    onRunReal: () => void;
    busy: boolean;
}): JSX.Element {
    const meta = actionMetaFor(step.action);
    const title = spec ? actionTitle(spec, catalog, __(meta.title)) : step.action === 'engine' ? __('Motor') : __(meta.title);
    const d = step.details as Record<string, unknown>;
    const canBeReal = REAL_TYPES.has(step.action) && (step.status === 'would_run' || step.status === 'ran' || real);
    return (
        <li
            className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3"
            style={{ marginLeft: `${Math.min(step.depth, 4) * 14}px` }}
            data-testid="imcrm-test-step"
            data-action={step.action}
            data-status={step.status}
        >
            <div className="imcrm-flex imcrm-items-start imcrm-gap-2">
                <span className="imcrm-mt-0.5">
                    <StatusIcon status={step.status} />
                </span>
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-0.5">
                    <span className="imcrm-text-sm imcrm-font-medium">{title}</span>
                    <span className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-test-step-message">{step.message}</span>
                </div>
                <StepStatusBadge status={step.status} />
            </div>

            {Array.isArray(d.checks) && (d.checks as ConditionCheck[]).length > 0 && <ChecksTable checks={d.checks as ConditionCheck[]} />}
            {typeof d.branch === 'string' && (
                <p className="imcrm-text-xs">
                    {d.branch === 'then' ? __('Sigue por la rama «Sí».') : __('Sigue por la rama «No».')}
                </p>
            )}
            {d.email !== undefined && <EmailPreview email={d.email as EmailDetails} />}
            {d.request !== undefined && <RequestPreview request={d.request as RequestDetails} response={d.response as ResponseDetails | undefined} />}
            {Array.isArray(d.changes) && <ChangesList changes={d.changes as Array<{ label: string; before: unknown; after: unknown }>} />}
            {Array.isArray(d.values) && <ValuesList values={d.values as Array<{ label: string; value: unknown }>} title={typeof d.list === 'string' ? sprintf(__('Valores del registro nuevo en «%s»'), d.list) : __('Valores del registro nuevo')} />}
            {typeof d.resume_at === 'string' && (
                <p className="imcrm-text-xs">
                    {sprintf(__('Seguiría el %s.'), formatDateTime(new Date(d.resume_at)))}
                    {typeof d.resume_condition_now === 'boolean' && (
                        <span className="imcrm-text-muted-foreground">
                            {' '}
                            {d.resume_condition_now
                                ? __('Hoy el registro cumple la condición para continuar.')
                                : __('Hoy el registro NO cumple la condición para continuar: si sigue así, terminaría ahí.')}
                        </span>
                    )}
                </p>
            )}
            {typeof d.count === 'number' && step.action === 'bulk_edit' && (
                <p className="imcrm-text-xs">{sprintf(__('Cambiaría %d registro(s).'), d.count)}</p>
            )}
            {Array.isArray(d.warnings) && (d.warnings as unknown[]).length > 0 && (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-rounded imcrm-bg-warning/10 imcrm-px-2 imcrm-py-1 imcrm-text-[11px] imcrm-text-[hsl(var(--imcrm-warning-ink))]">
                    {(d.warnings as unknown[]).map((w, i) => (
                        <li key={i}>{String(w)}</li>
                    ))}
                </ul>
            )}

            {canBeReal && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-2">
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs">
                        <input type="checkbox" checked={real} onChange={(e) => onToggleReal(e.target.checked)} data-testid="imcrm-test-real-toggle" />
                        {__('Ejecutar este paso de verdad')}
                    </label>
                    {!real && step.status === 'would_run' && (
                        <Button type="button" size="sm" variant="outline" className="imcrm-h-7 imcrm-gap-1" disabled={busy} onClick={onRunReal} data-testid="imcrm-test-run-real">
                            <Play className="imcrm-h-3 imcrm-w-3" />
                            {__('Ejecutarlo ahora')}
                        </Button>
                    )}
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Hace la llamada real para ver qué responde (los pasos siguientes la usan).')}</span>
                </div>
            )}
        </li>
    );
}

const OP_LABELS: Record<string, string> = {
    eq: '=',
    equals: '=',
    neq: '≠',
    not_equals: '≠',
    gt: '>',
    gte: '≥',
    lt: '<',
    lte: '≤',
    contains: 'contiene',
    not_contains: 'no contiene',
    starts_with: 'empieza con',
    ends_with: 'termina con',
    in: 'es alguno de',
    not_in: 'no es ninguno de',
    is_null: 'está vacío',
    is_empty: 'está vacío',
    is_not_null: 'no está vacío',
    is_not_empty: 'no está vacío',
    between_relative: 'está en',
    changed: 'cambió',
};

function showValue(v: unknown): string {
    if (v === null || v === undefined || v === '') return __('(vacío)');
    if (Array.isArray(v)) return v.length === 0 ? __('(vacío)') : v.map(showValue).join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    if (typeof v === 'boolean') return v ? __('Sí') : __('No');
    return String(v);
}

function ChecksTable({ checks }: { checks: ConditionCheck[] }): JSX.Element {
    return (
        <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid="imcrm-test-checks">
            {checks.map((c, i) => (
                <li key={i} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-text-xs">
                    {c.ok ? <Check className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-success" /> : <X className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-destructive" />}
                    <span className="imcrm-font-medium">{c.label}</span>
                    <span className="imcrm-text-muted-foreground">{__(OP_LABELS[c.op] ?? c.op)}</span>
                    {!['is_null', 'is_empty', 'is_not_null', 'is_not_empty', 'changed'].includes(c.op) && <span>{showValue(c.expected)}</span>}
                    <span className="imcrm-text-muted-foreground">· {sprintf(__('tiene: %s'), showValue(c.actual))}</span>
                </li>
            ))}
        </ul>
    );
}

interface EmailDetails {
    to: string;
    cc: string | null;
    bcc: string | null;
    subject: string;
    html: string | null;
    text: string | null;
    attachments: string[];
    signature_note: string | null;
}

function EmailPreview({ email }: { email: EmailDetails }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2" data-testid="imcrm-test-email">
            <dl className="imcrm-grid imcrm-grid-cols-[auto,1fr] imcrm-gap-x-2 imcrm-gap-y-0.5 imcrm-text-xs">
                <dt className="imcrm-text-muted-foreground">{__('Para')}</dt>
                <dd className="imcrm-break-all">{email.to}</dd>
                {email.cc && (
                    <>
                        <dt className="imcrm-text-muted-foreground">Cc</dt>
                        <dd className="imcrm-break-all">{email.cc}</dd>
                    </>
                )}
                {email.bcc && (
                    <>
                        <dt className="imcrm-text-muted-foreground">Cco</dt>
                        <dd className="imcrm-break-all">{email.bcc}</dd>
                    </>
                )}
                <dt className="imcrm-text-muted-foreground">{__('Asunto')}</dt>
                <dd className="imcrm-font-medium" data-testid="imcrm-test-email-subject">{email.subject}</dd>
                {email.attachments.length > 0 && (
                    <>
                        <dt className="imcrm-text-muted-foreground">{__('Adjuntos')}</dt>
                        <dd>{email.attachments.join(', ')}</dd>
                    </>
                )}
            </dl>
            {email.html ? (
                <iframe
                    title={__('Vista previa del correo')}
                    sandbox=""
                    srcDoc={email.html}
                    className="imcrm-h-72 imcrm-w-full imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-white"
                    data-testid="imcrm-test-email-html"
                />
            ) : (
                <pre className="imcrm-max-h-60 imcrm-overflow-auto imcrm-whitespace-pre-wrap imcrm-rounded imcrm-bg-muted/50 imcrm-p-2 imcrm-text-xs" data-testid="imcrm-test-email-text">
                    {email.text ?? ''}
                </pre>
            )}
            {email.signature_note && <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{email.signature_note}</p>}
        </div>
    );
}

interface RequestDetails {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string | null;
}

interface ResponseDetails {
    status: number;
    body: string;
}

function RequestPreview({ request, response }: { request: RequestDetails; response?: ResponseDetails }): JSX.Element {
    const headers = Object.entries(request.headers ?? {});
    const good = response ? response.status >= 200 && response.status < 300 : false;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2" data-testid="imcrm-test-request">
            <span className="imcrm-break-all imcrm-font-mono imcrm-text-[11px]">
                {request.method} {request.url}
            </span>
            {headers.length > 0 && (
                <pre className="imcrm-max-h-24 imcrm-overflow-auto imcrm-rounded imcrm-bg-muted/50 imcrm-p-2 imcrm-font-mono imcrm-text-[11px]">
                    {headers.map(([k, v]) => `${k}: ${v}`).join('\n')}
                </pre>
            )}
            {request.body !== null && request.body !== undefined && request.body !== '' && (
                <>
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Se enviaría')}</span>
                    <pre className="imcrm-max-h-40 imcrm-overflow-auto imcrm-whitespace-pre-wrap imcrm-break-all imcrm-rounded imcrm-bg-muted/50 imcrm-p-2 imcrm-font-mono imcrm-text-[11px]">{request.body}</pre>
                </>
            )}
            {response && (
                <>
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Respondió')}
                        <Badge variant={good ? 'success' : 'warning'}>HTTP {response.status}</Badge>
                    </span>
                    <pre className="imcrm-max-h-40 imcrm-overflow-auto imcrm-whitespace-pre-wrap imcrm-break-all imcrm-rounded imcrm-bg-muted/50 imcrm-p-2 imcrm-font-mono imcrm-text-[11px]" data-testid="imcrm-test-response">
                        {response.body}
                    </pre>
                </>
            )}
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Los secretos (claves, tokens, contraseñas) se muestran tapados.')}</p>
        </div>
    );
}

function ChangesList({ changes }: { changes: Array<{ label: string; before: unknown; after: unknown }> }): JSX.Element {
    if (changes.length === 0) return <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('No cambiaría ningún campo.')}</p>;
    return (
        <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-text-xs" data-testid="imcrm-test-changes">
            {changes.map((c, i) => (
                <li key={i}>
                    <span className="imcrm-font-medium">{c.label}:</span> <span className="imcrm-text-muted-foreground imcrm-line-through">{showValue(c.before)}</span> → <span>{showValue(c.after)}</span>
                </li>
            ))}
        </ul>
    );
}

function ValuesList({ values, title }: { values: Array<{ label: string; value: unknown }>; title: string }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-text-xs" data-testid="imcrm-test-values">
            <span className="imcrm-text-muted-foreground">{title}</span>
            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                {values.map((v, i) => (
                    <li key={i}>
                        <span className="imcrm-font-medium">{v.label}:</span> {showValue(v.value)}
                    </li>
                ))}
            </ul>
        </div>
    );
}
