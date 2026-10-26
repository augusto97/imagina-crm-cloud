import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { FileText, Inbox, Info, Settings, X } from 'lucide-react';

import { Topbar } from '@/admin/layout/Topbar';
import { useSession } from '@/cloud/session';
import { useSharedWithMe } from '@/hooks/useGuests';
import { DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * C3 — El shell de una persona INVITADA de afuera. Sin riel de la empresa
 * (listas, tableros, Mi trabajo, Ajustes del workspace): sólo «Compartido
 * conmigo» con lo que le compartieron, su cuenta y un aviso permanente de
 * que es invitada. El servidor igual le responde 403 a todo lo demás.
 */
export function GuestShell(): JSX.Element {
    const [mobileOpen, setMobileOpen] = useState(false);
    const location = useLocation();
    const tenantName = useSession((s) => s.memberships.find((m) => m.tenant_id === s.activeTenantId)?.tenant_name ?? '');
    const shared = useSharedWithMe();

    useEffect(() => setMobileOpen(false), [location.pathname]);

    const nav = (
        <nav aria-label={__('Compartido conmigo')} className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-p-3">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                <span className="imcrm-truncate imcrm-px-2 imcrm-text-[13px] imcrm-font-semibold imcrm-text-foreground">{tenantName}</span>
                <span className="imcrm-px-2 imcrm-text-[11px] imcrm-text-muted-foreground">{__('Eres invitado')}</span>
            </div>
            <GuestNavItem to="/shared" icon={<Inbox className="imcrm-h-4 imcrm-w-4" />} label={__('Compartido conmigo')} end />
            {(shared.data?.lists.length ?? 0) > 0 && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                    <span className="imcrm-px-2 imcrm-text-[11px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {__('Listas')}
                    </span>
                    {shared.data!.lists.map((l) => {
                        const Icon = listIcon(l.icon) ?? DEFAULT_LIST_ICON;
                        return (
                            <GuestNavItem
                                key={l.id}
                                to={`/lists/${l.slug}/records`}
                                icon={<Icon className="imcrm-h-4 imcrm-w-4" style={listColor(l.color) ? { color: listColor(l.color) } : undefined} />}
                                label={l.name}
                            />
                        );
                    })}
                </div>
            )}
            {(shared.data?.records.length ?? 0) > 0 && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                    <span className="imcrm-px-2 imcrm-text-[11px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {__('Registros')}
                    </span>
                    {shared.data!.records.slice(0, 30).map((r) => (
                        <GuestNavItem
                            key={r.id}
                            to={`/lists/${r.list_slug}/records/${r.id}`}
                            icon={<FileText className="imcrm-h-4 imcrm-w-4" />}
                            label={r.title}
                            sub={r.list_name}
                        />
                    ))}
                </div>
            )}
            <div className="imcrm-mt-auto imcrm-border-t imcrm-border-border imcrm-pt-3">
                <GuestNavItem to="/settings" icon={<Settings className="imcrm-h-4 imcrm-w-4" />} label={__('Tu cuenta')} />
            </div>
        </nav>
    );

    return (
        <div className="imcrm-flex imcrm-h-screen imcrm-min-h-screen imcrm-w-full imcrm-overflow-hidden imcrm-bg-background imcrm-text-foreground" data-testid="guest-shell">
            <aside className="imcrm-hidden imcrm-w-60 imcrm-shrink-0 imcrm-overflow-y-auto imcrm-border-r imcrm-border-border imcrm-bg-canvas lg:imcrm-flex lg:imcrm-flex-col">
                {nav}
            </aside>
            {mobileOpen && (
                <div className="imcrm-fixed imcrm-inset-0 imcrm-z-40 imcrm-flex lg:imcrm-hidden" role="dialog" aria-modal="true" aria-label={__('Menú')}>
                    <div className="imcrm-absolute imcrm-inset-0 imcrm-bg-black/40" onClick={() => setMobileOpen(false)} aria-hidden />
                    <div className="imcrm-relative imcrm-flex imcrm-w-[min(88vw,320px)] imcrm-flex-col imcrm-overflow-y-auto imcrm-bg-canvas">
                        <button
                            type="button"
                            onClick={() => setMobileOpen(false)}
                            aria-label={__('Cerrar menú')}
                            className="imcrm-absolute imcrm-right-2 imcrm-top-2 imcrm-inline-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-md hover:imcrm-bg-accent"
                        >
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </button>
                        {nav}
                    </div>
                </div>
            )}
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                <Topbar onMenuClick={() => setMobileOpen(true)} />
                <div
                    role="status"
                    data-testid="guest-banner"
                    className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-bg-info/10 imcrm-px-4 imcrm-py-1.5 imcrm-text-xs imcrm-text-foreground/80"
                >
                    <Info className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-info" aria-hidden />
                    <span>
                        {sprintf(__('Eres invitado de «%s»: sólo ves lo que te compartieron.'), tenantName)}
                    </span>
                </div>
                <main id="imcrm-main" aria-label={__('Contenido principal')} className="imcrm-flex-1 imcrm-overflow-auto imcrm-px-3 imcrm-py-2 sm:imcrm-px-4" tabIndex={-1}>
                    <div className="imcrm-w-full">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
}

