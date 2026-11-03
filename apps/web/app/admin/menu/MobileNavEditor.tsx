import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Lock, Plus, RotateCcw, Users, X } from 'lucide-react';
import {
    MOBILE_NAV_MAX_ITEMS,
    MOBILE_NAV_MIN_ITEMS,
    mobileNavItemKey,
    type MobileNavConfig,
} from '@imagina-base/shared';

import { MobileTabBarPreview } from '@/admin/layout/MobileTabBar';
import {
    MORE_TAB,
    MOBILE_SECTIONS,
    moveItem,
    resolveMobileTabs,
    withItemCount,
    type MobileTab,
    type TabIconComponent,
} from '@/admin/layout/mobileNav';
import { useSession } from '@/cloud/session';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { mobileNavKey, saveTeamMobileNav, useMobileNav, useMobileNavContext, useSaveMobileNav } from '@/hooks/useMobileNav';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { paletteMatches } from '@/lib/paletteSearch';

/**
 * v0.1.347 — El editor de la barra de abajo del celular. Cada persona elige
 * CUÁNTOS botones lleva (de 3 a 6, contando «Más») y CUÁLES, los ordena y
 * decide si se ven los nombres debajo de los íconos. El cambio se ve al
 * instante —en la vista previa y en la barra de abajo de verdad— y se guarda
 * solo en su cuenta.
 *
 * El admin además puede dejar su barra como la PREDETERMINADA del equipo:
 * vale para quien no eligió la suya.
 */
