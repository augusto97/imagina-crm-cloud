import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
    AlertCircle,
    ArrowLeft,
    ArrowRight,
    CopyPlus,
    History,
    Hourglass,
    LayoutTemplate,
    MoreHorizontal,
    Plus,
    Trash2,
    Zap,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import {
    automationsKeys,
    useAutomations,
    useDeleteAutomation,
    useDuplicateAutomation,
    useUpdateAutomation,
} from '@/hooks/useAutomations';
import { useTrashedToast } from '@/hooks/useTrash';
import { useRelationPaths } from '@/hooks/useRelationPaths';
import { useFields } from '@/hooks/useFields';
import { useList, useLists } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/admin/activity/activityText';
import type { AutomationEntity } from '@/types/automation';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';

import { AutomationRunsDrawer } from './AutomationRunsDrawer';
import { AutomationTemplateDialog } from './AutomationTemplateDialog';
import { SaveAutomationTemplateDialog } from './SaveAutomationTemplateDialog';
import {
    actionMetaFor,
    summarizeAction,
    summarizeTrigger,
    triggerMetaFor,
} from './automationMeta';

/**
 * Página `/lists/:listSlug/automations` (v0.1.90).
 *
 * Índice de automatizaciones de la lista: cada una es una TARJETA con
 * el flujo resumido en lenguaje humano (trigger → acciones), toggle de
 * estado tipo switch, historial de runs y eliminar. Crear/editar navega
 * al editor de página completa (`AutomationEditorPage`).
 */
