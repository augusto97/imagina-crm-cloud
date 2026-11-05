import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CloudDownload, ExternalLink, LayoutDashboard, Link2, ListPlus, Loader2, X } from 'lucide-react';
import {
    DEFAULT_IMPORT_LIST_NAME,
    MP_PREAPPROVAL_STATUSES,
    MP_PREAPPROVAL_STATUS_LABELS,
    readMirrorListMarker,
    type MpPreapprovalStatus,
    type SubscriptionImportAction,
    type SubscriptionImportInput,
    type SubscriptionImportPreview,
    type SubscriptionImportStatus,
} from '@imagina-base/shared';

import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { dashboardsKeys } from '@/hooks/useDashboards';
import { useFields } from '@/hooks/useFields';
import { listsKeys, useLists } from '@/hooks/useLists';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

import { formatMoney } from '../payments/paymentUi';
import { ModeCard } from './SubscriptionChargeLogEditor';
import { frequencyText } from './subscriptionText';

/** Una suscripción de Mercado Pago, en singular. */
const MP_STATUS_ONE: Record<MpPreapprovalStatus, string> = {
    authorized: 'Activa',
    paused: 'Pausada',
    pending: 'Por autorizar',
    cancelled: 'Cancelada',
};

const ACTION_LABEL: Record<SubscriptionImportAction, string> = {
    create_record: 'Se crea su registro',
    link: 'Se vincula',
    no_record: 'Sin registro',
    known: 'Ya está en la app',
    skip: 'No se trae',
};

const statusKey = (connectionId: number) => ['subscription-import', connectionId];

/**
 * v0.1.376 (ADR-S96) — «Importar desde Mercado Pago»: la tarjeta en Cobros de
 * la conexión. Antes de importar ofrece traer lo que ya está en Mercado Pago;
 * después dice adónde llegaron y si las nuevas llegan solas.
 */
