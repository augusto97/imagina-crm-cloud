import { useState } from 'react';
import type { GuidePhase, GuideValue, ProviderGuide } from '@imagina-base/shared';
import { AlertTriangle, Check, ChevronDown, Copy, ExternalLink, Lightbulb } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';

/** Valor resuelto para un `GuideValue`: etiqueta + texto a copiar. */
export interface ResolvedGuideValue {
    label: string;
    value: string;
    /** Falta un dato para armarlo (se muestra el motivo en vez de copiar). */
    missing?: string;
}

export type GuideValues = Record<GuideValue, ResolvedGuideValue>;

const STORE_PREFIX = 'imcrm:provider-guide:';

function readDone(provider: string): Record<string, boolean> {
    try {
        const raw = window.localStorage.getItem(STORE_PREFIX + provider);
        return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
        return {};
    }
}

function writeDone(provider: string, done: Record<string, boolean>): void {
    try {
        window.localStorage.setItem(STORE_PREFIX + provider, JSON.stringify(done));
    } catch {
        /* sin storage: el progreso no se recuerda, la guía funciona igual */
    }
}

/**
 * Guía por fases de un proveedor OAuth (v0.1.247). Cada fase se pliega, tiene
 * su casilla «Hecho» (recordada en este navegador) y sus pasos traen el
 * enlace a la pantalla exacta y los valores para copiar ya resueltos.
 */
export function ProviderGuideView({
    provider,
    guide,
    values,
}: {
    provider: string;
    guide: ProviderGuide;
    values: GuideValues;
}): JSX.Element {
    const [done, setDone] = useState<Record<string, boolean>>(() => readDone(provider));
    const firstPending = guide.phases.find((p) => !done[p.key])?.key ?? null;
    const [open, setOpen] = useState<string | null>(firstPending);
    const doneCount = guide.phases.filter((p) => done[p.key]).length;

    const toggleDone = (key: string) => {
        const next = { ...done, [key]: !done[key] };
        setDone(next);
        writeDone(provider, next);
        if (next[key] && open === key) {
            setOpen(guide.phases.find((p) => !next[p.key])?.key ?? null);
        }
    };

    return (
        <div className="imcrm-space-y-2" data-testid="provider-guide" data-provider={provider}>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-baseline imcrm-justify-between imcrm-gap-2">
                <p className="imcrm-max-w-3xl imcrm-text-sm imcrm-text-muted-foreground">{guide.intro}</p>
                <span className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground" data-testid="guide-progress">
                    {doneCount}/{guide.phases.length} {__('fases hechas')}
                </span>
            </div>
            <div className="imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border">
                {guide.phases.map((phase) => (
                    <PhaseRow
                        key={phase.key}
                        phase={phase}
                        values={values}
                        isOpen={open === phase.key}
                        isDone={Boolean(done[phase.key])}
                        onToggleOpen={() => setOpen(open === phase.key ? null : phase.key)}
                        onToggleDone={() => toggleDone(phase.key)}
                    />
                ))}
            </div>
        </div>
    );
}

