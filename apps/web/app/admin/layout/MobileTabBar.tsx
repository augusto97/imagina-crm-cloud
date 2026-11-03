import { useLayoutEffect, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router';

import { assistantPanel } from '@/admin/assistant/assistantPanelStore';
import { useNotifications } from '@/hooks/useNotifications';
import { needsEntities, useMobileNav, useMobileNavContext } from '@/hooks/useMobileNav';
import { useWhatsNewFeed } from '@/hooks/useWhatsNew';
import { rememberTabCount } from '@/lib/bootSplash';
import { moduleEnabled } from '@/lib/cloudFeatures';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { MORE_TAB, activeMobileTab, isTabRoot, resolveMobileTabs, type MobileTab, type TabIconComponent } from './mobileNav';

/**
 * v0.1.342 — La barra de pestañas de abajo, como en las apps del teléfono
 * (sólo bajo 1024 px: en escritorio está el riel). Va como ÚLTIMO hijo de la
 * columna del shell —no `fixed`—, así el área de trabajo se achica sola y lo
 * que se pega al fondo dentro de ella (la barra de scroll horizontal, el
 * «Guardar» de un editor) queda arriba de las pestañas.
 *
 * v0.1.347 — Personalizable: cada persona elige cuántos botones lleva y
 * cuáles (Ajustes → Apariencia, o «Más → Barra de abajo»). «Más» va siempre
 * al final.
 *
 * Mide su alto y lo publica en `--imcrm-bottom-nav`: lo usan los flotantes
 * que viven fuera de la columna (avisos, «Primeros pasos», la barra de
 * selección) para no quedar tapados. En escritorio está oculta y vale 0.
 */
export function MobileTabBar({ onSearch, onScan }: { onSearch: () => void; onScan: () => void }): JSX.Element {
    const { pathname } = useLocation();
    const { config } = useMobileNav();
    const ctx = useMobileNavContext(needsEntities(config));
    const tabs = useMemo(() => resolveMobileTabs(config, ctx), [config, ctx]);
    const active = activeMobileTab(pathname, tabs);

    const inboxOn = moduleEnabled('mentions');
    const notifications = useNotifications(false);
    const unread = inboxOn ? notifications.data?.unread ?? 0 : 0;
    const news = useWhatsNewFeed(true);
    const unseenNews = news.data?.unseen_count ?? 0;
    const newsOnBar = tabs.some((t) => t.section === 'whatsnew');

    // La pantalla de arranque dibuja la misma cantidad de pestañas.
    const count = tabs.length + 1;
    useLayoutEffect(() => rememberTabCount(count), [count]);

    const ref = useRef<HTMLElement | null>(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const root = document.documentElement;
        const apply = (): void => root.style.setProperty('--imcrm-bottom-nav', `${el.offsetHeight}px`);
        apply();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
        ro?.observe(el);
        window.addEventListener('resize', apply);
        return () => {
            ro?.disconnect();
            window.removeEventListener('resize', apply);
            root.style.removeProperty('--imcrm-bottom-nav');
        };
    }, []);

    /** Tocar la pestaña en la que ya estás, en su inicio, sube al principio. */
    const onTabClick = (e: React.MouseEvent, tab: Pick<MobileTab, 'key' | 'to'>): void => {
        if (active === tab.key && isTabRoot(pathname, tab)) {
            e.preventDefault();
            document.getElementById('imcrm-main')?.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const runAction = (tab: MobileTab): void => {
        if (tab.action === 'search') onSearch();
        else if (tab.action === 'scan') onScan();
        else if (tab.action === 'assistant') assistantPanel.toggle();
    };

    const badgeFor = (tab: MobileTab): string | null => {
        if (tab.section === 'inbox' && unread > 0) return unread > 99 ? '99+' : String(unread);
        if (tab.section === 'whatsnew' && unseenNews > 0) return unseenNews > 9 ? '9+' : String(unseenNews);
        return null;
    };
    const ariaFor = (tab: MobileTab): string | undefined => {
        if (tab.section === 'inbox' && unread > 0) return sprintf(__('Avisos: %d sin leer'), unread);
        if (tab.section === 'whatsnew' && unseenNews > 0) return sprintf(__('Novedades: %d sin ver'), unseenNews);
        return config.labels ? undefined : __(tab.label);
    };

    const moreDot = unseenNews > 0 && !newsOnBar;
    const moreAria = moreDot ? sprintf(__('Más · %d novedades sin ver'), unseenNews) : config.labels ? undefined : __('Más');

    return (
        <nav
            ref={ref}
            aria-label={__('Navegación principal')}
            data-testid="mobile-tabbar"
            data-tour="tabbar-bar"
            data-tabs={count}
            className="imcrm-admin-tabbar imcrm-shrink-0 imcrm-border-t imcrm-border-border imcrm-bg-background imcrm-pb-[env(safe-area-inset-bottom)] lg:imcrm-hidden"
        >
            <ul className="imcrm-mx-auto imcrm-grid imcrm-max-w-xl" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
                {tabs.map((tab) => (
                    <li key={tab.key}>
                        {tab.action ? (
                            <TabButton
                                tab={tab}
                                labels={config.labels}
                                ariaLabel={ariaFor(tab) ?? __(tab.label)}
                                onClick={() => runAction(tab)}
                            />
                        ) : tab.to ? (
                            <TabLink
                                to={tab.to}
                                dataTour={tab.dataTour}
                                icon={tab.icon}
                                label={tab.section ? __(tab.label) : tab.label}
                                labels={config.labels}
                                ariaLabel={ariaFor(tab)}
                                active={active === tab.key}
                                badge={badgeFor(tab)}
                                onClick={(e) => onTabClick(e, tab)}
                            />
                        ) : (
                            // Una lista o un tablero que todavía se está cargando.
                            <span className={cn(TAB_CLASS, 'imcrm-opacity-50')} aria-hidden data-tour={tab.dataTour}>
                                <TabIcon icon={tab.icon} active={false} />
                                {config.labels && <span className={labelClass(false)}>&nbsp;</span>}
                            </span>
                        )}
                    </li>
                ))}
                <li>
                    <TabLink
                        to={MORE_TAB.to}
                        dataTour={MORE_TAB.dataTour}
                        icon={MORE_TAB.icon}
                        label={__(MORE_TAB.label)}
                        labels={config.labels}
                        ariaLabel={moreAria}
                        active={active === MORE_TAB.key}
                        dot={moreDot}
                        onClick={(e) => onTabClick(e, MORE_TAB)}
                    />
                </li>
            </ul>
        </nav>
    );
}

/**
 * La misma barra, quieta: la vista previa del editor. Dibuja exactamente lo
 * que se va a ver abajo (íconos, nombres, cantidad), sin navegar.
 */
export function MobileTabBarPreview({ tabs, labels }: { tabs: readonly MobileTab[]; labels: boolean }): JSX.Element {
    const count = tabs.length + 1;
    return (
        <div className="imcrm-border-t imcrm-border-border imcrm-bg-background" data-testid="tabbar-preview" aria-hidden>
            <ul className="imcrm-grid" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
                {[...tabs, { key: MORE_TAB.key, label: MORE_TAB.label, icon: MORE_TAB.icon, section: undefined } as Pick<MobileTab, 'key' | 'label' | 'icon' | 'section'>].map(
                    (tab, i) => (
                        <li key={tab.key}>
                            <span className={TAB_CLASS}>
                                <TabIcon icon={tab.icon} active={i === 0} />
                                {labels && <span className={labelClass(i === 0)}>{tab.section || tab.key === MORE_TAB.key ? __(tab.label) : tab.label}</span>}
                            </span>
                        </li>
                    ),
                )}
            </ul>
        </div>
    );
}

const TAB_CLASS =
    'imcrm-flex imcrm-h-14 imcrm-w-full imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-0.5 imcrm-text-muted-foreground imcrm-transition-colors active:imcrm-bg-muted/60 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-inset focus-visible:imcrm-ring-ring';

function labelClass(active: boolean): string {
    return cn(
        'imcrm-max-w-full imcrm-truncate imcrm-px-0.5 imcrm-text-[11px] imcrm-leading-tight',
        active ? 'imcrm-font-semibold imcrm-text-primary' : 'imcrm-font-medium',
    );
}

/** El ícono dentro de una «pastilla» que se rellena en la pestaña activa (Material 3). */
function TabIcon({ icon: Icon, active, badge, dot }: { icon: TabIconComponent; active: boolean; badge?: string | null; dot?: boolean }): JSX.Element {
    return (
        <span
            className={cn(
                'imcrm-relative imcrm-flex imcrm-h-7 imcrm-w-12 imcrm-max-w-full imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-transition-colors',
                active ? 'imcrm-bg-primary/[0.12] imcrm-text-primary' : '',
            )}
        >
            <Icon className="imcrm-h-[22px] imcrm-w-[22px]" strokeWidth={active ? 2.25 : 1.9} aria-hidden />
            {badge && (
                <span
                    aria-hidden
                    data-testid="tabbar-badge"
                    className="imcrm-absolute imcrm--top-1 imcrm-left-[60%] imcrm-flex imcrm-h-[18px] imcrm-min-w-[18px] imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-destructive imcrm-px-1 imcrm-text-[10px] imcrm-font-semibold imcrm-leading-none imcrm-text-destructive-foreground imcrm-ring-2 imcrm-ring-background"
                >
                    {badge}
                </span>
            )}
            {dot && !badge && (
                <span
                    aria-hidden
                    data-testid="tabbar-dot"
                    className="imcrm-absolute imcrm-right-2.5 imcrm-top-0 imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-full imcrm-bg-primary imcrm-ring-2 imcrm-ring-background"
                />
            )}
        </span>
    );
}

function TabButton({ tab, labels, ariaLabel, onClick }: { tab: MobileTab; labels: boolean; ariaLabel: string; onClick: () => void }): JSX.Element {
    return (
        <button type="button" onClick={onClick} data-tour={tab.dataTour} data-testid={tab.dataTour} aria-label={ariaLabel} className={TAB_CLASS}>
            <TabIcon icon={tab.icon} active={false} />
            {labels && <span className={labelClass(false)}>{__(tab.label)}</span>}
        </button>
    );
}

function TabLink({
    to,
    dataTour,
    icon,
    label,
    labels,
    ariaLabel,
    active,
    badge,
    dot,
    onClick,
}: {
    to: string;
    /** Ancla de los recorridos (`data-tour`). */
    dataTour: string;
    icon: TabIconComponent;
    label: string;
    labels: boolean;
    ariaLabel?: string;
    active: boolean;
    badge?: string | null;
    dot?: boolean;
    onClick?: (e: React.MouseEvent) => void;
}): JSX.Element {
    return (
        <Link
            to={to}
            data-tour={dataTour}
            data-testid={dataTour}
            aria-label={ariaLabel ?? (labels ? undefined : label)}
            aria-current={active ? 'page' : undefined}
            onClick={onClick}
            className={TAB_CLASS}
        >
            <TabIcon icon={icon} active={active} badge={badge} dot={dot} />
            {labels && <span className={labelClass(active)}>{label}</span>}
        </Link>
    );
}
