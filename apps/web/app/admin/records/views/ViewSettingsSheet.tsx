import { useState } from 'react';
import { Link } from 'react-router';
import {
    Check,
    Columns3,
    Copy,
    Download,
    FileUp,
    Filter,
    Grid3x3,
    Group,
    Settings,
    Star,
    Trash2,
    WrapText,
    Zap,
} from 'lucide-react';

import { useConfirm } from '@/components/ui/confirm-dialog';
import { Select } from '@/components/ui/select';
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { useDeleteSavedView, useUpdateSavedView } from '@/hooks/useSavedViews';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import { countConditions, isEmptyTree, isGroupableType, type FilterTree } from '@/types/record';
import type { RowDensity, RowFontSize } from '../recordsState';

/** Las tres densidades de fila que puede elegir quien mira la vista. */
const DENSITIES: Array<{ id: RowDensity; label: string }> = [
    { id: 'compact', label: __('Compacta') },
    { id: 'normal', label: __('Normal') },
    { id: 'comfortable', label: __('Cómoda') },
];

/** Tamaños de letra de la tabla (v0.1.141), a la par de la densidad. */
const FONT_SIZES: Array<{ id: RowFontSize; label: string }> = [
    { id: 'sm', label: __('Chica') },
    { id: 'md', label: __('Normal') },
    { id: 'lg', label: __('Grande') },
];
import type { SavedViewEntity } from '@/types/view';

import { FiltersPanel } from '../FiltersPanel';
import { ColumnsConfigDialog } from './ColumnsConfigDialog';

interface ViewSettingsSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    listId: number;
    listSlug: string;
    fields: FieldEntity[];
    /** Vista guardada activa, o null si se está viendo "Todos". */
    activeView: SavedViewEntity | null;
    onSelectView: (view: SavedViewEntity | null) => void;

    filterTree: FilterTree;
    onFilterTreeChange: (next: FilterTree) => void;
    columnVisibility: Record<string, boolean>;
    onColumnVisibilityChange: (next: Record<string, boolean>) => void;
    columnOrder: string[];
    onColumnOrderChange: (next: string[]) => void;
    groupByFieldId: number | null;
    onGroupByFieldIdChange: (next: number | null) => void;
    /** Agrupar no aplica en kanban/calendario/tarjetas. */
    canGroup: boolean;
    /**
     * Tipo de la vista abierta (v0.1.142). El panel mostraba TODOS los
     * ajustes en todas las vistas: densidad, letra, ajustar texto, hoja de
     * cálculo y columnas no significan nada en kanban, calendario o
     * tarjetas, y ver ahí controles que no hacen nada confunde.
     */
    viewType: 'table' | 'kanban' | 'calendar' | 'cards';
    wrapText: boolean;
    spreadsheet: boolean;
    onSpreadsheetChange: (next: boolean) => void;
    density: RowDensity | null;
    onDensityChange: (next: RowDensity | null) => void;
    fontSize: RowFontSize | null;
    onFontSizeChange: (next: RowFontSize | null) => void;
    onWrapTextChange: (next: boolean) => void;

    canManageList: boolean;
    canManageAutomations: boolean;
    canImport: boolean;
    canExport: boolean;
    onImport: () => void;
    onExport: () => void;
}

/**
 * "Personalizar vista" (v0.1.127) — el panel del engranaje, al estilo de
 * ClickUp.
 *
 * Antes cada ajuste de la vista vivía en su propio botón de la toolbar
 * (Filtros, Columnas, Agrupar) y las acciones de la lista estaban
 * repartidas entre el breadcrumb y el menú de la pestaña. Acá están
 * TODOS juntos, con su valor actual visible de un vistazo: cuántos
 * campos se muestran, cuántas condiciones filtran, por qué campo se
 * agrupa. Los controles son los MISMOS de siempre (mismo estado, misma
 * persistencia en la vista guardada) — sólo cambió dónde viven.
 */