export function MobileNavEditor(): JSX.Element {
    const qc = useQueryClient();
    const toast = useToast();
    const tenantId = useSession((s) => s.activeTenantId);
    const isAdmin = useSession((s) => s.memberships.find((m) => m.tenant_id === s.activeTenantId)?.role === 'admin');
    const { config, source, state } = useMobileNav();
    const ctx = useMobileNavContext({ lists: true, dashboards: true });
    const { save } = useSaveMobileNav();
    const [listQuery, setListQuery] = useState('');
    const [allLists, setAllLists] = useState(false);
    const [allDashboards, setAllDashboards] = useState(false);
    const [teamBusy, setTeamBusy] = useState(false);

    const tabs = useMemo(() => resolveMobileTabs(config, ctx), [config, ctx]);
    const items = tabs.map((t) => t.key);
    const total = items.length + 1;
    const full = items.length >= MOBILE_NAV_MAX_ITEMS;

    const update = (next: Partial<MobileNavConfig>): void => {
        save({ items: next.items ?? items, labels: next.labels ?? config.labels });
    };

    const freeSections = MOBILE_SECTIONS.filter((d) => ctx.available(d.section) && !items.includes(d.section));
    const lists = useMemo(() => {
        const all = ctx.lists ? [...ctx.lists.entries()] : [];
        const q = listQuery.trim();
        return all.filter(([id, l]) => !items.includes(`list:${id}`) && (q === '' || paletteMatches(l.name, q)));
    }, [ctx.lists, items, listQuery]);
    const dashboards = useMemo(
        () => (ctx.dashboards ? [...ctx.dashboards.entries()].filter(([id]) => !items.includes(`dashboard:${id}`)) : []),
        [ctx.dashboards, items],
    );

    const add = (key: string): void => {
        if (full) return;
        update({ items: [...items, key] });
    };

    const setTeam = async (value: MobileNavConfig | null): Promise<void> => {
        setTeamBusy(true);
        try {
            const next = await saveTeamMobileNav(value);
            qc.setQueryData(mobileNavKey(tenantId), next);
            toast.success(value ? __('Listo: es la barra predeterminada del equipo') : __('Quitaste la barra del equipo'));
        } catch {
            toast.error(__('No se pudo guardar la barra del equipo'));
        } finally {
            setTeamBusy(false);
        }
    };

    const sourceText =
        source === 'own'
            ? __('Es tu barra: la elegiste tú.')
            : source === 'team'
              ? __('Estás usando la barra que eligió el administrador para el equipo. Si cambias algo, pasa a ser tuya.')
              : __('Es la barra de siempre. Si cambias algo, pasa a ser tuya.');

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-5" data-testid="mobilenav-editor" data-tour="mobilenav-editor">
            {/* Vista previa: exactamente lo que se ve abajo. */}
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <div className="imcrm-mx-auto imcrm-w-full imcrm-max-w-[390px] imcrm-overflow-hidden imcrm-rounded-2xl imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-shadow-sm">
                    <div className="imcrm-flex imcrm-h-16 imcrm-items-center imcrm-justify-center imcrm-px-4 imcrm-text-[12px] imcrm-text-muted-foreground">
                        {__('Así se ve tu barra de abajo')}
                    </div>
                    <MobileTabBarPreview tabs={tabs} labels={config.labels} />
                </div>
                <p className="imcrm-text-center imcrm-text-[12px] imcrm-text-muted-foreground" data-testid="mobilenav-source">
                    {sourceText}
                </p>
            </section>

            {/* Cuántos botones. */}
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <h3 className="imcrm-text-[15px] imcrm-font-semibold">{__('Cantidad de botones')}</h3>
                <div role="radiogroup" aria-label={__('Cantidad de botones')} className="imcrm-grid imcrm-grid-cols-4 imcrm-gap-1 imcrm-rounded-lg imcrm-bg-muted imcrm-p-1">
                    {[MOBILE_NAV_MIN_ITEMS + 1, 4, 5, MOBILE_NAV_MAX_ITEMS + 1].map((n) => {
                        const on = n === total;
                        return (
                            <button
                                key={n}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                data-testid={`mobilenav-count-${n}`}
                                onClick={() => update({ items: withItemCount(items, n, ctx.available) })}
                                className={cn(
                                    'imcrm-flex imcrm-min-h-10 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-[15px] imcrm-transition-colors',
                                    on ? 'imcrm-bg-background imcrm-font-semibold imcrm-shadow-sm' : 'imcrm-text-muted-foreground',
                                )}
                            >
                                {n}
                            </button>
                        );
                    })}
                </div>
                <p className="imcrm-text-[12px] imcrm-text-muted-foreground">
                    {__('Contando «Más», que va siempre al final: desde ahí llegas a todo lo que no está en la barra.')}
                </p>
            </section>

            {/* Qué botones y en qué orden. */}
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <h3 className="imcrm-text-[15px] imcrm-font-semibold">{__('Tus botones, en orden')}</h3>
                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card">
                    {tabs.map((tab, i) => (
                        <li key={tab.key} className="imcrm-flex imcrm-min-h-[52px] imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-1.5" data-testid={`mobilenav-item-${tab.key}`}>
                            <span className="imcrm-w-4 imcrm-text-center imcrm-text-[12px] imcrm-tabular-nums imcrm-text-muted-foreground">{i + 1}</span>
                            <IconChip icon={tab.icon} />
                            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                                <span className="imcrm-truncate imcrm-text-[15px]">{tabTitle(tab)}</span>
                                <span className="imcrm-truncate imcrm-text-[12px] imcrm-text-muted-foreground">{tabHint(tab)}</span>
                            </span>
                            <span className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-0.5">
                                <IconButton label={sprintf(__('Subir «%s»'), tabTitle(tab))} disabled={i === 0} onClick={() => update({ items: moveItem(items, i, -1) })} testId={`mobilenav-up-${tab.key}`}>
                                    <ArrowUp className="imcrm-h-4 imcrm-w-4" aria-hidden />
                                </IconButton>
                                <IconButton
                                    label={sprintf(__('Bajar «%s»'), tabTitle(tab))}
                                    disabled={i === tabs.length - 1}
                                    onClick={() => update({ items: moveItem(items, i, 1) })}
                                    testId={`mobilenav-down-${tab.key}`}
                                >
                                    <ArrowDown className="imcrm-h-4 imcrm-w-4" aria-hidden />
                                </IconButton>
                                <IconButton
                                    label={sprintf(__('Quitar «%s»'), tabTitle(tab))}
                                    disabled={items.length <= MOBILE_NAV_MIN_ITEMS}
                                    onClick={() => update({ items: items.filter((k) => k !== tab.key) })}
                                    testId={`mobilenav-remove-${tab.key}`}
                                >
                                    <X className="imcrm-h-4 imcrm-w-4" aria-hidden />
                                </IconButton>
                            </span>
                        </li>
                    ))}
                    <li className="imcrm-flex imcrm-min-h-[52px] imcrm-items-center imcrm-gap-3 imcrm-bg-muted/30 imcrm-px-3 imcrm-py-1.5" data-testid="mobilenav-item-more">
                        <span className="imcrm-w-4 imcrm-text-center imcrm-text-[12px] imcrm-tabular-nums imcrm-text-muted-foreground">{tabs.length + 1}</span>
                        <IconChip icon={MORE_TAB.icon} />
                        <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                            <span className="imcrm-truncate imcrm-text-[15px]">{__('Más')}</span>
                            <span className="imcrm-truncate imcrm-text-[12px] imcrm-text-muted-foreground">{__('Siempre al final: tu cuenta, Ajustes y todo lo demás')}</span>
                        </span>
                        <Lock className="imcrm-mr-2 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-label={__('Fijo')} />
                    </li>
                </ul>
                {items.length <= MOBILE_NAV_MIN_ITEMS && (
                    <p className="imcrm-text-[12px] imcrm-text-muted-foreground">{__('La barra lleva al menos dos botones además de «Más».')}</p>
                )}
            </section>

            {/* Agregar. */}
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="mobilenav-add">
                <div>
                    <h3 className="imcrm-text-[15px] imcrm-font-semibold">{__('Agregar un botón')}</h3>
                    {full && (
                        <p className="imcrm-mt-1 imcrm-text-[12px] imcrm-text-muted-foreground" data-testid="mobilenav-full">
                            {__('Tu barra está llena (6 botones con «Más»). Quita uno para agregar otro.')}
                        </p>
                    )}
                </div>
                <AddGroup label={__('Secciones')}>
                    {freeSections
                        .filter((d) => d.group === 'go')
                        .map((d) => (
                            <AddRow key={d.section} icon={d.icon} label={__(d.label)} hint={__(d.hint)} disabled={full} onClick={() => add(d.section)} testId={`mobilenav-add-${d.section}`} />
                        ))}
                </AddGroup>
                <AddGroup label={__('Acciones')}>
                    {freeSections
                        .filter((d) => d.group === 'action')
                        .map((d) => (
                            <AddRow key={d.section} icon={d.icon} label={__(d.label)} hint={__(d.hint)} disabled={full} onClick={() => add(d.section)} testId={`mobilenav-add-${d.section}`} />
                        ))}
                </AddGroup>
                {ctx.lists && ctx.lists.size > 0 && (
                    <AddGroup label={__('Una lista')} hint={__('Abre esa lista directo, con un toque')}>
                        {ctx.lists.size > 8 && (
                            <li className="imcrm-px-3 imcrm-py-2">
                                <input
                                    type="search"
                                    value={listQuery}
                                    onChange={(e) => setListQuery(e.target.value)}
                                    placeholder={__('Buscar una lista…')}
                                    aria-label={__('Buscar una lista')}
                                    data-testid="mobilenav-list-search"
                                    className="imcrm-h-10 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-text-[15px]"
                                />
                            </li>
                        )}
                        {lists.slice(0, allLists || listQuery.trim() !== '' ? 40 : SHORT).map(([id, l]) => (
                            <AddRow key={id} icon={l.icon} label={l.name} disabled={full} onClick={() => add(mobileNavItemKey({ kind: 'list', id }))} testId={`mobilenav-add-list-${id}`} />
                        ))}
                        {!allLists && listQuery.trim() === '' && lists.length > SHORT && (
                            <ShowAll count={lists.length} onClick={() => setAllLists(true)} testId="mobilenav-lists-all" />
                        )}
                        {lists.length === 0 && <li className="imcrm-px-3 imcrm-py-3 imcrm-text-[13px] imcrm-text-muted-foreground">{__('No hay más listas para agregar.')}</li>}
                    </AddGroup>
                )}
                {ctx.available('dashboards') && dashboards.length > 0 && (
                    <AddGroup label={__('Un tablero')} hint={__('Abre ese tablero directo, con un toque')}>
                        {dashboards.slice(0, allDashboards ? 40 : SHORT).map(([id, d]) => (
                            <AddRow key={id} icon={d.icon} label={d.name} disabled={full} onClick={() => add(mobileNavItemKey({ kind: 'dashboard', id }))} testId={`mobilenav-add-dashboard-${id}`} />
                        ))}
                        {!allDashboards && dashboards.length > SHORT && (
                            <ShowAll count={dashboards.length} onClick={() => setAllDashboards(true)} testId="mobilenav-dashboards-all" />
                        )}
                    </AddGroup>
                )}
            </section>

            {/* Nombres debajo de los íconos. */}
            <label className="imcrm-flex imcrm-min-h-[52px] imcrm-cursor-pointer imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-3.5 imcrm-py-2">
                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                    <span className="imcrm-text-[15px]">{__('Mostrar los nombres')}</span>
                    <span className="imcrm-text-[12px] imcrm-text-muted-foreground">{__('Debajo de cada ícono. Sin nombres se ven sólo los íconos.')}</span>
                </span>
                <input
                    type="checkbox"
                    role="switch"
                    checked={config.labels}
                    onChange={(e) => update({ labels: e.target.checked })}
                    data-testid="mobilenav-labels"
                    className="imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-accent-primary"
                />
            </label>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                {source === 'own' && (
                    <Button type="button" variant="outline" onClick={() => save(null)} data-testid="mobilenav-reset" className="imcrm-self-start">
                        <RotateCcw className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        {state?.team ? __('Volver a la barra del equipo') : __('Volver a la barra de siempre')}
                    </Button>
                )}
                <p className="imcrm-text-[12px] imcrm-text-muted-foreground">
                    {__('Se guarda en tu cuenta: la ves igual en este teléfono, en otros y en la app instalada. Cada empresa tiene la suya. En el computador se usa el menú de la izquierda.')}
                </p>
            </div>

            {isAdmin && (
                <section className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3.5" data-testid="mobilenav-team">
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <Users className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                        <h3 className="imcrm-text-[15px] imcrm-font-semibold">{__('Para todo el equipo')}</h3>
                    </div>
                    <p className="imcrm-text-[13px] imcrm-text-muted-foreground">
                        {__('Deja esta barra como la predeterminada de la empresa: la verá quien no eligió la suya. Cada persona puede cambiarla después.')}
                    </p>
                    {state?.team && (
                        <p className="imcrm-text-[13px]" data-testid="mobilenav-team-current">
                            {__('Ahora:')} <span className="imcrm-font-medium">{teamSummary(state.team, ctx)}</span>
                        </p>
                    )}
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        <Button type="button" size="sm" disabled={teamBusy} onClick={() => void setTeam({ items, labels: config.labels })} data-testid="mobilenav-team-set">
                            {__('Usar mi barra para el equipo')}
                        </Button>
                        {state?.team && (
                            <Button type="button" size="sm" variant="outline" disabled={teamBusy} onClick={() => void setTeam(null)} data-testid="mobilenav-team-clear">
                                {__('Quitar la del equipo')}
                            </Button>
                        )}
                    </div>
                </section>
            )}
        </div>
    );
}

