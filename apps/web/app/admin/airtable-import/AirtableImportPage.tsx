import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, Database, ExternalLink, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { AIRTABLE_REQUIRED_SCOPES, AIRTABLE_TOKENS_URL, type AirtableImportStatus, type AirtablePlan } from '@imagina-base/shared';

import { PlanModuleGate } from '@/components/PlanModuleNotice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    useAirtableImportFinished,
    useAirtableImportStatus,
    useApplyAirtableImport,
    useCancelAirtableImport,
    useChooseAirtableBase,
    useConnectAirtable,
} from '@/hooks/useAirtableImport';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

import { AirtableImportReview } from './AirtableImportReview';
import { countOf, formatBytes } from './airtablePlanEdit';

/**
 * v0.1.458 — «Importar de Airtable»: la persona pega un token personal de
 * Airtable, elige la base, revisa qué se crea y la importación corre en el
 * servidor (con progreso). El token no se guarda: vive sólo mientras dura la
 * importación.
 */
export function AirtableImportPage(): JSX.Element {
    return (
        <PlanModuleGate module="integrations">
            <AirtableImportInner />
        </PlanModuleGate>
    );
}

function AirtableImportInner(): JSX.Element {
    const [params] = useSearchParams();
    const groupId = Number(params.get('carpeta')) || undefined;
    const canCreate = useCan(CAP.MANAGE_LISTS);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [plan, setPlan] = useState<AirtablePlan | null>(null);
    const [capToLimit, setCapToLimit] = useState(false);

    const connect = useConnectAirtable();
    const choose = useChooseAirtableBase();
    const statusQ = useAirtableImportStatus(sessionId);
    const apply = useApplyAirtableImport();
    const cancel = useCancelAirtableImport();
    const finished = useAirtableImportFinished();
    const status = statusQ.data ?? null;

    // El borrador llega al terminar de leer la base: es el punto de partida de la revisión.
    const seeded = useRef<string | null>(null);
    useEffect(() => {
        if (status?.stage === 'ready' && status.plan && seeded.current !== `${status.id}:${status.base?.id}`) {
            seeded.current = `${status.id}:${status.base?.id}`;
            setPlan(status.plan);
            setCapToLimit(false);
        }
    }, [status]);

    // Terminó: las listas nuevas aparecen en el menú.
    const done = status?.stage === 'done' || (status?.stage === 'cancelled' && status.result !== null) || (status?.stage === 'error' && status.result !== null);
    useEffect(() => {
        if (done) finished();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al cambiar de etapa
    }, [done]);

    if (!canCreate) {
        return (
            <div className="imcrm-mx-auto imcrm-max-w-xl imcrm-py-16 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                {__('Tu rol no puede crear listas. Pídeselo a un administrador.')}
            </div>
        );
    }

    const restart = (): void => {
        setSessionId(null);
        setPlan(null);
        connect.reset();
        choose.reset();
        apply.reset();
    };

    let body: JSX.Element;
    if (!status) {
        body = (
            <ConnectStep
                busy={connect.isPending}
                error={connect.error instanceof Error ? connect.error.message : null}
                onConnect={(token) => connect.mutate(token, { onSuccess: (st) => setSessionId(st.id) })}
            />
        );
    } else if (status.stage === 'connected' || (status.stage === 'error' && status.result === null && !status.plan)) {
        body = (
            <BaseStep
                status={status}
                busy={choose.isPending}
                error={(choose.error instanceof Error ? choose.error.message : null) ?? status.error?.message ?? null}
                onChoose={(baseId) => choose.mutate({ id: status.id, baseId })}
            />
        );
    } else if (status.stage === 'scanning') {
        body = <ProgressStep status={status} reading onCancel={() => cancel.mutate(status.id)} cancelling={cancel.isPending} />;
    } else if (status.stage === 'importing') {
        body = <ProgressStep status={status} reading={false} onCancel={() => cancel.mutate(status.id)} cancelling={cancel.isPending} />;
    } else if (done && status.result) {
        body = <DoneStep status={status} onAgain={restart} />;
    } else if (status.stage === 'cancelled') {
        body = (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-py-12 imcrm-text-center" data-testid="airtable-cancelled">
                <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Cancelaste la importación. El token ya se borró.')}</p>
                <Button onClick={restart}>{__('Empezar de nuevo')}</Button>
            </div>
        );
    } else if (status.stage === 'error') {
        body = (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-py-12 imcrm-text-center" data-testid="airtable-failed">
                <AlertTriangle className="imcrm-h-8 imcrm-w-8 imcrm-text-destructive" aria-hidden />
                <p className="imcrm-max-w-md imcrm-text-sm">{status.error?.message ?? __('La importación no pudo terminar.')}</p>
                <Button onClick={restart}>{__('Empezar de nuevo')}</Button>
            </div>
        );
    } else if (plan) {
        body = (
            <AirtableImportReview
                status={status}
                plan={plan}
                onPlan={setPlan}
                capToLimit={capToLimit}
                onCapToLimit={setCapToLimit}
                importing={apply.isPending}
                error={apply.error instanceof Error ? apply.error.message : null}
                onImport={() => {
                    const remaining = status.limit?.records_remaining ?? null;
                    apply.mutate({
                        id: status.id,
                        input: {
                            plan,
                            ...(capToLimit && remaining !== null ? { max_records: remaining } : {}),
                            ...(groupId ? { group_id: groupId } : {}),
                        },
                    });
                    window.scrollTo({ top: 0 });
                }}
            />
        );
    } else {
        body = (
            <div className="imcrm-flex imcrm-justify-center imcrm-py-16">
                <Loader2 className="imcrm-h-6 imcrm-w-6 imcrm-animate-spin imcrm-text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-5xl imcrm-flex-col imcrm-gap-4 imcrm-py-2 sm:imcrm-py-4" data-testid="airtable-import">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Button variant="ghost" size="sm" asChild className="imcrm-h-8 imcrm-gap-1.5 imcrm-px-2">
                    <Link to="/lists">
                        <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                        {__('Listas')}
                    </Link>
                </Button>
                <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">{__('Importar de Airtable')}</h1>
                {status?.base && status.stage === 'ready' && (
                    <Button variant="ghost" size="sm" className="imcrm-ml-auto" onClick={() => choose.mutate({ id: status.id, baseId: status.base!.id })} data-testid="airtable-reread">
                        {__('Volver a leer la base')}
                    </Button>
                )}
            </div>
            {body}
        </div>
    );
}

// ── 1. Conectar ─────────────────────────────────────────────────────────

function ConnectStep({ busy, error, onConnect }: { busy: boolean; error: string | null; onConnect: (token: string) => void }): JSX.Element {
    const [token, setToken] = useState('');
    const [show, setShow] = useState(false);
    const steps = [
        <>
            {__('Entra a')}{' '}
            <a href={AIRTABLE_TOKENS_URL} target="_blank" rel="noopener noreferrer" className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                airtable.com/create/tokens
                <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
            </a>{' '}
            {__('con tu cuenta de Airtable y toca «Create new token».')}
        </>,
        <>
            {__('Ponle un nombre (por ejemplo, «Migración») y en «Scopes» agrega estos dos permisos:')}{' '}
            {AIRTABLE_REQUIRED_SCOPES.map((s, i) => (
                <span key={s}>
                    {i > 0 && ` ${__('y')} `}
                    <code className="imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-py-0.5 imcrm-text-xs">{s}</code>
                </span>
            ))}
            .
        </>,
        <>{__('En «Access», agrega la base (o las bases) que quieres traer.')}</>,
        <>{__('Toca «Create token», cópialo y pégalo aquí abajo.')}</>,
    ];
    return (
        <div className="imcrm-grid imcrm-gap-4 md:imcrm-grid-cols-[1.1fr_1fr]">
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-bg-card imcrm-p-4 sm:imcrm-p-5" data-tour="airtable-token-steps">
                <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                    <KeyRound className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                    {__('Crea un token de Airtable')}
                </h2>
                <ol className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-text-sm">
                    {steps.map((s, i) => (
                        <li key={i} className="imcrm-flex imcrm-gap-2.5">
                            <span className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-xs imcrm-font-semibold imcrm-text-primary">{i + 1}</span>
                            <span className="imcrm-pt-0.5">{s}</span>
                        </li>
                    ))}
                </ol>
            </section>
            <form
                className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-bg-card imcrm-p-4 sm:imcrm-p-5"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (token.trim().length >= 20) onConnect(token.trim());
                }}
            >
                <label className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <span className="imcrm-text-sm imcrm-font-medium">{__('Tu token personal de Airtable')}</span>
                    <span className="imcrm-relative">
                        <Input
                            type={show ? 'text' : 'password'}
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                            placeholder="pat…"
                            autoComplete="off"
                            spellCheck={false}
                            className="imcrm-pr-10 imcrm-font-mono"
                            data-testid="airtable-token"
                            data-tour="airtable-token"
                        />
                        <button
                            type="button"
                            onClick={() => setShow((v) => !v)}
                            className="imcrm-absolute imcrm-right-1 imcrm-top-1 imcrm-flex imcrm-h-7 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-muted"
                            aria-label={show ? __('Ocultar el token') : __('Mostrar el token')}
                        >
                            {show ? <EyeOff className="imcrm-h-4 imcrm-w-4" /> : <Eye className="imcrm-h-4 imcrm-w-4" />}
                        </button>
                    </span>
                </label>
                <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-bg-muted imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                    <ShieldCheck className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-success" aria-hidden />
                    {__('El token no se guarda: se usa sólo mientras dura la importación y se borra al terminar. Puedes revocarlo en Airtable cuando quieras.')}
                </p>
                {error && (
                    <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-[hsl(var(--imcrm-destructive-ink))]" role="alert" data-testid="airtable-connect-error">
                        {error}
                    </p>
                )}
                <Button type="submit" disabled={busy || token.trim().length < 20} className="imcrm-gap-2 sm:imcrm-self-start" data-testid="airtable-connect" data-tour="airtable-connect">
                    {busy ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <ArrowRight className="imcrm-h-4 imcrm-w-4" />}
                    {__('Conectar')}
                </Button>
            </form>
        </div>
    );
}