export function ViewSettingsSheet({
    open,
    onOpenChange,
    listId,
    listSlug,
    fields,
    activeView,
    onSelectView,
    filterTree,
    onFilterTreeChange,
    columnVisibility,
    onColumnVisibilityChange,
    columnOrder,
    onColumnOrderChange,
    groupByFieldId,
    onGroupByFieldIdChange,
    canGroup,
    viewType,
    wrapText,
    spreadsheet,
    onSpreadsheetChange,
    density,
    onDensityChange,
    fontSize,
    onFontSizeChange,
    onWrapTextChange,
    canManageList,
    canManageAutomations,
    canImport,
    canExport,
    onImport,
    onExport,
}: ViewSettingsSheetProps): JSX.Element {
    const update = useUpdateSavedView(listId);
    const remove = useDeleteSavedView(listId);
    const confirm = useConfirm();
    const toast = useToast();

    const [columnsOpen, setColumnsOpen] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    // Sólo la tabla tiene filas, columnas y densidad.
    const isTable = viewType === 'table';
    const [copied, setCopied] = useState(false);

    const hiddenCount = Object.values(columnVisibility).filter((v) => v === false).length;
    // +2 por las columnas fijas (ID y actualizado); las de relación no se
    // listan en la tabla.
    const totalColumns = fields.filter((f) => f.type !== 'relation').length + 2;
    const visibleColumns = Math.max(0, totalColumns - hiddenCount);
    const conditionCount = isEmptyTree(filterTree) ? 0 : countConditions(filterTree);
    const groupable = fields.filter((f) => isGroupableType(f.type));
    const groupField = groupByFieldId !== null ? fields.find((f) => f.id === groupByFieldId) : null;

    const handleCopyLink = async (): Promise<void> => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* portapapeles bloqueado — no-op */
        }
    };

    const handleSetDefault = async (): Promise<void> => {
        if (!activeView) return;
        await update.mutateAsync({ id: activeView.id, is_default: !activeView.is_default });
        toast.success(
            activeView.is_default ? __('Ya no es la vista por defecto') : __('Vista por defecto'),
        );
    };

    const handleDelete = async (): Promise<void> => {
        if (!activeView) return;
        const okToDelete = await confirm({
            title: sprintf(
                /* translators: %s: saved view name */
                __('¿Eliminar la vista "%s"?'),
                activeView.name,
            ),
            description: __('Se borra la vista, no los registros.'),
            confirmLabel: __('Eliminar vista'),
            destructive: true,
        });
        if (!okToDelete) return;
        await remove.mutateAsync(activeView.id);
        onSelectView(null);
        onOpenChange(false);
    };

    return (
        <>
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent side="right" className="sm:imcrm-w-[420px]">
                    <SheetHeader>
                        <SheetTitle>{__('Personalizar vista')}</SheetTitle>
                    </SheetHeader>
                    <SheetBody className="imcrm-flex imcrm-flex-col imcrm-gap-5">
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {activeView
                                ? sprintf(
                                      /* translators: %s: saved view name */
                                      __('Estás viendo «%s». Los cambios se guardan en la vista desde la barra de pestañas.'),
                                      activeView.name,
                                  )
                                : __('Estás viendo todos los registros. Guardá estos ajustes como una vista para volver a ellos.')}
                        </p>

                        {isTable && (
                        <Group_ label={__('Densidad y letra')}>
                            {/* v0.1.140 — la hoja de cálculo arrancaba fija en
                                compacta y para algunos era demasiado apretada:
                                ahora cada vista guarda cuánto respira. */}
                            <div className="imcrm-flex imcrm-gap-1 imcrm-px-1 imcrm-py-1">
                                {DENSITIES.map((d) => {
                                    const active = (density ?? (spreadsheet ? 'compact' : 'normal')) === d.id;
                                    return (
                                        <button
                                            key={d.id}
                                            type="button"
                                            aria-pressed={active}
                                            onClick={() => onDensityChange(d.id)}
                                            className={cn(
                                                'imcrm-flex-1 imcrm-rounded-md imcrm-border imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-transition-colors',
                                                active
                                                    ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-font-medium imcrm-text-primary'
                                                    : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-bg-accent',
                                            )}
                                        >
                                            {d.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="imcrm-flex imcrm-gap-1 imcrm-px-1 imcrm-pb-1">
                                {FONT_SIZES.map((f) => {
                                    const active = (fontSize ?? (spreadsheet ? 'sm' : 'md')) === f.id;
                                    return (
                                        <button
                                            key={f.id}
                                            type="button"
                                            aria-pressed={active}
                                            aria-label={sprintf(
                                                /* translators: %s: font size name */
                                                __('Letra %s'),
                                                f.label,
                                            )}
                                            onClick={() => onFontSizeChange(f.id)}
                                            className={cn(
                                                'imcrm-flex-1 imcrm-rounded-md imcrm-border imcrm-px-2 imcrm-py-1.5 imcrm-transition-colors',
                                                f.id === 'sm' && 'imcrm-text-[11px]',
                                                f.id === 'md' && 'imcrm-text-[13px]',
                                                f.id === 'lg' && 'imcrm-text-[15px]',
                                                active
                                                    ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-font-medium imcrm-text-primary'
                                                    : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-bg-accent',
                                            )}
                                        >
                                            {f.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </Group_>
                        )}

                        {isTable && (
                        <Group_ label={__('Mostrar')}>
                            <ToggleRow
                                icon={WrapText}
                                label={__('Ajustar texto')}
                                hint={__('Muestra el contenido completo en varias líneas.')}
                                checked={wrapText}
                                onChange={onWrapTextChange}
                            />
                            {/* La hoja de cálculo no convive con la
                                agrupación: es una grilla plana. */}
                            {groupByFieldId === null && (
                                <ToggleRow
                                    icon={Grid3x3}
                                    label={__('Hoja de cálculo')}
                                    hint={__('Numera las filas y dibuja la cuadrícula.')}
                                    checked={spreadsheet}
                                    onChange={onSpreadsheetChange}
                                />
                            )}
                            <ToggleRow
                                icon={Columns3}
                                label={__('Columna de número')}
                                hint={__('El identificador de cada registro.')}
                                checked={columnVisibility['id'] !== false}
                                onChange={(v) =>
                                    onColumnVisibilityChange({ ...columnVisibility, id: v })
                                }
                            />
                        </Group_>
                        )}

                        <Group_ label={__('Qué se ve y en qué orden')}>
                            {/* Las columnas son de la tabla: en kanban,
                                calendario y tarjetas los campos visibles se
                                eligen en el diálogo propio de la vista. */}
                            {isTable && (
                                <RowButton
                                    icon={Columns3}
                                    label={__('Campos')}
                                    value={sprintf(
                                        /* translators: %d: visible column count */
                                        __('%d en pantalla'),
                                        visibleColumns,
                                    )}
                                    onClick={() => setColumnsOpen(true)}
                                />
                            )}

                            <RowButton
                                icon={Filter}
                                label={__('Filtro')}
                                value={
                                    conditionCount === 0
                                        ? __('Ninguno')
                                        : sprintf(
                                              /* translators: %d: filter condition count */
                                              __('%d condición(es)'),
                                              conditionCount,
                                          )
                                }
                                expanded={filtersOpen}
                                onClick={() => setFiltersOpen((v) => !v)}
                            />
                            {filtersOpen && (
                                <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-3">
                                    <FiltersPanel
                                        inline
                                        listId={listId}
                                        fields={fields}
                                        tree={filterTree}
                                        onChange={onFilterTreeChange}
                                    />
                                </div>
                            )}

                            {canGroup && (
                                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-px-1 imcrm-py-1.5">
                                    <span className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                        <Group className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                                        {__('Agrupar por')}
                                    </span>
                                    <Select
                                        aria-label={__('Agrupar por')}
                                        className="imcrm-h-8 imcrm-w-[190px]"
                                        value={groupByFieldId ?? ''}
                                        onChange={(e) =>
                                            onGroupByFieldIdChange(
                                                e.target.value === '' ? null : parseInt(e.target.value, 10),
                                            )
                                        }
                                    >
                                        <option value="">{__('Sin agrupar')}</option>
                                        {groupable.map((f) => (
                                            <option key={f.id} value={f.id}>
                                                {f.label}
                                            </option>
                                        ))}
                                    </Select>
                                </div>
                            )}
                            {canGroup && groupField && (
                                <p className="imcrm-px-1 imcrm-text-xs imcrm-text-muted-foreground">
                                    {sprintf(
                                        /* translators: %s: field label */
                                        __('Las filas se agrupan por «%s».'),
                                        groupField.label,
                                    )}
                                </p>
                            )}
                        </Group_>

                        {activeView && (
                            <Group_ label={__('Esta vista')}>
                                <ToggleRow
                                    icon={Star}
                                    label={__('Abrir esta vista por defecto')}
                                    checked={activeView.is_default}
                                    onChange={() => void handleSetDefault()}
                                    disabled={update.isPending}
                                />
                                <RowButton
                                    icon={copied ? Check : Copy}
                                    label={copied ? __('¡Enlace copiado!') : __('Copiar enlace de la vista')}
                                    onClick={() => void handleCopyLink()}
                                />
                                <RowButton
                                    icon={Trash2}
                                    label={__('Eliminar vista')}
                                    danger
                                    onClick={() => void handleDelete()}
                                />
                            </Group_>
                        )}

                        <Group_ label={__('La lista')}>
                            {canExport && (
                                <RowButton
                                    icon={Download}
                                    label={__('Exportar registros')}
                                    value={__('CSV o JSON')}
                                    onClick={() => {
                                        onOpenChange(false);
                                        onExport();
                                    }}
                                />
                            )}
                            {canImport && (
                                <RowButton
                                    icon={FileUp}
                                    label={__('Importar registros')}
                                    value={__('CSV o Excel')}
                                    onClick={() => {
                                        onOpenChange(false);
                                        onImport();
                                    }}
                                />
                            )}
                            {canManageAutomations && (
                                <RowLink
                                    icon={Zap}
                                    label={__('Automatizaciones')}
                                    to={`/lists/${listSlug}/automations`}
                                    onNavigate={() => onOpenChange(false)}
                                />
                            )}
                            {canManageList && (
                                <RowLink
                                    icon={Settings}
                                    label={__('Configurar la lista')}
                                    value={__('Campos, permisos…')}
                                    to={`/lists/${listSlug}/edit`}
                                    onNavigate={() => onOpenChange(false)}
                                />
                            )}
                        </Group_>
                    </SheetBody>
                </SheetContent>
            </Sheet>

            <ColumnsConfigDialog
                open={columnsOpen}
                onOpenChange={setColumnsOpen}
                fields={fields}
                columnOrder={columnOrder}
                visibility={columnVisibility}
                onApply={(next) => {
                    onColumnOrderChange(next.columnOrder);
                    onColumnVisibilityChange(next.visibility);
                }}
            />
        </>
    );
}

/** Bloque con título, como los grupos separados por línea de ClickUp. */
function Group_({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-border-t imcrm-border-border imcrm-pt-3 first:imcrm-border-t-0 first:imcrm-pt-0">
            <h3 className="imcrm-px-1 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                {label}
            </h3>
            {children}
        </section>
    );
}

function ToggleRow({
    icon: Icon,
    label,
    hint,
    checked,
    onChange,
    disabled,
}: {
    icon: typeof Columns3;
    label: string;
    hint?: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
}): JSX.Element {
    return (
        <label
            className={cn(
                'imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-rounded-md imcrm-px-1 imcrm-py-1.5 hover:imcrm-bg-accent/30',
                disabled && 'imcrm-cursor-not-allowed imcrm-opacity-60',
            )}
        >
            <span className="imcrm-flex imcrm-min-w-0 imcrm-items-start imcrm-gap-2">
                <Icon className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                    <span className="imcrm-text-sm">{label}</span>
                    {hint !== undefined && (
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">{hint}</span>
                    )}
                </span>
            </span>
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-rounded imcrm-border-input"
            />
        </label>
    );
}

function RowButton({
    icon: Icon,
    label,
    value,
    onClick,
    expanded,
    danger,
}: {
    icon: typeof Columns3;
    label: string;
    value?: string;
    onClick: () => void;
    expanded?: boolean;
    danger?: boolean;
}): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-expanded={expanded}
            className={cn(
                'imcrm-flex imcrm-w-full imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-rounded-md imcrm-px-1 imcrm-py-1.5 imcrm-text-left hover:imcrm-bg-accent/30',
                danger && 'imcrm-text-destructive hover:imcrm-bg-destructive/10',
            )}
        >
            <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2">
                <Icon
                    className={cn(
                        'imcrm-h-4 imcrm-w-4 imcrm-shrink-0',
                        danger ? 'imcrm-text-destructive' : 'imcrm-text-muted-foreground',
                    )}
                    aria-hidden
                />
                <span className="imcrm-truncate imcrm-text-sm">{label}</span>
            </span>
            {value !== undefined && (
                <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground">{value}</span>
            )}
        </button>
    );
}

function RowLink({
    icon: Icon,
    label,
    value,
    to,
    onNavigate,
}: {
    icon: typeof Columns3;
    label: string;
    value?: string;
    to: string;
    onNavigate: () => void;
}): JSX.Element {
    return (
        <Link
            to={to}
            onClick={onNavigate}
            className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-rounded-md imcrm-px-1 imcrm-py-1.5 hover:imcrm-bg-accent/30"
        >
            <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2">
                <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                <span className="imcrm-truncate imcrm-text-sm">{label}</span>
            </span>
            {value !== undefined && (
                <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground">{value}</span>
            )}
        </Link>
    );
}