/** Cuántas listas o tableros se ofrecen antes de «Ver todas». */
const SHORT = 5;

function ShowAll({ count, onClick, testId }: { count: number; onClick: () => void; testId: string }): JSX.Element {
    return (
        <li>
            <button
                type="button"
                onClick={onClick}
                data-testid={testId}
                className="imcrm-flex imcrm-min-h-[44px] imcrm-w-full imcrm-items-center imcrm-justify-center imcrm-px-3 imcrm-text-[14px] imcrm-font-medium imcrm-text-primary active:imcrm-bg-muted/70"
            >
                {sprintf(__('Ver todas (%d)'), count)}
            </button>
        </li>
    );
}

function tabTitle(tab: MobileTab): string {
    if (tab.pending) return __('Cargando…');
    return tab.section ? __(tab.label) : tab.label;
}

function tabHint(tab: MobileTab): string {
    if (tab.section) {
        const def = MOBILE_SECTIONS.find((d) => d.section === tab.section);
        return def ? __(def.hint) : '';
    }
    return tab.key.startsWith('list:') ? __('Una lista') : __('Un tablero');
}

function teamSummary(team: MobileNavConfig, ctx: ReturnType<typeof useMobileNavContext>): string {
    return [...resolveMobileTabs(team, ctx).map(tabTitle), __('Más')].join(' · ');
}

