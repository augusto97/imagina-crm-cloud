import { memo } from 'react';
import {
    AlertCircle,
    Check,
    CopyPlus,
    Folder,
    FolderInput,
    FolderPlus,
    History,
    Hourglass,
    LayoutTemplate,
    MoreHorizontal,
    PencilLine,
    Trash2,
} from 'lucide-react';
import { folderKey } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { relativeTime } from '@/admin/activity/activityText';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { AutomationEntity } from '@/types/automation';

import { actionMetaFor, triggerMetaFor } from './automationMeta';

/** Lo que cada fila necesita ya resuelto (el resumen se arma una vez por página). */
export interface AutomationRowSummary {
    trigger: string;
    actions: Array<{ type: string; text: string }>;
}

export interface AutomationRowProps {
    automation: AutomationEntity;
    summary: AutomationRowSummary;
    folders: readonly string[];
    selected: boolean;
    selecting: boolean;
    draggable: boolean;
    togglePending: boolean;
    onOpen: (a: AutomationEntity) => void;
    onToggleActive: (a: AutomationEntity) => void;
    onSelect: (a: AutomationEntity, on: boolean, range: boolean) => void;
    onShowRuns: (a: AutomationEntity) => void;
    onMove: (ids: number[], folder: string | null) => void;
    onNewFolderFor: (ids: number[]) => void;
    onDuplicate: (a: AutomationEntity) => void;
    onSaveTemplate: (a: AutomationEntity) => void;
    onDelete: (a: AutomationEntity) => void;
    onDragStart: (a: AutomationEntity, e: React.DragEvent) => void;
}

/**
 * v0.1.411 — Una automatización en el índice: interruptor, qué la dispara y
 * qué hace en una línea, cuándo corrió por última vez y su menú. Compacta a
 * propósito: con veinte en una lista, la tarjeta grande de antes obligaba a
 * scrollear para ver tres.
 */