export function AutomationsPage(): JSX.Element {
    const { listSlug } = useParams<{ listSlug: string }>();
    const navigate = useNavigate();
    const list = useList(listSlug);
    const automations = useAutomations(list.data?.id);
    const fields = useFields(list.data?.id);
    const lists = useLists();

    const [runsFor, setRunsFor] = useState<AutomationEntity | null>(null);
    // v0.1.167 — recetas: galería (crear desde plantilla) y guardar una como plantilla.
    const [templatesOpen, setTemplatesOpen] = useState(false);
    const [saveTemplateFor, setSaveTemplateFor] = useState<AutomationEntity | null>(null);

    const deleteMutation = useDeleteAutomation(list.data?.id ?? 0);
    const trashed = useTrashedToast();
    const duplicateMutation = useDuplicateAutomation(list.data?.id ?? 0);
    const relationPaths = useRelationPaths(list.data?.id);
    const qc = useQueryClient();
    const toast = useToast();
    const confirm = useConfirm();

    // v0.1.288 — Duplicar: una copia pausada que se abre en el editor.
    const handleDuplicate = async (a: AutomationEntity): Promise<void> => {
        if (!list.data) return;
        try {
            const copy = await duplicateMutation.mutateAsync(a.id);
            qc.setQueryData<AutomationEntity[]>(automationsKeys.forList(list.data.id), (old) =>
                old ? [...old.filter((x) => x.id !== copy.id), copy] : [copy],
            );
            toast.success(__('Copia creada. Quedó pausada: actívala cuando esté lista.'));
            navigate(`/lists/${list.data.slug}/automations/${copy.id}`);
        } catch (err) {
            toast.error(__('No se pudo duplicar'), err instanceof Error ? err.message : undefined);
        }
    };

    const handleDelete = async (id: number): Promise<void> => {
        if (!list.data) return;
        const ok = await confirm({
            title: __('Eliminar automatización'),
            description: __('Deja de correr al instante y va a la papelera con su historial: puedes recuperarla durante 30 días.'),
            destructive: true,
            confirmLabel: __('Eliminar'),
        });
        if (!ok) return;
        try {
            await deleteMutation.mutateAsync(id);
            trashed({ type: 'automation', id, name: automations.data?.find((a) => a.id === id)?.name });
        } catch (err) {
            if (err instanceof ApiError || err instanceof Error) {
                toast.error(__('No se pudo eliminar'), err.message);
            }
        }
    };

    if (list.isLoading) {
        return <PageSkeleton />;
    }

    if (!list.data) {
        return (
            <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-4 imcrm-text-sm imcrm-text-destructive">
                {__('Lista no encontrada.')}
            </div>
        );
    }

    const newHref = `/lists/${list.data.slug}/automations/new`;

    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-[880px] imcrm-flex-col imcrm-gap-6">
            <header className="imcrm-flex imcrm-flex-col imcrm-gap-3 sm:imcrm-flex-row sm:imcrm-items-start sm:imcrm-justify-between sm:imcrm-gap-4">
                <div className="imcrm-flex imcrm-min-w-0 imcrm-items-start imcrm-gap-3">
                    <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        aria-label={__('Volver a registros')}
                    >
                        <Link to={`/lists/${list.data.slug}/records`}>
                            <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                        </Link>
                    </Button>
                    <div className="imcrm-min-w-0">
                        <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">
                            {__('Automatizaciones')}
                        </h1>
                        <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                            {sprintf(
                                /* translators: %s: list name */
                                __('Reglas que se disparan cuando algo cambia en %s.'),
                                list.data.name,
                            )}
                        </p>
                    </div>
                </div>
                {/* v0.1.168 — la plantilla es la opción principal; "En blanco" la segunda. */}
                <div className="imcrm-flex imcrm-shrink-0 imcrm-flex-wrap imcrm-gap-2 imcrm-self-start">
                    <Button className="imcrm-gap-2" onClick={() => setTemplatesOpen(true)}>
                        <LayoutTemplate className="imcrm-h-4 imcrm-w-4" />
                        {__('Desde plantilla')}
                    </Button>
                    <Button asChild variant="outline" className="imcrm-gap-2">
                        <Link to={newHref}>
                            <Plus className="imcrm-h-4 imcrm-w-4" />
                            {__('En blanco')}
                        </Link>
                    </Button>
                </div>
            </header>

            {automations.isError && (
                <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                    <AlertCircle className="imcrm-h-4 imcrm-w-4 imcrm-mt-0.5" />
                    <span>
                        {sprintf(
                            /* translators: %s: error message */
                            __('No se pudieron cargar las automatizaciones: %s'),
                            (automations.error as Error).message,
                        )}
                    </span>
                </div>
            )}

            {automations.isLoading ? (
                <ListSkeleton />
            ) : automations.data && automations.data.length > 0 ? (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    {automations.data.map((a) => (
                        <AutomationCard
                            key={a.id}
                            automation={a}
                            list={list.data!}
                            fields={fields.data ?? []}
                            lists={lists.data ?? []}
                            onOpen={() => navigate(`/lists/${list.data!.slug}/automations/${a.id}`)}
                            onDelete={handleDelete}
                            onShowRuns={setRunsFor}
                            onSaveTemplate={setSaveTemplateFor}
                            onDuplicate={(x) => void handleDuplicate(x)}
                            relationPaths={relationPaths.data}
                        />
                    ))}
                </ul>
            ) : (
                <EmptyState
                    icon={Zap}
                    title={__('Aún no hay automatizaciones')}
                    description={__('Crea reglas que reaccionen a los cambios en tus registros: enviar correos, actualizar campos, crear registros en otras listas, avisar a otras apps…')}
                    action={
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-justify-center imcrm-gap-2">
                            <Button className="imcrm-gap-2" onClick={() => setTemplatesOpen(true)}>
                                <LayoutTemplate className="imcrm-h-4 imcrm-w-4" />
                                {__('Elegir una plantilla')}
                            </Button>
                            <Button asChild variant="outline" className="imcrm-gap-2">
                                <Link to={newHref}>
                                    <Plus className="imcrm-h-4 imcrm-w-4" />
                                    {__('En blanco')}
                                </Link>
                            </Button>
                        </div>
                    }
                />
            )}

            <AutomationTemplateDialog
                open={templatesOpen}
                onOpenChange={setTemplatesOpen}
                list={list.data}
                fields={fields.data ?? []}
            />
            {saveTemplateFor !== null && (
                <SaveAutomationTemplateDialog
                    automation={saveTemplateFor}
                    open={saveTemplateFor !== null}
                    onOpenChange={(open) => !open && setSaveTemplateFor(null)}
                />
            )}

            {runsFor !== null && (
                <AutomationRunsDrawer
                    automation={runsFor}
                    open={runsFor !== null}
                    onOpenChange={(open) => !open && setRunsFor(null)}
                />
            )}
        </div>
    );
}

