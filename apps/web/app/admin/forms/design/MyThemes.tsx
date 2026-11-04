import { useState } from 'react';
import { Check, Loader2, MoreHorizontal, Pencil, RefreshCw, Save, Star, Trash2 } from 'lucide-react';
import { PUBLIC_THEMES_MAX, type PublicTheme, type SavedPublicTheme } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { ThemeThumb } from './ThemeGallery';
import { sameTheme } from './themeOps';
import {
    themeErrorMessage,
    useCreatePublicTheme,
    useDeletePublicTheme,
    usePublicThemes,
    useSetDefaultPublicTheme,
    useUpdatePublicTheme,
} from './useFormThemes';

/**
 * v0.1.351 (ADR-S94) — «Mis temas»: los diseños que la empresa guardó para
 * reusar en todos sus formularios y agendas. Uno puede ser el de los
 * nuevos (la estrella).
 */
export function MyThemes({
    brand,
    current,
    suggestedName,
    onApply,
}: {
    brand: string;
    /** El diseño que se está editando (lo que se guarda como tema). */
    current: PublicTheme;
    suggestedName: string;
    onApply: (saved: SavedPublicTheme) => void;
}): JSX.Element {
    const toast = useToast();
    const confirm = useConfirm();
    const themes = usePublicThemes();
    const create = useCreatePublicTheme();
    const update = useUpdatePublicTheme();
    const remove = useDeletePublicTheme();
    const setDefault = useSetDefaultPublicTheme();
    const [naming, setNaming] = useState<string | null>(null);
    const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

    const list = themes.data?.themes ?? [];
    const defaultId = themes.data?.default_id ?? null;
    const full = list.length >= PUBLIC_THEMES_MAX;
    const defaultTheme = list.find((t) => t.id === defaultId);

    const saveNew = async (): Promise<void> => {
        const name = (naming ?? '').trim();
        if (!name) return;
        try {
            await create.mutateAsync({ name, theme: current });
            toast.success(__('Tema guardado'), __('Ya puedes usarlo en cualquier formulario o agenda de la empresa.'));
            setNaming(null);
        } catch (err) {
            toast.error(__('No se pudo guardar el tema'), themeErrorMessage(err));
        }
    };

    const saveRename = async (): Promise<void> => {
        if (!renaming) return;
        const name = renaming.name.trim();
        if (!name) return;
        try {
            await update.mutateAsync({ id: renaming.id, name });
            setRenaming(null);
        } catch (err) {
            toast.error(__('No se pudo cambiar el nombre'), themeErrorMessage(err));
        }
    };

    const replace = async (t: SavedPublicTheme): Promise<void> => {
        const ok = await confirm({
            title: __('¿Reemplazar «%s» con este diseño?').replace('%s', t.name),
            description: __('Los formularios y agendas que ya lo usan no cambian: cada uno guarda su propia copia del diseño.'),
            confirmLabel: __('Reemplazar'),
        });
        if (!ok) return;
        try {
            await update.mutateAsync({ id: t.id, theme: current });
            toast.success(__('Tema actualizado'));
        } catch (err) {
            toast.error(__('No se pudo actualizar el tema'), themeErrorMessage(err));
        }
    };

    const del = async (t: SavedPublicTheme): Promise<void> => {
        const ok = await confirm({
            title: __('¿Borrar el tema «%s»?').replace('%s', t.name),
            description:
                t.id === defaultId
                    ? __('Es el tema de los formularios y agendas nuevos: desde ahora nacerán con el diseño Clásico. Los que ya lo usan no cambian.')
                    : __('Los formularios y agendas que ya lo usan no cambian: cada uno guarda su propia copia del diseño.'),
            confirmLabel: __('Borrar'),
            destructive: true,
        });
        if (!ok) return;
        try {
            await remove.mutateAsync(t.id);
        } catch (err) {
            toast.error(__('No se pudo borrar el tema'), themeErrorMessage(err));
        }
    };

    const toggleDefault = async (t: SavedPublicTheme): Promise<void> => {
        try {
            await setDefault.mutateAsync(t.id === defaultId ? null : t.id);
        } catch (err) {
            toast.error(__('No se pudo cambiar el tema por defecto'), themeErrorMessage(err));
        }
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="form-my-themes">
            <div className="imcrm-flex imcrm-items-baseline imcrm-justify-between imcrm-gap-2">
                <p className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Mis temas')}</p>
                {list.length > 0 && <span className="imcrm-text-[10px] imcrm-text-muted-foreground">{list.length}</span>}
            </div>

            {themes.isLoading ? (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                    {__('Cargando…')}
                </p>
            ) : themes.isError ? (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('No se pudieron cargar los temas de tu empresa.')}</p>
                    <button type="button" className="imcrm-self-start imcrm-text-[11px] imcrm-text-primary hover:imcrm-underline" onClick={() => void themes.refetch()}>
                        {__('Reintentar')}
                    </button>
                </div>
            ) : (
                <>
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground" data-testid="form-themes-default">
                        {defaultTheme
                            ? __('Los formularios y agendas nuevos nacen con «%s».').replace('%s', defaultTheme.name)
                            : __('Los formularios y agendas nuevos nacen con el diseño Clásico. Marca un tema con la estrella para cambiarlo.')}
                    </p>
                    {list.length === 0 && (
                        <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-2 imcrm-py-2 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            {__('Todavía no hay temas guardados. Guarda este diseño para usarlo en tus otros formularios y agendas.')}
                        </p>
                    )}
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        {list.map((t) => {
                            const inUse = sameTheme(current, t.theme);
                            const isDefault = t.id === defaultId;
                            if (renaming?.id === t.id) {
                                return (
                                    <li key={t.id} className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                        <Input
                                            autoFocus
                                            value={renaming.name}
                                            maxLength={60}
                                            onChange={(e) => setRenaming({ id: t.id, name: e.target.value })}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') void saveRename();
                                                if (e.key === 'Escape') setRenaming(null);
                                            }}
                                            className="imcrm-h-7 imcrm-text-xs"
                                            aria-label={__('Nombre del tema')}
                                        />
                                        <Button size="sm" className="imcrm-h-7 imcrm-px-2" disabled={update.isPending || !renaming.name.trim()} onClick={() => void saveRename()}>
                                            <Check className="imcrm-h-3.5 imcrm-w-3.5" />
                                        </Button>
                                    </li>
                                );
                            }
                            return (
                                <li
                                    key={t.id}
                                    className={cn(
                                        'imcrm-group imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-px-1.5 imcrm-py-1',
                                        inUse ? 'imcrm-border-primary/40 imcrm-bg-primary/5' : 'imcrm-border-transparent hover:imcrm-bg-accent',
                                    )}
                                    data-saved-theme={t.id}
                                >
                                    <button
                                        type="button"
                                        onClick={() => onApply(t)}
                                        className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-2 imcrm-text-left"
                                        title={__('Aplicar este tema')}
                                    >
                                        <span className="imcrm-w-12 imcrm-shrink-0 imcrm-overflow-hidden imcrm-rounded imcrm-border imcrm-border-border">
                                            <ThemeThumb theme={t.theme} brand={brand} />
                                        </span>
                                        <span className="imcrm-min-w-0 imcrm-flex-1">
                                            <span className="imcrm-block imcrm-truncate imcrm-text-xs imcrm-font-medium">{t.name}</span>
                                            {inUse && <span className="imcrm-block imcrm-text-[10px] imcrm-text-primary">{__('En uso aquí')}</span>}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void toggleDefault(t)}
                                        disabled={setDefault.isPending}
                                        aria-pressed={isDefault}
                                        title={isDefault ? __('Es el tema de los formularios y agendas nuevos (toca para quitarlo)') : __('Usar como tema por defecto para formularios y agendas nuevos')}
                                        aria-label={isDefault ? __('Quitar como tema por defecto') : __('Usar como tema por defecto para formularios y agendas nuevos')}
                                        className={cn(
                                            'imcrm-rounded imcrm-p-1',
                                            isDefault ? 'imcrm-text-amber-500' : 'imcrm-text-muted-foreground imcrm-opacity-60 hover:imcrm-opacity-100 group-hover:imcrm-opacity-100',
                                        )}
                                    >
                                        <Star className={cn('imcrm-h-3.5 imcrm-w-3.5', isDefault && 'imcrm-fill-current')} />
                                    </button>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <button type="button" aria-label={__('Más acciones del tema')} className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-text-foreground">
                                                <MoreHorizontal className="imcrm-h-3.5 imcrm-w-3.5" />
                                            </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onSelect={() => setRenaming({ id: t.id, name: t.name })}>
                                                <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                                {__('Cambiar el nombre')}
                                            </DropdownMenuItem>
                                            {!inUse && (
                                                <DropdownMenuItem onSelect={() => void replace(t)}>
                                                    <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    {__('Reemplazar con el diseño actual')}
                                                </DropdownMenuItem>
                                            )}
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onSelect={() => void del(t)} danger>
                                                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                                {__('Borrar')}
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </li>
                            );
                        })}
                    </ul>

                    {naming !== null ? (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2">
                            <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Nombre del tema')}</span>
                            <Input
                                autoFocus
                                value={naming}
                                maxLength={60}
                                onChange={(e) => setNaming(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') void saveNew();
                                    if (e.key === 'Escape') setNaming(null);
                                }}
                                className="imcrm-h-8 imcrm-text-xs"
                                data-testid="form-theme-name"
                            />
                            <div className="imcrm-flex imcrm-justify-end imcrm-gap-1">
                                <Button variant="ghost" size="sm" className="imcrm-h-7" onClick={() => setNaming(null)}>
                                    {__('Cancelar')}
                                </Button>
                                <Button size="sm" className="imcrm-h-7" disabled={create.isPending || !naming.trim()} onClick={() => void saveNew()} data-testid="form-theme-save">
                                    {create.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : __('Guardar tema')}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <Button
                            variant="outline"
                            size="sm"
                            className="imcrm-gap-1.5 imcrm-self-start"
                            disabled={full}
                            onClick={() => setNaming(suggestedName)}
                            data-testid="form-theme-save-as"
                        >
                            <Save className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Guardar este diseño como tema')}
                        </Button>
                    )}
                    {full && (
                        <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            {__('Llegaste al máximo de %d temas. Borra uno para guardar otro.').replace('%d', String(PUBLIC_THEMES_MAX))}
                        </p>
                    )}
                </>
            )}
        </div>
    );
}
