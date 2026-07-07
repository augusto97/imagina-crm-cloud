import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useUpdateDashboard } from '@/hooks/useDashboards';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { DashboardEntity } from '@/types/dashboard';

interface DashboardSettingsDialogProps {
    dashboard: DashboardEntity;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * Dialog para editar nombre + descripción del dashboard. El share
 * (`is_shared`) NO se edita aquí — está atado al `user_id` que se
 * fija al crear y cambiarlo después implica reasignar ownership;
 * fuera de scope.
 */
export function DashboardSettingsDialog({
    dashboard,
    open,
    onOpenChange,
}: DashboardSettingsDialogProps): JSX.Element {
    const update = useUpdateDashboard(dashboard.id);
    const toast = useToast();
    const [name, setName] = useState(dashboard.name);
    const [description, setDescription] = useState(dashboard.description ?? '');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setName(dashboard.name);
            setDescription(dashboard.description ?? '');
            setError(null);
        }
    }, [open, dashboard.name, dashboard.description]);

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);
        const trimmedName = name.trim();
        if (trimmedName === '') {
            setError(__('El nombre es obligatorio.'));
            return;
        }
        try {
            await update.mutateAsync({
                name: trimmedName,
                description: description.trim() === '' ? null : description.trim(),
            });
            toast.success(__('Dashboard actualizado'));
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay
                    className={cn(
                        'imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm',
                    )}
                />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-full imcrm-max-w-md',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg',
                    )}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {__('Configuración del dashboard')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Cambia el nombre o la descripción.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <form onSubmit={handleSubmit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-4">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="db-edit-name">{__('Nombre')}</Label>
                            <Input
                                id="db-edit-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                autoFocus
                            />
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="db-edit-desc">{__('Descripción (opcional)')}</Label>
                            <Textarea
                                id="db-edit-desc"
                                rows={3}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                            />
                        </div>

                        {error !== null && (
                            <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                {error}
                            </div>
                        )}

                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Dialog.Close asChild>
                                <Button type="button" variant="outline">
                                    {__('Cancelar')}
                                </Button>
                            </Dialog.Close>
                            <Button
                                type="submit"
                                disabled={name.trim() === '' || update.isPending}
                                className="imcrm-gap-2"
                            >
                                {update.isPending && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                                {__('Guardar')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