function GuestNavItem({ to, icon, label, sub, end }: { to: string; icon: React.ReactNode; label: string; sub?: string; end?: boolean }): JSX.Element {
    return (
        <NavLink
            to={to}
            end={end}
            className={({ isActive }) =>
                cn(
                    'imcrm-flex imcrm-min-h-8 imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1 imcrm-text-[13px] imcrm-text-foreground/85 hover:imcrm-bg-accent',
                    isActive && 'imcrm-bg-background imcrm-font-medium imcrm-text-foreground imcrm-ring-1 imcrm-ring-border',
                )
            }
        >
            <span className="imcrm-shrink-0 imcrm-text-muted-foreground">{icon}</span>
            <span className="imcrm-min-w-0 imcrm-flex-1">
                <span className="imcrm-block imcrm-truncate">{label}</span>
                {sub && <span className="imcrm-block imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">{sub}</span>}
            </span>
        </NavLink>
    );
}

/** C3 — «Compartido conmigo»: la portada del invitado. */
export function SharedWithMePage(): JSX.Element {
    const shared = useSharedWithMe();
    const data = shared.data;
    const empty = data && data.lists.length === 0 && data.records.length === 0;
    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-4xl imcrm-flex-col imcrm-gap-6 imcrm-py-2" data-testid="shared-with-me">
            <header>
                <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">{__('Compartido conmigo')}</h1>
                <p className="imcrm-text-sm imcrm-text-muted-foreground">
                    {data ? sprintf(__('Lo que «%s» compartió contigo.'), data.tenant_name) : __('Cargando…')}
                </p>
            </header>
            {shared.isLoading && <div className="imcrm-h-32 imcrm-animate-pulse imcrm-rounded-lg imcrm-bg-muted/40" />}
            {empty && (
                <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-8 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Por ahora no tienes nada compartido. Cuando te compartan una lista o un registro, aparece aquí.')}
                </p>
            )}
            {data && data.lists.length > 0 && (
                <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <h2 className="imcrm-text-sm imcrm-font-semibold">{__('Listas')}</h2>
                    <ul className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                        {data.lists.map((l) => {
                            const Icon = listIcon(l.icon) ?? DEFAULT_LIST_ICON;
                            return (
                                <li key={l.id}>
                                    <Link
                                        to={`/lists/${l.slug}/records`}
                                        data-testid="shared-list-card"
                                        className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3 hover:imcrm-border-primary/40"
                                    >
                                        <Icon className="imcrm-h-5 imcrm-w-5 imcrm-shrink-0" style={listColor(l.color) ? { color: listColor(l.color) } : undefined} />
                                        <span className="imcrm-min-w-0 imcrm-flex-1">
                                            <span className="imcrm-block imcrm-truncate imcrm-text-sm imcrm-font-medium">{l.name}</span>
                                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__(LEVEL_TEXT[l.level])}</span>
                                        </span>
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}
            {data && data.records.length > 0 && (
                <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <h2 className="imcrm-text-sm imcrm-font-semibold">{__('Registros')}</h2>
                    <ul className="imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
                        {data.records.map((r) => (
                            <li key={r.id}>
                                <Link
                                    to={`/lists/${r.list_slug}/records/${r.id}`}
                                    data-testid="shared-record-row"
                                    className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-2.5 hover:imcrm-bg-muted/40"
                                >
                                    <FileText className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                    <span className="imcrm-min-w-0 imcrm-flex-1">
                                        <span className="imcrm-block imcrm-truncate imcrm-text-sm imcrm-font-medium">{r.title}</span>
                                        <span className="imcrm-block imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{r.list_name}</span>
                                    </span>
                                    <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground">{__(LEVEL_TEXT[r.level])}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}

const LEVEL_TEXT = { view: 'Puedes ver', comment: 'Puedes ver y comentar', edit: 'Puedes ver, comentar y editar' } as const;
