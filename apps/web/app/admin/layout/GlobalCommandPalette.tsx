import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import {
    Clock,
    FileText,
    Keyboard,
    LayoutDashboard,
    ListChecks,
    Loader2,
    Pin,
    Plus,
    Search,
    Settings,
    ShieldAlert,
    UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useSession } from '@/cloud/session';
import { useDashboards } from '@/hooks/useDashboards';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { useListGroups } from '@/hooks/useListGroups';
import { useLists } from '@/hooks/useLists';
import { useIsSuperadmin } from '@/hooks/usePlatform';
import { dashboardColor, dashboardIcon } from '@/lib/dashboardIcon';
import { __, _n, sprintf } from '@/lib/i18n';
import { DEFAULT_DASHBOARD_ICON, DEFAULT_LIST_ICON, listColor, listIcon, type ListIconComponent } from '@/lib/listIcons';
import { paletteMatches, paletteRank } from '@/lib/paletteSearch';
import { CAP, useCan } from '@/lib/permissions';
import { pushRecent, useRecents, type RecentItem } from '@/lib/recents';
import { cn } from '@/lib/utils';

interface GlobalCommandPaletteProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Abre el alta de lista (la paleta se cierra antes). */
    onCreateList?: () => void;
    onShowShortcuts?: () => void;
}

type CommandIcon = ListIconComponent | LucideIcon;

interface GlobalCommand {
    id: string;
    label: string;
    description?: string;
    icon: CommandIcon;
    iconColor?: string;
    section: string;
    keywords?: string;
    href?: string;
    action?: () => void;
    /** Al abrirlo, guardarlo en Recientes. */
    recent?: Omit<RecentItem, 'ts'>;
}

/** Cuántos de cada grupo se muestran (con 300 listas, la paleta no es un índice). */
const MAX_LISTS = 12;
const MAX_DASHBOARDS = 8;
const EMPTY_LISTS_PREVIEW = 6;

/**
 * Paleta de comandos global (Ctrl/⌘+K, la lupa de la barra superior).
 *
 * v0.1.286 — rehecha a partir de la auditoría de navegación:
 *  - sin entradas muertas (`/lists/new`, `/automations`, `/me` no existen):
 *    "Crear lista" abre el diálogo de alta, "Mi cuenta" va a Ajustes →
 *    Seguridad;
 *  - REGISTROS de todas las listas por título (`GET /search`, con el ACL de
 *    cada lista) además de listas, dashboards y secciones;
 *  - coincidencia sin acentos y por palabras; iconos propios de cada lista y
 *    dashboard, con su carpeta como pista;
 *  - vacía, muestra lo abierto hace poco (Recientes);
 *  - con el teclado, el elegido siempre queda a la vista.
 */