// ── 2. Elegir la base ───────────────────────────────────────────────────

function BaseStep({ status, busy, error, onChoose }: { status: AirtableImportStatus; busy: boolean; error: string | null; onChoose: (id: string) => void }): JSX.Element {
    const [picked, setPicked] = useState<string>(status.base?.id ?? status.bases[0]?.id ?? '');
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-bg-card imcrm-p-4 sm:imcrm-p-5" data-tour="airtable-bases">
            <h2 className="imcrm-text-base imcrm-font-semibold">{__('¿Qué base quieres traer?')}</h2>
            <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Cada tabla de la base se convierte en una lista. Primero se lee la base para contarte qué trae; todavía no se crea nada.')}</p>
            <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2">
                {status.bases.map((b) => (
                    <label
                        key={b.id}
                        className={cn(
                            'imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-transition-colors',
                            picked === b.id ? 'imcrm-border-primary imcrm-bg-primary/5' : 'hover:imcrm-border-primary/40',
                        )}
                        data-testid={`airtable-base-${b.id}`}
                    >
                        <input type="radio" name="airtable-base" checked={picked === b.id} onChange={() => setPicked(b.id)} className="imcrm-sr-only" />
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary">
                            <Database className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{b.name}</span>
                    </label>
                ))}
            </div>
            {error && (
                <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-[hsl(var(--imcrm-destructive-ink))]" role="alert" data-testid="airtable-base-error">
                    {error}
                </p>
            )}
            <Button onClick={() => onChoose(picked)} disabled={busy || !picked} className="imcrm-gap-2 sm:imcrm-self-start" data-testid="airtable-read-base">
                {busy ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <ArrowRight className="imcrm-h-4 imcrm-w-4" />}
                {__('Leer esta base')}
            </Button>
        </section>
    );
}

