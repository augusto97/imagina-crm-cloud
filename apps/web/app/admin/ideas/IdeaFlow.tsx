import { Fragment } from 'react';
import { ArrowRight, LayoutDashboard, LayoutTemplate, MessageCircle, MousePointerClick, Settings, type LucideIcon } from 'lucide-react';

import { actionMetaFor, triggerMetaFor } from '@/admin/automations/automationMeta';
import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import type { IdeaAction, IdeaDef } from './types';

/**
 * El flujo de una idea dibujado como pastillas: «Cuando…» → «entonces…».
 * Es lo que hace legible una automatización sin abrirla, y se anima (un punto
 * que recorre la flecha) para que se lea como algo que PASA solo. Las acciones
 * de una app conectada muestran el logo de la app.
 */

interface Step {
    key: string;
    label: string;
    icon?: LucideIcon;
    app?: string;
}

function actionStep(a: IdeaAction, i: number, apps: readonly string[]): Step {
    if (a.type === '$message') return { key: `a${i}`, label: __('Manda un mensaje'), icon: MessageCircle, app: apps[0] };
    if (a.type === 'connector_action') {
        const key = String(a.config.action_key ?? '');
        if (key === 'create_payment_link') return { key: `a${i}`, label: __('Crea el link de pago'), app: apps[0] ?? 'mercadopago' };
        if (key === 'append_row') return { key: `a${i}`, label: __('Agrega una fila'), app: 'google_sheets' };
        if (key === 'create_event') return { key: `a${i}`, label: __('Crea el evento'), app: 'google_calendar' };
        return { key: `a${i}`, label: __('Usa una app'), app: apps[0] };
    }
    const meta = actionMetaFor(a.type);
    return { key: `a${i}`, label: meta.title, icon: meta.icon };
}

export function ideaSteps(idea: IdeaDef): Step[][] {
    const plan = idea.plan;
    if (plan.kind === 'automations') {
        return plan.automations.map((auto) => {
            const t = triggerMetaFor(auto.trigger_type);
            return [{ key: 't', label: t.title, icon: t.icon }, ...auto.actions.map((a, i) => actionStep(a, i, idea.needsApps ?? []))];
        });
    }
    if (plan.kind === 'list') return [[{ key: 'l', label: __('Crea las listas listas para usar'), icon: LayoutTemplate }]];
    if (plan.kind === 'dashboard') return [[{ key: 'd', label: __('Arma el tablero sobre tu lista'), icon: LayoutDashboard }]];
    return [[{ key: 'g', label: plan.label, icon: plan.to.startsWith('list:') ? Settings : MousePointerClick }]];
}

function Pill({ step, first }: { step: Step; first: boolean }): JSX.Element {
    const Icon = step.icon;
    return (
        <span
            className={cn(
                'imcrm-inline-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-border imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-font-medium',
                first ? 'imcrm-border-primary/30 imcrm-bg-primary/10 imcrm-text-primary' : 'imcrm-border-border imcrm-bg-card imcrm-text-foreground',
            )}
        >
            {step.app ? <IntegrationLogo integrationKey={step.app} size={16} /> : Icon ? <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden /> : null}
            <span className="imcrm-truncate">{step.label}</span>
        </span>
    );
}

export function IdeaFlow({ idea, compact = false }: { idea: IdeaDef; compact?: boolean }): JSX.Element {
    const rows = ideaSteps(idea);
    const shown = compact ? rows.slice(0, 1) : rows;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="idea-flow">
            {shown.map((row, r) => (
                <div key={r} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                    {row.map((step, i) => (
                        <Fragment key={step.key}>
                            {i > 0 && (
                                <span className="imcrm-ideas-arrow imcrm-relative imcrm-inline-flex imcrm-h-4 imcrm-w-5 imcrm-items-center imcrm-justify-center imcrm-text-muted-foreground" aria-hidden>
                                    <ArrowRight className="imcrm-h-3.5 imcrm-w-3.5" />
                                </span>
                            )}
                            <Pill step={step} first={i === 0 && idea.plan.kind === 'automations'} />
                        </Fragment>
                    ))}
                </div>
            ))}
            {compact && rows.length > 1 && <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{`+ ${rows.length - 1} ${rows.length - 1 === 1 ? __('automatización más') : __('automatizaciones más')}`}</span>}
        </div>
    );
}