export const AutomationRow = memo(function AutomationRow({
    automation: a,
    summary,
    folders,
    selected,
    selecting,
    draggable,
    togglePending,
    onOpen,
    onToggleActive,
    onSelect,
    onShowRuns,
    onMove,
    onNewFolderFor,
    onDuplicate,
    onSaveTemplate,
    onDelete,
    onDragStart,
}: AutomationRowProps): JSX.Element {
    const triggerMeta = triggerMetaFor(a.trigger_type);
    const failed = a.last_run?.status === 'failed';
    const waiting = a.waiting_runs ?? 0;
    const shown = summary.actions.slice(0, 2);
    const extra = summary.actions.length - shown.length;

    return (
        <li
            data-testid="automation-row"
            data-id={a.id}
            data-active={a.is_active ? 'true' : 'false'}
            draggable={draggable}
            onDragStart={draggable ? (e) => onDragStart(a, e) : undefined}
            className={cn(
                'imcrm-group imcrm-relative imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-3 imcrm-px-3 imcrm-py-2.5 imcrm-transition-colors sm:imcrm-px-4',
                selected ? 'imcrm-bg-primary/5' : 'hover:imcrm-bg-accent/40',
            )}
            onClick={() => onOpen(a)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(a);
            }}
        >
            <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-2.5 imcrm-pt-1" onClick={(e) => e.stopPropagation()}>
                <input
                    type="checkbox"
                    checked={selected}
                    aria-label={sprintf(__('Seleccionar «%s»'), a.name)}
                    data-testid="automation-select"
                    onChange={() => undefined}
                    onClick={(e) => onSelect(a, !selected, e.shiftKey)}
                    className={cn(
                        'imcrm-h-3.5 imcrm-w-3.5 imcrm-cursor-pointer imcrm-rounded imcrm-accent-[hsl(var(--imcrm-primary))] imcrm-transition-opacity',
                        selected || selecting
                            ? 'imcrm-opacity-100'
                            : 'imcrm-opacity-0 group-hover:imcrm-opacity-100 focus-visible:imcrm-opacity-100 [@media(hover:none)]:imcrm-opacity-100',
                    )}
                />
                <SwitchPill active={a.is_active} disabled={togglePending} onToggle={() => onToggleActive(a)} />
            </div>

            <span
                className={cn(
                    'imcrm-mt-0.5 imcrm-hidden imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-ring-1 sm:imcrm-flex',
                    a.is_active
                        ? 'imcrm-bg-primary/10 imcrm-text-primary imcrm-ring-primary/20'
                        : 'imcrm-bg-muted imcrm-text-muted-foreground imcrm-ring-border',
                )}
                aria-hidden
                title={triggerMeta.title}
            >
                <triggerMeta.icon className="imcrm-h-4 imcrm-w-4" />
            </span>

            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-0.5">
                <div className="imcrm-flex imcrm-min-w-0 imcrm-items-baseline imcrm-gap-2">
                    <span
                        className={cn(
                            'imcrm-truncate imcrm-text-sm imcrm-font-semibold',
                            !a.is_active && 'imcrm-text-muted-foreground',
                        )}
                        data-testid="automation-row-name"
                    >
                        {a.name}
                    </span>
                    {!a.is_active && (
                        <span className="imcrm-shrink-0 imcrm-rounded-full imcrm-bg-muted imcrm-px-1.5 imcrm-py-px imcrm-text-[10.5px] imcrm-font-medium imcrm-text-muted-foreground">
                            {__('Pausada')}
                        </span>
                    )}
                </div>
                {a.description !== null && a.description !== '' && (
                    <span className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{a.description}</span>
                )}
                {/* Qué hace, en una línea: disparador → acciones. */}
                <div
                    className="imcrm-flex imcrm-min-w-0 imcrm-flex-wrap imcrm-items-center imcrm-gap-x-1.5 imcrm-gap-y-0.5 imcrm-text-xs imcrm-text-muted-foreground"
                    data-testid="automation-row-flow"
                >
                    <span className="imcrm-max-w-full imcrm-truncate imcrm-font-medium imcrm-text-foreground/75">{summary.trigger}</span>
                    {shown.map((s, i) => {
                        const meta = actionMetaFor(s.type);
                        return (
                            <span key={i} className="imcrm-flex imcrm-min-w-0 imcrm-max-w-full imcrm-items-center imcrm-gap-1">
                                <span aria-hidden className="imcrm-text-muted-foreground/50">→</span>
                                <meta.icon className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0" aria-hidden />
                                <span className="imcrm-truncate sm:imcrm-max-w-[300px]">{s.text}</span>
                            </span>
                        );
                    })}
                    {extra > 0 && (
                        <span className="imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-text-[10.5px] imcrm-font-medium">
                            {sprintf(__('+%d más'), extra)}
                        </span>
                    )}
                    {summary.actions.length === 0 && <span>{__('→ sin acciones')}</span>}
                </div>
                {failed && a.last_run?.error && (
                    <button
                        type="button"
                        className="imcrm-mt-0.5 imcrm-flex imcrm-w-fit imcrm-max-w-full imcrm-items-start imcrm-gap-1 imcrm-text-left imcrm-text-xs imcrm-text-destructive hover:imcrm-underline"
                        onClick={(e) => {
                            e.stopPropagation();
                            onShowRuns(a);
                        }}
                        data-testid="automation-last-failed"
                    >
                        <AlertCircle className="imcrm-mt-px imcrm-h-3 imcrm-w-3 imcrm-shrink-0" aria-hidden />
                        <span className="imcrm-line-clamp-1">{a.last_run.error}</span>
                    </button>
                )}
                {/* En el celular el estado de la última corrida va debajo. */}
                <div className="imcrm-mt-0.5 sm:imcrm-hidden">
                    <LastRun automation={a} onShowRuns={onShowRuns} />
                </div>
            </div>

            <div className="imcrm-hidden imcrm-shrink-0 imcrm-flex-col imcrm-items-end imcrm-gap-1 imcrm-pt-0.5 sm:imcrm-flex sm:imcrm-w-36">
                <LastRun automation={a} onShowRuns={onShowRuns} />
                {waiting > 0 && (
                    <button
                        type="button"
                        className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-bg-info/10 imcrm-px-2 imcrm-py-px imcrm-text-[11px] imcrm-text-[hsl(var(--imcrm-info-ink))] hover:imcrm-bg-info/15"
                        onClick={(e) => {
                            e.stopPropagation();
                            onShowRuns(a);
                        }}
                        data-testid="automation-waiting-runs"
                    >
                        <Hourglass className="imcrm-h-3 imcrm-w-3" aria-hidden />
                        {sprintf(__('%d en espera'), waiting)}
                    </button>
                )}
            </div>

            <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center" onClick={(e) => e.stopPropagation()}>
                <Button
                    variant="ghost"
                    size="icon"
                    className="imcrm-hidden imcrm-h-8 imcrm-w-8 imcrm-text-muted-foreground hover:imcrm-text-foreground sm:imcrm-inline-flex"
                    onClick={() => onShowRuns(a)}
                    aria-label={__('Ver historial de ejecuciones')}
                    title={__('Historial')}
                >
                    <History className="imcrm-h-4 imcrm-w-4" />
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="imcrm-h-8 imcrm-w-8 imcrm-text-muted-foreground hover:imcrm-text-foreground"
                            aria-label={__('Más acciones')}
                            title={__('Más acciones')}
                            data-testid="imcrm-automation-card-menu"
                        >
                            <MoreHorizontal className="imcrm-h-4 imcrm-w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="imcrm-w-60">
                        <DropdownMenuItem onSelect={() => onOpen(a)} className="imcrm-gap-2">
                            <PencilLine className="imcrm-h-4 imcrm-w-4" />
                            {__('Editar')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onShowRuns(a)} className="imcrm-gap-2">
                            <History className="imcrm-h-4 imcrm-w-4" />
                            {__('Historial de corridas')}
                        </DropdownMenuItem>
                        <MoveToFolderSub
                            current={a.folder ?? null}
                            folders={folders}
                            onMove={(folder) => onMove([a.id], folder)}
                            onNewFolder={() => onNewFolderFor([a.id])}
                        />
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onDuplicate(a)} className="imcrm-gap-2" data-testid="imcrm-automation-duplicate-item">
                            <CopyPlus className="imcrm-h-4 imcrm-w-4" />
                            {__('Duplicar')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onSaveTemplate(a)} className="imcrm-gap-2">
                            <LayoutTemplate className="imcrm-h-4 imcrm-w-4" />
                            {__('Guardar como plantilla')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onDelete(a)} className="imcrm-gap-2 imcrm-text-destructive">
                            <Trash2 className="imcrm-h-4 imcrm-w-4" />
                            {__('Eliminar')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </li>
    );
});

