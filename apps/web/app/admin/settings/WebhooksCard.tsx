import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Globe2, Loader2, Pause, Pencil, Play, Plus, Trash2, Webhook } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface WebhookEntry {
    id: number;
    name: string;
    list_id: number;
    list_name: string;
    list_slug: string;
    trigger_type: string;
    urls: string[];
    is_active: boolean;
    created_at: string;
}

/**
 * Webhooks manager (Fase 15.C).
 *
 * Vista cross-list de todas las automatizaciones del workspace que
 * tienen una action `call_webhook`. Permite:
 *
 * - Ver URL(s), lista, trigger y estado activo/pausado.
 * - Toggle activo/inactivo inline.
 * - Eliminar la automation completa (con confirm).
 * - Link al editor de la automation para detalles (config completa).
 * - Botón "Nueva conexión" linkea a la lista correspondiente para
 *   crear una automation con call_webhook.
 *
 * La creación / edición detallada vive en `/automations` (scope por
 * lista) — esta card es el "manager" de read + acciones rápidas.
 * No duplicamos infra; reutilizamos el motor de Automations.
 */
export function WebhooksCard(): JSX.Element {
    const qc = useQueryClient();
    const toast = useToast();
    const confirm = useConfirm();
    const [busyId, setBusyId] = useState<number | null>(null);

    const webhooks = useQuery({
        queryKey: ['imcrm', 'webhooks'],
        queryFn: async (): Promise<WebhookEntry[]> => {
            const res = await api.get<WebhookEntry[]>('/webhooks');
            return res.data;
        },
    });

    const toggleActive = useMutation({
        mutationFn: async ({ wh, next }: { wh: WebhookEntry; next: boolean }): Promise<void> => {
            await api.patch(`/lists/${wh.list_slug}/automations/${wh.id}`, { is_active: next });
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['imcrm', 'webhooks'] });
        },
    });

    const remove = useMutation({
        mutationFn: async (wh: WebhookEntry): Promise<void> => {
            await api.delete(`/lists/${wh.list_slug}/automations/${wh.id}`);
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['imcrm', 'webhooks'] });
        },
    });

    const handleToggle = async (wh: WebhookEntry): Promise<void> => {
        setBusyId(wh.id);
        try {
            await toggleActive.mutateAsync({ wh, next: ! wh.is_active });
            toast.success(wh.is_active ? __('Webhook pausado.') : __('Webhook activado.'));
        } catch (err) {
            toast.error(__('No se pudo cambiar el estado.'), err instanceof Error ? err.message : '');
        } finally {
            setBusyId(null);
        }
    };

    const handleDelete = async (wh: WebhookEntry): Promise<void> => {
        const ok = await confirm({
            title: __('Eliminar webhook'),
            description: __('Se elimina la automatización completa. Las llamadas pendientes en Action Scheduler se descartan.'),
            destructive: true,
            confirmLabel: __('Eliminar'),
        });
        if (! ok) return;
        setBusyId(wh.id);
        try {
            await remove.mutateAsync(wh);
            toast.success(__('Webhook eliminado.'));
        } catch (err) {
            toast.error(__('No se pudo eliminar.'), err instanceof Error ? err.message : '');
        } finally {
            setBusyId(null);
        }
    };

    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6">
            <header className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                <div>
                    <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                        <Webhook className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" />
                        {__('Webhooks outgoing')}
                    </h2>
                    <p className="imcrm-mt-0.5 imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Todas las automatizaciones del workspace que disparan llamadas a URLs externas (Zapier, Make, custom).')}
                    </p>
                </div>
            </header>

            {webhooks.isLoading ? (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-4 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando webhooks…')}
                </p>
            ) : webhooks.isError ? (
                <p className="imcrm-text-sm imcrm-text-destructive">
                    {__('Error al cargar.')}
                </p>
            ) : (webhooks.data ?? []).length === 0 ? (
                <div className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/30 imcrm-p-4">
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Aún no hay webhooks configurados.')}
                    </p>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Para crear uno: abrí una lista → Automatizaciones → Nueva → action "Llamar webhook externo".')}
                    </p>
                </div>
            ) : (
                <div className="imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-border-border">
                    <table className="imcrm-w-full imcrm-text-sm">
                        <thead className="imcrm-border-b imcrm-border-border imcrm-bg-muted/50 imcrm-text-[11px] imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                            <tr>
                                <th className="imcrm-px-3 imcrm-py-2 imcrm-text-left">{__('Webhook')}</th>
                                <th className="imcrm-px-3 imcrm-py-2 imcrm-text-left">{__('Lista')}</th>
                                <th className="imcrm-px-3 imcrm-py-2 imcrm-text-left">{__('Trigger')}</th>
                                <th className="imcrm-px-3 imcrm-py-2 imcrm-text-left">{__('Estado')}</th>
                                <th className="imcrm-px-3 imcrm-py-2 imcrm-text-right">{__('Acciones')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(webhooks.data ?? []).map((wh) => (
                                <tr key={wh.id} className="imcrm-border-b imcrm-border-border last:imcrm-border-b-0">
                                    <td className="imcrm-px-3 imcrm-py-2">
                                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                                            <span className="imcrm-font-medium">{wh.name}</span>
                                            {wh.urls.length > 0 && (
                                                <span className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                                                    <Globe2 className="imcrm-h-3 imcrm-w-3" />
                                                    <code className="imcrm-truncate">{wh.urls[0]}</code>
                                                    {wh.urls.length > 1 && (
                                                        <span className="imcrm-ml-1 imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-text-[10px]">
                                                            +{wh.urls.length - 1}
                                                        </span>
                                                    )}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="imcrm-px-3 imcrm-py-2 imcrm-text-muted-foreground">
                                        <Link to={`/lists/${wh.list_slug}/records`} className="hover:imcrm-underline">
                                            {wh.list_name}
                                        </Link>
                                    </td>
                                    <td className="imcrm-px-3 imcrm-py-2">
                                        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px] imcrm-text-muted-foreground">
                                            <Activity className="imcrm-h-3 imcrm-w-3" />
                                            {wh.trigger_type}
                                        </span>
                                    </td>
                                    <td className="imcrm-px-3 imcrm-py-2">
                                        <span
                                            className={cn(
                                                'imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px]',
                                                wh.is_active
                                                    ? 'imcrm-bg-success/10 imcrm-text-success'
                                                    : 'imcrm-bg-muted imcrm-text-muted-foreground',
                                            )}
                                        >
                                            {wh.is_active ? __('Activo') : __('Pausado')}
                                        </span>
                                    </td>
                                    <td className="imcrm-px-3 imcrm-py-2">
                                        <div className="imcrm-flex imcrm-items-center imcrm-justify-end imcrm-gap-1">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="imcrm-h-7 imcrm-w-7 imcrm-p-0"
                                                disabled={busyId === wh.id}
                                                onClick={() => void handleToggle(wh)}
                                                title={wh.is_active ? __('Pausar') : __('Activar')}
                                                aria-label={wh.is_active ? __('Pausar') : __('Activar')}
                                            >
                                                {busyId === wh.id ? (
                                                    <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                                                ) : wh.is_active ? (
                                                    <Pause className="imcrm-h-3.5 imcrm-w-3.5" />
                                                ) : (
                                                    <Play className="imcrm-h-3.5 imcrm-w-3.5" />
                                                )}
                                            </Button>
                                            <Button
                                                asChild
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="imcrm-h-7 imcrm-w-7 imcrm-p-0"
                                                title={__('Editar en Automatizaciones')}
                                            >
                                                <Link to={`/automations?list=${wh.list_slug}&automation=${wh.id}`}>
                                                    <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                                </Link>
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="imcrm-h-7 imcrm-w-7 imcrm-p-0 imcrm-text-destructive hover:imcrm-bg-destructive/10"
                                                disabled={busyId === wh.id}
                                                onClick={() => void handleDelete(wh)}
                                                title={__('Eliminar')}
                                                aria-label={__('Eliminar')}
                                            >
                                                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <footer className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3">
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Las URLs reciben payload JSON con el contexto del evento. Errores se logean en el Run history de cada automation.')}
                </p>
                <Button asChild variant="outline" size="sm" className="imcrm-gap-1.5">
                    <Link to="/automations">
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Nueva conexión')}
                    </Link>
                </Button>
            </footer>
        </section>
    );
}
