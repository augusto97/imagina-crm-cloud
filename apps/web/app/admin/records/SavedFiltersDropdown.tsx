import { useState } from 'react';
import { Bookmark, ChevronDown, Plus, Search, Trash2, Users, User as UserIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import {
    useDeleteSavedFilter,
    useSaveFilter,
    useSavedFilters,
} from '@/hooks/useSavedFilters';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { isEmptyTree, type FilterTree } from '@/types/record';

interface SavedFiltersDropdownProps {
    listId: number;
    currentTree: FilterTree;
    onApply: (tree: FilterTree) => void;
}

/**
 * Dropdown estilo ClickUp: lista los filtros guardados de la lista
 * en dos secciones (Personal / Entorno de trabajo) con búsqueda y
 * un botón "Guardar nuevo filtro" abajo. Click en un filtro lo aplica
 * al árbol actual.
 */
export function SavedFiltersDropdown({
    listId,
    currentTree,
    onApply,
}: SavedFiltersDropdownProps): JSX.Element {
    const [search, setSearch] = useState('');
    const [savingName, setSavingName] = useState('');
    const [savingScope, setSavingScope] = useState<'personal' | 'shared'>('personal');
    const [showSaveForm, setShowSaveForm] = useState(false);

    const filters = useSavedFilters(listId);
    const save    = useSaveFilter(listId);
    const remove  = useDeleteSavedFilter(listId);
    const toast   = useToast();
    const confirm = useConfirm();

    const all     = filters.data ?? [];
    const matches = (s: string): boolean =>
        search === '' || s.toLowerCase().includes(search.toLowerCase());
    const personal = all.filter((f) => f.user_id !== null && matches(f.name));
    const shared   = all.filter((f) => f.user_id === null && matches(f.name));

    const handleSave = async (): Promise<void> => {
        if (savingName.trim() === '' || isEmptyTree(currentTree)) return;
        try {
            await save.mutateAsync({
                name: savingName.trim(),
                scope: savingScope,
                filter_tree: currentTree,
            });
            setSavingName('');
            setShowSaveForm(false);
            toast.success(__('Filtro guardado'));
        } catch (err) {
            if (err instanceof Error) toast.error(__('No se pudo guardar el filtro'), err.message);
        }
    };

    const handleDelete = async (id: number, name: string): Promise<void> => {
        const ok = await confirm({
            title: sprintf(__('¿Eliminar el filtro "%s"?'), name),
            description: __('Esta acción no se puede deshacer.'),
            destructive: true,
            confirmLabel: __('Eliminar'),
        });
        if (!ok) return;
        try {
            await remove.mutateAsync(id);
            toast.success(__('Filtro eliminado'));
        } catch (err) {
            if (err instanceof Error) toast.error(__('No se pudo eliminar'), err.message);
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="imcrm-gap-1.5">
                    <Bookmark className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Filtros guardados')}
                    <ChevronDown className="imcrm-h-3 imcrm-w-3" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                className="imcrm-w-[280px] imcrm-p-2"
                align="end"
            >
                <div className="imcrm-relative imcrm-mb-2">
                    <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2 imcrm-top-2 imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={__('Buscar…')}
                        className="imcrm-h-8 imcrm-pl-7 imcrm-text-xs"
                    />
                </div>

                <FilterSection
                    title={__('Personal')}
                    icon={<UserIcon className="imcrm-h-3 imcrm-w-3" />}
                    items={personal}
                    onApply={(tree) => onApply(tree)}
                    onDelete={(id, name) => void handleDelete(id, name)}
                />
                <FilterSection
                    title={__('Entorno de trabajo')}
                    icon={<Users className="imcrm-h-3 imcrm-w-3" />}
                    items={shared}
                    onApply={(tree) => onApply(tree)}
                    onDelete={(id, name) => void handleDelete(id, name)}
                />

                <div className="imcrm-mt-2 imcrm-border-t imcrm-border-border imcrm-pt-2">
                    {showSaveForm ? (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Input
                                value={savingName}
                                onChange={(e) => setSavingName(e.target.value)}
                                placeholder={__('Nombre del filtro')}
                                className="imcrm-h-8 imcrm-text-xs"
                                autoFocus
                            />
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-[11px]">
                                <label className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                    <input
                                        type="radio"
                                        checked={savingScope === 'personal'}
                                        onChange={() => setSavingScope('personal')}
                                    />
                                    {__('Personal')}
                                </label>
                                <label className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                    <input
                                        type="radio"
                                        checked={savingScope === 'shared'}
                                        onChange={() => setSavingScope('shared')}
                                    />
                                    {__('Compartido')}
                                </label>
                            </div>
                            <div className="imcrm-flex imcrm-justify-end imcrm-gap-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setShowSaveForm(false);
                                        setSavingName('');
                                    }}
                                >
                                    {__('Cancelar')}
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={() => void handleSave()}
                                    disabled={savingName.trim() === '' || save.isPending}
                                >
                                    {save.isPending ? __('Guardando…') : __('Guardar')}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <Button
                            size="sm"
                            className="imcrm-w-full imcrm-gap-1.5"
                            onClick={() => setShowSaveForm(true)}
                            disabled={isEmptyTree(currentTree)}
                        >
                            <Plus className="imcrm-h-3 imcrm-w-3" />
                            {__('Guardar nuevo filtro')}
                        </Button>
                    )}
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

interface SavedItem {
    id: number;
    name: string;
    user_id: number | null;
    filter_tree: FilterTree;
}

interface FilterSectionProps {
    title: string;
    icon: JSX.Element;
    items: SavedItem[];
    onApply: (tree: FilterTree) => void;
    onDelete: (id: number, name: string) => void;
}

function FilterSection({ title, icon, items, onApply, onDelete }: FilterSectionProps): JSX.Element | null {
    if (items.length === 0) return null;
    return (
        <div className="imcrm-mb-1">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-px-2 imcrm-py-1 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                {icon}
                {title}
            </div>
            {items.map((item) => (
                <div
                    key={item.id}
                    className={cn(
                        'imcrm-group imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-2 imcrm-py-1 imcrm-text-xs',
                        'hover:imcrm-bg-accent',
                    )}
                >
                    <button
                        type="button"
                        onClick={() => onApply(item.filter_tree)}
                        className="imcrm-flex-1 imcrm-truncate imcrm-text-left"
                    >
                        {item.name}
                    </button>
                    <button
                        type="button"
                        onClick={() => onDelete(item.id, item.name)}
                        className="imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground imcrm-opacity-0 hover:imcrm-text-destructive group-hover:imcrm-opacity-100"
                        aria-label={__('Eliminar')}
                    >
                        <Trash2 className="imcrm-h-3 imcrm-w-3" />
                    </button>
                </div>
            ))}
        </div>
    );
}
