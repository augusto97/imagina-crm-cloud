import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, History, Pause, Pencil, Play, Plus, Trash2, Zap } from 'lucide-react';
import type { Automation, Field } from '@imagina-base/shared';
import { api, useSession } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { AutomationEditorSheet } from '@/cloud/components/automations/AutomationEditorSheet';
import { AutomationRunsSheet } from '@/cloud/components/automations/AutomationRunsSheet';
import { actionSummary, triggerSummary } from '@/cloud/components/automations/automationMeta';

/**
 * Ruta `/lists/:listSlug/automations` en la nube. UI de automatizaciones
 * cableada nativamente al modelo del backend NestJS (trigger + filter_tree +
 * varias acciones + runs), con el look del builder del plugin: header, filas
 * con badges/estado, empty state, y editor + historial en Sheets laterales.
 */
export function CloudAutomationsPage(): JSX.Element {
    const { listSlug } = useParams<{ listSlug: string }>();
    const slug = listSlug as string;
    const tenantId = useSession((s) => s.activeTenantId);

    const fields = useQuery({
        queryKey: ['fields', tenantId, slug],
        queryFn: () => api.listFields(slug),
        enabled: Boolean(slug),
    });
    const lists = useQuery({ queryKey: ['lists', tenantId], queryFn: () => api.listLists() });
    const list = lists.data?.find((l) => l.slug === slug);
    const automations = useQuery({
        queryKey: ['automations', tenantId, slug],
        queryFn: () => api.listAutomations(slug),
        enabled: Boolean(slug),
    });

    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<Automation | null>(null);
    const [runsFor, setRunsFor] = useState<Automation | null>(null);

    const openNew = (): void => { setEditing(null); setEditorOpen(true); };
    const openEdit = (a: Automation): void => { setEditing(a); setEditorOpen(true); };

    return (
        <div className="imcrm-mx-auto imcrm-max-w-3xl imcrm-space-y-6 imcrm-p-6">
            <header className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-4">
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <Button asChild variant="ghost" size="icon" aria-label="Volver a la lista">
                        <Link to={`/lists/${slug}/records`}><ArrowLeft className="imcrm-h-4 imcrm-w-4" /></Link>
                    </Button>
                    <div>
                        <h1 className="imcrm-text-2xl imcrm-font-semibold imcrm-tracking-tight">Automatizaciones</h1>
                        <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                            Reglas que se disparan cuando algo cambia{list ? ` en ${list.name}` : ''}.
                        </p>
                    </div>
                </div>
                <Button className="imcrm-gap-2" onClick={openNew} disabled={!fields.data}>
                    <Plus className="imcrm-h-4 imcrm-w-4" /> Nueva automatización
                </Button>
            </header>

            {automations.isLoading ? (
                <ListSkeleton />
            ) : automations.data && automations.data.length > 0 ? (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    {automations.data.map((a) => (
                        <AutomationRow
                            key={a.id}
                            automation={a}
                            listSlug={slug}
                            fields={fields.data ?? []}
                            onEdit={openEdit}
                            onShowRuns={setRunsFor}
                        />
                    ))}
                </ul>
            ) : (
                <EmptyState
                    icon={Zap}
                    title="Aún no hay automatizaciones"
                    description="Creá reglas que reaccionen a tus registros: actualizar campos, enviar emails, llamar webhooks o crear registros."
                    action={
                        <Button onClick={openNew} className="imcrm-gap-2" disabled={!fields.data}>
                            <Plus className="imcrm-h-4 imcrm-w-4" /> Nueva automatización
                        </Button>
                    }
                />
            )}

            {fields.data && (
                <AutomationEditorSheet
                    open={editorOpen}
                    onOpenChange={setEditorOpen}
                    listSlug={slug}
                    fields={fields.data}
                    lists={lists.data ?? []}
                    automation={editing}
                />
            )}
            <AutomationRunsSheet
                open={runsFor !== null}
                onOpenChange={(v) => !v && setRunsFor(null)}
                listSlug={slug}
                automation={runsFor}
            />
        </div>
    );
}

function AutomationRow({
    automation,
    listSlug,
    fields,
    onEdit,
    onShowRuns,
}: {
    automation: Automation;
    listSlug: string;
    fields: Field[];
    onEdit: (a: Automation) => void;
    onShowRuns: (a: Automation) => void;
}): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const confirm = useConfirm();
    const invalidate = (): void => void qc.invalidateQueries({ queryKey: ['automations', tenantId, listSlug] });

    const toggle = useMutation({
        mutationFn: () => api.updateAutomation(listSlug, automation.id, { is_active: !automation.is_active }),
        onSuccess: invalidate,
    });
    const del = useMutation({
        mutationFn: () => api.deleteAutomation(listSlug, automation.id),
        onSuccess: invalidate,
    });

    const handleDelete = async (): Promise<void> => {
        const ok = await confirm({
            title: 'Eliminar automatización',
            description: 'Sus ejecuciones anteriores se conservan para auditoría.',
            destructive: true,
            confirmLabel: 'Eliminar',
        });
        if (ok) del.mutate();
    };

    return (
        <li className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-4 imcrm-py-3">
            <span
                className={[
                    'imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full',
                    automation.is_active ? 'imcrm-bg-primary/10 imcrm-text-primary' : 'imcrm-bg-muted imcrm-text-muted-foreground',
                ].join(' ')}
                aria-hidden
            >
                <Zap className="imcrm-h-4 imcrm-w-4" />
            </span>
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <button type="button" onClick={() => onEdit(automation)} className="imcrm-truncate imcrm-text-sm imcrm-font-medium hover:imcrm-underline">
                        {automation.name}
                    </button>
                    {automation.is_active ? <Badge variant="success">Activa</Badge> : <Badge variant="outline">Pausada</Badge>}
                </div>
                <div className="imcrm-mt-0.5 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1 imcrm-text-xs imcrm-text-muted-foreground">
                    <span>{triggerSummary(automation.trigger, fields)}</span>
                    <span aria-hidden>→</span>
                    {automation.actions.slice(0, 3).map((a, i) => (
                        <Badge key={i} variant="secondary">{actionSummary(a, fields)}</Badge>
                    ))}
                    {automation.actions.length > 3 && <span>+{automation.actions.length - 3}</span>}
                </div>
            </div>
            <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1">
                <Button variant="ghost" size="icon" onClick={() => toggle.mutate()} disabled={toggle.isPending} aria-label={automation.is_active ? 'Pausar' : 'Activar'}>
                    {automation.is_active ? <Pause className="imcrm-h-4 imcrm-w-4" /> : <Play className="imcrm-h-4 imcrm-w-4" />}
                </Button>
                <Button variant="ghost" size="icon" onClick={() => onShowRuns(automation)} aria-label="Ver ejecuciones">
                    <History className="imcrm-h-4 imcrm-w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => onEdit(automation)} aria-label="Editar">
                    <Pencil className="imcrm-h-4 imcrm-w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={handleDelete} aria-label="Eliminar">
                    <Trash2 className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </div>
        </li>
    );
}

function ListSkeleton(): JSX.Element {
    return (
        <div className="imcrm-space-y-2">
            {[0, 1, 2].map((i) => (
                <div key={i} className="imcrm-h-16 imcrm-animate-pulse imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40" />
            ))}
        </div>
    );
}
