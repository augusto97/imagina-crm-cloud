import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import {
    BarChart3,
    Database,
    LayoutDashboard,
    Plus,
    Settings,
    Sparkles,
    Table,
    User,
    Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useDashboards } from '@/hooks/useDashboards';
import { useLists } from '@/hooks/useLists';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { CAP, useCan } from '@/lib/permissions';

interface GlobalCommandPaletteProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface GlobalCommand {
    id: string;
    label: string;
    description?: string;
    icon: LucideIcon;
    section: string;
    keywords?: string;
    href?: string;
    action?: () => void;
}

/**
 * Command palette **global** del admin shell (Fase 15.A).
 *
 * Activado con Cmd/Ctrl+K desde cualquier página del plugin
 * (NO confundir con `EditorCommandPalette` de Fase 14.A — ese vive
 * solo dentro del editor de plantilla). Permite jump rápido a:
 *
 *  - Listas: cualquiera del workspace, por nombre.
 *  - Dashboards: cualquiera del workspace.
 *  - Páginas globales: Automations, Settings, Crear lista, etc.
 *
 * Match fuzzy por substring en label + keywords. Mismo patrón
 * navegación ↑↓ + Enter + Esc que el palette del editor.
 *
 * No incluye búsqueda de records cross-list — eso requeriría un
 * endpoint global de search que está fuera de scope. El user
 * puede saltar a la lista y usar el search interno.
 */
export function GlobalCommandPalette({
    open,
    onOpenChange,
}: GlobalCommandPaletteProps): JSX.Element {
    const navigate = useNavigate();
    const lists = useLists();
    const dashboards = useDashboards();
    const canSeeDashboards = useCan(CAP.MANAGE_DASHBOARDS) || useCan(CAP.ACCESS_ADMIN);
    const canSeeAutomations = useCan(CAP.MANAGE_AUTOMATIONS) || useCan(CAP.ACCESS_ADMIN);
    const canSeeSettings = useCan(CAP.MANAGE_LISTS) || useCan('manage_options');

    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);

    const commands = useMemo<GlobalCommand[]>(() => {
        const cmds: GlobalCommand[] = [];

        // Listas del user.
        if (lists.data) {
            for (const list of lists.data) {
                cmds.push({
                    id: `list-${list.id}`,
                    label: list.name,
                    description: __('Lista'),
                    icon: Database,
                    section: __('Listas'),
                    keywords: 'list ' + list.slug,
                    href: `/lists/${list.slug}/records`,
                });
            }
            cmds.push({
                id: 'new-list',
                label: __('Crear lista nueva'),
                icon: Plus,
                section: __('Listas'),
                keywords: 'new create lista',
                href: '/lists/new',
            });
        }

        // Dashboards.
        if (canSeeDashboards && dashboards.data) {
            for (const d of dashboards.data) {
                cmds.push({
                    id: `dashboard-${d.id}`,
                    label: d.name,
                    description: __('Dashboard'),
                    icon: BarChart3,
                    section: __('Dashboards'),
                    keywords: 'dashboard ' + String(d.id),
                    href: `/dashboards/${d.id}`,
                });
            }
            cmds.push({
                id: 'all-dashboards',
                label: __('Ver todos los dashboards'),
                icon: LayoutDashboard,
                section: __('Dashboards'),
                href: '/dashboards',
            });
        }

        // Automations.
        if (canSeeAutomations) {
            cmds.push({
                id: 'automations',
                label: __('Automatizaciones'),
                description: __('Triggers y acciones'),
                icon: Zap,
                section: __('Navegar'),
                keywords: 'automation workflow trigger',
                href: '/automations',
            });
        }

        // Settings.
        if (canSeeSettings) {
            cmds.push({
                id: 'settings',
                label: __('Ajustes del plugin'),
                icon: Settings,
                section: __('Navegar'),
                keywords: 'settings preferences config',
                href: '/settings',
            });
        }

        // Mi cuenta — siempre visible.
        cmds.push({
            id: 'me',
            label: __('Mi cuenta'),
            icon: User,
            section: __('Navegar'),
            keywords: 'profile account me',
            href: '/me',
        });

        return cmds;
    }, [lists.data, dashboards.data, canSeeDashboards, canSeeAutomations, canSeeSettings]);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (! needle) return commands;
        return commands.filter((cmd) => {
            const haystack = (
                cmd.label
                + ' '
                + (cmd.description ?? '')
                + ' '
                + (cmd.keywords ?? '')
                + ' '
                + cmd.section
            ).toLowerCase();
            return haystack.includes(needle);
        });
    }, [commands, query]);

    useEffect(() => {
        if (open) {
            setQuery('');
            setActiveIndex(0);
        }
    }, [open]);

    useEffect(() => {
        if (activeIndex >= filtered.length) {
            setActiveIndex(Math.max(0, filtered.length - 1));
        }
    }, [filtered.length, activeIndex]);

    const runCommand = (cmd: GlobalCommand): void => {
        onOpenChange(false);
        if (cmd.href) {
            navigate(cmd.href);
        } else if (cmd.action) {
            cmd.action();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent): void => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(0, i - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const cmd = filtered[activeIndex];
            if (cmd) runCommand(cmd);
        }
    };

    // Agrupamos preservando orden.
    const grouped = useMemo(() => {
        const map = new Map<string, GlobalCommand[]>();
        filtered.forEach((cmd) => {
            if (! map.has(cmd.section)) map.set(cmd.section, []);
            map.get(cmd.section)!.push(cmd);
        });
        return Array.from(map.entries());
    }, [filtered]);

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-[15vh] imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-xl',
                        'imcrm--translate-x-1/2',
                        'imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-lg',
                    )}
                    onKeyDown={handleKeyDown}
                >
                    <Dialog.Title className="imcrm-sr-only">
                        {__('Búsqueda global')}
                    </Dialog.Title>
                    <input
                        type="text"
                        autoFocus
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setActiveIndex(0);
                        }}
                        placeholder={__('Buscar lista, dashboard, ajuste…')}
                        className="imcrm-h-12 imcrm-w-full imcrm-border-b imcrm-border-border imcrm-bg-transparent imcrm-px-4 imcrm-text-sm imcrm-placeholder:text-muted-foreground focus:imcrm-outline-none"
                    />

                    <div className="imcrm-max-h-[60vh] imcrm-overflow-y-auto imcrm-py-2">
                        {filtered.length === 0 ? (
                            <p className="imcrm-px-4 imcrm-py-6 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                                <Sparkles className="imcrm-mb-2 imcrm-mx-auto imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground/50" />
                                {__('Sin resultados.')}
                            </p>
                        ) : (
                            (() => {
                                let globalIndex = -1;
                                return grouped.map(([section, items]) => (
                                    <section key={section} className="imcrm-mb-2 last:imcrm-mb-0">
                                        <p className="imcrm-px-4 imcrm-py-1 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
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
                                                    type="button"
                                                    onClick={() => runCommand(cmd)}
                                                    onMouseEnter={() => setActiveIndex(idx)}
                                                    className={cn(
                                                        'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-3 imcrm-px-4 imcrm-py-2 imcrm-text-left imcrm-text-sm imcrm-transition-colors',
                                                        isActive && 'imcrm-bg-accent',
                                                    )}
                                                >
                                                    <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
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

                    <footer className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-2 imcrm-text-[10px] imcrm-text-muted-foreground">
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
                        <span className="imcrm-flex imcrm-items-center imcrm-gap-1">
                            <Table className="imcrm-h-3 imcrm-w-3" />
                            {filtered.length}
                        </span>
                    </footer>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
