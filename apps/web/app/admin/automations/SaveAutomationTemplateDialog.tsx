import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { LayoutTemplate, Loader2, X } from 'lucide-react';
import { AUTOMATION_TEMPLATE_CATEGORIES, type AutomationTemplateCategory } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useCreateAutomationTemplate } from '@/hooks/useAutomationTemplates';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import type { AutomationEntity } from '@/types/automation';

const CATEGORY_LABELS: Record<AutomationTemplateCategory, string> = {
    correo: 'Correo',
    plazos: 'Plazos',
    campos: 'Campos',
    integraciones: 'Integraciones',
    otros: 'Otros',
};

/**
 * "Guardar como plantilla" de una automatización (v0.1.167): queda en la
 * galería de recetas del workspace; los campos que usa pasan a ser roles
 * que se mapean al aplicarla en otra lista.
 */
export function SaveAutomationTemplateDialog({
    automation,
    open,
    onOpenChange,
}: {
    automation: AutomationEntity;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}): JSX.Element {
    const create = useCreateAutomationTemplate();
    const toast = useToast();
    const [name, setName] = useState(automation.name);
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState<AutomationTemplateCategory>('otros');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setName(automation.name);
        setDescription(automation.description ?? '');
        setCategory('otros');
        setError(null);
    }, [open, automation.name, automation.description]);

    const submit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);
        try {
            const tpl = await create.mutateAsync({
                list_id: automation.list_id,
                automation_id: automation.id,
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
                                {__('Queda entre las recetas del workspace. Al usarla en otra lista se indica qué campo cumple cada rol.')}
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
                            <Label htmlFor="atpl-name">{__('Nombre de la plantilla')}</Label>
                            <Input id="atpl-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="atpl-desc">{__('Descripción (opcional)')}</Label>
                            <Textarea id="atpl-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={__('Qué hace y qué hay que completar al usarla')} />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="atpl-cat">{__('Categoría')}</Label>
                            <Select id="atpl-cat" value={category} onChange={(e) => setCategory(e.target.value as AutomationTemplateCategory)}>
                                {AUTOMATION_TEMPLATE_CATEGORIES.map((c) => (
                                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                                ))}
                            </Select>
                        </div>
                        {error !== null && (
                            <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">{error}</div>
                        )}
                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Dialog.Close asChild>
                                <Button type="button" variant="outline">{__('Cancelar')}</Button>
                            </Dialog.Close>
                            <Button type="submit" disabled={name.trim() === '' || create.isPending} className="imcrm-gap-2">
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
