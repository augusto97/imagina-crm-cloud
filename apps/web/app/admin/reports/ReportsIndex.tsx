import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, Copy, FileText, Loader2, Lock, Plus, X } from 'lucide-react';
import { reportDataBlocks, reportListIds, type Report } from '@imagina-base/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { __, sprintf } from '@/lib/i18n';
import { formatDate } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';
import { cn } from '@/lib/utils';

import { useCreateReport, useDuplicateReport, useReports } from './useReports';

/**
 * v0.1.464 (J1) — Los informes, dentro de Tableros (pestaña «Informes»): un
 * documento con bloques de varias listas para leer, descargar en PDF o Excel
 * y mandar por correo.
 */
export function ReportsIndex({ canManage, createOpen, onCreateOpenChange }: { canManage: boolean; createOpen: boolean; onCreateOpenChange: (o: boolean) => void }): JSX.Element {
    const reports = useReports();
    const duplicate = useDuplicateReport();
    const toast = useToast();

    const handleDuplicate = async (e: React.MouseEvent, id: number): Promise<void> => {
        e.preventDefault();
        e.stopPropagation();
        try {
            await duplicate.mutateAsync(id);
            toast.success(__('Informe duplicado'));
        } catch (err) {
            toast.error(__('No se pudo duplicar'), err instanceof Error ? err.message : undefined);
        }
    };

    return (
        <>
            {reports.isError && (
                <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                    <AlertCircle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4" />
                    <span>{(reports.error as Error).message}</span>
                </div>
            )}
            {reports.isLoading ? (
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-3">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="imcrm-h-32 imcrm-animate-pulse imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40" />
                    ))}
                </div>
            ) : reports.data && reports.data.length > 0 ? (
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-3" data-testid="reports-list">
                    {reports.data.map((r) => (
                        <ReportCard key={r.id} report={r} canManage={canManage} onDuplicate={(e) => void handleDuplicate(e, r.id)} />
                    ))}
                </div>
            ) : (
                <EmptyState
                    icon={FileText}
                    title={__('Aún no hay informes')}
                    description={
                        canManage
                            ? __('Un informe junta indicadores, gráficos y tablas de VARIAS listas en un documento para leer, descargar en PDF o Excel y mandar por correo.')
                            : __('Todavía no hay informes compartidos contigo.')
                    }
                    action={
                        canManage ? (
                            <Button onClick={() => onCreateOpenChange(true)} className="imcrm-gap-2">
                                <Plus className="imcrm-h-4 imcrm-w-4" />
                                {__('Crear informe')}
                            </Button>
                        ) : undefined
                    }
                />
            )}
            {canManage && <ReportCreateDialog open={createOpen} onOpenChange={onCreateOpenChange} />}
        </>
    );
}

function ReportCard({ report, canManage, onDuplicate }: { report: Report; canManage: boolean; onDuplicate: (e: React.MouseEvent) => void }): JSX.Element {
    const blocks = reportDataBlocks(report.blocks).length;
    const lists = reportListIds(report.blocks).length;
    return (
        <Link
            to={`/reports/${report.id}`}
            className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 imcrm-shadow-imcrm-sm imcrm-transition-colors hover:imcrm-border-primary/30 hover:imcrm-bg-accent/30"
            data-testid="report-card"
            data-tour="report-card"
        >
            <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2 imcrm-font-semibold">
                    <FileText className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                    <span className="imcrm-truncate">{report.name}</span>
                </span>
                <span className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5">
                    {canManage && (
                        <button
                            type="button"
                            onClick={onDuplicate}
                            className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                            aria-label={__('Duplicar informe')}
                            title={__('Duplicar informe')}
                        >
                            <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                        </button>
                    )}
                    {report.visibility !== 'workspace' && (
                        <Badge variant="outline" className="imcrm-gap-1">
                            <Lock className="imcrm-h-3 imcrm-w-3" />
                            {report.visibility === 'private' ? __('Sólo yo') : __('Roles')}
                        </Badge>
                    )}
                </span>
            </div>
            {report.description && <p className="imcrm-line-clamp-2 imcrm-text-sm imcrm-text-muted-foreground">{report.description}</p>}
            <div className="imcrm-mt-auto imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                <span>
                    {sprintf(blocks === 1 ? __('%d bloque de datos') : __('%d bloques de datos'), blocks)}
                    {lists > 0 && ` · ${sprintf(lists === 1 ? __('%d lista') : __('%d listas'), lists)}`}
                </span>
                <span>{sprintf(__('Editado %s'), formatDate(parseUtcDate(report.updated_at)))}</span>
            </div>
        </Link>
    );
}

function ReportCreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }): JSX.Element {
    const nav = useNavigate();
    const create = useCreateReport();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);
        if (name.trim() === '') {
            setError(__('Ponle un nombre al informe.'));
            return;
        }
        try {
            const r = await create.mutateAsync({ name: name.trim(), description: description.trim() || null, blocks: [] });
            onOpenChange(false);
            setName('');
            setDescription('');
            nav(`/reports/${r.id}/edit`);
        } catch (err) {
            setError(err instanceof Error ? err.message : __('No se pudo crear.'));
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-lg imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="report-create-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Nuevo informe')}</Dialog.Title>
                            <Dialog.Description className="imcrm-mt-0.5 imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Después agregas los bloques: títulos, textos e indicadores, gráficos o tablas de cualquiera de tus listas.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>
                    <form onSubmit={(e) => void submit(e)} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-3">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="report-new-name">{__('Nombre')}</Label>
                            <Input
                                id="report-new-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={__('Ej. Resumen comercial del mes')}
                                maxLength={190}
                                autoFocus
                                data-testid="report-new-name"
                            />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="report-new-description">{__('Descripción (opcional)')}</Label>
                            <Textarea id="report-new-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
                        </div>
                        {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2 imcrm-pt-2">
                            <Dialog.Close asChild>
                                <Button type="button" variant="outline">{__('Cancelar')}</Button>
                            </Dialog.Close>
                            <Button type="submit" disabled={create.isPending} className="imcrm-gap-1.5" data-testid="report-new-create">
                                {create.isPending && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                                {__('Crear y armar')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
