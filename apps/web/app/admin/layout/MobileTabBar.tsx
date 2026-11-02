import { useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { Bell, List as ListIcon, ListChecks, Menu, Pin, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useNotifications } from '@/hooks/useNotifications';
import { useWhatsNewFeed } from '@/hooks/useWhatsNew';
import { moduleEnabled } from '@/lib/cloudFeatures';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { isTabRoot, mobileTabFromPath, type MobileTabId } from './mobileNav';

/**
 * v0.1.342 — La barra de pestañas de abajo, como en las apps del teléfono
 * (sólo bajo 1024 px: en escritorio está el riel). Va como ÚLTIMO hijo de la
 * columna del shell —no `fixed`—, así el área de trabajo se achica sola y lo
 * que se pega al fondo dentro de ella (la barra de scroll horizontal, el
 * «Guardar» de un editor) queda arriba de las pestañas.
 *
 * Mide su alto y lo publica en `--imcrm-bottom-nav`: lo usan los flotantes
 * que viven fuera de la columna (avisos, «Primeros pasos», la barra de
 * selección) para no quedar tapados. En escritorio está oculta y vale 0.
 */
export function MobileTabBar({ onSearch }: { onSearch: () => void }): JSX.Element {
    const { pathname } = useLocation();
    const active = mobileTabFromPath(pathname);
    const inboxOn = moduleEnabled('mentions');
    const notifications = useNotifications(false);
    const unread = inboxOn ? notifications.data?.unread ?? 0 : 0;
    const news = useWhatsNewFeed(true);
    const unseenNews = news.data?.unseen_count ?? 0;

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

    /** Tocar la pestaña en la que ya estás, en su raíz, sube al inicio. */
    const onTabClick = (e: React.MouseEvent, tab: Exclude<MobileTabId, 'search'>): void => {
        if (active === tab && isTabRoot(pathname, tab)) {
            e.preventDefault();
            document.getElementById('imcrm-main')?.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    return (
        <nav
            ref={ref}
            aria-label={__('Navegación principal')}
            data-testid="mobile-tabbar"
            className="imcrm-admin-tabbar imcrm-shrink-0 imcrm-border-t imcrm-border-border imcrm-bg-background imcrm-pb-[env(safe-area-inset-bottom)] lg:imcrm-hidden"
        >
            <ul className="imcrm-mx-auto imcrm-grid imcrm-max-w-xl imcrm-grid-cols-5">
                <li>
                    <TabLink
                        to="/lists"
                        tour="tabbar-lists"
                        icon={ListIcon}
                        label={__('Listas')}
                        active={active === 'lists'}
                        onClick={(e) => onTabClick(e, 'lists')}
                    />
                </li>
                <li>
                    <TabLink
                        to="/my-work"
                        tour="tabbar-mywork"
                        icon={ListChecks}
                        label={__('Mi trabajo')}
                        active={active === 'mywork'}
                        onClick={(e) => onTabClick(e, 'mywork')}
                    />
                </li>
                <li>
                    <button
                        type="button"
                        onClick={onSearch}
                        data-tour="tabbar-search"
                        data-testid="tabbar-search"
                        aria-label={__('Buscar')}
                        className={TAB_CLASS}
                    >
                        <TabIcon icon={Search} active={false} />
                        <span className={labelClass(false)}>{__('Buscar')}</span>
                    </button>
                </li>
                <li>
                    {inboxOn ? (
                        <TabLink
                            to="/avisos"
                            tour="tabbar-inbox"
                            icon={Bell}
                            label={__('Avisos')}
                            ariaLabel={unread > 0 ? sprintf(__('Avisos: %d sin leer'), unread) : __('Avisos')}
                            active={active === 'inbox'}
                            badge={unread > 0 ? (unread > 99 ? '99+' : String(unread)) : null}
                            onClick={(e) => onTabClick(e, 'inbox')}
                        />
                    ) : (
                        <TabLink to="/favorites" tour="tabbar-favorites" icon={Pin} label={__('Favoritos')} active={pathname.startsWith('/favorites')} />
                    )}
                </li>
                <li>
                    <TabLink
                        to="/menu"
                        tour="tabbar-more"
                        icon={Menu}
                        label={__('Más')}
                        ariaLabel={unseenNews > 0 ? sprintf(__('Más · %d novedades sin ver'), unseenNews) : __('Más')}
                        active={active === 'more'}
                        dot={unseenNews > 0}
                        onClick={(e) => onTabClick(e, 'more')}
                    />
                </li>
            </ul>
        </nav>
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
function TabIcon({ icon: Icon, active, badge, dot }: { icon: LucideIcon; active: boolean; badge?: string | null; dot?: boolean }): JSX.Element {
    return (
        <span
            className={cn(
                'imcrm-relative imcrm-flex imcrm-h-7 imcrm-w-12 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-transition-colors',
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

function TabLink({
    to,
    tour,
    icon,
    label,
    ariaLabel,
    active,
    badge,
    dot,
    onClick,
}: {
    to: string;
    /** Ancla de los recorridos (`data-tour`). */
    tour: string;
    icon: LucideIcon;
    label: string;
    ariaLabel?: string;
    active: boolean;
    badge?: string | null;
    dot?: boolean;
    onClick?: (e: React.MouseEvent) => void;
}): JSX.Element {
    return (
        <Link
            to={to}
            data-tour={tour}
            data-testid={tour}
            aria-label={ariaLabel}
            aria-current={active ? 'page' : undefined}
            onClick={onClick}
            className={TAB_CLASS}
        >
            <TabIcon icon={icon} active={active} badge={badge} dot={dot} />
            <span className={labelClass(active)}>{label}</span>
        </Link>
    );
}