function PhaseRow({
    phase,
    values,
    isOpen,
    isDone,
    onToggleOpen,
    onToggleDone,
}: {
    phase: GuidePhase;
    values: GuideValues;
    isOpen: boolean;
    isDone: boolean;
    onToggleOpen: () => void;
    onToggleDone: () => void;
}): JSX.Element {
    return (
        <section className="imcrm-border-b imcrm-border-border last:imcrm-border-b-0" data-testid="guide-phase" data-phase={phase.key}>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-2.5">
                <button
                    type="button"
                    onClick={onToggleDone}
                    aria-pressed={isDone}
                    aria-label={isDone ? __('Marcar como pendiente') : __('Marcar como hecha')}
                    title={isDone ? __('Hecha') : __('Marcar como hecha')}
                    className={
                        isDone
                            ? 'imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-success imcrm-text-white'
                            : 'imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-rounded-full imcrm-border-2 imcrm-border-muted-foreground/40 hover:imcrm-border-primary'
                    }
                    data-testid="phase-done"
                >
                    {isDone && <Check className="imcrm-h-3 imcrm-w-3" />}
                </button>
                <button
                    type="button"
                    onClick={onToggleOpen}
                    aria-expanded={isOpen}
                    className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-2 imcrm-text-left"
                    data-testid="phase-toggle"
                >
                    <span className="imcrm-min-w-0 imcrm-flex-1">
                        <span className={isDone ? 'imcrm-block imcrm-text-sm imcrm-font-medium imcrm-text-muted-foreground' : 'imcrm-block imcrm-text-sm imcrm-font-medium'}>
                            {phase.title}
                        </span>
                        <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{phase.summary}</span>
                    </span>
                    <ChevronDown
                        className={
                            isOpen
                                ? 'imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-rotate-180 imcrm-text-muted-foreground imcrm-transition-transform'
                                : 'imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground imcrm-transition-transform'
                        }
                    />
                </button>
            </div>
            {isOpen && (
                <div className="imcrm-space-y-3 imcrm-bg-muted/30 imcrm-px-3 imcrm-pb-4 imcrm-pt-1 sm:imcrm-pl-11">
                    <ol className="imcrm-space-y-3">
                        {phase.steps.map((step, i) => (
                            <li key={i} className="imcrm-flex imcrm-gap-2.5 imcrm-text-sm" data-testid="guide-step">
                                <span className="imcrm-mt-0.5 imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-[11px] imcrm-font-semibold imcrm-text-muted-foreground">
                                    {i + 1}
                                </span>
                                <div className="imcrm-min-w-0 imcrm-flex-1 imcrm-space-y-2">
                                    <p>{step.text}</p>
                                    {step.link && (
                                        <Button size="sm" variant="outline" asChild>
                                            <a href={step.link.url} target="_blank" rel="noreferrer">
                                                <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                                                {step.link.label}
                                            </a>
                                        </Button>
                                    )}
                                    {step.copy && step.copy.length > 0 && (
                                        <div className="imcrm-space-y-1.5">
                                            {step.copy.map((key) => (
                                                <CopyValue key={key} item={values[key]} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ol>
                    {phase.warning && (
                        <p className="imcrm-flex imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-warning" data-testid="phase-warning">
                            <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                            <span>{phase.warning}</span>
                        </p>
                    )}
                    {phase.tip && (
                        <p className="imcrm-flex imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                            <Lightbulb className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                            <span>{phase.tip}</span>
                        </p>
                    )}
                    {!isDone && (
                        <Button size="sm" variant="secondary" onClick={onToggleDone}>
                            <Check className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Listo, siguiente fase')}
                        </Button>
                    )}
                </div>
            )}
        </section>
    );
}

function CopyValue({ item }: { item: ResolvedGuideValue }): JSX.Element {
    const [copied, setCopied] = useState(false);
    const multiline = item.value.includes('\n');
    return (
        <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card" data-testid="copy-value">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-2 imcrm-py-1">
                <span className="imcrm-shrink-0 imcrm-text-[11px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                    {item.label}
                </span>
                {!multiline && (
                    <code className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-xs" title={item.value}>
                        {item.missing ?? item.value}
                    </code>
                )}
                {multiline && <span className="imcrm-flex-1" />}
                {!item.missing && (
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="imcrm-h-7 imcrm-shrink-0 imcrm-px-2"
                        onClick={() => {
                            void navigator.clipboard?.writeText(item.value).then(() => {
                                setCopied(true);
                                setTimeout(() => setCopied(false), 1500);
                            });
                        }}
                    >
                        {copied ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {copied ? __('Copiado') : __('Copiar')}
                    </Button>
                )}
            </div>
            {multiline && (
                <pre className="imcrm-max-h-48 imcrm-overflow-auto imcrm-whitespace-pre-wrap imcrm-border-t imcrm-border-border imcrm-px-2 imcrm-py-1.5 imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground">
                    {item.missing ?? item.value}
                </pre>
            )}
        </div>
    );
}