/** Cuándo corrió por última vez y cómo le fue. */
function LastRun({ automation: a, onShowRuns }: { automation: AutomationEntity; onShowRuns: (a: AutomationEntity) => void }): JSX.Element {
    const run = a.last_run;
    if (!run) {
        return (
            <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground/80" data-testid="automation-last-run" data-state="never">
                <span className="imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full imcrm-bg-border" aria-hidden />
                {__('Todavía no corrió')}
            </span>
        );
    }
    const failed = run.status === 'failed';
    const tone = failed ? 'imcrm-text-destructive' : 'imcrm-text-muted-foreground';
    const dot =
        failed ? 'imcrm-bg-destructive'
        : run.status === 'success' ? 'imcrm-bg-success'
        : run.status === 'cancelled' ? 'imcrm-bg-muted-foreground/40'
        : 'imcrm-bg-amber-400';
    const when = relativeTime(run.at);
    const label =
        run.status === 'failed' ? sprintf(__('Falló %s'), when)
        : run.status === 'success' ? sprintf(__('Corrió %s'), when)
        : run.status === 'waiting' ? sprintf(__('En espera · %s'), when)
        : run.status === 'cancelled' ? sprintf(__('Cancelada · %s'), when)
        : sprintf(__('Corriendo · %s'), when);
    return (
        <button
            type="button"
            className={cn('imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-whitespace-nowrap imcrm-text-xs hover:imcrm-underline', tone)}
            onClick={(e) => {
                e.stopPropagation();
                onShowRuns(a);
            }}
            title={__('Ver el historial')}
            data-testid="automation-last-run"
            data-state={run.status}
        >
            <span className={cn('imcrm-h-1.5 imcrm-w-1.5 imcrm-shrink-0 imcrm-rounded-full', dot)} aria-hidden />
            {label}
        </button>
    );
}