export function SubscriptionImportCard({ connectionId }: { connectionId: number }): JSX.Element {
    const qc = useQueryClient();
    const toast = useToast();
    const canImport = useCan(CAP.MANAGE_LISTS);
    const q = useQuery({
        queryKey: statusKey(connectionId),
        queryFn: () => api.subscriptionImportStatus(connectionId),
        retry: false,
        refetchInterval: (query) => (query.state.data?.state === 'running' ? 1500 : false),
    });
    const [open, setOpen] = useState(false);
    // Optimista: la casilla se mueve al tocarla (no espera la respuesta del servidor).
    const [autoLocal, setAutoLocal] = useState<boolean | null>(null);
    const auto = useMutation({
        mutationFn: (value: boolean) => api.setSubscriptionImportAuto(connectionId, value),
        onSuccess: (s) => {
            qc.setQueryData(statusKey(connectionId), s);
            setAutoLocal(null);
            toast.success(s.config?.auto ? __('Las nuevas llegan solas') : __('Las nuevas ya no llegan solas'));
        },
        onError: (err) => {
            setAutoLocal(null);
            toast.error(__('No se pudo guardar'), err instanceof Error ? err.message : String(err));
        },
    });
    const s = q.data;
    const cfg = s?.config ?? null;
    return (
        <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-subscription-import-card" data-tour="collections-subscriptions-import">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-gap-3">
                <span className="imcrm-mt-0.5 imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-sky-500/10 imcrm-text-sky-600 dark:imcrm-text-sky-400">
                    <CloudDownload className="imcrm-h-4 imcrm-w-4" />
                </span>
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <h3 className="imcrm-text-sm imcrm-font-semibold">{__('Suscripciones que ya tienes en Mercado Pago')}</h3>
                    {cfg ? (
                        <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground" data-testid="imcrm-subscription-import-summary">
                            {s?.list_name
                                ? sprintf(__('Se importaron a «%s».'), s.list_name)
                                : __('Ya se importaron.')}{' '}
                            {(autoLocal ?? cfg.auto)
                                ? __('Las que se creen después en Mercado Pago llegan solas (por los avisos y una revisión cada 30 minutos).')
                                : __('Las nuevas que se creen en Mercado Pago no se traen solas.')}
                            {s && s.auto_imported > 0 ? ` ${sprintf(__('Llegaron solas: %d.'), s.auto_imported)}` : ''}
                        </p>
                    ) : (
                        <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                            {__('Trae a la app las suscripciones y los planes que creaste en el panel de Mercado Pago (o en otra herramienta): quedan en una lista, con su estado, sus cobros y todo lo que hacen las suscripciones creadas aquí.')}
                        </p>
                    )}
                    {s?.state === 'running' && (
                        <ImportProgress status={s} />
                    )}
                    {s?.state === 'failed' && s.error && (
                        <p className="imcrm-mt-2 imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-subscription-import-error">
                            {s.error}
                        </p>
                    )}
                </div>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    {cfg?.list_id && s?.list_slug && (
                        <Button size="sm" variant="outline" asChild>
                            <Link to={`/lists/${s.list_slug}`} data-testid="imcrm-subscription-import-open-list">
                                <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Ver la lista')}
                            </Link>
                        </Button>
                    )}
                    <Button
                        size="sm"
                        variant={cfg ? 'outline' : 'default'}
                        disabled={!canImport || s?.state === 'running'}
                        title={canImport ? undefined : __('Importar lo hace quien puede crear listas.')}
                        onClick={() => setOpen(true)}
                        data-testid="imcrm-subscription-import-open"
                    >
                        <CloudDownload className="imcrm-h-3.5 imcrm-w-3.5" />
                        {cfg ? __('Importar otra vez') : __('Importar desde Mercado Pago')}
                    </Button>
                </div>
            </div>
            {cfg && (
                <label className="imcrm-mt-3 imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3 imcrm-text-sm">
                    <input
                        type="checkbox"
                        className="imcrm-mt-0.5"
                        checked={autoLocal ?? cfg.auto}
                        disabled={!canImport}
                        onChange={(e) => {
                            const v = e.currentTarget.checked;
                            setAutoLocal(v);
                            auto.mutate(v);
                        }}
                        data-testid="imcrm-subscription-import-auto"
                    />
                    <span>
                        {__('Traer solas las suscripciones nuevas de Mercado Pago')}
                        <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Cuando alguien se suscribe en el panel de Mercado Pago (o con un link de un plan de allá), aparece en la lista con su registro. Las que se crean desde la app siempre están.')}
                        </span>
                    </span>
                </label>
            )}
            {open && <SubscriptionImportDialog connectionId={connectionId} onClose={() => setOpen(false)} />}
        </section>
    );
}

