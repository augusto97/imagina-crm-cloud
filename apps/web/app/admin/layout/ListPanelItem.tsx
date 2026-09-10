import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
    Check,
    Columns3,
    Copy,
    FolderInput,
    LayoutTemplate,
    Link2,
    Pencil,
    Pin,
    PinOff,
    Plus,
    Settings2,
    Share2,
    ShieldCheck,
    Trash2,
    Upload,
    Zap,
} from 'lucide-react';

import { useConfirm } from '@/components/ui/confirm-dialog';
import {
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { useListGroups, useMoveListToGroup } from '@/hooks/useListGroups';
import { useDeleteList, useUpdateList } from '@/hooks/useLists';
import { moduleEnabled } from '@/lib/cloudFeatures';
import { DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import type { ListSummary } from '@/types/list';

import { DuplicateListDialog } from '@/admin/lists/DuplicateListDialog';
import { SaveAsTemplateDialog } from '@/admin/lists/SaveAsTemplateDialog';
import { ShareDialog } from '@/admin/records/ShareDialog';

import { IconColorSubmenu } from './IconColorSubmenu';
import { PanelListLink } from './PanelListLink';

type ListDialog = 'share' | 'duplicate' | 'template' | null;

/**
 * Una lista en el panel lateral con su MENÚ CONTEXTUAL (v0.1.172) — lo
 * que ClickUp ofrece al click derecho sobre un espacio o una lista.
 *
 * Sólo entran acciones que existen de verdad en la app, cada una cableada
 * a lo que YA hacía en otra pantalla (Ajustes de la lista, cabecera de
 * registros, galería de plantillas): anclar, renombrar inline, copiar el
 * vínculo, color e ícono, mover a carpeta, nuevo registro, importar,
 * compartir, campos, automatizaciones, permisos, ajustes, duplicar,
 * guardar como plantilla y eliminar. Lo de ClickUp que no tiene
 * equivalente (ClickApps, estados de tarea, etiquetas, archivar, ocultar)
 * no aparece: un item apagado es peor que ninguno.
 *
 * Los diálogos se montan SÓLO mientras están abiertos: `ShareDialog` trae
 * sus propias queries (público, campos, vistas) y montarlo por cada fila
 * del menú sería N requests por abrir el panel.
 */
export function ListPanelItem({
    list,
    starred,
    onToggleStar,
}: {
    list: ListSummary;
    starred: boolean;
    onToggleStar: () => void;
}): JSX.Element {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const toast = useToast();
    const confirm = useConfirm();
    const update = useUpdateList(list.id);
    const move = useMoveListToGroup();
    const remove = useDeleteList();
    const groups = useListGroups();

    const canManage = useCan(CAP.MANAGE_LISTS);
    const canAutomations = useCan(CAP.MANAGE_AUTOMATIONS) && moduleEnabled('automations');
    const canCreate = useCan(CAP.CREATE_RECORDS);
    const canImport = useCan(CAP.IMPORT_RECORDS);

    const [dialog, setDialog] = useState<ListDialog>(null);

    const base = `/lists/${list.slug}`;
    const link = `${window.location.origin}${window.location.pathname}#${base}/records`;

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
            await update.mutateAsync(next);
        } catch (err) {
            if (err instanceof Error) toast.error(__('No se pudo guardar'), err.message);
        }
    };

    const del = async (): Promise<void> => {
        const ok = await confirm({
            title: sprintf(
                /* translators: %s: list name */
                __('¿Eliminar la lista "%s"?'),
                list.name,
            ),
            description: __(
                'Se quitará del menú junto con sus campos, vistas y automatizaciones. Los registros dejan de ser accesibles desde la app.',
            ),
            confirmLabel: __('Eliminar lista'),
            destructive: true,
        });
        if (!ok) return;
        try {
            await remove.mutateAsync({ idOrSlug: list.id });
            toast.success(__('Lista eliminada'));
            // Si estabas parado en esa lista, la página ya no existe.
            if (pathname.startsWith(`${base}/`) || pathname === base) navigate('/lists');
        } catch (err) {
            if (err instanceof Error) toast.error(__('No se pudo eliminar'), err.message);
        }
    };

    const sortedGroups = [...(groups.data ?? [])].sort((a, b) => a.position - b.position || a.id - b.id);
    const currentGroup = list.group_id ?? null;
    const showMove = canManage && (sortedGroups.length > 0 || currentGroup !== null);

    return (
        <>
            <PanelListLink
                to={`${base}/records`}
                name={list.name}
                starred={starred}
                icon={listIcon(list.icon) ?? DEFAULT_LIST_ICON}
                iconColor={listColor(list.color)}
                onToggleStar={onToggleStar}
                onRename={canManage ? (n) => void rename(n) : undefined}
                held={dialog !== null}
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
                            <IconColorSubmenu icon={list.icon} color={list.color} onChange={(n) => void setIcon(n)} />
                        )}
                        {showMove && (
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger data-testid="menu-move">
                                    <span className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                        <FolderInput className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {__('Mover a carpeta')}
                                    </span>
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                    <DropdownMenuItem
                                        onSelect={() => move.mutate({ listId: list.id, groupId: null })}
                                        disabled={currentGroup === null}
                                    >
                                        <span className="imcrm-w-3.5">{currentGroup === null && <Check className="imcrm-h-3.5 imcrm-w-3.5" />}</span>
                                        {__('Sin carpeta')}
                                    </DropdownMenuItem>
                                    {sortedGroups.map((g) => (
                                        <DropdownMenuItem
                                            key={g.id}
                                            onSelect={() => move.mutate({ listId: list.id, groupId: g.id })}
                                            disabled={currentGroup === g.id}
                                        >
                                            <span className="imcrm-w-3.5">{currentGroup === g.id && <Check className="imcrm-h-3.5 imcrm-w-3.5" />}</span>
                                            <span className="imcrm-truncate">{g.name}</span>
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuSubContent>
                            </DropdownMenuSub>
                        )}

                        <DropdownMenuSeparator />
                        {canCreate && (
                            <DropdownMenuItem onSelect={() => navigate(`${base}/records?new=1`)}>
                                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Nuevo registro')}
                            </DropdownMenuItem>
                        )}
                        {canImport && (
                            <DropdownMenuItem onSelect={() => navigate(`${base}/records?import=1`)}>
                                <Upload className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Importar CSV / Excel')}
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => setDialog('share')} data-testid="menu-share">
                            <Share2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Compartir')}
                        </DropdownMenuItem>

                        {(canManage || canAutomations) && <DropdownMenuSeparator />}
                        {canManage && (
                            <DropdownMenuItem onSelect={() => navigate(`${base}/edit?s=campos`)}>
                                <Columns3 className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Campos')}
                            </DropdownMenuItem>
                        )}
                        {canAutomations && (
                            <DropdownMenuItem onSelect={() => navigate(`${base}/automations`)}>
                                <Zap className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Automatizaciones')}
                            </DropdownMenuItem>
                        )}
                        {canManage && (
                            <>
                                <DropdownMenuItem onSelect={() => navigate(`${base}/edit?s=permisos`)}>
                                    <ShieldCheck className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Uso compartido y permisos')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => navigate(`${base}/edit?s=general`)}>
                                    <Settings2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Ajustes de la lista')}
                                </DropdownMenuItem>

                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => setDialog('duplicate')} data-testid="menu-duplicate">
                                    <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Duplicar')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setDialog('template')}>
                                    <LayoutTemplate className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Guardar como plantilla')}
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

            {dialog === 'share' && (
                <ShareDialog
                    open
                    onOpenChange={(o) => {
                        if (!o) setDialog(null);
                    }}
                    listId={list.id}
                    listName={list.name}
                    canPublish={canManage}
                />
            )}
            {dialog === 'duplicate' && (
                <DuplicateListDialog
                    open
                    onOpenChange={(o) => {
                        if (!o) setDialog(null);
                    }}
                    sourceId={list.id}
                />
            )}
            {dialog === 'template' && (
                <SaveAsTemplateDialog
                    list={list}
                    open
                    onOpenChange={(o) => {
                        if (!o) setDialog(null);
                    }}
                />
            )}
        </>
    );
}
