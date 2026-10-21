import { useNavigate } from 'react-router';
import { Keyboard, LogOut, Moon, Settings, Sun, UserRound } from 'lucide-react';

import { roleLabel, useWorkspaces } from '@/cloud/workspaceSwitch';
import { useSession } from '@/cloud/session';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { __ } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

import { initials, WorkspaceMenuItems } from './WorkspaceSwitcher';

/**
 * v0.1.286 — menú de la persona (reemplaza al icono suelto de cerrar sesión):
 * quién eres, en qué empresa estás (y el cambio a otra), tu cuenta, el tema,
 * los atajos de teclado y cerrar sesión.
 */
export function UserMenu({ onShowShortcuts }: { onShowShortcuts?: () => void }): JSX.Element | null {
    const navigate = useNavigate();
    const user = useSession((s) => s.user);
    const impersonating = useSession((s) => s.impersonating);
    const { memberships, active, locked } = useWorkspaces();
    const theme = useTheme();
    if (!user) return null;
    const displayName = user.name.trim() !== '' ? user.name : user.email;
    const isDark = theme.resolved === 'dark';

    const logout = async (): Promise<void> => {
        const { api, useSession: store } = await import('@/cloud/session');
        try {
            await api.logout();
        } catch {
            // igual limpiamos la sesión local y recargamos
        }
        store.getState().clear();
        window.location.assign('/');
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    data-testid="user-menu"
                    aria-label={`${__('Tu cuenta')}: ${displayName}`}
                    title={displayName}
                    className="imcrm-inline-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-transition-colors hover:imcrm-bg-accent data-[state=open]:imcrm-bg-accent"
                >
                    <span
                        aria-hidden
                        className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary imcrm-text-[11px] imcrm-font-semibold imcrm-text-primary-foreground"
                    >
                        {initials(displayName)}
                    </span>
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="imcrm-w-72">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-px-2 imcrm-py-2">
                    <span
                        aria-hidden
                        className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary imcrm-text-xs imcrm-font-semibold imcrm-text-primary-foreground"
                    >
                        {initials(displayName)}
                    </span>
                    <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                        <span className="imcrm-truncate imcrm-text-sm imcrm-font-semibold" data-testid="user-menu-name">
                            {displayName}
                        </span>
                        <span className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{user.email}</span>
                    </span>
                </div>
                {impersonating && (
                    <p className="imcrm-mx-2 imcrm-mb-1 imcrm-rounded imcrm-bg-warning/15 imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-text-foreground">
                        {__('Estás viendo la app como esta persona (soporte).')}
                    </p>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{__('Empresa')}</DropdownMenuLabel>
                {memberships.length > 1 && !locked ? (
                    <div className="imcrm-max-h-64 imcrm-overflow-y-auto" data-testid="user-menu-workspaces">
                        <WorkspaceMenuItems />
                    </div>
                ) : (
                    active && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-px-2 imcrm-pb-1.5 imcrm-text-sm" data-testid="user-menu-workspace">
                            <span className="imcrm-truncate imcrm-font-medium">{active.tenant_name}</span>
                            <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{roleLabel(active.role)}</span>
                        </div>
                    )
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/settings?s=seguridad')}>
                    <UserRound className="imcrm-h-4 imcrm-w-4" />
                    {__('Mi cuenta')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('/settings')}>
                    <Settings className="imcrm-h-4 imcrm-w-4" />
                    {__('Ajustes')}
                </DropdownMenuItem>
                <DropdownMenuItem
                    onSelect={(e) => {
                        // Cambiar el tema no cierra el menú: se ve el cambio al instante.
                        e.preventDefault();
                        theme.toggle();
                    }}
                    data-testid="user-menu-theme"
                >
                    {isDark ? <Sun className="imcrm-h-4 imcrm-w-4" /> : <Moon className="imcrm-h-4 imcrm-w-4" />}
                    {isDark ? __('Modo claro') : __('Modo oscuro')}
                </DropdownMenuItem>
                {onShowShortcuts && (
                    <DropdownMenuItem onSelect={onShowShortcuts}>
                        <Keyboard className="imcrm-h-4 imcrm-w-4" />
                        <span className="imcrm-flex-1">{__('Atajos de teclado')}</span>
                        <kbd className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-text-[10px] imcrm-text-muted-foreground">?</kbd>
                    </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem danger onSelect={() => void logout()} data-testid="user-menu-logout">
                    <LogOut className="imcrm-h-4 imcrm-w-4" />
                    {impersonating ? __('Salir de esta sesión') : __('Cerrar sesión')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
