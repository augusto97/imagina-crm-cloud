import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, LayoutTemplate, Loader2, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import {
    ONBOARDING_DESCRIPTION_MAX,
    ONBOARDING_EXAMPLES,
    ONBOARDING_FOCUS_AREAS,
    ONBOARDING_FOCUS_LABELS,
    ONBOARDING_TEAM_SIZES,
    ONBOARDING_TEAM_SIZE_LABELS,
    type OnboardingAiStatus,
    type OnboardingApplyResult,
    type OnboardingFocusArea,
    type OnboardingProposal,
    type OnboardingTeamSize,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useOnboardingJob, useStartOnboardingAi } from '@/hooks/useOnboarding';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { ProposalReview } from './ProposalReview';

type Phase = { kind: 'form' } | { kind: 'working'; id: string } | { kind: 'review'; id: string; proposal: OnboardingProposal } | { kind: 'error'; message: string };

const STAGE_TEXT: Record<string, string> = {
    thinking: 'Pensando en tu negocio…',
    checking: 'Revisando que todo encaje…',
    fixing: 'Ajustando algunos detalles…',
};

interface Props {
    status: OnboardingAiStatus | null;
    onCreated: (res: OnboardingApplyResult) => void;
    onPickTypes: () => void;
}

/**
 * «Cuéntanos de tu negocio»: la persona describe su negocio en sus palabras
 * y la IA arma una propuesta COMPLETA (listas, campos, vistas, tablero,
 * automatizaciones y datos de ejemplo) que se revisa antes de crear.
 */
