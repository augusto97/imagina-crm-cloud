import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, FilePlus2, FileSpreadsheet, Info, LayoutTemplate, Loader2, Sparkles } from 'lucide-react';
import type { OnboardingApplyResult } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useOnboardingAiStatus } from '@/hooks/useOnboarding';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { AiBusinessPath } from './AiBusinessPath';
import { BusinessTypePath } from './BusinessTypePath';

export type WelcomePath = 'choose' | 'ai' | 'types';

interface Props {
    /** `page`: ocupa el índice de una empresa sin listas. `dialog`: «Agrega más» desde Primeros pasos. */
    variant: 'page' | 'dialog';
    initialPath?: WelcomePath;
    /** «Empezar en blanco» (sólo en la página). */
    onBlank?: () => void;
    onCreated: (res: OnboardingApplyResult) => void;
}

/**
 * F7 (ADR-S72) — La bienvenida: «Armemos tu espacio». Tres caminos — contarle
 * a la IA de qué se trata el negocio, elegir plantillas por tipo de negocio
 * (combinables) o empezar en blanco. Lo que se crea pasa por el MISMO motor
 * de las plantillas, y si ya hay listas no se toca nada de lo que existe.
 */
export function WelcomeFlow({ variant, initialPath = 'choose', onBlank, onCreated }: Props): JSX.Element {
    const [path, setPath] = useState<WelcomePath>(initialPath);
    const ai = useOnboardingAiStatus();
    const aiAvailable = ai.data?.available === true;
    const navigate = useNavigate();

    if (path === 'ai') {
        return (
            <Frame variant={variant} onBack={() => setPath('choose')}>
                <AiBusinessPath status={ai.data ?? null} onCreated={onCreated} onPickTypes={() => setPath('types')} />
            </Frame>
        );
    }
    if (path === 'types') {
        return (
            <Frame variant={variant} onBack={() => setPath('choose')}>
                <BusinessTypePath onCreated={onCreated} />
            </Frame>
        );
    }

    return (
        <div className={cn('imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-5xl imcrm-flex-col imcrm-gap-6', variant === 'page' && 'imcrm-py-6 sm:imcrm-py-10')} data-testid="welcome">
            {variant === 'page' ? (
                <header className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-text-center">
                    <span className="imcrm-flex imcrm-h-12 imcrm-w-12 imcrm-items-center imcrm-justify-center imcrm-rounded-xl imcrm-bg-primary/10 imcrm-text-primary imcrm-ring-1 imcrm-ring-inset imcrm-ring-primary/20">
                        <Sparkles className="imcrm-h-6 imcrm-w-6" aria-hidden />
                    </span>
                    <h1 className="imcrm-text-2xl imcrm-font-semibold imcrm-tracking-tight imcrm-text-foreground">{__('Armemos tu espacio')}</h1>
                    <p className="imcrm-max-w-xl imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Elige cómo quieres empezar. Todo lo que se cree se puede cambiar después.')}
                    </p>
                </header>
            ) : (
                // En el diálogo el título ya está en su barra: aquí sólo la aclaración.
                <p className="imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Elige cómo armar lo nuevo. Se crea aparte: no se toca nada de lo que ya tienes.')}
                </p>
            )}

            <div className={cn('imcrm-grid imcrm-gap-3', variant === 'page' ? 'md:imcrm-grid-cols-2 xl:imcrm-grid-cols-4' : 'md:imcrm-grid-cols-3')}>
                <PathCard
                    testId="welcome-path-ai"
                    icon={Sparkles}
                    title={__('Cuéntanos de tu negocio')}
                    text={__('Describe a qué te dedicas y la IA arma tus listas, vistas, un tablero y automatizaciones. Revisas todo antes de crear.')}
                    badge={aiAvailable ? __('Recomendado') : null}
                    loading={ai.isLoading}
                    disabledReason={ai.isLoading ? null : aiAvailable ? null : ai.data?.reason ?? (ai.isError ? __('No se pudo comprobar si la IA está disponible.') : null)}
                    onClick={() => setPath('ai')}
                />
                {/* v0.1.339 — quien ya tiene sus datos en una planilla arranca por ahí. */}
                <PathCard
                    testId="welcome-path-file"
                    icon={FileSpreadsheet}
                    title={__('Subir un Excel o CSV')}
                    text={__('¿Ya tienes tus datos en una planilla? Súbela y la lista se arma sola: tipos de columna, opciones y listas vinculadas. Revisas antes de crear.')}
                    badge={__('Si ya tienes datos')}
                    badgeQuiet
                    onClick={() => navigate('/lists/new/file')}
                />
                <PathCard
                    testId="welcome-path-types"
                    icon={LayoutTemplate}
                    title={__('Elegir por tipo de negocio')}
                    text={__('Combina plantillas listas para usar: clientes, ventas, facturación, proyectos, inventario y más.')}
                    badge={!ai.isLoading && !aiAvailable ? __('Recomendado') : null}
                    onClick={() => setPath('types')}
                />
                {variant === 'page' && onBlank && (
                    <PathCard
                        testId="welcome-path-blank"
                        icon={FilePlus2}
                        title={__('Empezar en blanco')}
                        text={__('Crea tu primera lista desde cero, campo por campo.')}
                        onClick={onBlank}
                        quiet
                    />
                )}
            </div>
        </div>
    );
}