interface AutomationCardProps {
    automation: AutomationEntity;
    list: ListSummary;
    fields: FieldEntity[];
    lists: ListSummary[];
    onOpen: () => void;
    onDelete: (id: number) => void;
    onShowRuns: (a: AutomationEntity) => void;
    onSaveTemplate: (a: AutomationEntity) => void;
    onDuplicate: (a: AutomationEntity) => void;
    relationPaths?: Array<{ relation_field_id: number; relation_label: string; other_list_name: string }>;
}

function AutomationCard({
    automation,
    list,
    fields,
    lists,
    onOpen,
    onDelete,
    onShowRuns,
    onSaveTemplate,
    onDuplicate,
    relationPaths,
}: AutomationCardProps): JSX.Element {
    const update = useUpdateAutomation(list.id);
    const toast = useToast();
    const triggerMeta = triggerMetaFor(automation.trigger_type);

    const handleToggle = async (): Promise<void> => {
        try {
            await update.mutateAsync({
                id: automation.id,
                input: { is_active: !automation.is_active },
            });
        } catch (err) {
            if (err instanceof Error) toast.error(__('No se pudo cambiar el estado'), err.message);
        }
    };

    return (
        <li
            className={cn(
                'imcrm-group imcrm-flex imcrm-cursor-pointer imcrm-flex-col imcrm-gap-3 imcrm-rounded-2xl imcrm-border imcrm-bg-card imcrm-px-4 imcrm-py-3.5 imcrm-shadow-imcrm-sm imcrm-transition-shadow hover:imcrm-shadow-imcrm-md',
                automation.is_active ? 'imcrm-border-border' : 'imcrm-border-border imcrm-opacity-70',
            )}
            onClick={onOpen}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter') onOpen();
            }}
        >
            <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                <span
                    className={cn(
                        'imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-xl imcrm-ring-1',
                        automation.is_active
                            ? 'imcrm-bg-primary/10 imcrm-text-primary imcrm-ring-primary/20'
                            : 'imcrm-bg-muted imcrm-text-muted-foreground imcrm-ring-border',
                    )}
                    aria-hidden
                >
                    <triggerMeta.icon className="imcrm-h-4 imcrm-w-4" />
                </span>
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                    <span className="imcrm-truncate imcrm-text-sm imcrm-font-semibold">
                        {automation.name}
                    </span>
                    {automation.description !== null && automation.description !== '' && (
                        <span className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                            {automation.description}
                        </span>
                    )}
                </div>
                <div
                    className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1"
                    onClick={(e) => e.stopPropagation()}
                >
                    <SwitchPill
                        active={automation.is_active}
                        disabled={update.isPending}
                        onToggle={handleToggle}
                    />
                    <Button
                        variant="ghost"
                        size="icon"
                        className="imcrm-h-8 imcrm-w-8 imcrm-text-muted-foreground hover:imcrm-text-foreground"
                        onClick={() => onShowRuns(automation)}
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
                        <DropdownMenuContent align="end" className="imcrm-w-56">
                            <DropdownMenuItem onSelect={() => onDuplicate(automation)} className="imcrm-gap-2" data-testid="imcrm-automation-duplicate-item">
                                <CopyPlus className="imcrm-h-4 imcrm-w-4" />
                                {__('Duplicar')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onSaveTemplate(automation)} className="imcrm-gap-2">
                                <LayoutTemplate className="imcrm-h-4 imcrm-w-4" />
                                {__('Guardar como plantilla')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => onDelete(automation.id)} className="imcrm-gap-2 imcrm-text-destructive">
                                <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                {__('Eliminar')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Flujo resumido: trigger → acciones, en lenguaje humano. */}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-pl-12 imcrm-text-xs">
                <FlowChip highlight>
                    {summarizeTrigger(automation.trigger_type, automation.trigger_config, fields)}
                </FlowChip>
                {automation.actions.slice(0, 3).map((spec, i) => {
                    const meta = actionMetaFor(spec.type);
                    return (
                        <span key={i} className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                            <ArrowRight className="imcrm-h-3 imcrm-w-3 imcrm-text-muted-foreground/60" aria-hidden />
                            <FlowChip>
                                <meta.icon className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                                <span className="imcrm-max-w-[260px] imcrm-truncate">
                                    {summarizeAction(spec, fields, lists, undefined, relationPaths)}
                                </span>
                            </FlowChip>
                        </span>
                    );
                })}
                {automation.actions.length > 3 && (
                    <Badge variant="outline">
                        {sprintf(
                            /* translators: %d: hidden action count */
                            __('+%d más'),
                            automation.actions.length - 3,
                        )}
                    </Badge>
                )}
            </div>

            {/* v0.1.288 — corridas en pausa en un «Esperar». */}
            {(automation.waiting_runs ?? 0) > 0 && (
                <button
                    type="button"
                    className="imcrm-ml-12 imcrm-flex imcrm-w-fit imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-border imcrm-border-info/30 imcrm-bg-info/5 imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-text-[hsl(var(--imcrm-info-ink))] hover:imcrm-bg-info/10"
                    onClick={(e) => {
                        e.stopPropagation();
                        onShowRuns(automation);
                    }}
                    data-testid="automation-waiting-runs"
                >
                    <Hourglass className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    {sprintf(
                        (automation.waiting_runs ?? 0) === 1 ? __('%d corrida en espera') : __('%d corridas en espera'),
                        automation.waiting_runs ?? 0,
                    )}
                </button>
            )}

            {/* v0.1.285 — si la última corrida falló, se ve aquí sin abrir el historial. */}
            {automation.last_run?.status === 'failed' && (
                <button
                    type="button"
                    className="imcrm-ml-12 imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-destructive/25 imcrm-bg-destructive/5 imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-text-xs imcrm-text-destructive hover:imcrm-bg-destructive/10"
                    onClick={(e) => {
                        e.stopPropagation();
                        onShowRuns(automation);
                    }}
                    data-testid="automation-last-failed"
                >
                    <AlertCircle className="imcrm-mt-px imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                    <span className="imcrm-min-w-0">
                        <span className="imcrm-font-semibold">
                            {sprintf(__('Falló la última vez (%s)'), relativeTime(automation.last_run.at))}
                        </span>
                        {automation.last_run.error && (
                            <span className="imcrm-line-clamp-2 imcrm-block imcrm-text-destructive/80">{automation.last_run.error}</span>
                        )}
                    </span>
                </button>
            )}
        </li>
    );
}

