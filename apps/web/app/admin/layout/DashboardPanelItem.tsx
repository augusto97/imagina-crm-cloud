import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Copy, Link2, Pencil, Pin, PinOff, Settings2, Trash2 } from 'lucide-react';

import { useConfirm } from '@/components/ui/confirm-dialog';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { useDeleteDashboard, useDuplicateDashboard, useUpdateDashboard } from '@/hooks/useDashboards';
import { dashboardColor, dashboardIcon } from '@/lib/dashboardIcon';
import { __ } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import type { DashboardEntity } from '@/types/dashboard';

import { DashboardSettingsDialog } from '@/admin/dashboards/DashboardSettingsDialog';

import { IconColorSubmenu } from './IconColorSubmenu';
import { PanelListLink } from './PanelListLink';

/** El icono guardado en `settings` (string o nada). */
function readKey(settings: Record<string, unknown> | undefined, key: 'icon' | 'color'): string | null {
    const v = settings?.[key];
    return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * Un dashboard en el panel lateral con su menú contextual (v0.1.172):
 * anclar, renombrar inline, copiar el vínculo, color e ícono, duplicar,
 * configuración (el mismo diálogo del lápiz de la página) y eliminar.
 *
 * El gate es `manage_dashboards`; quién puede mutar UN tablero concreto
 * (su creador o un admin, v0.1.57) lo decide el backend con 403 y acá se
 * muestra el motivo en un toast — la lista del menú no trae ese dato.
 */
export function DashboardPanelItem({
    dashboard,
    starred,
    onToggleStar,
}: {
    dashboard: DashboardEntity;
    starred: boolean;
    onToggleStar: () => void;
}): JSX.Element {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const toast = useToast();
    const confirm = useConfirm();
    const update = useUpdateDashboard(dashboard.id);
    const duplicate = useDuplicateDashboard();
    const remove = useDeleteDashboard();
    const canManage = useCan(CAP.MANAGE_DASHBOARDS);
    const [settingsOpen, setSettingsOpen] = useState(false);

    const base = `/dashboards/${dashboard.id}`;
    const link = `${window.location.origin}${window.location.pathname}#${base}`;

    const copyLink = async (): Promise<void> => {
        try {
            await navigator.clipboard.writeText(link);
            toast.success(__('Enlace copiado'));
        } catch {
            /* portapapeles bloqueado — no-op */
        }
    };

    const rename = async (name: string): Promise<void> => {
        try {
            await update.mutateAsync({ name });
        } catch (err) {
            if (err instanceof Error) toast.error(__('No se pudo cambiar el nombre'), err.message);
        }
    };

    const setIcon = async (next: { icon: string | null; color: string | null }): Promise<void> => {
        try {
            // Merge sobre los settings guardados: `page` vive ahí mismo.
            await update.mutateAsync({ settings: { ...(dashboard.settings ?? {}), ...next } });
        } catch (err) {
            if (err instanceof Error) toast.error(__('No se pudo guardar'), err.message);
        }
    };

    const dup = async (): Promise<void> => {
        try {
            await duplicate.mutateAsync(dashboard);
            toast.success(__('Dashboard duplicado'));
        } catch (err) {
            if (err instanceof Error) toast.error(__('No se pudo duplicar'), err.message);
        }
    };

    const del = async (): Promise<void> => {
        const ok = await confirm({
            title: __('Eliminar dashboard'),
            description: __('Sus widgets se perderán. Esta acción no se puede deshacer.'),
            destructive: true,
            confirmLabel: __('Eliminar'),
        });
        if (!ok) return;
        try {
            await remove.mutateAsync(dashboard.id);
            toast.success(__('Dashboard eliminado'));
            if (pathname === base || pathname.startsWith(`${base}/`)) navigate('/dashboards');
        } catch (err) {
            if (err instanceof Error) toast.error(__('No se pudo eliminar el dashboard'), err.message);
        }
    };

    return (
        <>
            <PanelListLink
                to={base}
                name={dashboard.name}
                icon={dashboardIcon(dashboard.settings)}
                iconColor={dashboardColor(dashboard.settings)}
                starred={starred}
                onToggleStar={onToggleStar}
                onRename={canManage ? (n) => void rename(n) : undefined}
                held={settingsOpen}
                menu={({ startRename }) => (
                    <>
                        <DropdownMenuItem onSelect={onToggleStar}>
                            {starred ? <PinOff className="imcrm-h-3.5 imcrm-w-3.5" /> : <Pin className="imcrm-h-3.5 imcrm-w-3.5" />}
                            {starred ? __('Quitar de favoritos') : __('Anclar a favoritos')}
                        </DropdownMenuItem>
                        {canManage && (
                            <DropdownMenuItem onSelect={startRename} data-testid="menu-rename">
                                <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Cambiar el nombre')}
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => void copyLink()}>
                            <Link2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Copiar vínculo')}
                        </DropdownMenuItem>
                        {canManage && (
                            <>
                                <IconColorSubmenu
                                    icon={readKey(dashboard.settings, 'icon')}
                                    color={readKey(dashboard.settings, 'color')}
                                    onChange={(n) => void setIcon(n)}
                                />
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => void dup()} data-testid="menu-duplicate">
                                    <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Duplicar')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                                    <Settings2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Configuración')}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem danger onSelect={() => void del()} data-testid="menu-delete">
                                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Eliminar')}
                                </DropdownMenuItem>
                            </>
                        )}
                    </>
                )}
            />
            {settingsOpen && (
                <DashboardSettingsDialog dashboard={dashboard} open onOpenChange={setSettingsOpen} />
            )}
        </>
    );
}