function Frame({ variant, onBack, children }: { variant: 'page' | 'dialog'; onBack: () => void; children: React.ReactNode }): JSX.Element {
    return (
        <div className={cn('imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-6xl imcrm-flex-col imcrm-gap-4', variant === 'page' && 'imcrm-py-4 sm:imcrm-py-6')} data-testid="welcome">
            <div>
                <Button variant="ghost" size="sm" className="imcrm-h-8 imcrm-gap-1.5 imcrm-px-2" onClick={onBack} data-testid="welcome-back">
                    <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                    {__('Otras formas de empezar')}
                </Button>
            </div>
            {children}
        </div>
    );
}

function PathCard({
    icon: Icon,
    title,
    text,
    badge = null,
    badgeQuiet = false,
    loading = false,
    disabledReason = null,
    quiet = false,
    onClick,
    testId,
}: {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    text: string;
    badge?: string | null;
    /** Etiqueta sin el énfasis de «Recomendado». */
    badgeQuiet?: boolean;
    loading?: boolean;
    disabledReason?: string | null;
    quiet?: boolean;
    onClick: () => void;
    testId: string;
}): JSX.Element {
    const disabled = loading || disabledReason !== null;
    const reasonId = `${testId}-reason`;
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-describedby={disabledReason ? reasonId : undefined}
            data-testid={testId}
            className={cn(
                'imcrm-group imcrm-relative imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-bg-card imcrm-p-5 imcrm-text-left imcrm-transition-all',
                'focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/50',
                disabled
                    ? 'imcrm-cursor-not-allowed imcrm-border-border imcrm-opacity-80'
                    : badge && !badgeQuiet
                      ? 'imcrm-border-primary/50 imcrm-shadow-imcrm-sm hover:imcrm-border-primary hover:imcrm-shadow-imcrm-md motion-safe:hover:-imcrm-translate-y-0.5'
                      : 'imcrm-border-border hover:imcrm-border-primary/40 hover:imcrm-shadow-imcrm-sm motion-safe:hover:-imcrm-translate-y-0.5',
            )}
        >
            <span className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <span
                    className={cn(
                        'imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-ring-1 imcrm-ring-inset',
                        quiet ? 'imcrm-bg-muted imcrm-text-muted-foreground imcrm-ring-border' : 'imcrm-bg-primary/10 imcrm-text-primary imcrm-ring-primary/20',
                    )}
                >
                    {loading ? <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin" /> : <Icon className="imcrm-h-5 imcrm-w-5" />}
                </span>
                {badge && (
                    <span
                        className={cn(
                            'imcrm-rounded-full imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-semibold',
                            badgeQuiet ? 'imcrm-bg-muted imcrm-text-foreground' : 'imcrm-bg-primary imcrm-text-primary-foreground',
                        )}
                    >
                        {badge}
                    </span>
                )}
            </span>
            <span className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <span className="imcrm-text-base imcrm-font-semibold imcrm-text-foreground">{title}</span>
                <span className="imcrm-text-[13px] imcrm-leading-snug imcrm-text-muted-foreground">{text}</span>
            </span>
            {disabledReason && (
                <span id={reasonId} className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-muted imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-text-foreground" data-testid={`${testId}-disabled`}>
                    <Info className="imcrm-mt-px imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                    {disabledReason}
                </span>
            )}
        </button>
    );
}