function IconChip({ icon: Icon }: { icon: TabIconComponent }): JSX.Element {
    return (
        <span aria-hidden className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-muted imcrm-text-foreground/75">
            <Icon className="imcrm-h-[18px] imcrm-w-[18px]" />
        </span>
    );
}

function IconButton({ label, disabled, onClick, testId, children }: { label: string; disabled?: boolean; onClick: () => void; testId: string; children: React.ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={onClick}
            data-testid={testId}
            className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground imcrm-transition-colors enabled:active:imcrm-bg-muted enabled:[@media(hover:hover)]:hover:imcrm-bg-muted enabled:[@media(hover:hover)]:hover:imcrm-text-foreground disabled:imcrm-opacity-30"
        >
            {children}
        </button>
    );
}

function AddGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element | null {
    const arr = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
    if (arr.length === 0) return null;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <div className="imcrm-px-1">
                <h4 className="imcrm-text-[12px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.08em] imcrm-text-muted-foreground">{label}</h4>
                {hint && <p className="imcrm-text-[12px] imcrm-text-muted-foreground">{hint}</p>}
            </div>
            <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card">{children}</ul>
        </div>
    );
}

function AddRow({ icon, label, hint, disabled, onClick, testId }: { icon: TabIconComponent; label: string; hint?: string; disabled: boolean; onClick: () => void; testId: string }): JSX.Element {
    return (
        <li>
            <button
                type="button"
                disabled={disabled}
                onClick={onClick}
                data-testid={testId}
                className="imcrm-flex imcrm-min-h-[52px] imcrm-w-full imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-transition-colors enabled:active:imcrm-bg-muted/70 enabled:[@media(hover:hover)]:hover:imcrm-bg-muted/40 disabled:imcrm-opacity-50"
            >
                <IconChip icon={icon} />
                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                    <span className="imcrm-truncate imcrm-text-[15px]">{label}</span>
                    {hint && <span className="imcrm-truncate imcrm-text-[12px] imcrm-text-muted-foreground">{hint}</span>}
                </span>
                <Plus className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" aria-label={__('Agregar')} />
            </button>
        </li>
    );
}