function FlowChip({
    children,
    highlight,
}: {
    children: React.ReactNode;
    highlight?: boolean;
}): JSX.Element {
    return (
        <span
            className={cn(
                'imcrm-inline-flex imcrm-max-w-full imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-border imcrm-px-2.5 imcrm-py-1 imcrm-font-medium',
                highlight
                    ? 'imcrm-border-primary/25 imcrm-bg-primary/5 imcrm-text-primary'
                    : 'imcrm-border-border imcrm-bg-canvas imcrm-text-foreground/80',
            )}
        >
            {children}
        </span>
    );
}

/**
 * Switch compacto Activa/Pausada para la tarjeta del índice.
 */
function SwitchPill({
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
            title={active ? __('Pausar') : __('Activar')}
            disabled={disabled}
            onClick={onToggle}
            className={cn(
                'imcrm-relative imcrm-inline-flex imcrm-h-5 imcrm-w-9 imcrm-items-center imcrm-rounded-full imcrm-transition-colors disabled:imcrm-opacity-50',
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

function PageSkeleton(): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-h-7 imcrm-w-40 imcrm-animate-pulse imcrm-rounded imcrm-bg-muted" />
            <div className="imcrm-h-20 imcrm-animate-pulse imcrm-rounded-lg imcrm-bg-muted/40" />
        </div>
    );
}

function ListSkeleton(): JSX.Element {
    return (
        <ul className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {[0, 1, 2].map((i) => (
                <li
                    key={i}
                    className="imcrm-h-24 imcrm-animate-pulse imcrm-rounded-2xl imcrm-border imcrm-border-border imcrm-bg-muted/30"
                />
            ))}
        </ul>
    );
}