/** «Mover a carpeta ›»: las carpetas, «Sin carpeta» y «Nueva carpeta…». */
export function MoveToFolderSub({
    current,
    folders,
    onMove,
    onNewFolder,
}: {
    current: string | null;
    folders: readonly string[];
    onMove: (folder: string | null) => void;
    onNewFolder: () => void;
}): JSX.Element {
    const currentKey = current ? folderKey(current) : null;
    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger className="imcrm-gap-2" data-testid="automation-move-sub">
                <FolderInput className="imcrm-h-4 imcrm-w-4" />
                {__('Mover a carpeta')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="imcrm-max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] imcrm-w-56 imcrm-overflow-y-auto">
                <FolderTargets current={currentKey} folders={folders} onMove={onMove} onNewFolder={onNewFolder} />
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    );
}

/** Las opciones de destino (compartidas por el submenú de la fila y la barra de selección). */
export function FolderTargets({
    current,
    folders,
    onMove,
    onNewFolder,
}: {
    /** Clave de la carpeta actual (null = sin carpeta; undefined = varias / no aplica). */
    current: string | null | undefined;
    folders: readonly string[];
    onMove: (folder: string | null) => void;
    onNewFolder: () => void;
}): JSX.Element {
    return (
        <>
            {folders.map((f) => {
                const on = current === folderKey(f);
                return (
                    <DropdownMenuItem
                        key={f}
                        className="imcrm-gap-2"
                        disabled={on}
                        onSelect={() => onMove(f)}
                        data-testid="automation-move-target"
                        data-folder={f}
                    >
                        <Folder className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                        <span className="imcrm-flex-1 imcrm-truncate">{f}</span>
                        {on && <Check className="imcrm-h-3.5 imcrm-w-3.5" />}
                    </DropdownMenuItem>
                );
            })}
            {folders.length > 0 && (
                <DropdownMenuItem
                    className="imcrm-gap-2"
                    disabled={current === null}
                    onSelect={() => onMove(null)}
                    data-testid="automation-move-none"
                >
                    <span className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    <span className="imcrm-flex-1">{__('Sin carpeta')}</span>
                    {current === null && <Check className="imcrm-h-3.5 imcrm-w-3.5" />}
                </DropdownMenuItem>
            )}
            {folders.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem className="imcrm-gap-2" onSelect={onNewFolder} data-testid="automation-move-new">
                <FolderPlus className="imcrm-h-4 imcrm-w-4" />
                {__('Nueva carpeta…')}
            </DropdownMenuItem>
        </>
    );
}

/** Interruptor Activa/Pausada. */
export function SwitchPill({
    active,
    disabled,
    onToggle,
}: {
    active: boolean;
    disabled: boolean;
    onToggle: () => void;
}): JSX.Element {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={active}
            aria-label={active ? __('Pausar') : __('Activar')}
            title={active ? __('Activa · tocar para pausar') : __('Pausada · tocar para activar')}
            disabled={disabled}
            onClick={onToggle}
            data-testid="automation-toggle"
            className={cn(
                'imcrm-relative imcrm-inline-flex imcrm-h-5 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-rounded-full imcrm-transition-colors disabled:imcrm-opacity-50',
                active ? 'imcrm-bg-success' : 'imcrm-bg-border',
            )}
        >
            <span
                className="imcrm-inline-block imcrm-h-4 imcrm-w-4 imcrm-rounded-full imcrm-bg-white imcrm-shadow imcrm-transition-transform"
                style={{ transform: active ? 'translateX(18px)' : 'translateX(2px)' }}
            />
        </button>
    );
}