export function AiBusinessPath({ status, onCreated, onPickTypes }: Props): JSX.Element {
    const [phase, setPhase] = useState<Phase>({ kind: 'form' });
    const [description, setDescription] = useState('');
    const [focus, setFocus] = useState<OnboardingFocusArea[]>([]);
    const [teamSize, setTeamSize] = useState<OnboardingTeamSize | undefined>(undefined);
    const start = useStartOnboardingAi();
    const job = useOnboardingJob(phase.kind === 'working' ? phase.id : null);
    const textId = useId();

    useEffect(() => {
        if (phase.kind !== 'working' || !job.data) return;
        if (job.data.state === 'done' && job.data.proposal) setPhase({ kind: 'review', id: phase.id, proposal: job.data.proposal });
        else if (job.data.state === 'error') setPhase({ kind: 'error', message: job.data.error?.message ?? __('La IA no pudo armar la propuesta.') });
    }, [phase, job.data]);

    useEffect(() => {
        if (phase.kind === 'working' && job.isError) {
            setPhase({ kind: 'error', message: job.error instanceof Error ? job.error.message : __('Se perdió la conexión con la propuesta.') });
        }
    }, [phase.kind, job.isError, job.error]);

    const submit = async (): Promise<void> => {
        try {
            const res = await start.mutateAsync({ description: description.trim(), focus, team_size: teamSize, consent: true });
            setPhase({ kind: 'working', id: res.id });
        } catch (err) {
            setPhase({ kind: 'error', message: err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo hablar con la IA.') });
        }
    };

    if (phase.kind === 'review') {
        return <ProposalReview proposalId={phase.id} proposal={phase.proposal} onCreated={onCreated} onRetry={() => setPhase({ kind: 'form' })} />;
    }

    if (phase.kind === 'working') {
        return <Working stage={job.data?.stage ?? 'thinking'} />;
    }

    if (phase.kind === 'error') {
        return (
            <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-xl imcrm-flex-col imcrm-items-center imcrm-gap-4 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-text-center" role="alert" data-testid="welcome-ai-error">
                <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-destructive/10 imcrm-text-destructive">
                    <AlertCircle className="imcrm-h-5 imcrm-w-5" />
                </span>
                <p className="imcrm-text-sm imcrm-text-foreground">{phase.message}</p>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-justify-center imcrm-gap-2">
                    <Button variant="outline" className="imcrm-gap-1.5" onClick={() => setPhase({ kind: 'form' })}>
                        <RotateCcw className="imcrm-h-4 imcrm-w-4" />
                        {__('Volver a intentar')}
                    </Button>
                    <Button className="imcrm-gap-1.5" onClick={onPickTypes}>
                        <LayoutTemplate className="imcrm-h-4 imcrm-w-4" />
                        {__('Elegir por tipo de negocio')}
                    </Button>
                </div>
            </div>
        );
    }

    const tooShort = description.trim().length < 10;
    const unavailable = status !== null && !status.available;
    return (
        <form
            className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-2xl imcrm-flex-col imcrm-gap-5 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 sm:imcrm-p-6"
            onSubmit={(e) => {
                e.preventDefault();
                if (!tooShort && !unavailable) void submit();
            }}
            data-testid="welcome-ai-form"
        >
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <h2 className="imcrm-text-lg imcrm-font-semibold imcrm-text-foreground">{__('Cuéntanos de tu negocio')}</h2>
                <p className="imcrm-text-[13px] imcrm-text-muted-foreground">
                    {__('Escribe como se lo contarías a alguien: qué haces, con quién trabajas y qué quieres tener en orden.')}
                </p>
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor={textId}>{__('¿A qué se dedica tu negocio?')}</Label>
                <Textarea
                    id={textId}
                    value={description}
                    onChange={(e) => setDescription(e.target.value.slice(0, ONBOARDING_DESCRIPTION_MAX))}
                    rows={4}
                    autoFocus
                    placeholder={__('Ej. Agencia de marketing con 30 clientes que pagan una mensualidad. Hacemos campañas y les enviamos un reporte cada mes.')}
                    data-testid="welcome-ai-description"
                />
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-pt-1">
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Prueba con:')}</span>
                    {ONBOARDING_EXAMPLES.map((ex) => (
                        <button
                            key={ex}
                            type="button"
                            onClick={() => setDescription(ex)}
                            className="imcrm-rounded-full imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-text-foreground/80 imcrm-transition-colors hover:imcrm-border-primary/40 hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40"
                            data-testid="welcome-ai-example"
                        >
                            {ex}
                        </button>
                    ))}
                </div>
            </div>

            <fieldset className="imcrm-m-0 imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-2 imcrm-border-0 imcrm-p-0">
                <legend className="imcrm-mb-1.5 imcrm-text-sm imcrm-font-medium">
                    {__('¿Qué quieres organizar primero?')} <span className="imcrm-font-normal imcrm-text-muted-foreground">{__('(opcional)')}</span>
                </legend>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                    {ONBOARDING_FOCUS_AREAS.map((f) => {
                        const on = focus.includes(f);
                        return (
                            <button
                                key={f}
                                type="button"
                                aria-pressed={on}
                                onClick={() => setFocus((prev) => (on ? prev.filter((x) => x !== f) : [...prev, f]))}
                                className={chip(on)}
                                data-testid="welcome-ai-focus"
                            >
                                {__(ONBOARDING_FOCUS_LABELS[f])}
                            </button>
                        );
                    })}
                </div>
            </fieldset>

            <fieldset className="imcrm-m-0 imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-2 imcrm-border-0 imcrm-p-0">
                <legend className="imcrm-mb-1.5 imcrm-text-sm imcrm-font-medium">
                    {__('Tamaño del equipo')} <span className="imcrm-font-normal imcrm-text-muted-foreground">{__('(opcional)')}</span>
                </legend>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                    {ONBOARDING_TEAM_SIZES.map((s) => {
                        const on = teamSize === s;
                        return (
                            <button key={s} type="button" aria-pressed={on} onClick={() => setTeamSize(on ? undefined : s)} className={chip(on)}>
                                {__(ONBOARDING_TEAM_SIZE_LABELS[s])}
                            </button>
                        );
                    })}
                </div>
            </fieldset>

            <div className="imcrm-flex imcrm-items-start imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/50 imcrm-p-3 imcrm-text-xs imcrm-leading-relaxed imcrm-text-foreground/85" data-testid="welcome-ai-consent">
                <ShieldCheck className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                <p>
                    {__('Lo que escribas aquí se envía al proveedor de IA para armar tu espacio. No se envían registros. No activa el asistente para la empresa.')}
                    {status?.has_lists && ` ${__('También viajan los nombres de tus listas, para no repetirlas.')}`}
                    {status?.source === 'platform' && ` ${__('Usa 1 pedido de IA de tu plan.')}`}
                </p>
            </div>

            {unavailable && (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-sm imcrm-text-destructive" role="alert">
                    <AlertCircle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                    {status.reason}
                </p>
            )}

            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <button type="button" className="imcrm-text-sm imcrm-text-primary hover:imcrm-underline" onClick={onPickTypes}>
                    {__('Prefiero elegir plantillas')}
                </button>
                <Button type="submit" className="imcrm-gap-2" disabled={tooShort || unavailable || start.isPending} data-testid="welcome-ai-submit">
                    {start.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Sparkles className="imcrm-h-4 imcrm-w-4" />}
                    {__('Armar mi espacio')}
                </Button>
            </div>
        </form>
    );
}

function chip(on: boolean): string {
    return cn(
        'imcrm-rounded-full imcrm-border imcrm-px-3 imcrm-py-1 imcrm-text-[13px] imcrm-transition-colors focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40',
        on ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-font-medium imcrm-text-primary' : 'imcrm-border-border imcrm-text-foreground/80 hover:imcrm-bg-accent',
    );
}

/** Mientras la IA trabaja: qué está haciendo y cuánto lleva. */
function Working({ stage }: { stage: string }): JSX.Element {
    const [seconds, setSeconds] = useState(0);
    const startedAt = useRef(Date.now());
    useEffect(() => {
        const t = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
        return () => window.clearInterval(t);
    }, []);
    return (
        <div
            className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-xl imcrm-flex-col imcrm-items-center imcrm-gap-4 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-6 imcrm-py-10 imcrm-text-center"
            role="status"
            aria-live="polite"
            data-testid="welcome-ai-working"
        >
            <span className="imcrm-relative imcrm-flex imcrm-h-14 imcrm-w-14 imcrm-items-center imcrm-justify-center">
                <span className="imcrm-absolute imcrm-inset-0 imcrm-rounded-full imcrm-bg-primary/15 motion-safe:imcrm-animate-ping" aria-hidden />
                <span className="imcrm-relative imcrm-flex imcrm-h-14 imcrm-w-14 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-primary imcrm-ring-1 imcrm-ring-inset imcrm-ring-primary/25">
                    <Sparkles className="imcrm-h-6 imcrm-w-6" aria-hidden />
                </span>
            </span>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <p className="imcrm-text-base imcrm-font-semibold imcrm-text-foreground">{__(STAGE_TEXT[stage] ?? STAGE_TEXT.thinking!)}</p>
                <p className="imcrm-text-[13px] imcrm-text-muted-foreground">
                    {seconds < 45 ? __('Suele tardar menos de un minuto. Antes de crear nada vas a poder revisarlo.') : __('Está tardando un poco más de lo normal; sigue trabajando.')}
                </p>
            </div>
        </div>
    );
}
