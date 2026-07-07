import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
    AlertCircle,
    ArrowLeft,
    CheckCircle2,
    History,
    Pencil,
    Plus,
    Trash2,
    XCircle,
    Zap,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import {
    useActionCatalog,
    useAutomations,
    useDeleteAutomation,
    useTriggerCatalog,
    useUpdateAutomation,
} from '@/hooks/useAutomations';
import { useList } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import type { AutomationEntity, TriggerMeta } from '@/types/automation';

import { AutomationDialog } from './AutomationDialog';
import { AutomationRunsDrawer } from './AutomationRunsDrawer';

/**
 * Página `/lists/:listSlug/automations`.
 *
 * Lista las automatizaciones de la lista activa con su estado, trigger,
 * cantidad de acciones, y permite togglear `is_active`, editar, borrar y
 * abrir el log de runs en un drawer lateral. La creación / edición se
 * resuelve en `<AutomationDialog />`.
 */
export function AutomationsPage(): JSX.Element {
    const { listSlug } = useParams<{ listSlug: string }>();
    const list = useList(listSlug);
    const automations = useAutomations(list.data?.id);
    const triggers = useTriggerCatalog();
    const actions = useActionCatalog();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<AutomationEntity | null>(null);
    const [runsFor, setRunsFor] = useState<AutomationEntity | null>(null);

    const deleteMutation = useDeleteAutomation(list.data?.id ?? 0);
    const toast = useToast();
    const confirm = useConfirm();

    const handleEdit = (automation: AutomationEntity): void => {
        setEditing(automation);
        setDialogOpen(true);
    };

    const handleNew = (): void => {
        setEditing(null);
        setDialogOpen(true);
    };

    const handleDelete = async (id: number): Promise<void> => {
        if (!list.data) return;
        const ok = await confirm({
            title: __('Eliminar automatización'),
            description: __('Sus runs anteriores se conservan para auditoría.'),
            destructive: true,
            confirmLabel: __('Eliminar'),
        });
        if (!ok) return;
        try {
            await deleteMutation.mutateAsync(id);
            toast.success(__('Automatización eliminada'));
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

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-6">
            <header className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-4">
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
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
                    <div>
                        <h1 className="imcrm-text-2xl imcrm-font-semibold imcrm-tracking-tight">
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
                <Button className="imcrm-gap-2" onClick={handleNew}>
                    <Plus className="imcrm-h-4 imcrm-w-4" />
                    {__('Nueva automatización')}
                </Button>
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

            {automations.isLoading || triggers.isLoading ? (
                <ListSkeleton />
            ) : automations.data && automations.data.length > 0 ? (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    {automations.data.map((a) => (
                        <AutomationRow
                            key={a.id}
                            automation={a}
                            triggers={triggers.data ?? []}
                            listId={list.data!.id}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            onShowRuns={setRunsFor}
                        />
                    ))}
                </ul>
            ) : (
                <AutomationsEmpty onCreate={handleNew} />
            )}

            {dialogOpen && list.data && triggers.data && actions.data && (
                <AutomationDialog
                    open={dialogOpen}
                    onOpenChange={setDialogOpen}
                    listId={list.data.id}
                    triggers={triggers.data}
                    actions={actions.data}
                    automation={editing}
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

interface AutomationRowProps {
    automation: AutomationEntity;
    triggers: TriggerMeta[];
    listId: number;
    onEdit: (a: AutomationEntity) => void;
    onDelete: (id: number) => void;
    onShowRuns: (a: AutomationEntity) => void;
}

function AutomationRow({
    automation,
    triggers,
    listId,
    onEdit,
    onDelete,
    onShowRuns,
}: AutomationRowProps): JSX.Element {
    const update = useUpdateAutomation(listId);
    const toast = useToast();
    const triggerLabel =
        triggers.find((t) => t.slug === automation.trigger_type)?.label ?? automation.trigger_type;

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
        <li className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-4 imcrm-py-3">
            <span
                className={
                    'imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-full ' +
                    (automation.is_active
                        ? 'imcrm-bg-primary/10 imcrm-text-primary'
                        : 'imcrm-bg-muted imcrm-text-muted-foreground')
                }
                aria-hidden
            >
                <Zap className="imcrm-h-4 imcrm-w-4" />
            </span>
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <button
                        type="button"
                        onClick={() => onEdit(automation)}
                        className="imcrm-text-sm imcrm-font-medium imcrm-text-left hover:imcrm-underline"
                    >
                        {automation.name}
                    </button>
                    {automation.is_active ? (
                        <Badge variant="success">{__('Activa')}</Badge>
                    ) : (
                        <Badge variant="outline">{__('Pausada')}</Badge>
                    )}
                </div>
                <div className="imcrm-mt-0.5 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                    <span>{triggerLabel}</span>
                    <span aria-hidden>·</span>
                    <span>
                        {sprintf(
                            /* translators: %d: action count */
                            __('%d acciones'),
                            automation.actions.length,
                        )}
                    </span>
                </div>
            </div>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleToggle}
                    disabled={update.isPending}
                    aria-label={automation.is_active ? __('Pausar') : __('Activar')}
                >
                    {automation.is_active ? (
                        <XCircle className="imcrm-h-4 imcrm-w-4" />
                    ) : (
                        <CheckCircle2 className="imcrm-h-4 imcrm-w-4" />
                    )}
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onShowRuns(automation)}
                    aria-label={__('Ver historial de ejecuciones')}
                >
                    <History className="imcrm-h-4 imcrm-w-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEdit(automation)}
                    aria-label={__('Editar')}
                >
                    <Pencil className="imcrm-h-4 imcrm-w-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(automation.id)}
                    aria-label={__('Eliminar')}
                >
                    <Trash2 className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </div>
        </li>
    );
}

function AutomationsEmpty({ onCreate }: { onCreate: () => void }): JSX.Element {
    return (
        <EmptyState
            icon={Zap}
            title={__('Aún no hay automatizaciones')}
            description={__('Crea reglas que reaccionen a cambios en tus registros: actualizar campos, llamar webhooks, etc.')}
            action={
                <Button onClick={onCreate} className="imcrm-gap-2">
                    <Plus className="imcrm-h-4 imcrm-w-4" />
                    {__('Nueva automatización')}
                </Button>
            }
        />
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
        <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            {[0, 1, 2].map((i) => (
                <li
                    key={i}
                    className="imcrm-h-16 imcrm-animate-pulse imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/30"
                />
            ))}
        </ul>
    );
}
