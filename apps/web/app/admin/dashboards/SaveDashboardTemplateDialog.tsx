import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { LayoutTemplate, Loader2, X } from 'lucide-react';
import { TEMPLATE_CATEGORIES, type TemplateCategory } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useCreateDashboardTemplate } from '@/hooks/useDashboardTemplates';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import type { DashboardEntity } from '@/types/dashboard';

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
    ventas: 'Ventas',
    clientes: 'Clientes',
    proyectos: 'Proyectos',
    operaciones: 'Operaciones',
    finanzas: 'Finanzas',
    personas: 'Personas',
    otros: 'Otros',
};

/**
 * "Guardar como plantilla" de un dashboard (v0.1.167): sus widgets pasan a
 * la galería con los campos expresados como roles; al usarla en otra lista
 * se mapean.
 */
export function SaveDashboardTemplateDialog({
    dashboard,
    open,
    onOpenChange,
}: {
    dashboard: DashboardEntity;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}): JSX.Element {
    const create = useCreateDashboardTemplate();
    const toast = useToast();
    const [name, setName] = useState(dashboard.name);
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState<TemplateCategory>('otros');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setName(dashboard.name);
        setDescription(dashboard.description ?? '');
        setCategory('otros');
        setError(null);
    }, [open, dashboard.name, dashboard.description]);

    const submit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);
        try {
            const tpl = await create.mutateAsync({
                dashboard_id: dashboard.id,
                name: name.trim(),
                description: description.trim() || null,
                category,
            });
            toast.success(__('Plantilla guardada'), tpl.name);
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    const dataWidgets = dashboard.widgets.filter((w) => w.list_id > 0).length;

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg"
                    style={{ transform: 'translate(-50%, -50%)' }}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Guardar como plantilla')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Queda en la galería de "Nuevo dashboard". Al usarla, se elige la lista y a qué campo corresponde cada uno de los que usan estos widgets.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>
                    <form onSubmit={submit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-4">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="dtpl-name">{__('Nombre de la plantilla')}</Label>
                            <Input id="dtpl-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="dtpl-desc">{__('Descripción (opcional)')}</Label>
                            <Textarea id="dtpl-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="dtpl-cat">{__('Categoría')}</Label>
                            <Select id="dtpl-cat" value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory)}>
                                {TEMPLATE_CATEGORIES.map((c) => (
                                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                                ))}
                            </Select>
                        </div>
                        {dataWidgets === 0 && (
                            <p className="imcrm-rounded-md imcrm-border imcrm-border-amber-300 imcrm-bg-amber-50 imcrm-p-2 imcrm-text-xs imcrm-text-amber-800">
                                {__('Este dashboard no tiene widgets sobre una lista: no hay nada que convertir en plantilla.')}
                            </p>
                        )}
                        {error !== null && (
                            <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">{error}</div>
                        )}
                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Dialog.Close asChild>
                                <Button type="button" variant="outline">{__('Cancelar')}</Button>
                            </Dialog.Close>
                            <Button type="submit" disabled={name.trim() === '' || create.isPending || dataWidgets === 0} className="imcrm-gap-2">
                                {create.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <LayoutTemplate className="imcrm-h-4 imcrm-w-4" />}
                                {create.isPending ? __('Guardando…') : __('Guardar plantilla')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