// ── Progreso (leer la base o importar) ──────────────────────────────────

function ProgressStep({ status, reading, onCancel, cancelling }: { status: AirtableImportStatus; reading: boolean; onCancel: () => void; cancelling: boolean }): JSX.Element {
    const p = status.progress;
    const pct = p && !reading && p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-4 imcrm-rounded-xl imcrm-border imcrm-bg-card imcrm-px-4 imcrm-py-10 imcrm-text-center" data-testid={reading ? 'airtable-scanning' : 'airtable-importing'}>
            <Loader2 className="imcrm-h-8 imcrm-w-8 imcrm-animate-spin imcrm-text-primary" aria-hidden />
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <h2 className="imcrm-text-base imcrm-font-semibold">
                    {reading ? sprintf(__('Leyendo «%s»…'), status.base?.name ?? '') : p?.linking ? __('Armando los vínculos entre listas…') : __('Importando…')}
                </h2>
                {p && p.table && !p.linking && (
                    <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="airtable-progress-table">
                        {reading
                            ? sprintf(__('Tabla «%1$s»: %2$s'), p.table, countOf(p.table_done, __('registro'), __('registros')))
                            : sprintf(__('Tabla «%1$s»: %2$s de %3$s'), p.table, p.table_done.toLocaleString('es'), p.table_total.toLocaleString('es'))}
                    </p>
                )}
            </div>
            {pct !== null && (
                <div className="imcrm-flex imcrm-w-full imcrm-max-w-md imcrm-flex-col imcrm-gap-1.5">
                    <div className="imcrm-h-2 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                        <div className="imcrm-h-full imcrm-rounded-full imcrm-bg-primary imcrm-transition-[width]" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="airtable-progress-total">
                        {sprintf(__('%1$s de %2$s'), p!.done.toLocaleString('es'), countOf(p!.total, __('registro'), __('registros')))}
                        {p!.files_total > 0 && ` · ${sprintf(__('%1$s de %2$s'), String(p!.files_done), countOf(p!.files_total, __('adjunto'), __('adjuntos')))}`}
                    </p>
                </div>
            )}
            {reading && p && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="airtable-progress-total">
                    {p.done === 1 ? __('1 registro leído') : sprintf(__('%s registros leídos'), p.done.toLocaleString('es'))}
                </p>
            )}
            <Button variant="outline" size="sm" onClick={onCancel} disabled={cancelling} data-testid="airtable-cancel">
                {reading ? __('Cancelar') : __('Detener')}
            </Button>
        </section>
    );
}