export function GlobalCommandPalette({
    open,
    onOpenChange,
    onCreateList,
    onShowShortcuts,
}: GlobalCommandPaletteProps): JSX.Element {
    const navigate = useNavigate();
    const tenantId = useSession((s) => s.activeTenantId);
    const lists = useLists();
    const dashboards = useDashboards();
    const groups = useListGroups();
    const recents = useRecents(tenantId);
    const isSuperadmin = useIsSuperadmin();
    // Cada hook se llama SIEMPRE (rules-of-hooks).
    const canManageDashboards = useCan(CAP.MANAGE_DASHBOARDS);
    const canManageLists = useCan(CAP.MANAGE_LISTS);
    const canAccessAdmin = useCan(CAP.ACCESS_ADMIN);
    const canViewRecords = useCan(CAP.VIEW_RECORDS);
    const canViewOwnRecords = useCan(CAP.VIEW_OWN_RECORDS);
    const canSeeDashboards = canManageDashboards || canAccessAdmin;

    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const listRef = useRef<HTMLDivElement | null>(null);
    const debounced = useDebouncedValue(query, 220);
    const records = useGlobalSearch(debounced, open && (canViewRecords || canViewOwnRecords));
    const typing = query.trim() !== '';

    const folderName = useMemo(() => {
        const map = new Map<number, string>();
        for (const g of groups.data ?? []) map.set(g.id, g.name);
        return map;
    }, [groups.data]);

    const commands = useMemo<GlobalCommand[]>(() => {
        const out: GlobalCommand[] = [];
        const q = query.trim();

        if (!typing) {
            for (const r of recents) {
                out.push({
                    id: `recent-${r.kind}-${r.id}`,
                    label: r.label,
                    description:
                        r.kind === 'record'
                            ? sprintf(__('Registro · %s'), r.context ?? '')
                            : r.kind === 'dashboard'
                              ? __('Dashboard')
                              : __('Lista'),
                    icon:
                        r.kind === 'record'
                            ? FileText
                            : (listIcon(r.icon) ?? (r.kind === 'dashboard' ? DEFAULT_DASHBOARD_ICON : DEFAULT_LIST_ICON)),
                    iconColor: r.kind === 'record' ? undefined : listColor(r.color),
                    section: __('Recientes'),
                    href: r.href,
                });
            }
        }

        // Registros de la búsqueda del servidor (sólo cuando se escribe).
        if (typing && debounced.trim() === q && records.data) {
            for (const hit of records.data) {
                out.push({
                    id: `record-${hit.record_id}`,
                    label: hit.title || sprintf(__('Registro #%d'), hit.record_id),
                    description: sprintf(__('Registro · %s'), hit.list_name),
                    icon: listIcon(hit.list_icon) ?? DEFAULT_LIST_ICON,
                    iconColor: listColor(hit.list_color),
                    section: __('Registros'),
                    href: `/lists/${hit.list_slug}/records?record=${hit.record_id}`,
                    recent: {
                        kind: 'record',
                        id: hit.record_id,
                        label: hit.title || sprintf(__('Registro #%d'), hit.record_id),
                        context: hit.list_name,
                        href: `/lists/${hit.list_slug}/records?record=${hit.record_id}`,
                        icon: hit.list_icon,
                        color: hit.list_color,
                    },
                });
            }
        }

        if (lists.data && (typing || recents.length === 0)) {
            const matched = lists.data
                .map((list) => {
                    const folder = list.group_id !== null ? folderName.get(list.group_id) : undefined;
                    return { list, folder };
                })
                .filter(({ list, folder }) => paletteMatches(`${list.name} ${list.slug} ${folder ?? ''}`, q))
                .sort((a, b) => paletteRank(a.list.name, q) - paletteRank(b.list.name, q))
                .slice(0, typing ? MAX_LISTS : EMPTY_LISTS_PREVIEW);
            for (const { list, folder } of matched) {
                out.push({
                    id: `list-${list.id}`,
                    label: list.name,
                    description: folder ? sprintf(__('Lista · %s'), folder) : __('Lista'),
                    icon: listIcon(list.icon) ?? DEFAULT_LIST_ICON,
                    iconColor: listColor(list.color),
                    section: __('Listas'),
                    href: `/lists/${list.slug}/records`,
                });
            }
        }

        if (typing && canSeeDashboards && dashboards.data) {
            const matched = dashboards.data
                .filter((d) => paletteMatches(d.name, q))
                .sort((a, b) => paletteRank(a.name, q) - paletteRank(b.name, q))
                .slice(0, MAX_DASHBOARDS);
            for (const d of matched) {
                out.push({
                    id: `dashboard-${d.id}`,
                    label: d.name,
                    description: __('Dashboard'),
                    icon: dashboardIcon(d.settings),
                    iconColor: dashboardColor(d.settings),
                    section: __('Dashboards'),
                    href: `/dashboards/${d.id}`,
                });
            }
        }

        const nav: GlobalCommand[] = [
            { id: 'nav-lists', label: __('Todas las listas'), icon: DEFAULT_LIST_ICON, section: __('Ir a'), keywords: 'listas lists inicio', href: '/lists' },
            { id: 'nav-mywork', label: __('Mi trabajo'), icon: ListChecks, section: __('Ir a'), keywords: 'asignado tareas recordatorios', href: '/my-work' },
            { id: 'nav-favorites', label: __('Favoritos'), icon: Pin, section: __('Ir a'), keywords: 'anclados pin', href: '/favorites' },
            ...(canSeeDashboards
                ? [{ id: 'nav-dashboards', label: __('Todos los dashboards'), icon: LayoutDashboard, section: __('Ir a'), keywords: 'tableros dashboards', href: '/dashboards' }]
                : []),
            { id: 'nav-settings', label: __('Ajustes'), icon: Settings, section: __('Ir a'), keywords: 'settings configuracion preferencias', href: '/settings' },
            { id: 'nav-account', label: __('Mi cuenta'), description: __('Contraseña, dispositivos y verificación en dos pasos'), icon: UserRound, section: __('Ir a'), keywords: 'perfil cuenta seguridad contrasena', href: '/settings?s=seguridad' },
            ...(isSuperadmin
                ? [{ id: 'nav-platform', label: __('Plataforma'), icon: ShieldAlert, section: __('Ir a'), keywords: 'consola operador empresas', href: '/platform' }]
                : []),
        ];
        const actions: GlobalCommand[] = [
            ...(canManageLists && onCreateList
                ? [{ id: 'new-list', label: __('Crear lista nueva'), icon: Plus, section: __('Acciones'), keywords: 'nueva crear lista plantilla', action: onCreateList }]
                : []),
            ...(onShowShortcuts
                ? [{ id: 'shortcuts', label: __('Atajos de teclado'), icon: Keyboard, section: __('Acciones'), keywords: 'teclado atajos ayuda', action: onShowShortcuts }]
                : []),
        ];
        for (const c of [...nav, ...actions]) {
            if (!typing || paletteMatches(`${c.label} ${c.keywords ?? ''}`, q)) out.push(c);
        }
        return out;
    }, [
        query,
        typing,
        debounced,
        recents,
        records.data,
        lists.data,
        folderName,
        dashboards.data,
        canSeeDashboards,
        canManageLists,
        isSuperadmin,
        onCreateList,
        onShowShortcuts,
    ]);

    useEffect(() => {
        if (open) {
            setQuery('');
            setActiveIndex(0);
        }
    }, [open]);

    useEffect(() => {
        if (activeIndex >= commands.length) setActiveIndex(Math.max(0, commands.length - 1));
    }, [commands.length, activeIndex]);

    // El elegido con el teclado siempre queda a la vista (antes se podía bajar
    // con ↓ hasta un item fuera del área visible).
    useEffect(() => {
        const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-index="${activeIndex}"]`);
        el?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    const runCommand = (cmd: GlobalCommand): void => {
        onOpenChange(false);
        if (cmd.recent) pushRecent(tenantId, cmd.recent);
        if (cmd.href) navigate(cmd.href);
        else cmd.action?.();
    };

    const handleKeyDown = (e: React.KeyboardEvent): void => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((i) => Math.min(commands.length - 1, i + 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(0, i - 1));
        } else if (e.key === 'Home') {
            e.preventDefault();
            setActiveIndex(0);
        } else if (e.key === 'End') {
            e.preventDefault();
            setActiveIndex(Math.max(0, commands.length - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const cmd = commands[activeIndex];
            if (cmd) runCommand(cmd);
        }
    };

    // Agrupamos preservando orden.
    const grouped = useMemo(() => {
        const map = new Map<string, GlobalCommand[]>();
        commands.forEach((cmd) => {
            if (!map.has(cmd.section)) map.set(cmd.section, []);
            map.get(cmd.section)!.push(cmd);
        });
        return Array.from(map.entries());
    }, [commands]);

    const searchingRecords = typing && query.trim().length >= 2 && (records.isFetching || debounced.trim() !== query.trim());
    const activeId = commands[activeIndex]?.id;

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    data-testid="command-palette"
                    aria-describedby={undefined}
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-[8vh] imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-xl sm:imcrm-top-[12vh]',
                        'imcrm--translate-x-1/2',
                        'imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-lg',
                    )}
                    onKeyDown={handleKeyDown}
                >
                    <Dialog.Title className="imcrm-sr-only">{__('Búsqueda global')}</Dialog.Title>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-4">
                        <Search className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                        <input
                            type="text"
                            autoFocus
                            role="combobox"
                            aria-expanded
                            aria-controls="imcrm-palette-list"
                            aria-activedescendant={activeId ? `imcrm-cmd-${activeId}` : undefined}
                            aria-label={__('Buscar')}
                            value={query}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                setActiveIndex(0);
                            }}
                            placeholder={__('Buscar listas, registros, dashboards…')}
                            className="imcrm-h-12 imcrm-w-full imcrm-bg-transparent imcrm-text-sm placeholder:imcrm-text-muted-foreground focus:imcrm-outline-none"
                        />
                        {searchingRecords && (
                            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-animate-spin imcrm-text-muted-foreground" aria-label={__('Buscando registros…')} />
                        )}
                    </div>

                    <div
                        ref={listRef}
                        id="imcrm-palette-list"
                        role="listbox"
                        className="imcrm-max-h-[min(60vh,28rem)] imcrm-overflow-y-auto imcrm-py-2"
                    >
                        {commands.length === 0 ? (
                            <p className="imcrm-px-4 imcrm-py-6 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                                {searchingRecords ? __('Buscando…') : __('Sin resultados.')}
                            </p>
                        ) : (
                            (() => {
                                let globalIndex = -1;
                                return grouped.map(([section, items]) => (
                                    <section key={section} className="imcrm-mb-2 last:imcrm-mb-0" aria-label={section}>
                                        <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-px-4 imcrm-py-1 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                                            {section === __('Recientes') && <Clock className="imcrm-h-3 imcrm-w-3" aria-hidden />}
                                            {section}
                                        </p>
                                        {items.map((cmd) => {
                                            globalIndex++;
                                            const idx = globalIndex;
                                            const Icon = cmd.icon;
                                            const isActive = idx === activeIndex;
                                            return (
                                                <button
                                                    key={cmd.id}
                                                    id={`imcrm-cmd-${cmd.id}`}
                                                    type="button"
                                                    role="option"
                                                    aria-selected={isActive}
                                                    data-cmd-index={idx}
                                                    tabIndex={-1}
                                                    onClick={() => runCommand(cmd)}
                                                    onMouseMove={() => {
                                                        if (activeIndex !== idx) setActiveIndex(idx);
                                                    }}
                                                    className={cn(
                                                        'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-3 imcrm-px-4 imcrm-py-2 imcrm-text-left imcrm-text-sm imcrm-transition-colors',
                                                        isActive && 'imcrm-bg-accent',
                                                    )}
                                                >
                                                    <Icon
                                                        className={cn('imcrm-h-4 imcrm-w-4 imcrm-shrink-0', !cmd.iconColor && 'imcrm-text-muted-foreground')}
                                                        style={cmd.iconColor ? { color: cmd.iconColor } : undefined}
                                                        aria-hidden
                                                    />
                                                    <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                                                        <span className="imcrm-truncate imcrm-font-medium">{cmd.label}</span>
                                                        {cmd.description && (
                                                            <span className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                                                                {cmd.description}
                                                            </span>
                                                        )}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </section>
                                ));
                            })()
                        )}
                    </div>

                    <footer className="imcrm-hidden imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-2 imcrm-text-[10px] imcrm-text-muted-foreground sm:imcrm-flex">
                        <span className="imcrm-flex imcrm-items-center imcrm-gap-3">
                            <span className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                <kbd className="imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-py-0.5">↑↓</kbd>
                                {__('navegar')}
                            </span>
                            <span className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                <kbd className="imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-py-0.5">⏎</kbd>
                                {__('abrir')}
                            </span>
                            <span className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                <kbd className="imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-py-0.5">Esc</kbd>
                                {__('cerrar')}
                            </span>
                        </span>
                        <span>{typing && query.trim().length < 2 ? __('Escribe 2 letras para buscar registros') : sprintf(_n('%d resultado', '%d resultados', commands.length), commands.length)}</span>
                    </footer>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