function ImportProgress({ status }: { status: SubscriptionImportStatus }): JSX.Element {
    const pct = status.total > 0 ? Math.round((status.done / status.total) * 100) : 0;
    return (
        <div className="imcrm-mt-2" data-testid="imcrm-subscription-import-progress">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                {status.total > 0 ? sprintf(__('Trayendo %1$d de %2$d…'), status.done, status.total) : __('Leyendo Mercado Pago…')}
            </div>
            <div className="imcrm-mt-1 imcrm-h-1.5 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="imcrm-h-full imcrm-rounded-full imcrm-bg-primary imcrm-transition-all" style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

type Step = 'choose' | 'preview' | 'running';

function SubscriptionImportDialog({ connectionId, onClose }: { connectionId: number; onClose: () => void }): JSX.Element {
    const qc = useQueryClient();
    const toast = useToast();
    const lists = useLists();
    const [step, setStep] = useState<Step>('choose');
    const [mode, setMode] = useState<'create' | 'match'>('create');
    const [listName, setListName] = useState('');
    const [listId, setListId] = useState<number | null>(null);
    const [emailFieldId, setEmailFieldId] = useState<number | null>(null);
    const [createMissing, setCreateMissing] = useState(true);
    const [includeCancelled, setIncludeCancelled] = useState(false);
    const [chargeLog, setChargeLog] = useState(true);
    const [dashboard, setDashboard] = useState(true);
    const [auto, setAuto] = useState(true);
    const [preview, setPreview] = useState<SubscriptionImportPreview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fields = useFields(listId ?? undefined);

    const listOptions = useMemo(
        () => (lists.data ?? []).filter((l) => !readMirrorListMarker(l.settings)).sort((a, b) => a.name.localeCompare(b.name)),
        [lists.data],
    );
    const emailOptions = useMemo(() => (fields.data ?? []).filter((f) => f.type === 'email' || f.type === 'text'), [fields.data]);
    // Al elegir la lista se propone la columna de correo.
    useEffect(() => {
        if (!listId || !fields.data) return;
        if (emailFieldId && emailOptions.some((f) => f.id === emailFieldId)) return;
        setEmailFieldId(emailOptions.find((f) => f.type === 'email')?.id ?? null);
    }, [listId, fields.data, emailOptions, emailFieldId]);

    const input: SubscriptionImportInput = {
        mode,
        list_id: mode === 'match' ? listId : null,
        email_field_id: mode === 'match' ? emailFieldId : null,
        create_missing: createMissing,
        include_cancelled: includeCancelled,
        list_name: mode === 'create' ? listName.trim() || null : null,
        charge_log: chargeLog,
        dashboard: chargeLog && dashboard,
        auto,
    };
    const canPreview = mode === 'create' || (listId !== null && emailFieldId !== null);

    const look = useMutation({
        mutationFn: () => api.subscriptionImportPreview(connectionId, input),
        onSuccess: (p) => {
            setPreview(p);
            setError(null);
            setStep('preview');
        },
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
    });
    const start = useMutation({
        mutationFn: () => api.startSubscriptionImport(connectionId, input),
        onSuccess: (s) => {
            qc.setQueryData(statusKey(connectionId), s);
            setStep('running');
        },
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
    });
    const status = useQuery({
        queryKey: statusKey(connectionId),
        queryFn: () => api.subscriptionImportStatus(connectionId),
        enabled: step === 'running',
        refetchInterval: (query) => (query.state.data?.state === 'running' ? 1200 : false),
    });
    const finished = step === 'running' && status.data && status.data.state !== 'running';
    useEffect(() => {
        if (!finished) return;
        void qc.invalidateQueries({ queryKey: ['subscriptions-overview'] });
        void qc.invalidateQueries({ queryKey: ['subscription-plans'] });
        void qc.invalidateQueries({ queryKey: listsKeys.all });
        void qc.invalidateQueries({ queryKey: dashboardsKeys.all });
    }, [finished, qc]);

    return (
        <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-max-h-[92dvh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-2xl imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg sm:imcrm-p-6"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="imcrm-subscription-import-dialog"
                >
                    <div className="imcrm-mb-4 imcrm-flex imcrm-items-start imcrm-gap-3">
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Importar desde Mercado Pago')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {step === 'choose'
                                    ? __('Primero eliges adónde llegan; después ves qué se trae antes de importar. No se cambia nada en Mercado Pago.')
                                    : step === 'preview'
                                      ? __('Esto es lo que se trae. Todavía no se importó nada.')
                                      : __('Importando: puedes cerrar esta ventana, sigue sola.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent" aria-label={__('Cerrar')}>
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Dialog.Close>
                    </div>
                    <StepDots step={step} />

                    {step === 'choose' && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                            <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2">
                                <ModeCard
                                    active={mode === 'create'}
                                    icon={<ListPlus className="imcrm-h-4 imcrm-w-4" />}
                                    title={__('A una lista nueva (recomendado)')}
                                    text={__('«Suscriptores · Mercado Pago»: un registro por suscripción, con el estado, el plan, el valor y los cobros en sus columnas.')}
                                    onClick={() => setMode('create')}
                                    testId="imcrm-subscription-import-mode-create"
                                />
                                <ModeCard
                                    active={mode === 'match'}
                                    icon={<Link2 className="imcrm-h-4 imcrm-w-4" />}
                                    title={__('A mis clientes de una lista')}
                                    text={__('Cada suscripción se vincula al registro cuyo correo coincide con el de quien paga.')}
                                    onClick={() => setMode('match')}
                                    testId="imcrm-subscription-import-mode-match"
                                />
                            </div>

                            {mode === 'create' ? (
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                    <Label htmlFor="sub-import-name">{__('Nombre de la lista')}</Label>
                                    <Input id="sub-import-name" value={listName} onChange={(e) => setListName(e.target.value)} placeholder={DEFAULT_IMPORT_LIST_NAME} maxLength={120} data-testid="imcrm-subscription-import-name" />
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Es una lista normal: le puedes cambiar el nombre, agregar columnas o notas, y usarla en tableros y automatizaciones.')}</p>
                                </div>
                            ) : (
                                <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                        <Label htmlFor="sub-import-list">{__('Lista de clientes')}</Label>
                                        <Select
                                            id="sub-import-list"
                                            value={listId ?? ''}
                                            onChange={(e) => {
                                                setListId(e.target.value ? Number(e.target.value) : null);
                                                setEmailFieldId(null);
                                            }}
                                            data-testid="imcrm-subscription-import-list"
                                        >
                                            <option value="">{__('Elige una lista…')}</option>
                                            {listOptions.map((l) => (
                                                <option key={l.id} value={l.id}>
                                                    {l.name}
                                                </option>
                                            ))}
                                        </Select>
                                    </div>
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                        <Label htmlFor="sub-import-email">{__('Columna del correo')}</Label>
                                        <Select
                                            id="sub-import-email"
                                            value={emailFieldId ?? ''}
                                            disabled={!listId}
                                            onChange={(e) => setEmailFieldId(e.target.value ? Number(e.target.value) : null)}
                                            data-testid="imcrm-subscription-import-email"
                                        >
                                            <option value="">{listId ? __('Elige la columna…') : __('Primero elige la lista')}</option>
                                            {emailOptions.map((f) => (
                                                <option key={f.id} value={f.id}>
                                                    {f.label}
                                                </option>
                                            ))}
                                        </Select>
                                    </div>
                                    <Check
                                        checked={createMissing}
                                        onChange={setCreateMissing}
                                        title={__('Crear el cliente que no está en la lista')}
                                        hint={__('Si el correo no coincide con ningún registro, se crea uno con ese correo. Apagado, la suscripción queda sin registro (se ve en Cobros).')}
                                        testId="imcrm-subscription-import-create-missing"
                                        className="sm:imcrm-col-span-2"
                                    />
                                </div>
                            )}

                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-3">
                                <Check
                                    checked={chargeLog}
                                    onChange={setChargeLog}
                                    title={__('Guardar cada cobro como un registro')}
                                    hint={__('En la lista «Cobros de suscripciones», vinculado a su suscriptor: lo pagado y lo rechazado, mes a mes.')}
                                    testId="imcrm-subscription-import-charge-log"
                                />
                                {chargeLog && (
                                    <Check
                                        checked={dashboard}
                                        onChange={setDashboard}
                                        title={__('Crear también su tablero')}
                                        hint={__('Lo cobrado este mes, los rechazos y lo cobrado por plan.')}
                                        testId="imcrm-subscription-import-dashboard"
                                        className="imcrm-ml-6"
                                    />
                                )}
                                <Check
                                    checked={includeCancelled}
                                    onChange={setIncludeCancelled}
                                    title={__('Traer también las canceladas')}
                                    hint={__('Para tener el historial completo. Apagado, sólo se traen las activas, pausadas y por autorizar.')}
                                    testId="imcrm-subscription-import-cancelled"
                                />
                                <Check
                                    checked={auto}
                                    onChange={setAuto}
                                    title={__('Traer solas las suscripciones nuevas')}
                                    hint={__('Las que se creen después en Mercado Pago llegan solas a la misma lista.')}
                                    testId="imcrm-subscription-import-auto-check"
                                />
                            </div>
                            {error && <p className="imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-subscription-import-dialog-error">{error}</p>}
                            <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                                <Button variant="ghost" onClick={onClose}>
                                    {__('Cancelar')}
                                </Button>
                                <Button disabled={!canPreview || look.isPending} onClick={() => look.mutate()} data-testid="imcrm-subscription-import-preview">
                                    {look.isPending && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                                    {look.isPending ? __('Leyendo Mercado Pago…') : __('Ver qué se trae')}
                                </Button>
                            </div>
                        </div>
                    )}

                    {step === 'preview' && preview && (
                        <PreviewStep
                            preview={preview}
                            mode={mode}
                            error={error}
                            starting={start.isPending}
                            onBack={() => {
                                setStep('choose');
                                setError(null);
                            }}
                            onImport={() => start.mutate()}
                        />
                    )}

                    {step === 'running' && (
                        <RunningStep status={status.data ?? null} onClose={onClose} onFinishedToast={(s) => toast.success(__('Importación lista'), sprintf(__('%d suscripciones importadas.'), s.imported))} />
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function StepDots({ step }: { step: Step }): JSX.Element {
    const steps: Array<{ id: Step; label: string }> = [
        { id: 'choose', label: __('Adónde llegan') },
        { id: 'preview', label: __('Qué se trae') },
        { id: 'running', label: __('Importar') },
    ];
    const at = steps.findIndex((s) => s.id === step);
    return (
        <ol className="imcrm-mb-4 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs" aria-label={__('Pasos')}>
            {steps.map((s, i) => (
                <li key={s.id} className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <span
                        className={cn(
                            'imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-text-[11px] imcrm-font-semibold',
                            i < at ? 'imcrm-bg-primary imcrm-text-primary-foreground' : i === at ? 'imcrm-bg-primary/15 imcrm-text-primary imcrm-ring-1 imcrm-ring-primary' : 'imcrm-bg-muted imcrm-text-muted-foreground',
                        )}
                        aria-current={i === at ? 'step' : undefined}
                    >
                        {i + 1}
                    </span>
                    <span className={cn(i === at ? 'imcrm-font-medium imcrm-text-foreground' : 'imcrm-text-muted-foreground')}>{s.label}</span>
                    {i < steps.length - 1 && <span className="imcrm-h-px imcrm-w-4 imcrm-bg-border" aria-hidden />}
                </li>
            ))}
        </ol>
    );
}

function PreviewStep({
    preview,
    mode,
    error,
    starting,
    onBack,
    onImport,
}: {
    preview: SubscriptionImportPreview;
    mode: 'create' | 'match';
    error: string | null;
    starting: boolean;
    onBack: () => void;
    onImport: () => void;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="imcrm-subscription-import-preview-step">
            <section className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2 sm:imcrm-grid-cols-4">
                <Tile label={__('En Mercado Pago')} value={preview.total} />
                <Tile label={__('Se traen')} value={preview.to_import} tone="primary" testId="imcrm-subscription-import-count" />
                <Tile label={__('Ya están en la app')} value={preview.known} />
                <Tile label={__('Canceladas fuera')} value={preview.skipped_cancelled} />
            </section>
            <p className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5 imcrm-text-xs">
                {MP_PREAPPROVAL_STATUSES.map((st) => (
                    <Badge key={st} variant="secondary" data-testid={`imcrm-subscription-import-status-${st}`}>
                        {__(MP_PREAPPROVAL_STATUS_LABELS[st])}: {preview.by_status[st] ?? 0}
                    </Badge>
                ))}
            </p>
            {preview.match && (
                <p className="imcrm-rounded-md imcrm-bg-muted/50 imcrm-px-3 imcrm-py-2 imcrm-text-sm" data-testid="imcrm-subscription-import-match">
                    {sprintf(
                        __('En «%1$s»: %2$d se vinculan a su cliente, %3$d no se encontraron por correo y %4$d clientes ya tienen una suscripción en la app (esa queda sin vincular).'),
                        preview.match.list_name,
                        preview.match.matched,
                        preview.match.unmatched,
                        preview.match.conflicts,
                    )}
                </p>
            )}
            {preview.without_email > 0 && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {sprintf(__('%d no traen el correo en la búsqueda de Mercado Pago: se toma de su último pago.'), preview.without_email)}
                </p>
            )}
            {preview.truncated && <p className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">{__('Hay más de 5.000 suscripciones: se traen las primeras 5.000 y el resto llega con la revisión periódica.')}</p>}

            {preview.plans.length > 0 && (
                <section>
                    <h4 className="imcrm-mb-1 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Planes de Mercado Pago')}</h4>
                    <ul className="imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border" data-testid="imcrm-subscription-import-plans">
                        {preview.plans.map((p) => (
                            <li key={p.external_id} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-0.5 imcrm-px-3 imcrm-py-2 imcrm-text-sm">
                                <span className="imcrm-font-medium">{p.name}</span>
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {p.amount !== null ? `${formatMoney(p.amount, p.currency)} ` : ''}
                                    {frequencyText(p.frequency, p.frequency_type)} · {sprintf(__('%d suscripciones'), p.subscribers)}
                                </span>
                                {p.known ? <Badge variant="secondary">{__('Ya está')}</Badge> : <Badge>{__('Se importa')}</Badge>}
                                {!p.active && <Badge variant="secondary">{__('Inactivo en Mercado Pago')}</Badge>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {preview.sample.length > 0 && (
                <section>
                    <h4 className="imcrm-mb-1 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Algunas de las que se traen')}</h4>
                    <div className="imcrm-overflow-x-auto imcrm-rounded-md imcrm-border imcrm-border-border">
                        <table className="imcrm-w-full imcrm-text-sm" data-testid="imcrm-subscription-import-sample">
                            <thead className="imcrm-text-left imcrm-text-xs imcrm-text-muted-foreground">
                                <tr>
                                    <th className="imcrm-px-3 imcrm-py-2 imcrm-font-medium">{__('Quién paga')}</th>
                                    <th className="imcrm-px-3 imcrm-py-2 imcrm-font-medium">{__('Plan')}</th>
                                    <th className="imcrm-px-3 imcrm-py-2 imcrm-text-right imcrm-font-medium">{__('Valor')}</th>
                                    <th className="imcrm-px-3 imcrm-py-2 imcrm-font-medium">{__('En Mercado Pago')}</th>
                                    <th className="imcrm-px-3 imcrm-py-2 imcrm-font-medium">{__('Qué pasa')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {preview.sample.map((r) => (
                                    <tr key={r.external_id} className="imcrm-border-t imcrm-border-border" data-action={r.action}>
                                        <td className="imcrm-max-w-[14rem] imcrm-truncate imcrm-px-3 imcrm-py-1.5" title={r.title}>
                                            {r.email ?? r.title}
                                        </td>
                                        <td className="imcrm-max-w-[10rem] imcrm-truncate imcrm-px-3 imcrm-py-1.5">{r.plan ?? '—'}</td>
                                        <td className="imcrm-whitespace-nowrap imcrm-px-3 imcrm-py-1.5 imcrm-text-right imcrm-tabular-nums">{formatMoney(r.amount, r.currency)}</td>
                                        <td className="imcrm-whitespace-nowrap imcrm-px-3 imcrm-py-1.5">{__(MP_STATUS_ONE[r.status])}</td>
                                        <td className="imcrm-min-w-[9.5rem] imcrm-px-3 imcrm-py-1.5">
                                            <span className={cn('imcrm-text-xs', r.action === 'skip' || r.action === 'no_record' ? 'imcrm-text-muted-foreground' : 'imcrm-font-medium')}>
                                                {r.action === 'link' && r.record_title ? sprintf(__('Se vincula a «%s»'), r.record_title) : __(ACTION_LABEL[r.action])}
                                            </span>
                                            {r.reason && r.action !== 'link' && <span className="imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">{r.reason}</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {error && <p className="imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-subscription-import-dialog-error">{error}</p>}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-end imcrm-gap-2">
                <Button variant="ghost" onClick={onBack}>
                    {__('Volver')}
                </Button>
                <Button disabled={preview.to_import === 0 || starting} onClick={onImport} data-testid="imcrm-subscription-import-start">
                    {starting && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                    {preview.to_import === 0
                        ? __('No hay nada nuevo para traer')
                        : mode === 'create'
                          ? sprintf(__('Crear la lista e importar %d'), preview.to_import)
                          : sprintf(__('Importar %d'), preview.to_import)}
                </Button>
            </div>
        </div>
    );
}

function RunningStep({
    status,
    onClose,
    onFinishedToast,
}: {
    status: SubscriptionImportStatus | null;
    onClose: () => void;
    onFinishedToast: (s: SubscriptionImportStatus) => void;
}): JSX.Element {
    const done = status && status.state !== 'running';
    useEffect(() => {
        if (status && status.state === 'done') onFinishedToast(status);
        // Sólo al terminar.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status?.state]);
    if (!status || status.state === 'running') {
        return status ? <ImportProgress status={status} /> : <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Preparando…')}</p>;
    }
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-subscription-import-done">
            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                <CheckCircle2 className={cn('imcrm-h-4 imcrm-w-4', status.state === 'done' ? 'imcrm-text-emerald-600' : 'imcrm-text-destructive')} />
                {status.state === 'done' ? sprintf(__('Se importaron %d suscripciones.'), status.imported) : __('La importación no terminó.')}
            </p>
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2 imcrm-text-sm sm:imcrm-grid-cols-4">
                <Tile label={__('Registros nuevos')} value={status.records_created} />
                <Tile label={__('Vinculadas')} value={status.linked} />
                <Tile label={__('Sin registro')} value={status.without_record} />
                <Tile label={__('Planes')} value={status.plans_imported} />
            </div>
            {status.error && <p className="imcrm-text-sm imcrm-text-destructive">{status.error}</p>}
            {status.failed > 0 && <p className="imcrm-text-sm imcrm-text-destructive">{sprintf(__('%d no se pudieron traer.'), status.failed)}</p>}
            {status.warnings.map((w) => (
                <p key={w} className="imcrm-text-xs imcrm-text-muted-foreground">
                    {w}
                </p>
            ))}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-justify-end imcrm-gap-2">
                {done && status.dashboard_id && (
                    <Button variant="outline" asChild>
                        <Link to={`/dashboards/${status.dashboard_id}`} onClick={onClose}>
                            <LayoutDashboard className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Ver el tablero')}
                        </Link>
                    </Button>
                )}
                {status.list_slug && (
                    <Button asChild>
                        <Link to={`/lists/${status.list_slug}`} onClick={onClose} data-testid="imcrm-subscription-import-go-list">
                            {sprintf(__('Ver «%s»'), status.list_name ?? '')}
                        </Link>
                    </Button>
                )}
            </div>
        </div>
    );
}

function Tile({ label, value, tone, testId }: { label: string; value: number; tone?: 'primary'; testId?: string }): JSX.Element {
    return (
        <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2" data-testid={testId}>
            <span className={cn('imcrm-block imcrm-text-lg imcrm-font-semibold imcrm-tabular-nums', tone === 'primary' && 'imcrm-text-primary')}>{value}</span>
            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{label}</span>
        </div>
    );
}

function Check({
    checked,
    onChange,
    title,
    hint,
    testId,
    className,
}: {
    checked: boolean;
    onChange: (v: boolean) => void;
    title: string;
    hint: string;
    testId: string;
    className?: string;
}): JSX.Element {
    return (
        <label className={cn('imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm', className)}>
            <input type="checkbox" className="imcrm-mt-0.5" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} data-testid={testId} />
            <span>
                {title}
                <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{hint}</span>
            </span>
        </label>
    );
}