// ── Listo ───────────────────────────────────────────────────────────────

function DoneStep({ status, onAgain }: { status: AirtableImportStatus; onAgain: () => void }): JSX.Element {
    const r = status.result!;
    const first = r.lists[0];
    const ok = status.stage === 'done';
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-5" data-testid="airtable-done" data-tour="airtable-done">
            <section className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-text-center">
                <span className={cn('imcrm-flex imcrm-h-14 imcrm-w-14 imcrm-items-center imcrm-justify-center imcrm-rounded-full', ok ? 'imcrm-bg-success/15 imcrm-text-success' : 'imcrm-bg-warning/15 imcrm-text-foreground')}>
                    {ok ? <CheckCircle2 className="imcrm-h-8 imcrm-w-8" aria-hidden /> : <AlertTriangle className="imcrm-h-8 imcrm-w-8" aria-hidden />}
                </span>
                <h2 className="imcrm-text-2xl imcrm-font-semibold imcrm-tracking-tight">
                    {!ok
                        ? __('La importación quedó a medias')
                        : r.lists.length === 1
                          ? sprintf(__('Listo: «%s» está creada'), first?.name ?? '')
                          : sprintf(__('Listo: creaste %s listas'), String(r.lists.length))}
                </h2>
                {status.error && <p className="imcrm-max-w-lg imcrm-text-sm">{status.error.message}</p>}
                <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="airtable-done-summary">
                    {r.imported === 1 ? __('1 registro importado') : sprintf(__('%s registros importados'), r.imported.toLocaleString('es'))}
                    {r.linked > 0 && ` · ${countOf(r.linked, __('vínculo'), __('vínculos'))}`}
                    {r.files > 0 && ` · ${sprintf(__('%1$s (%2$s)'), countOf(r.files, __('adjunto'), __('adjuntos')), formatBytes(r.files_bytes))}`}
                </p>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-justify-center imcrm-gap-2">
                    {r.lists.map((l) => (
                        <Button key={l.id} asChild variant={l === first ? 'default' : 'outline'} className="imcrm-gap-2">
                            <Link to={`/lists/${l.slug}/records`} data-testid={`airtable-open-${l.table_id}`}>
                                {sprintf(__('%1$s (%2$s)'), l.name, l.records.toLocaleString('es'))}
                                <ArrowRight className="imcrm-h-4 imcrm-w-4" aria-hidden />
                            </Link>
                        </Button>
                    ))}
                </div>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('El token de Airtable ya se borró.')}</p>
            </section>

            {r.warnings.length > 0 && (
                <section className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-bg-card imcrm-p-4" data-testid="airtable-done-warnings">
                    <h3 className="imcrm-text-sm imcrm-font-semibold">{__('Para tener en cuenta')}</h3>
                    <ul className="imcrm-flex imcrm-list-disc imcrm-flex-col imcrm-gap-1 imcrm-pl-5 imcrm-text-sm imcrm-text-muted-foreground">
                        {r.warnings.map((w) => (
                            <li key={w}>{w}</li>
                        ))}
                    </ul>
                </section>
            )}
            {r.cell_warnings_total > 0 && (
                <details className="imcrm-group imcrm-rounded-xl imcrm-border imcrm-bg-card imcrm-p-4" data-testid="airtable-done-cells">
                    <summary className="imcrm-flex imcrm-cursor-pointer imcrm-list-none imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                        <ChevronDown className="imcrm-h-4 imcrm-w-4 imcrm-transition-transform group-open:imcrm-rotate-180" aria-hidden />
                        {r.cell_warnings_total === 1 ? __('1 celda quedó vacía') : sprintf(__('%s celdas quedaron vacías'), r.cell_warnings_total.toLocaleString('es'))}
                    </summary>
                    <ul className="imcrm-mt-3 imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-text-xs">
                        {r.cell_warnings.map((w, i) => (
                            <li key={i}>
                                <span className="imcrm-font-medium">
                                    {w.list} · {w.record} · {w.field}
                                </span>
                                <span className="imcrm-text-muted-foreground"> — {w.message}</span>
                            </li>
                        ))}
                    </ul>
                </details>
            )}
            <div className="imcrm-flex imcrm-justify-center">
                <Button variant="ghost" onClick={onAgain}>
                    {__('Importar otra base')}
                </Button>
            </div>
        </div>
    );
}
