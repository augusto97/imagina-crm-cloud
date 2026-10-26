import { ActiveTimerChip } from '@/admin/layout/ActiveTimerChip';
import { Menu, Search, Sparkles } from 'lucide-react';

import { assistantPanel, useAssistantPanelOpen } from '@/admin/assistant/assistantPanelStore';
import { IncidentsPill } from '@/admin/layout/IncidentsPill';
import { NotificationBell } from '@/admin/layout/NotificationBell';
import { UserMenu } from '@/admin/layout/UserMenu';
import { useSession } from '@/cloud/session';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { useBrandingData } from '@/hooks/useBranding';
import { moduleEnabled } from '@/lib/cloudFeatures';
import { __ } from '@/lib/i18n';
import { PALETTE_SHORTCUT_LABEL } from '@/lib/shortcuts';
import { CAP, useCan } from '@/lib/permissions';
import { useIsGuest } from '@/lib/guest';

/**
 * Topbar:
 *  - Izquierda: hamburger del drawer (sólo mobile) + logo y nombre del
 *    workspace (sólo mobile, v0.1.169: en el teléfono el panel del sidebar
 *    está cerrado casi siempre, así que sin esto la barra quedaba vacía y
 *    no se sabía en qué empresa estabas). En escritorio el nombre vive en
 *    el panel interno del sidebar doble.
 *  - Centro/derecha (v0.1.286): el BUSCADOR visible (abre la paleta, también
 *    en táctil, donde no hay Ctrl+K), problemas, asistente, avisos, tema y el
 *    menú de la persona (cuenta, empresa, atajos, cerrar sesión).
 */
export function Topbar({
    onMenuClick,
    onSearchClick,
    onShowShortcuts,
}: {
    onMenuClick?: () => void;
    onSearchClick?: () => void;
    onShowShortcuts?: () => void;
} = {}): JSX.Element {
    const assistantOpen = useAssistantPanelOpen();
    const branding = useBrandingData();
    const activeTenantId = useSession((s) => s.activeTenantId);
    const memberships = useSession((s) => s.memberships);
    const membership = memberships.find((m) => m.tenant_id === activeTenantId);
    const workspaceTitle = branding.data?.app_name ?? membership?.tenant_name ?? 'Imagina Base';
    const logoUrl = branding.data?.logo_url ?? null;
    // C2 — «Usar el asistente IA» (rol propio); C3 — un invitado no lo usa.
    const canUseAssistant = useCan(CAP.USE_AI_ASSISTANT);
    const isGuest = useIsGuest();

    return (
        <header className="imcrm-admin-topbar imcrm-flex imcrm-h-12 imcrm-shrink-0 imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-bg-background imcrm-px-2 sm:imcrm-gap-4 sm:imcrm-px-6 lg:imcrm-h-10 lg:imcrm-px-4">
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-1">
                {/* Hamburguesa: abre el sidebar (riel+panel) como drawer (sólo mobile). */}
                <button
                    type="button"
                    onClick={onMenuClick}
                    aria-label={__('Abrir menú')}
                    data-testid="imcrm-menu-button"
                    className="imcrm-inline-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-text-foreground/80 imcrm-transition-colors hover:imcrm-bg-accent lg:imcrm-hidden"
                >
                    <Menu className="imcrm-h-5 imcrm-w-5" />
                </button>
                {/* Marca del workspace (sólo mobile). */}
                <span
                    className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2 lg:imcrm-hidden"
                    data-testid="imcrm-topbar-brand"
                >
                    {logoUrl ? (
                        <img src={logoUrl} alt="" className="imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-rounded-md imcrm-object-contain" />
                    ) : (
                        <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-sidebar imcrm-text-sidebar-accent-foreground">
                            <Sparkles className="imcrm-h-3.5 imcrm-w-3.5" />
                        </span>
                    )}
                    <span className="imcrm-truncate imcrm-text-[15px] imcrm-font-semibold imcrm-text-foreground">
                        {workspaceTitle}
                    </span>
                </span>
                {/* Buscador (escritorio): parece un campo, abre la paleta. */}
                {onSearchClick && (
                    <button
                        type="button"
                        onClick={onSearchClick}
                        data-testid="topbar-search"
                        aria-label={__('Buscar')}
                        aria-keyshortcuts="Control+K Meta+K"
                        className="imcrm-hidden imcrm-h-7 imcrm-w-full imcrm-max-w-sm imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-px-2.5 imcrm-text-[13px] imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-border-foreground/20 hover:imcrm-text-foreground lg:imcrm-flex"
                    >
                        <Search className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                        <span className="imcrm-flex-1 imcrm-truncate imcrm-text-left">{__('Buscar listas, registros, dashboards…')}</span>
                        <kbd className="imcrm-shrink-0 imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-1.5 imcrm-text-[10px] imcrm-font-medium">
                            {PALETTE_SHORTCUT_LABEL}
                        </kbd>
                    </button>
                )}
            </div>

            <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1 sm:imcrm-gap-2">
                {/* v0.1.291 — el cronómetro en curso (registro de tiempo). */}
                {!isGuest && <ActiveTimerChip />}

                {/* v0.1.285 — algo que corre solo dejó de funcionar. */}
                {!isGuest && <IncidentsPill />}

                {/* Buscador (mobile/tablet): sólo la lupa. */}
                {onSearchClick && (
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label={__('Buscar')}
                        title={__('Buscar')}
                        data-testid="topbar-search-icon"
                        className="lg:imcrm-hidden"
                        onClick={onSearchClick}
                    >
                        <Search className="imcrm-h-4 imcrm-w-4" />
                    </Button>
                )}

                {/* v0.1.181 — asistente IA (ADR-S21). */}
                {canUseAssistant && !isGuest && (
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label={__('Asistente IA')}
                    title={__('Asistente IA')}
                    aria-pressed={assistantOpen}
                    data-testid="imcrm-ai-toggle"
                    className={assistantOpen ? 'imcrm-bg-accent imcrm-text-primary' : 'imcrm-text-primary'}
                    onClick={assistantPanel.toggle}
                >
                    <Sparkles className="imcrm-h-4 imcrm-w-4" />
                </Button>
                )}

                {moduleEnabled('mentions') && <NotificationBell />}

                {/* v0.1.112 — claro ⇄ oscuro (en el teléfono vive en el menú
                    de la persona: la barra no tiene lugar para todo). */}
                <ThemeToggle className="imcrm-hidden imcrm-text-foreground sm:imcrm-inline-flex" />

                <UserMenu onShowShortcuts={onShowShortcuts} />
            </div>
        </header>
    );
}
