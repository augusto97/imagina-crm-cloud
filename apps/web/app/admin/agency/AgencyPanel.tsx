import { Link } from 'react-router';
import { Building2, Loader2, LogIn } from 'lucide-react';

import { initials } from '@/admin/layout/WorkspaceSwitcher';
import { useToast } from '@/components/ui/toast';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { clientStateLabel } from './agencyUi';
import { useAgencyClients, useEnterAgencyClient } from './useAgency';

const ROW =
    'imcrm-flex imcrm-min-h-10 imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2.5 imcrm-py-1.5 imcrm-text-left imcrm-text-[14px] imcrm-transition-colors imcrm-duration-100 lg:imcrm-min-h-0 lg:imcrm-text-[13px]';
const ACTIVE = 'imcrm-bg-background imcrm-font-medium imcrm-text-foreground imcrm-shadow-imcrm-sm imcrm-ring-1 imcrm-ring-border';
const IDLE = 'imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground';

/** Cuántas empresas cliente se listan en el panel (el resto, en la página). */
const PANEL_MAX = 25;

/**
 * v0.1.449 (ADR-S108) — Panel lateral de «Agencia»: la página de las empresas
 * cliente y un acceso directo para entrar a cada una.
 */
export function AgencyPanel({ pathname }: { pathname: string }): JSX.Element {
    const clients = useAgencyClients();
    const enter = useEnterAgencyClient();
    const toast = useToast();
    const list = clients.data ?? [];
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="agency-panel">
            <Link to="/agency" aria-current={pathname === '/agency' ? 'page' : undefined} className={cn(ROW, pathname === '/agency' ? ACTIVE : IDLE)}>
                <Building2 className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                <span className="imcrm-truncate">{__('Todas las empresas cliente')}</span>
            </Link>
            {clients.isLoading && <Loader2 className="imcrm-mx-2.5 imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-muted-foreground" />}
            {list.length > 0 && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <h3 className="imcrm-px-2.5 imcrm-pb-1 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.1em] imcrm-text-muted-foreground">
                        {__('Entrar a')}
                    </h3>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                        {list.slice(0, PANEL_MAX).map((c) => {
                            const state = clientStateLabel(c);
                            return (
                                <li key={c.id}>
                                    <button
                                        type="button"
                                        className={cn(ROW, IDLE, 'imcrm-group')}
                                        title={`${__('Entrar a')} ${c.name} · ${state.label}`}
                                        disabled={enter.isPending}
                                        onClick={() => enter.mutate(c.id, { onError: (err) => toast.error(__('No se pudo entrar'), err instanceof Error ? err.message : String(err)) })}
                                        data-testid="agency-panel-client"
                                    >
                                        <span
                                            aria-hidden
                                            className="imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-bg-muted imcrm-text-[9px] imcrm-font-semibold imcrm-ring-1 imcrm-ring-border"
                                        >
                                            {initials(c.name)}
                                        </span>
                                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{c.name}</span>
                                        {state.tone !== 'ok' && <span className="imcrm-h-1.5 imcrm-w-1.5 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-warning" aria-label={state.label} />}
                                        <LogIn className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-opacity-0 group-hover:imcrm-opacity-100" aria-hidden />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    {list.length > PANEL_MAX && (
                        <Link to="/agency" className="imcrm-px-2.5 imcrm-text-[12px] imcrm-text-primary hover:imcrm-underline">
                            {`${__('Ver las')} ${list.length} ${__('empresas')}`}
                        </Link>
                    )}
                </div>
            )}
        </div>
    );
}
